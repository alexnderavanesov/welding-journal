import { beforeEach, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { weldJoints } from '@/db/schema'
import type { JournalRangeRequest } from '@/lib/journal-server-grid'

const mock = vi.hoisted(() => ({ execute: vi.fn(), revision: vi.fn() }))
vi.mock('@/db', () => ({ requireDb: () => ({ execute: mock.execute }) }))
vi.mock('./journal-display-sql', () => ({ isJournalScalarField: () => true }))
vi.mock('./weld-read', () => ({ getReportOrderBy: () => [sql`id asc`] }))
vi.mock('./journal-grid', () => ({
  journalReadContext: async (request: unknown) => ({ request, revision: 1, settings: {} }),
  assertJournalContextRevision: mock.revision,
  journalRouteWhere: () => sql`project_title = 'fixture'`,
  journalValueSql: (key: 'weldLength' | 'd1') => weldJoints[key],
}))
import { summarizeJournalGridRange } from './journal-grid-range'

const input: JournalRangeRequest = { columnFilters: {}, groupBy: [], revision: 1, anchor: 'line',
  parts: [{ route: [], start: 0, end: 2, columns: ['weldLength', 'd1'] }] }
beforeEach(() => { vi.clearAllMocks(); mock.revision.mockResolvedValue(undefined) })

it('keeps the SQL aggregate and RPC total for L exact, adding other numeric columns without changing their aggregation', async () => {
  mock.execute.mockResolvedValue({ rows: [{ rows: 2, count: '4', numericCount: 4, sum: 114,
    lengthCount: 2, lengthSum: '600.123456789123456790' }] })
  const result = await summarizeJournalGridRange(input)
  expect(result).toMatchObject({ count: 4, numericCount: 4, exactSum: '714.12345678912345679' })
  const query = new PgDialect().sqlToQuery(mock.execute.mock.calls[0][0]).sql
  expect(query).toContain('sum("v0"::numeric)')
  expect(query).not.toContain('sum("v0"::double precision)')
  expect(query).toContain('sum("v1"::double precision)')
  expect(mock.execute).toHaveBeenCalledOnce()
  expect(mock.revision).toHaveBeenCalledOnce()
})

it('does not return any aggregate after a stale revision is detected', async () => {
  mock.execute.mockResolvedValue({ rows: [{ rows: 2, count: '2', numericCount: 2, sum: 0,
    lengthCount: 2, lengthSum: '600.123456789123456790' }] })
  mock.revision.mockRejectedValueOnce(new Error('stale revision'))
  await expect(summarizeJournalGridRange(input)).rejects.toThrow('stale revision')
})
