import assert from 'node:assert/strict'
import pg from 'pg'
import prepareE2eDatabase from '../e2e/global-setup'
import { dropE2eDatabase, E2E_ADMIN_DATABASE_URL, E2E_DATABASE_URL } from '../e2e/database'

assert.equal(process.env.DATABASE_URL, E2E_DATABASE_URL)
assert.equal(process.env.WELDING_ENV_LOADED, '1')
const admin = new pg.Client({ connectionString: E2E_ADMIN_DATABASE_URL })
await admin.connect()
try {
  assert.equal((await admin.query('select datname from pg_database where datname=$1', ['welding_tracker_e2e'])).rowCount, 0,
    'The disposable database must be absent; do not replace a running test database')
} finally { await admin.end() }
await prepareE2eDatabase()
const client = new pg.Client({ connectionString: E2E_DATABASE_URL })
await client.connect()
const { requireDb } = await import('../src/db/index')
const { listLnkWorkflowRows } = await import('../src/server/lnk-workflow-context')
const project = 'E2E PRE registry load'
const original = pg.Client.prototype.query
let queries = 0, metadataBytes = 0
const counts: number[] = []
try {
  for (const count of [200, 200_000]) {
    assert.equal((await client.query('select count(*)::int as n from weld_joints where project_title=$1', [project])).rows[0].n, 0)
    await client.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,connection_type,has_vik,officiality,revision_actuality)
      select $1,'PRELOAD','PRELOAD-L1','S'||lpad(n::text,6,'0'),'2026-09-01','С17','да','действующий','актуальная'
      from generate_series(1,$2::int) n`, [project, count])
    await client.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,result,conclusion_name,conclusion_date)
      select id,'ВИК','PRE-R','2026-09-01','годен','PRE-C','2026-09-02' from weld_joints where project_title=$1`, [project])
    const document = (await client.query(`insert into generated_documents(type,title,file_name,mime_type,period_from,period_to,row_count,source_metadata)
      select 'system:lnkConclusionVik','PRE-C','load.xlsx','application/octet-stream','2026-09-02','2026-09-02',count(*)::int,
        jsonb_build_object('sourceKind','beforeHeatTreatment','sourcePositions',jsonb_agg(jsonb_build_object(
          'kind','beforeHeatTreatment','weldJointId',w.id,'relationId',p.id,'methodCode','ВИК')))::text
      from pre_heat_treatment_controls p join weld_joints w on w.id=p.weld_joint_id where w.project_title=$1 returning id`, [project])).rows[0].id
    await client.query('insert into generated_document_weld_joints(document_id,weld_joint_id) select $1,id from weld_joints where project_title=$2', [document, project])
    await client.query('analyze weld_joints')
    await client.query('analyze pre_heat_treatment_controls')
    await client.query('analyze generated_document_weld_joints')
    const stored = (await client.query('select octet_length(source_metadata)::int as bytes,md5(source_metadata) as hash from generated_documents where id=$1', [document])).rows[0]
    for (const offset of [0, count - 50]) {
      queries = 0; metadataBytes = 0
      pg.Client.prototype.query = function (this: unknown, ...args: unknown[]) {
        queries++
        const record = (result: pg.QueryResult) => {
          const metadataIndex = result.fields?.findIndex(field => field.name === 'source_metadata') ?? -1
          for (const row of result.rows ?? []) {
            const metadata = Array.isArray(row) ? row[metadataIndex] : row.sourceMetadata ?? row.source_metadata
            if (typeof metadata === 'string') metadataBytes += Buffer.byteLength(metadata)
          }
          return result
        }
        // Pool.query uses the callback overload internally. Preserve it;
        // treating its void return as a Promise can double-release a client.
        const callback = args.at(-1)
        if (typeof callback === 'function') {
          args[args.length - 1] = (error: Error | null, result: pg.QueryResult) => {
            if (!error && result) record(result)
            callback(error, result)
          }
          return (original as (...args: unknown[]) => unknown).apply(this, args)
        }
        const pending = (original as (...args: unknown[]) => Promise<pg.QueryResult>).apply(this, args)
        return pending.then(record)
      } as typeof original
      const start = performance.now()
      let rows
      try {
        rows = await listLnkWorkflowRows({ scope: 'preHeatTreatmentResultRegistry', search: project, offset })
      } finally { pg.Client.prototype.query = original }
      assert.equal(rows.length, offset === 0 ? 51 : 50)
      assert.equal(rows[0].joint, `S${String(offset + 1).padStart(6, '0')}`)
      assert.ok(rows.every(row => row.systemDocumentIds?.preVikConclusion === document))
      assert.equal(metadataBytes, stored.bytes, 'Shared source metadata must cross the database connection only once per document')
      assert.ok(queries <= 10, 'Registry SQL count must remain bounded')
      counts.push(queries)
      console.log(JSON.stringify({ joints: count, offset, queries, milliseconds: Math.round(performance.now() - start),
        responseBytes: Buffer.byteLength(JSON.stringify(rows)), documentMetadataBytes: metadataBytes,
        rssMiB: Math.round(process.memoryUsage().rss / 1024 / 1024) }))
    }
    assert.equal((await client.query('select md5(source_metadata) as hash from generated_documents where id=$1', [document])).rows[0].hash, stored.hash)
    const selected = await listLnkWorkflowRows({ scope: 'preHeatTreatmentRequestRegistry', search: `S${String(count).padStart(6, '0')}`, requestFilter: 'fixed', methodKeys: ['vikRequest'] })
    assert.equal(selected.length, 1)
    const open = await listLnkWorkflowRows({ scope: 'preHeatTreatmentRequestRegistry', search: project, requestFilter: 'open' })
    assert.equal(open.length, 0)
    await client.query('delete from generated_documents where id=$1', [document])
    await client.query('delete from weld_joints where project_title=$1', [project])
  }
  assert.equal(new Set(counts).size, 1, 'Query count must not grow with the journal or the selected page')
} finally {
  pg.Client.prototype.query = original
  await client.end()
  await (requireDb() as unknown as { $client: pg.Pool }).$client.end()
  await dropE2eDatabase()
}
