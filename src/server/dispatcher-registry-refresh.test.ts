import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { appSettings, dispatcherAcceptedWarnings, dispatcherTaskIndexState, welderStamps, weldJoints } from '@/db/schema'
import { getBusinessDateIso } from '@/lib/business-date'
import { DISPATCHER_TASK_CALCULATION_VERSION, serializeDispatcherTaskIndexPayload } from '@/lib/dispatcher-task-index-payload'
import { DEFAULT_DISPATCHER_SETTINGS } from '@/lib/dispatcher-settings'
import { PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'
import { ensureDispatcherTaskIndexFresh } from './dispatcher-task-index'

const storage = vi.hoisted(() => ({ requireDb: vi.fn() }))
vi.mock('@/db', () => ({ requireDb: storage.requireDb }))
const fullSelected = new Error('test boundary: full calculation selected')
beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}))
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

function database(options: { dirtyScopes?: string; computedRevision?: number; fullRebuild?: boolean; computedAt?: Date; calculationVersion?: number;
  counts?: number[]; archived?: boolean; accepted?: boolean; failPublish?: boolean;
  dateScopes?: Array<Array<{ projectTitle: string; subtitleCode: string; line: string }>>; onDateRead?: () => void } = {}) {
  const today = getBusinessDateIso()
  let state = { id: 1, sourceRevision: 2, computedRevision: options.computedRevision ?? 1,
    repeatedTasks: JSON.stringify({ ...JSON.parse(serializeDispatcherTaskIndexPayload([], [], { totalTaskCount: 6000, totalPageCount: 60,
      taskFilterOptions: [{ value: 'СП-02', count: 6000 }] })), version: options.calculationVersion ?? DISPATCHER_TASK_CALCULATION_VERSION }),
    welderStampExpiryTasks: '[]', duplicateKeys: '["keep-duplicate"]', dirtyScopes: options.dirtyScopes ?? '[]',
    fullRebuild: options.fullRebuild ?? false, computedAt: options.computedAt ?? new Date(), updatedAt: new Date() }
  const original = { ...state }, selected: unknown[] = [], events: string[] = [], updates: unknown[] = []
  const expiryKey = `welder-stamp-expiry:naks:1:AB12:n1:${today}`
  const counts = [...(options.counts ?? [])]
  const dateScopes = [...(options.dateScopes ?? [])]
  let txNumber = 0
  const execute = vi.fn(async (statement: SQL) => {
    const query = new PgDialect().sqlToQuery(statement)
    if (query.sql.includes('inserted_state')) return { rows: [{ ...state }] }
    if (query.sql.includes('create temporary table')) { events.push(`full:${txNumber}`); throw fullSelected }
    if (query.sql.includes('date_sensitive_scopes')) { options.onDateRead?.(); return { rows: dateScopes.shift() ?? [] } }
    if (query.sql.includes('lock table')) events.push(`weld-lock:${txNumber}`)
    return { rows: [] }
  })
  const select = vi.fn((fields?: Record<string, unknown>) => ({ from: (table: unknown) => {
    selected.push(table)
    let result: unknown[]
    if (table === dispatcherTaskIndexState) result = [{ ...state }]
    else if (table === welderStamps) result = [{ id: 1, naksStamp: 'AB12', welderName: 'Новое ФИО', archived: options.archived ?? false,
      naksPermits: JSON.stringify([{ id: 'n1', weldType: 'РАД', materialGroups: 'М01', validFrom: '2026-01-01', validTo: today }]) }]
    else if (table === appSettings) result = [{ key: PROJECT_SETTING_KEYS.dispatcher, value: JSON.stringify({ ...DEFAULT_DISPATCHER_SETTINGS, 'welder-stamp-expiry': true }) }]
    else if (table === dispatcherAcceptedWarnings) result = options.accepted ? [{ key: expiryKey }] : []
    else if (table === weldJoints && fields?.joints) result = [{ projectTitle: 'P', subtitleCode: 'S', line: 'L', joints: counts.shift() ?? 1 }]
    else throw new Error('Registry-only refresh unexpectedly read welds/relations/pages')
    const chain = Object.assign(Promise.resolve(result), { where: (_condition: unknown) => chain,
      orderBy: async () => result, limit: async () => result, groupBy: () => chain })
    return chain
  } }))
  const update = vi.fn((table: unknown) => ({ set: (patch: Partial<typeof state>) => ({ where: (_condition: unknown) => ({ returning: async () => {
    expect(table).toBe(dispatcherTaskIndexState)
    if (options.failPublish) throw new Error('publication failed')
    updates.push(patch)
    state = { ...state, ...patch }
    return [{ ...state }]
  } }) }) }))
  const tx = { execute, select, update }
  storage.requireDb.mockReturnValue({ execute, select, transaction: async (run: (tx: unknown) => Promise<unknown>) => {
    const id = ++txNumber
    events.push(`begin:${id}`)
    try { return await run(tx) } finally { events.push(`end:${id}`) }
  } })
  return { original, selected, events, updates, execute, state: () => state }
}

