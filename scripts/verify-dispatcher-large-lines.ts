import assert from 'node:assert/strict'
import { channel } from 'node:diagnostics_channel'
import pg from 'pg'
import { eq, sql } from 'drizzle-orm'
import { lockWelderStampRegistry } from '../src/server/welder-stamp-registry-lock'
import { getBusinessDateIso } from '../src/lib/business-date'
import { E2E_DATABASE_URL, assertSafeE2eDatabaseUrl } from '../e2e/database'

assertSafeE2eDatabaseUrl(process.env.DATABASE_URL ?? '')
assert.equal(process.env.DATABASE_URL, E2E_DATABASE_URL)
assert.equal(process.env.WELDING_ENV_LOADED, '1')
const [{ requireDb }, schema, dispatcher] = await Promise.all([
  import('../src/db'), import('../src/db/schema'), import('../src/server/dispatcher-task-index'),
])
const { weldJoints, dispatcherTaskIndexState, dispatcherTaskPages, dispatcherRowTasks, preHeatTreatmentControls, pstoRepeatCycles, welderStamps } = schema
const { markDispatcherTaskIndexDirty, ensureDispatcherTaskIndexFresh } = dispatcher
const db = requireDb(), project = 'E2E staged large lines'
const scope = (line: string) => ({ projectTitle: project, subtitleCode: 'S', line })
assert.equal((await db.select({ id: weldJoints.id }).from(weldJoints).where(eq(weldJoints.projectTitle, project))).length, 0)
const events: Array<{ kind: string; outcome: string }> = []
const listeners = ['full', 'scoped'].map(kind => {
  const listener = (message: unknown) => events.push({ kind, outcome: (message as { outcome: string }).outcome })
  channel(`welding.dispatcher.${kind}-calculation`).subscribe(listener)
  return { kind, listener }
})
const original = pg.Client.prototype.query, originalError = console.error, OriginalDate = globalThis.Date
let stampId: number | undefined
let onRead: (() => Promise<void>) | undefined, failPublish = false, hydrateIds: number[] = []
const failure = (value: unknown): boolean => value instanceof Error && (value.message === 'EXPECTED_LARGE_LINE_ROLLBACK' || failure(value.cause))
console.error = (...args) => { if (!failPublish || !args.some(failure)) originalError(...args) }
pg.Client.prototype.query = function (this: pg.Client, ...args: Parameters<pg.Client['query']>) {
  const text = typeof args[0] === 'string' ? args[0] : (args[0] as { text?: string })?.text ?? ''
  if (failPublish && /^\s*delete from "dispatcher_task_pages"/i.test(text)) {
    return Promise.reject(new Error('EXPECTED_LARGE_LINE_ROLLBACK')) as unknown as ReturnType<pg.Client['query']>
  }
  const result = (original as (...values: unknown[]) => unknown).apply(this, args)
  if (/^\s*select\b/i.test(text) && text.includes('"technology_card_number"') && /from\s+"weld_joints"\s+where\b/i.test(text) && /\bany\s*\(/i.test(text)) {
    const params = Array.isArray(args[1]) ? args[1] : (args[0] as { values?: unknown[] })?.values ?? []
    const ids = params[0] as number[]
    assert(ids.length <= 5000, 'Wide hydration remains bounded')
    hydrateIds.push(...ids)
    if (onRead) {
      const run = onRead; onRead = undefined
      return Promise.resolve(result).then(async value => { await run(); return value }) as unknown as ReturnType<pg.Client['query']>
    }
  }
  return result as ReturnType<pg.Client['query']>
} as typeof original
const publication = async () => {
  const [state] = await db.select().from(dispatcherTaskIndexState)
  const pages = await db.select().from(dispatcherTaskPages).orderBy(dispatcherTaskPages.scopeKey, dispatcherTaskPages.pageNumber)
  const codes = await db.select().from(dispatcherRowTasks).orderBy(dispatcherRowTasks.weldJointId, dispatcherRowTasks.code)
  const statuses = await db.select({ id: weldJoints.id, status: weldJoints.finalStatus }).from(weldJoints).orderBy(weldJoints.id)
  return { state: { computedRevision: state.computedRevision, repeatedTasks: state.repeatedTasks, duplicateKeys: state.duplicateKeys,
    welderStampExpiryTasks: state.welderStampExpiryTasks }, pages, codes, statuses }
}
const assertFullParity = async () => {
  const partial = await publication()
  await markDispatcherTaskIndexDirty(db)
  await ensureDispatcherTaskIndexFresh()
  const full = await publication()
  assert.deepEqual(partial.pages, full.pages)
  assert.deepEqual(partial.codes, full.codes)
  assert.deepEqual(partial.statuses, full.statuses)
  const normalize = (value: string) => {
    const payload = JSON.parse(value)
    payload.chainContinuations.sort((a: unknown, b: unknown) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    payload.taskFilterOptions.sort((a: { value: string }, b: { value: string }) => a.value.localeCompare(b.value))
    return payload
  }
  assert.deepEqual(normalize(partial.state.repeatedTasks), normalize(full.state.repeatedTasks))
  assert.deepEqual(JSON.parse(partial.state.duplicateKeys).sort(), JSON.parse(full.state.duplicateKeys).sort())
  assert.equal(partial.state.welderStampExpiryTasks, full.state.welderStampExpiryTasks)
}
try {
  await db.execute(sql`insert into ${weldJoints} (project_title, subtitle_code, line, joint, weld_date, officiality, has_vik, vik_result)
    select ${project}, 'S', 'L 1', 'F'||n, '2026-09-01', 'действующий', 'да', 'годен' from generate_series(1,6000) n`)
  const [changed, moved, removed] = await db.select().from(weldJoints).where(eq(weldJoints.projectTitle, project)).orderBy(weldJoints.id).limit(3)
  const permit = { id: 'large-line-naks-permit', weldType: 'РД', materialGroups: 'М01', diameterFrom: '10', diameterTo: '1000', thicknessFrom: '1', thicknessTo: '50', validFrom: '2026-01-01', validTo: '2026-11-06' }
  const [stamp] = await db.insert(welderStamps).values({ naksPermits: JSON.stringify([permit]), naksStamp: 'QA99', welderName: 'Registry concurrent fixture',
    weldType: 'РД', materialGroups: 'М01', diameterFrom: '10', diameterTo: '1000', thicknessFrom: '1', thicknessTo: '50',
    validFrom: '2026-01-01', validTo: '2026-11-06' }).returning()
  stampId = stamp.id
  await db.update(weldJoints).set({ stamp1K: 'QA99', weldingMethod: 'РД', materialGroup: 'М01', connectionType: 'С17',
    d1: 108, d2: 108, t1: 4, t2: 4 }).where(eq(weldJoints.id, changed.id))
  const [stable, aliasSource, aliasRepair] = await db.insert(weldJoints).values([
    { ...scope('UNRELATED'), joint: 'OTHER', hasVik: 'да', weldDate: '2026-09-01', officiality: 'действующий' },
    { ...scope('L 1'), joint: 'ALIAS', hasVik: 'да', vikResult: 'ремонт', weldDate: '2026-09-01', officiality: 'неофициальный' },
    { ...scope('L1'), joint: 'ALIAS', officiality: 'действующий' },
  ]).returning()
  await db.insert(preHeatTreatmentControls).values({ weldJointId: changed.id, method: 'ВИК', result: 'ремонт', requestName: 'PRE', requestDate: '2026-08-25', conclusionName: 'PRE-C', conclusionDate: '2026-08-26' })
  await db.insert(pstoRepeatCycles).values({ weldJointId: moved.id, sequence: 2, tvmtResult: 'не годен', tvmtConclusion: 'REPEAT', tvmtConclusionDate: '2026-09-10' })
  await markDispatcherTaskIndexDirty(db); await ensureDispatcherTaskIndexFresh()
  const stableKey = dispatcher.getDispatcherScopeKey(stable)
  const stableBefore = (await publication()).pages.filter(page => page.scopeKey === stableKey)
  assert(stableBefore.length)
  await db.transaction(async tx => {
    await tx.update(weldJoints).set({ vikResult: 'вырез' }).where(eq(weldJoints.id, changed.id))
    await markDispatcherTaskIndexDirty(tx, { scopes: [scope('L 1')] })
  })
  events.length = 0; hydrateIds = []
  await ensureDispatcherTaskIndexFresh()
  assert.deepEqual(events, [{ kind: 'scoped', outcome: 'completed' }])
  assert.equal(new Set(hydrateIds).size, 6002)
  assert(!hydrateIds.includes(stable.id), 'Unrelated lines must not be hydrated')
  const first = await publication()
  assert.deepEqual(first.pages.filter(page => page.scopeKey === stableKey), stableBefore)
  assert.equal(first.statuses.find(row => row.id === aliasRepair.id)?.status, 'ожидает ремонт')
  await assertFullParity()

  // Mutations run on an independent transaction after an actual wide read and
  // before calculation. A held publication lock would hit the 2-second timeout.
  await markDispatcherTaskIndexDirty(db, { scopes: [scope('L 1')] })
  events.length = 0
  const beforeRace = await publication()
  onRead = async () => {
    await db.transaction(async tx => {
      await tx.execute(sql`set local statement_timeout = '2s'`)
      await tx.update(weldJoints).set({ vikResult: 'ремонт' }).where(eq(weldJoints.id, changed.id))
      await tx.update(weldJoints).set({ line: 'MOVED' }).where(eq(weldJoints.id, moved.id))
      await tx.delete(weldJoints).where(eq(weldJoints.id, removed.id))
      await tx.insert(weldJoints).values({ ...scope('MOVED'), joint: 'NEW', officiality: 'действующий' })
      await tx.update(weldJoints).set({ vikResult: 'вырез' }).where(eq(weldJoints.id, stable.id))
      await markDispatcherTaskIndexDirty(tx, { scopes: [scope('L 1'), scope('MOVED'), scope('UNRELATED')] })
    })
    assert.equal((await publication()).state.repeatedTasks, beforeRace.state.repeatedTasks, 'No partially staged tasks are visible')
  }
  const [left, right] = await Promise.all([ensureDispatcherTaskIndexFresh(), ensureDispatcherTaskIndexFresh()])
  assert.deepEqual(left, right)
  assert.equal(left.computedRevision, left.sourceRevision)
  assert.deepEqual(events, [{ kind: 'scoped', outcome: 'discarded' }, { kind: 'scoped', outcome: 'completed' }])
  await assertFullParity()

  await markDispatcherTaskIndexDirty(db, { scopes: [scope('L 1')] })
  events.length = 0
  onRead = async () => { await markDispatcherTaskIndexDirty(db) }
  await ensureDispatcherTaskIndexFresh()
  assert.deepEqual(events, [{ kind: 'scoped', outcome: 'discarded' }, { kind: 'full', outcome: 'completed' }])

  await db.transaction(async tx => {
    await tx.update(weldJoints).set({ vikResult: 'годен' }).where(eq(weldJoints.id, changed.id))
    await markDispatcherTaskIndexDirty(tx, { scopes: [scope('L 1')] })
  })
  const beforeFailure = await publication()
  failPublish = true
  await assert.rejects(ensureDispatcherTaskIndexFresh(), failure)
  assert.deepEqual(await publication(), beforeFailure, 'Index, pages and calculated statuses all roll back')
  failPublish = false
  await ensureDispatcherTaskIndexFresh()
  await assertFullParity()


  await markDispatcherTaskIndexDirty(db, { scopes: [scope('L 1')] })
  events.length = 0
  onRead = () => db.transaction(async tx => {
    await tx.execute(sql`set local statement_timeout = '2s'`)
    await lockWelderStampRegistry(tx, 'exclusive')
    await tx.update(welderStamps).set({ diameterTo: '57', naksPermits: JSON.stringify([{ ...permit, diameterTo: '57' }]) }).where(eq(welderStamps.id, stamp.id))
    await markDispatcherTaskIndexDirty(tx, { scopes: [scope('L 1')] })
  })
  await ensureDispatcherTaskIndexFresh()
  assert.deepEqual(events, [{ kind: 'scoped', outcome: 'discarded' }, { kind: 'scoped', outcome: 'completed' }])
  assert((await publication()).codes.some(row => row.weldJointId === changed.id && row.code === 'СП-02'))
  await assertFullParity()

  // Only this isolated child process changes its clock. A calculation that
  // crosses Moscow midnight cannot make yesterday's publication fresh today.
  let now = '2026-11-06T20:59:59Z'
  globalThis.Date = new Proxy(OriginalDate, { construct: (target, args) => Reflect.construct(target, args.length ? args : [now]) })
  await markDispatcherTaskIndexDirty(db); await ensureDispatcherTaskIndexFresh()
  await markDispatcherTaskIndexDirty(db, { scopes: [scope('L 1')] })
  const beforeMidnight = (await db.select().from(dispatcherTaskIndexState))[0].sourceRevision
  onRead = async () => { now = '2026-11-06T21:00:01Z' }
  const tomorrow = await ensureDispatcherTaskIndexFresh()
  assert.equal(getBusinessDateIso(tomorrow.computedAt!), '2026-11-07')
  assert.equal(tomorrow.computedRevision, tomorrow.sourceRevision)
  assert(tomorrow.computedRevision > beforeMidnight, 'New-day publication receives a distinct revision')
  // Compare both calculations on the same business day. Restoring the real
  // clock here would change expiry reminders when this test runs after Nov 7.
  // The finally block restores the process clock after all parity checks.
  await assertFullParity()

  // Constant writes do not cause an infinite refresh or bless a stale snapshot.
  await markDispatcherTaskIndexDirty(db, { scopes: [scope('L 1')] })
  const invalidate = async () => { await markDispatcherTaskIndexDirty(db, { scopes: [scope('L 1')] }); onRead = invalidate }
  onRead = invalidate; events.length = 0
  const stale = await ensureDispatcherTaskIndexFresh()
  onRead = undefined
  assert.notEqual(stale.computedRevision, stale.sourceRevision)
  assert.deepEqual(events, [{ kind: 'scoped', outcome: 'discarded' }, { kind: 'scoped', outcome: 'discarded' }])
  const recovered = await ensureDispatcherTaskIndexFresh()
  assert.equal(recovered.computedRevision, recovered.sourceRevision)
  assert(aliasSource.id)
  console.log(JSON.stringify({ largeScoped: true, boundedHydration: true, aliasesAndHistory: true, unrelatedPreserved: true,
    concurrentWriters: true, moveCreateDelete: true, coalesced: true, globalRetry: true, atomicRollback: true,
    boundedRetry: true, recovery: true, fullParity: true, registryRace: true, midnight: true }))
} finally {
  pg.Client.prototype.query = original; console.error = originalError; globalThis.Date = OriginalDate
  for (const { kind, listener } of listeners) channel(`welding.dispatcher.${kind}-calculation`).unsubscribe(listener)
  await db.delete(weldJoints).where(eq(weldJoints.projectTitle, project))
  if (stampId) await db.delete(welderStamps).where(eq(welderStamps.id, stampId))
  await markDispatcherTaskIndexDirty(db)
}
