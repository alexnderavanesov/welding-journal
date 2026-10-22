import { expect, it, vi } from 'vitest'
import type { JournalRangeRequest } from '@/lib/journal-server-grid'
import { copyJournalGridRange } from './journal-grid-range'

vi.mock('@/db', () => ({ requireDb: vi.fn() }))
vi.mock('./weld-read', () => ({ getReportOrderBy: vi.fn() }))
vi.mock('./journal-grid', () => ({
  journalReadContext: vi.fn(async request => ({ request, revision: 1 })),
  assertJournalContextRevision: vi.fn(), journalRouteWhere: vi.fn(),
  journalValueSql: vi.fn(), readJournalLeafRows: vi.fn(),
  readJournalPage: vi.fn(async ({ request }) => ({ rowCount: 3, rows: Array.from({ length: request.end - request.start }, (_, index) => ({
    id: 0, journalGroup: { key: ['A', 'B', 'C'][request.start + index], route: ['group'],
      summary: { wdi: request.start + index + 1, joints: 10 + request.start + index } },
  })) })),
}))

it('keeps headers for distinct copied ranges without repeating them for store segments', async () => {
  const input = { columnFilters: {}, groupBy: ['line'], revision: 1, anchor: 'line', parts: [
    { route: [], start: 0, end: 1, columns: ['joint'], includeHeader: true },
    { route: [], start: 1, end: 2, columns: ['joint'] },
    { route: [], start: 2, end: 3, columns: ['wdi'], includeHeader: true },
  ] } as JournalRangeRequest
  expect(await copyJournalGridRange(input)).toBe('Стык\r\n10\r\n11\r\nWDI\r\n3')
})
