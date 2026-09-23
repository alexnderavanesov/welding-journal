import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const serverMocks = vi.hoisted(() => ({
  listWeldReportContextRows: vi.fn(),
  listLnkReportPage: vi.fn(),
  listHeatTreatmentReportPage: vi.fn(),
}))
vi.mock('@/server/weld-read-api', () => serverMocks)

import {
  loadCompleteReportOutputRows,
  loadFilteredCurrentReportOutputRows,
} from '@/lib/report-output-source'

describe('complete report output source', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keeps every row beyond the 500-row modal limit and reuses the same report snapshot', async () => {
    const rows = Array.from({ length: 501 }, (_, index) => ({ id: index + 1 }))
    serverMocks.listWeldReportContextRows.mockResolvedValueOnce(rows)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const first = await loadCompleteReportOutputRows(queryClient, 'lnk')
    const second = await loadCompleteReportOutputRows(queryClient, 'lnk')

    expect(first).toHaveLength(501)
    expect(first[500]?.id).toBe(501)
    expect(second).toBe(first)
    expect(serverMocks.listWeldReportContextRows).toHaveBeenCalledTimes(1)
    expect(serverMocks.listWeldReportContextRows).toHaveBeenCalledWith({ data: { report: 'lnk' } })
  })

  it('requests every matching current-report row with the active filters and sort', async () => {
    const rows = [{ id: 7 }, { id: 501 }]
    serverMocks.listLnkReportPage.mockResolvedValueOnce({ rows })

    const result = await loadFilteredCurrentReportOutputRows({
      report: 'lnk',
      columnFilters: { search: ' F501 ', line: '=LINE-1' },
      sort: { fieldKey: 'weldDate', direction: 'desc' },
    })

    expect(result).toBe(rows)
    expect(serverMocks.listLnkReportPage).toHaveBeenCalledWith({
      data: {
        page: 1,
        pageSize: 'all',
        columnFilters: { line: '=LINE-1' },
        search: 'F501',
        sort: { fieldKey: 'weldDate', direction: 'desc' },
      },
    })
    expect(serverMocks.listWeldReportContextRows).not.toHaveBeenCalled()
  })
})
