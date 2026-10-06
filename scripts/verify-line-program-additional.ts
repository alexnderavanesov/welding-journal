import assert from 'node:assert/strict'
import { inArray } from 'drizzle-orm'
import { calculateLineProgram } from '../src/lib/line-program-calculation'
import type { PercentageLineControlTask } from '../src/lib/dispatcher-types'

const url = new URL(process.env.DATABASE_URL ?? '')
assert.equal(url.hostname, '127.0.0.1')
assert.equal(url.pathname, '/welding_tracker_e2e')
assert.equal(process.env.WELDING_ENV_LOADED, '1')
const [{ requireDb }, schema, dispatcher, dirty, read, program] = await Promise.all([
  import('../src/db/index'), import('../src/db/schema'), import('../src/server/dispatcher-task-index'),
  import('../src/server/dispatcher-task-index-dirty'), import('../src/server/weld-read'), import('../src/server/line-program'),
])
const db = requireDb()
const { weldJoints, dispatcherRowTasks, dispatcherTaskPages } = schema
const identity = { projectTitle: 'E2E additional SQL', subtitleCode: 'LP', line: 'LP-ADDITIONAL' }
const ids: number[] = []
const pg = await import('pg')
const prototype = pg.default.Client.prototype, originalQuery = prototype.query
let statements = 0
prototype.query = function (this: unknown, ...args: unknown[]) {
  statements++
  return (originalQuery as (...args: unknown[]) => unknown).apply(this, args)
} as typeof prototype.query
try {
  const inserted = await db.insert(weldJoints).values(Array.from({ length: 4 }, (_, i) => ({
    ...identity, joint: 'F' + (i + 1), weldDate: '2026-09-01', connectionType: 'СШ', category: 'II', groupName: 'A',
    weldControlPercent: 50, pvkControlPercent: 50, hasVik: 'да',
    hasRk: i === 0 ? 'да' : null, hasPvk: i === 0 ? 'да' : null, stamp1K: 'ADDITIONAL-SQL',
    vikResult: 'годен', vikConclusion: 'VIK-UNCHANGED', vikConclusionDate: '2026-09-02',
  }))).returning({ id: weldJoints.id })
  ids.push(...inserted.map(row => row.id))
  const snapshots = []
  // Missing -> filled by additional -> ordinary yes displaced -> excess manually removed.
  for (let phase = 0; phase < 4; phase++) {
    if (phase === 1) await db.update(weldJoints).set({ hasRk: 'дополнительный', hasPvk: 'дополнительный' }).where(inArray(weldJoints.id, [ids[2]]))
    if (phase === 2) await db.update(weldJoints).set({ hasRk: 'да', hasPvk: 'да' }).where(inArray(weldJoints.id, [ids[1]]))
    if (phase === 3) await db.update(weldJoints).set({ hasRk: null, hasPvk: null }).where(inArray(weldJoints.id, [ids[1]]))
    const beforeRead = statements, rows = await program.loadLineProgramRows(db, identity)
    assert.equal(statements - beforeRead, 6, 'Stable chain state is one batched read, not one per joint')
    const calculation = calculateLineProgram(rows, 50, 50)[0]
    for (const kind of ['common', 'pvk'] as const) {
      assert.equal(calculation[kind].required, 2)
      assert.equal(calculation[kind].missing, phase === 0 ? 1 : 0)
      assert.equal(calculation[kind].excessRowIds.length, phase === 2 ? 1 : 0)
      if (phase === 2) assert.deepEqual(calculation[kind].excessRowIds, [ids[1]])
      assert(rows.every(row => row.vikResult === 'годен'))
    }
    await dirty.markDispatcherTaskIndexDirty(db)
    await dispatcher.ensureDispatcherTaskIndexFresh()
    const history = await db.select({ result: weldJoints.vikResult, conclusion: weldJoints.vikConclusion }).from(weldJoints).where(inArray(weldJoints.id, ids))
    assert.equal(history.length, 4)
    assert(history.every(row => row.result === 'годен' && row.conclusion === 'VIK-UNCHANGED'))
    const persisted = await db.select().from(dispatcherRowTasks).where(inArray(dispatcherRowTasks.weldJointId, ids))
    const visible = await read.attachDispatcherTaskCodesToPage(ids.map(id => ({ id }))) as Array<{ id: number; dispatcherTasks: string }>
    const pages = await db.select().from(dispatcherTaskPages)
    const tasks = pages.flatMap(page => JSON.parse(page.tasks) as PercentageLineControlTask[])
      .filter(task => task.kind === 'percentage-line-control' && task.stamp === 'ADDITIONAL-SQL')
    assert.equal(tasks.filter(task => task.issue === 'missing').length, phase === 0 ? 2 : 0)
    assert.equal(tasks.filter(task => task.issue === 'excess').length, phase === 2 ? 2 : 0)
    for (const [code, expected] of [['ДЗ-04', phase === 0], ['ДЗ-02', phase === 2]] as const) {
      assert.equal(persisted.some(row => row.code === code), expected, code + ': stored index')
      assert.equal(visible.some(row => row.dispatcherTasks.split(', ').includes(code)), expected, code + ': virtual field')
    }
    snapshots.push({ phase, tasks: tasks.length })
  }
  // A completed cancelled RK still covers the joint; an ordinary UZK is a duplicate.
  await db.update(weldJoints).set({ hasRk: 'отменен', rkResult: 'годен', rkConclusion: 'RK-FACT', hasUzk: 'да' }).where(inArray(weldJoints.id, [ids[0]]))
  await dirty.markDispatcherTaskIndexDirty(db)
  await dispatcher.ensureDispatcherTaskIndexFresh()
  const duplicateIndex = await db.select().from(dispatcherRowTasks).where(inArray(dispatcherRowTasks.weldJointId, ids))
  const duplicateVisible = await read.attachDispatcherTaskCodesToPage(ids.map(id => ({ id }))) as Array<{ id: number; dispatcherTasks: string }>
  assert(duplicateIndex.some(row => row.code === 'ДЗ-27'), 'completed cancelled RK: stored duplicate task')
  assert(duplicateVisible.some(row => row.dispatcherTasks.split(', ').includes('ДЗ-27')), 'completed cancelled RK: virtual duplicate task')
  // Full-line planning includes an unwelded joint, even before an official stamp exists.
  await db.update(weldJoints).set({ weldControlPercent: 100, hasUzk: null }).where(inArray(weldJoints.id, ids))
  const [planned] = await db.insert(weldJoints).values({
    ...identity, joint: 'F-PLANNED', connectionType: 'С19', category: 'II', groupName: 'A',
    weldControlPercent: 100, pvkControlPercent: 50, hasVik: 'да', hasRk: 'да', hasUzk: 'да',
  }).returning({ id: weldJoints.id })
  ids.push(planned.id)
  await dirty.markDispatcherTaskIndexDirty(db)
  await dispatcher.ensureDispatcherTaskIndexFresh()
  const plannedIndex = await db.select().from(dispatcherRowTasks).where(inArray(dispatcherRowTasks.weldJointId, [planned.id]))
  const plannedVisible = await read.attachDispatcherTaskCodesToPage([{ id: planned.id }]) as Array<{ id: number; dispatcherTasks: string }>
  assert(plannedIndex.some(row => row.code === 'ДЗ-27'), 'unwelded full-line assignment: stored duplicate task')
  assert(plannedVisible[0].dispatcherTasks.split(', ').includes('ДЗ-27'), 'unwelded full-line assignment: virtual duplicate task')
  console.log(JSON.stringify({ phases: snapshots.length, lineReadQueries: 6, persistedAndVirtual: true, cancelledResultDuplicate: true, unweldedFullLineDuplicate: true }))
} finally {
  prototype.query = originalQuery
  if (ids.length) await db.delete(weldJoints).where(inArray(weldJoints.id, ids))
  await dirty.markDispatcherTaskIndexDirty(db)
}