describe('registry-only dispatcher publication', () => {
  it('invalidates version 71 despite equal revisions, today\'s date and empty dirty scopes', async () => {
    // v71 could persist a same-name repair without its whitespace-equivalent
    // rejected source. A reminder-only save must not bless that old index.
    const db = database({ calculationVersion: 71, computedRevision: 2 })
    await expect(ensureDispatcherTaskIndexFresh()).rejects.toBe(fullSelected)
    expect(db.events).toEqual(['begin:1', 'full:1', 'end:1'])
    expect(db.updates).toEqual([])
  })

  it('keeps an already-current complete index fresh without a transaction', async () => {
    const db = database({ computedRevision: 2 })
    expect(await ensureDispatcherTaskIndexFresh()).toEqual(db.original)
    expect(db.events).toEqual([])
    expect(db.updates).toEqual([])
    expect(db.execute).toHaveBeenCalledOnce()
  })

  it('coalesces readers and refreshes the embedded FIO without reading or replacing any of 6000 existing joint tasks', async () => {
    const db = database()
    const [left, right] = await Promise.all([ensureDispatcherTaskIndexFresh(), ensureDispatcherTaskIndexFresh()])
    expect(left).toEqual(right)
    expect(db.updates).toHaveLength(1)
    expect(left.repeatedTasks).toBe(db.original.repeatedTasks)
    expect(left.duplicateKeys).toBe(db.original.duplicateKeys)
    expect(left.computedRevision).toBe(2)
    expect(JSON.parse(left.welderStampExpiryTasks)).toMatchObject([{ stamp: { welderName: 'Новое ФИО' } }])
    expect(db.selected).not.toContain(weldJoints)
    expect(db.selected).toHaveLength(5) // two guarded state reads + registry, settings, decisions
  })

  it.each([{ archived: true }, { accepted: true }])('keeps archived and accepted expiry reminders hidden: %j', async options => {
    const db = database(options)
    const state = await ensureDispatcherTaskIndexFresh()
    expect(JSON.parse(state.welderStampExpiryTasks)).toEqual([])
    expect(state.repeatedTasks).toBe(db.original.repeatedTasks)
  })

  it('does not advance the computed revision on publication failure and allows retry', async () => {
    const failed = database({ failPublish: true })
    await expect(ensureDispatcherTaskIndexFresh()).rejects.toThrow('publication failed')
    expect(failed.state().computedRevision).toBe(1)
    database()
    await expect(ensureDispatcherTaskIndexFresh()).resolves.toMatchObject({ computedRevision: 2 })
  })

  it.each(['broken', '{}', '[null]', '[{"line":"L"}]'])('never treats malformed %s as reminder-only, even at equal revisions', async dirtyScopes => {
    const db = database({ dirtyScopes, computedRevision: 2 })
    await expect(ensureDispatcherTaskIndexFresh()).rejects.toBe(fullSelected)
    expect(db.updates).toEqual([])
    expect(db.events).not.toContain('weld-lock:1')
  })

  it.each([{ fullRebuild: true }])('retains an existing full rebuild: %j', async options => {
    database(options)
    await expect(ensureDispatcherTaskIndexFresh()).rejects.toBe(fullSelected)
  })

  it('refreshes a new business day without reading the journal when no line depends on today', async () => {
    const db = database({ computedRevision: 2, computedAt: new Date('2026-01-01T00:00:00Z') })
    const state = await ensureDispatcherTaskIndexFresh()
    expect(state.sourceRevision).toBe(3)
    expect(state.computedRevision).toBe(3)
    expect(state.repeatedTasks).toBe(db.original.repeatedTasks)
    expect(state.duplicateKeys).toBe(db.original.duplicateKeys)
    expect(db.selected).not.toContain(weldJoints)
    expect(db.events).not.toContain('full:1')
    expect(db.execute.mock.calls.filter(([query]) => new PgDialect().sqlToQuery(query).sql.includes('date_sensitive_scopes'))).toHaveLength(2)
  })

  it('does not stamp a calculation crossing midnight as current without checking daily dependencies again', async () => {
    vi.useFakeTimers()
    const before = new Date('2026-10-13T20:59:59Z'), after = new Date('2026-10-13T21:00:01Z')
    vi.setSystemTime(before)
    let reads = 0
    const db = database({ computedRevision: 2, computedAt: new Date('2026-10-12T12:00:00Z'),
      onDateRead: () => { if (++reads === 2) vi.setSystemTime(after) } })
    const state = await ensureDispatcherTaskIndexFresh()
    expect(db.updates).toHaveLength(2)
    expect(db.updates[0]).toMatchObject({ computedAt: before, computedRevision: 3 })
    expect(state.computedAt).toEqual(after)
    expect(state.computedRevision).toBe(4)
    expect(reads).toBe(4)
  })

  it('releases writer locks before a full fallback if daily dependencies grow while waiting', async () => {
    const scopes = Array.from({ length: 501 }, (_, i) => ({ projectTitle: 'P', subtitleCode: 'S', line: String(i) }))
    const db = database({ computedRevision: 2, computedAt: new Date('2026-01-01T00:00:00Z'), dateScopes: [[], scopes] })
    await expect(ensureDispatcherTaskIndexFresh()).rejects.toBe(fullSelected)
    expect(db.events).toEqual(['begin:1', 'weld-lock:1', 'end:1', 'begin:2', 'full:2', 'end:2'])
    expect(db.updates).toEqual([])
  })

  it.each([5001, 200000])('selects full calculation before writer locks for a complete line of %i rows', async count => {
    const db = database({ dirtyScopes: JSON.stringify([{ projectTitle: 'P', subtitleCode: 'S', line: 'L' }]), counts: [count] })
    await expect(ensureDispatcherTaskIndexFresh()).rejects.toBe(fullSelected)
    expect(db.events).toEqual(['begin:1', 'full:1', 'end:1'])
    expect(db.updates).toEqual([])
  })

  it('releases scoped writer locks before falling back when queued writes enlarge the complete context', async () => {
    const db = database({ dirtyScopes: JSON.stringify([{ projectTitle: 'P', subtitleCode: 'S', line: 'L' }]), counts: [1, 5001] })
    await expect(ensureDispatcherTaskIndexFresh()).rejects.toBe(fullSelected)
    expect(db.events).toEqual(['begin:1', 'weld-lock:1', 'end:1', 'begin:2', 'full:2', 'end:2'])
    expect(db.updates).toEqual([])
  })
})
