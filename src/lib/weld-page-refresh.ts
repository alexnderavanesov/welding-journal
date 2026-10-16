import { hashKey, type InfiniteData, type QueryClient, type QueryKey } from '@tanstack/react-query'
import {
  WELD_PAGE_ALL_SIZE,
  WELD_PAGE_SIZE_OPTIONS,
  listHeatTreatmentReportPage,
  listLnkReportPage,
  listWeldingJournalPage,
  type WeldPageResult,
  type WeldPageSize,
  type WeldReportKind,
  type WeldSort,
} from '@/server/weld-read-api'
import type { WeldPageRequest } from '@/server/weld-contracts'
import { splitReportQuickSearch } from '@/lib/report-quick-search'

export const WELD_JOINT_PAGES_QUERY_KEY = ['weld-joint-pages'] as const
export const WELD_REPORT_SUMMARY_QUERY_KEY = ['weld-report-summary'] as const

/** Counts never join the save/row refresh promise, and inactive filters stay lazy. */
export function invalidateWeldReportSummaries(queryClient: QueryClient, queryKey: QueryKey = WELD_REPORT_SUMMARY_QUERY_KEY) {
  void queryClient.cancelQueries({ queryKey })
  void queryClient.invalidateQueries({ queryKey, refetchType: 'none' })
}

type WeldPageFetcher = (report: WeldReportKind, request: WeldPageRequest) => Promise<WeldPageResult>

type RefreshOptions = {
  fetchPage?: WeldPageFetcher
  force?: boolean
  retryWhenCacheChanges?: boolean
}

type InvalidateWeldPageOptions = {
  deferActiveRefresh?: boolean
}

type RefreshState = {
  token: object
  sourceData: InfiniteData<WeldPageResult> | undefined
  promise?: Promise<boolean>
  failure?: { error: Error; updatedAt: number }
}

const refreshStates = new WeakMap<QueryClient, Map<string, RefreshState>>()
const refreshRequiredKeys = new WeakMap<QueryClient, Set<string>>()
const scheduledActiveRefreshes = new WeakMap<QueryClient, ReturnType<typeof setTimeout>>()
const invalidationVersions = new WeakMap<QueryClient, Map<string, number>>()
const refreshNotifications = new WeakMap<QueryClient, { revision: number; listeners: Set<() => void> }>()
const observedQueryClients = new WeakSet<QueryClient>()

function observeQueryRemoval(queryClient: QueryClient) {
  if (observedQueryClients.has(queryClient)) return
  observedQueryClients.add(queryClient)
  // One listener shares the cache's lifetime. No module-level strong reference
  // retains the client, and removed filters no longer retain their row snapshots.
  queryClient.getQueryCache().subscribe(event => {
    if (event.type !== 'removed' || event.query.queryKey[0] !== WELD_JOINT_PAGES_QUERY_KEY[0]) return
    const key = getQueryStateKey(event.query.queryKey)
    refreshStates.get(queryClient)?.delete(key)
    refreshRequiredKeys.get(queryClient)?.delete(key)
    invalidationVersions.get(queryClient)?.delete(key)
  })
}

function getRefreshNotifications(queryClient: QueryClient) {
  let state = refreshNotifications.get(queryClient)
  if (!state) {
    state = { revision: 0, listeners: new Set() }
    refreshNotifications.set(queryClient, state)
  }
  return state
}

export function subscribeWeldPageRefresh(queryClient: QueryClient, listener: () => void) {
  const state = getRefreshNotifications(queryClient)
  state.listeners.add(listener)
  return () => { state.listeners.delete(listener) }
}

export function getWeldPageRefreshRevision(queryClient: QueryClient) {
  return getRefreshNotifications(queryClient).revision
}

function notifyWeldPageRefresh(queryClient: QueryClient) {
  const state = getRefreshNotifications(queryClient)
  state.revision++
  state.listeners.forEach((listener) => listener())
}

function getInvalidationVersions(queryClient: QueryClient) {
  observeQueryRemoval(queryClient)
  let versions = invalidationVersions.get(queryClient)
  if (!versions) {
    versions = new Map()
    invalidationVersions.set(queryClient, versions)
  }
  return versions
}

