import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import {
  LNK_WORKFLOW_ROWS_QUERY_KEY,
  LNK_WORKFLOW_SUMMARY_QUERY_KEY,
} from '@/lib/weld-query-utils'
import {
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
  return useQuery({
    queryKey: [...LNK_WORKFLOW_ROWS_QUERY_KEY, normalizedRequest],
    queryFn: () => listLnkWorkflowRows({ data: normalizedRequest! }),
    enabled: normalizedRequest !== null,
    staleTime: WORKFLOW_STALE_TIME,
    gcTime: WORKFLOW_GC_TIME,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}
