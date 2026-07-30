import { useInfiniteQuery } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import { ALL_PAGE_SIZE } from '@/lib/use-pagination'
import { WELD_JOINT_PAGES_QUERY_KEY } from '@/lib/weld-query-utils'
import {
  WELD_PAGE_ALL_SIZE,
  WELD_PAGE_SIZE_OPTIONS,
  listHeatTreatmentReportPage,
  listLnkReportPage,
  listWeldingJournalPage,
  type WeldReportKind,
  type WeldPageRequest,
  type WeldPageSize,
} from '@/server/welds'

type UseWeldPageQueryOptions = {
  enabled: boolean
  report?: WeldReportKind
  columnFilters: Record<string, string>
}

function normalizeColumnFiltersForQuery(columnFilters: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(columnFilters)
      .map(([key, value]) => [key, String(value ?? '').trim()] as const)
      .filter(([, value]) => value.length > 0)
      .sort(([left], [right]) => left.localeCompare(right)),
  )
}

function toServerPageSize(pageSize: number): WeldPageSize {
  if (pageSize === ALL_PAGE_SIZE) return WELD_PAGE_ALL_SIZE
  return WELD_PAGE_SIZE_OPTIONS.includes(pageSize as (typeof WELD_PAGE_SIZE_OPTIONS)[number])
    ? (pageSize as (typeof WELD_PAGE_SIZE_OPTIONS)[number])
    : 100
}

function fetchReportPage(report: WeldReportKind, data: WeldPageRequest) {
  if (report === 'lnk') return listLnkReportPage({ data })
  if (report === 'heatTreatment') return listHeatTreatmentReportPage({ data })
  return listWeldingJournalPage({ data })
}

export function useWeldPageQuery({ enabled, report = 'weldingJournal', columnFilters }: UseWeldPageQueryOptions) {
  const [pageSize, setPageSize] = useState<number>(100)
  const normalizedColumnFilters = useMemo(() => normalizeColumnFiltersForQuery(columnFilters), [columnFilters])
  const serverPageSize = toServerPageSize(pageSize)

  const query = useInfiniteQuery({
    queryKey: [...WELD_JOINT_PAGES_QUERY_KEY, report, normalizedColumnFilters, serverPageSize],
    enabled,
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      fetchReportPage(report, {
        page: Number(pageParam) || 1,
        pageSize: serverPageSize,
        columnFilters: normalizedColumnFilters,
      }),
    getNextPageParam: (lastPage) => {
      if (!lastPage.hasMore || lastPage.pageSize === WELD_PAGE_ALL_SIZE) return undefined
      return lastPage.page + 1
    },
  })

  const rows = useMemo(() => query.data?.pages.flatMap((page) => page.rows) ?? [], [query.data])
  const totalCount = query.data?.pages[0]?.total ?? 0
  const acceptedWdiTotal = query.data?.pages[0]?.acceptedWdiTotal ?? 0
  const hasMore = Boolean(query.hasNextPage)
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = query
  const loadMore = useCallback(() => {
    if (!hasNextPage || isFetchingNextPage) return
    void fetchNextPage()
  }, [fetchNextPage, hasNextPage, isFetchingNextPage])

  return {
    rows,
    totalCount,
    acceptedWdiTotal,
    firstItemNumber: totalCount === 0 ? 0 : 1,
    lastItemNumber: rows.length,
    pageSize,
    hasMore,
    isFetching: query.isFetching,
    isLoading: query.isLoading,
    error: query.error,
    loadMore,
    setPageSize,
    refetch: query.refetch,
  }
}
