import assert from 'node:assert/strict'
import { eq, inArray, like } from 'drizzle-orm'
import { createDispatcherRuleFixtures } from '../src/test/dispatcher-rule-fixtures'
import { DEFAULT_DISPATCHER_SETTINGS, DISPATCHER_SETTING_CODES, getDispatcherTaskCode } from '../src/lib/dispatcher-settings'
import { PROJECT_SETTING_KEYS } from '../src/lib/project-settings-remote'

// This script never prepares a schema and must never run against user data.
const url = new URL(process.env.DATABASE_URL ?? '')
assert.equal(url.hostname, '127.0.0.1')
assert.equal(url.pathname, '/welding_tracker_e2e')
assert.equal(process.env.WELDING_ENV_LOADED, '1')
const [{ requireDb }, schema, dispatcher, dirty, read] = await Promise.all([
  import('../src/db/index'), import('../src/db/schema'), import('../src/server/dispatcher-task-index'),
  import('../src/server/dispatcher-task-index-dirty'), import('../src/server/weld-read'),
])
const db = requireDb()
const { weldJoints, welderStamps, dispatcherRowTasks, dispatcherTaskPages, appSettings } = schema
assert.equal((await db.select({ id: weldJoints.id }).from(weldJoints).where(like(weldJoints.projectTitle, 'MATRIX %'))).length, 0)
const fixtures = createDispatcherRuleFixtures()
const previousSettings = await db.select().from(appSettings).where(eq(appSettings.key, PROJECT_SETTING_KEYS.dispatcher))
const fixtureIds: number[] = []
const programWarningIds: number[] = []
const actualityIds: number[] = []
const stampIds: number[] = []
const idMap = new Map<number, number>()
const pg = await import('pg')
const prototype = pg.default.Client.prototype
const originalQuery = prototype.query
let statements = 0
prototype.query = function (this: unknown, ...args: unknown[]) {
  statements += 1
  return (originalQuery as (...args: unknown[]) => unknown).apply(this, args)
} as typeof prototype.query

