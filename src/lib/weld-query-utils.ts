import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import type { WeldRow } from '@/lib/dispatcher-types'
import { sortWeldSnapshotRows } from '@/lib/weld-snapshot'
import { DISPATCHER_ACCEPTED_WARNINGS_QUERY_KEY } from '@/lib/dispatcher-accepted-warning-query'
import { invalidateWeldPageQueries } from '@/lib/weld-page-refresh'

export const WELD_JOINTS_QUERY_KEY = ['weld-joints'] as const
export { invalidateWeldPageQueries }
export const WELD_REPORT_CONTEXT_QUERY_KEY = ['weld-report-context'] as const
export const LNK_WORKFLOW_QUERY_KEY = [...WELD_JOINTS_QUERY_KEY, 'lnk-workflow'] as const
export const LNK_WORKFLOW_SUMMARY_QUERY_KEY = [...LNK_WORKFLOW_QUERY_KEY, 'summary'] as const
export const LNK_WORKFLOW_REQUEST_SUMMARY_QUERY_KEY = [...LNK_WORKFLOW_QUERY_KEY, 'request-summary'] as const
export const LNK_WORKFLOW_ROWS_QUERY_KEY = [...LNK_WORKFLOW_QUERY_KEY, 'rows'] as const
export const PSTO_WORKFLOW_QUERY_KEY = [...WELD_JOINTS_QUERY_KEY, 'psto-workflow'] as const
export const PSTO_WORKFLOW_SUMMARY_QUERY_KEY = [...PSTO_WORKFLOW_QUERY_KEY, 'summary'] as const
export const PSTO_WORKFLOW_REQUEST_OPTIONS_QUERY_KEY = [...PSTO_WORKFLOW_QUERY_KEY, 'request-options'] as const
export const PSTO_WORKFLOW_ROWS_QUERY_KEY = [...PSTO_WORKFLOW_QUERY_KEY, 'rows'] as const
export const DISPATCHER_TASK_SNAPSHOT_QUERY_KEY = ['dispatcher-task-snapshot'] as const
export const DISPATCHER_TASK_REFRESH_QUERY_KEY = ['dispatcher-task-refresh'] as const
export const DISPATCHER_TASK_PAGE_QUERY_KEY = ['dispatcher-task-page'] as const
export const DISPATCHER_BACKGROUND_STATUS_QUERY_KEY = ['dispatcher-background-status'] as const
export const STATISTICS_SERVER_QUERY_KEY = ['statistics-server'] as const
export const GENERATED_DOCUMENT_HISTORY_QUERY_KEY = ['generated-documents'] as const
export const WELD_COMPLETE_SNAPSHOT_QUERY_KEY = [...WELD_JOINTS_QUERY_KEY, 'complete-snapshot'] as const
export const WELD_DOCUMENT_GENERATION_QUERY_KEY = [...WELD_JOINTS_QUERY_KEY, 'document-generation'] as const
export const WELD_ROWS_BY_IDS_QUERY_KEY = [...WELD_JOINTS_QUERY_KEY, 'by-ids'] as const
export const WELD_DATA_USAGE_QUERY_KEY = [...WELD_JOINTS_QUERY_KEY, 'settings-data-usage'] as const
export const WELD_FINAL_STATUS_CONTEXT_QUERY_KEY = [...WELD_JOINTS_QUERY_KEY, 'final-status-context'] as const
export const WELD_FORM_SUGGESTIONS_QUERY_KEY = ['weld-form-suggestions'] as const
export const DUPLICATE_CONTROL_CANDIDATES_QUERY_KEY = ['duplicate-control-candidates'] as const
export const DUPLICATE_CONTROL_REGISTRY_QUERY_KEY = ['duplicate-control-registry'] as const

type WeldCacheChange = {
  upsertRows?: Array<Partial<WeldRow> & Pick<WeldRow, 'id'>>
  deleteIds?: readonly number[]
}

type WeldInvalidationOptions = {
  refetchLnkWorkflow?: boolean
  refetchPstoWorkflow?: boolean
  /** The line workspace owns section/page reconciliation and scoped detail refresh. */
  lineProgramListsHandled?: boolean
}

/**
 * Applies returned rows synchronously and schedules background refreshes.
 * Saving is already complete: callers must not await this void notification.
 * A workflow that needs fresh details must separately await its scoped query
 * rather than waiting for every dependent screen.
 */
