import { useQuery } from '@tanstack/react-query'
import {
  listWeldJoints,
  type WeldFilters,
} from '@/server/welds'

const emptyFilters: WeldFilters = {}

export function useWeldsQuery({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['weld-joints', emptyFilters],
    queryFn: async () => listWeldJoints({ data: emptyFilters }),
    enabled,
    staleTime: 15_000,
  })
}
