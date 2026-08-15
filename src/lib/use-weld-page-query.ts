import { type InfiniteData, useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ALL_PAGE_SIZE } from '@/lib/use-pagination'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import {
  shouldRefetchQueryOnWindowFocus,
  shouldRefreshWeldPageOnActivation,
} from '@/lib/query-refresh-policy'
import {
  isWeldPageRefreshRequired,
  refreshLoadedWeldPageQuery,
  WELD_JOINT_PAGES_QUERY_KEY,
} from '@/lib/weld-page-refresh'
import {
  WELD_PAGE_ALL_SIZE,
  WELD_PAGE_SIZE_OPTIONS,
  listHeatTreatmentReportPage,
  listLnkReportPage,
  listWeldingJournalPage,
  type WeldPageResult,
  type WeldReportKind,
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

export function useWeldPageQuery({ enabled, report = 'weldingJournal', columnFilters }: UseWeldPageQueryOptions) {
  const queryClient = useQueryClient()
  const [pageSize, setPageSize] = useState<number>(100)
  const [refreshError, setRefreshError] = useState<Error | null>(null)
  const refreshErrorAtRef = useRef(0)
  const normalizedColumnFilters = useMemo(() => normalizeColumnFiltersForQuery(columnFilters), [columnFilters])
  const queryColumnFilters = useDebouncedValue(normalizedColumnFilters, 180)
  const serverPageSize = toServerPageSize(pageSize)
  const queryKey = useMemo(
    () => [...WELD_JOINT_PAGES_QUERY_KEY, report, queryColumnFilters, serverPageSize] as const,
    [queryColumnFilters, report, serverPageSize],
  )
  const queryIdentity = useMemo(() => JSON.stringify(queryKey), [queryKey])

  useEffect(() => {
    setRefreshError(null)
    refreshErrorAtRef.current = 0
  }, [queryIdentity])

  const query = useInfiniteQuery({
    queryKey,
    enabled,
    initialPageParam: 1,
    queryFn: ({ pageParam }) => {
      const data = {
        page: Number(pageParam) || 1,
        pageSize: serverPageSize,
        columnFilters: queryColumnFilters,
      }
      if (report === 'lnk') return listLnkReportPage({ data })
      if (report === 'heatTreatment') return listHeatTreatmentReportPage({ data })
      return listWeldingJournalPage({ data })
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 15 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    getNextPageParam: (lastPage) => {
      if (!lastPage.hasMore || lastPage.pageSize === WELD_PAGE_ALL_SIZE) return undefined
      return lastPage.page + 1
    },
  })

  const rows = useMemo(() => query.data?.pages.flatMap((page) => page.rows) ?? [], [query.data])
  const totalCount = query.data?.pages[0]?.total ?? 0
  const acceptedWdiTotal = query.data?.pages[0]?.acceptedWdiTotal ?? 0
  const availableRequestCount = query.data?.pages[0]?.availableRequestCount
  const hasMore = Boolean(query.hasNextPage)
  const { fetchNextPage, hasNextPage, isFetchingNextPage, refetch: refetchFirstPage } = query
  const refresh = useCallback(async (force = false) => {
    try {
      const cachedData = queryClient.getQueryData<InfiniteData<WeldPageResult>>(queryKey)
      const refreshed = cachedData?.pages.length
        ? await refreshLoadedWeldPageQuery(queryClient, queryKey, { force })
        : await refetchFirstPage().then((result) => {
            if (result.error) throw result.error
            return true
          })
      setRefreshError(null)
      refreshErrorAtRef.current = 0
      return refreshed
    } catch (error) {
      setRefreshError(error instanceof Error ? error : new Error(String(error)))
      refreshErrorAtRef.current = Date.now()
      return false
    }
  }, [queryClient, queryKey, refetchFirstPage])
  const activeQueryIdentityRef = useRef<string | null>(null)
  const pendingActivationRefreshRef = useRef<string | null>(null)

  useEffect(() => {
    const becameActive = enabled && activeQueryIdentityRef.current !== queryIdentity
    if (!enabled) {
      activeQueryIdentityRef.current = null
      pendingActivationRefreshRef.current = null
      return
    }
    activeQueryIdentityRef.current = queryIdentity
    if (becameActive) pendingActivationRefreshRef.current = queryIdentity
    if (pendingActivationRefreshRef.current !== queryIdentity || !query.data || query.isFetching) return
    pendingActivationRefreshRef.current = null
    const state = queryClient.getQueryState(queryKey)
    if (!state) return
    const refreshRequired = isWeldPageRefreshRequired(queryClient, queryKey)
    if (shouldRefreshWeldPageOnActivation(state.dataUpdatedAt, refreshRequired)) {
      void refresh(refreshRequired)
    }
  }, [enabled, query.data, query.isFetching, queryClient, queryIdentity, queryKey, refresh])

  useEffect(() => {
    if (!enabled) return
    const refreshOldData = () => {
      const state = queryClient.getQueryState(queryKey)
      if (!state) return
      if (shouldRefetchQueryOnWindowFocus(
        state.dataUpdatedAt,
        Math.max(state.errorUpdatedAt, refreshErrorAtRef.current),
      )) {
        void refresh(false)
      }
    }
    const refreshVisibleData = () => {
      if (document.visibilityState === 'visible') refreshOldData()
    }
    window.addEventListener('focus', refreshOldData)
    window.addEventListener('online', refreshOldData)
    document.addEventListener('visibilitychange', refreshVisibleData)
    return () => {
      window.removeEventListener('focus', refreshOldData)
      window.removeEventListener('online', refreshOldData)
      document.removeEventListener('visibilitychange', refreshVisibleData)
    }
  }, [enabled, queryClient, queryKey, refresh])

  const loadMore = useCallback(() => {
    if (!hasNextPage || isFetchingNextPage) return
    void fetchNextPage()
  }, [fetchNextPage, hasNextPage, isFetchingNextPage])

  return {
    rows,
    totalCount,
    acceptedWdiTotal,
    availableRequestCount,
    firstItemNumber: totalCount === 0 ? 0 : 1,
    lastItemNumber: rows.length,
    pageSize,
    hasMore,
    isFetching: query.isFetching,
    isLoading: query.isLoading,
    error: refreshError ?? query.error,
    loadMore,
    setPageSize,
    refetch: refresh,
  }
}
