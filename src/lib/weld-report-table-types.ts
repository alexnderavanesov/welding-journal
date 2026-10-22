import type { ReactNode } from 'react'
import type { ContextActionMenuItem } from '@/components/context-action-menu'
import type { WeldRow } from './dispatcher-types'
import type { ReportRowActions } from './report-row-actions'
import type { WeldTableExtraColumn } from './weld-table-extra-columns'
import type { WeldFieldKey } from './weld-fields'
import type { WeldTableSection } from './weld-table-sections'
import type { WeldSort } from '@/server/weld-contracts'

export type WeldTableProps = {
  journalServer?: import('./use-journal-server-query').JournalServerSource
  rows: WeldRow[]
  rowsReady?: boolean
  queryIdentity?: string
  actionRows?: WeldRow[]
  loadContextMenuRows?: (ids: number[]) => Promise<WeldRow[]>
  onContextMenuError?: (message: string) => void
  duplicateRows?: WeldRow[]
  duplicateKeyOverrides?: ReadonlySet<string>
  columnFilters: Record<string, string>
  manualPagination?: {
    totalCount: number | undefined
    summaryStatus?: 'pending' | 'ready' | 'error'
    rowsLoading?: boolean
    firstItemNumber: number
    lastItemNumber: number
    pageSize: number
    hasMore: boolean
    onLoadMore: () => void
    onPageSizeChange: (pageSize: number) => void
  }
  onColumnFiltersChange: (filters: Record<string, string>) => void
  sort?: WeldSort | null
  onSortChange?: (sort: WeldSort | null) => void
  onEdit?: (row: WeldRow, fieldKey?: WeldFieldKey) => void
  onDelete?: (id: number) => void
  highlightedRowIds?: ReadonlySet<number>
  highlightedCellKeys?: ReadonlySet<string>
  dispatcherTaskRowIds?: ReadonlySet<number>
  readOnly?: boolean
  editableFieldKeys?: ReadonlySet<WeldFieldKey>
  blockedFieldKeys?: ReadonlySet<WeldFieldKey>
  isCellEditable?: (row: WeldRow, fieldKey: WeldFieldKey) => boolean
  showBlockedEditableCellBackground?: boolean
  getDisplayValue?: (row: WeldRow, fieldKey: WeldFieldKey) => unknown
  onOpenChain?: (row: WeldRow) => void
  onFilterLine?: (row: WeldRow) => void
  onOpenLinkedReport?: (row: WeldRow) => void
  onOpenDocument?: (row: WeldRow, fieldKey: WeldFieldKey) => void
  onOpenLnkRequest?: (row: WeldRow, fieldKey: WeldFieldKey) => void
  onOpenLnkResult?: (row: WeldRow, fieldKey: WeldFieldKey) => void
  onOpenJoint?: (row: WeldRow) => void
  onOpenJointOverview?: (row: WeldRow) => void
  controlBasisEditorEnabled?: boolean
  openLinkedReportTitle?: string
  selectable?: boolean
  selectedRowIds?: ReadonlySet<number>
  onSelectedRowIdsChange?: (ids: Set<number>) => void
  isRowSelectable?: (row: WeldRow) => boolean
  hiddenFieldKeys?: ReadonlySet<WeldFieldKey>
  mergePstoSections?: boolean
  rowActions?: ReportRowActions
  extraColumns?: WeldTableExtraColumn[]
  defaultCollapsedSections?: ReadonlySet<string>
  sectionLayout?: readonly WeldTableSection[]
  getContextMenuItems?: (
    row: WeldRow,
    selectedRows: WeldRow[],
    fieldKey?: WeldFieldKey,
  ) => ContextActionMenuItem[]
  reportTaskPanels?: ReactNode
}
