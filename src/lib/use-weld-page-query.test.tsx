import { type InfiniteData, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { WeldPageResult } from '@/server/welds'
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

vi.mock('@/server/welds', () => ({
  WELD_PAGE_ALL_SIZE: 'all',
  WELD_PAGE_SIZE_OPTIONS: [100, 300, 500, 1000],
  ...serverMocks,
}))

describe('useWeldPageQuery refresh policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
