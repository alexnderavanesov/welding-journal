import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'

import {
  DUPLICATE_CONTROL_PAGE_SIZE_OPTIONS,
  type DuplicateControlPageSize,
} from '@/lib/duplicate-control-types'
import { invalidateWeldJoints, DUPLICATE_CONTROL_REGISTRY_QUERY_KEY } from '@/lib/weld-query-utils'
import {
  deleteDuplicateControl,
  listDuplicateControlRegistryPage,
  saveDuplicateControls,
  type DuplicateControlPayload,
} from '@/server/duplicate-controls'

export function useDuplicateControls({ registryEnabled = false }: { registryEnabled?: boolean } = {}) {
  const queryClient = useQueryClient()
  const [registryPageSize, setRegistryPageSizeState] = useState<DuplicateControlPageSize>(100)
  const registryQuery = useInfiniteQuery({
    queryKey: [...DUPLICATE_CONTROL_REGISTRY_QUERY_KEY, registryPageSize],
    queryFn: ({ pageParam }) => listDuplicateControlRegistryPage({
      data: { page: Number(pageParam) || 1, pageSize: registryPageSize },
    }),
    enabled: registryEnabled,
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.page + 1 : undefined,
    staleTime: 15_000,
    gcTime: 5 * 60_000,
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const duplicateControls = useMemo(
    () => registryQuery.data?.pages.flatMap((page) => page.rows) ?? [],
    [registryQuery.data],
  )
  const duplicateControlCount = registryQuery.data?.pages[0]?.totalCount ?? 0
  const {
    fetchNextPage: fetchNextRegistryPage,
    hasNextPage: hasNextRegistryPage,
    isFetchingNextPage: isFetchingNextRegistryPage,
  } = registryQuery
  const loadMoreDuplicateControls = useCallback(() => {
    if (!hasNextRegistryPage || isFetchingNextRegistryPage) return
    void fetchNextRegistryPage()
  }, [fetchNextRegistryPage, hasNextRegistryPage, isFetchingNextRegistryPage])
  const setDuplicateControlPageSize = useCallback((value: number) => {
    if (DUPLICATE_CONTROL_PAGE_SIZE_OPTIONS.includes(value as DuplicateControlPageSize)) {
      setRegistryPageSizeState(value as DuplicateControlPageSize)
    }
  }, [])

  const saveDuplicateControlMutation = useMutation({
    mutationFn: async (records: DuplicateControlPayload[]) => saveDuplicateControls({ data: { records } }),
    onSuccess: () => invalidateWeldJoints(queryClient),
  })

  const deleteDuplicateControlMutation = useMutation({
    mutationFn: async ({ id, expectedVersion }: { id: number; expectedVersion: string }) =>
      deleteDuplicateControl({ data: { id, expectedVersion } }),
    onSuccess: () => invalidateWeldJoints(queryClient),
  })

  return {
    duplicateControls,
    duplicateControlCount,
    duplicateControlRegistryFirstItemNumber: duplicateControlCount === 0 ? 0 : 1,
    duplicateControlRegistryLastItemNumber: duplicateControls.length,
    duplicateControlRegistryPageSize: registryPageSize,
    duplicateControlRegistryHasMore: Boolean(hasNextRegistryPage),
    duplicateControlRegistryLoading: registryQuery.isPending,
    duplicateControlRegistryFetching: registryQuery.isFetching,
    duplicateControlRegistryReady: registryQuery.data !== undefined,
    duplicateControlRegistryError: registryQuery.error,
    loadMoreDuplicateControls,
    setDuplicateControlPageSize,
    refetchDuplicateControls: registryQuery.refetch,
    saveDuplicateControlMutation,
    deleteDuplicateControlMutation,
  }
}
