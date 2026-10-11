import assert from 'node:assert/strict'
import pg from 'pg'
import { randomUUID } from 'node:crypto'
import { REQUEST_CONCLUSION_DEFAULT_SETTINGS } from '../src/lib/request-conclusion-settings'
import { buildCurrentSystemDocumentName } from '../src/lib/system-document-types'
import type { DocumentOperationRequest } from '../src/lib/system-document-operation'

// Run only after e2e/global-setup, in its disposable local database. The caller
// owns dropping that database; no production or working database is accepted.
const url = new URL(process.env.DATABASE_URL ?? '')
assert.equal(url.hostname, '127.0.0.1')
assert.equal(url.pathname, '/welding_tracker_e2e')
assert.equal(process.env.WELDING_ENV_LOADED, '1')
const [{ requireDb }, operations, indexes] = await Promise.all([
  import('../src/db/index'), import('../src/server/document-operation-service'), import('../src/server/system-document-index'),
])
const db = requireDb(), client = new pg.Client({ connectionString: url.toString() })
await client.connect()
const project = 'E2E rebuild load', original = pg.Client.prototype.query
assert.equal((await client.query('select count(*)::int as n from weld_joints where project_title=$1', [project])).rows[0].n, 0)
let statements = 0, sqlMs = 0
const measure = async <T>(label: string, run: () => Promise<T>) => {
  statements = 0; sqlMs = 0
  const start = performance.now()
  pg.Client.prototype.query = function (this: unknown, ...args: unknown[]) {
    statements++
    const started = performance.now()
    const result = (original as (...args: unknown[]) => unknown).apply(this, args)
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      return (result as Promise<unknown>).then(value => { sqlMs += performance.now() - started; return value })
    }
    return result
  } as typeof original
  try {
    const result = await run()
    return { label, result, queries: statements, milliseconds: Math.round(performance.now() - start),
      sqlMilliseconds: Math.round(sqlMs), rssMiB: Math.round(process.memoryUsage().rss / 1024 / 1024) }
  } finally { pg.Client.prototype.query = original }
}