export async function refreshLoadedWeldPageQuery(
  queryClient: QueryClient,
  queryKey: QueryKey,
  options: RefreshOptions = {},
): Promise<boolean> {
  const parsedKey = parseWeldPageQueryKey(queryKey)
  if (!parsedKey) return false

  const query = queryClient.getQueryCache().find({ queryKey, exact: true })
  const sourceData = query?.state.data as InfiniteData<WeldPageResult> | undefined
  if (!sourceData?.pages.length) return false

  const stateMap = getRefreshStateMap(queryClient)
  const stateKey = getQueryStateKey(queryKey)
  const previousState = stateMap.get(stateKey)
  if (!options.force && previousState?.promise && previousState.sourceData === sourceData) {
    return previousState.promise
  }

  // Keep React Query's infinite cache fresh: invalidating it would automatically
  // refetch every loaded page when its observer is enabled again.
  getRefreshRequiredKeys(queryClient).add(stateKey)
  invalidateWeldReportSummaries(queryClient, [...WELD_REPORT_SUMMARY_QUERY_KEY, queryKey[1], queryKey[2]])
  // A removed/recreated key can reuse both its numeric version and data object.
  // Give every attempt a unique identity, including across query instances.
  const token = {}
  const invalidationVersion = getInvalidationVersions(queryClient).get(stateKey) ?? 0
  const isCurrent = () => stateMap.get(stateKey)?.token === token &&
    queryClient.getQueryCache().find({ queryKey, exact: true }) === query &&
    (getInvalidationVersions(queryClient).get(stateKey) ?? 0) === invalidationVersion
  const promise = runLoadedPageRefresh({
    queryClient,
    queryKey,
    parsedKey,
    sourceData,
    fetchPage: options.fetchPage ?? fetchReportPage,
    isCurrent,
    stateKey,
    retryWhenCacheChanges: options.retryWhenCacheChanges ?? true,
  })
  stateMap.set(stateKey, { token, sourceData, promise })
  notifyWeldPageRefresh(queryClient)

  try {
    return await promise
  } catch (cause) {
    const currentState = stateMap.get(stateKey)
    // Background invalidations have no hook-owned catch. Publish the failure
    // only for this still-current refresh, without making the query stale or retrying.
    if (currentState && isCurrent()) {
      stateMap.set(stateKey, { ...currentState, failure: {
        error: cause instanceof Error ? cause : new Error(String(cause)),
        updatedAt: Date.now(),
      } })
      notifyWeldPageRefresh(queryClient)
    }
    throw cause
  } finally {
    const currentState = stateMap.get(stateKey)
    if (currentState?.token === token) {
      stateMap.set(stateKey, { ...currentState, sourceData: undefined, promise: undefined })
    }
  }
}

export async function refreshActiveLoadedWeldPages(queryClient: QueryClient): Promise<void> {
  // A dispatcher refresh can reconcile the mutation before its deferred timer
  // fires. Replace that older request, but never cancel a later invalidation
  // scheduled while this refresh is in flight.
  const scheduled = scheduledActiveRefreshes.get(queryClient)
  if (scheduled !== undefined) {
    clearTimeout(scheduled)
    scheduledActiveRefreshes.delete(queryClient)
  }
  const activeQueries = queryClient.getQueryCache().findAll({
    queryKey: WELD_JOINT_PAGES_QUERY_KEY,
    type: 'active',
  })
  await Promise.allSettled(
    activeQueries.map(async (query) => {
      if (query.state.data) return refreshLoadedWeldPageQuery(queryClient, query.queryKey, { force: true })
      // An invalidation during the initial fetch must not publish its older response.
      const stateKey = getQueryStateKey(query.queryKey)
      const version = getInvalidationVersions(queryClient).get(stateKey)
      await queryClient.cancelQueries({ queryKey: query.queryKey, exact: true })
      if (queryClient.getQueryCache().find({ queryKey: query.queryKey, exact: true }) !== query) return
      await queryClient.refetchQueries({ queryKey: query.queryKey, exact: true, type: 'active' })
      if (queryClient.getQueryCache().find({ queryKey: query.queryKey, exact: true }) !== query) return
      if (query.state.status === 'success' && !query.state.isInvalidated &&
          getInvalidationVersions(queryClient).get(stateKey) === version) {
        getRefreshRequiredKeys(queryClient).delete(stateKey)
      }
      notifyWeldPageRefresh(queryClient)
    }),
  )
}

export async function invalidateWeldPageQueries(
  queryClient: QueryClient,
  options: InvalidateWeldPageOptions = {},
): Promise<void> {
  const queries = queryClient.getQueryCache().findAll({
    queryKey: WELD_JOINT_PAGES_QUERY_KEY,
  })
  const requiredKeys = getRefreshRequiredKeys(queryClient)
  const versions = getInvalidationVersions(queryClient)
  queries.forEach((query) => {
    const key = getQueryStateKey(query.queryKey)
    requiredKeys.add(key)
    versions.set(key, (versions.get(key) ?? 0) + 1)
  })
  invalidateWeldReportSummaries(queryClient)
  notifyWeldPageRefresh(queryClient)
  if (options.deferActiveRefresh) {
    if (queries.some((query) => query.isActive())) scheduleActiveWeldPageRefresh(queryClient)
    return
  }
  await refreshActiveLoadedWeldPages(queryClient)
}

