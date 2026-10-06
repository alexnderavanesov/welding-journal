import assert from 'node:assert/strict'
import pg from 'pg'
import { eq, inArray, sql } from 'drizzle-orm'

const url = new URL(process.env.DATABASE_URL ?? '')
assert.equal(url.hostname, '127.0.0.1')
assert.equal(url.pathname, '/welding_tracker_e2e')
assert.equal(process.env.WELDING_ENV_LOADED, '1')
const [{ requireDb }, schema, chain, restoration, program, dirty, dispatcher, read] = await Promise.all([
  import('../src/db'), import('../src/db/schema'), import('../src/server/line-program-chain-state'),
  import('../src/server/coil-restoration'), import('../src/server/line-program'), import('../src/server/dispatcher-task-index-dirty'),
  import('../src/server/dispatcher-task-index'), import('../src/server/weld-read'),
])
const db = requireDb(), { weldJoints, linePrograms, weldJointProgramStates, coilRestorationEvents, dispatcherRowTasks } = schema
const projectTitle = 'E2E coil restoration SQL'
assert.equal((await db.select({ id: weldJoints.id }).from(weldJoints).where(eq(weldJoints.projectTitle, projectTitle))).length, 0)
const ids: number[] = [], lineIds: number[] = [], rootIds: number[] = []
const originalQuery = pg.Client.prototype.query
let queries = 0
const counts: number[] = []
const preview = (id: number) => db.transaction(tx => restoration.previewCoilRestorationInTransaction(tx, id))
const restore = (rootId: number, token: string) => db.transaction(tx => restoration.restoreCoilInTransaction(tx, { rootId, token, confirmedNotInstalled: true }))
const earlyPreview = (id: number) => db.transaction(tx => restoration.previewEarlyCoilCorrectionInTransaction(tx, id))
const earlyCancel = (rootId: number, token: string) => db.transaction(tx => restoration.cancelErroneousEarlyCoilInTransaction(tx, { rootId, token, confirmedNotInstalled: true }))
const state = async (id: number) => (await db.select().from(weldJointProgramStates).where(eq(weldJointProgramStates.weldJointId, id)))[0]
try {
  for (const count of [24, 1024]) {
    const [line] = await db.insert(linePrograms).values({ projectTitle, subtitleCode: 'C', line: `RESTORE-${count}`, category: 'II', groupName: 'A', weldControlPercent: 10, pvkControlPercent: 0 }).returning()
    lineIds.push(line.id)
    await db.execute(sql`insert into weld_joints (line_program_id,project_title,subtitle_code,line,joint,connection_type,weld_date,stamp_1_k,has_vik,vik_result,has_uzk,uzk_result,category,group_name,weld_control_percent,pvk_control_percent)
      select ${line.id},${projectTitle},'C',${line.line},case when n=1 then 'S1' else 'F'||n end,'С17','2026-09-01','A','да','годен','да','годен','II','A',10,0 from generate_series(1,${count}) n`)
    const rows = await db.select().from(weldJoints).where(eq(weldJoints.lineProgramId, line.id)).orderBy(weldJoints.id)
    ids.push(...rows.map(row => row.id))
    const root = rows[0]; rootIds.push(root.id)
    if (count === 1024) {
      // The corrected good final may be a repair, not the original. Neither its
      // zero physical weight nor the original rejection may be rewritten.
      await db.update(weldJoints).set({ uzkResult: 'ремонт' }).where(eq(weldJoints.id, root.id))
      root.uzkResult = 'ремонт'
      const repair = await db.transaction(async tx => {
        const [created] = await tx.insert(weldJoints).values({ projectTitle, subtitleCode: 'C', line: line.line, lineProgramId: line.id,
          joint: 'S1R1', weldDate: '2026-09-02', connectionType: 'С17', stamp1K: 'A', hasVik: 'да', vikResult: 'годен', hasUzk: 'да', uzkResult: 'годен' }).returning()
        await chain.syncProgramChainStates(tx, [created], new Map())
        return created
      })
      ids.push(repair.id)
    }
    const coils = await db.transaction(async tx => {
      const created = await tx.insert(weldJoints).values([1, 2].map(side => ({ projectTitle, subtitleCode: 'C', line: line.line, lineProgramId: line.id,
        joint: `S1Y${side}`, weldDate: '2026-09-02', connectionType: 'С17', hasVik: 'да' }))).returning()
      await chain.syncProgramChainStates(tx, [...rows, ...created], new Map())
      return created
    })
    ids.push(...coils.map(row => row.id))
    assert((await state(root.id)).replacedByCoil)
    const incomplete = await preview(root.id)
    assert(incomplete.reason?.includes('Сохранились стороны'))
    let movedDescendantId: number | undefined
    if (count === 24) {
      movedDescendantId = await db.transaction(async tx => {
        const [created] = await tx.insert(weldJoints).values({ projectTitle, subtitleCode: 'C', line: line.line, lineProgramId: line.id,
          joint: 'S1Y1R1', weldDate: '2026-09-03' }).returning()
        await chain.syncProgramChainStates(tx, [created], new Map())
        const [previous] = await chain.attachProgramChainStates([created], tx)
        const [moved] = await tx.update(weldJoints).set({ line: 'Moved', lineProgramId: null, joint: 'Renamed', officiality: 'неофициальный' }).where(eq(weldJoints.id, created.id)).returning()
        await chain.syncProgramChainStates(tx, [moved], new Map([[previous.id, previous]]))
        return created.id
      })
      ids.push(movedDescendantId)
    }
    await db.transaction(async tx => {
      const previous = await chain.attachProgramChainStates(coils, tx)
      await tx.delete(weldJoints).where(inArray(weldJoints.id, coils.map(row => row.id)))
      await chain.syncProgramChainStates(tx, [], new Map(previous.map(row => [row.id, row])))
    })
    assert.equal((await db.select().from(weldJointProgramStates).where(inArray(weldJointProgramStates.weldJointId, coils.map(row => row.id)))).length, 2, 'Deleted coil IDs must survive as history')
    if (movedDescendantId) {
      assert((await preview(root.id)).reason?.includes('Сохранились стороны'), 'Deleted coil must not hide a moved, renamed and unofficial descendant')
      await db.transaction(async tx => {
        const previous = await chain.attachProgramChainStates(await tx.select().from(weldJoints).where(eq(weldJoints.id, movedDescendantId!)), tx)
        await tx.delete(weldJoints).where(eq(weldJoints.id, movedDescendantId!))
        await chain.syncProgramChainStates(tx, [], new Map(previous.map(row => [row.id, row])))
      })
    }
    await dirty.markDispatcherTaskIndexDirty(db)
    await dispatcher.ensureDispatcherTaskIndexFresh()
    assert((await db.select().from(dispatcherRowTasks).where(eq(dispatcherRowTasks.weldJointId, root.id))).some(task => task.code === 'СП-04'))
    const [beforeVirtual] = await read.attachDispatcherTaskCodesToPage([{ id: root.id }]) as { id: number; dispatcherTasks: string }[]
    assert(beforeVirtual.dispatcherTasks.includes('СП-04'))
    // Preview neither changes physics nor creates an audit event.
    pg.Client.prototype.query = function (this: unknown, ...args: unknown[]) { queries++; return (originalQuery as (...args: unknown[]) => unknown).apply(this, args) } as typeof originalQuery
    queries = 0
    const before = await preview(root.id)
    counts.push(queries)
    pg.Client.prototype.query = originalQuery
    assert.equal(before.reason, null)
    assert.equal(before.before.joints, count - 1)
    assert.equal(before.after.joints, count)
    assert((await state(root.id)).replacedByCoil)
    assert.equal((await db.select().from(coilRestorationEvents).where(eq(coilRestorationEvents.sourceWeldJointId, root.id))).length, 0)
    // Stale preview and forged confirmation are rejected before any lasting change.
    await db.update(weldJoints).set({ stamp1K: 'B' }).where(eq(weldJoints.id, rows[1].id))
    await assert.rejects(restore(root.id, before.token), /изменились/)
    const current = await preview(root.id)
    await assert.rejects(db.transaction(tx => restoration.restoreCoilInTransaction(tx, { rootId: root.id, token: current.token, confirmedNotInstalled: false })), /[Пп]одтвердите/)
    // Failure after updating the physical state must roll the entire operation back.
    await assert.rejects(db.transaction(tx => restoration.restoreCoilInTransaction(new Proxy(tx, { get(target, key) {
      if (key === 'insert') return (table: unknown) => { if (table === coilRestorationEvents) throw new Error('audit write failure'); return target.insert(table as never) }
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    } }), { rootId: root.id, token: current.token, confirmedBy: 'Иванов', confirmedNotInstalled: true })), /audit write failure/)
    assert((await state(root.id)).replacedByCoil)
    // Restoration and dispatcher publication use the same parent-table lock
    // order. Concurrent refresh must neither deadlock nor undo the correction.
    await dirty.markDispatcherTaskIndexDirty(db)
    const [attempts] = await Promise.all([
      Promise.all([restore(root.id, current.token), restore(root.id, current.token)]),
      dispatcher.ensureDispatcherTaskIndexFresh(),
    ])
    assert.deepEqual(attempts.map(result => result.alreadyApplied).sort(), [false, true])
    assert.equal((await state(root.id)).replacedByCoil, false)
    assert.equal((await db.select().from(coilRestorationEvents).where(eq(coilRestorationEvents.sourceWeldJointId, root.id))).length, 1)
    const final = await program.loadLineProgramRows(db, line)
    assert.equal(final.find(row => row.id === root.id)?.uzkResult, root.uzkResult)
    // Ordinary structural saves must not reinstate the cancelled replacement.
    await db.transaction(tx => chain.syncProgramChainStates(tx, [{ ...root, joint: 'S1-fixed' }], new Map([[root.id, root]])))
    assert.equal((await state(root.id)).replacedByCoil, false)
    await dirty.markDispatcherTaskIndexDirty(db)
    await dispatcher.ensureDispatcherTaskIndexFresh()
    assert(!(await db.select().from(dispatcherRowTasks).where(eq(dispatcherRowTasks.weldJointId, root.id))).some(task => task.code === 'СП-04'))
    const [virtual] = await read.attachDispatcherTaskCodesToPage([{ id: root.id }]) as { id: number; dispatcherTasks: string }[]
    assert(!virtual.dispatcherTasks.includes('СП-04'))
  }
  assert.equal(counts[0], counts[1], 'Preview SQL must not grow with line size')
  assert(counts[0] <= 20, `Unexpected preview query fan-out: ${counts}`)
  // An edited early coil has a protected exit after factual cleanup. Cancelling
  // the decision must NOT silently resurrect a previously cut-out connection.
  for (const useRepair of [false, true]) {
  const [earlyLine] = await db.insert(linePrograms).values({ projectTitle, subtitleCode: 'C', line: `EARLY-CORRECTION-${useRepair}`, category: 'II', groupName: 'A', weldControlPercent: 10, pvkControlPercent: 0 }).returning()
  lineIds.push(earlyLine.id)
  const [earlyRoot] = await db.insert(weldJoints).values({ projectTitle, subtitleCode: 'C', line: earlyLine.line, lineProgramId: earlyLine.id, joint: 'S1', weldDate: '2026-09-01', connectionType: 'С17', stamp1K: 'A', hasVik: 'да', vikResult: 'годен', hasUzk: 'да', uzkResult: 'ремонт' }).returning()
  ids.push(earlyRoot.id); rootIds.push(earlyRoot.id)
  const source = useRepair ? (await db.insert(weldJoints).values({ projectTitle, subtitleCode: 'C', line: earlyLine.line, lineProgramId: earlyLine.id, joint: 'S1R1', weldDate: '2026-09-02', connectionType: 'С17', hasVik: 'да', vikResult: 'годен', hasUzk: 'да', uzkResult: 'ремонт' }).returning())[0] : earlyRoot
  if (useRepair) ids.push(source.id)
  const earlyCoils = await db.insert(weldJoints).values([1, 2].map(side => ({ projectTitle, subtitleCode: 'C', line: earlyLine.line, lineProgramId: earlyLine.id, joint: `S1Y${side}`, weldDate: '2026-09-03' }))).returning()
  ids.push(...earlyCoils.map(row => row.id))
  await db.transaction(tx => chain.syncProgramChainStates(tx, [...new Map([earlyRoot, source, ...earlyCoils].map(row => [row.id, row])).values()], new Map()))
  const { getEarlyCoilDecisionKey, EARLY_COIL_DECISION_KIND } = await import('../src/lib/early-coil-decision')
  const decisionKey = getEarlyCoilDecisionKey(source.id)
  await db.insert(schema.dispatcherAcceptedWarnings).values({ key: decisionKey, weldJointId: source.id, kind: EARLY_COIL_DECISION_KIND, code: 'ДЗ-09', title: 'Ошибочное досрочное решение', context: decisionKey })
  assert((await earlyPreview(source.id)).reason?.includes('дату сварки'))
  await db.update(weldJoints).set({ weldDate: null, updatedAt: sql`now() + interval '1 second'` }).where(inArray(weldJoints.id, earlyCoils.map(row => row.id)))
  const { revokeEarlyCoilDecisionInTransaction } = await import('../src/server/early-coil-workflow')
  await assert.rejects(db.transaction(tx => revokeEarlyCoilDecisionInTransaction(tx, decisionKey)), /содержит данные, историю, изменения или документы/)
  const earlyCheck = await earlyPreview(source.id)
  assert.equal(earlyCheck.reason, null)
  await db.update(weldJoints).set({ vikRequest: 'Ошибочная заявка' }).where(eq(weldJoints.id, earlyCoils[0].id))
  await assert.rejects(earlyCancel(source.id, earlyCheck.token), /изменились/)
  assert((await earlyPreview(source.id)).reason?.includes('документы'))
  await db.update(weldJoints).set({ vikRequest: null }).where(eq(weldJoints.id, earlyCoils[0].id))
  await db.update(weldJoints).set({ vikRequestDate: '2026-09-03', tvmtResult: 'не годен' }).where(eq(weldJoints.id, earlyCoils[0].id))
  assert((await earlyPreview(source.id)).reason?.includes('документы'), 'Full locked fields, not just the compact calculation projection, must be checked')
  await db.update(weldJoints).set({ vikRequestDate: null, tvmtResult: null }).where(eq(weldJoints.id, earlyCoils[0].id))
  const cleared = await earlyPreview(source.id)
  const cancellations = await Promise.all([earlyCancel(source.id, cleared.token), earlyCancel(source.id, cleared.token)])
  assert.deepEqual(cancellations.map(result => result.alreadyApplied).sort(), [false, true])
  assert((await state(earlyRoot.id)).replacedByCoil)
  assert.equal((await db.select().from(weldJoints).where(inArray(weldJoints.id, earlyCoils.map(row => row.id)))).length, 0)
  assert((await preview(earlyRoot.id)).reason?.includes('годный финал'))
  await dirty.markDispatcherTaskIndexDirty(db)
  await dispatcher.ensureDispatcherTaskIndexFresh()
  const earlyTasks = await db.select().from(dispatcherRowTasks).where(inArray(dispatcherRowTasks.weldJointId, [earlyRoot.id, source.id]))
  assert(earlyTasks.some(task => task.code === 'СП-04'))
  assert(earlyTasks.some(task => task.code === 'ДЗ-07'), 'Ordinary continuation returns after early cancellation')
  await db.update(weldJoints).set({ uzkResult: 'годен' }).where(eq(weldJoints.id, source.id))
  const corrected = await preview(earlyRoot.id)
  assert.equal(corrected.reason, null)
  assert.equal(corrected.before.joints, 0); assert.equal(corrected.after.joints, 1)
  await restore(earlyRoot.id, corrected.token)
  assert.equal((await state(earlyRoot.id)).replacedByCoil, false)
  assert.equal((await db.select().from(coilRestorationEvents).where(eq(coilRestorationEvents.sourceWeldJointId, earlyRoot.id))).length, 2)
  }
  console.log(JSON.stringify({ restored: true, earlyCorrection: true, staleRejected: true, atomicRollback: true, concurrentIdempotence: true, queries: counts }))
} finally {
  pg.Client.prototype.query = originalQuery
  if (rootIds.length) await db.delete(coilRestorationEvents).where(inArray(coilRestorationEvents.sourceWeldJointId, rootIds))
  if (ids.length) {
    await db.delete(weldJoints).where(inArray(weldJoints.id, ids))
    await db.delete(weldJointProgramStates).where(inArray(weldJointProgramStates.weldJointId, ids))
  }
  if (lineIds.length) await db.delete(linePrograms).where(inArray(linePrograms.id, lineIds))
  await dirty.markDispatcherTaskIndexDirty(db)
}
