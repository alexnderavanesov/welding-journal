import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import pg from 'pg'
import { eq, sql } from 'drizzle-orm'

const database = 'welding_tracker_exception_objects_20260929'
const url = `postgresql://welding:welding@127.0.0.1:5432/${database}`
assert.equal(new URL(url).hostname, '127.0.0.1')
assert.equal(spawnSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).stdout.trim(), 'main')
const admin = new pg.Client({ connectionString: 'postgresql://welding:welding@127.0.0.1:5432/postgres' })
let owned = false
let pool: pg.Pool | undefined
await admin.connect()
try {
  assert.equal((await admin.query('select 1 from pg_database where datname=$1', [database])).rowCount, 0, 'Refuse any existing database')
  await admin.query('create database welding_tracker_exception_objects_20260929')
  owned = true
  const empty = new pg.Client({ connectionString: url })
  await empty.connect()
  assert.equal(Number((await empty.query("select count(*) from information_schema.tables where table_schema='public'")).rows[0].count), 0)
  await empty.end()
  process.env.DATABASE_URL = url
  process.env.WELDING_ENV_LOADED = '1'
  const migrate = spawnSync('pnpm', ['db:migrate'], { env: process.env, encoding: 'utf8' })
  assert.equal(migrate.status, 0, migrate.stderr || migrate.stdout)
  const [{ requireDb }, schema, { backfillAcceptedWarningObjects }, { acceptedWarningContextSql }, { persistWelderStampObjects, toWelderStampPayload }, { programApprovalKey }, { saveLineProgramInTransaction, toLineProgramRecord }, { deleteChangedProgramApprovals }, { calculateLineProgram }, { summarizeLineProgram }] = await Promise.all([
    import('../src/db/index'), import('../src/db/schema'), import('../src/server/accepted-warning-backfill'), import('../src/server/accepted-warning-objects'),
    import('../src/server/welder-stamps'), import('../src/lib/program-control-approval'), import('../src/server/line-program'), import('../src/server/program-approval-lifecycle'), import('../src/lib/line-program-calculation'), import('../src/lib/line-program-overview'),
  ])
  const { dispatcherAcceptedWarnings: warnings, linePrograms, weldJoints, welderStamps } = schema
  const db = requireDb()
  pool = (db as unknown as { $client: pg.Pool }).$client
  await db.transaction(async tx => {
    const [line] = await tx.insert(linePrograms).values({ projectTitle: 'P', subtitleCode: 'S', line: 'L1', category: 'II', groupName: 'A', weldControlPercent: 30, pvkControlPercent: 10 }).returning()
    const [joint] = await tx.insert(weldJoints).values({ lineProgramId: line.id, projectTitle: 'P', subtitleCode: 'S', line: 'L1', joint: 'F1', category: 'II', groupName: 'A', weldControlPercent: 30, pvkControlPercent: 10, connectionType: 'С17', stamp1K: 'K1', weldDate: '2026-09-01', hasRk: 'да', hasUzk: 'да', rkResult: 'годен', rkConclusion: 'RK-1', uzkResult: 'годен', uzkConclusion: 'UZK-1' }).returning()
    const [stamp] = await tx.insert(welderStamps).values({ naksStamp: 'K1' }).returning()
    const legacy = (percent: number) => 'line-program-excess:' + JSON.stringify([line.id, 'k1', 'common', true, joint.id, percent, 1, ['да', 'да', '', '']])
    await tx.insert(warnings).values([
      { key: legacy(30), kind: 'line-program-control', context: 'Проект: P · Шифр: S · Линия: L1 · Стык ID 1 · РК - УЗК' },
      { key: legacy(100), kind: 'line-program-control' },
      { key: 'early-coil:999999999', kind: 'early-coil' },
      { key: 'legacy-named-check', kind: 'check', context: 'Проект: P · Шифр: S · Линия: L1 · Стык: F1' },
    ])
    const preview = await backfillAcceptedWarningObjects(tx)
    assert.equal(preview.linked, 3); assert.equal(preview.removedOrphans, 1)
    assert.equal((await tx.select().from(warnings)).length, 4, 'Preview must be read-only')
    const converted = await backfillAcceptedWarningObjects(tx, true)
    assert.equal(converted.unresolved.length, 0)
    const key = programApprovalKey(joint, 'common', true)
    assert.equal((await tx.select().from(warnings).where(eq(warnings.key, 'legacy-named-check')))[0].weldJointId, joint.id)
    await tx.delete(warnings).where(eq(warnings.key, 'legacy-named-check'))
    assert.deepEqual((await tx.select().from(warnings)).map(row => [row.key, row.weldJointId]), [[key, joint.id]])
    assert.equal((await backfillAcceptedWarningObjects(tx, true)).examined, 0)
    // Ambiguous old data cancels the entire conversion, including earlier pages/rows.
    await tx.insert(warnings).values([
      { key: 'early-coil:999999998', kind: 'early-coil' },
      { key: 'unknown-legacy-object', kind: 'unknown' },
    ])
    await assert.rejects(tx.transaction(nested => backfillAcceptedWarningObjects(nested, true)), /Перенос отменён/)
    assert.equal((await tx.select().from(warnings)).length, 3)
    await tx.delete(warnings).where(sql`${warnings.key} in ('early-coil:999999998', 'unknown-legacy-object')`)
    let current = toLineProgramRecord(line)
    for (const percent of [50, 100, 50, 30]) {
      current = await saveLineProgramInTransaction(tx, { ...current, weldControlPercent: percent })
      const [saved] = await tx.select().from(weldJoints).where(eq(weldJoints.id, joint.id))
      const accepted = new Set((await tx.select({ key: warnings.key }).from(warnings)).map(row => row.key))
      assert.equal(summarizeLineProgram([saved], current, accepted, calculateLineProgram([saved], percent, 10)).common?.excess, 0)
      assert.equal(saved.rkConclusion, 'RK-1'); assert.equal(saved.uzkConclusion, 'UZK-1')
    }
    current = await saveLineProgramInTransaction(tx, { ...current, line: 'RENAMED' })
    await tx.update(weldJoints).set({ joint: 'F77' }).where(eq(weldJoints.id, joint.id))
    const contexts = () => tx.select({ context: acceptedWarningContextSql }).from(warnings)
      .leftJoin(weldJoints, eq(weldJoints.id, warnings.weldJointId)).leftJoin(linePrograms, eq(linePrograms.id, warnings.lineProgramId)).leftJoin(welderStamps, eq(welderStamps.id, warnings.welderStampId))
    assert.match((await contexts())[0].context, /Линия: RENAMED · Стык: F77/)
    assert.equal((await tx.select().from(warnings))[0].key, key)
    const percentageKey = 'percentage-line-control:new-welder:' + JSON.stringify([JSON.stringify(['p', 's', 'renamed']), 'k1'])
    await tx.insert(warnings).values({ key: percentageKey, kind: 'percentage-line-control', lineProgramId: line.id, welderStampId: stamp.id })
    await tx.insert(warnings).values({ key: `welder-stamp-expiry:naks:${stamp.id}:K1:permit:2026-01-01`, kind: 'welder-stamp-expiry', welderStampId: stamp.id, context: 'Клеймо: K1 · Допуск: НАКС · Действует до: 2026-01-01' })
    const payload = { ...toWelderStampPayload(stamp), naksStamp: 'K2' }
    await persistWelderStampObjects(tx, [stamp], [payload])
    assert.equal((await tx.select().from(warnings)).length, 3, 'Saving/renaming registry must preserve decisions')
    assert((await tx.select().from(warnings)).some(row => row.key === `welder-stamp-expiry:naks:${stamp.id}:K2:permit:2026-01-01`))
    assert((await contexts()).some(row => row.context.includes('Клеймо: K2')))
    const [newStamp] = await tx.select().from(welderStamps)
    await persistWelderStampObjects(tx, [newStamp], [])
    assert.equal((await tx.select().from(warnings)).length, 1, 'Deleting stamp removes only its decisions')
    await tx.update(weldJoints).set({ hasPvk: 'да' }).where(eq(weldJoints.id, joint.id))
    const [saved] = await tx.select().from(weldJoints).where(eq(weldJoints.id, joint.id))
    const independentKey = programApprovalKey({ ...saved, hasPvk: 'да' }, 'pvk', false)
    await tx.insert(warnings).values({ key: independentKey, kind: 'line-program-control', weldJointId: joint.id })
    await deleteChangedProgramApprovals(tx, [{ ...saved, hasUzk: 'отменен' }], new Map([[saved.id, saved]]))
    assert.deepEqual((await tx.select().from(warnings)).map(row => row.key), [independentKey], 'Cancelling RK/UZK preserves independent PVK decision')
    await tx.insert(warnings).values({ key, kind: 'line-program-control', weldJointId: joint.id })
    await tx.delete(weldJoints).where(eq(weldJoints.id, joint.id))
    assert.equal((await tx.select().from(warnings)).length, 0, 'Joint FK cascade')
    await tx.insert(warnings).values({ key: 'line-owned', kind: 'percentage-line-control', lineProgramId: line.id })
    await tx.delete(linePrograms).where(eq(linePrograms.id, line.id))
    assert.equal((await tx.select().from(warnings)).length, 0, 'Line FK cascade')
  })
  const originalQuery = pg.Client.prototype.query
  let queries = 0
  pg.Client.prototype.query = function (this: unknown, ...args: unknown[]) {
    queries++
    return (originalQuery as (...args: unknown[]) => unknown).apply(this, args)
  } as typeof originalQuery
  const backfillQueries: number[] = []
  try {
    for (const size of [1, 1200]) await db.transaction(async tx => {
      const [line] = await tx.insert(linePrograms).values({ projectTitle: 'Batch', subtitleCode: 'S', line: 'L' }).returning()
      const [stamp] = await tx.insert(welderStamps).values({ naksStamp: 'BATCH-K' }).returning()
      const prefix = 'percentage-line-control:excess:' + JSON.stringify([JSON.stringify(['batch', 's', 'l']), 'batch-k']) + ':'
      await tx.execute(sql`insert into dispatcher_accepted_warnings (key, kind) select ${prefix} || n, 'percentage-line-control' from generate_series(1, ${size}) n`)
      const before = queries
      const result = await backfillAcceptedWarningObjects(tx, true)
      backfillQueries.push(queries - before)
      assert.equal(result.linked, size)
      assert.equal(result.unresolved.length, 0)
      assert.equal(queries - before, 2 * Math.ceil(size / 500) + 4, 'Registry reads once; decisions transferred per page, never per row')
      await tx.delete(linePrograms).where(eq(linePrograms.id, line.id))
      await tx.delete(welderStamps).where(eq(welderStamps.id, stamp.id))
    })
  } finally {
    pg.Client.prototype.query = originalQuery
  }
  // Scale: synthetic joints and decisions; bounded indexed owner lookup, not UI timing.
  await db.execute(sql`insert into weld_joints (joint, has_rk, has_uzk) select 'LOAD-'||n, 'да', 'да' from generate_series(1, 200000) n`)
  await db.execute(sql`insert into dispatcher_accepted_warnings (key, kind, weld_joint_id) select 'load:'||id, 'line-program-control', id from weld_joints where joint like 'LOAD-%'`)
  await db.execute(sql`analyze dispatcher_accepted_warnings`)
  const [sample] = await db.select({ id: weldJoints.id }).from(weldJoints).limit(1)
  const start = performance.now()
  assert.equal((await db.select({ key: warnings.key }).from(warnings).where(eq(warnings.weldJointId, sample.id))).length, 1)
  const lookupMs = Math.round(performance.now() - start)
  const explain = await db.execute(sql`explain (format json) select key from dispatcher_accepted_warnings where weld_joint_id=${sample.id}`)
  assert.match(JSON.stringify(explain.rows), /accepted_warnings_joint_idx/)
  console.log(JSON.stringify({ quotaTransitions: true, historyPreserved: true, legacyConversion: true, renameAndCascades: true, registryEditPreservesDecisions: true, backfillSizes: [1, 1200], backfillQueries, scale: 200000, indexedOwnerLookupMs: lookupMs }))
} finally {
  await pool?.end()
  if (owned) {
    await admin.query('drop database welding_tracker_exception_objects_20260929')
    console.log(JSON.stringify({ removedOwnedDisposableDatabase: database }))
  }
  await admin.end()
}
