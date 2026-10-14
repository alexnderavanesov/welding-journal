import { type InfiniteData, QueryClient, QueryObserver } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { WeldPageRequest, WeldPageResult, WeldReportKind } from '@/server/weld-contracts'
import * as weldReadApi from '@/server/weld-read-api'
import {
  invalidateWeldPageQueries,
  isWeldPageRefreshRequired,
  getWeldPageRefreshFailure,
  refreshLoadedWeldPageQuery,
  WELD_JOINT_PAGES_QUERY_KEY,
  WELD_REPORT_SUMMARY_QUERY_KEY,
} from '@/lib/weld-page-refresh'

describe('consolidated weld page refresh', () => {
  it.each(['weldingJournal', 'lnk', 'heatTreatment'] as const)('preserves quick search on every refreshed page of %s', async report => {
    const queryClient = createQueryClient()
    const queryKey = createQueryKey(report, { search: ' F001 ', line: 'L1' })
    queryClient.setQueryData(queryKey, createInfiniteData(12, 1200))
    const fetchPage = vi.fn(async (_report: WeldReportKind, data: WeldPageRequest) =>
      createResult(data.page!, data.page === 1 ? 1000 : 200, 1200, data.pageSize))
    try {
      await refreshLoadedWeldPageQuery(queryClient, queryKey, { fetchPage })
      expect(fetchPage.mock.calls).toEqual([1, 2].map(page => [report, {
        page, pageSize: 1000, includeTotals: false, search: 'F001', columnFilters: { line: 'L1' },
      }]))
    } finally { queryClient.clear() }
  })

  it('retains cached data and the reconciliation flag after failure, allowing an explicit retry without polling', async () => {
    vi.useFakeTimers()
    const queryClient = createQueryClient()
    const queryKey = createQueryKey()
    const cached = createInfiniteData(1, 100)
    queryClient.setQueryData(queryKey, cached)
    const observer = new QueryObserver(queryClient, { queryKey, staleTime: Infinity })
    const unsubscribe = observer.subscribe(() => undefined)
    const fetchPage = vi.spyOn(weldReadApi, 'listWeldingJournalPage')
      .mockRejectedValueOnce(new Error('Network unavailable'))
      .mockResolvedValue(createResult(1, 99, 99, 100))
    try {
      await invalidateWeldPageQueries(queryClient, { deferActiveRefresh: true })
      await invalidateWeldPageQueries(queryClient)
      await vi.advanceTimersByTimeAsync(1000)
      expect(fetchPage).toHaveBeenCalledTimes(1)
      expect(queryClient.getQueryData(queryKey)).toEqual(cached)
      expect(isWeldPageRefreshRequired(queryClient, queryKey)).toBe(true)
      await invalidateWeldPageQueries(queryClient)
      expect(fetchPage).toHaveBeenCalledTimes(2)
      expect(queryClient.getQueryData<InfiniteData<WeldPageResult>>(queryKey)?.pages[0].total).toBe(99)
      expect(isWeldPageRefreshRequired(queryClient, queryKey)).toBe(false)
    } finally {
      unsubscribe()
      queryClient.clear()
      fetchPage.mockRestore()
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  it('replaces a scheduled refresh with an immediate dispatcher refresh without a later duplicate', async () => {
    vi.useFakeTimers()
    const queryClient = createQueryClient()
    const queryKey = createQueryKey()
    queryClient.setQueryData(queryKey, createInfiniteData(1, 100))
    const observer = new QueryObserver(queryClient, { queryKey, staleTime: Infinity })
    const unsubscribe = observer.subscribe(() => undefined)
    const fetchPage = vi.spyOn(weldReadApi, 'listWeldingJournalPage').mockResolvedValue(createResult(1, 100, 100, 100))
    try {
      await invalidateWeldPageQueries(queryClient, { deferActiveRefresh: true })
      await invalidateWeldPageQueries(queryClient)
      expect(fetchPage).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1000)
      expect(fetchPage).toHaveBeenCalledTimes(1)
      expect(isWeldPageRefreshRequired(queryClient, queryKey)).toBe(false)
    } finally {
      unsubscribe()
      queryClient.clear()
      fetchPage.mockRestore()
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  it('keeps a newly scheduled mutation refresh while the immediate refresh is in flight', async () => {
    vi.useFakeTimers()
    const queryClient = createQueryClient()
    const queryKey = createQueryKey()
    queryClient.setQueryData(queryKey, createInfiniteData(1, 100))
    const observer = new QueryObserver(queryClient, { queryKey, staleTime: Infinity })
    const unsubscribe = observer.subscribe(() => undefined)
    const first = createDeferred<WeldPageResult>()
    const fetchPage = vi.spyOn(weldReadApi, 'listWeldingJournalPage')
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(createResult(1, 99, 99, 100))
    try {
      await invalidateWeldPageQueries(queryClient, { deferActiveRefresh: true })
      const immediate = invalidateWeldPageQueries(queryClient)
      await invalidateWeldPageQueries(queryClient, { deferActiveRefresh: true })
      first.resolve(createResult(1, 100, 100, 100))
      await immediate
      await vi.advanceTimersByTimeAsync(1000)
      expect(fetchPage).toHaveBeenCalledTimes(2)
      expect(queryClient.getQueryData<InfiniteData<WeldPageResult>>(queryKey)?.pages[0].total).toBe(99)
    } finally {
      unsubscribe()
      queryClient.clear()
      fetchPage.mockRestore()
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

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
      includeTotals: false,
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

  it('does not carry an old total into a rows-only refresh', async () => {
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
    expect(refreshed?.pages.map((page) => page.total)).toEqual([undefined, undefined, undefined])
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

  it('marks inactive rows for consolidated refresh and invalidates counts without refetching', async () => {
    const queryClient = createQueryClient()
    const queryKey = createQueryKey()
    queryClient.setQueryData(queryKey, createInfiniteData(3, 500))
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    await invalidateWeldPageQueries(queryClient)

    expect(invalidateSpy).toHaveBeenCalledExactlyOnceWith({ queryKey: WELD_REPORT_SUMMARY_QUERY_KEY, refetchType: 'none' })
    expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(false)
    expect(isWeldPageRefreshRequired(queryClient, queryKey)).toBe(true)
    await refreshLoadedWeldPageQuery(queryClient, queryKey, {
      fetchPage: async (_report, request) => createResult(1, 300, 500, request.pageSize),
      force: true,
    })
    expect(isWeldPageRefreshRequired(queryClient, queryKey)).toBe(false)
  })

  it('defers an active refresh while keeping the report marked for reconciliation', async () => {
    vi.useFakeTimers()
    const queryClient = createQueryClient()
    const queryKey = createQueryKey()
    queryClient.setQueryData(queryKey, createInfiniteData(1, 2))
    const observer = new QueryObserver(queryClient, {
      queryKey,
      queryFn: async () => createInfiniteData(1, 2),
      staleTime: Number.POSITIVE_INFINITY,
    })
    const unsubscribe = observer.subscribe(() => undefined)

    await invalidateWeldPageQueries(queryClient, { deferActiveRefresh: true })

    expect(isWeldPageRefreshRequired(queryClient, queryKey)).toBe(true)
    expect(observer.getCurrentResult().isFetching).toBe(false)

    unsubscribe()
    vi.clearAllTimers()
    vi.useRealTimers()
  })
  it('retains the final 100 rows as loadable after refreshing a 700-row window from an 800-row result', async () => {
    const client = createQueryClient(), key = createQueryKey()
    client.setQueryData(key, createInfiniteData(7, 700))
    const fetchPage = vi.fn(async (_report: WeldReportKind, request: WeldPageRequest) => {
      const result = createResult(1, 800, 800, request.pageSize)
      delete result.total
      return result
    })
    await refreshLoadedWeldPageQuery(client, key, { fetchPage })
    const result = client.getQueryData<InfiniteData<WeldPageResult>>(key)!
    expect(fetchPage).toHaveBeenCalledExactlyOnceWith('weldingJournal', {
      page: 1, pageSize: 1000, includeTotals: false, columnFilters: {},
    })
    expect(result.pages.flatMap((page) => page.rows)).toHaveLength(700)
    expect(result.pages.at(-1)).toMatchObject({ page: 7, hasMore: true })
    expect(result.pages[0].total).toBeUndefined()
  })

  it('uses the last batch hasMore when a multi-batch refresh reaches the end without totals', async () => {
    const client = createQueryClient(), key = createQueryKey()
    client.setQueryData(key, createInfiniteData(15, 1500))
    const fetchPage = vi.fn(async (_report: WeldReportKind, request: WeldPageRequest) => {
      const result = createResult(request.page!, request.page === 1 ? 1000 : 200, 1200, request.pageSize)
      delete result.total
      return result
    })
    await refreshLoadedWeldPageQuery(client, key, { fetchPage })
    const result = client.getQueryData<InfiniteData<WeldPageResult>>(key)!
    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(result.pages).toHaveLength(12)
    expect(result.pages.at(-1)?.hasMore).toBe(false)
    expect(result.pages[0].total).toBeUndefined()
  })

  it('does not publish a refresh invalidated again while its response is pending', async () => {
    const client = createQueryClient(), key = createQueryKey()
    client.setQueryData(key, createInfiniteData(1, 100))
    const pending = createDeferred<WeldPageResult>()
    const refreshing = refreshLoadedWeldPageQuery(client, key, { fetchPage: () => pending.promise })
    await invalidateWeldPageQueries(client)
    pending.resolve(createResult(1, 1, 1, 100))
    expect(await refreshing).toBe(false)
    expect(client.getQueryData<InfiniteData<WeldPageResult>>(key)?.pages[0].rows).toHaveLength(100)
    expect(isWeldPageRefreshRequired(client, key)).toBe(true)
  })

  it.each(['success', 'failure'] as const)('does not let an older failure replace a newer refresh %s', async (outcome) => {
    const client = createQueryClient(), key = createQueryKey()
    client.setQueryData(key, createInfiniteData(1, 100))
    const pending = createDeferred<WeldPageResult>()
    const oldRefresh = refreshLoadedWeldPageQuery(client, key, { fetchPage: () => pending.promise })
    const oldRejected = expect(oldRefresh).rejects.toThrow('Old refresh')
    const newRefresh = refreshLoadedWeldPageQuery(client, key, { force: true, fetchPage: async () => {
      if (outcome === 'failure') throw new Error('Current refresh')
      return createResult(1, 99, 99, 100)
    } })
    if (outcome === 'failure') await expect(newRefresh).rejects.toThrow('Current refresh')
    else expect(await newRefresh).toBe(true)
    pending.reject(new Error('Old refresh'))
    await oldRejected
    expect(getWeldPageRefreshFailure(client, key)?.error.message).toBe(outcome === 'failure' ? 'Current refresh' : undefined)
    expect(isWeldPageRefreshRequired(client, key)).toBe(outcome === 'failure')
  })

  it('does not publish a failure from an invalidated refresh generation', async () => {
    const client = createQueryClient(), key = createQueryKey()
    client.setQueryData(key, createInfiniteData(1, 100))
    const pending = createDeferred<WeldPageResult>()
    const refresh = refreshLoadedWeldPageQuery(client, key, { fetchPage: () => pending.promise })
    const rejected = expect(refresh).rejects.toThrow('Outdated refresh')
    await invalidateWeldPageQueries(client)
    pending.reject(new Error('Outdated refresh'))
    await rejected
    expect(getWeldPageRefreshFailure(client, key)).toBeNull()
    expect(isWeldPageRefreshRequired(client, key)).toBe(true)
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
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
