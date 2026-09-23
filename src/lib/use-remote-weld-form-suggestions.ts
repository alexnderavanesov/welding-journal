import { useIsFetching, useQuery } from '@tanstack/react-query'

import { WELD_FORM_SUGGESTIONS_QUERY_KEY } from '@/lib/weld-query-utils'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'
import { listWeldFormSuggestions } from '@/server/weld-read-api'

/** One form session must not fan out full-table suggestion scans while typing. */
export function useRemoteWeldFormSuggestions({
  fieldKey,
  draft,
  enabled,
}: {
  fieldKey: WeldFieldKey
  draft: WeldInput
  enabled: boolean
}) {
  const queryKey = [...WELD_FORM_SUGGESTIONS_QUERY_KEY, fieldKey, draft]
  const allFetchingCount = useIsFetching({ queryKey: WELD_FORM_SUGGESTIONS_QUERY_KEY })
  const currentFetchingCount = useIsFetching({ queryKey, exact: true })
  return useQuery({
    queryKey,
    queryFn: () => listWeldFormSuggestions({ data: { fieldKey, draft } }),
    enabled: enabled && (allFetchingCount === 0 || currentFetchingCount > 0),
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}
