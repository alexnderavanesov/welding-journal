import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useWorkflowQuerySelection } from '@/lib/use-workflow-query-selection'

import {
  PSTO_WORKFLOW_REQUEST_OPTIONS_QUERY_KEY,
  PSTO_WORKFLOW_ROWS_QUERY_KEY,
  PSTO_WORKFLOW_SUMMARY_QUERY_KEY,
} from '@/lib/weld-query-utils'
import {
  getPstoWorkflowRequestOptions,
  getPstoWorkflowSummary,
  listPstoWorkflowRows,
  type PstoWorkflowRowsRequest,
} from '@/server/weld-read-api'
import { normalizePstoWorkflowRowsRequest } from '@/server/weld-contracts'

const WORKFLOW_STALE_TIME = 60_000
const WORKFLOW_GC_TIME = 15 * 60_000

export function usePstoWorkflowSummaryQuery({ enabled }: { enabled: boolean }) {
  return useQuery({
    queryKey: PSTO_WORKFLOW_SUMMARY_QUERY_KEY,
    queryFn: () => getPstoWorkflowSummary(),
    enabled,
    staleTime: WORKFLOW_STALE_TIME,
    gcTime: WORKFLOW_GC_TIME,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}

export function usePstoWorkflowRequestOptionsQuery({
  enabled,
  search,
}: {
  enabled: boolean
  search: string
}) {
  return useQuery({
    queryKey: [...PSTO_WORKFLOW_REQUEST_OPTIONS_QUERY_KEY, { search }],
    queryFn: () => getPstoWorkflowRequestOptions({ data: { search } }),
    enabled,
    staleTime: WORKFLOW_STALE_TIME,
    gcTime: WORKFLOW_GC_TIME,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}

export function usePstoWorkflowRowsQuery({
  request,
}: {
  request: PstoWorkflowRowsRequest | null
}) {
  const normalizedRequest = useMemo(
    () => (request ? normalizePstoWorkflowRowsRequest(request) : null),
    [request],
  )
  const queryIdentity = useMemo(
    () => getPstoWorkflowRowsQueryIdentity(normalizedRequest),
    [normalizedRequest],
  )
  const isCandidateQuery = normalizedRequest?.scope.endsWith('Candidates') ?? false
  const initialSelection = useWorkflowQuerySelection(isCandidateQuery ? queryIdentity : null, normalizedRequest?.includeRowIds)
  const query = useQuery({
    queryKey: [...PSTO_WORKFLOW_ROWS_QUERY_KEY, isCandidateQuery ? { ...queryIdentity, initialSelection } : queryIdentity],
    queryFn: () => listPstoWorkflowRows({ data: normalizedRequest! }),
    enabled: normalizedRequest !== null,
    // Every newly opened workflow reads current facts; focus does not replace a draft.
    staleTime: 0,
    placeholderData: (previous, previousQuery) => isCandidateQuery &&
      (previousQuery?.queryKey.at(-1) as PstoWorkflowRowsRequest | undefined)?.scope === normalizedRequest?.scope
        ? previous
        : undefined,
    gcTime: WORKFLOW_GC_TIME,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  return {
    ...query,
    // Cached/placeholder rows can be displayed, but cannot prune a draft.
    isContextReady: normalizedRequest !== null && query.isSuccess &&
      !query.isPlaceholderData && !query.isFetching,
  }
}

export function getPstoWorkflowRowsQueryIdentity(
  request: ReturnType<typeof normalizePstoWorkflowRowsRequest> | null,
) {
  if (!request) return null
  const { includeRowIds: _includeRowIds, ...identity } = request
  return identity
}
