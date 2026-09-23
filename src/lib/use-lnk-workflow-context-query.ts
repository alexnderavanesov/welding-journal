import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

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
  return useQuery({
    queryKey: [...LNK_WORKFLOW_ROWS_QUERY_KEY, queryIdentity],
    queryFn: () => listLnkWorkflowRows({ data: normalizedRequest! }),
    enabled: normalizedRequest !== null,
    staleTime: isCandidateQuery ? 0 : WORKFLOW_STALE_TIME,
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
}

export function getLnkWorkflowRowsQueryIdentity(
  request: ReturnType<typeof normalizeLnkWorkflowRowsRequest> | null,
) {
  if (!request) return null
  const { includeRowIds: _includeRowIds, ...identity } = request
  return identity
}
