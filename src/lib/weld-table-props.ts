import type { WeldTableProps } from '@/components/weld-table'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getDuplicateControlTableColumns } from '@/lib/duplicate-control-table-columns'
import type { ActiveReport } from '@/lib/home-state'
import { isLnkRequestAllowedForRow, isLnkRequestField } from '@/lib/lnk-field-updates'
import { getLnkDisplayValue, getPstoDisplayValue, getWeldingJournalDisplayValue } from '@/lib/lnk-status'
import { getReportRowActions, type ReportRowActionHandlers } from '@/lib/report-row-actions'
import {
  canOpenLinkedReport,
  getOpenLinkedReportTitle,
  getReportBlockedFieldKeys,
  getReportEditableFieldKeys,
  getReportHiddenFieldKeys,
  isReadOnlyReport,
  shouldMergePstoSections,
} from '@/lib/report-ui-state'

type CreateWeldTablePropsOptions = {
  activeReport: ActiveReport
  rows: WeldTableProps['rows']
  columnFilters: WeldTableProps['columnFilters']
  onColumnFiltersChange: WeldTableProps['onColumnFiltersChange']
  onEdit: WeldTableProps['onEdit']
  onDelete: WeldTableProps['onDelete']
  stickyLeft: NonNullable<WeldTableProps['stickyLeft']>
  highlightedRowIds: NonNullable<WeldTableProps['highlightedRowIds']>
  highlightedCellKeys: NonNullable<WeldTableProps['highlightedCellKeys']>
  dispatcherTaskRowIds?: WeldTableProps['dispatcherTaskRowIds']
  onOpenChain: NonNullable<WeldTableProps['onOpenChain']>
  onFilterLine: NonNullable<WeldTableProps['onFilterLine']>
  onOpenLinkedReport: NonNullable<WeldTableProps['onOpenLinkedReport']>
  onOpenDuplicateControl: (row: WeldRow) => void
  rowActionHandlers: ReportRowActionHandlers
  getContextMenuItems?: WeldTableProps['getContextMenuItems']
  selectable?: WeldTableProps['selectable']
  selectedRowIds?: WeldTableProps['selectedRowIds']
  onSelectedRowIdsChange?: WeldTableProps['onSelectedRowIdsChange']
}

export function createWeldTableProps({
  activeReport,
  rows,
  columnFilters,
  onColumnFiltersChange,
  onEdit,
  onDelete,
  stickyLeft,
  highlightedRowIds,
  highlightedCellKeys,
  dispatcherTaskRowIds,
  onOpenChain,
  onFilterLine,
  onOpenLinkedReport,
  onOpenDuplicateControl,
  rowActionHandlers,
  getContextMenuItems,
  selectable,
  selectedRowIds,
  onSelectedRowIdsChange,
}: CreateWeldTablePropsOptions): WeldTableProps {
  return {
    rows,
    columnFilters,
    onColumnFiltersChange,
    onEdit,
    onDelete,
    stickyLeft,
    highlightedRowIds,
    highlightedCellKeys,
    dispatcherTaskRowIds,
    readOnly: isReadOnlyReport(activeReport),
    editableFieldKeys: getReportEditableFieldKeys(activeReport),
    blockedFieldKeys: getReportBlockedFieldKeys(activeReport),
    isCellEditable:
      activeReport === 'lnk'
        ? (row, fieldKey) => !isLnkRequestField(fieldKey) || isLnkRequestAllowedForRow(row, fieldKey)
        : undefined,
    getDisplayValue:
      activeReport === 'lnk'
        ? getLnkDisplayValue
        : activeReport === 'weldingJournal'
          ? getWeldingJournalDisplayValue
          : activeReport === 'heatTreatment'
            ? getPstoDisplayValue
          : undefined,
    onOpenChain,
    onOpenLinkedReport: canOpenLinkedReport(activeReport) ? onOpenLinkedReport : undefined,
    openLinkedReportTitle: getOpenLinkedReportTitle(activeReport),
    rowActions: getReportRowActions(activeReport, rowActionHandlers),
    extraColumns: getDuplicateControlTableColumns({ activeReport, onOpenDuplicateControl }),
    getContextMenuItems,
    selectable,
    selectedRowIds,
    onSelectedRowIdsChange,
    storageKey: activeReport,
    hiddenFieldKeys: getReportHiddenFieldKeys(activeReport),
    mergePstoSections: shouldMergePstoSections(activeReport),
    stickyIdentityColumns: activeReport === 'weldingJournal' || activeReport === 'lnk' || activeReport === 'heatTreatment',
    onFilterLine,
  }
}
