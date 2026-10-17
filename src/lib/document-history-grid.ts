/** View-only registry requests. Document operations still receive explicit document IDs. */
export type DocumentHistoryGridRequest = {
  startRow: number
  endRow: number
  rowGroupCols: string[]
  groupKeys: string[]
  sortModel: Array<{ colId: string; sort: 'asc' | 'desc' }>
  search?: string
  selectedIds?: Array<string | number>
  /** Restore exact selections without loading unrelated registry rows (maximum 10000 IDs). */
  selectionOnly?: boolean
}

export type DocumentHistoryGroupRow = {
  __group: true
  id: string
  groupKey: string
  groupLabel: string
  childCount: number
  [column: string]: string | number | boolean
}

export type DocumentHistoryGridResult<T> = {
  rows: Array<T | DocumentHistoryGroupRow>
  /** Immediate groups or documents at this route, before the block limit. */
  rowCount: number
  /** All documents matching the filters/search, independent of the expanded route. */
  total: number
  matchingSelectedIds?: Array<string | number>
}

export const DOCUMENT_HISTORY_GRID_BLOCK_LIMIT = 500

export function isDocumentHistoryGroupRow(value: unknown): value is DocumentHistoryGroupRow {
  return Boolean(value && typeof value === 'object' && '__group' in value && value.__group === true)
}
