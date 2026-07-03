import type { WeldTableProps } from '@/components/weld-table'
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
  onOpenChain: NonNullable<WeldTableProps['onOpenChain']>
  onOpenLinkedReport: NonNullable<WeldTableProps['onOpenLinkedReport']>
  rowActionHandlers: ReportRowActionHandlers
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
  onOpenChain,
  onOpenLinkedReport,
  rowActionHandlers,
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
    storageKey: activeReport,
    hiddenFieldKeys: getReportHiddenFieldKeys(activeReport),
    mergePstoSections: shouldMergePstoSections(activeReport),
  }
}