export function isWeldPageRefreshRequired(queryClient: QueryClient, queryKey: QueryKey) {
  return getRefreshRequiredKeys(queryClient).has(getQueryStateKey(queryKey))
}

export function getWeldPageRefreshFailure(queryClient: QueryClient, queryKey: QueryKey) {
  return getRefreshStateMap(queryClient).get(getQueryStateKey(queryKey))?.failure ?? null
}

export function rebuildLoadedWeldPages(
  sourceData: InfiniteData<WeldPageResult>,
  refreshedResult: WeldPageResult,
  originalPageSize: WeldPageSize,
  loadedRowLimit: number,
): InfiniteData<WeldPageResult> {
  if (originalPageSize === WELD_PAGE_ALL_SIZE) {
    return {
      pages: [{ ...refreshedResult, page: 1, pageSize: WELD_PAGE_ALL_SIZE, hasMore: false }],
      pageParams: [sourceData.pageParams[0] ?? 1],
    }
  }

  const rows = refreshedResult.rows.slice(0, loadedRowLimit)
  const refreshedTotal = refreshedResult.total
  const hasUnloadedRows = refreshedResult.rows.length > rows.length || refreshedResult.hasMore
  const pageCount = Math.max(1, Math.ceil(rows.length / originalPageSize))
  const pages = Array.from({ length: pageCount }, (_, index): WeldPageResult => {
    const page = index + 1
    return {
      rows: rows.slice(index * originalPageSize, page * originalPageSize),
      ...(refreshedTotal === undefined ? {} : { total: refreshedTotal }),
      ...(index === 0 && refreshedResult.acceptedWdiTotal !== undefined
        ? { acceptedWdiTotal: refreshedResult.acceptedWdiTotal }
        : {}),
      ...(index === 0 && refreshedResult.availableRequestCount !== undefined
        ? { availableRequestCount: refreshedResult.availableRequestCount }
        : {}),
      page,
      pageSize: originalPageSize,
      hasMore: page < pageCount || hasUnloadedRows,
    }
  })

  return {
    pages,
    pageParams: pages.map((_, index) => sourceData.pageParams[index] ?? index + 1),
  }
}

async function runLoadedPageRefresh({
  queryClient,
  queryKey,
  parsedKey,
  sourceData,
  fetchPage,
  isCurrent,
  stateKey,
  retryWhenCacheChanges,
}: {
  queryClient: QueryClient
  queryKey: QueryKey
  parsedKey: ParsedWeldPageQueryKey
  sourceData: InfiniteData<WeldPageResult>
  fetchPage: WeldPageFetcher
  isCurrent: () => boolean
  stateKey: string
  retryWhenCacheChanges: boolean
}) {
  const loadedRowLimit = parsedKey.pageSize === WELD_PAGE_ALL_SIZE
    ? Number.POSITIVE_INFINITY
    : sourceData.pages.length * parsedKey.pageSize
  const refreshPageSize = getRefreshPageSize(loadedRowLimit)
  const firstResult = await fetchPage(parsedKey.report, {
    page: 1,
    pageSize: refreshPageSize,
    includeTotals: false,
    columnFilters: parsedKey.columnFilters,
    ...(parsedKey.search ? { search: parsedKey.search } : {}),
    ...(parsedKey.sort ? { sort: parsedKey.sort } : {}),
  })
  if (!isCurrent()) return false

  const rows = [...firstResult.rows]
  let hasMore = firstResult.hasMore
  if (refreshPageSize !== WELD_PAGE_ALL_SIZE) {
    const requiredRows = firstResult.total === undefined
      ? firstResult.hasMore ? loadedRowLimit : rows.length
      : Math.min(firstResult.total, loadedRowLimit)
    for (let page = 2; rows.length < requiredRows; page += 1) {
      const result = await fetchPage(parsedKey.report, {
        page,
        pageSize: refreshPageSize,
        includeTotals: false,
        columnFilters: parsedKey.columnFilters,
        ...(parsedKey.search ? { search: parsedKey.search } : {}),
        ...(parsedKey.sort ? { sort: parsedKey.sort } : {}),
      })
      if (!isCurrent()) return false
      rows.push(...result.rows)
      hasMore = result.hasMore && result.rows.length > 0
      if (!result.hasMore || result.rows.length === 0) break
    }
  }

  const currentData = queryClient.getQueryData<InfiniteData<WeldPageResult>>(queryKey)
  if (currentData !== sourceData) {
    if (!retryWhenCacheChanges) return false
    return refreshLoadedWeldPageQuery(queryClient, queryKey, {
      fetchPage,
      force: true,
      retryWhenCacheChanges: false,
    })
  }

  getRefreshRequiredKeys(queryClient).delete(stateKey)
  queryClient.setQueryData<InfiniteData<WeldPageResult>>(
    queryKey,
    rebuildLoadedWeldPages(
      sourceData,
      { ...firstResult, rows, hasMore },
      parsedKey.pageSize,
      loadedRowLimit,
    ),
  )
  notifyWeldPageRefresh(queryClient)
  // A fast row response may be batched with invalidation before the observer
  // ever becomes disabled. In that case enabled:false -> true cannot start counts.
  // Disabled observers start on row readiness themselves; active ones coalesce here.
  void queryClient.refetchQueries({
    queryKey: [...WELD_REPORT_SUMMARY_QUERY_KEY, queryKey[1], queryKey[2]],
    type: 'active',
  }, { cancelRefetch: false })
  return true
}

