import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import type { WeldRow } from '@/lib/dispatcher-types'
import { sortWeldSnapshotRows } from '@/lib/weld-snapshot'
import type { WeldPageResult } from '@/server/welds'

export const WELD_JOINTS_QUERY_KEY = ['weld-joints'] as const
export const WELD_JOINT_PAGES_QUERY_KEY = ['weld-joint-pages'] as const
export const WELD_REPORT_CONTEXT_QUERY_KEY = ['weld-report-context'] as const
export const DISPATCHER_TASK_SNAPSHOT_QUERY_KEY = ['dispatcher-task-snapshot'] as const
export const DISPATCHER_BACKGROUND_STATUS_QUERY_KEY = ['dispatcher-background-status'] as const
export const STATISTICS_SERVER_QUERY_KEY = ['statistics-server'] as const
export const GENERATED_DOCUMENT_HISTORY_QUERY_KEY = ['generated-documents'] as const
export const WELD_COMPLETE_SNAPSHOT_QUERY_KEY = [...WELD_JOINTS_QUERY_KEY, 'complete-snapshot'] as const
export const WELD_DOCUMENT_GENERATION_QUERY_KEY = [...WELD_JOINTS_QUERY_KEY, 'document-generation'] as const
export const WELD_ROWS_BY_IDS_QUERY_KEY = [...WELD_JOINTS_QUERY_KEY, 'by-ids'] as const
export const WELD_DATA_USAGE_QUERY_KEY = [...WELD_JOINTS_QUERY_KEY, 'settings-data-usage'] as const
export const WELD_FINAL_STATUS_CONTEXT_QUERY_KEY = [...WELD_JOINTS_QUERY_KEY, 'final-status-context'] as const
export const WELD_FORM_SUGGESTIONS_QUERY_KEY = ['weld-form-suggestions'] as const
export const WELD_LINE_AUTOFILL_QUERY_KEY = ['weld-line-autofill'] as const

type WeldCacheChange = {
  upsertRows?: Array<Partial<WeldRow> & Pick<WeldRow, 'id'>>
  deleteIds?: readonly number[]
}

export function invalidateWeldJoints(queryClient: QueryClient, change?: WeldCacheChange) {
  if (change) {
    updateCompleteWeldSnapshot(queryClient, change)
    updateLoadedWeldPages(queryClient, change)
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
  void queryClient.invalidateQueries({ queryKey: WELD_LINE_AUTOFILL_QUERY_KEY })
  void queryClient.invalidateQueries({ queryKey: GENERATED_DOCUMENT_HISTORY_QUERY_KEY })
  void queryClient.invalidateQueries({ queryKey: WELD_JOINT_PAGES_QUERY_KEY })
  void queryClient.invalidateQueries({ queryKey: WELD_REPORT_CONTEXT_QUERY_KEY })
  void queryClient.invalidateQueries({ queryKey: DISPATCHER_TASK_SNAPSHOT_QUERY_KEY })
  void queryClient.invalidateQueries({ queryKey: STATISTICS_SERVER_QUERY_KEY })
}

export function updateLoadedWeldPages(queryClient: QueryClient, change: WeldCacheChange) {
  const deleteIds = new Set((change.deleteIds ?? []).map(Number))
  const upsertRows = new Map(
    (change.upsertRows ?? [])
      .filter((row) => Number.isInteger(Number(row.id)))
      .map((row) => [Number(row.id), row]),
  )

  queryClient.setQueriesData<InfiniteData<WeldPageResult>>(
    { queryKey: WELD_JOINT_PAGES_QUERY_KEY },
    (current) => {
      if (!current) return current
      const loadedIds = new Set(current.pages.flatMap((page) => page.rows.map((row) => Number(row.id))))
      const removedCount = [...deleteIds].filter((id) => loadedIds.has(id)).length
      let changed = removedCount > 0
      const pages = current.pages.map((page) => {
        const rows = page.rows.flatMap((row) => {
          const id = Number(row.id)
          if (deleteIds.has(id)) return []
          const patch = upsertRows.get(id)
          if (!patch) return [row]
          changed = true
          return [{ ...row, ...patch, id } as WeldRow]
        })
        return rows === page.rows
          ? page
          : { ...page, rows, total: Math.max(0, page.total - removedCount) }
      })
      return changed ? { ...current, pages } : current
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
