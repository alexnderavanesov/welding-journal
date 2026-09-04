import type { WeldTableProps } from '@/components/weld-table'
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
import {
  LNK_CONCLUSION_TEMPLATE_PROFILES,
  type SystemDocumentTemplateId,
} from '@/lib/system-document-template-types'
import { LNK_VISIBLE_FIELD_SECTIONS } from '@/lib/lnk-visible-field-layout'
import type { WeldTableSection } from '@/lib/weld-table-sections'
import {
  getLnkDefectDescriptionDescriptor,
  isLnkDefectDescriptionEditable,
} from '@/lib/lnk-defect-description'

const LNK_SYSTEM_DOCUMENT_TYPES = new Set<SystemDocumentTemplateId>([
  'lnkRequest',
  ...LNK_CONCLUSION_TEMPLATE_PROFILES.map((profile) => profile.id),
])
const PSTO_SYSTEM_DOCUMENT_TYPES = new Set<SystemDocumentTemplateId>([
  'pstoRequest',
  'pstoConclusion',
  'tvmtRequest',
  'tvmtConclusion',
])
const NO_SYSTEM_DOCUMENT_TYPES = new Set<SystemDocumentTemplateId>()
const LNK_DEFAULT_COLLAPSED_SECTIONS = new Set(['НК до ТО'])

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
  availableSystemDocumentTypes?: WeldTableProps['availableSystemDocumentTypes']
  onOpenDuplicateControl: (row: WeldRow) => void
  rowActionHandlers: ReportRowActionHandlers
  getContextMenuItems?: WeldTableProps['getContextMenuItems']
  selectable?: WeldTableProps['selectable']
  selectedRowIds?: WeldTableProps['selectedRowIds']
  onSelectedRowIdsChange?: WeldTableProps['onSelectedRowIdsChange']
  dispatcherTasks?: readonly RepeatedJointTask[]
  onRunNextAction?: (row: WeldRow, action: JointNextAction) => void
  lnkSectionLayout?: WeldTableSection[]
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
  availableSystemDocumentTypes,
  onOpenDuplicateControl,
  rowActionHandlers,
  getContextMenuItems,
  selectable,
  selectedRowIds,
  onSelectedRowIdsChange,
  dispatcherTasks = [],
  onRunNextAction,
  lnkSectionLayout = LNK_VISIBLE_FIELD_SECTIONS,
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
    availableSystemDocumentTypes:
      activeReport === 'lnk'
        ? intersectSystemDocumentTypes(availableSystemDocumentTypes, LNK_SYSTEM_DOCUMENT_TYPES)
        : activeReport === 'heatTreatment'
          ? intersectSystemDocumentTypes(availableSystemDocumentTypes, PSTO_SYSTEM_DOCUMENT_TYPES)
          : NO_SYSTEM_DOCUMENT_TYPES,
    openLinkedReportTitle: getOpenLinkedReportTitle(activeReport),
    rowActions: getReportRowActions(activeReport, rowActionHandlers),
    extraColumns: [
      ...getJointNextActionTableColumns({
        activeReport,
        dispatcherTasks,
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

function intersectSystemDocumentTypes(
  availableTypes: ReadonlySet<SystemDocumentTemplateId> | undefined,
  reportTypes: ReadonlySet<SystemDocumentTemplateId>,
) {
  if (!availableTypes?.size) return NO_SYSTEM_DOCUMENT_TYPES
  return new Set(Array.from(availableTypes).filter((type) => reportTypes.has(type)))
}
