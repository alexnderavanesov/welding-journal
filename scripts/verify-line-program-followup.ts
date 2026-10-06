import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import pg from 'pg'
import { eq, sql } from 'drizzle-orm'

const database = 'welding_tracker_program_followup_20260929'
const url = `postgresql://welding:welding@127.0.0.1:5432/${database}`
assert.equal(new URL(url).hostname, '127.0.0.1')
assert.equal(spawnSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).stdout.trim(), 'main')
const admin = new pg.Client({ connectionString: 'postgresql://welding:welding@127.0.0.1:5432/postgres' })
let owned = false, pool: pg.Pool | undefined
const original = pg.Client.prototype.query
let statements = 0
let queryMilliseconds = 0
await admin.connect()
try {
  assert.equal((await admin.query('select 1 from pg_database where datname=$1', [database])).rowCount, 0, 'Refuse existing database')
  await admin.query('create database welding_tracker_program_followup_20260929'); owned = true
  const empty = new pg.Client({ connectionString: url }); await empty.connect()
  assert.equal(Number((await empty.query("select count(*) from information_schema.tables where table_schema='public'")).rows[0].count), 0)
  await empty.end()
  process.env.DATABASE_URL = url; process.env.WELDING_ENV_LOADED = '1'
  const migration = spawnSync('pnpm', ['db:migrate'], { env: process.env, encoding: 'utf8' })
  assert.equal(migration.status, 0, migration.stderr || migration.stdout)
  const [{ requireDb }, schema, { loadLineProgramReport }, { loadScopedAcceptedWarningKeys }, { changeProgramApprovalsInTransaction }, { loadProgramApprovals }, { programApprovalKey }, { programApprovalVersion }, { WELD_TABLE_SELECT }, { findCurrentDispatcherTask }, { serializeDispatcherTaskIndexPayload }, { getDispatcherScopeKey }] = await Promise.all([
    import('../src/db'), import('../src/db/schema'), import('../src/server/line-program-report'), import('../src/server/accepted-warning-scope'), import('../src/server/line-program-approvals'), import('../src/server/program-approval-lifecycle'), import('../src/lib/program-control-approval'), import('../src/lib/program-approval-actions'), import('../src/server/weld-server-shared'), import('../src/server/dispatcher-warnings'), import('../src/lib/dispatcher-task-index-payload'), import('../src/server/dispatcher-task-index'),
  ])
  const db = requireDb(); pool = (db as unknown as { $client: pg.Pool }).$client
  const { linePrograms, weldJoints, dispatcherAcceptedWarnings: warnings, dispatcherTaskPages, dispatcherTaskIndexState } = schema
  await db.execute(sql`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
    select 'LOAD','S','L'||n,'II','A',30,10 from generate_series(1,1000) n`)
  await db.execute(sql`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,weld_date,connection_type,stamp_1_k,has_rk,has_vik)
    select p.id,p.project_title,p.subtitle_code,p.line,'F'||n,'2026-09-01','С17','K'||((n-1)/50),'да','да' from line_programs p cross join generate_series(1,200) n`)
  await db.execute(sql`insert into dispatcher_accepted_warnings(key,kind,weld_joint_id)
    select 'load-warning:'||id,'check',id from weld_joints`)
  await db.execute(sql`analyze dispatcher_accepted_warnings`)
  const programs = await db.select().from(linePrograms)
  const sample = await db.select({ id: weldJoints.id, lineProgramId: weldJoints.lineProgramId }).from(weldJoints).where(eq(weldJoints.lineProgramId, programs[0].id))
  pg.Client.prototype.query = function (this: unknown, ...args: unknown[]) {
    statements++
    const started = performance.now()
    const callback = args.at(-1)
    if (typeof callback === 'function') args[args.length - 1] = (...values: unknown[]) => {
      queryMilliseconds += performance.now() - started
      return callback(...values)
    }
    const result = (original as (...args: unknown[]) => unknown).apply(this, args)
    if (typeof callback !== 'function' && result instanceof Promise) void result.then(() => { queryMilliseconds += performance.now() - started }, () => {})
    return result
  } as typeof original
  let started = performance.now(); statements = 0
  const scoped = await loadScopedAcceptedWarningKeys(db, sample)
  assert.equal(scoped.length, 200); assert.equal(statements, 1)
  console.log(JSON.stringify({ check: 'scoped decisions', registry: 200000, returned: scoped.length, queries: statements, milliseconds: Math.round(performance.now() - started), bytes: Buffer.byteLength(JSON.stringify(scoped)) }))
  const counts: number[] = []
  for (const count of [1, 1000]) {
    statements = 0; queryMilliseconds = 0; started = performance.now()
    const report = await loadLineProgramReport(db, { ids: programs.slice(0, count).map(line => line.id), mode: 'stamps', context: 'Synthetic benchmark' })
    assert.equal(report.metrics?.[1].value, String(count * 200))
    counts.push(statements)
    console.log(JSON.stringify({ check: 'stamp report', lines: count, joints: count * 200, queries: statements, milliseconds: Math.round(performance.now() - started), queryMilliseconds: Math.round(queryMilliseconds), bytes: Buffer.byteLength(JSON.stringify(report)) }))
  }
  // Registry + joints + stable chain state + pre-TO + duplicate results + repeat
  // cycles + process settings + system indexes + approvals + welder names.
  // The two new reads supply required identity/history, not per-row queries.
  assert.equal(counts[0], counts[1], 'No per-line SQL'); assert(counts[1] <= 10)
  pg.Client.prototype.query = original
  // A targeted restoration must stay scoped with 200k persistent identities,
  // including deleted coil nodes. Nothing in this block touches another DB.
  await db.execute(sql`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id)
    select id,'primary',id from weld_joints`)
  const rootId = sample[0].id
  const coils = await db.insert(weldJoints).values([1, 2].map(side => ({ projectTitle: programs[0].projectTitle,
    subtitleCode: programs[0].subtitleCode, line: programs[0].line, lineProgramId: programs[0].id, joint: `F1Y${side}` }))).returning({ id: weldJoints.id })
  await db.insert(schema.weldJointProgramStates).values(coils.map((coil, index) => ({ weldJointId: coil.id, kind: 'coil', physicalRootId: coil.id,
    sourceRowId: rootId, coilParentId: rootId, coilSide: index + 1 })))
  await db.update(schema.weldJointProgramStates).set({ replacedByCoil: true, replacementCoilIds: coils.map(row => row.id) }).where(eq(schema.weldJointProgramStates.weldJointId, rootId))
  await db.update(weldJoints).set({ vikResult: 'годен', rkResult: 'годен' }).where(eq(weldJoints.id, rootId))
  await db.execute(sql`delete from weld_joints where id = any(${sql.param(coils.map(row => row.id))}::int[])`)
  await db.execute(sql`analyze weld_joint_program_states`)
  const { previewCoilRestorationInTransaction, loadCoilRestorationGraph } = await import('../src/server/coil-restoration')
  assert.equal((await loadCoilRestorationGraph(db, rootId)).length, 3)
  statements = 0; started = performance.now()
  pg.Client.prototype.query = function (this: unknown, ...args: unknown[]) { statements++; return (original as (...args: unknown[]) => unknown).apply(this, args) } as typeof original
  const restoration = await db.transaction(tx => previewCoilRestorationInTransaction(tx, rootId))
  assert.equal(restoration.reason, null)
  assert.equal(restoration.before.joints, 199); assert.equal(restoration.after.joints, 200)
  assert(statements <= 20, `Restoration query budget: ${statements}`)
  console.log(JSON.stringify({ check: 'restoration preview', registry: 200000, scopedJoints: 200, queries: statements, milliseconds: Math.round(performance.now() - started) }))
  pg.Client.prototype.query = original
  await db.transaction(async tx => {
    const [line] = await tx.insert(linePrograms).values({ projectTitle: 'DECISION', subtitleCode: 'S', line: 'L', category: 'II', groupName: 'A', weldControlPercent: 30, pvkControlPercent: 10 }).returning()
    const [joint] = await tx.insert(weldJoints).values({ lineProgramId: line.id, projectTitle: line.projectTitle, subtitleCode: line.subtitleCode, line: line.line, joint: 'F1', connectionType: 'С17', weldDate: '2026-09-01', stamp1K: 'K', hasRk: 'да', hasUzk: 'да', hasPvk: 'да', rkResult: 'годен', rkConclusion: 'KEEP', uzkResult: 'годен', uzkConclusion: 'KEEP-2' }).returning()
    const [row] = await tx.select(WELD_TABLE_SELECT).from(weldJoints).where(eq(weldJoints.id, joint.id))
    const key = programApprovalKey(row, 'common', true), pvkKey = programApprovalKey(row, 'pvk', false)
    const request = { lineId: line.id, lineVersion: line.updatedAt.toISOString(), action: 'approve' as const, confirmed: true, keys: [key], targets: [{ id: row.id, version: row.rowVersion, approvalVersion: '[]' }] }
    await changeProgramApprovalsInTransaction(tx, request)
    await assert.rejects(tx.transaction(nested => changeProgramApprovalsInTransaction(nested, request)), /Согласования изменились/)
    const [after] = await tx.select().from(weldJoints).where(eq(weldJoints.id, row.id))
    assert.deepEqual(after, joint, 'Decision must not touch any joint field or timestamp')
    await tx.insert(warnings).values({ key: pvkKey, weldJointId: row.id, kind: 'line-program-control' })
    const approvals = await loadProgramApprovals(tx, [row.id])
    const revoke = { ...request, action: 'revoke' as const, targets: [{ ...request.targets[0], approvalVersion: programApprovalVersion(approvals) }] }
    await changeProgramApprovalsInTransaction(tx, revoke)
    assert.deepEqual((await loadProgramApprovals(tx, [row.id])).map(item => item.key), [pvkKey], 'Unrelated PVK approval retained')
    await assert.rejects(tx.transaction(nested => changeProgramApprovalsInTransaction(nested, { ...request, targets: [{ ...request.targets[0], version: 'stale' }] })), /изменен|устарели/)
    const state = (await tx.select().from(dispatcherTaskIndexState))[0]
    assert.equal(state.fullRebuild, false); assert.match(state.dirtyScopes, /DECISION/)
    // Card 5001 is deliberately outside the compact snapshot, but is present in its indexed scope.
    const task = { key: 'outside-first-5000', kind: 'check', row: { id: row.id }, description: 'test' }
    const scopeKey = getDispatcherScopeKey(line)
    await tx.insert(dispatcherTaskPages).values({ scopeKey, pageNumber: 50, taskCount: 1, tasks: JSON.stringify([task]) })
    const fresh = { ...state, fullRebuild: false, sourceRevision: 7, computedRevision: 7, repeatedTasks: serializeDispatcherTaskIndexPayload([], [], { totalTaskCount: 5001, totalPageCount: 51, tasksTruncated: true }) }
    assert.equal((await findCurrentDispatcherTask(tx, task.key, fresh, line))?.key, task.key)
    assert.equal(await findCurrentDispatcherTask(tx, task.key, { ...fresh, sourceRevision: 8 }, line), undefined)
    assert.equal(await findCurrentDispatcherTask(tx, task.key, fresh, { line: 'wrong' }), undefined)
  })
  console.log('Approval concurrency, independent PVK, unchanged history and task beyond snapshot: passed')
  // A stamp-only decision dirties no joint scope. Preserve existing task pages,
  // rather than treating an empty scope list as a request for a full rebuild.
  const { ensureDispatcherTaskIndexFresh } = await import('../src/server/dispatcher-task-index')
  const pagesBefore = await db.select().from(dispatcherTaskPages)
  await db.update(dispatcherTaskIndexState).set({ sourceRevision: 100, computedRevision: 99, fullRebuild: false, dirtyScopes: '[]', computedAt: new Date(),
    repeatedTasks: serializeDispatcherTaskIndexPayload([], [], { totalTaskCount: 1, totalPageCount: 1, tasksTruncated: true }) })
  const refreshed = await ensureDispatcherTaskIndexFresh()
  assert.equal(refreshed.sourceRevision, refreshed.computedRevision)
  assert.deepEqual(await db.select().from(dispatcherTaskPages), pagesBefore)
  console.log('Empty scoped refresh preserves unrelated task pages: passed')
} finally {
  pg.Client.prototype.query = original
  await pool?.end()
  if (owned) await admin.query('drop database welding_tracker_program_followup_20260929 with (force)')
  await admin.end()
}
