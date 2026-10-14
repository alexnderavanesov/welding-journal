import { beforeEach, describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Pool } from 'pg'
import { buildDerivedCalculationCacheKey } from '@/lib/derived-calculation-cache-key'
import { DERIVED_CALCULATION_CACHE_VERSION } from '@/lib/derived-calculation-cache-version'
import {
  readCacheSnapshotCoalesced, writeDerivedCalculationCache, getOrComputeDerivedCalculation,
  LINE_PROGRAM_OVERVIEW_CACHE_PREFIX, MAX_CACHED_LINE_PROGRAM_OVERVIEWS,
} from '@/server/derived-calculation-cache'
import { invalidateDerivedCalculationCache } from './dispatcher-task-index-dirty'

const mocks = vi.hoisted(() => ({ db: undefined as unknown, query: vi.fn() }))
vi.mock('@/db', () => ({ requireDb: () => mocks.db }))
vi.mock('@tanstack/react-start', () => ({ createServerOnlyFn: (fn: unknown) => fn }))

let revision = 17
let cachePayload: string | null = null
beforeEach(() => {
  revision = 17
  cachePayload = null
  mocks.query.mockReset().mockImplementation(async (config: { text: string }) => {
    if (config.text.includes('with "ensure_state"')) return { rows: [{ sourceRevision: revision, payload: cachePayload }] }
    if (config.text.includes('with "derived_state"')) { revision++; cachePayload = null }
    if (config.text.includes('for update')) return { rows: [{ sourceRevision: revision }] }
    return { rows: [] }
  })
  mocks.db = drizzle({ query: mocks.query } as unknown as Pool)
})

describe('derived calculation cache keys', () => {
  it('separates rule versions independently of how high the data revision has grown', () => {
    expect(buildDerivedCalculationCacheKey('statistics:v1', { line: 'L' }))
      .toBe(`rules:v${DERIVED_CALCULATION_CACHE_VERSION}:statistics:v1:{"line":"L"}`)
  })
  it('does not depend on object key order', () => {
    expect(
      buildDerivedCalculationCacheKey('statistics:v1', {
        tab: 'general',
        filters: { project: 'a', lines: ['2', '1'] },
      }),
    ).toBe(
      buildDerivedCalculationCacheKey('statistics:v1', {
        filters: { lines: ['2', '1'], project: 'a' },
        tab: 'general',
      }),
    )
  })

  it('keeps different arrays and namespaces separate', () => {
    const first = buildDerivedCalculationCacheKey('statistics:v1', { lines: ['1', '2'] })
    const second = buildDerivedCalculationCacheKey('statistics:v1', { lines: ['2', '1'] })
    const otherNamespace = buildDerivedCalculationCacheKey('dispatcher:v1', { lines: ['1', '2'] })

    expect(first).not.toBe(second)
    expect(first).not.toBe(otherNamespace)
  })
})

