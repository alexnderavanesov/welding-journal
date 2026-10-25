import { beforeEach, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { JournalRangeRequest } from '@/lib/journal-server-grid'

const mock = vi.hoisted(() => ({ rows: [] as object[][], reads: vi.fn(), revision: vi.fn(), access: vi.fn(), areaRevision: vi.fn(), summarize: vi.fn() }))
vi.mock('@/db', () => ({ requireDb: () => ({ select: (projection: object) => {
  const query: Record<string, unknown> = { projection }
  const chain = { from: () => chain, where: (where: unknown) => { query.where = where; return chain },
    groupBy: (value: unknown) => { query.groupBy = value; return chain }, orderBy: (...order: unknown[]) => { query.order = order; return chain },
    limit: (limit: number) => { query.limit = limit; return chain }, offset: (offset: number) => { query.offset = offset; return chain },
    then: (resolve: (value: object[]) => void, reject: (error: unknown) => void) => {
      mock.reads(query); return Promise.resolve(mock.rows.shift() ?? []).then(resolve, reject)
    } }
  return chain
} }) }))
vi.mock('./weld-read', () => ({ getReportOrderBy: () => [sql`joint desc, id asc`] }))
vi.mock('./journal-grid', () => ({
  journalReadContext: async (request: unknown) => { await mock.access(); return { request, revision: 1 } },
  assertJournalContextRevision: mock.revision, assertJournalRevision: mock.areaRevision, summarizeJournalGridSelection: mock.summarize, journalRouteWhere: () => sql`project_title = 'fixture'`,
  journalGroupSql: () => sql`line`, journalGroupOrder: () => sql`line desc`,
}))
import { selectJournalGridRange, summarizeJournalGridArea } from './journal-grid-range'
const input: JournalRangeRequest = { columnFilters: {}, groupBy: [], revision: 1, anchor: 'line',
  parts: [{ route: [], start: 0, end: 2, columns: ['wdi', 'joint'] }] }
beforeEach(() => { vi.clearAllMocks(); mock.rows = []; mock.revision.mockResolvedValue(undefined); mock.access.mockResolvedValue(undefined) })
it.each([2, 200000])('selects %i records with one ID-only query, merging overlaps across columns', async size => {
  mock.rows = [Array.from({ length: size }, (_, index) => ({ id: index + 1 }))]
  const result = await selectJournalGridRange({ ...input, parts: [
    { route: [], start: 0, end: size, columns: ['wdi'] }, { route: [], start: 0, end: 2, columns: ['joint'] },
  ] })
  expect(result.ids).toHaveLength(size)
  expect(new Set(result.ids).size).toBe(size)
  expect(mock.reads).toHaveBeenCalledOnce()
  const query = mock.reads.mock.calls[0][0]
  expect(Object.keys(query.projection)).toEqual(['id'])
  expect(query.limit).toBe(size); expect(query.offset).toBe(0)
  expect(mock.revision).toHaveBeenCalledOnce()
})
it('reads many selected groups as a batch and skips descendants already selected by their header', async () => {
  mock.rows = [[{ key: 'A' }, { key: 'B' }], [{ id: 1 }, { id: 2 }, { id: 3 }]]
  const result = await selectJournalGridRange({ ...input, groupBy: ['line', 'joint'], parts: [
    { route: ['A', 'S1'], start: 0, end: 1, columns: ['wdi'] },
    { route: ['A'], start: 0, end: 1, columns: ['joint'] },
    { route: [], start: 0, end: 2, columns: ['wdi'] },
  ] })
  expect(result.ids).toEqual([1, 2, 3])
  expect(mock.reads).toHaveBeenCalledTimes(2)
  const query = new PgDialect().sqlToQuery(mock.reads.mock.calls[1][0].where)
  expect(query.sql).toContain('any(')
  expect(query.params).toEqual([['A', 'B']])
})
it('refuses an out-of-bounds span, changed revision, denied access and cancellation without returning partial IDs', async () => {
  mock.rows = [[{ id: 1 }]]
  await expect(selectJournalGridRange(input)).rejects.toThrow('Диапазон больше')
  mock.rows = [[{ id: 1 }, { id: 2 }]]
  mock.revision.mockRejectedValueOnce(new Error('stale revision'))
  await expect(selectJournalGridRange(input)).rejects.toThrow('stale revision')
  mock.access.mockRejectedValueOnce(new Error('denied'))
  await expect(selectJournalGridRange(input)).rejects.toThrow('denied')
  mock.reads.mockClear()
  await expect(selectJournalGridRange(input, AbortSignal.abort())).rejects.toThrow()
  expect(mock.reads).not.toHaveBeenCalled()
})
it('validates every part before reading data', async () => {
  await expect(selectJournalGridRange({ ...input, parts: [input.parts[0], { ...input.parts[0], start: -1 }] })).rejects.toThrow('Некорректный')
  expect(mock.access).not.toHaveBeenCalled(); expect(mock.reads).not.toHaveBeenCalled()
})

it('aggregates area IDs on the server and rechecks the original revision/filter before returning totals', async () => {
  const summary = { records: 2, joints: 1, wdi: 8, missingWdi: 0, missingDates: 0, weldDate: '01.09.2026' }
  mock.rows = [[{ id: 1 }, { id: 2 }]]
  mock.summarize.mockResolvedValue(summary)
  expect(await summarizeJournalGridArea(input)).toEqual(summary)
  expect(mock.summarize).toHaveBeenCalledExactlyOnceWith({ ids: [1, 2] }, undefined)
  expect(mock.areaRevision).toHaveBeenCalledExactlyOnceWith(input.revision, input.columnFilters)
  mock.rows = [[{ id: 1 }, { id: 2 }]]
  mock.areaRevision.mockRejectedValueOnce(new Error('changed during physical aggregation'))
  await expect(summarizeJournalGridArea(input)).rejects.toThrow('changed during physical aggregation')
})
