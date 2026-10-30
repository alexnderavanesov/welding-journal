import { asE2eOwner } from '../e2e/with-owner-access'
import assert from 'node:assert/strict'
import pg from 'pg'
import { and, eq, getTableColumns, sql } from 'drizzle-orm'
import { E2E_DATABASE_URL, assertSafeE2eDatabaseUrl } from '../e2e/database'

assertSafeE2eDatabaseUrl(process.env.DATABASE_URL ?? '')
assert.equal(process.env.DATABASE_URL, E2E_DATABASE_URL)
assert.equal(process.env.WELDING_ENV_LOADED, '1')
const [{ requireDb }, { weldJoints, weldJointProgramStates }, dispatcher, journal] = await Promise.all([
  import('../src/db'), import('../src/db/schema'), import('../src/server/dispatcher-task-index'), import('../src/server/journal-grid'),
])
const db = requireDb(), project = 'E2E journal refresh protocol'
assert.equal((await db.select().from(weldJoints).where(eq(weldJoints.projectTitle, project))).length, 0)
const scope = (line: string) => ({ projectTitle: project, subtitleCode: 'S', line })
const mark = dispatcher.markDispatcherTaskIndexDirty
try {
  const rows = await db.insert(weldJoints).values(['A B', 'AB', 'OTHER', 'OTHER', 'A\u00a0B', 'A\u00a0B'].map(line => ({
    ...scope(line), joint: 'F1', officiality: 'действующий', isometry: 'BEFORE', wdi: 12.34, weldDate: '2026-10-01',
  }))).returning()
  await db.insert(weldJointProgramStates).values({ weldJointId: rows[1].id, kind: 'primary', physicalRootId: rows[1].id })
  await mark(db)
  const initial = await dispatcher.ensureDispatcherTaskIndexFresh()
  assert(JSON.parse(initial.duplicateKeys).length >= 2)
  const checkAgainstFull = async (scopes: ReturnType<typeof scope>[]) => {
    await mark(db, { scopes })
    const partial = await dispatcher.ensureDispatcherTaskIndexFresh()
    await mark(db)
    const full = await dispatcher.ensureDispatcherTaskIndexFresh()
    assert.deepEqual(JSON.parse(partial.duplicateKeys).sort(), JSON.parse(full.duplicateKeys).sort())
  }
  await db.update(weldJoints).set({ line: 'MOVED' }).where(eq(weldJoints.id, rows[0].id))
  await checkAgainstFull([scope('A B'), scope('MOVED')])
  await db.delete(weldJoints).where(eq(weldJoints.id, rows[4].id))
  await checkAgainstFull([scope('A\u00a0B')])
  await db.update(weldJoints).set({ officiality: 'неофициальный' }).where(eq(weldJoints.id, rows[2].id))
  await checkAgainstFull([scope('OTHER')])
  await db.delete(weldJoints).where(eq(weldJoints.id, rows[0].id))
  await checkAgainstFull([scope('MOVED')])

  // Dirty scopes trim ECMAScript whitespace, whereas PostgreSQL's duplicate
  // identity can retain NBSP. Deleting the complete old identity must remove
  // its key even when no surviving row can reveal the original spelling.
  const legacyLine = '\u00a0EDGE\u00a0'
  await db.insert(weldJoints).values([1, 2].map(() => ({ ...scope(legacyLine), joint: 'F1', officiality: 'действующий' })))
  await mark(db)
  await dispatcher.ensureDispatcherTaskIndexFresh()
  await db.delete(weldJoints).where(and(eq(weldJoints.projectTitle, project), eq(weldJoints.line, legacyLine)))
  await checkAgainstFull([scope(legacyLine)])

  // Decode actual PostgreSQL dates/numerics/nulls using the same schema as
  // Drizzle's select; missing joined objects must remain null.
  const { readJournalSummaryProjection } = await import('../src/server/journal-summary-hydration')
  const projection = { id: weldJoints.id, wdi: weldJoints.wdi, weldDate: weldJoints.weldDate, createdAt: weldJoints.createdAt }
  const direct = await db.select(projection).from(weldJoints).where(eq(weldJoints.projectTitle, project)).orderBy(weldJoints.id)
  const flat = await readJournalSummaryProjection<{ row: typeof direct[number]; missing: null }>(db, { row: projection, missing: { id: sql`null`, value: sql`null` } },
    sql`from ${weldJoints} where ${weldJoints.projectTitle} = ${project} order by ${weldJoints.id}`)
  assert.deepEqual(flat.map(value => value.row), direct)
  assert(flat.every(value => value.missing === null))
  const joinedProjection = { row: projection, state: getTableColumns(weldJointProgramStates) }
  const joined = await db.select(joinedProjection).from(weldJoints).leftJoin(weldJointProgramStates, eq(weldJointProgramStates.weldJointId, weldJoints.id))
    .where(eq(weldJoints.projectTitle, project)).orderBy(weldJoints.id)
  const flatJoined = await readJournalSummaryProjection(db, joinedProjection, sql`from ${weldJoints}
    left join ${weldJointProgramStates} on ${weldJointProgramStates.weldJointId} = ${weldJoints.id}
    where ${weldJoints.projectTitle} = ${project} order by ${weldJoints.id}`)
  assert.deepEqual(flatJoined, joined)

  const query = { columnFilters: { search: project }, groupBy: [] as never[], sort: { fieldKey: 'joint' as const, direction: 'asc' as const } }
  const blocks = [{ route: [], start: 0, end: 1 }, { route: [], start: 1, end: 2 }]
  const original = pg.Client.prototype.query
  let changed = false
  pg.Client.prototype.query = function (this: pg.Client, ...args: Parameters<pg.Client['query']>) {
    const text = typeof args[0] === 'string' ? args[0] : (args[0] as { text?: string })?.text ?? ''
    const result = (original as (...values: unknown[]) => unknown).apply(this, args)
    if (!changed && /^\s*select/i.test(text) && /from "weld_joints"/.test(text) && text.includes('"technology_card_number"') && /limit/.test(text)) {
      changed = true
      return Promise.resolve(result).then(async reply => {
        await db.transaction(async tx => {
          await tx.update(weldJoints).set({ isometry: 'CONCURRENT' }).where(eq(weldJoints.projectTitle, project))
          await mark(tx, { scopes: ['AB', 'OTHER', 'A\u00a0B'].map(scope) })
        })
        return reply
      }) as unknown as ReturnType<pg.Client['query']>
    }
    return result as ReturnType<pg.Client['query']>
  } as typeof original
  let results: Awaited<ReturnType<typeof journal.readJournalGridBlocks>>
  try { results = await asE2eOwner(journal.readJournalGridBlocks, 'welding.view')({ ...query, blocks }) }
  finally { pg.Client.prototype.query = original }
  assert(changed, 'Concurrent writer must run between the two block reads')
  assert.equal(results.length, 2)
  assert.equal(results[0].revision, results[1].revision)
  assert(results.every(result => result.rows.length === 1 && result.rows[0].isometry === 'BEFORE'))
  await assert.rejects(asE2eOwner(journal.readJournalGridBlocks, 'welding.view')({ ...query, blocks, revision: results[0].revision }), /изменились/)
  await assert.rejects(asE2eOwner(journal.readJournalGridBlocks, 'welding.view')({ ...query, blocks: Array(33).fill(blocks[0]) }), /набор блоков/)
  await assert.rejects(asE2eOwner(journal.readJournalGridBlocks, 'welding.view')({ ...query, blocks }, AbortSignal.abort()), /aborted/)

  // Copy/range readers hold a checked context, but read outside a transaction
  // and reject a concurrent writer at the end. Their discarded aggregates must
  // never contaminate a grid transaction that legitimately retains the old view.
  const groupContext = await asE2eOwner(journal.journalReadContext, 'welding.view')({
    columnFilters: { projectTitle: '=' + project, line: '=AB' },
    groupBy: ['line'], route: [], start: 0, end: 100,
  })
  groupContext.settings = { ...groupContext.settings, wdiCalculationMode: 'manual' }
  await db.transaction(async snapshot => {
    await journal.assertJournalContextRevision(groupContext, snapshot)
    await db.transaction(async writer => {
      await writer.update(weldJoints).set({ wdi: 98.76 }).where(eq(weldJoints.id, rows[1].id))
      await mark(writer, { scopes: [scope('AB')] })
    })
    const discardedRange = await journal.readJournalPage(groupContext)
    assert.equal(discardedRange.rows[0].journalGroup?.summary.wdi, 98.76)
    await assert.rejects(journal.assertJournalContextRevision(groupContext), /изменились/)
    const coherentGrid = await journal.readJournalPage({ ...groupContext, db: snapshot })
    assert.equal(coherentGrid.rows[0].journalGroup?.summary.wdi, 12.34)
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
  // The schema index and query normalization must agree on every whitespace
  // character, including CR and NBSP after generated SQL is checked out.
  const { DISPATCHER_SCOPE_WHITESPACE, DISPATCHER_SCOPE_WHITESPACE_SQL } = await import('../src/lib/dispatcher-scope-normalization')
  const normalized = await db.execute<{ same: boolean }>(sql`select ${sql.raw(DISPATCHER_SCOPE_WHITESPACE_SQL)} = ${DISPATCHER_SCOPE_WHITESPACE} as same`)
  assert.equal(normalized.rows[0].same, true)
  const indexes = await db.execute<{ indexdef: string }>(sql`select indexdef from pg_indexes where indexname = 'weld_joints_compact_line_identity_idx'`)
  assert.equal(indexes.rows.length, 1)
  console.log(JSON.stringify({ scopedDuplicates: true, schemaDecoders: true, coherentBatch: true, staleRejected: true, groupCacheIsolation: true }))
} finally {
  await db.delete(weldJoints).where(eq(weldJoints.projectTitle, project))
  await mark(db)
}