describe('atomic bounded derived cache publication', () => {
  const insertCalls = () => mocks.query.mock.calls.filter(([config]) => config.text.startsWith('insert into "derived_calculation_cache"'))
  const statements = () => mocks.query.mock.calls.map(([config]) => config.text as string)

  it('locks and checks source revision in the publication transaction before upsert and separate general eviction', async () => {
    await writeDerivedCalculationCache(17, [{ cacheKey: 'report', payload: '{"total":1}' }])
    const sql = statements()
    expect(sql[0]).toBe('begin')
    expect(sql[1]).toMatch(/select "source_revision" as "sourceRevision".*from "derived_calculation_state"/s)
    expect(sql[1]).toContain('for update')
    expect(sql[2]).toContain('on conflict ("cache_key") do update')
    expect(sql[2]).toContain('"source_revision" <= excluded."source_revision"')
    expect(sql[3]).toContain('"cache_key" not like')
    expect(mocks.query.mock.calls[3][1]).toEqual(['line-program-overview:%', 96])
    expect(sql[4]).toBe('commit')
  })

  it('discards a late old calculation even when a newer payload already exists', async () => {
    revision = 18
    await writeDerivedCalculationCache(17, [{ cacheKey: 'report', payload: 'old' }])
    expect(insertCalls()).toHaveLength(0)
    expect(statements()).toHaveLength(3)
    expect(statements().at(-1)).toBe('commit')
  })

  it('checks the revision after waiting for the state lock, not before the transaction', async () => {
    let release!: () => void
    const wait = new Promise<void>(resolve => { release = resolve })
    mocks.query.mockImplementation(async (config: { text: string }) => {
      if (config.text.includes('for update')) { await wait; return { rows: [{ sourceRevision: revision }] } }
      return { rows: [] }
    })
    const pending = writeDerivedCalculationCache(17, [{ cacheKey: 'report', payload: 'old' }])
    await vi.waitFor(() => expect(statements().some(text => text.includes('for update'))).toBe(true))
    revision = 18
    release()
    await pending
    expect(insertCalls()).toHaveLength(0)
  })

  it('bounds overview writes to 2000 rows in four batches and never evicts general entries', async () => {
    await writeDerivedCalculationCache(17, Array.from({ length: MAX_CACHED_LINE_PROGRAM_OVERVIEWS + 1 }, (_, i) => ({
      cacheKey: `${LINE_PROGRAM_OVERVIEW_CACHE_PREFIX}${i + 1}`, payload: JSON.stringify({ id: i + 1 }),
    })), 'line-overviews')
    expect(insertCalls()).toHaveLength(4)
    expect(insertCalls().map(([, params]) => params.length)).toEqual([2000, 2000, 2000, 2000])
    expect(insertCalls()[0][1][0]).toBe(`${LINE_PROGRAM_OVERVIEW_CACHE_PREFIX}2`)
    const eviction = mocks.query.mock.calls.find(([config]) => config.text.includes('delete from "derived_calculation_cache"'))!
    expect(eviction[0].text).toContain('"cache_key" like')
    expect(eviction[0].text).not.toContain('not like')
    expect(eviction[1]).toEqual(['line-program-overview:%', 2000])
  })

  it('deduplicates entries before upsert and rejects wrong namespace partitions', async () => {
    await writeDerivedCalculationCache(17, [{ cacheKey: 'report', payload: 'first' }, { cacheKey: 'report', payload: 'last' }])
    expect(insertCalls()).toHaveLength(1)
    expect(insertCalls()[0][1].slice(0, 3)).toEqual(['report', 17, 'last'])
    mocks.query.mockClear()
    await expect(writeDerivedCalculationCache(17, [{ cacheKey: `${LINE_PROGRAM_OVERVIEW_CACHE_PREFIX}1`, payload: '{}' }])).rejects.toThrow('namespace')
    await expect(writeDerivedCalculationCache(17, [{ cacheKey: 'line-program-overview:v0:1', payload: '{}' }], 'line-overviews')).rejects.toThrow('namespace')
    expect(mocks.query).not.toHaveBeenCalled()
  })

  it('rolls back publication if an insert fails', async () => {
    mocks.query.mockImplementation(async (config: { text: string }) => {
      if (config.text.includes('for update')) return { rows: [{ sourceRevision: revision }] }
      if (config.text.startsWith('insert into')) throw new Error('write failed')
      return { rows: [] }
    })
    await expect(writeDerivedCalculationCache(17, [{ cacheKey: 'report', payload: '{}' }])).rejects.toThrow()
    expect(statements().at(-1)).toBe('rollback')
    expect(statements().some(text => text.includes('delete from'))).toBe(false)
  })

  it('does not initialize missing state or open a transaction for empty writes', async () => {
    await writeDerivedCalculationCache(17, [])
    expect(mocks.query).not.toHaveBeenCalled()
    mocks.query.mockResolvedValue({ rows: [] })
    await writeDerivedCalculationCache(17, [{ cacheKey: 'report', payload: '{}' }])
    expect(insertCalls()).toHaveLength(0)
  })

  it('returns the computed snapshot but cannot publish it after invalidation during compute', async () => {
    const result = await getOrComputeDerivedCalculation('late-unit', async () => { revision++; return { revision: 17 } })
    expect(result).toEqual({ revision: 17 })
    expect(insertCalls()).toHaveLength(0)
  })

  it('cannot resurrect an old pending full calculation after full invalidation and a new publication', async () => {
    let release!: (value: { version: string }) => void
    const compute = vi.fn(() => new Promise<{ version: string }>(resolve => { release = resolve }))
    const pending = getOrComputeDerivedCalculation('pending-full-unit', compute)
    await vi.waitFor(() => expect(compute).toHaveBeenCalledOnce())
    await invalidateDerivedCalculationCache()
    await getOrComputeDerivedCalculation('pending-full-unit', async () => ({ version: 'new' }))
    release({ version: 'old' })
    await expect(pending).resolves.toEqual({ version: 'old' }) // transport snapshot remains labelled by its original revision
    expect(insertCalls()).toHaveLength(1)
    expect(insertCalls()[0][1].slice(0, 3)).toEqual(['pending-full-unit', 18, '{"version":"new"}'])
  })

  it('replaces corrupt JSON without an unguarded delete of a potentially newer payload', async () => {
    cachePayload = '{broken'
    expect(await getOrComputeDerivedCalculation('corrupt-unit', async () => ({ ok: true }))).toEqual({ ok: true })
    expect(insertCalls()).toHaveLength(1)
    expect(statements().filter(text => text.includes('delete from'))).toHaveLength(2) // floor guard + bounded eviction
    expect(statements().some(text => text.startsWith('delete from'))).toBe(false)
  })
})

describe('derived calculation cache request coalescing', () => {
  it('uses one database snapshot read for concurrent requests with the same key', async () => {
    let resolveRead: ((value: { sourceRevision: number; payload: string | null }) => void) | undefined
    const read = vi.fn(() => new Promise<{ sourceRevision: number; payload: string | null }>((resolve) => {
      resolveRead = resolve
    }))
    const key = `coalesced-${Date.now()}-${Math.random()}`

    const first = readCacheSnapshotCoalesced(key, read)
    const second = readCacheSnapshotCoalesced(key, read)
    resolveRead?.({ sourceRevision: 17, payload: null })

    await expect(Promise.all([first, second])).resolves.toEqual([
      { sourceRevision: 17, payload: null },
      { sourceRevision: 17, payload: null },
    ])
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('does not merge reads for different cache keys', async () => {
    const read = vi.fn(async (cacheKey: string) => ({ sourceRevision: 4, payload: cacheKey }))
    const prefix = `separate-${Date.now()}-${Math.random()}`

    await Promise.all([
      readCacheSnapshotCoalesced(`${prefix}-first`, read),
      readCacheSnapshotCoalesced(`${prefix}-second`, read),
    ])

    expect(read).toHaveBeenCalledTimes(2)
  })
})
