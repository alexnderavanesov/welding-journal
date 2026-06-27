import { useQuery } from '@tanstack/react-query'
import {
  listWeldJoints,
  type WeldFilters,
} from '@/server/welds'

const emptyFilters: WeldFilters = {}

export function useWeldsQuery() {
  return useQuery({
    queryKey: ['weld-joints', emptyFilters],
    queryFn: async () => listWeldJoints({ data: emptyFilters }),
  })
}
