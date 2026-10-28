import { expect, it, vi } from 'vitest'
import type { JournalRangeRequest } from '@/lib/journal-server-grid'
import { copyJournalGridRange, journalRangeValue } from './journal-grid-range'
import type { JournalGridRow } from '@/lib/journal-server-grid'
import { loadOtherSettings } from '@/lib/other-settings'

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

it('copies only values across distinct ranges and store segments without column headers', async () => {
  const input = { columnFilters: {}, groupBy: ['line'], revision: 1, anchor: 'line', parts: [
    { route: [], start: 0, end: 1, columns: ['joint'] },
    { route: [], start: 1, end: 2, columns: ['joint'] },
    { route: [], start: 2, end: 3, columns: ['wdi'] },
  ] } as JournalRangeRequest
  expect(await copyJournalGridRange(input)).toBe('10\r\n11\r\n3')
})

it('copies the configured RK exposure label using server settings', () => {
  const row = { id: 1, d1: 57, d2: 57, connectionType: 'С17', rkExposureConfirmedDiameter: 57, lnkDefectDescription: '1: ДНО' } as JournalGridRow
  const settings = { ...loadOtherSettings(), rkExposureTable: { fileName: 'Настройка.xlsx', uploadedAt: '2026-10-22', entries: [
    { diameter: 57, options: [{ label: 'Особая схема', values: ['1'], isDefault: true, note: '' }] },
  ] } }
  expect(journalRangeValue(row, 'rkExposureScheme', 'line', [], 'lnk', settings)).toBe('Особая схема')
})
