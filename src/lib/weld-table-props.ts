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
import type { SystemDocumentType } from '@/lib/system-document-types'

const LNK_SYSTEM_DOCUMENT_TYPES = new Set<SystemDocumentType>(['lnkRequest', 'lnkConclusion'])
const PSTO_SYSTEM_DOCUMENT_TYPES = new Set<SystemDocumentType>(['pstoRequest', 'pstoConclusion'])
const NO_SYSTEM_DOCUMENT_TYPES = new Set<SystemDocumentType>()

type CreateWeldTablePropsOptions = {
  activeReport: ActiveReport
  rows: WeldTableProps['rows']
  actionRows?: WeldTableProps['actionRows']
  duplicateRows?: WeldTableProps['duplicateRows']
  duplicateKeyOverrides?: WeldTableProps['duplicateKeyOverrides']
  filterOptionRows?: WeldTableProps['filterOptionRows']
  columnFilters: WeldTableProps['columnFilters']
  manualFiltering?: WeldTableProps['manualFiltering']
  manualFilterOptionsReport?: WeldTableProps['manualFilterOptionsReport']
  manualFilterOptions?: WeldTableProps['manualFilterOptions']
  manualPagination?: WeldTableProps['manualPagination']
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
  onOpenDocument?: WeldTableProps['onOpenDocument']
  availableSystemDocumentTypes?: WeldTableProps['availableSystemDocumentTypes']
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
  actionRows,
  duplicateRows,
  duplicateKeyOverrides,
  filterOptionRows,
  columnFilters,
  manualFiltering,
  manualFilterOptionsReport,
  manualFilterOptions,
  manualPagination,
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
  onOpenDocument,
  availableSystemDocumentTypes,
  onOpenDuplicateControl,
  rowActionHandlers,
  getContextMenuItems,
  selectable,
  selectedRowIds,
  onSelectedRowIdsChange,
}: CreateWeldTablePropsOptions): WeldTableProps {
  return {
    rows,
    actionRows,
    duplicateRows,
    duplicateKeyOverrides,
    filterOptionRows,
    columnFilters,
    manualFiltering,
    manualFilterOptionsReport,
    manualFilterOptions,
    manualPagination,
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
    onOpenDocument:
      activeReport === 'weldingJournal' || activeReport === 'lnk' || activeReport === 'heatTreatment'
        ? onOpenDocument
        : undefined,
    availableSystemDocumentTypes:
      activeReport === 'lnk'
        ? intersectSystemDocumentTypes(availableSystemDocumentTypes, LNK_SYSTEM_DOCUMENT_TYPES)
        : activeReport === 'heatTreatment'
          ? intersectSystemDocumentTypes(availableSystemDocumentTypes, PSTO_SYSTEM_DOCUMENT_TYPES)
          : NO_SYSTEM_DOCUMENT_TYPES,
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

function intersectSystemDocumentTypes(
  availableTypes: ReadonlySet<SystemDocumentType> | undefined,
  reportTypes: ReadonlySet<SystemDocumentType>,
) {
  if (!availableTypes?.size) return NO_SYSTEM_DOCUMENT_TYPES
  return new Set(Array.from(availableTypes).filter((type) => reportTypes.has(type)))
}
