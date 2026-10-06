import assert from 'node:assert/strict'
import { eq, inArray } from 'drizzle-orm'
import { calculateLineProgram } from '../src/lib/line-program-calculation'
import type { PercentageLineControlTask } from '../src/lib/dispatcher-types'

// Legacy off+rejected history is injected only into the runner-owned test DB.
// This does not bypass or change the user's normal settings-disable guard.
const url = new URL(process.env.DATABASE_URL ?? '')
assert.equal(url.hostname, '127.0.0.1')
assert.equal(url.pathname, '/welding_tracker_e2e')
assert.equal(process.env.WELDING_ENV_LOADED, '1')
const [{ requireDb }, schema, dispatcher, dirty, read, program] = await Promise.all([
  import('../src/db/index'), import('../src/db/schema'), import('../src/server/dispatcher-task-index'),
  import('../src/server/dispatcher-task-index-dirty'), import('../src/server/weld-read'), import('../src/server/line-program'),
])
const db = requireDb()
const { weldJoints, preHeatTreatmentControls, appSettings, dispatcherRowTasks, dispatcherTaskPages } = schema
const key = 'control-processes'
const previous = await db.select().from(appSettings).where(eq(appSettings.key, key))
const identity = { projectTitle: 'E2E policy SQL', subtitleCode: 'LP', line: 'LP-PRE-POLICY' }
assert.equal((await db.select({ id: weldJoints.id }).from(weldJoints).where(eq(weldJoints.projectTitle, identity.projectTitle))).length, 0)
const ids: number[] = []
const pg = await import('pg')
const prototype = pg.default.Client.prototype
const originalQuery = prototype.query
let statements = 0
prototype.query = function (this: unknown, ...args: unknown[]) {
  statements++
  return (originalQuery as (...args: unknown[]) => unknown).apply(this, args)
} as typeof prototype.query
try {
  const inserted = await db.insert(weldJoints).values(Array.from({ length: 20 }, (_, i) => ({
    ...identity, joint: `F${i + 1}`, weldDate: '2026-09-01', connectionType: 'СШ', category: 'II', groupName: 'A',
    weldControlPercent: 30, pvkControlPercent: 10, hasVik: 'да', hasPvk: i < 4 ? 'отменен' : null,
    stamp1K: 'POLICY-SQL', rkResult: i === 4 ? 'ремонт' : null,
  }))).returning({ id: weldJoints.id })
  ids.push(...inserted.map((row) => row.id))
  await db.insert(preHeatTreatmentControls).values(ids.slice(0, 4).map((id) => ({
    weldJointId: id, method: 'ПВК', result: 'ремонт', requestName: 'PRE', requestDate: '2026-09-02',
    conclusionName: 'PRE-RESULT', conclusionDate: '2026-09-03',
  })))
  const beforeHistory = await db.select().from(preHeatTreatmentControls).where(inArray(preHeatTreatmentControls.weldJointId, ids))
  for (const enabled of [true, false, true]) {
    const value = JSON.stringify({ ...(previous[0] ? JSON.parse(previous[0].value) : {}), preHeatTreatmentLnkEnabled: enabled })
    await db.insert(appSettings).values({ key, value }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } })
    const beforeRead = statements
    const rows = await program.loadLineProgramRows(db, identity)
    assert.equal(statements - beforeRead, 6, 'Policy and stable chain state use bounded batched reads')
    assert(rows.every((row) => row.preHeatTreatmentLnkEnabled === enabled))
    const calculation = calculateLineProgram(rows, 30, 10)[0]
    assert.equal(calculation.common.required, 8)
    assert.equal(calculation.rejectedRowIds.length, 1)
    assert.equal(calculation.pvk.completedRowIds.length, enabled ? 4 : 0)
    await dirty.markDispatcherTaskIndexDirty(db)
    await dispatcher.ensureDispatcherTaskIndexFresh()
    const persisted = await db.select().from(dispatcherRowTasks).where(inArray(dispatcherRowTasks.weldJointId, ids))
    const visible = await read.attachDispatcherTaskCodesToPage(ids.map((id) => ({ id }))) as Array<{ id: number; dispatcherTasks: string }>
    for (const code of ['ДЗ-05', 'ДЗ-06']) {
      assert.equal(persisted.some((row) => row.code === code), false, `${code}: PVK failure never escalates RK/UZK`)
      assert.equal(visible.some((row) => row.dispatcherTasks.split(', ').includes(code)), false, `${code}: PVK failure never escalates RK/UZK`)
    }
    const pages = await db.select().from(dispatcherTaskPages)
    const tasks = pages.flatMap((page) => JSON.parse(page.tasks) as PercentageLineControlTask[])
      .filter((task) => task.kind === 'percentage-line-control' && task.stamp === 'POLICY-SQL')
    assert(tasks.some((task) => task.issue === 'missing' && task.demandKind !== 'pvk' && task.requiredControls === 8))
    assert.deepEqual(await db.select().from(preHeatTreatmentControls).where(inArray(preHeatTreatmentControls.weldJointId, ids)), beforeHistory)
  }
  console.log(JSON.stringify({ phases: 3, lineReadQueries: 6, persistedAndVirtual: true, historyUnchanged: true }))
} finally {
  prototype.query = originalQuery
  if (ids.length) await db.delete(weldJoints).where(inArray(weldJoints.id, ids))
  if (previous[0]) await db.update(appSettings).set({ value: previous[0].value, updatedAt: previous[0].updatedAt }).where(eq(appSettings.key, key))
  else await db.delete(appSettings).where(eq(appSettings.key, key))
  await dirty.markDispatcherTaskIndexDirty(db)
}
