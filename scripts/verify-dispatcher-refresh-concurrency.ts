import assert from 'node:assert/strict'
import pg from 'pg'
import { and, eq } from 'drizzle-orm'
import { E2E_DATABASE_URL, assertSafeE2eDatabaseUrl } from '../e2e/database'

assertSafeE2eDatabaseUrl(process.env.DATABASE_URL ?? '')
assert.equal(process.env.DATABASE_URL, E2E_DATABASE_URL)
assert.equal(process.env.WELDING_ENV_LOADED, '1')
const [{ requireDb }, schema, dispatcher] = await Promise.all([
  import('../src/db'), import('../src/db/schema'), import('../src/server/dispatcher-task-index'),
])
const { weldJoints, dispatcherTaskIndexState, dispatcherTaskPages, dispatcherRowTasks } = schema
const { markDispatcherTaskIndexDirty, ensureDispatcherTaskIndexFresh } = dispatcher
const db = requireDb(), project = 'E2E dispatcher atomic catch-up'
assert.equal((await db.select({ id: weldJoints.id }).from(weldJoints).where(eq(weldJoints.projectTitle, project))).length, 0)
const original = pg.Client.prototype.query
let onWideRead: (() => Promise<void>) | undefined, wideReads = 0, pageStages = 0, failCatchUp = false
const originalError = console.error
let expectedFailure = false
const isExpectedFailure = (value: unknown): boolean => value instanceof Error &&
  (value.message === 'EXPECTED_ATOMIC_CATCHUP_ROLLBACK' || isExpectedFailure(value.cause))
