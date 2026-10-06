import assert from 'node:assert/strict'
import pg from 'pg'
import { asc, sql } from 'drizzle-orm'
import { REQUEST_CONCLUSION_DEFAULT_SETTINGS } from '../src/lib/request-conclusion-settings'
import { buildCurrentSystemDocumentName } from '../src/lib/system-document-types'
import type { RebuildCursor } from '../src/lib/system-document-rebuild-batch'

// Run only after e2e/global-setup, in its disposable local database. The caller
// owns dropping that database; no production or working database is accepted.
const url = new URL(process.env.DATABASE_URL ?? '')
assert.equal(url.hostname, '127.0.0.1')
assert.equal(url.pathname, '/welding_tracker_e2e')
assert.equal(process.env.WELDING_ENV_LOADED, '1')
const [{ requireDb }, { weldJoints, pstoRepeatCycles }, rebuild, indexes, locks, sequences, { buildNumberArrayMatch }] = await Promise.all([
  import('../src/db/index'), import('../src/db/schema'), import('../src/server/system-document-rebuild'),
  import('../src/server/system-document-index'), import('../src/server/control-process-settings-lock'),
  import('../src/server/system-document-sequences'), import('../src/server/weld-request-utils'),
])
const { lockLayeredControlDocumentsForWeldChange } = await import('../src/server/layered-control-documents')
const { loadRebuildBatch, assertRebuildFactBudget } = await import('../src/server/system-document-rebuild-batch')
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

// Same locking/load/apply order as the RPC; authentication, index warming and
// HTTP serialization are outside this measurement. The transaction is real.
async function apply(preview: Awaited<ReturnType<typeof rebuild.loadRebuildSnapshot>>['preview'], rollback = false) {
  return db.transaction(async tx => {
    await locks.lockAllControlProcessSettings(tx)
    await tx.execute(sql`select pg_advisory_xact_lock_shared(hashtext('request-conclusion'))`)
    await sequences.lockSystemDocumentNumberCounter(tx, 'pstoConclusion')
    const batch = await loadRebuildBatch(tx, preview.batch!.cursor)
    const { rowIds: ids, cycleIds } = await rebuild.loadRebuildLockTargets(tx, ['pstoConclusion'], batch.documentIds)
    await assertRebuildFactBudget(tx, ids, cycleIds)
    await tx.select({ id: weldJoints.id }).from(weldJoints).where(buildNumberArrayMatch(weldJoints.id, ids)).orderBy(asc(weldJoints.id)).for('update')
    await tx.select({ id: pstoRepeatCycles.id }).from(pstoRepeatCycles).where(buildNumberArrayMatch(pstoRepeatCycles.id, cycleIds)).orderBy(asc(pstoRepeatCycles.id)).for('update')
    await lockLayeredControlDocumentsForWeldChange(tx)
    await indexes.lockSystemDocumentIndexes(tx)
    const lockedBatch = await loadRebuildBatch(tx, preview.batch!.cursor)
    assert.deepEqual(lockedBatch, batch)
    const snapshot = await rebuild.loadRebuildSnapshot(tx, lockedBatch)
    rebuild.assertRebuildLocksCoverSnapshot(snapshot.sources, ['pstoConclusion'], ids, cycleIds)
    assert.equal(snapshot.preview.fingerprint, preview.fingerprint)
    assert.equal(snapshot.preview.scopeRevisions.pstoConclusion, preview.scopeRevisions.pstoConclusion)
    const result = await rebuild.applyRebuildPlan({ tx, snapshot, templateIds: ['pstoConclusion'], decisions:
      snapshot.preview.documents.filter(document => document.requiresCustomNameDecision).map(document => ({ documentId: document.documentId, action: 'keep' as const })) })
    if (rollback) throw new Error('BENCHMARK_ROLLBACK')
    return result
  })
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
    // Match the real preview response: do not retain its full server-side
    // source rows throughout the subsequent save measurement.
    let cursor: RebuildCursor | undefined
    let totalRebuilt = 0, totalAffected = 0, totalResulting = 0
    do {
      const preview = await measure('preview', () => db.transaction(async tx =>
        (await rebuild.loadRebuildSnapshot(tx, await loadRebuildBatch(tx, cursor))).preview))
      const selectedRows = new Set(preview.result.documents.flatMap(document => document.groups.flatMap(group => group.rowIds))).size
      const factReadBatches = Math.ceil(selectedRows / 5000) + Math.ceil(selectedRows / 2 / 5000)
      assert.ok(preview.queries <= 30 + factReadBatches + Math.ceil(count / 200 / 1000),
        'Full facts are bounded by the packet; only compact global identities are paged')
      console.log(JSON.stringify({ ...preview, result: undefined, joints: count, previewBytes: Buffer.byteLength(JSON.stringify(preview.result)) }))
      if (count === 200 && !cursor) {
        await assert.rejects(apply(preview.result, true), /BENCHMARK_ROLLBACK/)
        assert.deepEqual(await facts(), before)
      }
      const applied = await measure('apply', () => apply(preview.result))
      totalAffected += applied.result.affectedRowCount
      totalRebuilt += applied.result.rebuiltDocumentCount
      totalResulting += applied.result.resultingDocumentCount
      assert.ok(applied.queries <= 120 + factReadBatches + 3 * Math.ceil(selectedRows / 5000) +
        Math.ceil(selectedRows / 1000) + Math.ceil(selectedRows / 2000) + Math.ceil(selectedRows / 100 / 100),
        'Apply queries grow with bounded write batches, not individual positions')
      console.log(JSON.stringify({ ...applied, joints: count }))
      cursor = preview.result.batch?.nextCursor ?? undefined
    } while (cursor)
    assert.equal(totalAffected, count)
    assert.equal(totalRebuilt, count / 200)
    assert.equal(totalResulting, count / 100)
    assert.deepEqual(await facts(), before, 'Names may change; facts and exact cycle positions must not')
    do {
      const next = await db.transaction(async tx => rebuild.loadRebuildSnapshot(tx, await loadRebuildBatch(tx, cursor)))
      assert.equal(next.preview.documents.filter(document => document.templateId === 'pstoConclusion' && document.willChangeAutomatically).length, 0)
      cursor = next.preview.batch?.nextCursor ?? undefined
    } while (cursor)
    await cleanup()
  }
} finally {
  pg.Client.prototype.query = original
  await client.end()
  await (db as unknown as { $client: pg.Pool }).$client.end()
}
