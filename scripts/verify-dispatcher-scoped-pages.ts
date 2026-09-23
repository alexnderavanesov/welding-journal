import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'

import { eq, sql } from 'drizzle-orm'

const databaseUrl = process.env.DATABASE_URL ?? ''
const url = new URL(databaseUrl)
if (!['127.0.0.1', 'localhost'].includes(url.hostname) ||
  url.pathname !== '/welding_tracker_migration_audit') {
  throw new Error('This scoped-page verification runs only on the disposable local migration-audit database.')
}

const pgModule = await import('pg')
const clientPrototype = pgModule.Client.prototype as unknown as { query: (...args: unknown[]) => unknown }
const originalQuery = clientPrototype.query
let databaseRequests = 0
clientPrototype.query = function countedQuery(this: unknown, ...args: unknown[]) {
  databaseRequests += 1
  return originalQuery.apply(this, args)
}

const [{ requireDb }, schema, dispatcher, dirty, payload] = await Promise.all([
  import('../src/db/index.ts'),
  import('../src/db/schema.ts'),
  import('../src/server/dispatcher-task-index.ts'),
  import('../src/server/dispatcher-task-index-dirty.ts'),
  import('../src/lib/dispatcher-task-index-payload.ts'),
])
const db = requireDb()
const { weldJoints, dispatcherTaskPages, dispatcherTaskIndexState } = schema
const existing = await db.select({ id: weldJoints.id }).from(weldJoints).limit(1)
assert.equal(existing.length, 0, 'The audit database must be empty before this check.')

const base = {
  weldDate: '2026-09-01',
  projectTitle: 'AUDIT PROJECT',
  subtitleCode: 'A-1',
  officiality: 'действующий',
  hasVik: 'да',
  weldingMethod: 'РД',
  connectionType: 'СШ',
  d1: 108,
  d2: 108,
  t1: 4,
  t2: 4,
  wdi: 0.42,
} as const
const [moving, stable] = await db.insert(weldJoints).values([
  { ...base, line: 'OLD', joint: 'F1' },
  { ...base, line: 'STABLE', joint: 'F2' },
]).returning()
assert(moving && stable)

const oldKey = dispatcher.getDispatcherScopeKey(moving)
const stableKey = dispatcher.getDispatcherScopeKey(stable)
const fullStarted = performance.now()
const fullRequestStart = databaseRequests
await dispatcher.ensureDispatcherTaskIndexFresh()
const fullMs = Math.round(performance.now() - fullStarted)
const fullDatabaseRequests = databaseRequests - fullRequestStart
const [oldPage] = await db.select().from(dispatcherTaskPages)
  .where(eq(dispatcherTaskPages.scopeKey, oldKey)).limit(1)
const [stablePage] = await db.select().from(dispatcherTaskPages)
  .where(eq(dispatcherTaskPages.scopeKey, stableKey)).limit(1)
assert(oldPage && stablePage, 'Both initial lines must have persisted task cards.')

const stableTasks = JSON.parse(stablePage.tasks) as Array<Record<string, unknown>>
assert(stableTasks[0])
stableTasks[0].auditMarker = 'preserved'
await db.update(dispatcherTaskPages)
  .set({ tasks: JSON.stringify(stableTasks) })
  .where(eq(dispatcherTaskPages.scopeKey, stableKey))

const newLine = 'NEW'
const newKey = dispatcher.getDispatcherScopeKey({ ...moving, line: newLine })
await db.transaction(async (tx) => {
  await tx.update(weldJoints).set({ line: newLine }).where(eq(weldJoints.id, moving.id))
  await dirty.markDispatcherTaskIndexDirty(tx, {
    scopes: dirty.getDispatcherDirtyScopes(
      [{ ...moving, line: newLine }],
      new Map([[moving.id, moving]]),
    ),
  })
})
const scopedStarted = performance.now()
const scopedRequestStart = databaseRequests
await dispatcher.ensureDispatcherTaskIndexFresh()
const scopedMs = Math.round(performance.now() - scopedStarted)
const scopedDatabaseRequests = databaseRequests - scopedRequestStart
assert(scopedDatabaseRequests <= 100, 'A single-line move must not fan out into per-row database requests.')

const [state] = await db.select().from(dispatcherTaskIndexState)
  .where(eq(dispatcherTaskIndexState.id, 1)).limit(1)
assert(state)
assert.equal(state.sourceRevision, state.computedRevision)
assert.equal(state.fullRebuild, false)
const parsed = payload.parseDispatcherTaskIndexPayload(state.repeatedTasks)
const oldPages = await db.select({ pageNumber: dispatcherTaskPages.pageNumber })
  .from(dispatcherTaskPages).where(eq(dispatcherTaskPages.scopeKey, oldKey))
const newPages = await db.select({ pageNumber: dispatcherTaskPages.pageNumber })
  .from(dispatcherTaskPages).where(eq(dispatcherTaskPages.scopeKey, newKey))
const [stableAfter] = await db.select().from(dispatcherTaskPages)
  .where(eq(dispatcherTaskPages.scopeKey, stableKey)).limit(1)
assert.equal(oldPages.length, 0, 'The old line must not retain stale cards.')
assert(newPages.length > 0, 'The new line must receive its recalculated cards.')
assert(stableAfter)
assert.equal((JSON.parse(stableAfter.tasks) as Array<{ auditMarker?: string }>)[0]?.auditMarker,
  'preserved', 'An unrelated line must not be rewritten by a scoped refresh.')
const totals = await db.execute<{ pageCount: number; taskCount: number }>(sql`
  select count(*)::int as "pageCount", coalesce(sum("task_count"), 0)::int as "taskCount"
  from ${dispatcherTaskPages}
`)
assert.equal(parsed.totalPageCount, Number(totals.rows[0]?.pageCount))
assert.equal(parsed.totalTaskCount, Number(totals.rows[0]?.taskCount))
assert.equal(parsed.tasks.length, Math.min(5_000, parsed.totalTaskCount))

// No weld edits overnight: the new calculation must still invalidate old pages.
const previousRevision = state.computedRevision
await db.update(dispatcherTaskIndexState).set({ computedAt: new Date('2020-01-01T00:00:00Z') })
  .where(eq(dispatcherTaskIndexState.id, 1))
const nextDayState = await dispatcher.ensureDispatcherTaskIndexFresh()
assert(nextDayState.computedRevision > previousRevision)
assert.equal(nextDayState.computedRevision, nextDayState.sourceRevision)

console.log(JSON.stringify({ fullMs, scopedMs, fullDatabaseRequests, scopedDatabaseRequests,
  oldPages: oldPages.length,
  newPages: newPages.length, stablePagesPreserved: true, dailyRebuildAdvancesRevision: true,
  totalPages: parsed.totalPageCount, totalTasks: parsed.totalTaskCount }, null, 2))
