import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

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
  return useQuery({
    queryKey: [...PSTO_WORKFLOW_ROWS_QUERY_KEY, queryIdentity],
    queryFn: () => listPstoWorkflowRows({ data: normalizedRequest! }),
    enabled: normalizedRequest !== null,
    staleTime: isCandidateQuery ? 0 : WORKFLOW_STALE_TIME,
    placeholderData: (previous, previousQuery) => isCandidateQuery &&
      (previousQuery?.queryKey.at(-1) as PstoWorkflowRowsRequest | undefined)?.scope === normalizedRequest?.scope
        ? previous
        : undefined,
    gcTime: WORKFLOW_GC_TIME,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}

export function getPstoWorkflowRowsQueryIdentity(
  request: ReturnType<typeof normalizePstoWorkflowRowsRequest> | null,
) {
  if (!request) return null
  const { includeRowIds: _includeRowIds, ...identity } = request
  return identity
}
