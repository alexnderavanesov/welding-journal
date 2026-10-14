import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { Buffer } from 'node:buffer'
import { DERIVED_CALCULATION_CACHE_VERSION } from '@/lib/derived-calculation-cache-version'
import { getLineProgramIdentityKey } from '@/lib/line-program'
import {
  readLineProgramOverviewCache, writeLineProgramOverviewCache, LINE_PROGRAM_OVERVIEW_CACHE_READ_BATCH_SIZE,
  MAX_LINE_PROGRAM_OVERVIEW_CACHE_PAYLOAD_BYTES,
  type CachedLineProgramOverview, type LineProgramOverviewCacheLine,
} from './line-program-overview-cache'
import { LINE_PROGRAM_OVERVIEW_CACHE_PREFIX } from './derived-calculation-cache'
import overviewCacheSource from './line-program-overview-cache.ts?raw'

const mocks = vi.hoisted(() => ({ write: vi.fn() }))
vi.mock('./derived-calculation-cache', async importOriginal => ({
  ...await importOriginal<typeof import('./derived-calculation-cache')>(), writeDerivedCalculationCache: mocks.write,
}))
vi.mock('@/db', () => ({ requireDb: () => { throw new Error('No database in overview cache units') } }))

const dialect = new PgDialect()
const line = (id = 1): LineProgramOverviewCacheLine => ({ id, version: '2026-10-14T10:00:00.000Z', projectTitle: 'Проект', subtitleCode: 'S', line: `L ${id}` })
const entry = (id = 1): CachedLineProgramOverview => ({
  lineId: id, version: line(id).version, identityKey: getLineProgramIdentityKey(line(id)),
  overviewPayload: { searchStamps: ['ABCD'], overview: {
    joints: 10, journalRows: 13, calculationJoints: 9, stamps: 1, additional: 1,
    approved: 2, reducible: 1, pending: 3, rejected: 1, unfinishedChains: 2,
    common: { required: 3, covered: 2, missing: 1, actionableRequired: 3, excess: 0 }, pvk: null,
  } },
})
const envelope = (value: CachedLineProgramOverview) => ({ namespace: LINE_PROGRAM_OVERVIEW_CACHE_PREFIX, ...value })
const stored = (value: CachedLineProgramOverview) => ({ cacheKey: `${LINE_PROGRAM_OVERVIEW_CACHE_PREFIX}${value.lineId}`, payload: JSON.stringify(envelope(value)) })
function reader(rows: Array<{ cacheKey: string; payload: string }>) {
  const where = vi.fn(async (condition: SQL) => {
    const keys = new Set(dialect.sqlToQuery(condition).params.slice(1))
    return rows.filter(row => keys.has(row.cacheKey))
  })
  const select = vi.fn(() => ({ from: () => ({ where }) }))
  return { tx: { select } as unknown as Parameters<typeof readLineProgramOverviewCache>[0], select, where }
}

beforeEach(() => mocks.write.mockReset().mockResolvedValue(undefined))

