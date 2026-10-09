import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from '../src/db/schema'
import {
  createTechnologyCardInTransaction,
  deleteTechnologyCardInTransaction,
  loadTechnologyCardMatcher,
  markTechnologyCardsUsed,
  readTechnologyCardNameHistory,
  readTechnologyCardPage,
  resolveTechnologyCardNames,
  setTechnologyCardArchivedInTransaction,
  updateTechnologyCardInTransaction,
} from '../src/server/technology-card-registry'
import { lockTechnologyCardRegistry } from '../src/server/technology-card-registry-lock'
import { prepareTechnologyCardWeldWrites } from '../src/server/technology-card-weld-write'
import { createTechnologyCardReview } from '../src/lib/technology-card-review'
import { buildTechnologyCardTasks } from '../src/lib/technology-card-tasks'
import { buildDispatcherTaskCodeIndexRows } from '../src/lib/dispatcher-task-row-codes'
import { DEFAULT_DATA_LIST_SETTINGS } from '../src/lib/data-list-settings'
import type { WeldRow } from '../src/lib/dispatcher-types'
import { scanTechnologyCardAssignments, readTechnologyCardAssignmentDetails, applyTechnologyCardAssignments } from '../src/server/technology-card-assignment'
import { readDispatcherTaskVersion } from '../src/server/dispatcher-task-version'
import type { TechnologyCardAssignmentChunk, TechnologyCardAssignmentContext } from '../src/lib/technology-card-assignment'

