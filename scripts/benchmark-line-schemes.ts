import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import pg from 'pg'
import { assertSafeE2eDatabaseUrl, withE2eDatabase } from '../e2e/database'

assertSafeE2eDatabaseUrl(process.env.DATABASE_URL ?? '')
// Count only submissions made inside each measured operation. Fixture setup
// is outside those windows; this observer exists only in the isolated runner.
let statements = 0
const originalQuery = pg.Client.prototype.query
pg.Client.prototype.query = function (this: pg.Client, ...args: Parameters<typeof originalQuery>) {
  statements++
  return originalQuery.apply(this, args)
} as typeof originalQuery
const { requireDb, closeDatabase } = await import('../src/db')
const { readSchemeLines, readSchemeFilterOptions, readSchemeJoints, readSchemePointPage } = await import('../src/server/line-scheme-read')
const { openScheme, saveSchemePoints } = await import('../src/server/line-scheme-write')
const { runWithAccess, toAccessIdentity } = await import('../src/server/access-context')
const { authUsers, lineSchemePoints, weldJoints } = await import('../src/db/schema')
const { eq, asc } = await import('drizzle-orm')
const target = 'E2E scheme scale target', token = randomUUID(), revisionId = randomUUID()
let lineId = 0, bundleId = 0, pointId = ''
try {
  await withE2eDatabase(async client => {
    lineId = (await client.query("insert into line_programs(project_title,subtitle_code,line,psto_assignment) values ($1,'SC','target','unassigned') returning id", [target])).rows[0].id
    const joints = await client.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,officiality,revision_actuality,connection_type,weld_date,has_vik,psto_required)
      select $1,$2,'SC','target','S'||n,'действующий','актуальная','С',date '2026-11-01','Да','Нет' from generate_series(1,500) n returning id`, [lineId, target])
    await client.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id) select id,'primary',id from weld_joints where line_program_id=$1`, [lineId])
    bundleId = (await client.query("insert into line_scheme_bundles(line_program_id,project_title,subtitle_code,line,active_revision_id) values ($1,$2,'SC','target',$3) returning id", [lineId, target, revisionId])).rows[0].id
    await client.query(`insert into line_scheme_physicals(seed_node_id,last_label,last_line_program_id) select id,joint,$1 from weld_joints where line_program_id=$1`, [lineId])
    await client.query(`insert into line_scheme_members(weld_joint_id,physical_id) select seed_node_id,id from line_scheme_physicals where last_line_program_id=$1`, [lineId])
    // Metadata/read benchmark: these fixtures do not pretend to be PDF byte files.
    for (let version = 0; version < 21; version++) {
      const id = version === 0 ? revisionId : randomUUID(), key = `${randomUUID()}.pdf`
      await client.query("insert into line_scheme_files(key,state) values ($1,'ready')", [key])
      await client.query("insert into line_scheme_revisions(id,bundle_id,file_key,file_name,size,page_count,author_id,author_name) values ($1,$2,$3,$4,1000,4,'fixture','Fixture')", [id, bundleId, key, `Revision ${version}.pdf`])
      await client.query(`insert into line_scheme_points(id,revision_id,physical_id,page,x,y)
        select md5($1||id::text)::uuid::text,$1,id,1,((row_number() over(order by id)-1)%25+0.5)/25.0,((row_number() over(order by id)-1)/25+0.5)/20.0
        from line_scheme_physicals where last_line_program_id=$2`, [id, lineId])
    }
    pointId = (await client.query('select id from line_scheme_points where revision_id=$1 order by id limit 1', [revisionId])).rows[0].id
    assert.equal(joints.rowCount, 500)
  })
  const measure = async (run: () => Promise<unknown>) => {
    const values: number[] = [], sqlStatements: number[] = []
    for (let i = 0; i < 4; i++) {
      const before = statements, start = performance.now()
      await run()
      values.push(Math.round(performance.now() - start)); sqlStatements.push(statements - before)
    }
    return { firstMs: values[0], repeatMs: values.slice(1), sqlStatements }
  }
  const reads = async (total = 500) => ({
    list: await measure(async () => { const data = await readSchemeLines({ search: target }); assert.equal(data.rows[0].total, total) }),
    joints: await measure(async () => { const data = await readSchemeJoints({ bundleId, revisionId }); assert.equal(data.rows.length, 50) }),
    points: await measure(async () => { const data = await readSchemePointPage({ revisionId, page: 1 }); assert.equal(data.points.length, 500); assert.equal(data.next, null) }),
  })
  const small = await reads()
  await withE2eDatabase(async client => {
    await client.query(`insert into line_programs(project_title,subtitle_code,line,psto_assignment) select 'E2E scheme scale others','SC','other-'||n,'unassigned' from generate_series(1,399) n`)
    await client.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,officiality,revision_actuality,connection_type,weld_date,has_vik,psto_required)
      select l.id,l.project_title,l.subtitle_code,l.line,'S'||n,'действующий','актуальная','С',date '2026-11-01','Да','Нет' from line_programs l cross join generate_series(1,500) n where l.project_title='E2E scheme scale others'`)
    await client.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id) select id,'primary',id from weld_joints where project_title='E2E scheme scale others'`)
    assert.equal(Number((await client.query("select count(*) from weld_joints where project_title like 'E2E scheme scale %'")).rows[0].count), 200000)
    await client.query('analyze weld_joints'); await client.query('analyze weld_joint_program_states')
  })
  const large = await reads()
  for (const key of ['list', 'joints', 'points'] as const) {
    assert.deepEqual(large[key].sqlStatements, small[key].sqlStatements, `${key}: unrelated joints must not increase SQL count`)
  }
  const registry = {
    firstPage: await measure(async () => { const data = await readSchemeLines({ search: 'E2E scheme scale' }); assert.equal(data.total, 400); assert.equal(data.rows.length, 50) }),
    lastPage: await measure(async () => { const data = await readSchemeLines({ search: 'E2E scheme scale', page: 7 }); assert.equal(data.total, 400); assert.equal(data.rows.length, 50) }),
    globalFilter: await measure(async () => {
      const data = await readSchemeFilterOptions({ search: 'E2E scheme scale', field: 'line', valueSearch: 'other-399' })
      assert.deepEqual(data.options, [{ value: 'other-399', label: 'other-399', count: 1 }])
    }),
  }
  await withE2eDatabase(async client => {
    await client.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,officiality,revision_actuality,connection_type,weld_date,has_vik,psto_required)
      select $1,$2,'SC','target','S'||n,'действующий','актуальная','С',date '2026-11-01','Да','Нет' from generate_series(501,20000) n`, [lineId, target])
    await client.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id) select id,'primary',id from weld_joints where line_program_id=$1 on conflict do nothing`, [lineId])
    await client.query('analyze weld_joints'); await client.query('analyze weld_joint_program_states')
  })
  const largeSingleLine = await reads(20000), [owner] = await requireDb().select().from(authUsers).where(eq(authUsers.role, 'owner'))
  const saves = await runWithAccess(toAccessIdentity(owner), 'scheme-benchmark', [], async () => {
    const opened = await openScheme({ lineId, token }); let version = 1
    const onePoint = await measure(async () => { const result = await saveSchemePoints({ bundleId, token, version: opened.bundle!.version, operationId: randomUUID(), revisionId, revisionVersion: version,
      changes: { upsert: [{ id: pointId, page: 1, x: version % 2 ? .25 : .75, y: .3 }], remove: [] } }); version = result.revisionVersion })
    const existing = await requireDb().select({ id: lineSchemePoints.id }).from(lineSchemePoints).where(eq(lineSchemePoints.revisionId, revisionId))
    const move500Points = await measure(async () => { const result = await saveSchemePoints({ bundleId, token, version: opened.bundle!.version, operationId: randomUUID(), revisionId, revisionVersion: version,
      changes: { upsert: existing.map(point => ({ ...point, page: 1, x: .25, y: version % 2 ? .2 : .8 })), remove: [] } }); version = result.revisionVersion })
    const next = await requireDb().select({ rootId: weldJoints.id }).from(weldJoints).where(eq(weldJoints.lineProgramId, lineId)).orderBy(asc(weldJoints.id)).offset(500).limit(500)
    const start = performance.now()
    await saveSchemePoints({ bundleId, token, version: opened.bundle!.version, operationId: randomUUID(), revisionId, revisionVersion: version,
      changes: { upsert: next.map(point => ({ ...point, id: randomUUID(), page: 2, x: .2, y: .3 })), remove: [] } })
    return { onePoint, move500Points, add500PointsMs: Math.round(performance.now() - start) }
  })
  console.log(JSON.stringify({ scale: { joints: 200000, lines: 400, targetLine: 500, visiblePagePoints: 500, archivedRevisions: 20, totalMarkers: 10500, finalLargeLine: 20000, finalJoints: 219500 }, small, large, registry, largeSingleLine, saves }))
} finally { await closeDatabase(); pg.Client.prototype.query = originalQuery }