describe('read-only complete-line overview cache', () => {
  it('has no Node builtin import or Buffer dependency in the browser-traversed helper', () => {
    expect(overviewCacheSource).not.toMatch(/\b(?:from|import)\s*['"](?:node:|buffer['"])/)
    expect(overviewCacheSource).not.toMatch(/\bBuffer\b/)
  })

  it('reads exact revision, line version and normalized identity without writing or initializing state', async () => {
    const db = reader([stored(entry())])
    const request = { ...line(), projectTitle: '  ПРОЕКТ ', subtitleCode: ' s ', line: ' l 1 ' }
    expect(await readLineProgramOverviewCache(db.tx, 17, [request])).toEqual(new Map([[1, entry()]]))
    const query = dialect.sqlToQuery(db.where.mock.calls[0][0])
    expect(query.sql).toContain('"source_revision" =')
    expect(query.params).toEqual([17, `${LINE_PROGRAM_OVERVIEW_CACHE_PREFIX}1`])
    expect(mocks.write).not.toHaveBeenCalled()
    expect(db.select).toHaveBeenCalledOnce()
  })

  it('does not reuse another version, renamed identity or different line even with identical norms', async () => {
    for (const request of [{ ...line(), version: 'newer' }, { ...line(), line: 'L2' }, { ...line(), line: 'L1' }, line(2)]) {
      expect(await readLineProgramOverviewCache(reader([stored(entry())]).tx, 17, [request])).toEqual(new Map())
    }
    const wrongOwner = { ...stored(entry()), payload: JSON.stringify(envelope(entry(2))) }
    expect(await readLineProgramOverviewCache(reader([wrongOwner]).tx, 17, [line()])).toEqual(new Map())
  })

  it.each([
    '{broken', 'null', '[]', JSON.stringify(entry()),
    JSON.stringify({ ...envelope(entry()), namespace: 'line-program-overview:v0:rules:v0:' }),
    JSON.stringify({ ...envelope(entry()), identityKey: '["ПРОЕКТ","s","l 1"]' }),
    JSON.stringify({ ...envelope(entry()), overviewPayload: { overview: null, searchStamps: [] } }),
    JSON.stringify({ ...envelope(entry()), overviewPayload: { ...entry().overviewPayload, searchStamps: [1] } }),
    JSON.stringify({ ...envelope(entry()), overviewPayload: { ...entry().overviewPayload, overview: { ...entry().overviewPayload.overview, common: {} } } }),
  ])('treats corrupt/unknown envelope as a miss without repairs: %s', async payload => {
    const db = reader([{ ...stored(entry()), payload }])
    expect(await readLineProgramOverviewCache(db.tx, 17, [line()])).toEqual(new Map())
    expect(mocks.write).not.toHaveBeenCalled()
  })

  it('batches 1001 lines with no per-line queries and deduplicates repeated inputs', async () => {
    const count = LINE_PROGRAM_OVERVIEW_CACHE_READ_BATCH_SIZE * 2 + 1
    const entries = Array.from({ length: count }, (_, i) => entry(i + 1))
    const db = reader(entries.map(stored))
    const hits = await readLineProgramOverviewCache(db.tx, 17, [...entries.map(item => line(item.lineId)), line()])
    expect(hits.size).toBe(count)
    expect(hits.get(count)).toEqual(entry(count))
    expect(db.select).toHaveBeenCalledTimes(3)
    expect(db.where.mock.calls.map(([condition]) => dialect.sqlToQuery(condition).params.length - 1)).toEqual([500, 500, 1])
  })

  it('performs no read for an empty request or invalid revision', async () => {
    const db = reader([])
    await readLineProgramOverviewCache(db.tx, 17, [])
    await readLineProgramOverviewCache(db.tx, NaN, [line()])
    expect(db.select).not.toHaveBeenCalled()
  })

  it('does not reuse expired rule prefixes even at a source revision above every version floor', async () => {
    const oldPrefix = `line-program-overview:v1:rules:v${DERIVED_CALCULATION_CACHE_VERSION - 1}:`
    for (const row of [
      { ...stored(entry()), cacheKey: `${oldPrefix}1` },
      { ...stored(entry()), payload: JSON.stringify({ ...envelope(entry()), namespace: oldPrefix }) },
    ]) expect(await readLineProgramOverviewCache(reader([row]).tx, 100_000_000, [line()])).toEqual(new Map())
  })

  it('does not add calendar-day freshness or discard a valid display cache at midnight', async () => {
    const db = reader([stored(entry())])
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-10-14T20:59:59Z'))
      expect((await readLineProgramOverviewCache(db.tx, 17, [line()])).get(1)).toEqual(entry())
      vi.setSystemTime(new Date('2026-10-14T21:00:01Z'))
      expect((await readLineProgramOverviewCache(db.tx, 17, [line()])).get(1)).toEqual(entry())
      expect(dialect.sqlToQuery(db.where.mock.calls[0][0])).toEqual(dialect.sqlToQuery(db.where.mock.calls[1][0]))
    } finally { vi.useRealTimers() }
  })
})

describe('publishing display-only overview envelopes', () => {
  it('passes concrete identity metadata and compact payload to the guarded overview partition', async () => {
    const value = entry()
    await writeLineProgramOverviewCache(17, [value])
    const [revision, rows, partition] = mocks.write.mock.calls[0]
    expect(revision).toBe(17)
    expect(partition).toBe('line-overviews')
    expect(rows).toHaveLength(1)
    expect(rows[0].cacheKey).toBe(stored(value).cacheKey)
    expect(JSON.parse(rows[0].payload)).toEqual(envelope(value))
    expect(value).toEqual(entry())
  })

  it('does not publish incomplete or noncanonical identities', async () => {
    await writeLineProgramOverviewCache(17, [
      { ...entry(), identityKey: 'legacy-unparseable' },
      { ...entry(), identityKey: '["Проект","s","l 1"]' },
      { ...entry(), version: '' },
      { ...entry(), overviewPayload: { ...entry().overviewPayload, overview: { ...entry().overviewPayload.overview, pending: NaN } } },
    ])
    expect(mocks.write).toHaveBeenCalledWith(17, [], 'line-overviews')
  })

  it.each(['Я', '😀'])('admits exactly 256 KiB and skips UTF-8 overflow from %s without truncating the result', async suffix => {
    const exact = entry()
    exact.overviewPayload.searchStamps = ['']
    const overhead = Buffer.byteLength(JSON.stringify(envelope(exact)), 'utf8')
    exact.overviewPayload.searchStamps = ['a'.repeat(MAX_LINE_PROGRAM_OVERVIEW_CACHE_PAYLOAD_BYTES - overhead)]
    const oversized = { ...exact, overviewPayload: { ...exact.overviewPayload,
      searchStamps: [exact.overviewPayload.searchStamps[0] + suffix],
    } }
    const before = JSON.stringify(oversized)
    await writeLineProgramOverviewCache(17, [exact])
    expect(Buffer.byteLength(mocks.write.mock.calls[0][1][0].payload, 'utf8')).toBe(MAX_LINE_PROGRAM_OVERVIEW_CACHE_PAYLOAD_BYTES)
    await writeLineProgramOverviewCache(17, [oversized])
    expect(mocks.write.mock.calls[1][1]).toEqual([])
    expect(JSON.stringify(oversized)).toBe(before)
    expect(await readLineProgramOverviewCache(reader([stored(oversized)]).tx, 17, [line()])).toEqual(new Map())
    expect(await readLineProgramOverviewCache(reader([stored(exact)]).tx, 17, [line()])).toEqual(new Map([[1, exact]]))
  })
})