try {
  for (const fixture of fixtures) {
    if (fixture.rows.length) {
      const inserted = await db.insert(weldJoints).values(fixture.rows.map(({ id: _id, ...row }) => row as typeof weldJoints.$inferInsert)).returning({ id: weldJoints.id })
      inserted.forEach(({ id }, index) => {
        fixtureIds.push(id)
        idMap.set(fixture.rows[index].id, id)
      })
    }
    for (const { id: _id, naksPermits, dlsPermits, ...stamp } of fixture.welderStamps) {
      const [inserted] = await db.insert(welderStamps).values({ ...stamp, naksPermits: JSON.stringify(naksPermits), dlsPermits: JSON.stringify(dlsPermits) }).returning({ id: welderStamps.id })
      stampIds.push(inserted.id)
    }
  }
  const programWarnings = await db.insert(weldJoints).values([
    { projectTitle: 'MATRIX SP-02', subtitleCode: 'M-1', line: 'L-SP', joint: 'F1', category: null, groupName: 'A', weldControlPercent: 10, pvkControlPercent: 10 },
    { projectTitle: 'MATRIX SP-02', subtitleCode: 'M-1', line: 'L-SP', joint: 'F2', category: 'II', groupName: 'B', weldControlPercent: 10, pvkControlPercent: 10 },
  ]).returning({ id: weldJoints.id })
  programWarningIds.push(...programWarnings.map(({ id }) => id))
  fixtureIds.push(...programWarningIds)
  const { id: _templateId, ...template } = fixtures.find(fixture => fixture.settingId === 'repeated-create')!.rows[0]
  const actualityRows = await db.insert(weldJoints).values([
    { ...template, projectTitle: 'MATRIX actuality', joint: 'S1', rkResult: 'ремонт' },
    { ...template, projectTitle: 'MATRIX actuality', joint: 'S1R1', rkResult: 'годен', revisionActuality: 'не актуален' },
  ] as Array<typeof weldJoints.$inferInsert>).returning({ id: weldJoints.id })
  actualityIds.push(...actualityRows.map(row => row.id)); fixtureIds.push(...actualityIds)
  await db.insert(appSettings).values({ key: PROJECT_SETTING_KEYS.dispatcher, value: JSON.stringify(DEFAULT_DISPATCHER_SETTINGS) })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: JSON.stringify(DEFAULT_DISPATCHER_SETTINGS) } })
  await dirty.markDispatcherTaskIndexDirty(db)
  const beforeRefresh = statements
  await dispatcher.ensureDispatcherTaskIndexFresh()
  const refreshStatements = statements - beforeRefresh
  assert(refreshStatements < 100, `Refresh must be batched, got ${refreshStatements} statements for ${fixtureIds.length} rows`)
  const persisted = await db.select().from(dispatcherRowTasks).where(inArray(dispatcherRowTasks.weldJointId, fixtureIds))
  const pages = await db.select().from(dispatcherTaskPages)
  const snapshot = await dispatcher.getDispatcherTaskIndexSnapshot({ scheduleRefresh: false })
  const beforeRead = statements
  const visible = await read.attachDispatcherTaskCodesToPage(fixtureIds.map((id) => ({ id }))) as Array<{ id: number; dispatcherTasks: string }>
  assert.equal(statements - beforeRead, 1, 'Virtual fields must use one batch read for all fixture rows')
  await read.attachDispatcherTaskCodesToPage([{ id: fixtureIds[0] }])
  assert.equal(statements - beforeRead, 2, 'One row and many rows must each use exactly one statement')
  for (const fixture of fixtures) {
    const code = DISPATCHER_SETTING_CODES[fixture.settingId]
    const expectedIds = fixture.expectedRowIds.map((id) => idMap.get(id)!).sort((a, b) => a - b)
    const scopeIds = new Set(fixture.rows.map(({ id }) => idMap.get(id)!))
    if (!fixture.rows.length) {
      assert(snapshot.welderStampExpiryTasks.some((task) => getDispatcherTaskCode(task) === code), `${code}: server reminder missing`)
      assert.equal(persisted.filter((row) => row.code === code).length, 0, `${code}: reminders must not enter weld-row index`)
      continue
    }
    const cards = pages.flatMap((page) => JSON.parse(page.tasks) as Array<{ row: { id: number } }>).filter((task) => scopeIds.has(task.row.id))
    assert(cards.some((task) => getDispatcherTaskCode(task as Parameters<typeof getDispatcherTaskCode>[0]) === code), `${code}: persisted task card missing`)
    assert.deepEqual(persisted.filter((row) => row.code === code && scopeIds.has(row.weldJointId)).map((row) => row.weldJointId).sort((a, b) => a - b), expectedIds, `${code}: persisted row index`)
    assert.deepEqual(visible.filter((row) => scopeIds.has(row.id) && row.dispatcherTasks.split(', ').includes(code)).map((row) => row.id).sort((a, b) => a - b), expectedIds, `${code}: virtual dispatcherTasks`)
  }
  for (const id of programWarningIds) {
    assert(persisted.some((row) => row.weldJointId === id && row.code === 'СП-02'), 'Incomplete/conflicting program must enter the persisted row index')
    assert(visible.find((row) => row.id === id)?.dispatcherTasks.includes('СП-02'), 'SP-02 must appear in the SQL-backed virtual field')
  }
  for (const id of actualityIds) {
    assert(persisted.some(row => row.weldJointId === id && row.code === 'ДЗ-13'), 'Actuality mismatch must index both source and excluded continuation')
    assert(visible.find(row => row.id === id)?.dispatcherTasks.includes('ДЗ-13'), 'Actuality mismatch must appear in both virtual fields')
  }
  for (const [sourceActuality, repairActuality, expected] of [[null, null, false], [null, 'не актуален', true], ['не актуален', 'не актуален', false]] as const) {
    await db.update(weldJoints).set({ revisionActuality: sourceActuality }).where(eq(weldJoints.id, actualityIds[0]))
    await db.update(weldJoints).set({ revisionActuality: repairActuality }).where(eq(weldJoints.id, actualityIds[1]))
    await dirty.markDispatcherTaskIndexDirty(db, { scopes: [{ projectTitle: 'MATRIX actuality', subtitleCode: String(template.subtitleCode), line: String(template.line) }] })
    await dispatcher.ensureDispatcherTaskIndexFresh()
    const stored = await db.select().from(dispatcherRowTasks).where(inArray(dispatcherRowTasks.weldJointId, actualityIds))
    const virtual = await read.attachDispatcherTaskCodesToPage(actualityIds.map(id => ({ id }))) as Array<{ id: number; dispatcherTasks: string }>
    for (const id of actualityIds) {
      assert.equal(stored.some(row => row.weldJointId === id && row.code === 'ДЗ-13'), expected)
      assert.equal(virtual.find(row => row.id === id)?.dispatcherTasks.includes('ДЗ-13'), expected)
    }
  }
  // Existing records: actuality changes clear and restore both task pages and
  // the SQL-backed report column, including unofficial repeats and limit coils.
  const continuationFixtures = fixtures.filter(fixture => ['repeated-create', 'repeated-create-official-from-unofficial', 'repeated-coil'].includes(fixture.settingId))
  const continuationIds = continuationFixtures.flatMap(fixture => fixture.rows.map(row => idMap.get(row.id)!))
  const continuationRefreshStatements: number[] = []
  for (const revisionActuality of ['не актуален', 'актуальная']) {
    await db.update(weldJoints).set({ revisionActuality }).where(inArray(weldJoints.id, continuationIds))
    await dirty.markDispatcherTaskIndexDirty(db, { scopes: dirty.getDispatcherDirtyScopes(continuationFixtures.flatMap(fixture => fixture.rows), new Map()) })
    const before = statements
    await dispatcher.ensureDispatcherTaskIndexFresh()
    continuationRefreshStatements.push(statements - before)
    assert(statements - before < 100, 'Actuality refresh must remain batched')
    const codes = await db.select().from(dispatcherRowTasks).where(inArray(dispatcherRowTasks.weldJointId, continuationIds))
    const virtual = await read.attachDispatcherTaskCodesToPage(continuationIds.map(id => ({ id }))) as Array<{ id: number; dispatcherTasks: string }>
    const storedPages = await db.select().from(dispatcherTaskPages)
    for (const fixture of continuationFixtures) {
      const code = DISPATCHER_SETTING_CODES[fixture.settingId]
      const scopeIds = new Set(fixture.rows.map(row => idMap.get(row.id)!))
      const expectedIds = revisionActuality === 'не актуален' ? [] : fixture.expectedRowIds.map(id => idMap.get(id)!).sort((a, b) => a - b)
      assert.deepEqual(codes.filter(row => scopeIds.has(row.weldJointId) && row.code === code).map(row => row.weldJointId).sort((a, b) => a - b), expectedIds)
      assert.deepEqual(virtual.filter(row => scopeIds.has(row.id) && row.dispatcherTasks.split(', ').includes(code)).map(row => row.id).sort((a, b) => a - b), expectedIds)
      const cards = storedPages.flatMap(page => JSON.parse(page.tasks) as Array<{ row: { id: number } }>).filter(task => scopeIds.has(task.row.id) && getDispatcherTaskCode(task as Parameters<typeof getDispatcherTaskCode>[0]) === code)
      assert.equal(cards.length > 0, expectedIds.length > 0)
    }
  }
  // Removing facts must clear both the old row codes and per-line task pages.
  await db.delete(weldJoints).where(inArray(weldJoints.id, fixtureIds))
  await dirty.markDispatcherTaskIndexDirty(db, { scopes: dirty.getDispatcherDirtyScopes([
    ...fixtures.flatMap(({ rows }) => rows),
    ...programWarningIds.map((id) => ({ id, projectTitle: 'MATRIX SP-02', subtitleCode: 'M-1', line: 'L-SP' })),
    ...actualityIds.map(id => ({ id, projectTitle: 'MATRIX actuality', subtitleCode: template.subtitleCode!, line: template.line! })),
  ], new Map()) })
  await dispatcher.ensureDispatcherTaskIndexFresh()
  assert.equal((await db.select().from(dispatcherRowTasks).where(inArray(dispatcherRowTasks.weldJointId, fixtureIds))).length, 0)
  const remaining = await db.select().from(dispatcherTaskPages)
  assert(!remaining.some((page) => (JSON.parse(page.tasks) as Array<{ row: { id: number } }>).some((task) => fixtureIds.includes(task.row.id))))
  console.log(JSON.stringify({ settings: fixtures.length, persistedRuleChains: fixtures.filter((fixture) => fixture.rows.length).length,
    reminderRules: 2, mandatoryProgramRule: true, fixtureJoints: fixtureIds.length, refreshStatements, virtualFieldStatementsPerPage: 1, removedFactsCleared: true,
    actualityRestoresContinuations: true, actualityMismatchBothRecoveryPaths: true, continuationRefreshStatements }))
} finally {
  if (fixtureIds.length) await db.delete(weldJoints).where(inArray(weldJoints.id, fixtureIds))
  if (stampIds.length) await db.delete(welderStamps).where(inArray(welderStamps.id, stampIds))
  if (previousSettings.length) await db.update(appSettings).set({ value: previousSettings[0].value }).where(eq(appSettings.key, PROJECT_SETTING_KEYS.dispatcher))
  else await db.delete(appSettings).where(eq(appSettings.key, PROJECT_SETTING_KEYS.dispatcher))
  await dirty.markDispatcherTaskIndexDirty(db)
  prototype.query = originalQuery
}
