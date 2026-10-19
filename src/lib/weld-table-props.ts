import type { WeldTableProps } from '@/components/weld-table'
import type { ControlProcessSettings } from '@/lib/control-process-settings'
import type { RepeatedJointTask, WeldRow } from '@/lib/dispatcher-types'
import { getDuplicateControlTableColumns } from '@/lib/duplicate-control-table-columns'
import { getJointNextActionTableColumns } from '@/lib/joint-next-action-table-column'
import type { JointNextAction } from '@/lib/joint-next-actions'
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
import { LNK_VISIBLE_FIELD_SECTIONS } from '@/lib/lnk-visible-field-layout'
import type { WeldTableSection } from '@/lib/weld-table-sections'
import {
  getLnkDefectDescriptionDescriptor,
  isLnkDefectDescriptionEditable,
} from '@/lib/lnk-defect-description'

const LNK_DEFAULT_COLLAPSED_SECTIONS = new Set(['НК до ТО'])

type CreateWeldTablePropsOptions = {
  activeReport: ActiveReport
  rows: WeldTableProps['rows']
  rowsReady?: WeldTableProps['rowsReady']
  queryIdentity?: WeldTableProps['queryIdentity']
  actionRows?: WeldTableProps['actionRows']
  loadContextMenuRows?: WeldTableProps['loadContextMenuRows']
  onContextMenuError?: WeldTableProps['onContextMenuError']
  duplicateRows?: WeldTableProps['duplicateRows']
  duplicateKeyOverrides?: WeldTableProps['duplicateKeyOverrides']
  filterOptionRows?: WeldTableProps['filterOptionRows']
  columnFilters: WeldTableProps['columnFilters']
  manualFiltering?: WeldTableProps['manualFiltering']
  manualFilterOptionsReport?: WeldTableProps['manualFilterOptionsReport']
  manualFilterOptions?: WeldTableProps['manualFilterOptions']
  manualPagination?: WeldTableProps['manualPagination']
  onColumnFiltersChange: WeldTableProps['onColumnFiltersChange']
  sort?: WeldTableProps['sort']
  onSortChange?: WeldTableProps['onSortChange']
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
  onOpenLnkRequest?: WeldTableProps['onOpenLnkRequest']
  onOpenLnkResult?: WeldTableProps['onOpenLnkResult']
  onOpenJoint?: WeldTableProps['onOpenJoint']
  onOpenJointOverview?: WeldTableProps['onOpenJointOverview']
  onOpenDuplicateControl: (row: WeldRow) => void
  rowActionHandlers: ReportRowActionHandlers
  getContextMenuItems?: WeldTableProps['getContextMenuItems']
  selectable?: WeldTableProps['selectable']
  selectedRowIds?: WeldTableProps['selectedRowIds']
  onSelectedRowIdsChange?: WeldTableProps['onSelectedRowIdsChange']
  dispatcherTasks?: readonly RepeatedJointTask[]
  dispatcherTasksByRow?: ReadonlyMap<number, RepeatedJointTask[]>
  dispatcherTasksPending?: boolean
  dispatcherTasksError?: string
  controlProcessSettings?: Pick<ControlProcessSettings, 'preHeatTreatmentLnkEnabled' | 'allowPrimaryLnkBeforePreviousStagesComplete'>
  onRunNextAction?: (row: WeldRow, action: JointNextAction) => void
  lnkSectionLayout?: WeldTableSection[]
}

export function createWeldTableProps({
  activeReport,
  rows,
  rowsReady,
  queryIdentity,
  actionRows,
  loadContextMenuRows,
  onContextMenuError,
  duplicateRows,
  duplicateKeyOverrides,
  filterOptionRows,
  columnFilters,
  manualFiltering,
  manualFilterOptionsReport,
  manualFilterOptions,
  manualPagination,
  onColumnFiltersChange,
  sort,
  onSortChange,
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
  onOpenLnkRequest,
  onOpenLnkResult,
  onOpenJoint,
  onOpenJointOverview,
  onOpenDuplicateControl,
  rowActionHandlers,
  getContextMenuItems,
  selectable,
  selectedRowIds,
  onSelectedRowIdsChange,
  dispatcherTasks = [],
  dispatcherTasksByRow,
  dispatcherTasksPending,
  dispatcherTasksError,
  controlProcessSettings,
  onRunNextAction,
  lnkSectionLayout = LNK_VISIBLE_FIELD_SECTIONS,
}: CreateWeldTablePropsOptions): WeldTableProps {
  return {
    rows,
    rowsReady,
    queryIdentity,
    actionRows,
    loadContextMenuRows,
    onContextMenuError,
    duplicateRows,
    duplicateKeyOverrides,
    filterOptionRows,
    columnFilters,
    manualFiltering,
    manualFilterOptionsReport,
    manualFilterOptions,
    manualPagination,
    onColumnFiltersChange,
    sort,
    onSortChange,
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
        ? (row, fieldKey) => {
            const descriptor = getLnkDefectDescriptionDescriptor(fieldKey)
            if (descriptor) return isLnkDefectDescriptionEditable(row, descriptor)
            return !isLnkRequestField(fieldKey) || isLnkRequestAllowedForRow(row, fieldKey)
          }
        : undefined,
    showBlockedEditableCellBackground: activeReport !== 'lnk',
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
    onOpenLnkRequest:
      activeReport === 'lnk' || activeReport === 'weldingJournal'
        ? onOpenLnkRequest
        : undefined,
    onOpenLnkResult: activeReport === 'lnk' ? onOpenLnkResult : undefined,
    onOpenJoint: activeReport === 'heatTreatment' ? onOpenJoint : undefined,
    onOpenJointOverview:
      activeReport === 'weldingJournal' || activeReport === 'lnk' || activeReport === 'heatTreatment'
        ? onOpenJointOverview
        : undefined,
    controlBasisEditorEnabled: activeReport === 'weldingJournal',
    openLinkedReportTitle: getOpenLinkedReportTitle(activeReport),
    rowActions: getReportRowActions(activeReport, rowActionHandlers),
    extraColumns: [
      ...getJointNextActionTableColumns({
        activeReport,
        dispatcherTasks,
        dispatcherTasksByRow,
        dispatcherTasksPending,
        dispatcherTasksError,
        controlProcessSettings,
        onRunNextAction,
        onOpenOverview: onOpenJointOverview,
      }),
      ...getDuplicateControlTableColumns({ activeReport, onOpenDuplicateControl }),
    ],
    getContextMenuItems,
    selectable,
    selectedRowIds,
    onSelectedRowIdsChange,
    storageKey: activeReport,
    hiddenFieldKeys: getReportHiddenFieldKeys(activeReport),
    mergePstoSections: shouldMergePstoSections(activeReport),
    sectionLayout: activeReport === 'lnk' ? lnkSectionLayout : undefined,
    defaultCollapsedSections: activeReport === 'lnk' ? LNK_DEFAULT_COLLAPSED_SECTIONS : undefined,
    stickyIdentityColumns: activeReport === 'weldingJournal' || activeReport === 'lnk' || activeReport === 'heatTreatment',
    onFilterLine,
  }
}
