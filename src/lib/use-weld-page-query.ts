import { type InfiniteData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { splitReportQuickSearch } from '@/lib/report-quick-search'
import {
  shouldRefetchQueryOnWindowFocus,
  shouldRefreshWeldPageOnActivation,
} from '@/lib/query-refresh-policy'
import {
  isWeldPageRefreshRequired,
  refreshLoadedWeldPageQuery,
  WELD_JOINT_PAGES_QUERY_KEY,
  WELD_REPORT_SUMMARY_QUERY_KEY,
  invalidateWeldReportSummaries,
  getWeldPageRefreshRevision,
  getWeldPageRefreshFailure,
  subscribeWeldPageRefresh,
} from '@/lib/weld-page-refresh'
import {
  WELD_PAGE_ALL_SIZE,
  WELD_PAGE_SIZE_OPTIONS,
  listHeatTreatmentReportPage,
  listLnkReportPage,
  listWeldingJournalPage,
  getWeldReportSummary,
  type WeldPageResult,
  type WeldReportKind,
  type WeldPageSize,
  type WeldSort,
} from '@/server/weld-read-api'

type UseWeldPageQueryOptions = {
  enabled: boolean
  report?: WeldReportKind
  columnFilters: Record<string, string>
  sort?: WeldSort | null
}

const PAGE_SIZE_STORAGE_KEY = 'welding-report-page-size:v1'
type PageSizeByReport = Partial<Record<WeldReportKind, number>>

function normalizeColumnFiltersForQuery(columnFilters: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(columnFilters)
      .map(([key, value]) => [key, String(value ?? '').trim()] as const)
      .filter(([, value]) => value.length > 0)
      .sort(([left], [right]) => left.localeCompare(right)),
  )
}

function toServerPageSize(pageSize: number): WeldPageSize {
  return WELD_PAGE_SIZE_OPTIONS.includes(pageSize as (typeof WELD_PAGE_SIZE_OPTIONS)[number])
    ? (pageSize as (typeof WELD_PAGE_SIZE_OPTIONS)[number])
    : 100
}