// A dedicated empty local DB is owned by this run only. No .env, no CLI target,
// no connection to the working database and no replacement of existing fixtures.
const databaseName = 'welding_tracker_technology_cards_test_20261008'
const baseUrl = 'postgresql://welding:welding@127.0.0.1:5432/'
const connectionString = baseUrl + databaseName
// The full dispatcher test below uses the application's pool as well as this
// script's instrumented pool. Both must be pinned to the same disposable DB.
assert.equal(process.env.DATABASE_URL, connectionString, 'Set DATABASE_URL to this exact disposable local database')
assert.equal(process.env.WELDING_ENV_LOADED, '1', 'Do not load application .env during an isolated test')
const command = (program: string, args: string[], env = process.env) => {
  const result = spawnSync(program, args, { encoding: 'utf8', env, timeout: 60_000 })
  assert.equal(result.status, 0, `${program}: ${result.error ?? ''} ${result.stderr ?? ''}\n${result.stdout ?? ''}`)
  return result.stdout.trim()
}
assert.equal(command('git', ['branch', '--show-current']), 'main', 'Migrations require main')
assert.equal(new URL(connectionString).hostname, '127.0.0.1')
assert.equal(new URL(connectionString).pathname, '/' + databaseName)
const admin = new pg.Client({ connectionString: baseUrl + 'postgres' })
const pool = new pg.Pool({ connectionString, max: 4 })
const statements: string[] = []
const db = drizzle(pool, { schema, logger: { logQuery(query) { statements.push(query) } } })
const card = {
  name: 'ТК №12', weldingMethods: ['РАД', 'РД'], connectionType: 'С17', materialGroups: ['М01', 'М05'],
  diameterFrom: 57, diameterTo: 108, thicknessFrom: 3, thicknessTo: 6, psto: 'any',
}
const measured = async <T>(label: string, maxQueries: number, action: () => Promise<T>) => {
  statements.length = 0
  const start = performance.now()
  const result = await action()
  assert(statements.length <= maxQueries, `${label}: ${statements.length} queries, expected <= ${maxQueries}`)
  console.log(JSON.stringify({ label, queries: statements.length, ms: Math.round(performance.now() - start) }))
  return result
}
let ownedOid: number | undefined
await admin.connect()
try {
  assert.equal((await admin.query('select oid from pg_database where datname=$1', [databaseName])).rowCount, 0, 'Refuse an existing test database')
  await admin.query(`create database ${databaseName}`)
  ownedOid = (await admin.query('select oid from pg_database where datname=$1', [databaseName])).rows[0].oid
  assert(ownedOid, 'Cannot verify ownership')
  const identity = (await pool.query("select current_database() as name, (select count(*)::int from information_schema.tables where table_schema='public') as tables")).rows[0]
  assert.equal(identity.name, databaseName)
  assert.equal(identity.tables, 0, 'Test setup requires an empty isolated DB')
  console.log(JSON.stringify({ database: identity.name, host: '127.0.0.1', empty: true }))
  command('pnpm', ['db:migrate'], { ...process.env, DATABASE_URL: connectionString, WELDING_ENV_LOADED: '1' })

  await pool.query(`insert into weld_joints(joint,weld_date,welding_method,connection_type,material_group,d1,d2,t1,t2,psto_required,technology_card_number)
    select 'F'||n,'2026-10-08','РАД+РД','С17','М05 + М01',57,159,6,3,'да',
      case when n=200000 then '  ТК №12  ' when n=199999 then 'Старая неизвестная карта' else null end
    from generate_series(1,200000) n`)
  await pool.query('analyze weld_joints')
  const facts = async () => (await pool.query("select count(*)::int as n, md5(string_agg(md5(to_jsonb(w)::text),'' order by id)) as hash from weld_joints w")).rows[0]
  const before = await facts()
  assert.equal(before.n, 200000)

  let used = await measured('create card referring to legacy text among 200000 joints', 9, () => db.transaction(tx => createTechnologyCardInTransaction(tx, card)))
  assert.equal(used.name, 'ТК №12')
  const marker = (await pool.query('select first_used_at from technology_cards where id=$1', [used.id])).rows[0]
  assert(marker.first_used_at)
  await assert.rejects(db.transaction(tx => createTechnologyCardInTransaction(tx, card)), /уже существует/)
  await assert.rejects(db.transaction(tx => createTechnologyCardInTransaction(tx, { ...card, name: 'BAD', materialGroups: ['M01'], diameterFrom: -1 })), /M01[\s\S]*Диаметр от/)
  await assert.rejects(db.transaction(tx => deleteTechnologyCardInTransaction(tx, { id: used.id, expectedRevision: used.revision, confirmed: true })), /уже использована/)

  used = await db.transaction(tx => updateTechnologyCardInTransaction(tx, { id: used.id, expectedRevision: used.revision, card: { ...card, name: 'Техкарта №2' } }))
  const resolved = await db.transaction(tx => resolveTechnologyCardNames(tx, [' ТК №12 ', 'Техкарта №2', 'Старая неизвестная карта']))
  assert.equal(resolved.get('ТК №12')?.id, used.id)
  assert.equal(resolved.get('Техкарта №2')?.id, used.id)
  assert(!resolved.has('Старая неизвестная карта'))
  assert.equal(resolved.get('ТК №12')?.name, 'Техкарта №2')
  assert.deepEqual((await db.transaction(tx => readTechnologyCardNameHistory(tx, used.id))).map(item => item.name), ['ТК №12', 'Техкарта №2'])
  await assert.rejects(db.transaction(tx => createTechnologyCardInTransaction(tx, card)), /уже существует/)
  await assert.rejects(db.transaction(tx => updateTechnologyCardInTransaction(tx, { id: used.id, expectedRevision: used.revision - 1, card })), /уже изменена/)

  const draft = await db.transaction(tx => createTechnologyCardInTransaction(tx, { ...card, name: 'Неиспользованная ТК' }))
  await assert.rejects(db.transaction(tx => deleteTechnologyCardInTransaction(tx, { id: draft.id, expectedRevision: draft.revision, confirmed: false })), /Подтвердите/)
  const raced = await Promise.allSettled(Array.from({ length: 5 }, () => db.transaction(tx => setTechnologyCardArchivedInTransaction(tx, { id: draft.id, expectedRevision: draft.revision, archived: true }))))
  assert.equal(raced.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(raced.filter(result => result.status === 'rejected' && /уже изменена/.test(String(result.reason))).length, 4)
  await assert.rejects(db.transaction(tx => createTechnologyCardInTransaction(tx, { ...card, name: draft.name })), /уже существует/)
  const deleted = await db.transaction(tx => deleteTechnologyCardInTransaction(tx, { id: draft.id, expectedRevision: draft.revision + 1, confirmed: true }))
  assert.equal(deleted.id, draft.id)
  assert.equal((await db.transaction(tx => resolveTechnologyCardNames(tx, [draft.name]))).size, 0)

  // A legacy name can appear through an older client after a rename. Even before
  // the sticky usage marker is recorded, deletion must detect this reference.
  await assert.rejects(db.transaction(async tx => {
    const original = await createTechnologyCardInTransaction(tx, { ...card, name: 'Прежнее название' })
    const renamed = await updateTechnologyCardInTransaction(tx, { id: original.id, expectedRevision: original.revision, card: { ...card, name: 'Новое название' } })
    await tx.insert(schema.weldJoints).values({ joint: 'F-ROLLBACK', technologyCardNumber: original.name })
    await deleteTechnologyCardInTransaction(tx, { id: renamed.id, expectedRevision: renamed.revision, confirmed: true })
  }), /уже использована/)

  // No N+1 queries or full journal reads when browsing the registry.
  const values = Array.from({ length: 205 }, (_, i) => ({ ...card, name: `Дополнительная ТК ${i}`, psto: 'any' as const, archived: true }))
  await db.insert(schema.technologyCards).values(values)
  const page = await measured('registry page among 200000 joints', 3, () => db.transaction(tx => readTechnologyCardPage(tx, { archive: 'all', limit: 200000 })))
  assert.equal(page.items.length, 100)
  assert(page.nextCursor)
  assert(!statements.some(query => query.includes('weld_joints')), 'Registry page must not read the journal')
  const next = await db.transaction(tx => readTechnologyCardPage(tx, { archive: 'all', afterId: page.nextCursor! }))
  assert(next.items.every(item => item.id > page.nextCursor!))
  const literalSearch = await db.transaction(tx => readTechnologyCardPage(tx, { search: '%' }))
  assert.equal(literalSearch.items.length, 0)

  const matcher = await measured('load matcher snapshot once per batch', 6, () => db.transaction(loadTechnologyCardMatcher))
  const weld = { weldingMethod: 'РАД+РД', connectionType: 'С17', materialGroup: 'М05 + М01', d1: 57, d2: 159, t1: 6, t2: 3, pstoRequired: 'да' }
  const started = performance.now()
  for (let i = 0; i < 200000; i++) assert.equal(matcher.match(weld).cards[0]?.id, used.id)
  console.log(JSON.stringify({ label: 'pure matcher 200000 profiles', ms: Math.round(performance.now() - started), additionalQueries: 0 }))

  const writeRows: WeldRow[] = Array.from({ length: 200000 }, (_, i) => ({ ...weld, id: i + 1, joint: `F${i + 1}`, weldDate: '2026-10-08' }))
  const review = createTechnologyCardReview({ cards: [used], names: [{ name: used.name, cardId: used.id }] }, DEFAULT_DATA_LIST_SETTINGS)
  const taskStarted = performance.now()
  const tasks = buildTechnologyCardTasks(writeRows, review)
  assert.equal(tasks.length, 200000)
  assert.equal(buildDispatcherTaskCodeIndexRows(tasks, writeRows).length, 200000)
  console.log(JSON.stringify({ label: 'DZ-06 and row index for 200000 dated blank cards', ms: Math.round(performance.now() - taskStarted), additionalQueries: 0 }))
  await measured('prepare first-date assignment for 200000 final merged rows', 10, () => db.transaction(tx => prepareTechnologyCardWeldWrites(tx, writeRows, new Map())))
  assert(writeRows.every(row => row.technologyCardNumber === used.name))
  await measured('unrelated edit of 200000 already dated rows', 2, () => db.transaction(tx => prepareTechnologyCardWeldWrites(tx, writeRows, new Map(writeRows.map(row => [row.id, row])))))

  const sticky = await db.transaction(tx => createTechnologyCardInTransaction(tx, { ...card, name: 'История использования' }))
  const largeBatch = Array.from({ length: 200000 }, (_, i) => ({ technologyCardNumber: i === 0 ? sticky.name : `Неизвестная карта ${i}` }))
  await measured('usage marking for 200000 distinct names', 4, () => db.transaction(tx => markTechnologyCardsUsed(tx, largeBatch)))
  const largeResolved = await measured('resolve 200000 distinct names in one query', 3, () => db.transaction(tx => resolveTechnologyCardNames(tx, largeBatch.map(row => row.technologyCardNumber))))
  assert.equal(largeResolved.size, 1)
  await assert.rejects(db.transaction(tx => deleteTechnologyCardInTransaction(tx, { id: sticky.id, expectedRevision: sticky.revision, confirmed: true })), /уже использована/)

  // A held assignment snapshot must block an edit until the assignment commits.
  let release!: () => void
  let acquired!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  const locked = new Promise<void>(resolve => { acquired = resolve })
  const reader = db.transaction(async tx => { await lockTechnologyCardRegistry(tx); acquired(); await held })
  await locked
  try {
    await assert.rejects(db.transaction(async tx => {
      await tx.execute((await import('drizzle-orm')).sql`set local lock_timeout = '100ms'`)
      await setTechnologyCardArchivedInTransaction(tx, { id: used.id, expectedRevision: used.revision, archived: true })
    }), error => String((error as { cause?: unknown }).cause ?? error).includes('lock timeout'))
  } finally { release(); await reader }
  await db.transaction(tx => setTechnologyCardArchivedInTransaction(tx, { id: used.id, expectedRevision: used.revision, archived: true }))
  const restored = await db.transaction(tx => setTechnologyCardArchivedInTransaction(tx, { id: used.id, expectedRevision: used.revision + 1, archived: false }))
  const narrowed = await db.transaction(tx => updateTechnologyCardInTransaction(tx, { id: restored.id, expectedRevision: restored.revision, card: { ...card, name: restored.name, diameterFrom: 89 } }))
  assert.equal((await db.transaction(loadTechnologyCardMatcher)).match(weld).cards.some(item => item.id === narrowed.id), false)
  assert.equal((await db.transaction(tx => resolveTechnologyCardNames(tx, ['ТК №12']))).get('ТК №12')?.diameterFrom, 89)

  const plan = (await pool.query('explain (format json) select id from weld_joints where btrim(technology_card_number)=$1 limit 1', ['ТК №12'])).rows[0]['QUERY PLAN']
  assert(JSON.stringify(plan).includes('weld_joints_technology_card_name_idx'), 'Legacy reference check should use its index')
  assert.deepEqual(await facts(), before, 'Registry operations must preserve every joint fact and timestamp')
  command('pnpm', ['db:migrate'], { ...process.env, DATABASE_URL: connectionString, WELDING_ENV_LOADED: '1' })
  assert.deepEqual(await facts(), before, 'Repeated migrations must preserve every joint fact')
  console.log(JSON.stringify({ result: 'passed', joints: 200000, factsPreserved: true, legacyReferenceIndexUsed: true, staleClientsRejected: 4 }))

  // Explicit bulk assignment: isolated synthetic records only. Above assertions
  // already verified that registry operations/migrations preserve the journal.
  await pool.query('update technology_cards set archived=true,revision=revision+1')
  const bulkCard = await db.transaction(tx => createTechnologyCardInTransaction(tx, { ...card, name: 'Массовая ТК' }))
  const protectedFacts = async () => (await pool.query("select md5(string_agg(md5((to_jsonb(w)-'technology_card_number'-'updated_at'-'welding_updated_at')::text),'' order by id)) as hash from weld_joints w")).rows[0].hash
  const unchangedFacts = await protectedFacts()
  const scanStart = performance.now()
  let context: TechnologyCardAssignmentContext | undefined, cursor = 0
  const chunks: TechnologyCardAssignmentChunk[] = []
  let scanQueries = 0, scanRequests = 0
  do {
    statements.length = 0
    const part = await db.transaction(tx => scanTechnologyCardAssignments(tx, { context, afterId: cursor }))
    assert(statements.length <= 9, `Preview N+1: ${statements.length}`)
    scanQueries += statements.length; scanRequests++
    context = part.context; chunks.push(...part.chunks)
    assert(!JSON.stringify(part).includes('technologyCardNumber'), 'Preview must not return the journal')
    if (part.nextCursor === null) break
    cursor = part.nextCursor
  } while (true)
  assert.equal(chunks.length, 400)
  assert.equal(chunks.reduce((n, c) => n + c.size, 0), 200000)
  assert.equal(chunks.reduce((n, c) => n + c.counts.assign, 0), 199998)
  assert.equal(chunks.reduce((n, c) => n + c.counts.reassign, 0), 2)
  assert.deepEqual(await facts(), before, 'Preview must not change welds')
  console.log(JSON.stringify({ label: 'bulk preview 200000', requests: scanRequests, queries: scanQueries, ms: Math.round(performance.now() - scanStart), browserDescriptorBytes: Buffer.byteLength(JSON.stringify(chunks)) }))
  const details = await measured('bulk detail bounded to 500', 8, () => db.transaction(tx => readTechnologyCardAssignmentDetails(tx, { context: context!, chunk: chunks[0] })))
  assert.equal(details.length, 500)
  assert(details.every(row => row.kind === 'assign'))
  const first = { context: context!, chunk: chunks[0], actions: ['assign'] as const, excludedIds: [details[0].id] }
  const applyFirst = () => db.transaction(tx => applyTechnologyCardAssignments(tx, { ...first, actions: [...first.actions] }))
  const assignmentCheckpoint = async () => ({
    facts: await facts(),
    bookkeeping: (await pool.query(`select jsonb_build_object(
      'cards', (select jsonb_agg(to_jsonb(c) order by id) from technology_cards c),
      'dispatcher', (select jsonb_agg(to_jsonb(s) order by id) from dispatcher_task_index_state s),
      'derived', (select jsonb_agg(to_jsonb(s) order by id) from derived_calculation_state s),
      'cache', (select jsonb_agg(to_jsonb(c) order by to_jsonb(c)::text) from derived_calculation_cache c)
    ) as value`)).rows[0].value,
  })
  const beforeFailure = await assignmentCheckpoint()
  await assert.rejects(db.transaction(async tx => {
    const saved = await applyTechnologyCardAssignments(tx, { ...first, actions: [...first.actions] })
    assert.equal(saved.assign, 499)
    // Fail after every actual write, including usage and dispatcher invalidation.
    throw new Error('AUDIT: fail before transaction commit')
  }), /AUDIT: fail before transaction commit/)
  assert.deepEqual(await assignmentCheckpoint(), beforeFailure, 'A failed packet must roll back facts, usage markers and both derived indexes')
  await assert.rejects(db.transaction(tx => applyTechnologyCardAssignments(tx, {
    ...first, actions: [...first.actions], chunk: { ...first.chunk, throughId: chunks[1].throughId },
  })), /порция уже сохранена/)
  assert.deepEqual(await assignmentCheckpoint(), beforeFailure, 'An oversized forged packet must not partially apply')
  console.log(JSON.stringify({ label: 'bulk rollback after all writes and oversized packet', factsAndIndexesPreserved: true }))
  assert.deepEqual(await measured('bulk apply 499 in one batch', 13, applyFirst), { assign: 499, reassign: 0, rename: 0 })
  await assert.rejects(applyFirst(), /порция уже сохранена/)
  assert.equal((await pool.query('select technology_card_number from weld_joints where id=$1', [details[0].id])).rows[0].technology_card_number, null)
  assert.equal(await protectedFacts(), unchangedFacts)
  const second = { ...first, chunk: chunks[1], excludedIds: [], actions: ['assign' as const] }
  const racedAssignment = await Promise.allSettled([0, 1].map(() => db.transaction(tx => applyTechnologyCardAssignments(tx, second))))
  assert.equal(racedAssignment.filter(r => r.status === 'fulfilled').length, 1)
  assert.equal(racedAssignment.filter(r => r.status === 'rejected' && /порция уже сохранена/.test(String(r.reason))).length, 1)
  await pool.query("update weld_joints set technology_card_number='Другой пользователь',updated_at=clock_timestamp() where id=$1", [chunks[2].throughId])
  await assert.rejects(db.transaction(tx => applyTechnologyCardAssignments(tx, { ...second, chunk: chunks[2] })), /Стыки в этой порции изменились/)
  assert.equal((await pool.query('select count(*)::int as n from weld_joints where id>$1 and id<=$2 and technology_card_number is null', [chunks[2].afterId, chunks[2].throughId])).rows[0].n, 499)
  const bulkStart = performance.now()
  let applyQueries = 0
  for (const chunk of chunks.slice(3)) {
    statements.length = 0
    const saved: { assign: number; reassign: number; rename: number } = await db.transaction(tx => applyTechnologyCardAssignments(tx, { context: context!, chunk, actions: ['assign', 'reassign', 'rename'], excludedIds: [] }))
    assert(statements.length <= 13, `Apply N+1: ${statements.length}`)
    assert.equal(saved.assign + saved.reassign, 500)
    applyQueries += statements.length
  }
  assert.equal(await protectedFacts(), unchangedFacts, 'Bulk writes must not modify materials, results, dates, documents or other facts')
  console.log(JSON.stringify({ label: 'bulk apply remaining 198500', requests: 397, queries: applyQueries, ms: Math.round(performance.now() - bulkStart), preservedOtherFacts: true }))
  await db.transaction(tx => updateTechnologyCardInTransaction(tx, { id: bulkCard.id, expectedRevision: bulkCard.revision, card: { ...card, name: 'Новое массовое название' } }))
  await assert.rejects(db.transaction(tx => applyTechnologyCardAssignments(tx, { ...second, chunk: chunks[2] })), /Реестр ТК или справочники изменились/)
  const renamedPreview = await db.transaction(tx => scanTechnologyCardAssignments(tx, {}))
  assert.equal(renamedPreview.chunks[0].counts.rename, 499)
  const renameSaved = await db.transaction(tx => applyTechnologyCardAssignments(tx, { context: renamedPreview.context, chunk: renamedPreview.chunks[0], actions: ['rename'], excludedIds: [] }))
  assert.deepEqual(renameSaved, { assign: 0, reassign: 0, rename: 499 })
  const finalPreview = await db.transaction(tx => scanTechnologyCardAssignments(tx, {}))
  assert.equal(finalPreview.chunks[0].counts.unchanged, 499)
  assert.equal(finalPreview.chunks[0].counts.assign, 1)
  // Actual server helper, huge TOASTed task JSON, 200k joints: one scalar PK
  // lookup irrespective of journal/task volume. No index rebuild or mutation.
  await pool.query("update dispatcher_task_index_state set repeated_tasks=repeat('x',4000000),computed_at=now(),computed_revision=source_revision")
  const versionBefore = (await pool.query('select source_revision,computed_revision,xmin::text from dispatcher_task_index_state')).rows[0]
  const probeTimes: number[] = []
  statements.length = 0
  for (let i = 0; i < 100; i++) {
    const start = performance.now()
    const version = await readDispatcherTaskVersion(db)
    probeTimes.push(performance.now() - start)
    assert(Buffer.byteLength(JSON.stringify(version)) < 300)
  }
  assert.equal(statements.length, 100)
  assert(statements.every(query => !query.includes('weld_joints') && !query.includes('repeated_tasks') && !query.includes('update ')))
  assert.deepEqual((await pool.query('select source_revision,computed_revision,xmin::text from dispatcher_task_index_state')).rows[0], versionBefore)
  console.log(JSON.stringify({ label: 'dispatcher version at 200000 joints / 4MB payload', queriesPerProbe: 1, probes: 100, p95ms: Math.round(probeTimes.sort((a,b) => a-b)[94] * 100) / 100, responseBytesBelow: 300 }))

  const { ensureDispatcherTaskIndexFresh } = await import('../src/server/dispatcher-task-index')
  // Instrument both pools for an actual shared full calculation. The test DB is
  // owned/verified above; nothing here can connect to the working journal.
  const originalQuery = pg.Client.prototype.query
  let dispatcherQueries = 0
  pg.Client.prototype.query = function (this: pg.Client, ...args: unknown[]) {
    dispatcherQueries++
    return Reflect.apply(originalQuery, this, args)
  } as typeof originalQuery
  try {
    const start = performance.now()
    const states = await Promise.all([ensureDispatcherTaskIndexFresh(), ensureDispatcherTaskIndexFresh(), ensureDispatcherTaskIndexFresh()])
    assert.strictEqual(states[1], states[0], 'Concurrent callers must share one calculation result, not just publish equal revisions')
    assert.strictEqual(states[2], states[0], 'All three callers must share one calculation result')
    assert(states.every(state => state.sourceRevision === state.computedRevision))
    assert.equal(new Set(states.map(state => state.computedRevision)).size, 1)
    assert(dispatcherQueries < 1500, `Full dispatcher query fan-out: ${dispatcherQueries}`)
    console.log(JSON.stringify({ label: 'actual full dispatcher, 200000 joints, 3 concurrent callers', ms: Math.round(performance.now() - start), queries: dispatcherQueries, samePublishedRevision: true }))
    dispatcherQueries = 0
    const warmStart = performance.now()
    await ensureDispatcherTaskIndexFresh()
    assert(dispatcherQueries <= 2, 'Fresh dispatcher must not rebuild')
    console.log(JSON.stringify({ label: 'already-fresh dispatcher', ms: Math.round(performance.now() - warmStart), queries: dispatcherQueries }))
  } finally {
    pg.Client.prototype.query = originalQuery
    const { requireDb: requireApplicationDb } = await import('../src/db')
    await (requireApplicationDb() as unknown as { $client: pg.Pool }).$client.end()
  }
} finally {
  await pool.end()
  if (ownedOid !== undefined) {
    const current = (await admin.query('select oid from pg_database where datname=$1', [databaseName])).rows[0]
    if (current) {
      assert.equal(current.oid, ownedOid, 'Refuse cleanup of a database replaced by another run')
      await admin.query(`drop database ${databaseName}`)
      console.log(JSON.stringify({ removedOwnedDisposableDatabase: databaseName }))
    }
  }
  await admin.end()
}