function getRefreshPageSize(loadedRowLimit: number): WeldPageSize {
  if (!Number.isFinite(loadedRowLimit)) return WELD_PAGE_ALL_SIZE
  const cappedLimit = Math.min(Math.max(1, loadedRowLimit), 1000)
  return WELD_PAGE_SIZE_OPTIONS.find((size) => size >= cappedLimit) ?? 1000
}

type ParsedWeldPageQueryKey = {
  report: WeldReportKind
  columnFilters: Record<string, string>
  search: string
  pageSize: WeldPageSize
  sort?: WeldSort
}

function parseWeldPageQueryKey(queryKey: QueryKey): ParsedWeldPageQueryKey | null {
  if (queryKey[0] !== WELD_JOINT_PAGES_QUERY_KEY[0]) return null
  const report = queryKey[1]
  const columnFilters = queryKey[2]
  const pageSize = queryKey[3]
  const sort = queryKey[4]
  if (report !== 'weldingJournal' && report !== 'lnk' && report !== 'heatTreatment') return null
  if (!columnFilters || typeof columnFilters !== 'object' || Array.isArray(columnFilters)) return null
  if (pageSize !== WELD_PAGE_ALL_SIZE && !WELD_PAGE_SIZE_OPTIONS.includes(pageSize as never)) return null
  if (sort !== null && sort !== undefined && !isWeldSort(sort)) return null
  return {
    report,
    ...splitReportQuickSearch(columnFilters as Record<string, string>),
    pageSize: pageSize as WeldPageSize,
    ...(sort ? { sort } : {}),
  }
}

function isWeldSort(value: unknown): value is WeldSort {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<WeldSort>
  return typeof candidate.fieldKey === 'string' && (candidate.direction === 'asc' || candidate.direction === 'desc')
}

function getRefreshStateMap(queryClient: QueryClient) {
  observeQueryRemoval(queryClient)
  let stateMap = refreshStates.get(queryClient)
  if (!stateMap) {
    stateMap = new Map()
    refreshStates.set(queryClient, stateMap)
  }
  return stateMap
}

function getRefreshRequiredKeys(queryClient: QueryClient) {
  observeQueryRemoval(queryClient)
  let requiredKeys = refreshRequiredKeys.get(queryClient)
  if (!requiredKeys) {
    requiredKeys = new Set()
    refreshRequiredKeys.set(queryClient, requiredKeys)
  }
  return requiredKeys
}

function getQueryStateKey(queryKey: QueryKey) {
  return hashKey(queryKey)
}

function scheduleActiveWeldPageRefresh(queryClient: QueryClient) {
  const scheduled = scheduledActiveRefreshes.get(queryClient)
  if (scheduled) clearTimeout(scheduled)
  const timeout = setTimeout(() => {
    scheduledActiveRefreshes.delete(queryClient)
    void refreshActiveLoadedWeldPages(queryClient)
  }, 500)
  scheduledActiveRefreshes.set(queryClient, timeout)
}

function fetchReportPage(report: WeldReportKind, data: WeldPageRequest) {
  if (report === 'lnk') return listLnkReportPage({ data })
  if (report === 'heatTreatment') return listHeatTreatmentReportPage({ data })
  return listWeldingJournalPage({ data })
}
