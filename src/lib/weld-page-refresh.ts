import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/react-query'
import {
  WELD_PAGE_ALL_SIZE,
  WELD_PAGE_SIZE_OPTIONS,
  listHeatTreatmentReportPage,
  listLnkReportPage,
  listWeldingJournalPage,
  type WeldPageRequest,
  type WeldPageResult,
  type WeldPageSize,
  type WeldReportKind,
} from '@/server/welds'

export const WELD_JOINT_PAGES_QUERY_KEY = ['weld-joint-pages'] as const

type WeldPageFetcher = (report: WeldReportKind, request: WeldPageRequest) => Promise<WeldPageResult>

type RefreshOptions = {
  fetchPage?: WeldPageFetcher
  force?: boolean
  retryWhenCacheChanges?: boolean
}

type RefreshState = {
  generation: number
  sourceData: InfiniteData<WeldPageResult> | undefined
  promise?: Promise<boolean>
}

const refreshStates = new WeakMap<QueryClient, Map<string, RefreshState>>()
const refreshRequiredKeys = new WeakMap<QueryClient, Set<string>>()

export async function refreshLoadedWeldPageQuery(
  queryClient: QueryClient,
  queryKey: QueryKey,
  options: RefreshOptions = {},
): Promise<boolean> {
  const parsedKey = parseWeldPageQueryKey(queryKey)
  if (!parsedKey) return false

  const sourceData = queryClient.getQueryData<InfiniteData<WeldPageResult>>(queryKey)
  if (!sourceData?.pages.length) return false

  const stateMap = getRefreshStateMap(queryClient)
  const stateKey = JSON.stringify(queryKey)
  const previousState = stateMap.get(stateKey)
  if (!options.force && previousState?.promise && previousState.sourceData === sourceData) {
    return previousState.promise
  }

  const generation = (previousState?.generation ?? 0) + 1
  const promise = runLoadedPageRefresh({
    queryClient,
    queryKey,
    parsedKey,
    sourceData,
    fetchPage: options.fetchPage ?? fetchReportPage,
    generation,
    stateKey,
    retryWhenCacheChanges: options.retryWhenCacheChanges ?? true,
  })
  stateMap.set(stateKey, { generation, sourceData, promise })

  try {
    return await promise
  } finally {
    const currentState = stateMap.get(stateKey)
    if (currentState?.generation === generation) {
      stateMap.set(stateKey, { generation, sourceData: queryClient.getQueryData(queryKey) })
    }
  }
}

export async function refreshActiveLoadedWeldPages(queryClient: QueryClient): Promise<void> {
  const activeQueries = queryClient.getQueryCache().findAll({
    queryKey: WELD_JOINT_PAGES_QUERY_KEY,
    type: 'active',
  })
  await Promise.allSettled(
    activeQueries.map((query) => refreshLoadedWeldPageQuery(queryClient, query.queryKey, { force: true })),
  )
}

export async function invalidateWeldPageQueries(queryClient: QueryClient): Promise<void> {
  const queries = queryClient.getQueryCache().findAll({
    queryKey: WELD_JOINT_PAGES_QUERY_KEY,
  })
  const requiredKeys = getRefreshRequiredKeys(queryClient)
  queries.forEach((query) => requiredKeys.add(getQueryStateKey(query.queryKey)))
  await refreshActiveLoadedWeldPages(queryClient)
}

export function isWeldPageRefreshRequired(queryClient: QueryClient, queryKey: QueryKey) {
  return getRefreshRequiredKeys(queryClient).has(getQueryStateKey(queryKey))
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
  const refreshedTotal = refreshedResult.total ?? sourceData.pages[0]?.total
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
      hasMore:
        refreshedTotal === undefined
          ? page < pageCount || refreshedResult.hasMore
          : page * originalPageSize < refreshedTotal,
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
  generation,
  stateKey,
  retryWhenCacheChanges,
}: {
  queryClient: QueryClient
  queryKey: QueryKey
  parsedKey: ParsedWeldPageQueryKey
  sourceData: InfiniteData<WeldPageResult>
  fetchPage: WeldPageFetcher
  generation: number
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
    columnFilters: parsedKey.columnFilters,
  })

  const rows = [...firstResult.rows]
  if (refreshPageSize !== WELD_PAGE_ALL_SIZE) {
    const requiredRows = firstResult.total === undefined
      ? firstResult.hasMore ? loadedRowLimit : rows.length
      : Math.min(firstResult.total, loadedRowLimit)
    for (let page = 2; rows.length < requiredRows; page += 1) {
      const result = await fetchPage(parsedKey.report, {
        page,
        pageSize: refreshPageSize,
        columnFilters: parsedKey.columnFilters,
      })
      rows.push(...result.rows)
      if (!result.hasMore || result.rows.length === 0) break
    }
  }

  const stateMap = getRefreshStateMap(queryClient)
  if (stateMap.get(stateKey)?.generation !== generation) return false

  const currentData = queryClient.getQueryData<InfiniteData<WeldPageResult>>(queryKey)
  if (currentData !== sourceData) {
    if (!retryWhenCacheChanges) return false
    return refreshLoadedWeldPageQuery(queryClient, queryKey, {
      fetchPage,
      force: true,
      retryWhenCacheChanges: false,
    })
  }

  queryClient.setQueryData<InfiniteData<WeldPageResult>>(
    queryKey,
    rebuildLoadedWeldPages(
      sourceData,
      { ...firstResult, rows },
      parsedKey.pageSize,
      loadedRowLimit,
    ),
  )
  getRefreshRequiredKeys(queryClient).delete(stateKey)
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
  pageSize: WeldPageSize
}

function parseWeldPageQueryKey(queryKey: QueryKey): ParsedWeldPageQueryKey | null {
  if (queryKey[0] !== WELD_JOINT_PAGES_QUERY_KEY[0]) return null
  const report = queryKey[1]
  const columnFilters = queryKey[2]
  const pageSize = queryKey[3]
  if (report !== 'weldingJournal' && report !== 'lnk' && report !== 'heatTreatment') return null
  if (!columnFilters || typeof columnFilters !== 'object' || Array.isArray(columnFilters)) return null
  if (pageSize !== WELD_PAGE_ALL_SIZE && !WELD_PAGE_SIZE_OPTIONS.includes(pageSize as never)) return null
  return {
    report,
    columnFilters: columnFilters as Record<string, string>,
    pageSize: pageSize as WeldPageSize,
  }
}

function getRefreshStateMap(queryClient: QueryClient) {
  let stateMap = refreshStates.get(queryClient)
  if (!stateMap) {
    stateMap = new Map()
    refreshStates.set(queryClient, stateMap)
  }
  return stateMap
}

function getRefreshRequiredKeys(queryClient: QueryClient) {
  let requiredKeys = refreshRequiredKeys.get(queryClient)
  if (!requiredKeys) {
    requiredKeys = new Set()
    refreshRequiredKeys.set(queryClient, requiredKeys)
  }
  return requiredKeys
}

function getQueryStateKey(queryKey: QueryKey) {
  return JSON.stringify(queryKey)
}

function fetchReportPage(report: WeldReportKind, data: WeldPageRequest) {
  if (report === 'lnk') return listLnkReportPage({ data })
  if (report === 'heatTreatment') return listHeatTreatmentReportPage({ data })
  return listWeldingJournalPage({ data })
}
