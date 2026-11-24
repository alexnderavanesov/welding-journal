import { useQuery } from '@tanstack/react-query'
import { readWorkClosureValues } from '@/server/work-closures-api'

export const WORK_CLOSURE_VALUES_KEY = ['work-closure-values'] as const

export function useWorkClosureValues(enabled = true) {
  return useQuery({ queryKey: WORK_CLOSURE_VALUES_KEY, queryFn: ({ signal }) => readWorkClosureValues({ signal }), enabled, staleTime: 0 })
}
