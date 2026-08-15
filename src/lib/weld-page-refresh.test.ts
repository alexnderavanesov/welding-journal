import { type InfiniteData, QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { WeldPageRequest, WeldPageResult, WeldReportKind } from '@/server/welds'
import {
  invalidateWeldPageQueries,
  isWeldPageRefreshRequired,
  refreshLoadedWeldPageQuery,
  WELD_JOINT_PAGES_QUERY_KEY,
} from '@/lib/weld-page-refresh'

describe('consolidated weld page refresh', () => {
  it('refreshes three loaded 100-row pages with one 300-row request', async () => {
    const queryClient = createQueryClient()
    const queryKey = createQueryKey()
    queryClient.setQueryData(queryKey, createInfiniteData(3, 706))
    const fetchPage = vi.fn(async (_report: WeldReportKind, request: WeldPageRequest) =>
      createResult(1, 300, 706, request.pageSize, { acceptedWdiTotal: 412.5 }),
    )

    await refreshLoadedWeldPageQuery(queryClient, queryKey, { fetchPage })

    expect(fetchPage).toHaveBeenCalledTimes(1)
    expect(fetchPage).toHaveBeenCalledWith('weldingJournal', {
      page: 1,
      pageSize: 300,
      columnFilters: {},
    })
    const refreshed = queryClient.getQueryData<InfiniteData<WeldPageResult>>(queryKey)
    expect(refreshed?.pages).toHaveLength(3)
    expect(refreshed?.pages.map((page) => page.rows.length)).toEqual([100, 100, 100])
    expect(refreshed?.pages[0].acceptedWdiTotal).toBe(412.5)
    expect(refreshed?.pages[1].acceptedWdiTotal).toBeUndefined()
  })

  it('refreshes seven loaded pages with one 1000-row request and keeps only the loaded range', async () => {
    const queryClient = createQueryClient()
    const queryKey = createQueryKey()
    queryClient.setQueryData(queryKey, createInfiniteData(7, 1400))
    const fetchPage = vi.fn(async (_report: WeldReportKind, request: WeldPageRequest) =>
      createResult(1, 1000, 1400, request.pageSize),
    )

    await refreshLoadedWeldPageQuery(queryClient, queryKey, { fetchPage })

    expect(fetchPage).toHaveBeenCalledTimes(1)
    expect(fetchPage.mock.calls[0]?.[1].pageSize).toBe(1000)
    const refreshed = queryClient.getQueryData<InfiniteData<WeldPageResult>>(queryKey)
    expect(refreshed?.pages).toHaveLength(7)
    expect(refreshed?.pages.flatMap((page) => page.rows)).toHaveLength(700)
    expect(refreshed?.pages.at(-1)?.hasMore).toBe(true)
  })

  it('preserves the cached total when a refresh response omits it', async () => {
    const queryClient = createQueryClient()
    const queryKey = createQueryKey()
    queryClient.setQueryData(queryKey, createInfiniteData(3, 706))
    const fetchPage = vi.fn(async (_report: WeldReportKind, request: WeldPageRequest) => {
      const result = createResult(1, 300, 706, request.pageSize)
      delete result.total
      return result
    })

    await refreshLoadedWeldPageQuery(queryClient, queryKey, { fetchPage })

    const refreshed = queryClient.getQueryData<InfiniteData<WeldPageResult>>(queryKey)
    expect(refreshed?.pages.map((page) => page.total)).toEqual([706, 706, 706])
    expect(refreshed?.pages.at(-1)?.hasMore).toBe(true)
  })

  it('uses 1000-row batches when more than 1000 rows are loaded', async () => {
    const queryClient = createQueryClient()
    const queryKey = createQueryKey()
    queryClient.setQueryData(queryKey, createInfiniteData(12, 2400))
    const fetchPage = vi.fn(async (_report: WeldReportKind, request: WeldPageRequest) =>
      createResult(
        request.page ?? 1,
        request.page === 1 ? 1000 : 1000,
        2400,
        request.pageSize,
      ),
    )

    await refreshLoadedWeldPageQuery(queryClient, queryKey, { fetchPage })

    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(fetchPage.mock.calls.map(([, request]) => [request.page, request.pageSize])).toEqual([
      [1, 1000],
      [2, 1000],
    ])
    expect(
      queryClient
        .getQueryData<InfiniteData<WeldPageResult>>(queryKey)
        ?.pages.flatMap((page) => page.rows),
    ).toHaveLength(1200)
  })

  it('removes empty trailing pages when the filtered result becomes smaller', async () => {
    const queryClient = createQueryClient()
    const queryKey = createQueryKey('lnk', { result: 'годен' })
    queryClient.setQueryData(queryKey, createInfiniteData(7, 706))
    const fetchPage = vi.fn(async (_report: WeldReportKind, request: WeldPageRequest) =>
      createResult(1, 150, 150, request.pageSize, { availableRequestCount: 12 }),
    )

    await refreshLoadedWeldPageQuery(queryClient, queryKey, { fetchPage })

    const refreshed = queryClient.getQueryData<InfiniteData<WeldPageResult>>(queryKey)
    expect(refreshed?.pages.map((page) => page.rows.length)).toEqual([100, 50])
    expect(refreshed?.pageParams).toEqual([1, 2])
    expect(refreshed?.pages[0].availableRequestCount).toBe(12)
    expect(refreshed?.pages[1].hasMore).toBe(false)
  })

  it('deduplicates simultaneous refreshes of the same cache snapshot', async () => {
    const queryClient = createQueryClient()
    const queryKey = createQueryKey()
    queryClient.setQueryData(queryKey, createInfiniteData(3, 500))
    const deferred = createDeferred<WeldPageResult>()
    const fetchPage = vi.fn(() => deferred.promise)

    const first = refreshLoadedWeldPageQuery(queryClient, queryKey, { fetchPage })
    const second = refreshLoadedWeldPageQuery(queryClient, queryKey, { fetchPage })
    deferred.resolve(createResult(1, 300, 500, 300))

    await Promise.all([first, second])
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  it('does not overwrite a newer cache snapshot with an older response', async () => {
    const queryClient = createQueryClient()
    const queryKey = createQueryKey()
    const original = createInfiniteData(1, 2)
    queryClient.setQueryData(queryKey, original)
    const firstResponse = createDeferred<WeldPageResult>()
    const newerResult = createResult(1, 2, 2, 100)
    newerResult.rows = createRows(100, 2)
    const fetchPage = vi.fn()
      .mockImplementationOnce(() => firstResponse.promise)
      .mockResolvedValueOnce(newerResult)

    const refresh = refreshLoadedWeldPageQuery(queryClient, queryKey, { fetchPage })
    queryClient.setQueryData(queryKey, createInfiniteData(1, 2, 100))
    firstResponse.resolve(createResult(1, 2, 2, 100))
    await refresh

    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(
      queryClient.getQueryData<InfiniteData<WeldPageResult>>(queryKey)?.pages[0].rows[0]?.id,
    ).toBe(100)
  })

  it('marks an inactive cached report for a consolidated refresh without invalidating React Query', async () => {
    const queryClient = createQueryClient()
    const queryKey = createQueryKey()
    queryClient.setQueryData(queryKey, createInfiniteData(3, 500))
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    await invalidateWeldPageQueries(queryClient)

    expect(invalidateSpy).not.toHaveBeenCalled()
    expect(isWeldPageRefreshRequired(queryClient, queryKey)).toBe(true)
    await refreshLoadedWeldPageQuery(queryClient, queryKey, {
      fetchPage: async (_report, request) => createResult(1, 300, 500, request.pageSize),
      force: true,
    })
    expect(isWeldPageRefreshRequired(queryClient, queryKey)).toBe(false)
  })
})

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function createQueryKey(
  report: WeldReportKind = 'weldingJournal',
  columnFilters: Record<string, string> = {},
) {
  return [...WELD_JOINT_PAGES_QUERY_KEY, report, columnFilters, 100] as const
}

function createInfiniteData(pageCount: number, total: number, firstId = 1): InfiniteData<WeldPageResult> {
  return {
    pages: Array.from({ length: pageCount }, (_, index) => ({
      rows: createRows(firstId + index * 100, Math.min(100, Math.max(0, total - index * 100))),
      total,
      page: index + 1,
      pageSize: 100,
      hasMore: (index + 1) * 100 < total,
    })),
    pageParams: Array.from({ length: pageCount }, (_, index) => index + 1),
  }
}

function createResult(
  page: number,
  rowCount: number,
  total: number,
  pageSize: WeldPageRequest['pageSize'],
  summary: Pick<WeldPageResult, 'acceptedWdiTotal' | 'availableRequestCount'> = {},
): WeldPageResult {
  const numericPageSize = typeof pageSize === 'number' ? pageSize : rowCount
  return {
    rows: createRows((page - 1) * numericPageSize + 1, rowCount),
    total,
    ...summary,
    page,
    pageSize: pageSize ?? 100,
    hasMore: page * numericPageSize < total,
  }
}

function createRows(firstId: number, count: number): WeldRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: firstId + index,
    joint: `S${firstId + index}`,
  })) as WeldRow[]
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}