async function seed(count: number) {
  const names = Array.from({ length: count / 200 }, (_, i) => buildCurrentSystemDocumentName({
    type: 'pstoConclusion', title: '', date: '2026-09-05',
  }, [], REQUEST_CONCLUSION_DEFAULT_SETTINGS, i + 1))
  await client.query(`insert into app_settings(key,value) values ('request-conclusion',$1)
    on conflict(key) do update set value=excluded.value,updated_at=now()`, [JSON.stringify({
    ...REQUEST_CONCLUSION_DEFAULT_SETTINGS,
    splitModes: { ...REQUEST_CONCLUSION_DEFAULT_SETTINGS.splitModes, pstoConclusion: 'line' },
  })])
  await client.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
    select $1,'LOAD','L'||n,'II','A',10,10 from generate_series(1,$2::int) n`, [project, count / 100])
  await client.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,weld_date,
    officiality,revision_actuality,has_vik,connection_type,psto_required,psto_request,psto_request_date,psto_date,
    heat_treatment_diagram,psto_result,tvmt_result,tvmt_conclusion_date,tvmt_conclusion,psto_note)
    select p.id,$1,'LOAD',p.line,'S'||n,'2026-09-01','действующий','актуальная','да','С17','да',
      'Первичная заявка','2026-09-01',case when n%2=0 then date '2026-09-02' else date '2026-09-05' end,
      case when n%2=0 then 'Первый цикл — сохранить' else ($3::text[])[(n-1)/200+1] end,
      'выполнено',case when n%2=0 then 'не годен' else 'годен' end,
      case when n%2=0 then date '2026-09-03' else date '2026-09-06' end,'Исторический ТВМТ','  Сохранить пробелы  '
    from generate_series(1,$2::int) n join line_programs p on p.project_title=$1 and p.line='L'||((n-1)/100+1)`, [project, count, names])
  await client.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id)
    select id,'primary',id from weld_joints where project_title=$1`, [project])
  await client.query(`insert into psto_repeat_cycles(weld_joint_id,sequence,psto_request,psto_request_date,psto_date,
    heat_treatment_diagram,psto_result,tvmt_result,tvmt_conclusion,tvmt_conclusion_date,psto_note)
    select id,2,'Повторная заявка','2026-09-04','2026-09-05',($2::text[])[(substring(joint from 2)::int-1)/200+1],
      'выполнено','годен','ТВМТ повтор','2026-09-06','  Факт повторного цикла  '
    from weld_joints where project_title=$1 and substring(joint from 2)::int%2=0`, [project, names])
  // Mixed document: first cycles on half of its welds, repeat cycles on the
  // other half. Each document spans two lines, so rebuilding must split it.
  await client.query(`insert into generated_documents(type,title,file_name,mime_type,period_from,period_to,row_count,source_metadata)
    select 'system:pstoConclusion',($2::text[])[(substring(w.joint from 2)::int-1)/200+1],'load.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','2026-09-05','2026-09-05',count(*)::int,
      jsonb_build_object('sourceKind','pstoCycle','cycleSequences',jsonb_build_array(1,2),'positionCount',count(*),
        'projects',jsonb_build_array($1::text),'subtitleCodes',jsonb_build_array('LOAD'),'lines',jsonb_agg(distinct w.line),
        'sourcePositions',jsonb_agg(jsonb_build_object('kind','pstoCycle','weldJointId',w.id,
          'relationId',coalesce(c.id,w.id),'sequence',case when c.id is null then 1 else 2 end) order by w.id))::text
    from weld_joints w left join psto_repeat_cycles c on c.weld_joint_id=w.id
    where w.project_title=$1 group by (substring(w.joint from 2)::int-1)/200`, [project, names])
  await client.query(`insert into generated_document_weld_joints(document_id,weld_joint_id)
    select d.id,(p->>'weldJointId')::int from generated_documents d
    cross join lateral jsonb_array_elements(d.source_metadata::jsonb->'sourcePositions') p
    where d.type='system:pstoConclusion' and d.period_from='2026-09-05'`)
  // Unselected historical facts are indexed as usual, with an explicit manual
  // keep decision. Rebuilding repeat cycles must not overwrite the first one.
  // Seed through a fresh index build even in the second benchmark size: the
  // initialization flag from the first size must not leave raw fixture facts
  // without their historical document.
  await db.transaction(tx => indexes.rebuildSystemDocumentIndexInTransaction(tx, 'pstoConclusion'))
  // This disposable fixture grows from 200 to 200000 rows in one burst. Do not
  // let checksum joins inherit the first sample's statistics while waiting for
  // autovacuum; keep preparation outside the measured application operations.
  for (const table of ['weld_joints', 'psto_repeat_cycles', 'generated_documents', 'generated_document_weld_joints', 'line_programs']) {
    await client.query(`analyze ${table}`)
  }
}

async function facts() {
  const welds = (await client.query(`select md5(string_agg(md5((to_jsonb(w)-'heat_treatment_diagram'-'updated_at'-'psto_updated_at')::text),'' order by id)) as hash
    from weld_joints w where project_title=$1`, [project])).rows[0].hash
  const cycles = (await client.query(`select md5(string_agg(md5((to_jsonb(c)-'heat_treatment_diagram'-'updated_at')::text),'' order by c.id)) as hash
    from psto_repeat_cycles c join weld_joints w on w.id=c.weld_joint_id where w.project_title=$1`, [project])).rows[0].hash
  const positions = (await client.query(`select count(*)::int as count,md5(string_agg(p::text,'' order by (p->>'weldJointId')::int,(p->>'sequence')::int)) as hash
    from generated_documents d cross join lateral jsonb_array_elements(d.source_metadata::jsonb->'sourcePositions') p
    where d.type='system:pstoConclusion' and d.source_metadata::jsonb->>'sourceKind'='pstoCycle'
      and d.period_from='2026-09-05'`)).rows[0]
  const keptDocument = (await client.query(`select d.id,d.title,d.row_count,md5(string_agg(a.weld_joint_id::text,',' order by a.weld_joint_id)) as assignments
    from generated_documents d join generated_document_weld_joints a on a.document_id=d.id
    where d.type='system:pstoConclusion' and d.title='Первый цикл — сохранить' group by d.id`)).rows
  return { welds, cycles, positions, keptDocument }
}

// Exercise the production operation core and its actual lock/receipt protocol.
// HTTP serialization is covered separately by the UI load scenario.
async function apply(input: DocumentOperationRequest, preview: Awaited<ReturnType<typeof operations.previewOperation>>, rollback = false) {
  const payload = { ...input, fingerprint: preview.fingerprint, previewHash: preview.previewHash, operationId: randomUUID() }
  if (rollback) {
    await client.query(`create function benchmark_document_rollback() returns trigger language plpgsql as $$ begin raise exception 'BENCHMARK_ROLLBACK'; end $$`)
    await client.query('create trigger benchmark_document_rollback before insert on document_operation_receipts for each row execute function benchmark_document_rollback()')
  }
  try { return await operations.applyOperation(payload) }
  finally { if (rollback) { await client.query('drop trigger benchmark_document_rollback on document_operation_receipts'); await client.query('drop function benchmark_document_rollback()') } }
}

async function cleanup() {
  await client.query(`delete from generated_documents where id in (
    select a.document_id from generated_document_weld_joints a join weld_joints w on w.id=a.weld_joint_id where w.project_title=$1)`, [project])
  await client.query(`delete from weld_joint_program_states where weld_joint_id in (select id from weld_joints where project_title=$1)`, [project])
  await client.query('delete from weld_joints where project_title=$1', [project])
  await client.query('delete from line_programs where project_title=$1', [project])
}

try {
  for (const count of [200, 200_000]) {
    await seed(count)
    console.log(JSON.stringify({ phase: 'seeded', joints: count }))
    const before = await facts()
    assert.equal(before.positions.count, count)
    assert.equal(before.keptDocument.length, 1)
    assert.equal(before.keptDocument[0].row_count, count / 2)
    const selected = (await client.query(`select id from generated_documents where type='system:pstoConclusion' and period_from='2026-09-05' and source_metadata::jsonb->>'sourceKind'='pstoCycle' order by id`)).rows.map(row => row.id as number)
    const plan = await operations.planOperationBatches({ documentIds: selected, merge: false })
    assert.equal(plan.blocked.length, 0)
    let totalRebuilt = 0, totalAffected = 0, totalResulting = 0
    for (const [index, documentIds] of plan.batches.entries()) {
      const input: DocumentOperationRequest = { documentIds, action: 'split', mode: 'line', merge: false }
      const preview = await measure('preview', () => operations.previewOperation(input))
      const selectedRows = preview.result.rowCount
      const factReadBatches = Math.ceil(selectedRows / 5000) + Math.ceil(selectedRows / 2 / 5000)
      assert.ok(preview.queries <= 40 + factReadBatches + Math.ceil(count / 200 / 1000), 'Reads grow by bounded batches, not positions')
      console.log(JSON.stringify({ ...preview, result: undefined, joints: count, previewBytes: Buffer.byteLength(JSON.stringify(preview.result)) }))
      if (count === 200 && index === 0) {
        await assert.rejects(apply(input, preview.result, true))
        assert.deepEqual(await facts(), before)
      }
      const applied = await measure('apply', () => apply(input, preview.result))
      totalAffected += applied.result.affectedRowCount
      totalRebuilt += applied.result.changedDocumentCount
      totalResulting += applied.result.resultingDocumentCount
      assert.ok(applied.queries <= 160 + factReadBatches + 3 * Math.ceil(selectedRows / 5000) + Math.ceil(selectedRows / 1000) + Math.ceil(selectedRows / 2000), 'Writes grow by bounded batches, not positions')
      console.log(JSON.stringify({ ...applied, joints: count }))
    }
    assert.equal(totalAffected, count)
    assert.equal(totalRebuilt, count / 200)
    assert.equal(totalResulting, count / 100)
    assert.deepEqual(await facts(), before, 'Names may change; facts and exact cycle positions must not')
    // Stable retained IDs now name their first split group; no further split.
    for (const documentIds of plan.batches) {
      const next = await operations.previewOperation({ documentIds, action: 'split', mode: 'line', merge: false })
      assert.ok(next.groups.every(group => group.unchanged))
    }
    await cleanup()
  }
} finally {
  pg.Client.prototype.query = original
  await client.end()
  await (db as unknown as { $client: pg.Pool }).$client.end()
}
