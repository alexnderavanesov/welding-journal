import type { GeneratedDocumentType } from './generated-document-types'
import type { SystemDocumentType } from './system-document-types'
import type { DocumentHistoryColumnKey } from './document-history-columns'
import type { DocumentHistoryGridRequest } from './document-history-grid'

export type DocumentHistoryReportSource = ({ kind: 'generated'; types: GeneratedDocumentType[] } | { kind: 'system'; type: SystemDocumentType }) & {
  columnFilters: Record<string, string>; documentId?: number
}
export type DocumentHistoryReportRequest = {
  source: DocumentHistoryReportSource
  title: string
  columns: Array<{ key: DocumentHistoryColumnKey; label: string }>
  search: string
  rowGroupCols: string[]
  sortModel: DocumentHistoryGridRequest['sortModel']
}

/** Capture the real displayed data columns; omit checkboxes, groups and actions. */
export function documentHistoryReportColumns(ids: string[], columns: readonly { key: DocumentHistoryColumnKey; label: string }[]) {
  return ids.flatMap(id => { const column = columns.find(item => item.key === id); return column ? [{ key: column.key, label: column.label }] : [] })
}