export function scheduleWeldDataRefresh(
  queryClient: QueryClient,
  change?: WeldCacheChange,
  options: WeldInvalidationOptions = {},
): void {
  if (change) {
    updateCompleteWeldSnapshot(queryClient, change)
    updateLoadedWeldReportContexts(queryClient, change)
    updateLoadedLnkWorkflowRows(queryClient, change)
    updateLoadedPstoWorkflowRows(queryClient, change)
  } else {
    void queryClient.invalidateQueries({
      queryKey: WELD_COMPLETE_SNAPSHOT_QUERY_KEY,
      refetchType: 'none',
    })
  }

  void queryClient.invalidateQueries({ queryKey: WELD_DOCUMENT_GENERATION_QUERY_KEY })
  void queryClient.invalidateQueries({ queryKey: WELD_ROWS_BY_IDS_QUERY_KEY })
  void queryClient.invalidateQueries({ queryKey: WELD_DATA_USAGE_QUERY_KEY })
  void queryClient.invalidateQueries({ queryKey: WELD_FINAL_STATUS_CONTEXT_QUERY_KEY })
  void queryClient.invalidateQueries({ queryKey: WELD_FORM_SUGGESTIONS_QUERY_KEY })
  void queryClient.invalidateQueries({ queryKey: ['line-program'], ...(options.lineProgramListsHandled ? {
    // Even a no-refetch invalidation can enable an early-page query. Leave
    // these snapshots to the workspace's cancel/patch helper atomically.
    predicate: (query: { queryKey: readonly unknown[] }) => query.queryKey[1] !== 'section' && query.queryKey[1] !== 'page',
    refetchType: 'none' as const,
  } : { refetchType: 'active' as const }) })
  void queryClient.invalidateQueries({ queryKey: DUPLICATE_CONTROL_CANDIDATES_QUERY_KEY })
  void queryClient.invalidateQueries({ queryKey: DUPLICATE_CONTROL_REGISTRY_QUERY_KEY })
  void queryClient.invalidateQueries({ queryKey: GENERATED_DOCUMENT_HISTORY_QUERY_KEY })
  void queryClient.invalidateQueries({ queryKey: DISPATCHER_ACCEPTED_WARNINGS_QUERY_KEY, refetchType: 'none' })
  void invalidateWeldPageQueries(queryClient)
  void queryClient.invalidateQueries({ queryKey: WELD_REPORT_CONTEXT_QUERY_KEY })
  void queryClient.invalidateQueries({
    queryKey: LNK_WORKFLOW_QUERY_KEY,
    refetchType: options.refetchLnkWorkflow ? 'active' : 'none',
  })
  void queryClient.invalidateQueries({
    queryKey: PSTO_WORKFLOW_QUERY_KEY,
    refetchType: options.refetchPstoWorkflow ? 'active' : 'none',
  })
  void queryClient.invalidateQueries({ queryKey: DISPATCHER_TASK_SNAPSHOT_QUERY_KEY })
  void queryClient.invalidateQueries({ queryKey: STATISTICS_SERVER_QUERY_KEY })
}

export function updateLoadedWeldReportContexts(queryClient: QueryClient, change: WeldCacheChange) {
  updateLoadedWeldRowLists(queryClient, WELD_REPORT_CONTEXT_QUERY_KEY, change)
}

export function updateLoadedLnkWorkflowRows(queryClient: QueryClient, change: WeldCacheChange) {
  updateLoadedWeldRowLists(queryClient, LNK_WORKFLOW_ROWS_QUERY_KEY, change)
}

export function updateLoadedPstoWorkflowRows(queryClient: QueryClient, change: WeldCacheChange) {
  updateLoadedWeldRowLists(queryClient, PSTO_WORKFLOW_ROWS_QUERY_KEY, change)
}

function updateLoadedWeldRowLists(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  change: WeldCacheChange,
) {
  const deleteIds = new Set((change.deleteIds ?? []).map(Number))
  const upsertRows = new Map(
    (change.upsertRows ?? [])
      .filter((row) => Number.isInteger(Number(row.id)))
      .map((row) => [Number(row.id), row]),
  )

  queryClient.setQueriesData<WeldRow[]>(
    { queryKey },
    (current) => {
      if (!current) return current
      let changed = false
      const rows = current.flatMap((row) => {
        const id = Number(row.id)
        if (deleteIds.has(id)) {
          changed = true
          return []
        }
        const patch = upsertRows.get(id)
        if (!patch) return [row]
        changed = true
        return [{ ...row, ...patch, id } as WeldRow]
      })
      return changed ? rows : current
    },
  )
}

export function updateCompleteWeldSnapshot(queryClient: QueryClient, change: WeldCacheChange) {
  const deleteIds = new Set((change.deleteIds ?? []).map(Number))
  const upsertRows = (change.upsertRows ?? []).filter((row) => Number.isInteger(Number(row.id)))

  queryClient.setQueryData<WeldRow[] | undefined>(WELD_COMPLETE_SNAPSHOT_QUERY_KEY, (current) => {
    if (!current) return current
    const rowsById = new Map(
      current
        .filter((row) => !deleteIds.has(Number(row.id)))
        .map((row) => [Number(row.id), row] as const),
    )
    for (const row of upsertRows) {
      const id = Number(row.id)
      rowsById.set(id, { ...rowsById.get(id), ...row, id } as WeldRow)
    }
    return sortWeldSnapshotRows([...rowsById.values()])
  })
}