console.error = (...args) => { if (!expectedFailure || !args.some(isExpectedFailure)) originalError(...args) }
const readPublished = async () => {
  const states = await db.select().from(dispatcherTaskIndexState)
  const pages = await db.select().from(dispatcherTaskPages).orderBy(dispatcherTaskPages.scopeKey, dispatcherTaskPages.pageNumber)
  const codes = await db.select().from(dispatcherRowTasks).orderBy(dispatcherRowTasks.weldJointId, dispatcherRowTasks.code)
  return { states, pages, codes }
}
let publicationBefore: Awaited<ReturnType<typeof readPublished>>
pg.Client.prototype.query = function (this: pg.Client, ...args: Parameters<pg.Client['query']>) {
  const text = typeof args[0] === 'string' ? args[0] : (args[0] as { text?: string })?.text ?? ''
  if (/create temporary table pg_temp\."dispatcher_task_page_stage"/.test(text)) {
    pageStages++
    if (failCatchUp && pageStages === 2) {
      return (async () => {
        // A separate transaction must still see the old publication while the
        // replacement and catch-up are uncommitted, including before failure.
        assert.deepEqual(await readPublished(), publicationBefore)
        throw new Error('EXPECTED_ATOMIC_CATCHUP_ROLLBACK')
      })() as unknown as ReturnType<pg.Client['query']>
    }
  }
  const result = (original as (...values: unknown[]) => unknown).apply(this, args)
  // Both Drizzle select() and the flat schema-decoded reader issue this bounded
  // wide read; indentation/newlines must not disable concurrent-write injection.
  if (/^\s*select\b/i.test(text) && text.includes('"technology_card_number"') &&
    /from\s+"weld_joints"\s+where\b/i.test(text) && /\bany\s*\(/i.test(text)) {
    wideReads++
    if (onWideRead) {
      const mutation = onWideRead; onWideRead = undefined
      return Promise.resolve(result).then(async value => { await mutation(); return value }) as unknown as ReturnType<pg.Client['query']>
    }
  }
  return result as ReturnType<pg.Client['query']>
} as typeof original

const scope = (line: string) => ({ projectTitle: project, subtitleCode: 'S', line })
try {
  const rows = await db.insert(weldJoints).values(['A', 'A', 'D'].map((line, i) => ({
    ...scope(line), joint: `F${i + 1}`, weldDate: '2026-09-01', hasVik: 'да', officiality: 'действующий',
  }))).returning()
  const [changed, moved, removed] = rows
  const [aliasRepair, aliasOfficial] = await db.insert(weldJoints).values([
    { ...scope('A\u00a01'), joint: 'ALIAS', officiality: 'неофициальный', weldDate: '2026-09-01', hasVik: 'да', vikResult: 'ремонт' },
    { ...scope('A1'), joint: 'ALIAS', officiality: 'действующий' },
  ]).returning()
  assert(aliasRepair.id)
  await markDispatcherTaskIndexDirty(db)
  await ensureDispatcherTaskIndexFresh()
  const [beforeAlias] = await db.select().from(weldJoints).where(eq(weldJoints.id, aliasOfficial.id))
  assert.equal(beforeAlias.finalStatus, 'ожидает ремонт', 'An unwelded same-name repair retains the factual rejected predecessor')
  await markDispatcherTaskIndexDirty(db)
  wideReads = 0; pageStages = 0
  let insertedId = 0
  onWideRead = () => db.transaction(async tx => {
    await tx.update(weldJoints).set({ vikResult: 'вырез' }).where(eq(weldJoints.id, changed.id))
    await tx.update(weldJoints).set({ line: 'B' }).where(eq(weldJoints.id, moved.id))
    await tx.delete(weldJoints).where(eq(weldJoints.id, removed.id))
    const [inserted] = await tx.insert(weldJoints).values({ ...scope('B'), joint: 'NEW', officiality: 'действующий' }).returning({ id: weldJoints.id })
    insertedId = inserted.id
    await tx.update(weldJoints).set({ isometry: 'Concurrent fact, same repair context' }).where(eq(weldJoints.id, aliasOfficial.id))
    await markDispatcherTaskIndexDirty(tx, { scopes: ['A', 'B', 'D', 'A1'].map(scope) })
  })
  const caughtUp = await ensureDispatcherTaskIndexFresh()
  assert.equal(caughtUp.computedRevision, caughtUp.sourceRevision)
  assert.equal(wideReads, 1, 'Scoped concurrent writes must not restart the complete calculation')
  assert.equal(pageStages, 2, 'One full stage and one atomic scoped catch-up')
  const facts = await db.select().from(weldJoints).where(eq(weldJoints.projectTitle, project))
  assert.equal(facts.find(row => row.id === changed.id)?.finalStatus, 'не годен')
  assert.equal(facts.find(row => row.id === moved.id)?.line, 'B')
  assert.equal(facts.find(row => row.id === insertedId)?.finalStatus, 'ожидает сварку')
  assert.equal(facts.find(row => row.id === aliasOfficial.id)?.finalStatus, 'ожидает ремонт', 'Keep Unicode-whitespace repair context during catch-up')
  assert(!facts.some(row => row.id === removed.id))
  const published = await readPublished()
  assert(!published.codes.some(row => row.weldJointId === removed.id))
  await markDispatcherTaskIndexDirty(db)
  await ensureDispatcherTaskIndexFresh()
  const independentlyRebuilt = await readPublished()
  // JSON object property order is not document/task order. Optional relation
  // arrays already default to [] in consumers; in-place preparation omits them
  // when empty. Keep every nonempty relation, all facts and task array ordering.
  const pageValues = (pages: typeof published.pages) => pages.map(page => ({ ...page, tasks: JSON.parse(page.tasks,
    (key, value) => ['duplicateControls', 'preHeatTreatmentControls', 'pstoRepeatCycles'].includes(key) &&
      Array.isArray(value) && value.length === 0 ? undefined : value) }))
  assert.deepEqual(pageValues(published.pages), pageValues(independentlyRebuilt.pages))
  assert.deepEqual(published.codes, independentlyRebuilt.codes)

  // A later global change is different: never reuse old settings or permits.
  await markDispatcherTaskIndexDirty(db)
  wideReads = 0; pageStages = 0
  onWideRead = async () => { await markDispatcherTaskIndexDirty(db) }
  const globallyRetried = await ensureDispatcherTaskIndexFresh()
  assert.equal(globallyRetried.sourceRevision, globallyRetried.computedRevision)
  assert.equal(wideReads, 2, 'A new global generation requires a complete retry')

  await markDispatcherTaskIndexDirty(db)
  pageStages = 0; failCatchUp = true; expectedFailure = true
  onWideRead = () => db.transaction(async tx => {
    await tx.update(weldJoints).set({ vikResult: 'годен' }).where(eq(weldJoints.id, changed.id))
    await markDispatcherTaskIndexDirty(tx, { scopes: [scope('A')] })
    // Read the invalidated state after the committed concurrent write below.
  }).then(async () => { publicationBefore = await readPublished() })
  await assert.rejects(ensureDispatcherTaskIndexFresh(), isExpectedFailure)
  assert.deepEqual(await readPublished(), publicationBefore!)
  failCatchUp = false; expectedFailure = false
  const recovered = await ensureDispatcherTaskIndexFresh()
  assert.equal(recovered.sourceRevision, recovered.computedRevision)
  const [current] = await db.select().from(weldJoints).where(and(eq(weldJoints.projectTitle, project), eq(weldJoints.id, changed.id)))
  assert.equal(current.vikResult, 'годен')
  assert.equal(current.finalStatus, 'годен')
  console.log(JSON.stringify({ scopedCatchUp: true, createMoveDelete: true, matchesFullRebuild: true,
    globalChangeRetried: true, atomicPublication: true, rollbackAndRetry: true }))
} finally {
  pg.Client.prototype.query = original
  console.error = originalError
  await db.delete(weldJoints).where(eq(weldJoints.projectTitle, project))
  await markDispatcherTaskIndexDirty(db)
}
