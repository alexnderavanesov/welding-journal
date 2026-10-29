import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useWorkflowQuerySelection } from '@/lib/use-workflow-query-selection'

import {
  LNK_WORKFLOW_REQUEST_SUMMARY_QUERY_KEY,
  LNK_WORKFLOW_ROWS_QUERY_KEY,
  LNK_WORKFLOW_SUMMARY_QUERY_KEY,
} from '@/lib/weld-query-utils'
import {
  getLnkWorkflowRequestSummary,
  getLnkWorkflowSummary,
  listLnkWorkflowRows,
  type LnkWorkflowRowsRequest,
} from '@/server/weld-read-api'
import { normalizeLnkWorkflowRowsRequest } from '@/server/weld-contracts'

const WORKFLOW_STALE_TIME = 60_000
const WORKFLOW_GC_TIME = 15 * 60_000

export function useLnkWorkflowSummaryQuery({ enabled }: { enabled: boolean }) {
  return useQuery({
    queryKey: LNK_WORKFLOW_SUMMARY_QUERY_KEY,
    queryFn: () => getLnkWorkflowSummary(),
    enabled,
    staleTime: WORKFLOW_STALE_TIME,
    gcTime: WORKFLOW_GC_TIME,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}

export function useLnkWorkflowRequestSummaryQuery({
  enabled,
  search,
}: {
  enabled: boolean
  search: string
}) {
  return useQuery({
    queryKey: [...LNK_WORKFLOW_REQUEST_SUMMARY_QUERY_KEY, { search }],
    queryFn: () => getLnkWorkflowRequestSummary({ data: { search } }),
    enabled,
    staleTime: WORKFLOW_STALE_TIME,
    gcTime: WORKFLOW_GC_TIME,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}

export function useLnkWorkflowRowsQuery({
  request,
}: {
  request: LnkWorkflowRowsRequest | null
}) {
  const normalizedRequest = useMemo(
    () => (request ? normalizeLnkWorkflowRowsRequest(request) : null),
    [request],
  )
  const queryIdentity = useMemo(
    () => getLnkWorkflowRowsQueryIdentity(normalizedRequest),
    [normalizedRequest],
  )
  const isCandidateQuery = normalizedRequest?.scope.endsWith('Candidates') ?? false
  const initialSelection = useWorkflowQuerySelection(isCandidateQuery ? queryIdentity : null, normalizedRequest?.includeRowIds)
  const query = useQuery({
    queryKey: [...LNK_WORKFLOW_ROWS_QUERY_KEY, isCandidateQuery ? { ...queryIdentity, initialSelection } : queryIdentity],
    queryFn: () => listLnkWorkflowRows({ data: normalizedRequest! }),
    enabled: normalizedRequest !== null,
    // Every newly opened workflow reads current facts; focus does not replace a draft.
    staleTime: 0,
    // Keep the current selection visible while the next search is in flight.
    // Selected IDs travel with that search but do not trigger requests alone.
    placeholderData: (previous, previousQuery) => isCandidateQuery &&
      (previousQuery?.queryKey.at(-1) as LnkWorkflowRowsRequest | undefined)?.scope === normalizedRequest?.scope
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

export function getLnkWorkflowRowsQueryIdentity(
  request: ReturnType<typeof normalizeLnkWorkflowRowsRequest> | null,
) {
  if (!request) return null
  const { includeRowIds: _includeRowIds, ...identity } = request
  return identity
}
