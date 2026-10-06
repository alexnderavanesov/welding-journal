import assert from 'node:assert/strict'
import { eq, inArray } from 'drizzle-orm'
import { calculateLineProgram } from '../src/lib/line-program-calculation'
import { programApprovalKey } from '../src/lib/program-control-approval'
import { buildLineProgramTopology } from '../src/lib/line-program-topology'

const url = new URL(process.env.DATABASE_URL ?? '')
assert.equal(url.hostname, '127.0.0.1')
assert.equal(url.pathname, '/welding_tracker_e2e')
assert.equal(process.env.WELDING_ENV_LOADED, '1')
const [{ requireDb }, schema, chain, program, dispatcher, dirty, read] = await Promise.all([
  import('../src/db/index'), import('../src/db/schema'), import('../src/server/line-program-chain-state'),
  import('../src/server/line-program'), import('../src/server/dispatcher-task-index'),
  import('../src/server/dispatcher-task-index-dirty'), import('../src/server/weld-read'),
])
const db = requireDb(), { weldJoints, weldJointProgramStates, dispatcherRowTasks, dispatcherAcceptedWarnings } = schema
const identity = { projectTitle: 'E2E rules SQL', subtitleCode: 'RULES', line: 'SYSTEM-RULES' }
assert.equal((await db.select({ id: weldJoints.id }).from(weldJoints).where(eq(weldJoints.projectTitle, identity.projectTitle))).length, 0)
const ids: number[] = []
const load = () => program.loadLineProgramRows(db, identity)
const refresh = async () => { await dirty.markDispatcherTaskIndexDirty(db); await dispatcher.ensureDispatcherTaskIndexFresh() }
try {
  const initial = await db.transaction(async tx => {
    const rows = await tx.insert(weldJoints).values(Array.from({ length: 20 }, (_, i) => ({ ...identity,
      joint: `F${i + 1}`, weldDate: '2026-09-01', connectionType: 'С17', category: 'II', groupName: 'A',
      weldControlPercent: 10, pvkControlPercent: 10, stamp1K: 'RULE-A', hasVik: 'да',
      hasRk: i === 0 ? 'да' : null, hasUzk: i === 0 ? 'да' : null, rkResult: i === 0 ? 'ремонт' : null,
      hasPvk: i === 0 ? 'да' : null, pvkResult: i === 0 ? 'годен' : null,
    }))).returning()
    await chain.syncProgramChainStates(tx, rows, new Map())
    return rows
  })
  ids.push(...initial.map(row => row.id))
  const [root] = initial
  const [repair] = await db.transaction(async tx => {
    const created = await tx.insert(weldJoints).values({ ...identity, joint: 'F1R1', connectionType: 'С17',
      weldDate: '2026-09-02', weldControlPercent: 10, pvkControlPercent: 10, category: 'II', groupName: 'A',
      stamp1K: 'RULE-B', hasVik: 'да', hasRk: 'да', hasPvk: 'да' }).returning()
    await chain.syncProgramChainStates(tx, created, new Map())
    return created
  })
  ids.push(repair.id)
  const first = calculateLineProgram(await load(), 10, 10).find(group => group.stamp === 'RULE-A')!
  assert.equal(first.rowIds.length, 20)
  assert.deepEqual(first.rejectedRowIds, [root.id])
  assert.deepEqual(first.common.coveredRowIds, [root.id])
  assert.equal(first.common.required, 4)
  assert.deepEqual(first.pvk.coveredRowIds, [])
  // A late explicit decision adds only a warning; assignments and history stay untouched.
  await db.insert(dispatcherAcceptedWarnings).values({ key: programApprovalKey(root, 'common', true), kind: 'line-program-control', weldJointId: root.id })
  await refresh()
  const tasks = await db.select().from(dispatcherRowTasks).where(inArray(dispatcherRowTasks.weldJointId, ids))
  assert.deepEqual([...new Set(tasks.filter(task => task.code === 'СП-03').map(task => task.weldJointId))], [repair.id])
  const virtual = await read.attachDispatcherTaskCodesToPage([{ id: root.id }, { id: repair.id }]) as { id: number; dispatcherTasks: string }[]
  assert(!virtual[0].dispatcherTasks.includes('СП-03'))
  assert(virtual[1].dispatcherTasks.includes('СП-03'))
  assert.equal((await db.select().from(weldJoints).where(eq(weldJoints.id, repair.id)))[0].hasUzk, null)
  // Exclusion suppresses the active task in both persisted and virtual consumers.
  // Restoring only one of two flags is insufficient; restoring both revives debt.
  for (const [flags, expected] of [
    [{ officiality: 'неофициальный', revisionActuality: null }, false],
    [{ officiality: null, revisionActuality: null }, true],
    [{ officiality: null, revisionActuality: 'не актуален' }, false],
    [{ officiality: 'неофициальный', revisionActuality: 'не актуален' }, false],
    [{ officiality: 'неофициальный', revisionActuality: null }, false],
    [{ officiality: null, revisionActuality: null }, true],
  ] as const) {
    await db.update(weldJoints).set(flags).where(eq(weldJoints.id, repair.id))
    await refresh()
    const stored = await db.select().from(dispatcherRowTasks).where(eq(dispatcherRowTasks.weldJointId, repair.id))
    assert.equal(stored.some(task => task.code === 'СП-03'), expected)
    const [visible] = await read.attachDispatcherTaskCodesToPage([{ id: repair.id }]) as { id: number; dispatcherTasks: string }[]
    assert.equal(visible.dispatcherTasks.includes('СП-03'), expected)
  }
  await db.update(weldJoints).set({ hasUzk: 'да' }).where(eq(weldJoints.id, repair.id))
  await refresh()
  assert.equal((await db.select().from(dispatcherRowTasks).where(eq(dispatcherRowTasks.weldJointId, repair.id))).filter(task => task.code === 'СП-03' || task.code === 'ДЗ-27').length, 0)

  const coils = await db.transaction(async tx => {
    const rows = await tx.insert(weldJoints).values([1, 2].map(side => ({ ...identity, joint: `F1Y${side}`,
      connectionType: 'С17', weldDate: '2026-09-03', weldControlPercent: 10, pvkControlPercent: 10,
      category: 'II', groupName: 'A', stamp1K: 'RULE-A', hasVik: 'да' }))).returning()
    await chain.syncProgramChainStates(tx, rows, new Map())
    return rows
  })
  ids.push(...coils.map(row => row.id))
  assert.equal((await db.select().from(weldJointProgramStates).where(eq(weldJointProgramStates.weldJointId, root.id)))[0].replacedByCoil, true)
  let group = calculateLineProgram(await load(), 10, 10).find(group => group.stamp === 'RULE-A')!
  assert.equal(group.rowIds.length, 21)
  assert(!group.common.coveredRowIds.includes(root.id))
  assert.deepEqual(group.rejectedRowIds, [root.id])
  // Persisted replacement survives missing sides; deleted rows never remain credited.
  for (const coil of coils) await db.transaction(async tx => {
    const before = await chain.attachProgramChainStates([coil], tx)
    await tx.delete(weldJoints).where(eq(weldJoints.id, coil.id))
    await chain.syncProgramChainStates(tx, [], new Map(before.map(row => [row.id, row])))
  })
  group = calculateLineProgram(await load(), 10, 10).find(group => group.stamp === 'RULE-A')!
  assert.equal(group.rowIds.length, 19)
  assert(!group.rowIds.includes(root.id))
  assert(buildLineProgramTopology(await load(), false).issues.some(issue => issue.rowId === root.id))
  // Removing the source does not bind its repair to a newly created, same-named row.
  await db.transaction(async tx => {
    const before = await chain.attachProgramChainStates([root], tx)
    await tx.delete(weldJoints).where(eq(weldJoints.id, root.id))
    await chain.syncProgramChainStates(tx, [], new Map(before.map(row => [row.id, row])))
    const [replacement] = await tx.insert(weldJoints).values({ ...identity, joint: 'F1', connectionType: 'С17', hasVik: 'да' }).returning()
    ids.push(replacement.id)
    await chain.syncProgramChainStates(tx, [replacement], new Map())
  })
  const final = await load(), state = final.find(row => row.id === repair.id)!.programChainState!
  assert.equal(state.physicalRootId, root.id)
  assert(buildLineProgramTopology(final, false).issues.some(issue => issue.rowId === repair.id))
  console.log(JSON.stringify({ physicalReplacement: true, stableIdsAfterDeletion: true, lateApproval: true, repairOnlyPersistedAndVirtual: true, exclusionRestoresRepairTask: true }))
} finally {
  if (ids.length) await db.delete(weldJoints).where(inArray(weldJoints.id, ids))
  await dirty.markDispatcherTaskIndexDirty(db)
}
