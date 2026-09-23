import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'

import {
  DUPLICATE_CONTROL_PAGE_SIZE_OPTIONS,
  type DuplicateControlPageSize,
} from '@/lib/duplicate-control-types'
import { DUPLICATE_CONTROL_CANDIDATES_QUERY_KEY } from '@/lib/weld-query-utils'
import {
  listDuplicateControlCandidatePage,
  listDuplicateControlCandidateRowsByIds,
} from '@/server/duplicate-controls'

export function useDuplicateControlCandidates({
  enabled,
  search,
}: {
  enabled: boolean
  search: string
}) {
  const [pageSize, setPageSizeState] = useState<DuplicateControlPageSize>(100)
  const normalizedSearch = String(search ?? '').trim().slice(0, 200)
  const query = useInfiniteQuery({
    queryKey: [...DUPLICATE_CONTROL_CANDIDATES_QUERY_KEY, normalizedSearch, pageSize],
    enabled,
    initialPageParam: 1,
    queryFn: ({ pageParam }) => listDuplicateControlCandidatePage({
      data: {
        search: normalizedSearch,
        page: Number(pageParam) || 1,
        pageSize,
      },
    }),
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.page + 1 : undefined,
    staleTime: 15_000,
    gcTime: 5 * 60_000,
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const rows = useMemo(() => query.data?.pages.flatMap((page) => page.rows) ?? [], [query.data])
  const totalCount = query.data?.pages[0]?.totalCount ?? 0
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = query
  const loadMore = useCallback(() => {
    if (!hasNextPage || isFetchingNextPage) return
    void fetchNextPage()
  }, [fetchNextPage, hasNextPage, isFetchingNextPage])
  const setPageSize = useCallback((value: number) => {
    if (DUPLICATE_CONTROL_PAGE_SIZE_OPTIONS.includes(value as DuplicateControlPageSize)) {
      setPageSizeState(value as DuplicateControlPageSize)
    }
  }, [])

  return {
    rows,
    totalCount,
    firstItemNumber: totalCount === 0 ? 0 : 1,
    lastItemNumber: rows.length,
    pageSize,
    hasMore: Boolean(hasNextPage),
    isLoading: query.isPending,
    isFetching: query.isFetching,
    isFetchingNextPage,
    isReady: query.data !== undefined,
    error: query.error,
    loadMore,
    setPageSize,
  }
}

export function useDuplicateControlRowsByIds(ids: number[], { enabled = true }: { enabled?: boolean } = {}) {
  const normalizedIds = Array.from(new Set(ids.map(Number).filter((id) => Number.isInteger(id) && id > 0)))
  return useQuery({
    queryKey: [...DUPLICATE_CONTROL_CANDIDATES_QUERY_KEY, 'selected', normalizedIds],
    queryFn: () => listDuplicateControlCandidateRowsByIds({ data: { ids: normalizedIds } }),
    enabled: enabled && normalizedIds.length > 0,
    staleTime: 15_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}
