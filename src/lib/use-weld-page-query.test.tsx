import { type InfiniteData, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { WeldPageResult } from '@/server/weld-contracts'
import {
  invalidateWeldPageQueries,
  WELD_JOINT_PAGES_QUERY_KEY,
} from '@/lib/weld-page-refresh'
import { useWeldPageQuery } from '@/lib/use-weld-page-query'

const serverMocks = vi.hoisted(() => ({
  listWeldingJournalPage: vi.fn(),
  listLnkReportPage: vi.fn(),
  listHeatTreatmentReportPage: vi.fn(),
}))

vi.mock('@/server/weld-read-api', () => ({
  WELD_PAGE_ALL_SIZE: 'all',
  WELD_PAGE_SIZE_OPTIONS: [100, 300, 500, 1000],
  ...serverMocks,
}))

describe('useWeldPageQuery refresh policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
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
      data: { page: 1, pageSize: 300, columnFilters: {} },
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
      data: { page: 1, pageSize: 300, columnFilters: {} },
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
      data: { page: 1, pageSize: 100, columnFilters: {} },
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
      data: { page: 1, pageSize: 100, columnFilters: {}, sort },
    })
    expect(queryClient.getQueryCache().find({
      queryKey: [...WELD_JOINT_PAGES_QUERY_KEY, 'lnk', {}, 100, sort],
    })).toBeDefined()
  })

  it.each(['weldingJournal', 'lnk', 'heatTreatment'] as const)(
    'keeps %s rows and totals in place while a new filter is loading', async (report) => {
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
      await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(2))
      expect(result.current.rows).toBe(originalRows)
      expect(result.current.totalCount).toBe(706)
      expect(result.current.isLoading).toBe(true)
      act(() => result.current.loadMore())
      expect(fetchPage).toHaveBeenCalledTimes(2)

      deferred.resolve(createPageResult(1, 100, 2))
      await waitFor(() => expect(result.current.rows).toHaveLength(2))
      expect(result.current.totalCount).toBe(2)
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
      data: { page: 1, pageSize: 100, columnFilters: {} },
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
      data: {
        page: 1,
        pageSize: 100,
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
      data: { page: 1, pageSize: 300, columnFilters: {} },
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
      data: { page: 1, pageSize: 300, columnFilters: {} },
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
    total,
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
