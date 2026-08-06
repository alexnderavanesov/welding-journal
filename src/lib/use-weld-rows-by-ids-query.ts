import { useQuery } from '@tanstack/react-query'
import { WELD_JOINTS_QUERY_KEY } from '@/lib/weld-query-utils'
import { listWeldJointRowsByIds } from '@/server/welds'

export function useWeldRowsByIdsQuery(ids: number[]) {
  const normalizedIds = Array.from(new Set(ids.map(Number).filter(Number.isFinite)))

  return useQuery({
    queryKey: [...WELD_JOINTS_QUERY_KEY, 'by-ids', normalizedIds],
    queryFn: () => listWeldJointRowsByIds({ data: { ids: normalizedIds } }),
    enabled: normalizedIds.length > 0,
    staleTime: 15_000,
  })
}