export function useWeldPageQuery({
  enabled,
  report = 'weldingJournal',
  columnFilters,
  sort = null,
}: UseWeldPageQueryOptions) {
  const queryClient = useQueryClient()
  useSyncExternalStore(
    useCallback((listener: () => void) => subscribeWeldPageRefresh(queryClient, listener), [queryClient]),
    useCallback(() => getWeldPageRefreshRevision(queryClient), [queryClient]),
    () => 0,
  )
  const [pageSizeByReport, setPageSizeByReport] = useState<PageSizeByReport>(readPageSizeByReport)
  const pageSize = pageSizeByReport[report] ?? 100
  const setPageSize = useCallback((nextPageSize: number) => {
    setPageSizeByReport((current) => {
      const next = { ...current, [report]: nextPageSize }
      if (typeof window !== 'undefined') window.localStorage.setItem(PAGE_SIZE_STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }, [report])
  const [refreshError, setRefreshError] = useState<{ identity: string; error: Error } | null>(null)
  const refreshErrorAtRef = useRef(0)
  const normalizedColumnFilters = useMemo(() => normalizeColumnFiltersForQuery(columnFilters), [columnFilters])
  const serverPageSize = toServerPageSize(pageSize)
  const requestedKey = useMemo(
    () => sort
      ? [...WELD_JOINT_PAGES_QUERY_KEY, report, normalizedColumnFilters, serverPageSize, sort] as const
      : [...WELD_JOINT_PAGES_QUERY_KEY, report, normalizedColumnFilters, serverPageSize] as const,
    [normalizedColumnFilters, report, serverPageSize, sort],
  )
  // Debounce the whole request, by value: never combine a new report/sort with old filters.
  const requestedIdentity = JSON.stringify(requestedKey)
  const queryIdentity = useDebouncedValue(requestedIdentity, 180)
  const queryKey = useMemo(() => JSON.parse(queryIdentity) as typeof requestedKey, [queryIdentity])
  const [, queryReport, queryColumnFilters, queryPageSize, querySort] = queryKey
  const queryFilters = useMemo(() => splitReportQuickSearch(queryColumnFilters), [queryColumnFilters])
  const conditionsCurrent = requestedIdentity === queryIdentity
  const requestEnabled = enabled && conditionsCurrent
  const latestIdentityRef = useRef(requestedIdentity)
  const latestEnabledRef = useRef(enabled)
  const refreshGenerationRef = useRef(0)
  if (latestIdentityRef.current !== requestedIdentity || latestEnabledRef.current !== enabled) {
    latestIdentityRef.current = requestedIdentity
    latestEnabledRef.current = enabled
    refreshGenerationRef.current++
  }
  const activeQueryIdentityRef = useRef<string | null>(null)
  const pendingActivationRefreshRef = useRef<string | null>(null)

  useEffect(() => {
    setRefreshError(null)
    refreshErrorAtRef.current = 0
  }, [enabled, requestedIdentity])
  useEffect(() => () => { refreshGenerationRef.current++ }, [])

  const query = useInfiniteQuery({
    queryKey,
    enabled: requestEnabled,
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => {
      const data = {
        page: Number(pageParam) || 1,
        pageSize: queryPageSize,
        includeTotals: false,
        columnFilters: queryFilters.columnFilters,
        ...(queryFilters.search ? { search: queryFilters.search } : {}),
        ...(querySort ? { sort: querySort } : {}),
      }
      if (queryReport === 'lnk') return listLnkReportPage({ data, signal })
      if (queryReport === 'heatTreatment') return listHeatTreatmentReportPage({ data, signal })
      return listWeldingJournalPage({ data, signal })
    },
    // Display-only while conditions change. rowsReady disables every row action;
    // preserving the body keeps the filter anchor, focus and scroll geometry stable.
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[1] === queryReport ? previousData : undefined,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 15 * 60_000,
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    getNextPageParam: (lastPage) => {
      if (!lastPage.hasMore || lastPage.pageSize === WELD_PAGE_ALL_SIZE) return undefined
      return lastPage.page + 1
    },
  })

  const rowsReady = requestEnabled && query.data !== undefined && !query.isPlaceholderData
  const sharedRefreshFailure = getWeldPageRefreshFailure(queryClient, queryKey)
  const rowsError = conditionsCurrent ? sharedRefreshFailure?.error ??
    (refreshError?.identity === queryIdentity ? refreshError.error : query.error) : null
  const rows = useMemo(() => enabled && queryReport === report
    ? query.data?.pages.flatMap((page) => page.rows) ?? [] : [], [enabled, query.data, queryReport, report])
  const needsReconciliation = query.isStale || isWeldPageRefreshRequired(queryClient, queryKey) ||
    (activeQueryIdentityRef.current !== queryIdentity &&
      shouldRefreshWeldPageOnActivation(query.dataUpdatedAt, false))
  const summaryKey = useMemo(
    () => [...WELD_REPORT_SUMMARY_QUERY_KEY, queryReport, queryColumnFilters] as const,
    [queryReport, queryColumnFilters],
  )
  const summaryEnabled = rowsReady && !needsReconciliation && (!query.isFetching || query.isFetchingNextPage)
  const summary = useQuery({
    queryKey: summaryKey,
    enabled: summaryEnabled,
    queryFn: ({ signal }) => getWeldReportSummary({ data: {
      report: queryReport,
      columnFilters: queryFilters.columnFilters,
      ...(queryFilters.search ? { search: queryFilters.search } : {}),
    }, signal }),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 15 * 60_000,
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const summaryData = rowsReady && !needsReconciliation && !summary.isFetching && !summary.isStale && !summary.error
    ? summary.data : undefined
  const summaryError = rowsReady && !needsReconciliation && !summary.isFetching ? summary.error : null
  const summaryStatus = rowsError || summaryError ? 'error' as const : summaryData ? 'ready' as const : 'pending' as const
  const hasMore = rowsReady && Boolean(query.hasNextPage)
  const { fetchNextPage, hasNextPage, isFetchingNextPage, refetch: refetchFirstPage } = query
  const refresh = useCallback(async (force = false) => {
    if (!requestEnabled || !latestEnabledRef.current || latestIdentityRef.current !== queryIdentity) return false
    const generation = ++refreshGenerationRef.current
    invalidateWeldReportSummaries(queryClient, summaryKey)
    let refreshingCachedRows = false
    try {
      const cachedData = queryClient.getQueryData<InfiniteData<WeldPageResult>>(queryKey)
      refreshingCachedRows = Boolean(cachedData?.pages.length)
      const refreshed = cachedData?.pages.length
        ? await refreshLoadedWeldPageQuery(queryClient, queryKey, { force })
        : await refetchFirstPage().then((result) => {
            if (result.error) throw result.error
            return true
          })
      if (generation === refreshGenerationRef.current && latestIdentityRef.current === queryIdentity) {
        setRefreshError(null)
        refreshErrorAtRef.current = 0
      }
      return refreshed
    } catch (error) {
      if (!refreshingCachedRows && generation === refreshGenerationRef.current && latestIdentityRef.current === queryIdentity) {
        setRefreshError({ identity: queryIdentity, error: error instanceof Error ? error : new Error(String(error)) })
        refreshErrorAtRef.current = Date.now()
      }
      return false
    }
  }, [requestEnabled, queryClient, queryIdentity, queryKey, refetchFirstPage, summaryKey])

  useEffect(() => {
    const becameActive = requestEnabled && activeQueryIdentityRef.current !== queryIdentity
    if (!requestEnabled) {
      activeQueryIdentityRef.current = null
      pendingActivationRefreshRef.current = null
      return
    }
    activeQueryIdentityRef.current = queryIdentity
    if (becameActive) pendingActivationRefreshRef.current = queryIdentity
    if (pendingActivationRefreshRef.current !== queryIdentity || !query.data || query.isFetching || query.isPlaceholderData) return
    pendingActivationRefreshRef.current = null
    const state = queryClient.getQueryState(queryKey)
    if (!state) return
    const refreshRequired = isWeldPageRefreshRequired(queryClient, queryKey) || state.isInvalidated
    if (shouldRefreshWeldPageOnActivation(state.dataUpdatedAt, refreshRequired)) {
      void refresh(refreshRequired)
    }
  }, [requestEnabled, query.data, query.isFetching, query.isPlaceholderData, queryClient, queryIdentity, queryKey, refresh])

  useEffect(() => {
    // Some existing callers invalidate the page key directly (program approvals).
    // Reconcile once; the shared marker also prevents retries looping after failure.
    if (rowsReady && query.isStale && !query.isFetching && !isWeldPageRefreshRequired(queryClient, queryKey)) {
      void refresh(true)
    }
  }, [rowsReady, query.isStale, query.isFetching, queryClient, queryKey, refresh])

  useEffect(() => {
    if (!requestEnabled) return
    const refreshOldData = () => {
      const state = queryClient.getQueryState(queryKey)
      if (!state) return
      if (shouldRefetchQueryOnWindowFocus(
        state.dataUpdatedAt,
        Math.max(state.errorUpdatedAt, refreshErrorAtRef.current, getWeldPageRefreshFailure(queryClient, queryKey)?.updatedAt ?? 0),
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
  }, [requestEnabled, queryClient, queryKey, refresh])

  const loadMore = useCallback(() => {
    if (!rowsReady || !latestEnabledRef.current || latestIdentityRef.current !== queryIdentity || !hasNextPage || isFetchingNextPage || query.isFetching || needsReconciliation) return
    void fetchNextPage()
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, query.isFetching, needsReconciliation, queryIdentity, rowsReady])

  const retrySummary = useCallback(() => {
    if (summaryEnabled && latestEnabledRef.current && latestIdentityRef.current === queryIdentity) void summary.refetch()
  }, [queryIdentity, summaryEnabled, summary.refetch])

  return {
    rows,
    totalCount: summaryData?.total,
    acceptedWdiTotal: summaryData?.acceptedWdiTotal,
    availableRequestCount: summaryData?.availableRequestCount,
    summaryStatus,
    summaryError,
    retrySummary,
    rowsReady,
    requestedIdentity,
    firstItemNumber: rows.length === 0 ? 0 : 1,
    lastItemNumber: rows.length,
    pageSize,
    hasMore,
    isFetching: requestEnabled && query.isFetching,
    isLoading: enabled && (!conditionsCurrent || query.isLoading || query.isPlaceholderData),
    error: rowsError,
    loadMore,
    setPageSize,
    refetch: refresh,
  }
}

function readPageSizeByReport(): PageSizeByReport {
  if (typeof window === 'undefined') return {}
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PAGE_SIZE_STORAGE_KEY) ?? '{}') as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([report, value]) => {
        if (report !== 'weldingJournal' && report !== 'lnk' && report !== 'heatTreatment') return []
        const pageSize = Number(value)
        return WELD_PAGE_SIZE_OPTIONS.includes(pageSize as (typeof WELD_PAGE_SIZE_OPTIONS)[number])
          ? [[report, pageSize]]
          : []
      }),
    )
  } catch {
    return {}
  }
}
