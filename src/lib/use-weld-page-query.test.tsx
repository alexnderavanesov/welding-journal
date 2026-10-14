import { type InfiniteData, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { WeldPageResult, WeldReportSummaryResult } from '@/server/weld-contracts'
import {
  invalidateWeldPageQueries,
  WELD_JOINT_PAGES_QUERY_KEY,
  WELD_REPORT_SUMMARY_QUERY_KEY,
} from '@/lib/weld-page-refresh'
import { useWeldPageQuery } from '@/lib/use-weld-page-query'

const serverMocks = vi.hoisted(() => ({
  listWeldingJournalPage: vi.fn(),
  listLnkReportPage: vi.fn(),
  listHeatTreatmentReportPage: vi.fn(),
  getWeldReportSummary: vi.fn(),
}))

vi.mock('@/server/weld-read-api', () => ({
  WELD_PAGE_ALL_SIZE: 'all',
  WELD_PAGE_SIZE_OPTIONS: [100, 300, 500, 1000],
  ...serverMocks,
}))

describe('useWeldPageQuery refresh policy', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    window.localStorage.clear()
    serverMocks.getWeldReportSummary.mockImplementation(({ data }) => Promise.resolve({
      total: data.columnFilters?.line === '=L1' ? 2 : 706,
      ...(data.report === 'weldingJournal' ? { acceptedWdiTotal: 42 } : {}),
      ...(data.report === 'lnk' ? { availableRequestCount: 12 } : {}),
    }))
    serverMocks.listWeldingJournalPage.mockImplementation(({ data }) =>
      Promise.resolve(createPageResult(data.page, data.pageSize, 706)),
    )
    serverMocks.listLnkReportPage.mockImplementation(({ data }) =>
      Promise.resolve(createPageResult(data.page, data.pageSize, 706)),
    )
    serverMocks.listHeatTreatmentReportPage.mockImplementation(({ data }) =>
      Promise.resolve(createPageResult(data.page, data.pageSize, 706)),
    )
  })

  it('uses one consolidated request when mounting a stale three-page cache', async () => {
    const queryClient = createQueryClient()
    const queryKey = [...WELD_JOINT_PAGES_QUERY_KEY, 'weldingJournal', {}, 100] as const
    queryClient.setQueryData(queryKey, createInfiniteData(3), {
      updatedAt: Date.now() - 2 * 60_000,
    })

    const { result } = renderHook(
      () => useWeldPageQuery({ enabled: true, report: 'weldingJournal', columnFilters: {} }),
      { wrapper: createWrapper(queryClient) },
    )

    await waitFor(() => expect(serverMocks.listWeldingJournalPage).toHaveBeenCalledTimes(1))
    expect(serverMocks.listWeldingJournalPage).toHaveBeenCalledWith({
      data: { page: 1, pageSize: 300, includeTotals: false, columnFilters: {} },
    })
    await waitFor(() => expect(result.current.rows).toHaveLength(300))
  })

  it('consolidates a stale cached report when switching directly between paged tabs', async () => {
    const queryClient = createQueryClient()
    const lnkQueryKey = [...WELD_JOINT_PAGES_QUERY_KEY, 'lnk', {}, 100] as const
    queryClient.setQueryData(lnkQueryKey, createInfiniteData(3), {
      updatedAt: Date.now() - 2 * 60_000,
    })
    const { rerender } = renderHook(
      ({ report }: { report: 'weldingJournal' | 'lnk' }) =>
        useWeldPageQuery({ enabled: true, report, columnFilters: {} }),
      {
        initialProps: { report: 'weldingJournal' } as { report: 'weldingJournal' | 'lnk' },
        wrapper: createWrapper(queryClient),
      },
    )
    await waitFor(() => expect(serverMocks.listWeldingJournalPage).toHaveBeenCalledTimes(1))

    rerender({ report: 'lnk' })

    await waitFor(() => expect(serverMocks.listLnkReportPage).toHaveBeenCalledTimes(1))
    expect(serverMocks.listLnkReportPage).toHaveBeenCalledWith({
      data: { page: 1, pageSize: 300, includeTotals: false, columnFilters: {} },
    })
  })

  it('keeps the normal first-page request for a report without cached data', async () => {
    const queryClient = createQueryClient()

    const { result } = renderHook(
      () => useWeldPageQuery({ enabled: true, report: 'heatTreatment', columnFilters: {} }),
      { wrapper: createWrapper(queryClient) },
    )

    await waitFor(() => expect(serverMocks.listHeatTreatmentReportPage).toHaveBeenCalledTimes(1))
    expect(serverMocks.listHeatTreatmentReportPage).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
      data: { page: 1, pageSize: 100, includeTotals: false, columnFilters: {} },
    })
    await waitFor(() => expect(result.current.rows).toHaveLength(100))
  })

  it('passes report sorting to the server and isolates the query cache', async () => {
    const queryClient = createQueryClient()
    const sort = { fieldKey: 'weldDate', direction: 'desc' } as const

    renderHook(
      () => useWeldPageQuery({ enabled: true, report: 'lnk', columnFilters: {}, sort }),
      { wrapper: createWrapper(queryClient) },
    )

    await waitFor(() => expect(serverMocks.listLnkReportPage).toHaveBeenCalledTimes(1))
    expect(serverMocks.listLnkReportPage).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
      data: { page: 1, pageSize: 100, includeTotals: false, columnFilters: {}, sort },
    })
    expect(queryClient.getQueryCache().find({
      queryKey: [...WELD_JOINT_PAGES_QUERY_KEY, 'lnk', {}, 100, sort],
    })).toBeDefined()
  })

  it.each(['weldingJournal', 'lnk', 'heatTreatment'] as const)(
    'retains %s geometry but blocks stale rows immediately and hides old totals', async (report) => {
      const queryClient = createQueryClient()
      const fetchPage = report === 'lnk' ? serverMocks.listLnkReportPage
        : report === 'heatTreatment' ? serverMocks.listHeatTreatmentReportPage : serverMocks.listWeldingJournalPage
      const { result, rerender } = renderHook(
        ({ columnFilters }) => useWeldPageQuery({ enabled: true, report, columnFilters }),
        { initialProps: { columnFilters: {} as Record<string, string> }, wrapper: createWrapper(queryClient) },
      )
      await waitFor(() => expect(result.current.rows).toHaveLength(100))
      const originalRows = result.current.rows
      const deferred = createDeferred<WeldPageResult>()
      fetchPage.mockReturnValueOnce(deferred.promise)

      rerender({ columnFilters: { line: '=L1' } })
      expect(result.current.rowsReady).toBe(false)
      expect(result.current.rows).toBe(originalRows)
      expect(result.current.totalCount).toBeUndefined()
      act(() => result.current.loadMore())
      expect(fetchPage).toHaveBeenCalledTimes(1)
      await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(2))
      expect(result.current.rows).toBe(originalRows)
      expect(result.current.totalCount).toBeUndefined()
      expect(result.current.rowsReady).toBe(false)
      expect(result.current.isLoading).toBe(true)
      act(() => result.current.loadMore())
      expect(fetchPage).toHaveBeenCalledTimes(2)

      deferred.resolve(createPageResult(1, 100, 2))
      await waitFor(() => expect(result.current.rows).toHaveLength(2))
      await waitFor(() => expect(result.current.totalCount).toBe(2))
      expect(result.current.rowsReady).toBe(true)
      expect(result.current.isLoading).toBe(false)
      expect(fetchPage).toHaveBeenCalledTimes(2)

      rerender({ columnFilters: {} })
      await waitFor(() => expect(result.current.rows).toHaveLength(100))
      expect(fetchPage).toHaveBeenCalledTimes(2)
    },
  )

  it('never carries the previous report rows into a different report', async () => {
    const deferred = createDeferred<WeldPageResult>()
    serverMocks.listLnkReportPage.mockReturnValueOnce(deferred.promise)
    const { result, rerender } = renderHook(
      ({ report }: { report: 'weldingJournal' | 'lnk' }) => useWeldPageQuery({ enabled: true, report, columnFilters: {} }),
      { initialProps: { report: 'weldingJournal' } as { report: 'weldingJournal' | 'lnk' }, wrapper: createWrapper(createQueryClient()) },
    )
    await waitFor(() => expect(result.current.rows).toHaveLength(100))
    rerender({ report: 'lnk' })
    await waitFor(() => expect(serverMocks.listLnkReportPage).toHaveBeenCalledTimes(1))
    expect(result.current.rows).toEqual([])
    deferred.resolve(createPageResult(1, 100, 1))
    await waitFor(() => expect(result.current.rows).toHaveLength(1))
  })

  it('reports a failed filter request instead of presenting old rows as its result', async () => {
    const deferred = createDeferred<WeldPageResult>()
    const { result, rerender } = renderHook(
      ({ columnFilters }) => useWeldPageQuery({ enabled: true, columnFilters }),
      { initialProps: { columnFilters: {} as Record<string, string> }, wrapper: createWrapper(createQueryClient()) },
    )
    await waitFor(() => expect(result.current.rows).toHaveLength(100))
    serverMocks.listWeldingJournalPage.mockReturnValueOnce(deferred.promise)
    rerender({ columnFilters: { line: '=L1' } })
    await waitFor(() => expect(serverMocks.listWeldingJournalPage).toHaveBeenCalledTimes(2))
    deferred.reject(new Error('Не удалось загрузить строки'))
    await waitFor(() => expect(result.current.error?.message).toBe('Не удалось загрузить строки'))
    expect(result.current.rows).toEqual([])
    expect(serverMocks.listWeldingJournalPage).toHaveBeenCalledTimes(2)
  })

  it('drops the removed all-rows page size from an older browser setting', async () => {
    window.localStorage.setItem('welding-report-page-size:v1', JSON.stringify({ lnk: -1 }))
    const queryClient = createQueryClient()

    const { result } = renderHook(
      () => useWeldPageQuery({ enabled: true, report: 'lnk', columnFilters: {} }),
      { wrapper: createWrapper(queryClient) },
    )

    await waitFor(() => expect(serverMocks.listLnkReportPage).toHaveBeenCalledTimes(1))
    expect(serverMocks.listLnkReportPage).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
      data: { page: 1, pageSize: 100, includeTotals: false, columnFilters: {} },
    })
    expect(result.current.pageSize).toBe(100)
  })

  it('sends quick search as a server-wide filter without treating it as a table column', async () => {
    const queryClient = createQueryClient()

    renderHook(
      () => useWeldPageQuery({
        enabled: true,
        report: 'lnk',
        columnFilters: { search: '  S13  ', line: '=2' },
      }),
      { wrapper: createWrapper(queryClient) },
    )

    await waitFor(() => expect(serverMocks.listLnkReportPage).toHaveBeenCalledTimes(1))
    expect(serverMocks.listLnkReportPage).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
      data: {
        page: 1,
        pageSize: 100,
        includeTotals: false,
        search: 'S13',
        columnFilters: { line: '=2' },
      },
    })
  })

  it('refreshes an active three-page report once after a data invalidation', async () => {
    const queryClient = createQueryClient()
    const queryKey = [...WELD_JOINT_PAGES_QUERY_KEY, 'weldingJournal', {}, 100] as const
    queryClient.setQueryData(queryKey, createInfiniteData(3))
    renderHook(
      () => useWeldPageQuery({ enabled: true, report: 'weldingJournal', columnFilters: {} }),
      { wrapper: createWrapper(queryClient) },
    )
    expect(serverMocks.listWeldingJournalPage).not.toHaveBeenCalled()

    await act(async () => {
      await invalidateWeldPageQueries(queryClient)
    })

    expect(serverMocks.listWeldingJournalPage).toHaveBeenCalledTimes(1)
    expect(serverMocks.listWeldingJournalPage).toHaveBeenCalledWith({
      data: { page: 1, pageSize: 300, includeTotals: false, columnFilters: {} },
    })
  })

  it('coalesces simultaneous focus and online refreshes into one request', async () => {
    const queryClient = createQueryClient()
    const queryKey = [...WELD_JOINT_PAGES_QUERY_KEY, 'weldingJournal', {}, 100] as const
    queryClient.setQueryData(queryKey, createInfiniteData(3), {
      updatedAt: Date.now() - 31_000,
    })
    const deferred = createDeferred<WeldPageResult>()
    serverMocks.listWeldingJournalPage.mockReturnValue(deferred.promise)

    renderHook(
      () => useWeldPageQuery({ enabled: true, report: 'weldingJournal', columnFilters: {} }),
      { wrapper: createWrapper(queryClient) },
    )
    expect(serverMocks.listWeldingJournalPage).not.toHaveBeenCalled()

    act(() => {
      window.dispatchEvent(new Event('focus'))
      window.dispatchEvent(new Event('online'))
    })

    expect(serverMocks.listWeldingJournalPage).toHaveBeenCalledTimes(1)
    expect(serverMocks.listWeldingJournalPage).toHaveBeenCalledWith({
      data: { page: 1, pageSize: 300, includeTotals: false, columnFilters: {} },
    })

    deferred.resolve(createPageResult(1, 300, 706))
    await waitFor(() => expect(queryClient.getQueryState(queryKey)?.fetchStatus).toBe('idle'))
    expect(serverMocks.listWeldingJournalPage).toHaveBeenCalledTimes(1)
  })

  it('does not loop when a consolidated activation refresh fails', async () => {
    const queryClient = createQueryClient()
    const queryKey = [...WELD_JOINT_PAGES_QUERY_KEY, 'weldingJournal', {}, 100] as const
    queryClient.setQueryData(queryKey, createInfiniteData(3), {
      updatedAt: Date.now() - 2 * 60_000,
    })
    serverMocks.listWeldingJournalPage.mockRejectedValue(new Error('Временная ошибка'))

    const { result } = renderHook(
      () => useWeldPageQuery({ enabled: true, report: 'weldingJournal', columnFilters: {} }),
      { wrapper: createWrapper(queryClient) },
    )

    await waitFor(() => expect(result.current.error?.message).toBe('Временная ошибка'))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(serverMocks.listWeldingJournalPage).toHaveBeenCalledTimes(1)
    expect(result.current.rows).toHaveLength(300)
  })

  it('retries the first page when the initial request failed before a cache existed', async () => {
    const queryClient = createQueryClient()
    serverMocks.listWeldingJournalPage
      .mockRejectedValueOnce(new Error('Временная ошибка'))
      .mockImplementation(({ data }) => Promise.resolve(createPageResult(data.page, data.pageSize, 706)))

    const { result } = renderHook(
      () => useWeldPageQuery({ enabled: true, report: 'weldingJournal', columnFilters: {} }),
      { wrapper: createWrapper(queryClient) },
    )

    await waitFor(() => expect(result.current.error?.message).toBe('Временная ошибка'))
    await act(async () => {
      await result.current.refetch()
    })

    await waitFor(() => expect(result.current.rows).toHaveLength(100))
    expect(result.current.error).toBeNull()
    expect(serverMocks.listWeldingJournalPage).toHaveBeenCalledTimes(2)
  })
  it('starts counts only after rows, keeps rows usable on summary failure and retries counts alone', async () => {
    const page = createDeferred<WeldPageResult>()
    const counts = createDeferred<WeldReportSummaryResult>()
    serverMocks.listWeldingJournalPage.mockReturnValueOnce(page.promise)
    serverMocks.getWeldReportSummary.mockReturnValueOnce(counts.promise)
    const { result } = renderHook(() => useWeldPageQuery({ enabled: true, columnFilters: {} }), {
      wrapper: createWrapper(createQueryClient()),
    })
    expect(serverMocks.getWeldReportSummary).not.toHaveBeenCalled()
    await act(async () => page.resolve(createPageResult(1, 100, 706)))
    await waitFor(() => expect(result.current.rowsReady).toBe(true))
    expect(result.current.isLoading).toBe(false)
    expect(result.current.summaryStatus).toBe('pending')
    expect(result.current.totalCount).toBeUndefined()
    expect(result.current.acceptedWdiTotal).toBeUndefined()
    expect(result.current.firstItemNumber).toBe(1)
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.rows).toHaveLength(200))
    expect(serverMocks.getWeldReportSummary).toHaveBeenCalledTimes(1)
    await act(async () => counts.reject(new Error('Counts unavailable')))
    await waitFor(() => expect(result.current.summaryStatus).toBe('error'))
    expect(result.current.rowsReady).toBe(true)
    expect(result.current.rows).toHaveLength(200)
    expect(result.current.error).toBeNull()
    expect(result.current.summaryError?.message).toBe('Counts unavailable')
    serverMocks.getWeldReportSummary.mockResolvedValueOnce({ total: 706, acceptedWdiTotal: 0 })
    act(() => result.current.retrySummary())
    await waitFor(() => expect(result.current.acceptedWdiTotal).toBe(0))
    expect(serverMocks.listWeldingJournalPage).toHaveBeenCalledTimes(2)
    expect(serverMocks.getWeldReportSummary).toHaveBeenCalledTimes(2)
  })

  it('exposes a failed background refresh and retries rows explicitly before counts without looping', async () => {
    const client = createQueryClient()
    const { result, rerender } = renderHook(() => useWeldPageQuery({ enabled: true, columnFilters: {} }), {
      wrapper: createWrapper(client),
    })
    await waitFor(() => expect(result.current.summaryStatus).toBe('ready'))
    const rows = result.current.rows
    serverMocks.listWeldingJournalPage.mockRejectedValueOnce(new Error('Background rows unavailable'))
    await act(async () => { await invalidateWeldPageQueries(client) })
    await waitFor(() => expect(result.current.error?.message).toBe('Background rows unavailable'))
    expect(result.current.rows).toBe(rows)
    expect(result.current.rowsReady).toBe(true)
    expect(result.current.summaryStatus).toBe('error')
    expect(result.current.summaryError).toBeNull()
    expect(result.current.totalCount).toBeUndefined()
    rerender()
    act(() => { result.current.loadMore(); result.current.retrySummary() })
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(serverMocks.listWeldingJournalPage).toHaveBeenCalledTimes(2)
    expect(serverMocks.getWeldReportSummary).toHaveBeenCalledTimes(1)

    const counts = createDeferred<WeldReportSummaryResult>()
    serverMocks.getWeldReportSummary.mockReturnValueOnce(counts.promise)
    await act(async () => { expect(await result.current.refetch()).toBe(true) })
    await waitFor(() => expect(serverMocks.getWeldReportSummary).toHaveBeenCalledTimes(2))
    expect(result.current.error).toBeNull()
    expect(result.current.summaryStatus).toBe('pending')
    expect(serverMocks.listWeldingJournalPage).toHaveBeenCalledTimes(3)
    await act(async () => counts.resolve({ total: 706, acceptedWdiTotal: 42 }))
    await waitFor(() => expect(result.current.summaryStatus).toBe('ready'))
  })

  it.each(['resolve', 'reject'] as const)('ignores a late A row %s after B is ready', async (outcome) => {
    const oldPage = createDeferred<WeldPageResult>()
    serverMocks.listWeldingJournalPage.mockReturnValueOnce(oldPage.promise)
    const { result, rerender } = renderHook(({ search }) => useWeldPageQuery({
      enabled: true, columnFilters: { search },
    }), { initialProps: { search: 'A' }, wrapper: createWrapper(createQueryClient()) })
    rerender({ search: 'B' })
    expect(result.current.rowsReady).toBe(false)
    await waitFor(() => expect(serverMocks.listWeldingJournalPage).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.summaryStatus).toBe('ready'))
    const latestRows = result.current.rows
    await act(async () => {
      if (outcome === 'resolve') oldPage.resolve(createPageResult(1, 100, 1))
      else oldPage.reject(new Error('Old A failed'))
    })
    expect(result.current.rows).toBe(latestRows)
    expect(result.current.rowsReady).toBe(true)
    expect(result.current.error).toBeNull()
    expect(serverMocks.getWeldReportSummary).toHaveBeenCalledTimes(1)
    expect(serverMocks.getWeldReportSummary.mock.calls[0][0].data.search).toBe('B')
    expect(serverMocks.listWeldingJournalPage.mock.calls[0][0].signal.aborted).toBe(true)
  })

  it.each(['resolve', 'reject'] as const)('ignores a late A summary %s after B is ready', async (outcome) => {
    const oldCounts = createDeferred<WeldReportSummaryResult>()
    serverMocks.getWeldReportSummary.mockReturnValueOnce(oldCounts.promise).mockResolvedValueOnce({ total: 17, acceptedWdiTotal: 5 })
    const { result, rerender } = renderHook(({ search }) => useWeldPageQuery({
      enabled: true, columnFilters: { search },
    }), { initialProps: { search: 'A' }, wrapper: createWrapper(createQueryClient()) })
    await waitFor(() => expect(serverMocks.getWeldReportSummary).toHaveBeenCalledTimes(1))
    rerender({ search: 'B' })
    expect(result.current.totalCount).toBeUndefined()
    await waitFor(() => expect(result.current.totalCount).toBe(17))
    await act(async () => {
      if (outcome === 'resolve') oldCounts.resolve({ total: 999, acceptedWdiTotal: 999 })
      else oldCounts.reject(new Error('Old summary failed'))
    })
    expect(result.current.totalCount).toBe(17)
    expect(result.current.acceptedWdiTotal).toBe(5)
    expect(result.current.summaryError).toBeNull()
    expect(result.current.rowsReady).toBe(true)
  })

  it('debounces report, filters and sort together without sending intermediate conditions', async () => {
    const { result, rerender } = renderHook(({ report, search, direction }) => useWeldPageQuery({
      enabled: true, report, columnFilters: { search }, sort: { fieldKey: 'joint', direction },
    }), { initialProps: { report: 'weldingJournal' as 'weldingJournal' | 'lnk', search: 'A', direction: 'asc' as 'asc' | 'desc' },
      wrapper: createWrapper(createQueryClient()) })
    await waitFor(() => expect(result.current.rowsReady).toBe(true))
    rerender({ report: 'lnk', search: 'B', direction: 'desc' })
    expect(result.current.rows).toEqual([])
    expect(result.current.rowsReady).toBe(false)
    expect(serverMocks.listLnkReportPage).not.toHaveBeenCalled()
    rerender({ report: 'lnk', search: 'C', direction: 'asc' })
    await waitFor(() => expect(serverMocks.listLnkReportPage).toHaveBeenCalledTimes(1))
    expect(serverMocks.listLnkReportPage.mock.calls[0][0].data).toEqual({
      page: 1, pageSize: 100, includeTotals: false, columnFilters: {}, search: 'C',
      sort: { fieldKey: 'joint', direction: 'asc' },
    })
    expect(serverMocks.listWeldingJournalPage).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(result.current.summaryStatus).toBe('ready'))
    expect(serverMocks.getWeldReportSummary.mock.calls.at(-1)?.[0].data).toEqual({
      report: 'lnk', columnFilters: {}, search: 'C',
    })
  })

  it('reuses a summary across sorting, page-size changes and scrolling', async () => {
    const { result, rerender } = renderHook(({ direction }) => useWeldPageQuery({
      enabled: true, columnFilters: { search: ' A ' }, sort: { fieldKey: 'joint', direction },
    }), { initialProps: { direction: 'asc' as 'asc' | 'desc' }, wrapper: createWrapper(createQueryClient()) })
    await waitFor(() => expect(result.current.summaryStatus).toBe('ready'))
    rerender({ direction: 'desc' })
    await waitFor(() => expect(result.current.rowsReady).toBe(true))
    act(() => result.current.setPageSize(300))
    await waitFor(() => expect(result.current.rows).toHaveLength(300))
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.rows).toHaveLength(600))
    expect(serverMocks.getWeldReportSummary).toHaveBeenCalledTimes(1)
  })

  it('invalidates all summary caches but refetches only the active one, after rows, without awaiting counts', async () => {
    const client = createQueryClient()
    for (let n = 0; n < 30; n++) client.setQueryData(
      [...WELD_REPORT_SUMMARY_QUERY_KEY, 'weldingJournal', { search: `inactive-${n}` }], { total: n },
    )
    const { result } = renderHook(() => useWeldPageQuery({ enabled: true, columnFilters: {} }), { wrapper: createWrapper(client) })
    await waitFor(() => expect(result.current.summaryStatus).toBe('ready'))
    const page = createDeferred<WeldPageResult>(), counts = createDeferred<WeldReportSummaryResult>()
    serverMocks.listWeldingJournalPage.mockReturnValueOnce(page.promise)
    serverMocks.getWeldReportSummary.mockReturnValueOnce(counts.promise)
    let invalidating!: Promise<void>
    act(() => { invalidating = invalidateWeldPageQueries(client) })
    expect(result.current.totalCount).toBeUndefined()
    expect(serverMocks.getWeldReportSummary).toHaveBeenCalledTimes(1)
    await act(async () => { page.resolve(createPageResult(1, 100, 706)); await invalidating })
    await waitFor(() => expect(serverMocks.getWeldReportSummary).toHaveBeenCalledTimes(2))
    expect(result.current.rowsReady).toBe(true)
    expect(result.current.summaryStatus).toBe('pending')
    for (let n = 0; n < 30; n++) expect(client.getQueryState(
      [...WELD_REPORT_SUMMARY_QUERY_KEY, 'weldingJournal', { search: `inactive-${n}` }],
    )?.isInvalidated).toBe(true)
    await act(async () => counts.resolve({ total: 706, acceptedWdiTotal: 42 }))
  })

  it('does not refetch a fresh summary on rerender, focus, reconnect or remount', async () => {
    const client = createQueryClient(), wrapper = createWrapper(client)
    const first = renderHook(() => useWeldPageQuery({ enabled: true, columnFilters: {} }), { wrapper })
    await waitFor(() => expect(first.result.current.summaryStatus).toBe('ready'))
    first.rerender()
    act(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')) })
    first.unmount()
    const second = renderHook(() => useWeldPageQuery({ enabled: true, columnFilters: {} }), { wrapper })
    expect(second.result.current.summaryStatus).toBe('ready')
    expect(serverMocks.listWeldingJournalPage).toHaveBeenCalledTimes(1)
    expect(serverMocks.getWeldReportSummary).toHaveBeenCalledTimes(1)
  })

  it('reconciles an invalidation during the first rows request before starting counts', async () => {
    const client = createQueryClient()
    const oldPage = createDeferred<WeldPageResult>(), newPage = createDeferred<WeldPageResult>()
    serverMocks.listWeldingJournalPage.mockReturnValueOnce(oldPage.promise).mockReturnValueOnce(newPage.promise)
    const { result } = renderHook(() => useWeldPageQuery({ enabled: true, columnFilters: {} }), {
      wrapper: createWrapper(client),
    })
    let invalidating!: Promise<void>
    act(() => { invalidating = invalidateWeldPageQueries(client) })
    await waitFor(() => expect(serverMocks.listWeldingJournalPage).toHaveBeenCalledTimes(2))
    expect(serverMocks.getWeldReportSummary).not.toHaveBeenCalled()
    await act(async () => { newPage.resolve(createPageResult(1, 100, 3)); await invalidating })
    await waitFor(() => expect(result.current.summaryStatus).toBe('ready'))
    await act(async () => oldPage.resolve(createPageResult(1, 100, 99)))
    expect(result.current.rows).toHaveLength(3)
    expect(result.current.rowsReady).toBe(true)
    expect(serverMocks.getWeldReportSummary).toHaveBeenCalledTimes(1)
  })

  it('restarts a cancelled count after a fast row refresh without a refetch storm', async () => {
    const counts = createDeferred<WeldReportSummaryResult>()
    serverMocks.getWeldReportSummary.mockReturnValueOnce(counts.promise)
    const client = createQueryClient()
    const { result } = renderHook(() => useWeldPageQuery({ enabled: true, columnFilters: {} }), {
      wrapper: createWrapper(client),
    })
    await waitFor(() => expect(serverMocks.getWeldReportSummary).toHaveBeenCalledTimes(1))
    await act(async () => { await invalidateWeldPageQueries(client) })
    await waitFor(() => expect(result.current.summaryStatus).toBe('ready'))
    expect(serverMocks.getWeldReportSummary).toHaveBeenCalledTimes(2)
    expect(serverMocks.listWeldingJournalPage).toHaveBeenCalledTimes(2)
    await act(async () => counts.resolve({ total: 999 }))
    expect(result.current.totalCount).toBe(706)
    expect(serverMocks.getWeldReportSummary).toHaveBeenCalledTimes(2)
  })

  it.each(['resolve', 'reject'] as const)('does not let an old A refresh %s clear or replace the current B refresh error', async (outcome) => {
    const { result, rerender } = renderHook(({ search }) => useWeldPageQuery({
      enabled: true, columnFilters: { search },
    }), { initialProps: { search: 'A' }, wrapper: createWrapper(createQueryClient()) })
    await waitFor(() => expect(result.current.summaryStatus).toBe('ready'))
    const oldRefresh = createDeferred<WeldPageResult>()
    serverMocks.listWeldingJournalPage.mockReturnValueOnce(oldRefresh.promise)
    let refreshing!: Promise<boolean>
    act(() => { refreshing = result.current.refetch(true) })
    rerender({ search: 'B' })
    await waitFor(() => expect(result.current.rowsReady).toBe(true))
    serverMocks.listWeldingJournalPage.mockRejectedValueOnce(new Error('Current B failed'))
    await act(async () => { await result.current.refetch(true) })
    expect(result.current.error?.message).toBe('Current B failed')
    await act(async () => {
      if (outcome === 'resolve') oldRefresh.resolve(createPageResult(1, 100, 1))
      else oldRefresh.reject(new Error('Old A failed'))
      await refreshing
    })
    expect(result.current.error?.message).toBe('Current B failed')
    expect(result.current.rows).toHaveLength(100)
  })

  it.each(['resolve', 'reject'] as const)('isolates a late background A %s after switching to B', async (outcome) => {
    const client = createQueryClient()
    const { result, rerender } = renderHook(({ search }) => useWeldPageQuery({
      enabled: true, columnFilters: { search },
    }), { initialProps: { search: 'A' }, wrapper: createWrapper(client) })
    await waitFor(() => expect(result.current.summaryStatus).toBe('ready'))
    const oldRefresh = createDeferred<WeldPageResult>()
    serverMocks.listWeldingJournalPage.mockReturnValueOnce(oldRefresh.promise)
    let invalidating!: Promise<void>
    act(() => { invalidating = invalidateWeldPageQueries(client) })
    rerender({ search: 'B' })
    await waitFor(() => expect(result.current.summaryStatus).toBe('ready'))
    const rows = result.current.rows
    await act(async () => {
      if (outcome === 'resolve') oldRefresh.resolve(createPageResult(1, 100, 1))
      else oldRefresh.reject(new Error('Background A failed'))
      await invalidating
    })
    expect(result.current.error).toBeNull()
    expect(result.current.summaryStatus).toBe('ready')
    expect(result.current.rows).toBe(rows)
    expect(serverMocks.listWeldingJournalPage).toHaveBeenCalledTimes(3)
    expect(serverMocks.getWeldReportSummary).toHaveBeenCalledTimes(2)
  })
})

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })
}

function createWrapper(queryClient: QueryClient) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

function createInfiniteData(pageCount: number): InfiniteData<WeldPageResult> {
  return {
    pages: Array.from({ length: pageCount }, (_, index) => createPageResult(index + 1, 100, 706)),
    pageParams: Array.from({ length: pageCount }, (_, index) => index + 1),
  }
}

function createPageResult(page: number, pageSize: WeldPageResult['pageSize'], total: number): WeldPageResult {
  const numericPageSize = pageSize === 'all' ? total : pageSize
  const firstId = (page - 1) * numericPageSize + 1
  const rowCount = Math.min(numericPageSize, Math.max(0, total - firstId + 1))
  return {
    rows: Array.from({ length: rowCount }, (_, index) => ({
      id: firstId + index,
      joint: `S${firstId + index}`,
    })) as WeldRow[],
    page,
    pageSize,
    hasMore: page * numericPageSize < total,
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}
