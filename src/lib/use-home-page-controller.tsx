import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeftRight, BadgeCheck, ClipboardCheck, ExternalLink, FileSpreadsheet, FilePlus2, FileText, GitBranch, ListFilter, Pencil, Trash2 } from 'lucide-react'
import type { DispatcherTask, PercentageLineControlTask, RepeatedJointTask, WeldDraft, WeldRow } from '@/lib/dispatcher-types'
import { copyTextToClipboard } from '@/lib/clipboard'
import type { ActiveReport } from '@/lib/home-state'
import {
  useAutoCollapseNavOnHorizontalScroll,
  useEscapeToClearReportFilters,
} from '@/lib/report-page-effects'
import { useWelderStampRegistryState } from '@/lib/use-welder-stamp-registry-state'
import { useReportSwitchReset } from '@/lib/use-report-switch-reset'
import { useReportHighlights } from '@/lib/use-report-highlights'
import {
  useReportOutputActions,
  type LnkOutputRowsKind,
  type PstoOutputRowsKind,
  type WeldingJournalOutputRowsKind,
} from '@/lib/use-report-output-actions'
import {
  loadCompleteReportOutputRows,
  loadFilteredCurrentReportOutputRows,
} from '@/lib/report-output-source'
import { useReportModalEscapeKey } from '@/lib/use-report-modal-escape-key'
import { useWorkflowRootCauseEscapeKey } from '@/lib/use-workflow-root-cause-escape-key'
import { useReportModalSyncEffects } from '@/lib/use-report-modal-sync-effects'
import { useJointChainDialogState } from '@/lib/use-joint-chain-dialog-state'
import { useDispatcherTaskSnapshot } from '@/lib/use-dispatcher-task-snapshot'
import {
  buildDispatcherTaskServerFilters,
} from '@/lib/dispatcher-task-row-codes'
import { useDispatcherAcceptedWarnings } from '@/lib/use-dispatcher-accepted-warnings'
import { useDispatcherTaskUiState } from '@/lib/use-dispatcher-task-ui-state'
import { prepareReportRows, useReportRows } from '@/lib/use-report-rows'
import { useWeldPageQuery } from '@/lib/use-weld-page-query'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { usePreparedReportRows } from '@/lib/use-prepared-report-rows'
import { useReportRequestDerivedState } from '@/lib/use-report-request-derived-state'
import { useActiveReportLayoutState } from '@/lib/use-active-report-layout-state'
import { usePstoResultDerivedState } from '@/lib/use-psto-result-derived-state'
import { hasPstoResultData } from '@/lib/psto-result-derived-utils'
import { buildManagedPstoDiagramDrafts } from '@/lib/psto-report-action-utils'
import { useLnkResultDerivedState } from '@/lib/use-lnk-result-derived-state'
import { useManagedLnkResultDerivedState } from '@/lib/use-managed-lnk-result-derived-state'
import { useLnkOfficialityDerivedState } from '@/lib/use-lnk-officiality-derived-state'
import { useJointChainActions } from '@/lib/use-joint-chain-actions'
import type { JointNextAction } from '@/lib/joint-next-actions'
import type {
  DispatcherTaskActionId,
  DispatcherTaskActionSpec,
} from '@/lib/dispatcher-task-actions-model'
import { isUnofficialJoint } from '@/lib/joint-display'
import { useLnkOfficialityActions } from '@/lib/use-lnk-officiality-actions'
import { useLnkRequestActions } from '@/lib/use-lnk-request-actions'
import type { LnkRequestComposerMode } from '@/lib/use-lnk-request-modal-state'
import { useLnkResultActions } from '@/lib/use-lnk-result-actions'
import { useLnkResultSaveActions } from '@/lib/use-lnk-result-save-actions'
import { useReportEditActions } from '@/lib/use-report-edit-actions'
import { useManagedLnkRequestActions } from '@/lib/use-managed-lnk-request-actions'
import { useManagedLnkResultActions } from '@/lib/use-managed-lnk-result-actions'
import { useHomeDocumentController } from '@/lib/use-home-document-controller'
import { getDocumentNavigationReferenceForField } from '@/lib/document-navigation'
import { useHomeLnkController } from '@/lib/use-home-lnk-controller'
import { useHomePstoController } from '@/lib/use-home-psto-controller'
import { useHomeWeldEditorController } from '@/lib/use-home-weld-editor-controller'
import { useReportFilterState } from '@/lib/use-report-filter-state'
import { useReportSelectionState } from '@/lib/use-report-selection-state'
import { useReportNavigationContext } from '@/lib/use-report-navigation-context'
import { useReportSortState } from '@/lib/use-report-sort-state'
import { useReportShowMenuState } from '@/lib/use-report-show-menu-state'
import { useReportPageUiState } from '@/lib/use-report-page-ui-state'
import { useReportImportMutations } from '@/lib/use-report-import-mutations'
import { useReportChangeActions } from '@/lib/use-report-change-actions'
import { usePstoReportMutations } from '@/lib/use-psto-report-mutations'
import { usePstoReportActions } from '@/lib/use-psto-report-actions'
import { useLnkReportMutations } from '@/lib/use-lnk-report-mutations'
import { useRepeatedJointTaskActions } from '@/lib/use-repeated-joint-task-actions'
import { useConfirmAction } from '@/lib/confirm-action-context'
import { useSecurityGuard } from '@/lib/security-context'
import { createDispatcherTaskCardHandlers } from '@/lib/dispatcher-task-card-props'
import { createReportRowActionHandlers } from '@/lib/report-row-action-handlers'
import { createWeldTableProps } from '@/lib/weld-table-props'
import { createWelderStampsRegistryProps } from '@/lib/welder-stamps-registry-props'
import { createReportHeaderActionsProps } from '@/lib/report-header-actions-props'
import { createReportSummaryBarProps } from '@/lib/report-summary-props'
import { createReportTaskPanelsProps } from '@/lib/report-task-panels-props'
import { getPageScrollPosition } from '@/lib/page-scroll-position'
import { createReportChainDialogProps } from '@/lib/report-chain-dialog-props'
import { createReportWeldEditorProps } from '@/lib/report-weld-editor-props'
import { createReportFieldEditorProps } from '@/lib/report-field-editor-props'
import { createReportPstoDialogsProps } from '@/lib/report-psto-dialog-props'
import { createReportLnkDialogsProps } from '@/lib/report-lnk-dialog-props'
import {
  useWeldFinalStatusContextQuery,
} from '@/lib/use-welds-query'
import {
  useLnkWorkflowRequestSummaryQuery,
  useLnkWorkflowRowsQuery,
  useLnkWorkflowSummaryQuery,
} from '@/lib/use-lnk-workflow-context-query'
import {
  usePstoWorkflowRequestOptionsQuery,
  usePstoWorkflowRowsQuery,
  usePstoWorkflowSummaryQuery,
} from '@/lib/use-psto-workflow-context-query'
import {
  getLnkWorkflowRowsRequest as buildLnkWorkflowRowsRequest,
  shouldLoadLnkWorkflowRequestSummary,
  shouldLoadLnkWorkflowSummary,
} from '@/lib/lnk-workflow-context'
import {
  getPstoWorkflowRowsRequest as buildPstoWorkflowRowsRequest,
  shouldLoadPstoWorkflowSummary,
} from '@/lib/psto-workflow-context'
import { useDuplicateControls } from '@/lib/use-duplicate-controls'
import {
  useDuplicateControlCandidates,
  useDuplicateControlRowsByIds,
} from '@/lib/use-duplicate-control-candidates'
import type { ContextActionMenuItem } from '@/components/context-action-menu'
import {
  invalidateWeldJoints,
  WELD_FINAL_STATUS_CONTEXT_QUERY_KEY,
} from '@/lib/weld-query-utils'
import { getReportModalOpenState } from '@/lib/report-modal-open-state'
import {
  getLnkRequestIdentityForField,
  getLnkRequestNavigationEntries,
} from '@/lib/lnk-request-navigation'
import {
  getLnkResultMethodForField,
  getLnkResultNavigationEntries,
  getLnkResultNavigationEntry,
  getLnkResultNavigationEntryForField,
  getPendingLnkResultMethods,
} from '@/lib/lnk-result-navigation'
import { getManagedLnkResultChangeKey } from '@/lib/lnk-result-draft'
import { LNK_METHODS } from '@/lib/report-config'
import type {
  WorkflowRootCauseAction,
  WorkflowRootCauseTarget,
} from '@/lib/workflow-root-cause-actions'
import {
  getCurrentWorkflowRequestIdentity,
  getWorkflowRootCauseDestination,
  type WorkflowRootCauseDestination,
} from '@/lib/workflow-root-cause-navigation'
import { getLnkRepairResultSaveReason, isLnkRepairForbidden } from '@/lib/lnk-result-rules'
import { isFinalLnkResultValue } from '@/lib/lnk-status'
import { filterWeldRowsByColumns } from '@/lib/weld-table-filtering'
import { splitReportQuickSearch } from '@/lib/report-quick-search'
import { buildHeatTreatmentReportRows, buildLnkReportRows, sumAcceptedWdi } from '@/lib/report-row-utils'
import type { ReportImportRecord } from '@/lib/report-import-preview'
import type { WeldRowVersionTarget } from '@/lib/weld-row-version'
import {
  type FinalStatusRowsContext,
  type WeldFieldKey,
  type WeldInput,
} from '@/lib/weld-fields'
import {
  createDefaultLnkRequestDraft,
  createDefaultLnkResultDraft,
  createDefaultPstoResultDraft,
} from '@/lib/report-draft-state'
import {
  canAddPstoWorkflowResult,
  canCreatePstoWorkflowRequest,
} from '@/lib/psto-status'
import { canAddTvmtResult, canCreateTvmtRequest } from '@/lib/tvmt-field-updates'
import {
  canAddPreHeatTreatmentResult,
  canCreatePreHeatTreatmentRequest,
  PRE_HEAT_TREATMENT_RESULT_OPTIONS,
} from '@/lib/pre-heat-treatment-control-updates'
import {
  canCreateLnkWorkflowRequest,
  getCommonLnkRequestStage,
  getCommonLnkResultStage,
  getPreferredLnkRequestStage,
  getPreferredLnkResultStage,
} from '@/lib/lnk-workflow-routing'
import { buildWorkflowContextMenuItems } from '@/lib/workflow-context-menu-items'
import { buildPstoCycleHistoryContextMenuItem } from '@/lib/psto-report-context-menu'
import {
  getPreHeatTreatmentControl,
  getPreHeatTreatmentControls,
  isPreHeatTreatmentLnkMethodCode,
  PRE_HEAT_TREATMENT_LNK_CONTROL_STAGE,
  PRE_HEAT_TREATMENT_LNK_METHODS,
  type LnkControlStage,
  type PreHeatTreatmentControlRecord,
  type PreHeatTreatmentLnkMethodCode,
} from '@/lib/lnk-control-stage'
import {
  getPreHeatTreatmentReportField,
  PRE_HEAT_TREATMENT_REPORT_FIELD_KEYS,
} from '@/lib/pre-heat-treatment-report-fields'
import { usePreHeatTreatmentResultCorrectionMutation } from '@/lib/use-pre-heat-treatment-result-correction-mutation'
import {
  usePstoCycleCorrectionMutation,
  usePstoTvmtCorrectionWithLaterCycleRemovalMutation,
} from '@/lib/use-psto-cycle-correction-mutation'
import {
  getPstoCycleStageInlineLabel,
  getPstoCycleStageLabel,
} from '@/lib/psto-cycle-corrections'
import {
  getCurrentPstoCycle,
} from '@/lib/tvmt-cycle'
import { withOfficialJoint } from '@/lib/report-control-state'
import { getLnkRowRequestNames } from '@/lib/report-modal-rows'
import {
  getLnkRequestDocumentIdentities,
  getPstoRequestDocumentIdentities,
  type RequestDocumentIdentity,
} from '@/lib/request-document-identity'
import {
  getArchivedOfficialStampValuesForRecord,
  getOfficialStampCompatibilitySaveBlockReason,
  shouldValidateOfficialStampCompatibilityForSave,
} from '@/lib/welder-stamp-compatibility'
import { useOtherSettings } from '@/lib/other-settings'
import { useControlProcessSettings } from '@/lib/control-process-settings'
import { getLnkVisibleFieldSections } from '@/lib/lnk-visible-field-layout'
import { formatSaveCheckBlockReason, useSaveCheckSettings, type SaveCheckSettings } from '@/lib/save-check-settings'
import { useSystemIndexSettings, type SystemIndexSettings } from '@/lib/system-index-settings'
import { useWeldJournalMutations } from '@/lib/use-weld-journal-mutations'
import {
  buildLineFilters,
  buildExactJointFilters,
  buildPercentageLineStampFilters,
  buildRowIdListFilters,
  followUpdatedWeldRowFilters,
  type PercentageLineStampFilter,
} from '@/lib/report-navigation'
import {
  consumeJournalSelectionHandoff,
  openJournalSelectionInNewTab,
  removeJournalSelectionTokenFromCurrentUrl,
} from '@/lib/journal-selection-handoff'
import {
  isPercentageControlMethodAvailableForRow,
  type PercentageControlMethod,
} from '@/lib/percentage-line-summary'
import type { PercentageLineControlScope } from '@/lib/percentage-line-control-update'
import type {
  PercentageLineNavigationOutcome,
  PercentageLineNavigationRequest,
} from '@/lib/percentage-line-navigation'
import { createEmptyWelderStampFilters } from '@/lib/welder-stamp-filters'
import {
  findOfficialWeldRowStampField,
  getOfficialWeldRowStamps,
} from '@/lib/weld-row-stamps'
import {
  createEmptyDuplicateControlDraft,
  DUPLICATE_CONTROL_MASS_SELECTION_ERROR,
  DUPLICATE_CONTROL_MASS_SELECTION_LIMIT,
  type DuplicateControlDraft,
  type DuplicateControlMethod,
  type DuplicateControlRecord,
  type DuplicateControlRegistryRecord,
} from '@/lib/duplicate-control-types'
import { getDuplicateControls } from '@/lib/duplicate-control-utils'
import {
  getDefaultNamingState,
  useRequestConclusionSettings,
} from '@/lib/request-conclusion-settings'
import {
  getWeldJointById,
  listWeldFinalStatusContextKeys,
  listWeldJointRowsByIds,
  listWeldingJournalPage,
  WELD_PAGE_ALL_SIZE,
} from '@/server/weld-read-api'
import {
  WORKFLOW_REGISTRY_MAX_LOADED_ROWS,
  WORKFLOW_REGISTRY_PAGE_SIZE,
} from '@/server/weld-contracts'
import { updatePercentageLineControls } from '@/server/weld-mutations-api'
import { listDuplicateControlCandidateIds } from '@/server/duplicate-controls'
import { GENERATED_DOCUMENT_STORAGE_EVENT } from '@/lib/document-storage-events'
import { useSystemDocumentTemplateAvailability } from '@/lib/use-system-document-template-availability'
import { getSystemDocumentTemplateIdForField } from '@/lib/system-document-template-types'
import { useRkExposureMutation } from '@/lib/use-rk-exposure-mutation'
import {
  getSystemDocumentReferenceForField,
  type SystemDocumentReference,
} from '@/lib/system-document-types'

type UseHomePageControllerOptions = {
  activeReport?: ActiveReport
  onActiveReportChange?: (report: ActiveReport) => void
  journalSelectionToken?: string
}

type DeferredJointNextAction = {
  targetReport: 'weldingJournal' | 'lnk' | 'heatTreatment'
  row: WeldRow
} & ({
  kind: 'joint-action'
  action: JointNextAction
  runDispatcherAction?: boolean
} | { kind: 'psto-program' })

type WorkflowRootCauseNavigationFrame = {
  action: WorkflowRootCauseAction
  destination: WorkflowRootCauseDestination
  restore: () => void
}

export function useHomePageController(options: UseHomePageControllerOptions = {}) {
  const queryClient = useQueryClient()
  const saveCheckSettings = useSaveCheckSettings()
  const otherSettings = useOtherSettings()
  const controlProcessSettings = useControlProcessSettings()
  const systemIndexSettings = useSystemIndexSettings()
  const lnkSectionLayout = useMemo(
    () => getLnkVisibleFieldSections(controlProcessSettings),
    [controlProcessSettings.layeredControlEnabled, controlProcessSettings.preHeatTreatmentLnkEnabled],
  )
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false)
  const [isDispatcherWorkspaceOpen, setIsDispatcherWorkspaceOpen] = useState(false)
  const [isDuplicateControlRegistryOpen, setIsDuplicateControlRegistryOpen] = useState(false)
  const [isSelectingDuplicateControlRows, setIsSelectingDuplicateControlRows] = useState(false)
  const [lnkStageTransferReference, setLnkStageTransferReference] = useState<
    (SystemDocumentReference & { documentId: number }) | null
  >(null)
  const [isLnkStageTransferPending, setIsLnkStageTransferPending] = useState(false)
  const [lnkWorkflowRequestSearch, setLnkWorkflowRequestSearch] = useState('')
  const [lnkResultRegistrySearch, setLnkResultRegistrySearch] = useState('')
  const [lnkResultRegistryFilter, setLnkResultRegistryFilter] =
    useState<'all' | 'годен' | 'ремонт' | 'вырез'>('all')
  const [lnkResultRegistryLimit, setLnkResultRegistryLimit] = useState(WORKFLOW_REGISTRY_PAGE_SIZE)
  const [pstoResultRegistrySearch, setPstoResultRegistrySearch] = useState('')
  const [pstoResultRegistryLimit, setPstoResultRegistryLimit] = useState(WORKFLOW_REGISTRY_PAGE_SIZE)
  const [pstoWorkflowRequestSearch, setPstoWorkflowRequestSearch] = useState('')
  const [preHeatTreatmentCandidateSearch, setPreHeatTreatmentCandidateSearch] = useState('')
  const [preHeatTreatmentCandidateIds, setPreHeatTreatmentCandidateIds] = useState<number[] | null>(null)
  const [pstoRepeatCandidateIds, setPstoRepeatCandidateIds] = useState<number[] | null>(null)
  const [tvmtCandidateIds, setTvmtCandidateIds] = useState<number[] | null>(null)
  const [preHeatTreatmentCandidateFilter, setPreHeatTreatmentCandidateFilter] = useState<{
    methodKeys: WeldFieldKey[]
    requestName: string
    requestDate: string
  }>({ methodKeys: [], requestName: '', requestDate: '' })
  const [pstoRepeatCandidateSearch, setPstoRepeatCandidateSearch] = useState('')
  const [tvmtCandidateSearch, setTvmtCandidateSearch] = useState('')
  const [pstoRepeatCandidateRequest, setPstoRepeatCandidateRequest] = useState({ name: '', date: '' })
  const [tvmtCandidateRequest, setTvmtCandidateRequest] = useState({ name: '', date: '' })
  const handlePstoRepeatCandidateRequestChange = useCallback((request: RequestDocumentIdentity | null) => {
    const name = request?.name ?? ''
    const date = request?.date ?? ''
    setPstoRepeatCandidateRequest((current) => (
      current.name === name && current.date === date ? current : { name, date }
    ))
  }, [])
  const handleTvmtCandidateRequestChange = useCallback((request: RequestDocumentIdentity | null) => {
    const name = request?.name ?? ''
    const date = request?.date ?? ''
    setTvmtCandidateRequest((current) => (
      current.name === name && current.date === date ? current : { name, date }
    ))
  }, [])
  const handlePreHeatTreatmentCandidateFilterChange = useCallback((filter: {
    methodCodes: PreHeatTreatmentLnkMethodCode[]
    request: RequestDocumentIdentity | null
  }) => {
    const methodKeys = filter.methodCodes.flatMap((methodCode) => {
      const method = LNK_METHODS.find((candidate) => candidate.code === methodCode)
      return method ? [method.requestKey] : []
    })
    const requestName = filter.request?.name ?? ''
    const requestDate = filter.request?.date ?? ''
    setPreHeatTreatmentCandidateFilter((current) => (
      current.requestName === requestName &&
      current.requestDate === requestDate &&
      current.methodKeys.length === methodKeys.length &&
      current.methodKeys.every((key, index) => key === methodKeys[index])
        ? current
        : { methodKeys, requestName, requestDate }
    ))
  }, [])
  const [percentageLineNavigationRequest, setPercentageLineNavigationRequest] =
    useState<PercentageLineNavigationRequest | null>(null)
  const percentageLineNavigationRequestIdRef = useRef(0)
  const lnkController = useHomeLnkController()
  const pstoController = useHomePstoController()
  const weldEditorController = useHomeWeldEditorController()
  const {
    isLnkWorkflowMenuOpen,
    setIsLnkWorkflowMenuOpen,
    preHeatTreatmentLnkWorkflowMode,
    setPreHeatTreatmentLnkWorkflowMode,
    preHeatTreatmentLnkInitialMethodCode,
    setPreHeatTreatmentLnkInitialMethodCode,
    preHeatTreatmentLnkRequestSubmitMode,
    isPreHeatTreatmentResultManagerOpen,
    setIsPreHeatTreatmentResultManagerOpen,
    preHeatTreatmentResultManagerRowIds,
    setPreHeatTreatmentResultManagerRowIds,
    preHeatTreatmentResultManagerInitialRelationId,
    setPreHeatTreatmentResultManagerInitialRelationId,
    preHeatTreatmentResultManagerMode,
    setPreHeatTreatmentResultManagerMode,
    isDuplicateControlModalOpen,
    setIsDuplicateControlModalOpen,
    duplicateControlDraft,
    setDuplicateControlDraft,
    openPreHeatTreatmentResultRegistry,
    closePreHeatTreatmentResultRegistry: closePreHeatTreatmentResultRegistryState,
    openPreHeatTreatmentLnkWorkflow: openPreHeatTreatmentLnkWorkflowState,
  } = lnkController
  const {
    isPstoResultRegistryAll,
    setIsPstoResultRegistryAll,
    pstoResultRegistryInitializedRef,
    tvmtWorkflowMode,
    setTvmtWorkflowMode,
    pstoRepeatWorkflowMode,
    setPstoRepeatWorkflowMode,
    isPstoLineProgramOpen,
    setIsPstoLineProgramOpen,
    isPstoWorkflowMenuOpen,
    setIsPstoWorkflowMenuOpen,
    openTvmtWorkflow,
    openPstoRepeatWorkflow,
    openPstoLineProgram,
  } = pstoController
  const {
    editing,
    setEditing,
    heatTreatmentFieldEditing,
    setHeatTreatmentFieldEditing,
    rkExposureEditing,
    setRkExposureEditing,
    pstoLineMoveDraftState,
    pstoLineMoveDraftStateRef,
    commitPstoLineMoveDraftState,
    resetPstoLineMoveDraftState,
    checkEditedWeldLineMove,
    getPstoLineMoveSaveBlockReason,
    pstoLineMovePreSaveDecision,
    getPstoLineMoveSaveData,
    confirmPstoLineMove,
  } = weldEditorController
  const [welderStampSuspensionEditorOpenSignal, setWelderStampSuspensionEditorOpenSignal] = useState(0)
  const confirmAction = useConfirmAction()
  const {
    requireEditPassword,
    requireImportPassword,
    requireDeletePassword,
  } = useSecurityGuard()
  const {
    activeReport,
    columnFilters,
    heatTreatmentFilters,
    lnkFilters,
    navCollapsed,
    setActiveReport,
    setColumnFilters,
    setHeatTreatmentFilters,
    setLnkFilters,
    setNavCollapsed,
  } = useReportFilterState(options)
  const availableSystemDocumentTypes = useSystemDocumentTemplateAvailability({
    enabled: activeReport === 'lnk' || activeReport === 'heatTreatment',
  })
  const {
    chainRecord,
    chainPictureIntent,
    documentsPageType,
    message,
    lnkNotice,
    setChainRecord,
    openChainPicture,
    setDocumentsPageType,
    setMessage,
    setLnkNotice,
  } = useReportPageUiState()
  const dismissMessage = useCallback(() => setMessage(null), [setMessage])
  const dismissLnkNotice = useCallback(() => setLnkNotice(null), [setLnkNotice])
  const openPreHeatTreatmentLnkWorkflow = useCallback(
    (...args: Parameters<typeof openPreHeatTreatmentLnkWorkflowState>) => {
      if (!controlProcessSettings.preHeatTreatmentLnkEnabled) {
        setMessage('НК до ТО выключен в настройках проекта. Существующая история доступна только для просмотра.')
        return
      }
      openPreHeatTreatmentLnkWorkflowState(...args)
    },
    [controlProcessSettings.preHeatTreatmentLnkEnabled, openPreHeatTreatmentLnkWorkflowState, setMessage],
  )
  useEffect(() => {
    if (!controlProcessSettings.preHeatTreatmentLnkEnabled) {
      setPreHeatTreatmentLnkWorkflowMode(null)
      setPreHeatTreatmentLnkInitialMethodCode(undefined)
    }
  }, [
    controlProcessSettings.preHeatTreatmentLnkEnabled,
    setPreHeatTreatmentLnkInitialMethodCode,
    setPreHeatTreatmentLnkWorkflowMode,
  ])
  const {
    highlightedRowIds,
    highlightedCellKeys,
    highlightChangedRows,
    replayLatestHighlight,
  } = useReportHighlights()
  const rkExposureMutation = useRkExposureMutation({
    setMessage,
    setEditing: setRkExposureEditing,
    highlightChangedRows,
  })
  const preHeatTreatmentResultCorrectionMutation = usePreHeatTreatmentResultCorrectionMutation({
    setMessage,
    onSaved: (row) => {
      highlightChangedRows([row], PRE_HEAT_TREATMENT_REPORT_FIELD_KEYS)
      completeWorkflowRootCause('pre-lnk-manager')
    },
  })
  const pstoCycleCorrectionMutation = usePstoCycleCorrectionMutation({
    setMessage,
    onSaved: (row) => {
      highlightChangedRows([row], [
        'pstoRequest',
        'pstoRequestDate',
        'pstoDate',
        'pstoResult',
        'heatTreatmentDiagram',
        'tvmtRequest',
        'tvmtRequestDate',
        'tvmtResult',
        'tvmtConclusionDate',
        'tvmtConclusion',
        'finalStatus',
      ])
      completeWorkflowRootCause('psto-result-manager')
    },
  })
  const pstoTvmtCorrectionWithLaterCycleRemovalMutation = usePstoTvmtCorrectionWithLaterCycleRemovalMutation({
    setMessage,
    onSaved: (row) => {
      highlightChangedRows([row], [
        'pstoRequest',
        'pstoRequestDate',
        'pstoDate',
        'pstoResult',
        'heatTreatmentDiagram',
        'tvmtRequest',
        'tvmtRequestDate',
        'tvmtResult',
        'tvmtConclusionDate',
        'tvmtConclusion',
        'finalStatus',
      ])
      completeWorkflowRootCause('psto-result-manager')
    },
  })
  const {
    selectionWarning,
    dismissSelectionWarning,
    selectedHeatTreatmentIds,
    selectedLnkIds,
    selectedWeldingJournalIds,
    setSelectedHeatTreatmentIds,
    setSelectedLnkIds,
    setSelectedWeldingJournalIds,
  } = useReportSelectionState()
  const deferredJointNextActionRef = useRef<DeferredJointNextAction | null>(null)
  const workflowRootCauseStackRef = useRef<WorkflowRootCauseNavigationFrame[]>([])
  const [currentWorkflowRootCauseAction, setCurrentWorkflowRootCauseAction] =
    useState<WorkflowRootCauseAction | null>(null)
  const [currentWorkflowRootCauseDestination, setCurrentWorkflowRootCauseDestination] =
    useState<WorkflowRootCauseDestination | null>(null)
  const returnFromWorkflowRootCause = useCallback(() => {
    const frame = workflowRootCauseStackRef.current.pop()
    if (!frame) return
    frame.restore()
    setCurrentWorkflowRootCauseAction(
      workflowRootCauseStackRef.current.at(-1)?.action ?? null,
    )
    setCurrentWorkflowRootCauseDestination(
      workflowRootCauseStackRef.current.at(-1)?.destination ?? null,
    )
  }, [])
  function completeWorkflowRootCause(destination: WorkflowRootCauseDestination) {
    if (workflowRootCauseStackRef.current.at(-1)?.destination !== destination) return
    returnFromWorkflowRootCause()
  }
  useWorkflowRootCauseEscapeKey({
    active: Boolean(currentWorkflowRootCauseAction),
    onReturn: returnFromWorkflowRootCause,
  })
  const consumedJournalSelectionTokenRef = useRef('')
  useEffect(() => {
    const token = options.journalSelectionToken?.trim() ?? ''
    if (activeReport !== 'weldingJournal' || !token || consumedJournalSelectionTokenRef.current === token) return
    consumedJournalSelectionTokenRef.current = token
    try {
      const handoff = consumeJournalSelectionHandoff(window.localStorage, token)
      removeJournalSelectionTokenFromCurrentUrl()
      if (!handoff) {
        setMessage('Не удалось открыть выбранные стыки: ссылка устарела или уже была использована.')
        return
      }
      setColumnFilters(buildRowIdListFilters(handoff.rowIds))
      setSelectedWeldingJournalIds(new Set(handoff.rowIds))
      setMessage(`Показаны стыки из ${handoff.sourceLabel}: ${handoff.rowIds.length}.`)
    } catch {
      removeJournalSelectionTokenFromCurrentUrl()
      setMessage('Браузер не разрешил передать выбранные стыки в новую вкладку.')
    }
  }, [activeReport, options.journalSelectionToken, setColumnFilters, setMessage, setSelectedWeldingJournalIds])
  const {
    lnkRequestDraft,
    lnkRequestNaming,
    isLnkRequestModalOpen,
    isLnkRequestManagerOpen,
    managedLnkRequestName,
    managedLnkRequestDate,
    managedLnkRequestNameDraft,
    lnkRequestSearch,
    lnkRequestComposerMode,
    lnkRequestTargetKey,
    setLnkRequestDraft,
    setLnkRequestNaming,
    setIsLnkRequestModalOpen,
    setIsLnkRequestManagerOpen,
    setManagedLnkRequestName,
    setManagedLnkRequestDate,
    setManagedLnkRequestNameDraft,
    setLnkRequestSearch,
    setLnkRequestComposerMode,
    setLnkRequestTargetKey,
  } = lnkController
  const {
    pstoRequestNaming,
    pstoRequestDate,
    pstoRequestSearch,
    pstoResultRequestSearch,
    isPstoRequestModalOpen,
    isPstoRequestManagerOpen,
    managedPstoRequestName,
    managedPstoRequestDate,
    managedPstoRequestNameDraft,
    isPstoResultModalOpen,
    isPstoResultManagerOpen,
    managedPstoDiagramDrafts,
    pstoResultDraft,
    setPstoRequestNaming,
    setPstoRequestDate,
    setPstoRequestSearch,
    setPstoResultRequestSearch,
    setIsPstoRequestModalOpen,
    setIsPstoRequestManagerOpen,
    setManagedPstoRequestName,
    setManagedPstoRequestDate,
    setManagedPstoRequestNameDraft,
    setIsPstoResultModalOpen,
    setIsPstoResultManagerOpen,
    setManagedPstoDiagramDrafts,
    setPstoResultDraft,
  } = pstoController
  const {
    isLnkResultModalOpen,
    lnkResultDraft,
    isLnkOfficialityModalOpen,
    lnkOfficialityDraft,
    isLnkResultManagerOpen,
    managedLnkResultMethodKey,
    managedLnkConclusionDrafts,
    managedLnkResultOrderIds,
    managedLnkResultTargetKey,
    managedLnkResultChangeHint,
    managedLnkPendingResultChanges,
    preservedLnkOrderIds,
    setIsLnkResultModalOpen,
    setLnkResultDraft,
    setIsLnkOfficialityModalOpen,
    setLnkOfficialityDraft,
    setIsLnkResultManagerOpen,
    setManagedLnkResultMethodKey,
    setManagedLnkConclusionDrafts,
    setManagedLnkResultOrderIds,
    setManagedLnkResultTargetKey,
    setManagedLnkResultChangeHint,
    setManagedLnkPendingResultChanges,
    setPreservedLnkOrderIds,
  } = lnkController
  const debouncedLnkRequestSearch = useDebouncedValue(lnkRequestSearch, 250)
  const debouncedLnkResultSearch = useDebouncedValue(lnkResultDraft.search, 250)
  const debouncedLnkOfficialitySearch = useDebouncedValue(lnkOfficialityDraft.search, 250)
  const debouncedLnkResultRegistrySearch = useDebouncedValue(lnkResultRegistrySearch, 250)
  const debouncedLnkWorkflowRequestSearch = useDebouncedValue(lnkWorkflowRequestSearch, 250)
  const debouncedPstoRequestSearch = useDebouncedValue(pstoRequestSearch, 250)
  const debouncedPstoResultSearch = useDebouncedValue(pstoResultDraft.search, 250)
  const debouncedPstoResultRegistrySearch = useDebouncedValue(pstoResultRegistrySearch, 250)
  const debouncedPstoWorkflowRequestSearch = useDebouncedValue(pstoWorkflowRequestSearch, 250)
  const debouncedPreHeatTreatmentCandidateSearch = useDebouncedValue(preHeatTreatmentCandidateSearch, 250)
  const debouncedPstoRepeatCandidateSearch = useDebouncedValue(pstoRepeatCandidateSearch, 250)
  const debouncedTvmtCandidateSearch = useDebouncedValue(tvmtCandidateSearch, 250)
  const debouncedDuplicateControlSearch = useDebouncedValue(duplicateControlDraft.search, 250)
  const requestConclusionSettings = useRequestConclusionSettings()
  const defaultLnkRequestNaming = useMemo(
    () => getDefaultNamingState(requestConclusionSettings, 'lnkRequest'),
    [requestConclusionSettings],
  )
  const defaultLnkConclusionNaming = useMemo(
    () => getDefaultNamingState(requestConclusionSettings, 'lnkConclusion'),
    [requestConclusionSettings],
  )
  const defaultPstoRequestNaming = useMemo(
    () => getDefaultNamingState(requestConclusionSettings, 'pstoRequest'),
    [requestConclusionSettings],
  )
  const defaultPstoConclusionNaming = useMemo(
    () => getDefaultNamingState(requestConclusionSettings, 'pstoConclusion'),
    [requestConclusionSettings],
  )
  const {
    isPstoShowMenuOpen,
    isLnkShowMenuOpen,
    isWeldingJournalGenerateMenuOpen,
    isWeldingJournalShowMenuOpen,
    setIsPstoShowMenuOpen,
    setIsLnkShowMenuOpen,
    setIsWeldingJournalGenerateMenuOpen,
    setIsWeldingJournalShowMenuOpen,
  } = useReportShowMenuState()
  const {
    dismissedRepeatedJointTaskKeys,
    dismissRepeatedJointTask,
    dismissRepeatedJointTasks,
    isRepeatedJointTaskExpanded,
    resetDismissedRepeatedJointTasks,
    resetExpandedRepeatedJointTasks,
    restoreDismissedRepeatedJointTask,
    setExpandedRepeatedJointTaskKeys,
    toggleRepeatedJointTaskDetails,
  } = useDispatcherTaskUiState()
  const { acceptDispatcherTaskWarning } = useDispatcherAcceptedWarnings({ setMessage })
  const {
    welderStamps,
    welderStampSuspensions,
    welderStampDraft,
    welderStampSuspensionDraft,
    welderStampSearch,
    welderStampFilters,
    editingWelderStampId,
    filteredWelderStamps,
    activeWelderStamps,
    archivedWelderStamps,
    weldFormStampSelectOptions,
    getWeldFormStampSelectOptions,
    setWelderStampSearch,
    setWelderStampFilters,
    updateWelderStampDraft,
    resetWelderStampForm,
    saveWelderStampRecord,
    editWelderStampRecord,
    archiveWelderStampRecord,
    restoreWelderStampRecord,
    setWelderStampPermitArchived,
    deleteWelderStampRecord,
    updateWelderStampSuspensionDraft,
    resetWelderStampSuspensionForm,
    saveWelderStampSuspensionRecord,
    editWelderStampSuspensionRecord,
    deleteWelderStampSuspensionRecord,
  } = useWelderStampRegistryState({
    enabled:
      activeReport === 'weldingJournal' ||
      activeReport === 'heatTreatment' ||
      activeReport === 'lnk' ||
      activeReport === 'welderStamps' ||
      activeReport === 'documents',
    setMessage,
  })
  const {
    documentGenerationRequest,
    generateDocumentForRows,
    handleDocumentGenerationRequest,
    openReportDocument,
    documentNavigationRequest,
    setDocumentNavigationRequest,
    handleDocumentNavigationRequest,
  } = useHomeDocumentController({
    setMessage,
    setGenerationMenuOpen: setIsWeldingJournalGenerateMenuOpen,
    setShowMenuOpen: setIsWeldingJournalShowMenuOpen,
    welderStamps,
  })
  const isReportDataModalOpen = getReportModalOpenState({
      isPstoRequestModalOpen,
      isPstoRequestManagerOpen,
      isPstoResultModalOpen,
      isPstoResultManagerOpen,
      isLnkRequestModalOpen,
      isLnkRequestManagerOpen,
      isLnkResultModalOpen,
      isLnkResultManagerOpen,
      isLnkOfficialityModalOpen,
      isDuplicateControlModalOpen,
    }) || Boolean(tvmtWorkflowMode) || Boolean(pstoRepeatWorkflowMode) || Boolean(preHeatTreatmentLnkWorkflowMode) || isPreHeatTreatmentResultManagerOpen || Boolean(lnkStageTransferReference)
  const isPstoDataModalOpen =
    isPstoRequestModalOpen ||
    isPstoRequestManagerOpen ||
    isPstoResultModalOpen ||
    isPstoResultManagerOpen ||
    Boolean(tvmtWorkflowMode) ||
    Boolean(pstoRepeatWorkflowMode)
  const isReportModalOpen =
    isImportDialogOpen || Boolean(rkExposureEditing) || isReportDataModalOpen || isPstoLineProgramOpen || isDispatcherWorkspaceOpen

  useEffect(() => {
    setIsDispatcherWorkspaceOpen(false)
  }, [activeReport])
  useEffect(() => {
    if (activeReport !== 'heatTreatment' && tvmtWorkflowMode) setTvmtWorkflowMode(null)
    if (activeReport !== 'heatTreatment' && pstoRepeatWorkflowMode) setPstoRepeatWorkflowMode(null)
    if (activeReport !== 'heatTreatment' && isPstoLineProgramOpen) setIsPstoLineProgramOpen(false)
    if (activeReport !== 'lnk' && preHeatTreatmentLnkWorkflowMode) setPreHeatTreatmentLnkWorkflowMode(null)
    if (activeReport !== 'lnk' && isPreHeatTreatmentResultManagerOpen) setIsPreHeatTreatmentResultManagerOpen(false)
    if (activeReport !== 'lnk' && lnkStageTransferReference) setLnkStageTransferReference(null)
  }, [activeReport, isPreHeatTreatmentResultManagerOpen, isPstoLineProgramOpen, lnkStageTransferReference, preHeatTreatmentLnkWorkflowMode, pstoRepeatWorkflowMode, tvmtWorkflowMode])

  useEffect(() => {
    if (!preHeatTreatmentLnkWorkflowMode) {
      setPreHeatTreatmentCandidateSearch('')
      setPreHeatTreatmentCandidateIds(null)
      setPreHeatTreatmentCandidateFilter({ methodKeys: [], requestName: '', requestDate: '' })
    }
    if (!pstoRepeatWorkflowMode) {
      setPstoRepeatCandidateSearch('')
      setPstoRepeatCandidateIds(null)
      setPstoRepeatCandidateRequest({ name: '', date: '' })
    }
    if (!tvmtWorkflowMode) {
      setTvmtCandidateSearch('')
      setTvmtCandidateIds(null)
      setTvmtCandidateRequest({ name: '', date: '' })
    }
  }, [preHeatTreatmentLnkWorkflowMode, pstoRepeatWorkflowMode, tvmtWorkflowMode])

  useEscapeToClearReportFilters({
    activeReport,
    editingOpen: Boolean(editing),
    isReportModalOpen,
    chainOpen: Boolean(chainRecord),
    selectedWeldingJournalIds,
    selectedLnkIds,
    selectedHeatTreatmentIds,
    columnFilters,
    heatTreatmentFilters,
    lnkFilters,
    setSelectedWeldingJournalIds,
    setSelectedLnkIds,
    setSelectedHeatTreatmentIds,
    setColumnFilters,
    setHeatTreatmentFilters,
    setLnkFilters,
  })

  useAutoCollapseNavOnHorizontalScroll(setNavCollapsed)
  useReportSwitchReset({
    activeReport,
    replayLatestHighlight,
    resetWelderStampForm,
    setHeatTreatmentFieldEditing,
    setRkExposureEditing,
    setIsLnkRequestModalOpen,
    setIsLnkResultModalOpen,
    setIsPstoRequestManagerOpen,
    setIsPstoRequestModalOpen,
    setIsPstoResultManagerOpen,
    setIsPstoResultModalOpen,
    setIsPstoShowMenuOpen,
    setLnkRequestDraft,
    setLnkRequestNaming,
    setLnkRequestSearch,
    setLnkResultDraft,
    setManagedPstoDiagramDrafts,
    setManagedPstoRequestName,
    setManagedPstoRequestNameDraft,
    setPreservedLnkOrderIds,
    setPstoRequestNaming,
    setPstoRequestSearch,
    setPstoResultDraft,
    setPstoResultRequestSearch,
    setSelectedHeatTreatmentIds,
    setSelectedLnkIds,
    setWelderStampSearch,
    defaultLnkRequestNaming,
    defaultLnkConclusionNaming,
    defaultPstoRequestNaming,
    defaultPstoConclusionNaming,
  })

  const isServerPagedTab = activeReport === 'weldingJournal' || activeReport === 'lnk' || activeReport === 'heatTreatment'
  const rootCauseLnkRowsRequest = useMemo(() => {
    const target = currentWorkflowRootCauseAction?.target
    if (!target || target.kind !== 'lnk-control') return null
    if (target.stage === 'beforeHeatTreatment') {
      return {
        scope: target.documentPart === 'request'
          ? 'preHeatTreatmentRequestRegistry' as const
          : 'preHeatTreatmentResultRegistry' as const,
        rowIds: [target.rowId],
      }
    }
    if (currentWorkflowRootCauseDestination === 'lnk-request-manager') {
      const requestName = String(target.documentName ?? '').trim()
      return requestName
        ? {
            scope: 'requestRegistry' as const,
            rowIds: null,
            requestName,
            requestDate: String(target.documentDate ?? '').trim(),
          }
        : { scope: 'fieldRows' as const, rowIds: [target.rowId] }
    }
    if (currentWorkflowRootCauseDestination === 'lnk-request-dialog') {
      return { scope: 'requestCandidates' as const, rowIds: null, includeRowIds: [target.rowId] }
    }
    if (currentWorkflowRootCauseDestination === 'lnk-result-dialog') {
      return { scope: 'resultCandidates' as const, rowIds: null, includeRowIds: [target.rowId] }
    }
    return { scope: 'resultRegistry' as const, rowIds: [target.rowId] }
  }, [currentWorkflowRootCauseAction, currentWorkflowRootCauseDestination])
  const lnkWorkflowRowsRequest = useMemo(
    () => rootCauseLnkRowsRequest ?? buildLnkWorkflowRowsRequest({
      shouldLoadFullWeldRows: false,
      isLnkRequestModalOpen,
      isLnkRequestManagerOpen,
      isLnkResultModalOpen,
      isLnkResultManagerOpen,
      isLnkOfficialityModalOpen,
      preHeatTreatmentLnkWorkflowMode,
      isPreHeatTreatmentResultManagerOpen,
      preHeatTreatmentResultManagerMode,
      managedLnkResultOrderIds,
      preHeatTreatmentResultManagerRowIds,
      fieldEditingRowId: heatTreatmentFieldEditing?.report === 'lnk'
        ? heatTreatmentFieldEditing.record.id
        : null,
      managedLnkRequestName,
      managedLnkRequestDate,
      requestCandidateRowIds: [...selectedLnkIds],
      requestCandidateSearch: debouncedLnkRequestSearch,
      requestCandidateMethodKeys: [...lnkRequestDraft.methods],
      resultCandidateRowIds: [...lnkResultDraft.rowIds],
      resultCandidateSearch: debouncedLnkResultSearch,
      resultCandidateMethodKey: lnkResultDraft.methodKey,
      resultCandidateRequestName: lnkResultDraft.requestName,
      resultCandidateRequestDate: lnkResultDraft.requestDate,
      allowPrimaryBeforePreviousStagesComplete:
        controlProcessSettings.allowPrimaryLnkBeforePreviousStagesComplete,
      officialityCandidateRowIds: [...lnkOfficialityDraft.rowIds],
      officialityCandidateSearch: debouncedLnkOfficialitySearch,
      otherCandidateRowIds: preHeatTreatmentCandidateIds ?? [...selectedLnkIds],
      otherCandidateSearch: debouncedPreHeatTreatmentCandidateSearch,
      otherCandidateMethodKeys: preHeatTreatmentCandidateFilter.methodKeys,
      otherCandidateRequestName: preHeatTreatmentCandidateFilter.requestName,
      otherCandidateRequestDate: preHeatTreatmentCandidateFilter.requestDate,
      resultRegistrySearch: debouncedLnkResultRegistrySearch,
      resultRegistryFilter: lnkResultRegistryFilter,
      resultRegistryLimit: lnkResultRegistryLimit,
    }),
    [
      isLnkOfficialityModalOpen,
      isLnkRequestManagerOpen,
      isLnkRequestModalOpen,
      isLnkResultManagerOpen,
      isLnkResultModalOpen,
      isPreHeatTreatmentResultManagerOpen,
      heatTreatmentFieldEditing,
      managedLnkResultOrderIds,
      managedLnkRequestDate,
      managedLnkRequestName,
      lnkOfficialityDraft.rowIds,
      debouncedLnkOfficialitySearch,
      debouncedLnkRequestSearch,
      debouncedLnkResultRegistrySearch,
      debouncedLnkResultSearch,
      debouncedPreHeatTreatmentCandidateSearch,
      lnkResultDraft.rowIds,
      lnkResultDraft.methodKey,
      lnkResultDraft.requestDate,
      lnkResultDraft.requestName,
      lnkRequestDraft.methods,
      lnkResultRegistryFilter,
      lnkResultRegistryLimit,
      preHeatTreatmentLnkWorkflowMode,
      preHeatTreatmentCandidateFilter,
      preHeatTreatmentCandidateIds,
      preHeatTreatmentResultManagerMode,
      preHeatTreatmentResultManagerRowIds,
      rootCauseLnkRowsRequest,
      selectedLnkIds,
      controlProcessSettings.allowPrimaryLnkBeforePreviousStagesComplete,
    ],
  )
  const pstoWorkflowRowsRequest = useMemo(
    () => buildPstoWorkflowRowsRequest({
      shouldLoadFullWeldRows: false,
      isPstoRequestModalOpen,
      isPstoRequestManagerOpen,
      isPstoResultModalOpen,
      isPstoResultManagerOpen,
      tvmtWorkflowMode,
      pstoRepeatWorkflowMode,
      fieldEditingRowId: heatTreatmentFieldEditing && heatTreatmentFieldEditing.report !== 'lnk'
        ? heatTreatmentFieldEditing.record.id
        : null,
      resultManagerRowIds: [...pstoResultDraft.rowIds],
      resultRegistryAll: isPstoResultRegistryAll,
      resultRegistrySearch: debouncedPstoResultRegistrySearch,
      resultRegistryLimit: pstoResultRegistryLimit,
      managedRequestName: managedPstoRequestName,
      managedRequestDate: managedPstoRequestDate,
      requestCandidateRowIds: [...selectedHeatTreatmentIds],
      requestCandidateSearch: debouncedPstoRequestSearch,
      resultCandidateRowIds: [...pstoResultDraft.rowIds],
      resultCandidateSearch: debouncedPstoResultSearch,
      resultCandidateRequestName: pstoResultDraft.requestName,
      resultCandidateRequestDate: pstoResultDraft.requestDate,
      otherCandidateRowIds: (pstoRepeatWorkflowMode ? pstoRepeatCandidateIds : tvmtCandidateIds)
        ?? [...selectedHeatTreatmentIds],
      repeatCandidateSearch: debouncedPstoRepeatCandidateSearch,
      tvmtCandidateSearch: debouncedTvmtCandidateSearch,
      repeatCandidateRequestName: pstoRepeatCandidateRequest.name,
      repeatCandidateRequestDate: pstoRepeatCandidateRequest.date,
      tvmtCandidateRequestName: tvmtCandidateRequest.name,
      tvmtCandidateRequestDate: tvmtCandidateRequest.date,
    }),
    [
      heatTreatmentFieldEditing,
      isPstoRequestManagerOpen,
      isPstoRequestModalOpen,
      isPstoResultManagerOpen,
      isPstoResultModalOpen,
      isPstoResultRegistryAll,
      managedPstoRequestDate,
      managedPstoRequestName,
      debouncedPstoRequestSearch,
      debouncedPstoRepeatCandidateSearch,
      debouncedPstoResultRegistrySearch,
      debouncedPstoResultSearch,
      debouncedTvmtCandidateSearch,
      pstoRepeatWorkflowMode,
      pstoRepeatCandidateRequest,
      pstoRepeatCandidateIds,
      pstoResultDraft.rowIds,
      pstoResultDraft.requestDate,
      pstoResultDraft.requestName,
      pstoResultRegistryLimit,
      selectedHeatTreatmentIds,
      tvmtWorkflowMode,
      tvmtCandidateRequest,
      tvmtCandidateIds,
    ],
  )
  const lnkWorkflowSummaryQuery = useLnkWorkflowSummaryQuery({
    enabled: shouldLoadLnkWorkflowSummary({
      isLnkReportActive: activeReport === 'lnk',
      shouldLoadFullWeldRows: false,
      isLnkWorkflowMenuOpen,
    }),
  })
  const lnkWorkflowRequestSummaryQuery = useLnkWorkflowRequestSummaryQuery({
    enabled: shouldLoadLnkWorkflowRequestSummary({
      isLnkReportActive: activeReport === 'lnk',
      shouldLoadFullWeldRows: false,
      isLnkRequestModalOpen,
      isLnkRequestManagerOpen,
      isLnkFieldEditing: heatTreatmentFieldEditing?.report === 'lnk',
    }),
    search: debouncedLnkWorkflowRequestSearch,
  })
  const lnkWorkflowRowsQuery = useLnkWorkflowRowsQuery({ request: lnkWorkflowRowsRequest })
  const pstoWorkflowSummaryQuery = usePstoWorkflowSummaryQuery({
    enabled: shouldLoadPstoWorkflowSummary({
      isPstoReportActive: activeReport === 'heatTreatment',
      shouldLoadFullWeldRows: false,
      isPstoWorkflowMenuOpen,
    }),
  })
  const pstoWorkflowRequestOptionsQuery = usePstoWorkflowRequestOptionsQuery({
    enabled: isPstoRequestModalOpen || isPstoRequestManagerOpen,
    search: debouncedPstoWorkflowRequestSearch,
  })
  const pstoWorkflowRowsQuery = usePstoWorkflowRowsQuery({ request: pstoWorkflowRowsRequest })
  const finalStatusContextQuery = useWeldFinalStatusContextQuery({
    enabled:
      isServerPagedTab &&
      (
        lnkWorkflowRowsRequest !== null ||
        pstoWorkflowRowsRequest !== null ||
        documentGenerationRequest !== null
      ),
  })
  const remoteFinalStatusContext = useMemo(
    () => ({
      rejectedUnofficialSameNameRepairKeys: new Set(finalStatusContextQuery.data ?? []),
    }),
    [finalStatusContextQuery.data],
  )
  const isRemoteFinalStatusContextReady = finalStatusContextQuery.data !== undefined
  const duplicateControlCandidates = useDuplicateControlCandidates({
    enabled: isDuplicateControlModalOpen,
    search: debouncedDuplicateControlSearch,
  })
  const duplicateControlCandidateRowsById = useMemo(
    () => new Map(duplicateControlCandidates.rows.map((row) => [row.id, row])),
    [duplicateControlCandidates.rows],
  )
  const missingSelectedDuplicateControlRowIds = useMemo(
    () => [...duplicateControlDraft.rowIds].filter((id) => !duplicateControlCandidateRowsById.has(id)),
    [duplicateControlCandidateRowsById, duplicateControlDraft.rowIds],
  )
  const selectedDuplicateControlRowsQuery = useDuplicateControlRowsByIds(
    missingSelectedDuplicateControlRowIds,
    { enabled: isDuplicateControlModalOpen && duplicateControlCandidates.isReady },
  )
  const {
    duplicateControls,
    duplicateControlCount,
    duplicateControlRegistryFirstItemNumber,
    duplicateControlRegistryLastItemNumber,
    duplicateControlRegistryPageSize,
    duplicateControlRegistryHasMore,
    duplicateControlRegistryLoading,
    duplicateControlRegistryFetching,
    duplicateControlRegistryReady,
    duplicateControlRegistryError,
    loadMoreDuplicateControls,
    setDuplicateControlPageSize,
    saveDuplicateControlMutation,
    deleteDuplicateControlMutation,
  } = useDuplicateControls({
    registryEnabled:
      isDuplicateControlModalOpen &&
      isDuplicateControlRegistryOpen &&
      duplicateControlDraft.rowIds.size === 0,
  })

  const reportContextSourceRows = useMemo(() => {
    const rowsById = new Map<number, WeldRow>()
    const contextRows = [
      ...(lnkWorkflowRowsRequest ? lnkWorkflowRowsQuery.data ?? [] : []),
      ...(pstoWorkflowRowsRequest ? pstoWorkflowRowsQuery.data ?? [] : []),
    ]
    for (const row of contextRows) {
      rowsById.set(Number(row.id), row)
    }
    return [...rowsById.values()]
  }, [
    lnkWorkflowRowsQuery.data,
    lnkWorkflowRowsRequest,
    pstoWorkflowRowsQuery.data,
    pstoWorkflowRowsRequest,
  ])
  const rows = useReportRows(
    reportContextSourceRows,
    [],
    undefined,
    remoteFinalStatusContext,
    otherSettings,
  )
  const isLnkRowsContextReady = isRemoteFinalStatusContextReady &&
    lnkWorkflowRowsRequest !== null &&
    lnkWorkflowRowsQuery.data !== undefined
  const isPstoRowsContextReady = pstoWorkflowRowsRequest !== null &&
    pstoWorkflowRowsQuery.data !== undefined &&
    isRemoteFinalStatusContextReady
  const dispatcherTaskSnapshot = useDispatcherTaskSnapshot({
    dismissedRepeatedJointTaskKeys,
    enabled: isServerPagedTab || activeReport === 'welderStamps' || Boolean(chainRecord),
  })
  const tableDuplicateKeys = isServerPagedTab && dispatcherTaskSnapshot.data
    ? dispatcherTaskSnapshot.duplicateKeys
    : undefined
  const visibleRepeatedJointTasks = isServerPagedTab
    ? dispatcherTaskSnapshot.repeatedJointTasks
    : []
  const adviceRepeatedJointTasks = isServerPagedTab || Boolean(chainRecord)
    ? dispatcherTaskSnapshot.adviceRepeatedJointTasks
    : []
  const visibleRepeatedJointTaskGroups = isServerPagedTab
    ? dispatcherTaskSnapshot.repeatedJointTaskGroups
    : []
  const visibleWelderStampExpiryTasks =
    activeReport === 'welderStamps'
      ? dispatcherTaskSnapshot.welderStampExpiryTasks
      : []
  const visibleWelderStampNotificationGroups =
    activeReport === 'welderStamps'
      ? dispatcherTaskSnapshot.welderStampNotificationGroups
      : []
  useEffect(() => {
    const visibleTasks =
      activeReport === 'welderStamps'
        ? visibleWelderStampExpiryTasks
        : visibleRepeatedJointTasks
    const visibleKeys = new Set(visibleTasks.map((task) => task.key))
    setExpandedRepeatedJointTaskKeys((current) => {
      const next = new Set([...current].filter((key) => visibleKeys.has(key)))
      return next.size === current.size ? current : next
    })
  }, [
    activeReport,
    setExpandedRepeatedJointTaskKeys,
    visibleRepeatedJointTasks,
    visibleWelderStampExpiryTasks,
  ])

  const enablePstoRequestState =
    activeReport === 'heatTreatment' ||
    isImportDialogOpen ||
    isPstoRequestModalOpen ||
    isPstoRequestManagerOpen ||
    isPstoResultModalOpen ||
    isPstoResultManagerOpen
  const enablePstoResultState =
    activeReport === 'heatTreatment' || isImportDialogOpen || isPstoResultModalOpen || isPstoResultManagerOpen
  const enableLnkRequestState =
    activeReport === 'lnk' ||
    isImportDialogOpen ||
    isLnkRequestModalOpen ||
    isLnkRequestManagerOpen ||
    isLnkResultModalOpen ||
    isLnkResultManagerOpen ||
    isLnkOfficialityModalOpen ||
    isDuplicateControlModalOpen ||
    Boolean(preHeatTreatmentLnkWorkflowMode) ||
    isPreHeatTreatmentResultManagerOpen
  const enableLnkResultState =
    activeReport === 'lnk' ||
    isImportDialogOpen ||
    isLnkResultModalOpen ||
    isLnkResultManagerOpen ||
    isLnkOfficialityModalOpen ||
    isDuplicateControlModalOpen ||
    Boolean(preHeatTreatmentLnkWorkflowMode) ||
    isPreHeatTreatmentResultManagerOpen
  const {
    heatTreatmentRows,
    availablePstoRequestRows,
    filteredPstoRequestRows,
    filteredAvailablePstoRequestRows,
    lnkRows,
    availableLnkRequestRows,
    readyLnkRequestRows,
    filteredLnkRequestRows,
    filteredAvailableLnkRequestRows,
    filteredReadyLnkRequestRows,
    visibleRows,
  } = usePreparedReportRows({
    activeReport,
    enableHeatTreatmentRows: enablePstoRequestState || enablePstoResultState,
    enableLnkRows: enableLnkRequestState || enableLnkResultState,
    enablePstoRequestRows: enablePstoRequestState,
    enableLnkRequestRows: enableLnkRequestState,
    rows,
    preservedLnkOrderIds,
    pstoRequestSearch,
    lnkRequestSearch,
    controlProcessSettings,
  })
  const {
    chainRows,
    chainTransitions,
    chainEarlyCoilCandidates,
    chainRowsError,
    isChainRowsLoading,
    retryChainRows,
  } = useJointChainDialogState({
    chainRecord,
    onClose: () => setChainRecord(null),
  })
  const {
    selectedHeatTreatmentRows,
    selectedLnkRows,
    nextPstoRequestName,
    nextLnkRequestName,
    nextPstoRequestNumber,
    nextLnkRequestNumber,
    pstoRequestOptions,
    pstoRequestManagerOptions,
    managedPstoRequestRows,
    pstoResultRequestOptions,
    lnkRequestOptions,
    lnkRequestManagerOptions,
    lnkRequestExtensionOptions,
    lnkResultRequestOptions,
    managedLnkRequestRows,
    managedLnkRequestMethods,
    nextLnkConclusionName,
    nextPstoDiagramName,
    nextLnkConclusionNumber,
    nextPstoConclusionNumber,
    selectedPstoResultRequestRows,
    pstoResultSelectedRows,
    selectedLnkResultRequestRows,
    lnkResultSelectedRows,
  } = useReportRequestDerivedState({
    enableLnkRequestState,
    enableLnkResultState,
    enablePstoRequestState,
    enablePstoResultState,
    rows,
    heatTreatmentRows,
    lnkRows,
    availablePstoRequestRows,
    availableLnkRequestRows,
    selectedHeatTreatmentIds,
    selectedLnkIds,
    pstoRequestDate,
    lnkRequestDraft,
    pstoResultDraft,
    lnkResultDraft,
    managedPstoRequestName,
    managedPstoRequestDate,
    managedLnkRequestName,
    managedLnkRequestDate,
    requestConclusionSettings,
    lnkWorkflowRequestSummary: lnkWorkflowRequestSummaryQuery.data,
    pstoWorkflowRequestOptions: pstoWorkflowRequestOptionsQuery.data?.options ?? [],
  })
  const {
    lnkRequestMutation,
    lnkRequestExtensionMutation,
    lnkRequestCorrectionMutation,
    lnkRequestManagerMutation,
    lnkResultMutation,
    lnkOfficialityMutation,
    lnkOfficialityPreviewMutation,
    lnkResultCorrectionMutation,
    lnkResultReplacementMutation,
    lnkConclusionCorrectionMutation,
    lnkFieldMutation,
  } = useLnkReportMutations({
    controlProcessSettings,
    lnkRows,
    lnkRequestOptions,
    setMessage,
    setLnkNotice,
    onWorkflowCorrectionSaved: () => {
      const destination = workflowRootCauseStackRef.current.at(-1)?.destination
      if (
        destination === 'lnk-request-dialog' ||
        destination === 'lnk-request-manager' ||
        destination === 'lnk-result-manager' ||
        destination === 'lnk-result-dialog'
      ) completeWorkflowRootCause(destination)
    },
    highlightChangedRows,
    setSelectedLnkIds,
    setLnkRequestDraft,
    setLnkRequestNaming,
    setIsLnkRequestModalOpen,
    setManagedLnkRequestName,
    setManagedLnkRequestNameDraft,
    setIsLnkRequestManagerOpen,
    setIsLnkResultModalOpen,
    setLnkResultDraft,
    setLnkOfficialityDraft,
    setIsLnkOfficialityModalOpen,
    resetDismissedRepeatedJointTasks,
    setManagedLnkPendingResultChanges,
    setManagedLnkResultChangeHint,
    setHeatTreatmentFieldEditing,
    defaultLnkRequestNaming,
    defaultLnkConclusionNaming,
  })
  const forcedLnkResultEntry = useMemo(() => {
    const target = currentWorkflowRootCauseAction?.target
    if (
      currentWorkflowRootCauseDestination !== 'lnk-result-manager' ||
      target?.kind !== 'lnk-control' ||
      target.documentPart !== 'request'
    ) return undefined
    const method = LNK_METHODS.find((candidate) => candidate.code === target.methodCode)
    return method ? { rowId: target.rowId, methodKey: method.requestKey } : undefined
  }, [currentWorkflowRootCauseAction, currentWorkflowRootCauseDestination])
  const {
    closeCreateLnkRequestModal,
    handleCreateLnkRequest,
    handleExtendLnkRequest,
    openCreateLnkRequestModal,
    openCreateLnkRequestModalForRow,
    openCreateLnkRequestModalForRows,
    openExtendLnkRequestModal,
    openExtendLnkRequestModalForRows,
    toggleAllLnkRequestRows,
    toggleLnkRequestRow,
  } = useLnkRequestActions({
    controlProcessSettings,
    draft: lnkRequestDraft,
    filteredRows: filteredReadyLnkRequestRows,
    lnkRows,
    naming: lnkRequestNaming,
    nextRequestName: nextLnkRequestName,
    nextRequestNumber: nextLnkRequestNumber,
    requestConclusionSettings,
    selectedRows: selectedLnkRows,
    mutation: lnkRequestMutation,
    extensionMutation: lnkRequestExtensionMutation,
    setDraft: setLnkRequestDraft,
    setIsOpen: setIsLnkRequestModalOpen,
    setMessage,
    setNaming: setLnkRequestNaming,
    setPreservedOrderIds: setPreservedLnkOrderIds,
    setSearch: setLnkRequestSearch,
    setSelectedIds: setSelectedLnkIds,
    setComposerMode: setLnkRequestComposerMode,
    setTargetRequestKey: setLnkRequestTargetKey,
    defaultNaming: defaultLnkRequestNaming,
  })
  const {
    changeManagedLnkRequest,
    clearManagedLnkRequestPosition,
    closeLnkRequestManager,
    deleteManagedLnkRequest,
    openLnkRequestManager,
    renameManagedLnkRequest,
  } = useManagedLnkRequestActions({
    lnkRequestManagerOptions,
    managedLnkRequestName,
    managedLnkRequestDate,
    managedLnkRequestNameDraft,
    lnkRequestCorrectionMutation,
    lnkRequestManagerMutation,
    setIsLnkRequestManagerOpen,
    setManagedLnkRequestName,
    setManagedLnkRequestDate,
    setManagedLnkRequestNameDraft,
  })
  const openLnkRequestRegistry = (requestName?: string, requestDate?: string) => {
    if (lnkRequestMutation.isPending || lnkRequestExtensionMutation.isPending) return
    setIsLnkRequestModalOpen(false)
    setLnkWorkflowRequestSearch(requestName ?? '')
    openLnkRequestManager(requestName, requestDate)
  }
  const openCreateLnkRequestFromRegistry = () => {
    if (lnkRequestManagerMutation.isPending || lnkRequestCorrectionMutation.isPending) return
    setIsLnkRequestManagerOpen(false)
    openCreateLnkRequestModal()
  }
  function followSavedWeldRowInActiveReport(previousRow: WeldRow, savedRow: WeldRow) {
    const updateFilters = (filters: Record<string, string>) =>
      followUpdatedWeldRowFilters(filters, previousRow, savedRow)

    if (activeReport === 'lnk') setLnkFilters(updateFilters)
    else if (activeReport === 'heatTreatment') setHeatTreatmentFilters(updateFilters)
    else if (activeReport === 'weldingJournal') setColumnFilters(updateFilters)
  }
  const {
    deleteManyMutation,
    deleteMutation,
    earlyCoilMutation,
    importMutation,
    obsoleteRepeatedJointMutation,
    renameRepeatedJointMutation,
    repeatedJointMutation,
    saveMutation,
  } = useWeldJournalMutations({
    rows,
    editingRecord: editing?.record as WeldRow | undefined,
    welderStamps,
    welderStampSuspensions,
    weldFormStampSelectOptions,
    editingFocusField: editing?.focusField,
    setEditing,
    setMessage,
    onWeldRowSaved: followSavedWeldRowInActiveReport,
    onWorkflowCorrectionSaved: () => completeWorkflowRootCause('weld-form'),
    highlightChangedRows,
    dismissRepeatedJointTask,
  })
  const {
    createRepeatedJoint,
    createEarlyCoil,
    createEarlyCoilFromChain,
    deleteObsoleteRepeatedJoint,
    renameObsoleteRepeatedJoint,
  } = useRepeatedJointTaskActions({
    activeReport,
    systemIndexSettings,
    loadTasks: async () => {
      const result = await dispatcherTaskSnapshot.refetch()
      if (result.error) throw result.error
      return result.data?.repeatedJointTasks ?? []
    },
    repeatedJointMutation,
    earlyCoilMutation,
    obsoleteRepeatedJointMutation,
    renameRepeatedJointMutation,
    setMessage,
  })

  const { weldMassFillMutation, weldReplaceDataMutation } = useReportImportMutations({
    setMessage,
    highlightChangedRows,
  })

  const {
    pstoRequestMutation,
    pstoResultMutation,
    pstoRequestManagerMutation,
    pstoRequestCorrectionMutation,
    pstoResultCorrectionMutation,
    heatTreatmentFieldMutation,
  } = usePstoReportMutations({
    rows,
    heatTreatmentRows,
    pstoRequestOptions,
    setMessage,
    onWorkflowCorrectionSaved: () => {
      const destination = workflowRootCauseStackRef.current.at(-1)?.destination
      if (destination === 'psto-request-manager') completeWorkflowRootCause(destination)
    },
    highlightChangedRows,
    setSelectedHeatTreatmentIds,
    setPstoRequestNaming,
    setPstoRequestSearch,
    setPstoRequestDate,
    setIsPstoRequestModalOpen,
    setIsPstoResultModalOpen,
    setPstoResultDraft,
    setManagedPstoRequestName,
    setManagedPstoRequestNameDraft,
    setIsPstoRequestManagerOpen,
    setHeatTreatmentFieldEditing,
    defaultPstoRequestNaming,
    defaultPstoConclusionNaming,
  })
  const {
    handleEditRecord,
    saveEditedHeatTreatmentField,
  } = useReportEditActions({
    activeReport,
    heatTreatmentFieldEditing,
    heatTreatmentFieldMutation,
    lnkFieldMutation,
    lnkRequestOptions,
    rows,
    setEditing,
    setHeatTreatmentFieldEditing,
    setRkExposureEditing,
    setMessage,
  })
  const {
    pstoResultAvailableRequestOptions,
    filteredPstoResultRequestOptions,
    pstoResultSearchRows,
    filteredPstoResultRows,
    selectedPstoResultRows,
    systemDocumentCreationPlan: pstoResultSystemDocumentCreationPlan,
    pstoResultSaveBlockReason,
    pstoResultRootCauseActions,
    managedPstoResultRows,
  } = usePstoResultDerivedState({
    heatTreatmentRows,
    pstoResultSelectedRows,
    pstoResultRequestOptions,
    pstoResultRequestSearch,
    selectedPstoResultRequestRows,
    pstoResultDraft,
    nextPstoDiagramName,
    nextPstoConclusionNumber,
    requestConclusionSettings,
    isPstoResultSaving: pstoResultMutation.isPending,
    saveCheckSettings,
  })
  const {
    lnkResultAvailableRequestOptions,
    lnkResultSearchRows,
    selectedLnkResultMethods,
    filteredLnkResultRows,
    lnkResultContextReady,
    visibleLnkResultRows,
    selectableVisibleLnkResultRows,
    canBulkToggleLnkResultRows,
    selectedLnkResultRows,
    systemDocumentCreationPlan: lnkResultSystemDocumentCreationPlan,
    lnkResultSaveBlockReason,
    lnkResultRootCauseActions,
    isLnkResultSaveDisabled,
  } = useLnkResultDerivedState({
    controlProcessSettings,
    lnkRows,
    lnkResultSelectedRows,
    lnkResultRequestOptions,
    selectedLnkResultRequestRows,
    lnkResultDraft,
    nextLnkConclusionName,
    nextLnkConclusionNumber,
    requestConclusionSettings,
    saveCheckSettings,
    isLnkResultSaving: lnkResultMutation.isPending,
  })
  const {
    changeLnkResultMethod,
    changeLnkResultRequest,
    closeAddLnkResultModal,
    openAddLnkResultModal,
    openAddLnkResultModalForMethod,
    openAddLnkResultModalForRow,
    setLnkResultRows,
    toggleAllLnkResultRows,
    toggleLnkResultRow,
  } = useLnkResultActions({
    controlProcessSettings,
    filteredRows: filteredLnkResultRows,
    lnkRows,
    draft: lnkResultDraft,
    mutation: lnkResultMutation,
    setDraft: setLnkResultDraft,
    setIsModalOpen: setIsLnkResultModalOpen,
    setMessage,
    setPreservedOrderIds: setPreservedLnkOrderIds,
    defaultConclusionNaming: defaultLnkConclusionNaming,
  })
  const {
    handleAddLnkResult,
    setLnkResultForRow,
    setLnkResultForRows,
  } = useLnkResultSaveActions({
    controlProcessSettings,
    lnkRows,
    draft: lnkResultDraft,
    selectedRows: selectedLnkResultRows,
    saveBlockReason: lnkResultSaveBlockReason,
    nextConclusionName: nextLnkConclusionName,
    nextConclusionNumber: nextLnkConclusionNumber,
    requestConclusionSettings,
    resultMutation: lnkResultMutation,
    setDraft: setLnkResultDraft,
    setMessage,
  })
  const {
    managedLnkResultRows,
    managedLnkResultMethods,
    managedLnkResultEntries,
    managedLnkPendingResultRows,
  } = useManagedLnkResultDerivedState({
    isOpen: isLnkResultManagerOpen,
    lnkRows,
    managedLnkResultOrderIds,
    managedLnkResultMethodKey,
    managedLnkPendingResultChanges,
    forcedEntry: forcedLnkResultEntry,
  })
  const {
    changeManagedLnkConclusionDraft,
    changeManagedLnkResultMethod,
    clearLnkResult,
    closeLnkResultManager,
    openLnkResultManager,
    renameManagedLnkConclusionForRow,
    replaceLnkResult,
    resetManagedLnkResultChanges,
    saveManagedLnkResultChanges,
  } = useManagedLnkResultActions({
    isLnkRowsContextReady,
    lnkRows,
    selectedLnkResultRowIds: lnkResultDraft.rowIds,
    managedLnkPendingResultChanges,
    managedLnkPendingResultRows,
    lnkResultCorrectionMutation,
    lnkResultReplacementMutation,
    lnkConclusionCorrectionMutation,
    setMessage,
    setIsLnkResultModalOpen,
    setIsLnkResultManagerOpen,
    setManagedLnkResultMethodKey,
    setManagedLnkConclusionDrafts,
    setManagedLnkResultOrderIds,
    setManagedLnkResultTargetKey,
    setManagedLnkResultChangeHint,
    setManagedLnkPendingResultChanges,
  })

  const openAllLnkResultRegistry = () => {
    setLnkResultRegistrySearch('')
    setLnkResultRegistryFilter('all')
    setLnkResultRegistryLimit(WORKFLOW_REGISTRY_PAGE_SIZE)
    openLnkResultManager({ rowIds: null })
  }
  const openSelectedLnkResultRegistry = () => openLnkResultManager({ rowIds: [...selectedLnkIds] })
  const openLnkResultRegistryForRows = (selectedRows: WeldRow[]) =>
    openLnkResultManager({ rowIds: selectedRows.map((selectedRow) => selectedRow.id) })
  const openExactLnkResult = (row: WeldRow, methodKey: WeldFieldKey) => {
    const entry = getLnkResultNavigationEntry(row, methodKey)
    if (!entry) {
      setMessage('Не удалось определить внесенный результат ЛНК')
      return
    }
    openLnkResultManager({
      rowIds: [row.id],
      methodKey,
      targetKey: entry.changeKey,
    })
  }
  const openAddLnkResultFromRegistry = () => {
    closeLnkResultManager()
    openAddLnkResultModal()
  }
  const closePreHeatTreatmentResultRegistry = () => {
    closePreHeatTreatmentResultRegistryState(preHeatTreatmentResultCorrectionMutation.isPending)
  }
  const openPrimaryLnkRegistryFromPreHeatTreatment = () => {
    const rowIds = preHeatTreatmentResultManagerRowIds
    startTransition(() => {
      setIsPreHeatTreatmentResultManagerOpen(false)
      setPreHeatTreatmentResultManagerRowIds(null)
      setPreHeatTreatmentResultManagerInitialRelationId(null)
      if (preHeatTreatmentResultManagerMode === 'request') {
        openLnkRequestRegistry()
        return
      }
      openLnkResultManager({ rowIds, allowEmpty: true })
    })
  }
  const switchLnkWorkflowStage = (
    mode: 'request' | 'result',
    stage: LnkControlStage,
    selectedRowIds: number[],
    requestSubmitMode: LnkRequestComposerMode = 'create',
  ) => {
    const selectedRows = lnkRows.filter((row) => selectedRowIds.includes(row.id))
    if (
      stage === PRE_HEAT_TREATMENT_LNK_CONTROL_STAGE &&
      !controlProcessSettings.preHeatTreatmentLnkEnabled
    ) {
      setMessage('НК до ТО выключен в настройках проекта.')
      return
    }

    startTransition(() => {
      if (stage === PRE_HEAT_TREATMENT_LNK_CONTROL_STAGE) {
        if (selectedRowIds.length > 0) setSelectedLnkIds(new Set(selectedRowIds))
        openPreHeatTreatmentLnkWorkflow(mode, undefined, requestSubmitMode)
        return
      }

      setPreHeatTreatmentLnkWorkflowMode(null)
      setPreHeatTreatmentLnkInitialMethodCode(undefined)
      if (mode === 'request') {
        if (requestSubmitMode === 'extend') {
          openExtendLnkRequestModalForRows(selectedRows)
        } else {
          openCreateLnkRequestModalForRows(selectedRows)
        }
        return
      }
      if (
        selectedRows.length === 1 &&
        getLnkRowRequestNames(selectedRows[0]!).length > 0
      ) {
        openAddLnkResultModalForRow(selectedRows[0]!)
        return
      }
      openAddLnkResultModal()
    })
  }
  const openCreateLnkWorkflowRequestForRow = (row: WeldRow) => {
    if (getPreferredLnkRequestStage(row) === PRE_HEAT_TREATMENT_LNK_CONTROL_STAGE) {
      setSelectedLnkIds(new Set([row.id]))
      openPreHeatTreatmentLnkWorkflow('request')
      return
    }
    openCreateLnkRequestModalForRow(row)
  }
  const openCreateLnkWorkflowRequestForRows = (selectedRows: WeldRow[]) => {
    if (selectedRows.length === 0) {
      openCreateLnkRequestModal()
      return
    }
    const stage = getCommonLnkRequestStage(selectedRows)
    if (stage === PRE_HEAT_TREATMENT_LNK_CONTROL_STAGE) {
      setSelectedLnkIds(new Set(selectedRows.map((row) => row.id)))
      openPreHeatTreatmentLnkWorkflow('request')
      return
    }
    if (stage) {
      openCreateLnkRequestModalForRows(selectedRows)
      return
    }
    setMessage('Выбранные стыки требуют заявок на разных этапах ЛНК. Выберите стыки одного этапа.')
  }
  const openAddLnkWorkflowResultForRow = (row: WeldRow) => {
    if (getPreferredLnkResultStage(row) === PRE_HEAT_TREATMENT_LNK_CONTROL_STAGE) {
      setSelectedLnkIds(new Set([row.id]))
      openPreHeatTreatmentLnkWorkflow('result')
      return
    }
    openAddLnkResultModalForRow(row)
  }
  const openAddLnkWorkflowResultFromHeader = () => {
    const selectedRows = tableActionRows.filter((row) => selectedLnkIds.has(row.id))
    if (
      selectedRows.length > 0 &&
      getCommonLnkResultStage(selectedRows) === PRE_HEAT_TREATMENT_LNK_CONTROL_STAGE
    ) {
      openPreHeatTreatmentLnkWorkflow('result')
      return
    }
    openAddLnkResultModal()
  }
  const deletePreHeatTreatmentResult = async (
    row: WeldRow,
    control: PreHeatTreatmentControlRecord,
  ) => {
    const confirmed = await confirmAction({
      title: 'Удалить результат НК до ТО',
      itemName: `${String(control.method ?? '').trim()} · ${String(row.joint ?? '-').trim() || '-'}`,
      description: 'Будут очищены результат, дата и заключение до ТО. Заявка останется и снова будет ожидать НК.',
      warning: 'Удаление недоступно, если уже начат ПСТО или существует последующий этап цепочки.',
      confirmLabel: 'Удалить результат',
      tone: 'danger',
    })
    if (!confirmed) return
    await runProtectedDelete('удаление результата НК до ТО', async () => {
      await preHeatTreatmentResultCorrectionMutation.mutateAsync({
        relationId: control.id,
        expectedVersion: String(row.rowVersion ?? '').trim(),
        stage: 'result',
        action: 'delete',
      })
    })
  }
  const deletePreHeatTreatmentRequest = async (
    row: WeldRow,
    control: PreHeatTreatmentControlRecord,
  ) => {
    const confirmed = await confirmAction({
      title: 'Удалить заявку НК до ТО',
      itemName: `${String(control.method ?? '').trim()} · ${String(row.joint ?? '-').trim() || '-'}`,
      description: 'Позиция будет удалена из заявки НК до ТО. Другие позиции того же документа сохранятся.',
      warning: 'Сначала нужно удалить результат этого вида НК. Каскадного удаления последующих этапов нет.',
      confirmLabel: 'Удалить заявку',
      tone: 'danger',
    })
    if (!confirmed) return
    await runProtectedDelete('удаление заявки НК до ТО', async () => {
      await preHeatTreatmentResultCorrectionMutation.mutateAsync({
        relationId: control.id,
        expectedVersion: String(row.rowVersion ?? '').trim(),
        stage: 'request',
        action: 'delete',
      })
    })
  }
  const {
    filteredLnkOfficialityRows,
    selectedLnkOfficialityRows,
    lnkOfficialityCounters,
    lnkOfficialitySaveBlockReason,
    isLnkOfficialitySaveDisabled,
  } = useLnkOfficialityDerivedState({
    lnkRows,
    lnkOfficialityDraft,
    isLnkOfficialitySaving: lnkOfficialityMutation.isPending || lnkOfficialityPreviewMutation.isPending,
  })
  const {
    openLnkOfficialityModal,
    closeLnkOfficialityModal,
    toggleLnkOfficialityRow,
    setVisibleLnkOfficialityRowsSelected,
    saveLnkOfficiality,
  } = useLnkOfficialityActions({
    draft: lnkOfficialityDraft,
    filteredRows: filteredLnkOfficialityRows,
    selectedRows: selectedLnkOfficialityRows,
    isSaveDisabled: isLnkOfficialitySaveDisabled,
    mutation: lnkOfficialityMutation,
    previewMutation: lnkOfficialityPreviewMutation,
    setDraft: setLnkOfficialityDraft,
    setIsOpen: setIsLnkOfficialityModalOpen,
    setMessage,
  })
  const filteredDuplicateControlRows = duplicateControlCandidates.rows
  const selectedDuplicateControlRows = useMemo(
    () => {
      const rowsById = new Map<number, WeldRow>([
        ...duplicateControlCandidates.rows.map((row) => [row.id, row] as const),
        ...(selectedDuplicateControlRowsQuery.data ?? []).map((row) => [row.id, row] as const),
      ])
      return [...duplicateControlDraft.rowIds].flatMap((id) => {
        const row = rowsById.get(id)
        return row ? [row] : []
      })
    }, [
      duplicateControlCandidates.rows,
      duplicateControlDraft.rowIds,
      selectedDuplicateControlRowsQuery.data,
    ],
  )
  const selectedDuplicateControlRowsLoading =
    isDuplicateControlModalOpen &&
    duplicateControlDraft.rowIds.size > 0 &&
    (
      !duplicateControlCandidates.isReady ||
      (missingSelectedDuplicateControlRowIds.length > 0 && selectedDuplicateControlRowsQuery.isPending)
    )
  const duplicateControlDialogControls = useMemo(() => {
    if (duplicateControlDraft.rowIds.size === 0) return duplicateControls
    const seen = new Set<number>()
    return selectedDuplicateControlRows.flatMap((row): DuplicateControlRegistryRecord[] =>
      getDuplicateControls(row).flatMap((control) => {
        if (seen.has(control.id)) return []
        seen.add(control.id)
        return [{
          ...control,
          projectTitle: String(row.projectTitle ?? ''),
          subtitleCode: String(row.subtitleCode ?? ''),
          line: String(row.line ?? ''),
          spool: String(row.spool ?? ''),
          joint: String(row.joint ?? ''),
        }]
      }),
    )
  }, [duplicateControlDraft.rowIds.size, duplicateControls, selectedDuplicateControlRows])
  const selectedDuplicateControlRowsError = selectedDuplicateControlRowsQuery.error instanceof Error
    ? selectedDuplicateControlRowsQuery.error.message
    : null
  const duplicateControlSaveBlockReason = selectedDuplicateControlRowsLoading
    ? 'Загружаются выбранные стыки, дождитесь завершения.'
    : selectedDuplicateControlRowsError
      ? `Не удалось загрузить выбранные стыки: ${selectedDuplicateControlRowsError}`
      : selectedDuplicateControlRows.length !== duplicateControlDraft.rowIds.size
        ? 'Один или несколько выбранных стыков больше не существуют. Обновите выбор.'
      : getDuplicateControlSaveBlockReason({
          draft: duplicateControlDraft,
          isSaving: saveDuplicateControlMutation.isPending,
          saveCheckSettings,
          selectedRows: selectedDuplicateControlRows,
          systemIndexSettings,
        })
  const {
    activeColumnFilters,
    activeFiltersSetter,
    activeTitle,
    registerMinWidth,
    stickyLeft,
  } = useActiveReportLayoutState({
    activeReport,
    columnFilters,
    heatTreatmentFilters,
    lnkFilters,
    navCollapsed,
    setColumnFilters,
    setHeatTreatmentFilters,
    setLnkFilters,
  })
  const { sort: activeReportSort, setSort: setActiveReportSort } = useReportSortState(activeReport)
  const { captureReportContext } = useReportNavigationContext({
    activeReport,
    columnFilters,
    heatTreatmentFilters,
    lnkFilters,
    selectedWeldingJournalIds,
    selectedHeatTreatmentIds,
    selectedLnkIds,
    setColumnFilters,
    setHeatTreatmentFilters,
    setLnkFilters,
    setSelectedWeldingJournalIds,
    setSelectedHeatTreatmentIds,
    setSelectedLnkIds,
  })
  const dispatcherTaskServerFilters = useMemo(
    () => buildDispatcherTaskServerFilters(activeColumnFilters),
    [activeColumnFilters],
  )
  const weldPageQuery = useWeldPageQuery({
    enabled: isServerPagedTab,
    report: isServerPagedTab ? activeReport : 'weldingJournal',
    columnFilters: isServerPagedTab ? dispatcherTaskServerFilters : {},
    sort: isServerPagedTab ? activeReportSort : null,
  })
  const basePagedReportRows = useReportRows(
    weldPageQuery.rows,
    [],
    undefined,
    remoteFinalStatusContext,
    otherSettings,
  )
  const pagedReportRows = basePagedReportRows
  const tableDispatcherTaskRowIds = useMemo(
    () =>
      new Set(
        pagedReportRows
          .filter((row) => String(row.activeDispatcherTasks ?? '').trim())
          .map((row) => row.id),
      ),
    [pagedReportRows],
  )
  const tableActionRows = rows.length > 0 ? (visibleRows as WeldRow[]) : pagedReportRows
  useEffect(() => {
    const refreshDocumentAssignments = () => {
      if (lnkWorkflowRowsQuery.isEnabled) void lnkWorkflowRowsQuery.refetch()
      if (pstoWorkflowRowsQuery.isEnabled) void pstoWorkflowRowsQuery.refetch()
      if (isServerPagedTab) void weldPageQuery.refetch()
    }
    window.addEventListener(GENERATED_DOCUMENT_STORAGE_EVENT, refreshDocumentAssignments)
    return () => window.removeEventListener(GENERATED_DOCUMENT_STORAGE_EVENT, refreshDocumentAssignments)
  }, [
    isServerPagedTab,
    lnkWorkflowRowsQuery.isEnabled,
    lnkWorkflowRowsQuery.refetch,
    pstoWorkflowRowsQuery.isEnabled,
    pstoWorkflowRowsQuery.refetch,
    weldPageQuery.refetch,
  ])
  const activeReportManualPagination = useMemo(
    () =>
      isServerPagedTab
        ? {
            totalCount: weldPageQuery.totalCount,
            firstItemNumber: weldPageQuery.firstItemNumber,
            lastItemNumber: weldPageQuery.lastItemNumber,
            pageSize: weldPageQuery.pageSize,
            hasMore: weldPageQuery.hasMore,
            onLoadMore: weldPageQuery.loadMore,
            onPageSizeChange: weldPageQuery.setPageSize,
          }
        : undefined,
    [
      isServerPagedTab,
      weldPageQuery.firstItemNumber,
      weldPageQuery.hasMore,
      weldPageQuery.lastItemNumber,
      weldPageQuery.loadMore,
      weldPageQuery.pageSize,
      weldPageQuery.setPageSize,
      weldPageQuery.totalCount,
    ],
  )
  const shouldBuildFilteredVisibleRows =
    activeReport === 'weldingJournal' || isImportDialogOpen || isLnkShowMenuOpen || isPstoShowMenuOpen
  const filteredVisibleRows = useMemo(
    () => (shouldBuildFilteredVisibleRows ? filterWeldRowsByColumns(visibleRows as WeldRow[], activeColumnFilters) : []),
    [activeColumnFilters, shouldBuildFilteredVisibleRows, visibleRows],
  )
  const filteredAvailableLnkRequestRowsForSummary = useMemo(
    () => filterWeldRowsByColumns(availableLnkRequestRows, activeColumnFilters),
    [activeColumnFilters, availableLnkRequestRows],
  )
  const filteredAcceptedWdiTotal = useMemo(
    () => (activeReport === 'weldingJournal' ? sumAcceptedWdi(filteredVisibleRows) : 0),
    [activeReport, filteredVisibleRows],
  )
  const loadWeldingJournalPageRows = useCallback(async ({
    columnFilters,
    includeSort,
  }: {
    columnFilters: Record<string, string>
    includeSort: boolean
  }) => {
    const filters = splitReportQuickSearch(columnFilters)
    const result = await listWeldingJournalPage({
      data: {
        page: 1,
        pageSize: WELD_PAGE_ALL_SIZE,
        columnFilters: filters.columnFilters,
        ...(filters.search ? { search: filters.search } : {}),
        ...(includeSort && activeReportSort ? { sort: activeReportSort } : {}),
      },
    })
    return result.rows
  }, [activeReportSort])
  const loadCurrentWeldingJournalRows = useCallback(
    () => loadWeldingJournalPageRows({
      columnFilters: dispatcherTaskServerFilters,
      includeSort: true,
    }),
    [dispatcherTaskServerFilters, loadWeldingJournalPageRows],
  )
  const generateWeldingJournalDocumentForRows = (documentRows: WeldRow[]) =>
    generateDocumentForRows('weldingJournal', documentRows)
  const generateChecklistDocumentForRows = (documentRows: WeldRow[]) =>
    generateDocumentForRows('checklist', documentRows)
  const generateZniDocumentForRows = (documentRows: WeldRow[]) =>
    generateDocumentForRows('zni', documentRows)
  const generateDocumentFromCurrentFilter = async (
    type: 'weldingJournal' | 'checklist' | 'zni',
  ) => {
    setIsWeldingJournalGenerateMenuOpen(false)
    setMessage('Загружаем стыки текущего фильтра для формирования документа…')
    try {
      const documentRows = await loadCurrentWeldingJournalRows()
      setMessage(null)
      generateDocumentForRows(type, documentRows)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось загрузить стыки для формирования документа.')
    }
  }
  const generateWeldingJournalDocument = () => void generateDocumentFromCurrentFilter('weldingJournal')
  const generateChecklistDocument = () => void generateDocumentFromCurrentFilter('checklist')
  const generateZniDocument = () => void generateDocumentFromCurrentFilter('zni')
  const prepareLnkOutputRows = useCallback(
    (sourceRows: WeldRow[], finalStatusContext: FinalStatusRowsContext = remoteFinalStatusContext) => buildLnkReportRows(
      prepareReportRows(sourceRows, [], undefined, finalStatusContext, otherSettings),
      preservedLnkOrderIds,
    ),
    [otherSettings, preservedLnkOrderIds, remoteFinalStatusContext],
  )
  const preparePstoOutputRows = useCallback(
    (sourceRows: WeldRow[], finalStatusContext: FinalStatusRowsContext = remoteFinalStatusContext) => buildHeatTreatmentReportRows(
      prepareReportRows(sourceRows, [], undefined, finalStatusContext, otherSettings),
    ),
    [otherSettings, remoteFinalStatusContext],
  )
  const loadRemoteFinalStatusContext = useCallback(async (): Promise<FinalStatusRowsContext> => {
    const keys = await queryClient.fetchQuery({
      queryKey: WELD_FINAL_STATUS_CONTEXT_QUERY_KEY,
      queryFn: () => listWeldFinalStatusContextKeys(),
      staleTime: 60_000,
      retry: false,
    })
    return { rejectedUnofficialSameNameRepairKeys: new Set(keys) }
  }, [queryClient])
  const loadLnkOutputRows = useCallback(async (kind: LnkOutputRowsKind) => {
    const sourceRows = kind === 'current'
      ? await loadFilteredCurrentReportOutputRows({
          report: 'lnk',
          columnFilters: dispatcherTaskServerFilters,
          sort: activeReportSort,
        })
      : await loadCompleteReportOutputRows(queryClient, 'lnk')
    if (sourceRows.length === 0) return []
    const finalStatusContext = await loadRemoteFinalStatusContext()
    return prepareLnkOutputRows(sourceRows, finalStatusContext)
  }, [
    activeReportSort,
    dispatcherTaskServerFilters,
    loadRemoteFinalStatusContext,
    prepareLnkOutputRows,
    queryClient,
  ])
  const loadPstoOutputRows = useCallback(async (kind: PstoOutputRowsKind) => {
    const sourceRows = kind === 'current'
      ? await loadFilteredCurrentReportOutputRows({
          report: 'heatTreatment',
          columnFilters: dispatcherTaskServerFilters,
          sort: activeReportSort,
        })
      : await loadCompleteReportOutputRows(queryClient, 'heatTreatment')
    if (sourceRows.length === 0) return []
    const finalStatusContext = await loadRemoteFinalStatusContext()
    return preparePstoOutputRows(sourceRows, finalStatusContext)
  }, [
    activeReportSort,
    dispatcherTaskServerFilters,
    loadRemoteFinalStatusContext,
    preparePstoOutputRows,
    queryClient,
  ])
  const loadWeldingJournalOutputRows = useCallback(async (
    kind: WeldingJournalOutputRowsKind,
  ): Promise<WeldInput[]> => {
    if (kind === 'current') return loadCurrentWeldingJournalRows()
    if (kind === 'waitingRequest') return loadLnkOutputRows('waitingRequest')
    if (kind === 'waitingControl') return loadLnkOutputRows('waitingNk')
    if (kind === 'waitingWeld' || kind === 'waitingRepair') {
      return loadWeldingJournalPageRows({
        columnFilters: {
          finalStatus: kind === 'waitingWeld' ? '=ожидает сварку' : '=ожидает ремонт',
        },
        includeSort: false,
      })
    }
    return loadWeldingJournalPageRows({ columnFilters: {}, includeSort: false })
  }, [
    loadCurrentWeldingJournalRows,
    loadLnkOutputRows,
    loadWeldingJournalPageRows,
  ])
  const {
    openLnkConclusionsReport,
    openLnkCurrentReport,
    openLnkToRequestReport,
    openLnkWaitingNkReport,
    openPstoCurrentReport,
    openPstoResultsReport,
    openPstoWaitingRequestReport,
    openWeldingJournalCancelledAcceptedReport,
    openWeldingJournalCurrentReport,
    openWeldingJournalSystemReport,
    openWeldingJournalWaitingControlReport,
    openWeldingJournalWaitingRepairReport,
    openWeldingJournalWaitingRequestReport,
    openWeldingJournalWaitingWeldReport,
  } = useReportOutputActions({
    activeReport,
    activeTitle,
    loadLnkRows: loadLnkOutputRows,
    loadPstoRows: loadPstoOutputRows,
    loadWeldingJournalRows: loadWeldingJournalOutputRows,
    setIsLnkShowMenuOpen,
    setIsPstoShowMenuOpen,
    setIsWeldingJournalShowMenuOpen,
    setMessage,
  })
  useReportModalSyncEffects({
    controlProcessSettings,
    availableLnkRequestRows,
    availablePstoRequestRows,
    heatTreatmentRows,
    isLnkRowsContextReady,
    isLnkRequestModalOpen,
    isLnkResultManagerOpen,
    isLnkResultModalOpen,
    isPstoRowsContextReady,
    isPstoRequestModalOpen,
    isPstoResultManagerOpen,
    isPstoResultModalOpen,
    lnkResultRequestOptions,
    lnkRows,
    managedLnkResultEntries,
    managedLnkResultMethodKey,
    managedLnkResultMethods,
    managedPstoResultRows,
    pstoResultRequestOptions,
    setLnkResultDraft,
    setManagedLnkConclusionDrafts,
    setManagedLnkResultMethodKey,
    setManagedPstoDiagramDrafts,
    setPstoResultDraft,
    setSelectedHeatTreatmentIds,
    setSelectedLnkIds,
  })

  const {
    changeManagedPstoRequest,
    changePstoResultRequest,
    clearManagedPstoRequestPosition,
    closeAddPstoResultModal,
    closeCreatePstoRequestModal,
    deleteManagedPstoRequest,
    deleteManagedPstoResult,
    handleAddPstoResult,
    openAddPstoResultModal,
    openAddPstoResultModalForRow,
    openCreatePstoRequestModal,
    openCreatePstoRequestModalForRow,
    openPstoRequestManager,
    openPstoResultManager,
    openPstoResultManagerForRows,
    renameManagedPstoDiagram,
    renameManagedPstoRequest,
    setPstoResultRows,
    submitCreatePstoRequest,
    toggleAllPstoRequestRows,
    toggleAllPstoResultRows,
    togglePstoRequestRow,
    togglePstoResultRow,
  } = usePstoReportActions({
    rows,
    heatTreatmentRows,
    filteredAvailablePstoRequestRows,
    filteredPstoResultRows,
    managedPstoRequestName,
    managedPstoRequestDate,
    managedPstoRequestNameDraft,
    nextPstoDiagramName,
    nextPstoRequestName,
    nextPstoRequestNumber,
    nextPstoConclusionNumber,
    requestConclusionSettings,
    pstoRequestManagerOptions,
    pstoRequestDate,
    pstoRequestNaming,
    pstoResultDraft,
    pstoResultSaveBlockReason,
    selectedHeatTreatmentRows,
    selectedPstoResultRows,
    saveCheckSettings,
    pstoRequestCorrectionMutation,
    pstoRequestManagerMutation,
    pstoRequestMutation,
    pstoResultCorrectionMutation,
    pstoResultMutation,
    setIsPstoRequestManagerOpen,
    setIsPstoRequestModalOpen,
    setIsPstoResultManagerOpen,
    setIsPstoResultModalOpen,
    setManagedPstoDiagramDrafts,
    setManagedPstoRequestName,
    setManagedPstoRequestDate,
    setManagedPstoRequestNameDraft,
    setMessage,
    setPstoRequestDate,
    setPstoRequestNaming,
    setPstoRequestSearch,
    setPstoResultDraft,
    setPstoResultRequestSearch,
    setSelectedHeatTreatmentIds,
    defaultRequestNaming: defaultPstoRequestNaming,
    defaultConclusionNaming: defaultPstoConclusionNaming,
  })
  const {
    openChainBaseInCurrentReport,
    openChainRowInCurrentReport,
    openLineInDispatcher,
    openLinkedReportRow,
    openRepeatedJointTaskPicture,
    openRowsInReport,
    showRepeatedJointTask,
  } = useJointChainActions({
    activeReport,
    setActiveReport,
    setChainRecord,
    openChainPicture,
    setColumnFilters,
    setHeatTreatmentFilters,
    setLnkFilters,
    setMessage,
    onBeforeReportNavigation: captureReportContext,
  })

  const { changeActiveReport: changeActiveReportUnsafe } = useReportChangeActions({
    setActiveReport,
    setEditing,
  })

  async function changeActiveReport(report: Parameters<typeof changeActiveReportUnsafe>[0]) {
    setMessage(null)
    captureReportContext(report)
    changeActiveReportUnsafe(report)
  }

  const openDuplicateControlModal = () => {
    if (selectedLnkIds.size > DUPLICATE_CONTROL_MASS_SELECTION_LIMIT) {
      setMessage(DUPLICATE_CONTROL_MASS_SELECTION_ERROR)
      return
    }
    const initialRowIds = selectedLnkIds.size > 0 ? new Set(selectedLnkIds) : new Set<number>()
    setIsDuplicateControlRegistryOpen(false)
    setDuplicateControlDraft({
      ...createEmptyDuplicateControlDraft(),
      rowIds: initialRowIds,
    })
    setIsDuplicateControlModalOpen(true)
  }

  const openDuplicateControlModalForRow = useCallback((row: WeldRow) => {
    setIsDuplicateControlRegistryOpen(false)
    setDuplicateControlDraft({
      ...createEmptyDuplicateControlDraft(),
      rowIds: new Set([row.id]),
      search: String(row.joint ?? ''),
    })
    setIsDuplicateControlModalOpen(true)
  }, [setDuplicateControlDraft])

  const closeDuplicateControlModal = () => {
    setIsDuplicateControlModalOpen(false)
    setIsDuplicateControlRegistryOpen(false)
    setIsSelectingDuplicateControlRows(false)
    setDuplicateControlDraft(createEmptyDuplicateControlDraft())
  }

  const toggleDuplicateControlRow = (rowId: number) => {
    if (!duplicateControlDraft.rowIds.has(rowId) &&
      duplicateControlDraft.rowIds.size >= DUPLICATE_CONTROL_MASS_SELECTION_LIMIT) {
      setMessage(DUPLICATE_CONTROL_MASS_SELECTION_ERROR)
      return
    }
    setDuplicateControlDraft((current) => {
      if (current.id) return current
      const rowIds = new Set(current.rowIds)
      if (rowIds.has(rowId)) rowIds.delete(rowId)
      else if (rowIds.size < DUPLICATE_CONTROL_MASS_SELECTION_LIMIT) rowIds.add(rowId)
      return { ...current, rowIds }
    })
  }

  const setVisibleDuplicateControlRowsSelected = async (selected: boolean) => {
    if (duplicateControlDraft.id || isSelectingDuplicateControlRows) return
    const search = duplicateControlDraft.search.trim()
    if (!selected && !search) {
      setDuplicateControlDraft((current) => current.id ? current : { ...current, rowIds: new Set() })
      return
    }
    if (selected && search === debouncedDuplicateControlSearch.trim() &&
      duplicateControlCandidates.totalCount > DUPLICATE_CONTROL_MASS_SELECTION_LIMIT) {
      setMessage(DUPLICATE_CONTROL_MASS_SELECTION_ERROR)
      return
    }

    setIsSelectingDuplicateControlRows(true)
    try {
      const rowIdsForSearch = await listDuplicateControlCandidateIds({ data: { search } })
      if (selected) {
        const combinedIds = new Set([...duplicateControlDraft.rowIds, ...rowIdsForSearch])
        if (combinedIds.size > DUPLICATE_CONTROL_MASS_SELECTION_LIMIT) {
          throw new Error(DUPLICATE_CONTROL_MASS_SELECTION_ERROR)
        }
      }
      setDuplicateControlDraft((current) => {
        if (current.id || current.search.trim() !== search) return current
        const rowIds = new Set(current.rowIds)
        for (const rowId of rowIdsForSearch) {
          if (selected) rowIds.add(rowId)
          else rowIds.delete(rowId)
        }
        if (rowIds.size > DUPLICATE_CONTROL_MASS_SELECTION_LIMIT) return current
        return { ...current, rowIds }
      })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось изменить выбор найденных стыков.')
    } finally {
      setIsSelectingDuplicateControlRows(false)
    }
  }

  const toggleDuplicateControlMethod = (method: DuplicateControlMethod) => {
    setDuplicateControlDraft((current) => {
      if (current.id && !current.methods.has(method)) return current
      const methods = new Set(current.methods)
      if (methods.has(method)) methods.delete(method)
      else methods.add(method)
      return { ...current, methods }
    })
  }

  const editDuplicateControl = async (control: DuplicateControlRecord) => {
    if (!(await requireEditPassword('редактирование дубль-контроля'))) return
    setDuplicateControlDraft({
      id: control.id,
      expectedVersion: String(control.version ?? ''),
      rowIds: new Set([control.weldJointId]),
      methods: new Set([control.method]),
      result: control.result,
      controlDate: control.controlDate,
      conclusion: control.conclusion,
      conclusionDate: control.conclusionDate,
      search: '',
    })
    setIsDuplicateControlModalOpen(true)
  }

  const saveDuplicateControl = async () => {
    if (duplicateControlSaveBlockReason) return
    if (!(await requireEditPassword(duplicateControlDraft.id ? 'сохранение дубль-контроля' : 'создание дубль-контроля'))) return
    const methods = Array.from(duplicateControlDraft.methods)
    const result = duplicateControlDraft.result
    if (!result) return
    const payloads = selectedDuplicateControlRows.flatMap((row) =>
      methods.map((method) => ({
        id: duplicateControlDraft.id,
        expectedVersion: duplicateControlDraft.expectedVersion,
        weldJointId: row.id,
        method,
        result,
        controlDate: duplicateControlDraft.controlDate,
        conclusion: duplicateControlDraft.conclusion,
        conclusionDate: duplicateControlDraft.conclusionDate,
      })),
    )

    await saveDuplicateControlMutation.mutateAsync(payloads)
    if (workflowRootCauseStackRef.current.at(-1)?.destination === 'duplicate-control') {
      completeWorkflowRootCause('duplicate-control')
    } else {
      closeDuplicateControlModal()
    }
    setMessage(duplicateControlDraft.id ? 'Дубль-контроль обновлен' : `Дубль-контроль внесен: ${payloads.length}`)
  }

  const deleteDuplicateControlRecord = async (control: DuplicateControlRecord) => {
    if (!(await requireDeletePassword('удаление дубль-контроля'))) return
    const confirmed = await confirmAction({
      title: 'Удалить дубль-контроль',
      itemName: `${control.method} · ${control.result}`,
      description: 'Запись дубль-контроля будет удалена. Если она влияла на итоговый статус или диспетчер, расчет обновится после удаления.',
      warning: 'Это действие нельзя отменить.',
      confirmLabel: 'Удалить',
      tone: 'danger',
    })
    if (!confirmed) return
    await deleteDuplicateControlMutation.mutateAsync({
      id: control.id,
      expectedVersion: String(control.version ?? ''),
    })
    if (workflowRootCauseStackRef.current.at(-1)?.destination === 'duplicate-control') {
      completeWorkflowRootCause('duplicate-control')
    }
    setMessage('Дубль-контроль удален')
  }

  async function runProtectedEdit<T>(actionLabel: string, action: () => T | Promise<T>) {
    try {
      if (!(await requireEditPassword(actionLabel))) return undefined
      return await action()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Не удалось выполнить действие «${actionLabel}».`)
      return undefined
    }
  }

  async function runProtectedImport(actionLabel: string, action: () => void | Promise<void>) {
    if (!(await requireImportPassword(actionLabel))) return false
    await action()
    return true
  }

  async function runProtectedDelete(actionLabel: string, action: () => void | Promise<void>) {
    try {
      if (!(await requireDeletePassword(actionLabel))) return
      await action()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Не удалось выполнить действие «${actionLabel}».`)
    }
  }

  async function handleProtectedEditRecord(row: WeldRow, fieldKey?: Parameters<typeof handleEditRecord>[1]) {
    const returnPageScrollPosition = getPageScrollPosition()
    await runProtectedEdit('редактирование стыка', async () => {
      const fullRecord = await getWeldJointById({ data: { id: row.id } })
      if (!fullRecord) {
        setMessage('Стык больше не найден. Обновите отчет и повторите действие.')
        return
      }
      handleEditRecord(fullRecord, fieldKey, returnPageScrollPosition)
    })
  }

  async function openWeldEditorFromJointPicture(row: WeldRow) {
    await runProtectedEdit('редактирование стыка', async () => {
      const fullRecord = await getWeldJointById({ data: { id: row.id } })
      if (!fullRecord) {
        setMessage('Стык больше не найден. Обновите картину стыка и повторите действие.')
        return
      }
      captureReportContext('weldingJournal')
      setChainRecord(null)
      setColumnFilters(buildExactJointFilters(fullRecord))
      setActiveReport('weldingJournal')
      setEditing({ record: fullRecord })
    })
  }

  async function deleteWeldRowById(id: number) {
    if (!(await requireDeletePassword('удаление стыка'))) return
    const row = tableActionRows.find((candidate) => candidate.id === id)
    const version = String(row?.rowVersion ?? '').trim()
    if (!row || !version) {
      setMessage('Открытые данные устарели. Обновите отчет и повторите удаление.')
      return
    }
    const confirmed = await confirmAction({
      title: 'Удалить стык',
      itemName: row ? `${String(row.line ?? '-')} · ${String(row.joint ?? '-')}` : 'Запись стыка',
      description: 'Запись будет удалена из сварочного журнала.',
      warning: 'Связанные данные по этому стыку могут стать неактуальными. Это действие нельзя отменить.',
    })
    if (confirmed) deleteMutation.mutate({ id, version })
  }

  async function deleteWeldRowsByIds(ids: number[]) {
    const rowIds = Array.from(new Set(ids)).filter(Number.isFinite)
    if (rowIds.length === 0) return
    if (rowIds.length === 1) {
      await deleteWeldRowById(rowIds[0])
      return
    }

    if (!(await requireDeletePassword('удаление выбранных стыков'))) return
    const confirmed = await confirmAction({
      title: 'Удалить выбранные стыки',
      itemName: `${rowIds.length} стыков`,
      description: 'Выбранные записи будут удалены из сварочного журнала.',
      warning: 'Связанные данные по этим стыкам могут стать неактуальными. Это действие нельзя отменить.',
    })
    if (!confirmed) return

    const rowsById = new Map(tableActionRows.map((row) => [row.id, row]))
    const targets = rowIds.map((id) => ({
      id,
      version: String(rowsById.get(id)?.rowVersion ?? '').trim(),
    }))
    if (targets.some((target) => !target.version)) {
      setMessage('Открытые данные устарели. Обновите отчет и повторите удаление.')
      return
    }

    try {
      await deleteManyMutation.mutateAsync(targets)
      setSelectedWeldingJournalIds((current) => new Set([...current].filter((id) => !rowIds.includes(id))))
      setSelectedLnkIds((current) => new Set([...current].filter((id) => !rowIds.includes(id))))
      setSelectedHeatTreatmentIds((current) => new Set([...current].filter((id) => !rowIds.includes(id))))
      setMessage(`Удалено стыков: ${rowIds.length}`)
    } catch {
      // Текст ошибки уже показывает deleteMutation.onError.
    }
  }

  const openPercentageLineStampRows = (filter: PercentageLineStampFilter) => {
    captureReportContext('weldingJournal')
    setActiveReport('weldingJournal')
    setChainRecord(null)
    setEditing(null)
    setColumnFilters(buildPercentageLineStampFilters(filter))
    setMessage(`Показаны стыки клейма ${filter.stamp} на линии ${filter.line}.`)
  }

  const openReportRowIds = (
    rowIds: number[],
    targetReport: 'weldingJournal' | 'lnk' | 'heatTreatment',
    messageText?: string,
  ) => {
    const uniqueRowIds = Array.from(new Set(rowIds.map(Number))).filter(Number.isFinite)
    if (uniqueRowIds.length === 0) return
    captureReportContext(targetReport)
    setActiveReport(targetReport)
    setChainRecord(null)
    setEditing(null)
    if (targetReport === 'lnk') setLnkFilters(buildRowIdListFilters(uniqueRowIds))
    else if (targetReport === 'heatTreatment') setHeatTreatmentFilters(buildRowIdListFilters(uniqueRowIds))
    else setColumnFilters(buildRowIdListFilters(uniqueRowIds))
    setMessage(messageText || `Показано стыков: ${uniqueRowIds.length}.`)
  }

  const openWeldRowIds = (rowIds: number[], messageText?: string) =>
    openReportRowIds(rowIds, 'weldingJournal', messageText)

  const openGeneratedDocumentRows = (
    rowIds: number[],
    documentTitle: string,
    targetReport: 'weldingJournal' | 'lnk' | 'heatTreatment' = 'weldingJournal',
  ) => {
    const uniqueRowIds = Array.from(new Set(rowIds)).filter(Number.isFinite)
    if (targetReport === 'lnk') {
      captureReportContext('lnk')
      setActiveReport('lnk')
      setChainRecord(null)
      setEditing(null)
      setLnkFilters(buildRowIdListFilters(uniqueRowIds))
      setMessage(`Показаны стыки системного документа ЛНК «${documentTitle}»: ${uniqueRowIds.length}.`)
      return
    }
    if (targetReport === 'heatTreatment') {
      captureReportContext('heatTreatment')
      setActiveReport('heatTreatment')
      setChainRecord(null)
      setEditing(null)
      setHeatTreatmentFilters(buildRowIdListFilters(uniqueRowIds))
      setMessage(`Показаны стыки системного документа ПСТО «${documentTitle}»: ${uniqueRowIds.length}.`)
      return
    }
    openWeldRowIds(
      uniqueRowIds,
      `Показаны стыки ЖСР «${documentTitle}»: ${uniqueRowIds.length}. Строки документа выделены зеленым.`,
    )
    highlightChangedRows(uniqueRowIds.map((id) => ({ id })))
  }

  const openDocumentJointHistory = async (rowId: number) => {
    const row = await getWeldJointById({ data: { id: rowId } })
    if (!row) {
      setMessage('Стык документа больше не найден. Обновите историю документов.')
      return
    }
    setChainRecord(row as WeldRow)
  }

  const assignPercentageLineMissingControls = async (
    scope: PercentageLineControlScope,
    rowIds: number[],
    method: PercentageControlMethod,
  ) => {
    const targetRows = await listWeldJointRowsByIds({ data: { ids: rowIds } })
    if (targetRows.length === 0) {
      setMessage('Стыки для назначения контроля не найдены')
      return
    }

    if (targetRows.length !== new Set(rowIds).size) {
      throw new Error('Часть выбранных стыков уже недоступна. Обновите расчет и повторите действие.')
    }
    if (targetRows.some((row) => !isPercentageControlMethodAvailableForRow(method, row))) {
      throw new Error('ПВК по расчету процентной линии можно назначить только на стык типа «У…».')
    }

    const savedRows = await updatePercentageLineControls({
      data: {
        ...scope,
        action: 'assign',
        method,
        targets: targetRows.map((row) => ({ id: row.id, version: String(row.rowVersion ?? '').trim() })),
      },
    })
    const fieldKey = method === 'УЗК' ? 'hasUzk' : method === 'ПВК' ? 'hasPvk' : 'hasRk'
    highlightChangedRows(savedRows, [fieldKey])
    setMessage(`Назначен ${method} по процентной линии: ${savedRows.length}.`)
    await invalidateWeldJoints(queryClient, { upsertRows: savedRows })
  }

  const cancelPercentageLineMissingControls = async (
    scope: PercentageLineControlScope,
    rowIds: number[],
  ) => {
    const targetRows = await listWeldJointRowsByIds({ data: { ids: rowIds } })
    if (targetRows.length === 0) {
      setMessage('Стыки для закрытия недобора не найдены')
      return
    }

    if (targetRows.length !== new Set(rowIds).size) {
      throw new Error('Часть выбранных стыков уже недоступна. Обновите расчет и повторите действие.')
    }
    const savedRows = await updatePercentageLineControls({
      data: {
        ...scope,
        action: 'cancel',
        targets: targetRows.map((row) => ({ id: row.id, version: String(row.rowVersion ?? '').trim() })),
      },
    })
    highlightChangedRows(savedRows, ['hasRk', 'hasUzk'])
    setMessage(`Недобор закрыт отменой РК/УЗК: ${savedRows.length}.`)
    await invalidateWeldJoints(queryClient, { upsertRows: savedRows })
  }

  const filterLineInCurrentReport = (row: WeldRow) => {
    setChainRecord(null)
    setEditing(null)
    activeFiltersSetter(buildLineFilters(row))
    setMessage(`Показана линия ${String(row.line ?? '-')} в текущем отчете.`)
  }

  const closePstoResultManager = () => {
    setIsPstoResultRegistryAll(false)
    setIsPstoResultManagerOpen(false)
    setManagedPstoDiagramDrafts({})
    setPstoResultRegistrySearch('')
    setPstoResultRegistryLimit(WORKFLOW_REGISTRY_PAGE_SIZE)
  }

  const openAllPstoHistory = () => {
    setIsPstoResultRegistryAll(true)
    setPstoResultRegistrySearch('')
    setPstoResultRegistryLimit(WORKFLOW_REGISTRY_PAGE_SIZE)
    setPstoResultDraft((current) => ({ ...current, rowIds: new Set() }))
    setManagedPstoDiagramDrafts({})
    setIsPstoResultManagerOpen(true)
  }

  const openPstoHistoryFromDialog = (row: WeldRow) => {
    openPstoHistoryRowsFromDialog([row])
  }

  const openPstoHistoryRowsFromDialog = (rowsToOpen: readonly WeldRow[]) => {
    setIsLnkRequestModalOpen(false)
    setIsLnkRequestManagerOpen(false)
    setIsLnkResultModalOpen(false)
    setIsLnkResultManagerOpen(false)
    setIsPreHeatTreatmentResultManagerOpen(false)
    setPreHeatTreatmentLnkWorkflowMode(null)
    setIsPstoRequestModalOpen(false)
    setIsPstoRequestManagerOpen(false)
    setIsPstoResultModalOpen(false)
    setIsPstoResultManagerOpen(false)
    setTvmtWorkflowMode(null)
    setPstoRepeatWorkflowMode(null)
    setIsPstoResultRegistryAll(false)
    openPstoResultManagerForRows(rowsToOpen)
  }

  useReportModalEscapeKey({
    isReportModalOpen,
    isDispatcherWorkspaceOpen,
    isPstoRequestManagerOpen,
    isPstoResultManagerOpen,
    isLnkRequestManagerOpen,
    isLnkResultManagerOpen,
    isLnkStageTransferOpen: Boolean(lnkStageTransferReference),
    isPreHeatTreatmentWorkflowOpen: Boolean(preHeatTreatmentLnkWorkflowMode),
    isPreHeatTreatmentResultManagerOpen,
    isTvmtWorkflowOpen: Boolean(tvmtWorkflowMode),
    isPstoRepeatWorkflowOpen: Boolean(pstoRepeatWorkflowMode),
    isPstoLineProgramOpen,
    isRkExposureModalOpen: Boolean(rkExposureEditing),
    isPstoResultModalOpen,
    isPstoRequestModalOpen,
    isLnkOfficialityModalOpen,
    isDuplicateControlModalOpen,
    isLnkResultModalOpen,
    isLnkRequestModalOpen,
    isReportImportModalOpen: isImportDialogOpen,
    canClosePstoRequestManager: !pstoRequestManagerMutation.isPending && !pstoRequestCorrectionMutation.isPending,
    canClosePstoResultManager:
      !pstoResultCorrectionMutation.isPending &&
      !pstoCycleCorrectionMutation.isPending &&
      !pstoTvmtCorrectionWithLaterCycleRemovalMutation.isPending,
    canCloseLnkRequestManager: !lnkRequestManagerMutation.isPending && !lnkRequestCorrectionMutation.isPending,
    canCloseLnkResultManager:
      !lnkResultCorrectionMutation.isPending &&
      !lnkResultReplacementMutation.isPending &&
      !lnkConclusionCorrectionMutation.isPending,
    canCloseLnkStageTransfer: !isLnkStageTransferPending,
    canClosePreHeatTreatmentResultManager: !preHeatTreatmentResultCorrectionMutation.isPending,
    canCloseRkExposureModal: !rkExposureMutation.isPending,
    onClosePstoRequestManager: () => setIsPstoRequestManagerOpen(false),
    onClosePstoResultManager: closePstoResultManager,
    onCloseLnkRequestManager: () => setIsLnkRequestManagerOpen(false),
    onCloseLnkResultManager: closeLnkResultManager,
    onCloseLnkStageTransfer: () => setLnkStageTransferReference(null),
    onClosePreHeatTreatmentWorkflow: () => setPreHeatTreatmentLnkWorkflowMode(null),
    onClosePreHeatTreatmentResultManager: () => setIsPreHeatTreatmentResultManagerOpen(false),
    onCloseTvmtWorkflow: () => setTvmtWorkflowMode(null),
    onClosePstoRepeatWorkflow: () => setPstoRepeatWorkflowMode(null),
    onClosePstoLineProgram: () => setIsPstoLineProgramOpen(false),
    onCloseRkExposureModal: () => setRkExposureEditing(null),
    onClosePstoResultModal: closeAddPstoResultModal,
    onClosePstoRequestModal: closeCreatePstoRequestModal,
    onCloseLnkOfficialityModal: closeLnkOfficialityModal,
    onCloseDuplicateControlModal: closeDuplicateControlModal,
    onCloseLnkResultModal: closeAddLnkResultModal,
    onCloseLnkRequestModal: closeCreateLnkRequestModal,
    onCloseReportImportModal: () => setIsImportDialogOpen(false),
    onCloseDispatcherWorkspace: () => setIsDispatcherWorkspaceOpen(false),
  })

  const dispatcherTaskCardProps = createDispatcherTaskCardHandlers({
    activeReport,
    isTaskExpanded: isRepeatedJointTaskExpanded,
    onToggleDetails: toggleRepeatedJointTaskDetails,
    onShowTask: showRepeatedJointTask,
    onOpenTaskPicture: openRepeatedJointTaskPicture,
    onOpenTaskOfficiality: openDispatcherTaskOfficiality,
    onCreateTask: createRepeatedJoint,
    onCreateEarlyCoil: (task) => runProtectedEdit('досрочная врезка катушки', () => createEarlyCoil(task)),
    onDeleteTask: (task) => runProtectedDelete('удаление повторного стыка', () => deleteObsoleteRepeatedJoint(task)),
    onRenameTask: (task) => runProtectedEdit('переименование стыка', () => renameObsoleteRepeatedJoint(task)),
    onAcceptPercentageLineTask: acceptPercentageLineTask,
    onEditPercentageLineTaskStamp: (task) => runProtectedEdit('редактирование клейма стыка', () => editPercentageLineTaskStamp(task)),
    onSuspendPercentageLineWelder: (task) =>
      runProtectedEdit('добавление отстранения сварщика', () => openWelderSuspensionFromPercentageLineTask(task)),
    onSkipPercentageLineWelderSuspension: skipWelderSuspensionFromPercentageLineTask,
    onRunTaskAction: (task, actionId) => {
      void runDispatcherTaskAction(task.row, task, actionId)
    },
    isCreatePending: repeatedJointMutation.isPending,
    isEarlyCoilPending: earlyCoilMutation.isPending,
    isDeletePending: obsoleteRepeatedJointMutation.isPending,
    isRenamePending: renameRepeatedJointMutation.isPending,
  })

  const rowActionHandlers = createReportRowActionHandlers({
    openCreatePstoRequestModalForRow: (row) => {
      setSelectedHeatTreatmentIds(new Set([row.id]))
      openPstoRepeatWorkflow('request')
    },
    openAddPstoResultModalForRow: (row) => {
      setSelectedHeatTreatmentIds(new Set([row.id]))
      openPstoRepeatWorkflow('result')
    },
    openCreateLnkRequestModalForRow: openCreateLnkWorkflowRequestForRow,
    openAddLnkResultModalForRow: openAddLnkWorkflowResultForRow,
  })

  const openLnkOfficialityModalForRow = (
    row: WeldRow,
    officiality: 'official' | 'unofficial' | '' = '',
  ) => {
    setLnkOfficialityDraft({
      rowIds: new Set([row.id]),
      search: String(row.joint ?? row.line ?? ''),
      officiality,
    })
    setIsLnkOfficialityModalOpen(true)
  }

  const openLnkOfficialityWorkflowForRow = (
    row: WeldRow,
    officiality: 'official' | 'unofficial',
  ) => {
    captureReportContext('lnk')
    setChainRecord(null)
    setActiveReport('lnk')
    openLnkOfficialityModalForRow(row, officiality)
    setMessage(
      `Стык ${String(row.joint ?? '-')} выбран в окне официальности ЛНК.`,
    )
  }

  const getCommonLnkRequests = (selectedRows: WeldRow[]) => {
    if (selectedRows.length === 0) return []
    const [firstRow, ...restRows] = selectedRows
    const firstRequests = getLnkRequestDocumentIdentities([firstRow])
    const common = new Set(firstRequests.map((request) => request.key))
    for (const selectedRow of restRows) {
      const keys = new Set(getLnkRequestDocumentIdentities([selectedRow]).map((request) => request.key))
      for (const key of [...common]) {
        if (!keys.has(key)) common.delete(key)
      }
    }
    return firstRequests.filter((request) => common.has(request.key))
  }

  const areRowsOnSameLine = (selectedRows: WeldRow[]) => {
    if (selectedRows.length <= 1) return true
    const first = selectedRows[0]
    return selectedRows.every(
      (selectedRow) =>
        String(selectedRow.projectTitle ?? '').trim() === String(first.projectTitle ?? '').trim() &&
        String(selectedRow.subtitleCode ?? '').trim() === String(first.subtitleCode ?? '').trim() &&
        String(selectedRow.line ?? '').trim() === String(first.line ?? '').trim(),
    )
  }

  const filterRowsLineInCurrentReport = (selectedRows: WeldRow[]) => {
    if (selectedRows.length === 0) return
    if (!areRowsOnSameLine(selectedRows)) {
      setMessage('Выбранные стыки относятся к разным линиям')
      return
    }
    filterLineInCurrentReport(selectedRows[0])
  }

  const filterSelectedRowsInCurrentReport = (selectedRows: WeldRow[]) => {
    const rowIds = selectedRows.map((selectedRow) => selectedRow.id)
    if (rowIds.length === 0) return
    activeFiltersSetter({
      ...activeColumnFilters,
      ...buildRowIdListFilters(rowIds),
    } as typeof activeColumnFilters)
    setMessage(`Показаны выбранные стыки: ${rowIds.length}.`)
  }

  const filterSystemDocumentRowsInCurrentReport = async (
    reference: SystemDocumentReference,
  ) => {
    setMessage(`Загружаем стыки документа «${reference.title}»...`)
    try {
      const { loadSystemDocumentRows } = await import('@/lib/system-document-storage')
      const documentRows = await loadSystemDocumentRows(reference)
      const rowIds = Array.from(new Set(documentRows.map((documentRow) => documentRow.id)))
        .filter(Number.isFinite)
      if (rowIds.length === 0) {
        setMessage(`В документе «${reference.title}» больше нет стыков.`)
        return
      }
      activeFiltersSetter(buildRowIdListFilters(rowIds) as typeof activeColumnFilters)
      setMessage(`Показаны все стыки документа «${reference.title}»: ${rowIds.length}.`)
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : `Не удалось загрузить стыки документа «${reference.title}».`,
      )
    }
  }

  const activeSelectedRowIds =
    activeReport === 'lnk'
      ? selectedLnkIds
      : activeReport === 'heatTreatment'
        ? selectedHeatTreatmentIds
        : selectedWeldingJournalIds
  const setActiveSelectedRowIds =
    activeReport === 'lnk'
      ? setSelectedLnkIds
      : activeReport === 'heatTreatment'
        ? setSelectedHeatTreatmentIds
        : setSelectedWeldingJournalIds

  const openLnkResultModalForRows = (selectedRows: WeldRow[]) => {
    if (selectedRows.length <= 1) {
      openAddLnkResultModalForRow(selectedRows[0])
      return
    }
    if (selectedRows.some((selectedRow) => getLnkRowRequestNames(selectedRow).length === 0)) {
      setMessage('Для части выбранных стыков нет заявки ЛНК')
      return
    }

    const commonRequests = getCommonLnkRequests(selectedRows)
    const request = commonRequests.length === 1 ? commonRequests[0] : null
    setPreservedLnkOrderIds(lnkRows.map((lnkRow) => lnkRow.id))
    setLnkResultDraft({
      ...createDefaultLnkResultDraft(defaultLnkConclusionNaming),
      requestName: request?.name ?? '',
      requestDate: request?.date ?? '',
      rowIds: new Set(selectedRows.map((selectedRow) => selectedRow.id)),
      search: '',
    })
    setIsLnkResultModalOpen(true)
  }

  const openPstoResultModalForRows = (selectedRows: WeldRow[]) => {
    setSelectedHeatTreatmentIds(new Set(selectedRows.map((selectedRow) => selectedRow.id)))
    openPstoRepeatWorkflow('result')
  }

  const openLnkOfficialityModalForRows = (selectedRows: WeldRow[]) => {
    if (selectedRows.length <= 1) {
      openLnkOfficialityModalForRow(selectedRows[0])
      return
    }
    setLnkOfficialityDraft({
      rowIds: new Set(selectedRows.map((selectedRow) => selectedRow.id)),
      search: '',
      officiality: '',
    })
    setIsLnkOfficialityModalOpen(true)
  }

  const openDuplicateControlModalForRows = (selectedRows: WeldRow[]) => {
    if (selectedRows.length <= 1) {
      openDuplicateControlModalForRow(selectedRows[0])
      return
    }
    setDuplicateControlDraft({
      ...createEmptyDuplicateControlDraft(),
      rowIds: new Set(selectedRows.map((selectedRow) => selectedRow.id)),
    })
    setIsDuplicateControlModalOpen(true)
  }

  const getLnkRequestGroupDisabledReason = (selectedRows: WeldRow[]) => {
    if (selectedRows.length === 0) return 'Выберите хотя бы один стык'
    if (selectedRows.length === 1) {
      return canCreateLnkWorkflowRequest(selectedRows[0])
        ? undefined
        : 'Все назначенные виды НК этого стыка уже находятся в заявках'
    }
    const creatableCount = selectedRows.filter(canCreateLnkWorkflowRequest).length
    if (creatableCount > 0 && creatableCount < selectedRows.length) {
      return 'Часть стыков требует создания заявки, а часть уже находится в заявке'
    }
    if (creatableCount === selectedRows.length) {
      return getCommonLnkRequestStage(selectedRows)
        ? undefined
        : 'Выбранные стыки требуют заявок на разных этапах ЛНК'
    }
    return 'Все назначенные виды НК выбранных стыков уже находятся в заявках'
  }

  const getSelectedRowsReportCount = (selectedRows: WeldRow[], report: 'weldingJournal' | 'lnk' | 'heatTreatment') => {
    if (report === 'weldingJournal') return selectedRows.length
    if (report === 'heatTreatment') return buildHeatTreatmentReportRows(selectedRows).length
    return buildLnkReportRows(selectedRows).length
  }

  const getReportContextMenuItems = (
    row: WeldRow,
    selectedRows: WeldRow[] = [row],
    fieldKey?: WeldFieldKey,
  ): ContextActionMenuItem[] => {
    const contextRows = selectedRows.length > 0 ? selectedRows : [row]
    const isGroupAction = contextRows.length > 1
    const sameLine = areRowsOnSameLine(contextRows)
    const labelSuffix = isGroupAction ? ` (${contextRows.length})` : ''
    const lnkReportCount = getSelectedRowsReportCount(contextRows, 'lnk')
    const pstoReportCount = getSelectedRowsReportCount(contextRows, 'heatTreatment')
    const weldingJournalReportCount = getSelectedRowsReportCount(contextRows, 'weldingJournal')
    const getReportLabel = (label: string, count: number) => `${label}${isGroupAction ? ` (${count})` : ''}`
    const getEmptyReportReason = (count: number, reportLabel: string) =>
      isGroupAction && count === 0 ? `Среди выбранных стыков нет строк в отчете ${reportLabel}` : undefined
    const lnkRequestDisabledReason = activeReport === 'lnk' ? getLnkRequestGroupDisabledReason(contextRows) : undefined
    const exactLnkRequest =
      activeReport === 'lnk' && !isGroupAction
        ? getLnkRequestIdentityForField(row, fieldKey)
        : null
    const rowLnkRequests = activeReport === 'lnk'
      ? getLnkRequestNavigationEntries(contextRows)
      : []
    const exactLnkResultMethod = activeReport === 'lnk' && !isGroupAction
      ? getLnkResultMethodForField(fieldKey)
      : undefined
    const exactLnkResult = activeReport === 'lnk' && !isGroupAction
      ? getLnkResultNavigationEntryForField(row, fieldKey)
      : null
    const pendingLnkResultMethods = activeReport === 'lnk' && !isGroupAction
      ? getPendingLnkResultMethods(row)
      : []
    const exactPreHeatTreatmentField = activeReport === 'lnk' && !isGroupAction && fieldKey
      ? getPreHeatTreatmentReportField(fieldKey)
      : undefined
    const exactPreHeatTreatmentControl = exactPreHeatTreatmentField
      ? getPreHeatTreatmentControl(row, exactPreHeatTreatmentField.methodCode)
      : undefined
    const preHeatTreatmentControlRows = activeReport === 'lnk'
      ? contextRows.filter((candidate) => getPreHeatTreatmentControls(candidate).some((control) =>
          Boolean(String(control.requestName ?? '').trim()),
        ))
      : []
    const lnkResultDisabledReason =
      activeReport === 'lnk' && contextRows.some((selectedRow) => getLnkRowRequestNames(selectedRow).length === 0)
        ? 'Сначала создайте заявку ЛНК для всех выбранных стыков'
        : undefined

    const items: ContextActionMenuItem[] = []
    const documentNavigationReference = fieldKey
      ? getDocumentNavigationReferenceForField(row, fieldKey)
      : null
    const systemDocumentReference = fieldKey
      ? getSystemDocumentReferenceForField(row, fieldKey)
      : null
    const lnkStageTransferReferences = activeReport === 'lnk' && !isGroupAction
      ? getLnkStageTransferReferences(row, fieldKey)
      : []

    if (documentNavigationReference) {
      items.push(
        { type: 'label', id: 'document-navigation-label', label: 'Документ' },
        {
          id: 'open-in-documents',
          label: 'Открыть в документах',
          icon: FileText,
          onSelect: () => {
            captureReportContext('documents')
            setDocumentNavigationRequest({
              requestId: Date.now(),
              ...documentNavigationReference,
            })
            setChainRecord(null)
            setEditing(null)
            setActiveReport('documents')
          },
        },
        ...(systemDocumentReference ? [{
          id: 'filter-system-document-rows',
          label: 'Показать все стыки документа',
          icon: ListFilter,
          onSelect: () => {
            void filterSystemDocumentRowsInCurrentReport(systemDocumentReference)
          },
        } satisfies ContextActionMenuItem] : []),
        { type: 'separator', id: 'document-navigation-separator' },
      )
    }

    if (activeReport === 'weldingJournal' && activeSelectedRowIds.has(row.id)) {
      items.push(
        { type: 'label', id: 'selection-actions-label', label: 'Выбранные строки' },
        {
          id: 'filter-selected',
          label: `Фильтр выбранных${labelSuffix}`,
          icon: ListFilter,
          onSelect: () => filterSelectedRowsInCurrentReport(contextRows),
        },
        {
          id: 'generate-selected',
          label: 'Сформировать',
          icon: FileSpreadsheet,
          onSelect: () => undefined,
          children: [
            {
              id: 'generate-selected-welding-journal',
              label: 'ЖСР',
              icon: FileSpreadsheet,
              onSelect: () => generateWeldingJournalDocumentForRows(contextRows),
            },
            {
              id: 'generate-selected-checklist',
              label: 'Чек-лист',
              icon: FileSpreadsheet,
              onSelect: () => generateChecklistDocumentForRows(contextRows),
            },
            {
              id: 'generate-selected-zni',
              label: 'ЗНИ',
              icon: FileSpreadsheet,
              onSelect: () => generateZniDocumentForRows(contextRows),
            },
          ],
        },
        { type: 'separator', id: 'selection-filter-separator' },
      )
    }

    items.push(
      { type: 'label', id: 'navigation-label', label: 'Переходы' },
      {
        id: 'open-chain',
        label: 'Картина стыка',
        description: 'Полная хронология, активные СП/ДЗ и следующий доступный шаг.',
        icon: GitBranch,
        disabled: isGroupAction,
        title: isGroupAction ? 'Картину можно открыть только для одного стыка' : undefined,
        onSelect: () => setChainRecord(row),
      },
      {
        id: 'open-line',
        label: 'Открыть линию',
        icon: ListFilter,
        disabled: !sameLine,
        title: sameLine ? undefined : 'Выбранные стыки относятся к разным линиям',
        onSelect: () => filterRowsLineInCurrentReport(contextRows),
      },
    )

    if (activeReport === 'weldingJournal') {
      items.push(
        {
          id: 'open-lnk',
          label: getReportLabel('Открыть в ЛНК', lnkReportCount),
          icon: ExternalLink,
          disabled: Boolean(getEmptyReportReason(lnkReportCount, 'ЛНК')),
          title: getEmptyReportReason(lnkReportCount, 'ЛНК'),
          onSelect: () => openRowsInReport(contextRows, 'lnk'),
        },
        {
          id: 'open-psto',
          label: getReportLabel('Открыть в ПСТО', pstoReportCount),
          icon: ExternalLink,
          disabled: Boolean(getEmptyReportReason(pstoReportCount, 'ПСТО')),
          title: getEmptyReportReason(pstoReportCount, 'ПСТО'),
          onSelect: () => openRowsInReport(contextRows, 'heatTreatment'),
        },
        { type: 'separator', id: 'edit-separator' },
        { type: 'label', id: 'edit-actions-label', label: 'Работа со стыком' },
        {
          id: 'edit-row',
          label: 'Редактировать стык',
          icon: Pencil,
          disabled: isGroupAction,
          title: isGroupAction ? 'Редактирование открывается только для одного стыка' : undefined,
          onSelect: () => handleProtectedEditRecord(row),
        },
        { type: 'separator', id: 'danger-actions-separator' },
        { type: 'label', id: 'danger-actions-label', label: 'Опасные действия' },
        {
          id: 'delete-row',
          label: isGroupAction ? `Удалить выбранные (${contextRows.length})` : 'Удалить стык',
          icon: Trash2,
          danger: true,
          onSelect: () => deleteWeldRowsByIds(contextRows.map((selectedRow) => selectedRow.id)),
        },
      )
      return items
    }

    items.push(
      {
        id: 'open-welding-journal',
        label: getReportLabel('Открыть в сварочном журнале', weldingJournalReportCount),
        icon: ExternalLink,
        disabled: Boolean(getEmptyReportReason(weldingJournalReportCount, 'сварочного журнала')),
        title: getEmptyReportReason(weldingJournalReportCount, 'сварочного журнала'),
        onSelect: () => openRowsInReport(contextRows, 'weldingJournal'),
      },
      {
        id: activeReport === 'lnk' ? 'open-psto' : 'open-lnk',
        label:
          activeReport === 'lnk'
            ? getReportLabel('Открыть в ПСТО', pstoReportCount)
            : getReportLabel('Открыть в ЛНК', lnkReportCount),
        icon: ExternalLink,
        disabled: Boolean(
          activeReport === 'lnk' ? getEmptyReportReason(pstoReportCount, 'ПСТО') : getEmptyReportReason(lnkReportCount, 'ЛНК'),
        ),
        title: activeReport === 'lnk' ? getEmptyReportReason(pstoReportCount, 'ПСТО') : getEmptyReportReason(lnkReportCount, 'ЛНК'),
        onSelect: () => openRowsInReport(contextRows, activeReport === 'lnk' ? 'heatTreatment' : 'lnk'),
      },
      { type: 'separator', id: 'report-actions-separator' },
    )

    if (activeReport === 'lnk') {
      const hasFinalPreHeatTreatmentResult = (value: unknown) => {
        const normalized = String(value ?? '').trim().toLocaleLowerCase('ru-RU')
        return PRE_HEAT_TREATMENT_RESULT_OPTIONS.some((result) => result === normalized)
      }
      const exactPreRequestExists = Boolean(String(exactPreHeatTreatmentControl?.requestName ?? '').trim())
      const exactPreResultExists = hasFinalPreHeatTreatmentResult(exactPreHeatTreatmentControl?.result)
      const preHeatTreatmentResultRows = contextRows.filter((candidate) => (
        getPreHeatTreatmentControls(candidate).some((control) => hasFinalPreHeatTreatmentResult(control.result))
      ))
      const primaryResultRows = contextRows.filter((candidate) => (
        getLnkResultNavigationEntries(candidate).length > 0
      ))
      const exactPrimaryResultPending = Boolean(
        exactLnkResultMethod && pendingLnkResultMethods.some(
          (method) => method.requestKey === exactLnkResultMethod.requestKey,
        ),
      )
      const commonResultStage = getCommonLnkResultStage(contextRows)
      const canCreateExactPreRequest = Boolean(
        controlProcessSettings.preHeatTreatmentLnkEnabled &&
        exactPreHeatTreatmentField &&
        canCreatePreHeatTreatmentRequest(row, exactPreHeatTreatmentField.methodCode),
      )
      const canAddExactPreResult = Boolean(
        controlProcessSettings.preHeatTreatmentLnkEnabled &&
        exactPreHeatTreatmentField &&
        canAddPreHeatTreatmentResult(row, exactPreHeatTreatmentField.methodCode),
      )
      const contextRequestStage = exactPreHeatTreatmentField
        ? PRE_HEAT_TREATMENT_LNK_CONTROL_STAGE
        : getCommonLnkRequestStage(contextRows)
      const canCreateContextRequest = exactPreHeatTreatmentField
        ? canCreateExactPreRequest
        : contextRows.every(canCreateLnkWorkflowRequest) && Boolean(contextRequestStage)
      const hasPreHeatTreatmentRequestOption = lnkWorkflowSummaryQuery.data
        ? lnkWorkflowSummaryQuery.data.preHeatTreatmentRequestRowCount > 0
        : lnkRows.some((candidate) => (
            getPreHeatTreatmentControls(candidate).some((control) => Boolean(String(control.requestName ?? '').trim()))
          ))
      const hasContextRequestExtensionOption = contextRequestStage === PRE_HEAT_TREATMENT_LNK_CONTROL_STAGE
        ? hasPreHeatTreatmentRequestOption
        : lnkRequestExtensionOptions.length > 0
      const canAddContextResult = exactPreHeatTreatmentField
        ? canAddExactPreResult
        : exactPrimaryResultPending || Boolean(commonResultStage)

      const openContextRequest = (submitMode: LnkRequestComposerMode) => {
        if (exactPreHeatTreatmentField) {
          setSelectedLnkIds(new Set([row.id]))
          openPreHeatTreatmentLnkWorkflow(
            'request',
            exactPreHeatTreatmentField.methodCode,
            submitMode,
          )
          return
        }
        if (submitMode === 'extend') {
          if (contextRequestStage === PRE_HEAT_TREATMENT_LNK_CONTROL_STAGE) {
            setSelectedLnkIds(new Set(contextRows.map((candidate) => candidate.id)))
            openPreHeatTreatmentLnkWorkflow('request', undefined, 'extend')
            return
          }
          openExtendLnkRequestModalForRows(contextRows)
          return
        }
        openCreateLnkWorkflowRequestForRows(contextRows)
      }
      const openContextResult = () => {
        if (exactPreHeatTreatmentField) {
          setSelectedLnkIds(new Set([row.id]))
          openPreHeatTreatmentLnkWorkflow('result', exactPreHeatTreatmentField.methodCode)
          return
        }
        if (exactLnkResultMethod && exactPrimaryResultPending) {
          openAddLnkResultModalForMethod(row, exactLnkResultMethod.requestKey)
          return
        }
        if (commonResultStage === PRE_HEAT_TREATMENT_LNK_CONTROL_STAGE) {
          setSelectedLnkIds(new Set(contextRows.map((candidate) => candidate.id)))
          openPreHeatTreatmentLnkWorkflow('result')
          return
        }
        openLnkResultModalForRows(contextRows)
      }
      const openPrimaryRequestEditor = () => {
        const request = exactLnkRequest ?? (rowLnkRequests.length === 1 ? rowLnkRequests[0] : null)
        openLnkRequestRegistry(request?.name, request?.date)
      }
      const primaryEditingActions: ContextActionMenuItem[] = []
      if (rowLnkRequests.length > 0) {
        primaryEditingActions.push({
          id: 'lnk-request-edit-primary',
          label: 'Заявка · Основной',
          icon: FilePlus2,
          onSelect: openPrimaryRequestEditor,
        })
      }
      if (primaryResultRows.length > 0) {
        primaryEditingActions.push({
          id: 'lnk-result-edit-primary',
          label: 'Результат и заключение · Основной',
          icon: ClipboardCheck,
          onSelect: () => exactLnkResult
            ? openExactLnkResult(row, exactLnkResult.methodKey)
            : openLnkResultRegistryForRows(primaryResultRows),
        })
      }
      const preEditingActions: ContextActionMenuItem[] = []
      if (preHeatTreatmentControlRows.length > 0) {
        preEditingActions.push({
          id: 'lnk-request-edit-before-heat-treatment',
          label: 'Заявка · До ТО',
          icon: FilePlus2,
          onSelect: () => openPreHeatTreatmentResultRegistry({
            rowIds: contextRows.map((candidate) => candidate.id),
            relationId: exactPreRequestExists ? exactPreHeatTreatmentControl?.id ?? null : null,
            registryMode: 'request',
          }),
        })
      }
      if (preHeatTreatmentResultRows.length > 0) {
        preEditingActions.push({
          id: 'lnk-result-edit-before-heat-treatment',
          label: 'Результат и заключение · До ТО',
          icon: ClipboardCheck,
          onSelect: () => openPreHeatTreatmentResultRegistry({
            rowIds: contextRows.map((candidate) => candidate.id),
            relationId: exactPreResultExists ? exactPreHeatTreatmentControl?.id ?? null : null,
            registryMode: 'result',
          }),
        })
      }

      items.push(...buildWorkflowContextMenuItems({
        requests: [
          {
            id: 'lnk-request-create',
            label: isGroupAction ? `Новая заявка для выбранных (${contextRows.length})` : 'Новая заявка',
            icon: FilePlus2,
            disabled: !canCreateContextRequest,
            title: canCreateContextRequest
              ? undefined
              : exactPreHeatTreatmentField
                ? 'Эта позиция НК до ТО недоступна для новой заявки'
                : lnkRequestDisabledReason ?? 'Выбранные стыки требуют заявок на разных этапах ЛНК',
            onSelect: () => openContextRequest('create'),
          },
          {
            id: 'lnk-request-extend',
            label: isGroupAction ? `Добавить выбранные (${contextRows.length}) в существующую` : 'Добавить в существующую',
            icon: ListFilter,
            disabled: !canCreateContextRequest || !hasContextRequestExtensionOption,
            title: !canCreateContextRequest
              ? lnkRequestDisabledReason ?? 'Нет доступных позиций для добавления'
              : !hasContextRequestExtensionOption
                ? contextRequestStage === PRE_HEAT_TREATMENT_LNK_CONTROL_STAGE
                  ? 'Созданных заявок ЛНК до ТО пока нет'
                  : 'Созданных основных заявок ЛНК пока нет'
                : undefined,
            onSelect: () => openContextRequest('extend'),
          },
          {
            id: 'lnk-request-registry',
            label: 'Все заявки',
            icon: ListFilter,
            onSelect: () => exactPreHeatTreatmentField
              ? openPreHeatTreatmentResultRegistry({ registryMode: 'request' })
              : openLnkRequestRegistry(),
          },
        ],
        results: [
          {
            id: 'lnk-result-add',
            label: isGroupAction ? `Внести результаты выбранных (${contextRows.length})` : 'Внести результат',
            icon: ClipboardCheck,
            disabled: !canAddContextResult,
            title: canAddContextResult
              ? undefined
              : exactPreHeatTreatmentField
                ? 'Сначала создайте заявку этого вида НК до ТО'
                : lnkResultDisabledReason ?? 'Нет заявок, ожидающих результата на одном этапе ЛНК',
            onSelect: openContextResult,
          },
          {
            id: 'lnk-result-registry',
            label: 'Все результаты',
            icon: ListFilter,
            disabled: exactPreHeatTreatmentField
              ? !hasPreHeatTreatmentResultRegistryRows
              : false,
            title: exactPreHeatTreatmentField && !hasPreHeatTreatmentResultRegistryRows
              ? 'Результатов НК до ТО пока нет'
              : undefined,
            onSelect: () => exactPreHeatTreatmentField
              ? openPreHeatTreatmentResultRegistry({ registryMode: 'result' })
              : openAllLnkResultRegistry(),
          },
        ],
        editing: exactPreHeatTreatmentField
          ? [...preEditingActions, ...primaryEditingActions]
          : [...primaryEditingActions, ...preEditingActions],
        additional: [
          {
            id: 'lnk-change-control-stage',
            label: 'Изменить этап контроля',
            icon: ArrowLeftRight,
            disabled:
              !controlProcessSettings.preHeatTreatmentLnkEnabled ||
              isGroupAction ||
              lnkStageTransferReferences.length === 0,
            title: !controlProcessSettings.preHeatTreatmentLnkEnabled
              ? 'Процесс «НК до ТО» выключен в настройках проекта'
              : isGroupAction
                ? 'Этап изменяется для одного исходного документа за операцию'
                : lnkStageTransferReferences.length === 0
                  ? 'У стыка нет подходящей заявки или заключения ЛНК'
                  : undefined,
            onSelect: () => {
              if (lnkStageTransferReferences.length === 1) {
                setLnkStageTransferReference(lnkStageTransferReferences[0]!)
              }
            },
            ...(lnkStageTransferReferences.length > 1
              ? {
                  children: lnkStageTransferReferences.map((reference) => ({
                    id: `lnk-change-control-stage:${reference.documentId}`,
                    label: formatLnkStageTransferReference(reference),
                    icon: ArrowLeftRight,
                    onSelect: () => setLnkStageTransferReference(reference),
                  })),
                }
              : {}),
          },
          {
            id: 'lnk-officiality',
            label: 'Официальность',
            icon: BadgeCheck,
            onSelect: () => openLnkOfficialityModalForRows(contextRows),
          },
          {
            id: 'duplicate-control',
            label: 'Дубль-контроль',
            icon: ClipboardCheck,
            onSelect: () => openDuplicateControlModalForRows(contextRows),
          },
        ],
      }))
      return items
    }

    if (activeReport === 'heatTreatment') {
      const hasPstoRequestCandidate = contextRows.some((candidate) => (
        canCreatePstoWorkflowRequest(candidate)
      ))
      const hasPstoResultCandidate = contextRows.some((candidate) => (
        canAddPstoWorkflowResult(candidate)
      ))
      const hasTvmtRequestCandidate = contextRows.some(canCreateTvmtRequest)
      const hasTvmtResultCandidate = contextRows.some(canAddTvmtResult)
      const pstoCycleHistoryItem = buildPstoCycleHistoryContextMenuItem({
        rows: contextRows,
        onOpen: (rows) => {
          setIsPstoResultRegistryAll(false)
          openPstoResultManagerForRows(rows)
        },
      })
      const hasPstoHistory = !pstoCycleHistoryItem.disabled
      items.push(pstoCycleHistoryItem)
      items.push(...buildWorkflowContextMenuItems({
        requests: [
          {
            id: 'psto-request-create',
            label: 'Новая заявка · ПСТО',
            icon: FilePlus2,
            disabled: !hasPstoRequestCandidate,
            title: hasPstoRequestCandidate ? undefined : 'Нет стыков, ожидающих заявку ПСТО',
            onSelect: () => {
              setSelectedHeatTreatmentIds(new Set(contextRows.map((candidate) => candidate.id)))
              openPstoRepeatWorkflow('request')
            },
          },
          {
            id: 'tvmt-request-create',
            label: 'Новая заявка · ТВМТ',
            icon: FilePlus2,
            disabled: !hasTvmtRequestCandidate,
            title: hasTvmtRequestCandidate ? undefined : 'Нет проведенной ПСТО, ожидающей заявку ТВМТ',
            onSelect: () => {
              setSelectedHeatTreatmentIds(new Set(contextRows.map((candidate) => candidate.id)))
              openTvmtWorkflow('request')
            },
          },
          {
            id: 'psto-request-registry',
            label: 'Все заявки',
            icon: ListFilter,
            disabled: !hasPstoHistory,
            title: hasPstoHistory ? undefined : 'История ПСТО и ТВМТ пока пуста',
            onSelect: openAllPstoHistory,
          },
        ],
        results: [
          {
            id: 'psto-result-create',
            label: 'Внести результат · ПСТО',
            icon: ClipboardCheck,
            disabled: !hasPstoResultCandidate,
            title: hasPstoResultCandidate ? undefined : 'Нет заявок ПСТО, ожидающих результата',
            onSelect: () => {
              setSelectedHeatTreatmentIds(new Set(contextRows.map((candidate) => candidate.id)))
              openPstoRepeatWorkflow('result')
            },
          },
          {
            id: 'tvmt-result-create',
            label: 'Внести результат · ТВМТ',
            icon: ClipboardCheck,
            disabled: !hasTvmtResultCandidate,
            title: hasTvmtResultCandidate ? undefined : 'Нет заявок ТВМТ, ожидающих результата',
            onSelect: () => {
              setSelectedHeatTreatmentIds(new Set(contextRows.map((candidate) => candidate.id)))
              openTvmtWorkflow('result')
            },
          },
          {
            id: 'psto-result-registry',
            label: 'Все результаты',
            icon: ListFilter,
            disabled: !hasPstoHistory,
            title: hasPstoHistory ? undefined : 'История ПСТО и ТВМТ пока пуста',
            onSelect: openAllPstoHistory,
          },
        ],
        editing: [],
      }))
    }

    return items
  }

  const weldTableProps = createWeldTableProps({
    activeReport,
    rows: isServerPagedTab ? pagedReportRows : (visibleRows as WeldRow[]),
    actionRows: tableActionRows,
    duplicateRows: tableActionRows,
    duplicateKeyOverrides: tableDuplicateKeys,
    filterOptionRows: isServerPagedTab ? undefined : (visibleRows as WeldRow[]),
    columnFilters: activeColumnFilters,
    manualFiltering: isServerPagedTab,
    manualFilterOptionsReport: isServerPagedTab ? activeReport : undefined,
    manualPagination: activeReportManualPagination,
    onColumnFiltersChange: activeFiltersSetter,
    sort: activeReportSort,
    onSortChange: setActiveReportSort,
    onEdit: handleProtectedEditRecord,
    onDelete: deleteWeldRowById,
    stickyLeft,
    highlightedRowIds,
    highlightedCellKeys,
    dispatcherTaskRowIds: tableDispatcherTaskRowIds,
    onOpenChain: (row) => setChainRecord(row),
    onFilterLine: filterLineInCurrentReport,
    onOpenLinkedReport: openLinkedReportRow,
    onOpenDocument: openReportDocument,
    onOpenLnkRequest: (row, fieldKey) => {
      const preField = getPreHeatTreatmentReportField(fieldKey)
      if (preField) {
        const control = getPreHeatTreatmentControl(row, preField.methodCode)
        if (control?.id) {
          openPreHeatTreatmentResultRegistry({ rowIds: [row.id], relationId: control.id })
          return
        }
        setSelectedLnkIds(new Set([row.id]))
        openPreHeatTreatmentLnkWorkflow('request', preField.methodCode)
        return
      }
      const request = getLnkRequestIdentityForField(row, fieldKey)
      if (!request) {
        setMessage('Не удалось определить заявку ЛНК для выбранной ячейки')
        return
      }
      openLnkRequestRegistry(request.name, request.date)
    },
    onOpenLnkResult: (row, fieldKey) => {
      const preField = getPreHeatTreatmentReportField(fieldKey)
      if (preField) {
        const control = getPreHeatTreatmentControl(row, preField.methodCode)
        if (String(control?.result ?? '').trim() || String(control?.conclusionName ?? '').trim()) {
          openPreHeatTreatmentResultRegistry({ rowIds: [row.id], relationId: control?.id ?? null })
          return
        }
        setSelectedLnkIds(new Set([row.id]))
        openPreHeatTreatmentLnkWorkflow('result', preField.methodCode)
        return
      }
      const result = getLnkResultNavigationEntryForField(row, fieldKey)
      if (result) {
        openExactLnkResult(row, result.methodKey)
        return
      }
      const method = getLnkResultMethodForField(fieldKey)
      if (method) {
        openAddLnkResultModalForMethod(row, method.requestKey)
        return
      }
      setMessage('Не удалось определить результат ЛНК для выбранной ячейки')
    },
    onOpenJoint: openPstoHistoryFromDialog,
    onOpenJointOverview: (row) => setChainRecord(row),
    availableSystemDocumentTypes,
    onOpenDuplicateControl: openDuplicateControlModalForRow,
    rowActionHandlers,
    getContextMenuItems: getReportContextMenuItems,
    selectable: activeReport === 'weldingJournal' || activeReport === 'lnk' || activeReport === 'heatTreatment',
    selectedRowIds: activeSelectedRowIds,
    onSelectedRowIdsChange: setActiveSelectedRowIds,
    dispatcherTasks: adviceRepeatedJointTasks,
    controlProcessSettings,
    onRunNextAction: runJointNextAction,
    lnkSectionLayout,
  })

  const welderStampsRegistryProps = createWelderStampsRegistryProps({
    activeRecords: activeWelderStamps,
    archivedRecords: archivedWelderStamps,
    allRecords: welderStamps,
    suspensionRecords: welderStampSuspensions,
    draft: welderStampDraft,
    suspensionDraft: welderStampSuspensionDraft,
    suspensionEditorOpenSignal: welderStampSuspensionEditorOpenSignal,
    search: welderStampSearch,
    filters: welderStampFilters,
    editingId: editingWelderStampId,
    onSearchChange: setWelderStampSearch,
    onFiltersChange: setWelderStampFilters,
    onDraftChange: updateWelderStampDraft,
    onSuspensionDraftChange: updateWelderStampSuspensionDraft,
    onSave: () => runProtectedEdit('сохранение клейма', saveWelderStampRecord),
    onSaveSuspension: () => runProtectedEdit('сохранение отстранения', saveWelderStampSuspensionRecord),
    onReset: resetWelderStampForm,
    onResetSuspension: resetWelderStampSuspensionForm,
    onEdit: (record) => runProtectedEdit('редактирование клейма', () => editWelderStampRecord(record)),
    onEditSuspension: (record) => runProtectedEdit('редактирование отстранения', () => editWelderStampSuspensionRecord(record)),
    onArchive: (id) => runProtectedEdit('архивирование клейма', () => archiveWelderStampRecord(id)),
    onRestore: (id) => runProtectedEdit('восстановление клейма', () => restoreWelderStampRecord(id)),
    onArchivePermit: (recordId, permitKind, permitId) =>
      runProtectedEdit('архивирование допуска', () => setWelderStampPermitArchived(recordId, permitKind, permitId, true)),
    onRestorePermit: (recordId, permitKind, permitId) =>
      runProtectedEdit('восстановление допуска', () => setWelderStampPermitArchived(recordId, permitKind, permitId, false)),
    onDelete: (id) => runProtectedDelete('удаление клейма', () => deleteWelderStampRecord(id)),
    onDeleteSuspension: (id) => runProtectedDelete('удаление отстранения', () => deleteWelderStampSuspensionRecord(id)),
  })

  const selectedPstoHeaderRows = useMemo(
    () => tableActionRows.filter((row) => selectedHeatTreatmentIds.has(row.id)),
    [selectedHeatTreatmentIds, tableActionRows],
  )
  const pstoResultRegistryRows = useMemo(
    () => heatTreatmentRows.filter(hasPstoResultData),
    [heatTreatmentRows],
  )
  const hasAvailableTvmtRequestRows = useMemo(
    () => pstoWorkflowSummaryQuery.data
      ? pstoWorkflowSummaryQuery.data.tvmtRequestCandidateCount > 0
      : heatTreatmentRows.some(canCreateTvmtRequest),
    [heatTreatmentRows, pstoWorkflowSummaryQuery.data],
  )
  const hasAvailableTvmtResultRows = useMemo(
    () => pstoWorkflowSummaryQuery.data
      ? pstoWorkflowSummaryQuery.data.tvmtResultCandidateCount > 0
      : heatTreatmentRows.some(canAddTvmtResult),
    [heatTreatmentRows, pstoWorkflowSummaryQuery.data],
  )
  const hasAvailablePstoWorkflowRequestRows = useMemo(
    () => pstoWorkflowSummaryQuery.data
      ? pstoWorkflowSummaryQuery.data.requestCandidateCount > 0
      : heatTreatmentRows.some(canCreatePstoWorkflowRequest),
    [heatTreatmentRows, pstoWorkflowSummaryQuery.data],
  )
  const hasAvailablePstoWorkflowResultRows = useMemo(
    () => pstoWorkflowSummaryQuery.data
      ? pstoWorkflowSummaryQuery.data.resultCandidateCount > 0
      : heatTreatmentRows.some(canAddPstoWorkflowResult),
    [heatTreatmentRows, pstoWorkflowSummaryQuery.data],
  )
  const hasPstoResultRegistryRows = pstoWorkflowSummaryQuery.data
    ? pstoWorkflowSummaryQuery.data.resultRegistryCount > 0
    : pstoResultRegistryRows.length > 0
  const preHeatTreatmentResultRegistryRows = useMemo(() => {
    const scopedIds = preHeatTreatmentResultManagerRowIds
      ? new Set(preHeatTreatmentResultManagerRowIds)
      : null
    return lnkRows.filter((row) => (
      (!scopedIds || scopedIds.has(row.id)) &&
      getPreHeatTreatmentControls(row).some((control) => Boolean(String(control.requestName ?? '').trim()))
    ))
  }, [lnkRows, preHeatTreatmentResultManagerRowIds])
  const hasPreHeatTreatmentResultRegistryRows = lnkWorkflowSummaryQuery.data
    ? lnkWorkflowSummaryQuery.data.preHeatTreatmentResultRowCount > 0
    : lnkRows.some((row) => getPreHeatTreatmentControls(row).some((control) =>
        isFinalLnkResultValue(control.result),
      ))
  const hasPrimaryLnkResultRegistryRows = lnkWorkflowSummaryQuery.data
    ? lnkWorkflowSummaryQuery.data.primaryResultRowCount > 0
    : lnkRows.some((row) => getLnkResultNavigationEntries(row).length > 0)
  useEffect(() => {
    if (!isPstoRequestManagerOpen || managedPstoRequestName || pstoRequestManagerOptions.length === 0) return
    const request = pstoRequestManagerOptions[0]
    setManagedPstoRequestName(request.name)
    setManagedPstoRequestDate(request.date)
    setManagedPstoRequestNameDraft(request.name)
  }, [
    isPstoRequestManagerOpen,
    managedPstoRequestName,
    pstoRequestManagerOptions,
    setManagedPstoRequestDate,
    setManagedPstoRequestName,
    setManagedPstoRequestNameDraft,
  ])
  useEffect(() => {
    if (!isLnkRequestManagerOpen || managedLnkRequestName || lnkRequestManagerOptions.length === 0) return
    const request = lnkRequestManagerOptions[0]
    setManagedLnkRequestName(request.name)
    setManagedLnkRequestDate(request.date)
    setManagedLnkRequestNameDraft(request.name)
  }, [
    isLnkRequestManagerOpen,
    lnkRequestManagerOptions,
    managedLnkRequestName,
    setManagedLnkRequestDate,
    setManagedLnkRequestName,
    setManagedLnkRequestNameDraft,
  ])
  useEffect(() => {
    if (!isPstoResultManagerOpen || !isPstoResultRegistryAll) {
      pstoResultRegistryInitializedRef.current = false
      return
    }
    if (!isPstoRowsContextReady || pstoResultRegistryInitializedRef.current) return
    pstoResultRegistryInitializedRef.current = true
    setPstoResultDraft((current) => ({
      ...current,
      rowIds: new Set(pstoResultRegistryRows.map((row) => row.id)),
    }))
    setManagedPstoDiagramDrafts(buildManagedPstoDiagramDrafts(pstoResultRegistryRows))
  }, [
    isPstoResultManagerOpen,
    isPstoResultRegistryAll,
    isPstoRowsContextReady,
    pstoResultRegistryRows,
    setManagedPstoDiagramDrafts,
    setPstoResultDraft,
  ])
  const reportHeaderActionsProps = createReportHeaderActionsProps({
    activeReport,
    onOpenImportDialog: () => setIsImportDialogOpen(true),
    onCreateWeldJoint: () => setEditing({ record: {} }),
    importDisabled: importMutation.isPending,
    isWeldingJournalShowMenuOpen,
    onToggleWeldingJournalShowMenu: () => setIsWeldingJournalShowMenuOpen((current) => !current),
    isWeldingJournalGenerateMenuOpen,
    onToggleWeldingJournalGenerateMenu: () => setIsWeldingJournalGenerateMenuOpen((current) => !current),
    onGenerateWeldingJournalDocument: generateWeldingJournalDocument,
    onGenerateChecklistDocument: generateChecklistDocument,
    onGenerateZniDocument: generateZniDocument,
    onOpenWeldingJournalCurrentReport: openWeldingJournalCurrentReport,
    onOpenWeldingJournalWaitingWeldReport: openWeldingJournalWaitingWeldReport,
    onOpenWeldingJournalWaitingRequestReport: openWeldingJournalWaitingRequestReport,
    onOpenWeldingJournalWaitingControlReport: openWeldingJournalWaitingControlReport,
    onOpenWeldingJournalWaitingRepairReport: openWeldingJournalWaitingRepairReport,
    onOpenWeldingJournalCancelledAcceptedReport: openWeldingJournalCancelledAcceptedReport,
    onOpenWeldingJournalSystemReport: openWeldingJournalSystemReport,
    onCreatePstoRequest: () => openPstoRepeatWorkflow('request'),
    createPstoRequestDisabled:
      pstoWorkflowSummaryQuery.isLoading || !hasAvailablePstoWorkflowRequestRows,
    onOpenPstoLineProgram: openPstoLineProgram,
    onEditSelectedPstoRequest: () => {
      setIsPstoResultRegistryAll(false)
      openPstoResultManagerForRows(selectedPstoHeaderRows)
    },
    editSelectedPstoRequestDisabled:
      selectedPstoHeaderRows.length === 0 ||
      !selectedPstoHeaderRows.some((row) => Boolean(getCurrentPstoCycle(row)?.pstoRequest)),
    onOpenPstoRequestRegistry: () => {
      openAllPstoHistory()
    },
    pstoRequestPending: pstoRequestMutation.isPending,
    onAddPstoResult: () => openPstoRepeatWorkflow('result'),
    pstoResultDisabled:
      pstoWorkflowSummaryQuery.isLoading || !hasAvailablePstoWorkflowResultRows,
    onEditSelectedPstoResults: () => {
      setIsPstoResultRegistryAll(false)
      openPstoResultManagerForRows(selectedPstoHeaderRows)
    },
    editSelectedPstoResultsDisabled: !selectedPstoHeaderRows.some(hasPstoResultData),
    onOpenPstoResultRegistry: () => {
      openAllPstoHistory()
    },
    pstoResultRegistryDisabled:
      pstoWorkflowSummaryQuery.isLoading || !hasPstoResultRegistryRows,
    onCreateTvmtRequest: () => openTvmtWorkflow('request'),
    createTvmtRequestDisabled:
      pstoWorkflowSummaryQuery.isLoading || !hasAvailableTvmtRequestRows,
    onAddTvmtResult: () => openTvmtWorkflow('result'),
    addTvmtResultDisabled:
      pstoWorkflowSummaryQuery.isLoading || !hasAvailableTvmtResultRows,
    tvmtPending: false,
    isPstoShowMenuOpen,
    onTogglePstoShowMenu: () => setIsPstoShowMenuOpen((current) => !current),
    onOpenPstoCurrentReport: openPstoCurrentReport,
    onOpenPstoWaitingRequestReport: openPstoWaitingRequestReport,
    onOpenPstoResultsReport: openPstoResultsReport,
    onPstoWorkflowMenuOpenChange: setIsPstoWorkflowMenuOpen,
    onCreateLnkRequest: () => {
      const selectedRows = tableActionRows.filter((row) => selectedLnkIds.has(row.id))
      openCreateLnkWorkflowRequestForRows(selectedRows)
    },
    onExtendLnkRequest: () => openExtendLnkRequestModal(),
    onOpenLnkRequestRegistry: () => openLnkRequestRegistry(),
    lnkRequestPending: lnkRequestMutation.isPending,
    onAddLnkResult: openAddLnkWorkflowResultFromHeader,
    lnkResultDisabled:
      lnkResultMutation.isPending ||
      (lnkWorkflowSummaryQuery.data
        ? lnkWorkflowSummaryQuery.data.pendingPrimaryResultRowCount === 0
        : !isLnkRowsContextReady || selectedLnkResultMethods.length === 0),
    onEditSelectedLnkResults: openSelectedLnkResultRegistry,
    editSelectedLnkResultsDisabled:
      selectedLnkIds.size === 0 ||
      !tableActionRows.some((row) => selectedLnkIds.has(row.id) && getLnkResultNavigationEntries(row).length > 0),
    onOpenLnkResultRegistry: () => {
      if (!hasPrimaryLnkResultRegistryRows && hasPreHeatTreatmentResultRegistryRows) {
        openPreHeatTreatmentResultRegistry({ registryMode: 'result' })
        return
      }
      openAllLnkResultRegistry()
    },
    lnkResultRegistryDisabled:
      (lnkWorkflowSummaryQuery.data !== undefined || isLnkRowsContextReady) &&
      !hasPrimaryLnkResultRegistryRows &&
      !hasPreHeatTreatmentResultRegistryRows,
    onOpenLnkOfficiality: openLnkOfficialityModal,
    lnkOfficialityPending: lnkOfficialityMutation.isPending,
    onOpenDuplicateControl: openDuplicateControlModal,
    duplicateControlPending: saveDuplicateControlMutation.isPending || deleteDuplicateControlMutation.isPending,
    isLnkShowMenuOpen,
    onToggleLnkShowMenu: () => setIsLnkShowMenuOpen((current) => !current),
    onOpenLnkCurrentReport: openLnkCurrentReport,
    onOpenLnkToRequestReport: openLnkToRequestReport,
    onOpenLnkWaitingNkReport: openLnkWaitingNkReport,
    onOpenLnkConclusionsReport: openLnkConclusionsReport,
    onLnkWorkflowMenuOpenChange: setIsLnkWorkflowMenuOpen,
  })

  const reportImportDialogProps = {
    open: isImportDialogOpen,
    activeReport: 'weldingJournal' as const,
    isPending:
      importMutation.isPending ||
      weldMassFillMutation.isPending ||
      weldReplaceDataMutation.isPending,
    weldFormStampSelectOptions,
    welderStamps,
    welderStampSuspensions,
    columnFilters: dispatcherTaskServerFilters,
    onClose: () => setIsImportDialogOpen(false),
    onImportRecords: (records: WeldInput[], skippedRows: number) =>
      runProtectedImport('импорт новых данных', async () => {
        const result = await importMutation.mutateAsync(records.map(withOfficialJoint))
        setMessage(`Добавлено ${result.inserted}, пропущено служебных строк: ${skippedRows}`)
      }),
    onMassFillRecords: (
      records: ReportImportRecord[],
      skippedRows: number,
      expectedVersions: WeldRowVersionTarget[],
    ) =>
      runProtectedImport('массовое заполнение данных', async () => {
        await weldMassFillMutation.mutateAsync({ records, skippedRows, expectedVersions })
      }),
    onReplaceDataRecords: async (
      records: ReportImportRecord[],
      skippedRows: number,
      expectedVersions: WeldRowVersionTarget[],
    ) => runProtectedImport('замену данных импортом', async () => {
      await weldReplaceDataMutation.mutateAsync({ records, skippedRows, expectedVersions })
    }),
  }

  function openDispatcherTaskOfficiality(task: DispatcherTask) {
    if (task.kind === 'create' || task.kind === 'coil') {
      openLnkOfficialityWorkflowForRow(
        task.row,
        isUnofficialJoint(task.row) ? 'official' : 'unofficial',
      )
      return
    }
    if (task.kind !== 'percentage-line-control' || task.issue !== 'rejected-primary') return

    const rowIds = task.targetRowIds && task.targetRowIds.length > 0 ? task.targetRowIds : [task.row.id]
    captureReportContext('lnk')
    setChainRecord(null)
    setActiveReport('lnk')
    setLnkFilters(buildPercentageLineStampFilters(task))
    setLnkOfficialityDraft({
      rowIds: new Set(rowIds),
      search: '',
      officiality: '',
    })
    setIsLnkOfficialityModalOpen(true)
    setMessage(`Открыта официальность по клейму ${task.stamp} на линии ${task.line}`)
  }

  async function acceptPercentageLineTask(task: PercentageLineControlTask) {
    if (task.issue !== 'excess' && task.issue !== 'new-welder' && task.issue !== 'rejected-primary') return
    const confirmed = await confirmAction({
      title: 'Принять предупреждение',
      itemName: `${task.line} · ${task.stamp}`,
      description: getPercentageLineAcceptDescription(task),
      warning:
        'Это не удаляет стык, заявку или результат. Если по линии изменятся стыки, клейма или назначенный контроль, предупреждение возникнет снова.',
      confirmLabel: 'Принять',
      tone: 'warning',
    })
    if (!confirmed) return
    if (!(await requireEditPassword('принятие исключения диспетчера'))) return
    await acceptDispatcherTaskWarning(task)
    dismissRepeatedJointTask(task)
    setMessage(`Предупреждение принято: ${task.title.toLowerCase()}`)
  }

  function getPercentageLineAcceptDescription(task: PercentageLineControlTask) {
    if (task.issue === 'excess') {
      return 'Диспетчер скроет текущее предупреждение о лишнем расчетном контроле для этой процентной линии и клейма. Используй это только если дополнительный контроль действительно нужен и его не нужно исправлять.'
    }
    if (task.issue === 'new-welder') {
      return 'Диспетчер скроет текущее предупреждение о новом сварщике на процентной линии. Используй это только если клеймо указано верно и увеличение объема контроля принято осознанно.'
    }
    return 'Диспетчер скроет текущее предупреждение о негодном первичном стыке процентной линии. Используй это только если стык должен остаться официальным, а увеличение объема контроля принято осознанно.'
  }

  function captureWorkflowRootCauseRestore(destination: WorkflowRootCauseDestination) {
    if (destination === 'weld-form') {
      const previous = editing
      return () => setEditing(previous)
    }
    if (destination === 'lnk-request-manager') {
      const previous = {
        open: isLnkRequestManagerOpen,
        name: managedLnkRequestName,
        date: managedLnkRequestDate,
        nameDraft: managedLnkRequestNameDraft,
      }
      return () => {
        setManagedLnkRequestName(previous.name)
        setManagedLnkRequestDate(previous.date)
        setManagedLnkRequestNameDraft(previous.nameDraft)
        setIsLnkRequestManagerOpen(previous.open)
      }
    }
    if (destination === 'lnk-request-dialog') {
      const previous = {
        open: isLnkRequestModalOpen,
        draft: lnkRequestDraft,
        naming: lnkRequestNaming,
        search: lnkRequestSearch,
        composerMode: lnkRequestComposerMode,
        targetKey: lnkRequestTargetKey,
        selectedIds: selectedLnkIds,
        orderIds: preservedLnkOrderIds,
      }
      return () => {
        setLnkRequestDraft(previous.draft)
        setLnkRequestNaming(previous.naming)
        setLnkRequestSearch(previous.search)
        setLnkRequestComposerMode(previous.composerMode)
        setLnkRequestTargetKey(previous.targetKey)
        setSelectedLnkIds(previous.selectedIds)
        setPreservedLnkOrderIds(previous.orderIds)
        setIsLnkRequestModalOpen(previous.open)
      }
    }
    if (destination === 'lnk-result-manager') {
      const previous = {
        open: isLnkResultManagerOpen,
        methodKey: managedLnkResultMethodKey,
        conclusionDrafts: managedLnkConclusionDrafts,
        orderIds: managedLnkResultOrderIds,
        targetKey: managedLnkResultTargetKey,
        changeHint: managedLnkResultChangeHint,
        pendingChanges: managedLnkPendingResultChanges,
      }
      return () => {
        setManagedLnkResultMethodKey(previous.methodKey)
        setManagedLnkConclusionDrafts(previous.conclusionDrafts)
        setManagedLnkResultOrderIds(previous.orderIds)
        setManagedLnkResultTargetKey(previous.targetKey)
        setManagedLnkResultChangeHint(previous.changeHint)
        setManagedLnkPendingResultChanges(previous.pendingChanges)
        setIsLnkResultManagerOpen(previous.open)
      }
    }
    if (destination === 'lnk-result-dialog') {
      const previous = {
        open: isLnkResultModalOpen,
        draft: lnkResultDraft,
        orderIds: preservedLnkOrderIds,
      }
      return () => {
        setLnkResultDraft(previous.draft)
        setPreservedLnkOrderIds(previous.orderIds)
        setIsLnkResultModalOpen(previous.open)
      }
    }
    if (destination === 'pre-lnk-workflow') {
      const previous = {
        mode: preHeatTreatmentLnkWorkflowMode,
        methodCode: preHeatTreatmentLnkInitialMethodCode,
        requestSubmitMode: preHeatTreatmentLnkRequestSubmitMode,
        selectedIds: selectedLnkIds,
      }
      return () => {
        setSelectedLnkIds(previous.selectedIds)
        if (previous.mode) {
          openPreHeatTreatmentLnkWorkflowState(
            previous.mode,
            previous.methodCode,
            previous.requestSubmitMode,
          )
        } else {
          setPreHeatTreatmentLnkWorkflowMode(null)
          setPreHeatTreatmentLnkInitialMethodCode(undefined)
        }
      }
    }
    if (destination === 'pre-lnk-manager') {
      const previous = {
        open: isPreHeatTreatmentResultManagerOpen,
        rowIds: preHeatTreatmentResultManagerRowIds,
        relationId: preHeatTreatmentResultManagerInitialRelationId,
        mode: preHeatTreatmentResultManagerMode,
      }
      return () => {
        setPreHeatTreatmentResultManagerRowIds(previous.rowIds)
        setPreHeatTreatmentResultManagerInitialRelationId(previous.relationId)
        setPreHeatTreatmentResultManagerMode(previous.mode)
        setIsPreHeatTreatmentResultManagerOpen(previous.open)
      }
    }
    if (destination === 'psto-request-manager') {
      const previous = {
        open: isPstoRequestManagerOpen,
        name: managedPstoRequestName,
        date: managedPstoRequestDate,
        nameDraft: managedPstoRequestNameDraft,
      }
      return () => {
        setManagedPstoRequestName(previous.name)
        setManagedPstoRequestDate(previous.date)
        setManagedPstoRequestNameDraft(previous.nameDraft)
        setIsPstoRequestManagerOpen(previous.open)
      }
    }
    if (destination === 'psto-result-manager') {
      const previous = {
        open: isPstoResultManagerOpen,
        registryAll: isPstoResultRegistryAll,
        resultDraft: pstoResultDraft,
        diagramDrafts: managedPstoDiagramDrafts,
      }
      return () => {
        setIsPstoResultRegistryAll(previous.registryAll)
        setPstoResultDraft(previous.resultDraft)
        setManagedPstoDiagramDrafts(previous.diagramDrafts)
        setIsPstoResultManagerOpen(previous.open)
      }
    }
    const previous = {
      open: isDuplicateControlModalOpen,
      draft: duplicateControlDraft,
    }
    return () => {
      setDuplicateControlDraft(previous.draft)
      setIsDuplicateControlModalOpen(previous.open)
    }
  }

  async function openWorkflowRootCauseAction(action: WorkflowRootCauseAction) {
    const target = action.target
    let currentRow: Awaited<ReturnType<typeof getWeldJointById>>
    try {
      currentRow = await getWeldJointById({ data: { id: target.rowId } })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось загрузить стык для исправления.')
      return
    }
    if (!currentRow) {
      setMessage('Стык для исправления больше не найден. Обновите расчет и повторите действие.')
      return
    }
    const row = currentRow as WeldRow
    const destination = getWorkflowRootCauseDestination(target, row)
    if (destination === 'pre-lnk-workflow' && !controlProcessSettings.preHeatTreatmentLnkEnabled) {
      setMessage('НК до ТО выключен в настройках проекта. Включите процесс, чтобы завершить предыдущие этапы контроля.')
      return
    }
    const restore = captureWorkflowRootCauseRestore(destination)
    workflowRootCauseStackRef.current.push({ action, destination, restore })
    setCurrentWorkflowRootCauseAction(action)
    setCurrentWorkflowRootCauseDestination(destination)

    try {
      if (destination === 'weld-form' && target.kind === 'weld-field') {
        setEditing({ record: row, focusField: target.fieldKey })
      } else if (destination === 'lnk-request-dialog' && target.kind === 'lnk-control') {
        const method = LNK_METHODS.find((candidate) => candidate.code === target.methodCode)
        if (!method) throw new Error('Вид контроля для исправления не найден.')
        const defaultDraft = createDefaultLnkRequestDraft()
        const currentDate = String(row[method.requestDateKey] ?? '').trim().slice(0, 10)
        setPreservedLnkOrderIds([...new Set([...lnkRows.map((candidate) => candidate.id), row.id])])
        setSelectedLnkIds(new Set([row.id]))
        setLnkRequestDraft({
          ...defaultDraft,
          requestDate: currentDate || defaultDraft.requestDate,
          methods: new Set([method.requestKey]),
        })
        setLnkRequestNaming(defaultLnkRequestNaming)
        setLnkRequestSearch(String(row.joint ?? row.line ?? ''))
        setLnkRequestComposerMode('create')
        setLnkRequestTargetKey('')
        setIsLnkRequestModalOpen(true)
      } else if (destination === 'lnk-request-manager' && target.kind === 'lnk-control') {
        const method = LNK_METHODS.find((candidate) => candidate.code === target.methodCode)
        const identity = getCurrentWorkflowRequestIdentity(target, row)
        if (!method || !identity?.name) throw new Error('Заявка ЛНК для исправления уже изменилась.')
        setManagedLnkRequestName(identity.name)
        setManagedLnkRequestDate(identity.date)
        setManagedLnkRequestNameDraft(identity.name)
        setLnkWorkflowRequestSearch(identity.name)
        setIsLnkRequestManagerOpen(true)
      } else if (destination === 'lnk-result-manager' && target.kind === 'lnk-control') {
        const method = LNK_METHODS.find((candidate) => candidate.code === target.methodCode)
        if (!method) throw new Error('Вид контроля для исправления не найден.')
        setManagedLnkResultMethodKey(method.requestKey)
        setManagedLnkConclusionDrafts({})
        setManagedLnkResultOrderIds([row.id])
        setManagedLnkResultTargetKey(getManagedLnkResultChangeKey(row.id, method.requestKey))
        setManagedLnkResultChangeHint(null)
        setManagedLnkPendingResultChanges({})
        setIsLnkResultManagerOpen(true)
      } else if (destination === 'lnk-result-dialog' && target.kind === 'lnk-control') {
        const method = LNK_METHODS.find((candidate) => candidate.code === target.methodCode)
        if (!method) throw new Error('Вид контроля для исправления не найден.')
        const requestName = String(row[method.requestKey] ?? '').trim()
        const requestDate = String(row[method.requestDateKey] ?? '').trim()
        if (!requestName) throw new Error(`Для ${method.code} сначала нужна заявка.`)
        setPreservedLnkOrderIds([...new Set([...lnkRows.map((candidate) => candidate.id), row.id])])
        setLnkResultDraft({
          ...createDefaultLnkResultDraft(defaultLnkConclusionNaming),
          requestName,
          requestDate,
          methodKey: method.requestKey,
          rowIds: new Set([row.id]),
          search: String(row.joint ?? row.line ?? ''),
        })
        setIsLnkResultModalOpen(true)
      } else if (destination === 'pre-lnk-workflow' && target.kind === 'lnk-control') {
        setSelectedLnkIds(new Set([row.id]))
        openPreHeatTreatmentLnkWorkflow(
          target.documentPart === 'request' ? 'request' : 'result',
          target.methodCode as PreHeatTreatmentLnkMethodCode,
        )
      } else if (destination === 'pre-lnk-manager' && target.kind === 'lnk-control') {
        setPreHeatTreatmentResultManagerRowIds([row.id])
        setPreHeatTreatmentResultManagerInitialRelationId(target.relationId ?? null)
        setPreHeatTreatmentResultManagerMode(target.documentPart === 'request' ? 'request' : 'result')
        setIsPreHeatTreatmentResultManagerOpen(true)
      } else if (destination === 'psto-request-manager' && target.kind === 'psto-cycle') {
        const identity = getCurrentWorkflowRequestIdentity(target, row)
        if (!identity?.name) throw new Error('Заявка ПСТО для исправления уже изменилась.')
        setManagedPstoRequestName(identity.name)
        setManagedPstoRequestDate(identity.date)
        setManagedPstoRequestNameDraft(identity.name)
        setPstoWorkflowRequestSearch(identity.name)
        setIsPstoRequestManagerOpen(true)
      } else if (destination === 'psto-result-manager' && target.kind === 'psto-cycle') {
        setPstoResultDraft((current) => ({ ...current, rowIds: new Set([row.id]) }))
        setManagedPstoDiagramDrafts({})
        setIsPstoResultRegistryAll(false)
        setIsPstoResultManagerOpen(true)
      } else if (destination === 'duplicate-control' && target.kind === 'duplicate-control') {
        const control = row.duplicateControls?.find((candidate) => candidate.id === target.relationId)
        setIsDuplicateControlRegistryOpen(false)
        setDuplicateControlDraft(control ? {
          id: control.id,
          expectedVersion: String(control.version ?? ''),
          rowIds: new Set([control.weldJointId]),
          methods: new Set([control.method]),
          result: control.result,
          controlDate: control.controlDate,
          conclusion: control.conclusion,
          conclusionDate: control.conclusionDate,
          search: String(row.joint ?? ''),
        } : {
          ...createEmptyDuplicateControlDraft(),
          rowIds: new Set([row.id]),
          search: String(row.joint ?? ''),
        })
        setIsDuplicateControlModalOpen(true)
      }
      setMessage(`${action.label}. После исправления вы вернетесь в исходное окно.`)
    } catch (error) {
      workflowRootCauseStackRef.current.pop()
      restore()
      setCurrentWorkflowRootCauseAction(workflowRootCauseStackRef.current.at(-1)?.action ?? null)
      setCurrentWorkflowRootCauseDestination(workflowRootCauseStackRef.current.at(-1)?.destination ?? null)
      setMessage(error instanceof Error ? error.message : 'Не удалось открыть место исправления.')
    }
  }

  async function editPercentageLineTaskStamp(task: PercentageLineControlTask) {
    if (task.issue !== 'new-welder') return
    const record = await getWeldJointById({ data: { id: task.row.id } })
    if (!record) {
      setMessage('Стык для редактирования не найден')
      return
    }
    captureReportContext('weldingJournal')
    setActiveReport('weldingJournal')
    setChainRecord(null)
    setColumnFilters(buildPercentageLineStampFilters(task))
    setEditing({
      record: record as WeldRow,
      focusField: findOfficialWeldRowStampField(record as WeldRow, task.stamp) ?? 'stamp1K',
    })
    setMessage(`Открыто редактирование стыка ${String(task.row.joint ?? '-')}: проверь официальное клеймо ${task.stamp}`)
  }

  function openWelderSuspensionFromPercentageLineTask(task: PercentageLineControlTask) {
    if (task.issue !== 'suspend-welder') return
    captureReportContext('welderStamps')
    setActiveReport('welderStamps')
    setChainRecord(null)
    resetWelderStampSuspensionForm()
    updateWelderStampSuspensionDraft('naksStamp', task.stamp)
    updateWelderStampSuspensionDraft('suspendedFrom', task.suspensionFrom || String(task.row.weldDate ?? ''))
    setWelderStampSuspensionEditorOpenSignal((current) => current + 1)
    setMessage(`Открыто добавление отстранения для клейма ${task.stamp}. Проверь дату и сохрани запись.`)
  }

  async function skipWelderSuspensionFromPercentageLineTask(task: PercentageLineControlTask) {
    if (task.issue !== 'suspend-welder') return
    const confirmed = await confirmAction({
      title: 'Не отстранять сварщика',
      itemName: `${task.stamp} · ${task.line}`,
      description:
        'Диспетчер скроет текущее предупреждение об отстранении сварщика. Используй это только если решение не отстранять уже принято и его не нужно фиксировать в истории отстранений.',
      warning:
        'Это не удаляет стык, заявку или результат. Если по этому клейму появятся новые первичные негодные стыки или изменится расчет, предупреждение возникнет снова.',
      confirmLabel: 'Не отстранять',
      tone: 'warning',
    })
    if (!confirmed) return
    if (!(await requireEditPassword('принятие исключения диспетчера'))) return
    await acceptDispatcherTaskWarning(task)
    dismissRepeatedJointTask(task)
    setMessage(`Предупреждение об отстранении клейма ${task.stamp} скрыто`)
  }

  async function runDispatcherTaskAction(
    _selectedRow: WeldRow,
    task: RepeatedJointTask,
    action: DispatcherTaskActionId | DispatcherTaskActionSpec,
  ) {
    const actionId = typeof action === 'string' ? action : action.id
    if (actionId === 'open-root-cause' && typeof action !== 'string' && action.rootCauseAction) {
      await openWorkflowRootCauseAction(action.rootCauseAction)
      return
    }
    if (actionId === 'create-joint' && (task.kind === 'create' || task.kind === 'coil')) {
      await createRepeatedJoint(task, { fromChain: true })
      return
    }
    if (actionId === 'create-early-coil' && task.kind === 'create') {
      await runProtectedEdit('досрочная врезка катушки', () => createEarlyCoil(task, { fromChain: true }))
      return
    }
    if (actionId === 'delete-joint' && task.kind === 'delete') {
      await runProtectedDelete(
        'удаление повторного стыка',
        () => deleteObsoleteRepeatedJoint(task, { fromChain: true }),
      )
      return
    }
    if (actionId === 'rename-joint' && task.kind === 'rename') {
      await runProtectedEdit(
        'переименование стыка',
        () => renameObsoleteRepeatedJoint(task, { fromChain: true }),
      )
      return
    }
    if (actionId === 'toggle-officiality') {
      openDispatcherTaskOfficiality(task)
      return
    }
    if (actionId === 'accept-warning' && task.kind === 'percentage-line-control') {
      await acceptPercentageLineTask(task)
      return
    }
    if (actionId === 'edit-stamp' && task.kind === 'percentage-line-control') {
      await runProtectedEdit('редактирование клейма стыка', () => editPercentageLineTaskStamp(task))
      return
    }
    if (actionId === 'suspend-welder' && task.kind === 'percentage-line-control') {
      await runProtectedEdit(
        'добавление отстранения сварщика',
        () => openWelderSuspensionFromPercentageLineTask(task),
      )
      return
    }
    if (actionId === 'skip-suspension' && task.kind === 'percentage-line-control') {
      await skipWelderSuspensionFromPercentageLineTask(task)
      return
    }
    if (actionId === 'assign-percentage-controls' && task.kind === 'percentage-line-control') {
      percentageLineNavigationRequestIdRef.current += 1
      setPercentageLineNavigationRequest({
        id: percentageLineNavigationRequestIdRef.current,
        action: 'assign-missing-controls',
        projectTitle: task.projectTitle,
        subtitleCode: task.subtitleCode,
        line: task.line,
        stamp: task.stamp,
      })
      captureReportContext('percentageLines')
      setChainRecord(null)
      setActiveReport('percentageLines')
      setMessage(`Открываем назначение контроля по линии ${task.line}, клеймо ${task.stamp}.`)
      return
    }
    if (actionId === 'open-psto-program' && task.kind === 'line-consistency') {
      captureReportContext('heatTreatment')
      setChainRecord(null)
      if (activeReport !== 'heatTreatment') {
        deferredJointNextActionRef.current = { kind: 'psto-program', targetReport: 'heatTreatment', row: task.row }
        setActiveReport('heatTreatment')
      } else {
        openPstoLineProgramForRow(task.row)
      }
      return
    }
    if (actionId === 'open-lnk') {
      openRowsInReport([task.row], 'lnk')
      return
    }
    if (actionId === 'open-psto') {
      openRowsInReport([task.row], 'heatTreatment')
      return
    }
    if (actionId === 'open-stamp-registry') {
      const stamps = task.kind === 'percentage-line-control'
        ? [task.stamp]
        : getOfficialWeldRowStamps(task.row)
      const stamp = stamps.length === 1 ? stamps[0] : ''
      captureReportContext('welderStamps')
      setChainRecord(null)
      setWelderStampFilters(createEmptyWelderStampFilters())
      setWelderStampSearch(stamp)
      setActiveReport('welderStamps')
      setMessage(
        stamp
          ? `Открыт реестр клейм: ${stamp}.`
          : stamps.length > 1
            ? `Открыт реестр клейм. На стыке несколько клейм: ${stamps.join(', ')}.`
            : 'Открыт реестр клейм.',
      )
      return
    }
    if (actionId === 'edit-weld') {
      await runProtectedEdit('редактирование стыка', async () => {
        const currentRow = await getWeldJointById({ data: { id: task.row.id } })
        if (!currentRow) {
          setMessage('Стык больше не найден. Обновите картину стыка и повторите действие.')
          return
        }
        captureReportContext('weldingJournal')
        setChainRecord(null)
        setColumnFilters(buildExactJointFilters(currentRow))
        setActiveReport('weldingJournal')
        setEditing({ record: currentRow })
      })
      return
    }
    if (actionId === 'show-task') showRepeatedJointTask(task)
  }

  const reportContextLoadError =
    (lnkWorkflowRowsQuery.isEnabled ? lnkWorkflowRowsQuery.error : null) ??
    (lnkWorkflowSummaryQuery.isEnabled ? lnkWorkflowSummaryQuery.error : null) ??
    (lnkWorkflowRequestSummaryQuery.isEnabled ? lnkWorkflowRequestSummaryQuery.error : null) ??
    (pstoWorkflowRowsQuery.isEnabled ? pstoWorkflowRowsQuery.error : null) ??
    (pstoWorkflowSummaryQuery.isEnabled ? pstoWorkflowSummaryQuery.error : null) ??
    (finalStatusContextQuery.isEnabled ? finalStatusContextQuery.error : null)
  const reportLoadError = reportContextLoadError ?? (isServerPagedTab ? weldPageQuery.error : null)
  const reportLoadErrorMessage = reportLoadError instanceof Error ? reportLoadError.message : null
  const reportSummaryBarProps = {
    ...createReportSummaryBarProps({
      activeReport,
      left: stickyLeft,
      isLoading: isServerPagedTab ? weldPageQuery.isLoading : false,
      weldingRows: activeReport === 'weldingJournal' ? filteredVisibleRows : rows,
      weldingRowCount: activeReport === 'weldingJournal' && isServerPagedTab ? weldPageQuery.totalCount : undefined,
      acceptedWdiTotal:
        activeReport === 'weldingJournal' && isServerPagedTab ? weldPageQuery.acceptedWdiTotal : filteredAcceptedWdiTotal,
      isAcceptedWdiRecalculating: activeReport === 'weldingJournal' && isServerPagedTab &&
        dispatcherTaskSnapshot.data?.isFresh === false,
      heatTreatmentRows: activeReport === 'heatTreatment' ? filteredVisibleRows : heatTreatmentRows,
      heatTreatmentRowCount: activeReport === 'heatTreatment' && isServerPagedTab ? weldPageQuery.totalCount : undefined,
      selectedHeatTreatmentRowCount: selectedPstoHeaderRows.length,
      lnkRows: activeReport === 'lnk' ? filteredVisibleRows : lnkRows,
      lnkRowCount: activeReport === 'lnk' && isServerPagedTab ? weldPageQuery.totalCount : undefined,
      availableLnkRequestRows: activeReport === 'lnk' ? filteredAvailableLnkRequestRowsForSummary : availableLnkRequestRows,
      availableLnkRequestRowCount:
        activeReport === 'lnk' && isServerPagedTab ? weldPageQuery.availableRequestCount : undefined,
      welderStamps,
      filteredWelderStamps,
    }),
    ...(isServerPagedTab
      ? {
          quickSearchValue: activeColumnFilters.search ?? '',
          onQuickSearchChange: (search: string) => {
            activeFiltersSetter((current) => {
              const next = { ...current }
              if (search) next.search = search
              else delete next.search
              return next
            })
          },
        }
      : {}),
  }
  const reportNotificationToastProps = {
    message: reportLoadErrorMessage ?? selectionWarning ?? lnkNotice ?? message ?? undefined,
    tone: reportLoadErrorMessage || selectionWarning
      ? 'error' as const
      : lnkNotice
        ? 'success' as const
        : 'info' as const,
    onDismiss: reportLoadErrorMessage
      ? undefined
      : selectionWarning
        ? dismissSelectionWarning
        : lnkNotice
        ? dismissLnkNotice
        : dismissMessage,
  }

  const reportTaskPanelsProps = createReportTaskPanelsProps({
    activeReport,
    repeatedJointTasks: visibleRepeatedJointTasks,
    repeatedJointTaskGroups: visibleRepeatedJointTaskGroups,
    repeatedJointTaskCount: isServerPagedTab
      ? dispatcherTaskSnapshot.repeatedJointTaskCount
      : visibleRepeatedJointTasks.length,
    computedRevision: dispatcherTaskSnapshot.data?.computedRevision,
    taskFilterOptions: dispatcherTaskSnapshot.taskFilterOptions,
    hasMoreTasks: dispatcherTaskSnapshot.hasMoreTasks,
    onLoadMoreTasks: () => { void dispatcherTaskSnapshot.loadMoreTasks() },
    isTaskBatchLoading: dispatcherTaskSnapshot.isTaskBatchLoading,
    taskBatchError: dispatcherTaskSnapshot.taskBatchError instanceof Error
      ? dispatcherTaskSnapshot.taskBatchError.message
      : undefined,
    onRetryTaskBatch: () => { void dispatcherTaskSnapshot.retryTaskBatch() },
    onRefreshTasks: dispatcherTaskSnapshot.refreshTasks,
    dispatcherTasksRefreshing: isServerPagedTab && (
      dispatcherTaskSnapshot.isRefreshing || (
        dispatcherTaskSnapshot.data?.isFresh === false && !dispatcherTaskSnapshot.error
      )
    ),
    dispatcherWorkspaceOpen: isDispatcherWorkspaceOpen,
    onDispatcherWorkspaceOpenChange: setIsDispatcherWorkspaceOpen,
    welderStampExpiryTasks: visibleWelderStampExpiryTasks,
    welderStampNotificationGroups: visibleWelderStampNotificationGroups,
    stickyLeft,
    handlers: dispatcherTaskCardProps,
    isTaskExpanded: isRepeatedJointTaskExpanded,
    onToggleDetails: toggleRepeatedJointTaskDetails,
    onCollapseTaskDetails: resetExpandedRepeatedJointTasks,
    onDismissTasks: dismissRepeatedJointTasks,
  })
  function runJointNextAction(
    row: WeldRow,
    action: JointNextAction,
    options: { runDispatcherAction?: boolean } = {},
  ) {
    const targetReport = action.kind === 'editWeld' || (action.kind === 'dispatcherTask' && !options.runDispatcherAction)
      ? 'weldingJournal'
      : action.kind === 'pstoRequest' || action.kind === 'pstoResult' || action.kind === 'tvmtRequest' || action.kind === 'tvmtResult'
        ? 'heatTreatment'
        : action.kind === 'preLnkRequest' || action.kind === 'preLnkResult' || action.kind === 'primaryLnkRequest' || action.kind === 'primaryLnkResult'
          ? 'lnk'
          : null
    if (targetReport) captureReportContext(targetReport)
    setChainRecord(null)
    if (targetReport && targetReport !== activeReport) {
      deferredJointNextActionRef.current = { kind: 'joint-action', targetReport, row, action, ...options }
      setActiveReport(targetReport)
      return
    }
    openJointNextAction(row, action, options)
  }

  function openJointNextAction(
    row: WeldRow,
    action: JointNextAction,
    options: { runDispatcherAction?: boolean } = {},
  ) {
    if (action.kind === 'editWeld') {
      setEditing({ record: row })
      return
    }
    if (action.kind === 'preLnkRequest' || action.kind === 'preLnkResult') {
      setSelectedLnkIds(new Set([row.id]))
      openPreHeatTreatmentLnkWorkflow(
        action.kind === 'preLnkRequest' ? 'request' : 'result',
        action.kind === 'preLnkResult'
          ? action.methodCode as PreHeatTreatmentLnkMethodCode | undefined
          : undefined,
      )
      return
    }
    if (action.kind === 'pstoRequest' || action.kind === 'pstoResult') {
      setSelectedHeatTreatmentIds(new Set([row.id]))
      openPstoRepeatWorkflow(action.kind === 'pstoRequest' ? 'request' : 'result')
      return
    }
    if (action.kind === 'tvmtRequest' || action.kind === 'tvmtResult') {
      setSelectedHeatTreatmentIds(new Set([row.id]))
      openTvmtWorkflow(action.kind === 'tvmtRequest' ? 'request' : 'result')
      return
    }
    if (action.kind === 'primaryLnkRequest') {
      openCreateLnkRequestModalForRow(row)
      return
    }
    if (action.kind === 'primaryLnkResult') {
      const method = getPendingLnkResultMethods(row, controlProcessSettings)
        .find((candidate) => candidate.code === action.methodCode)
      if (method) openAddLnkResultModalForMethod(row, method.requestKey)
      else openAddLnkResultModalForRow(row)
      return
    }
    if (action.kind === 'dispatcherTask') {
      const task = adviceRepeatedJointTasks.find((candidate) => candidate.key === action.taskKey)
      if (options.runDispatcherAction && task && action.taskActionId) {
        void runDispatcherTaskAction(row, task, action.taskAction ?? action.taskActionId)
        return
      }
      openRowsInReport([task?.row ?? row], 'weldingJournal')
      if (task) {
        restoreDismissedRepeatedJointTask(task)
        setExpandedRepeatedJointTaskKeys(new Set([task.key]))
        window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
      }
      setMessage(task
        ? `${action.title}. Нужная задача диспетчера раскрыта над таблицей.`
        : 'Задача диспетчера уже изменилась. Обновите отчет и откройте цепочку повторно.')
    }
  }

  function openPstoLineProgramForRow(row: WeldRow) {
    setHeatTreatmentFilters(buildLineFilters(row))
    openPstoLineProgram()
    setMessage(`Открыта программа ПСТО для проверки линии ${row.line}.`)
  }

  useEffect(() => {
    const deferred = deferredJointNextActionRef.current
    if (!deferred || deferred.targetReport !== activeReport) return
    deferredJointNextActionRef.current = null
    if (deferred.kind === 'psto-program') {
      openPstoLineProgramForRow(deferred.row)
      return
    }
    openJointNextAction(deferred.row, deferred.action, {
      runDispatcherAction: deferred.runDispatcherAction,
    })
  }, [activeReport])
  const reportChainDialogProps = createReportChainDialogProps({
    chainRecord,
    initialTab: chainPictureIntent.initialTab,
    focusedTaskKey: chainPictureIntent.focusedTaskKey,
    chainRows,
    transitions: chainTransitions,
    earlyCoilCandidates: chainEarlyCoilCandidates,
    dispatcherTasks: adviceRepeatedJointTasks,
    controlProcessSettings,
    errorMessage: chainRowsError,
    isLoading: isChainRowsLoading,
    onClose: () => setChainRecord(null),
    onOpenBase: openChainBaseInCurrentReport,
    onOpenRow: openChainRowInCurrentReport,
    onOpenDocument: openReportDocument,
    onOpenReport: (row, report) => openRowsInReport([row], report),
    onOpenLineInDispatcher: openLineInDispatcher,
    onEditRow: openWeldEditorFromJointPicture,
    onRunNextAction: (row, action) => runJointNextAction(row, action, { runDispatcherAction: true }),
    onRunDispatcherTaskAction: runDispatcherTaskAction,
    canCreateRepeatedJoint: true,
    isRepeatedJointPending: repeatedJointMutation.isPending,
    onCreateRepeatedJoint: (task) => createRepeatedJoint(task, { fromChain: true }),
    canRenameRepeatedJoint: true,
    isRenameRepeatedJointPending: renameRepeatedJointMutation.isPending,
    onRenameRepeatedJoint: (task) =>
      runProtectedEdit('переименование стыка', () => renameObsoleteRepeatedJoint(task, { fromChain: true })),
    canCreateEarlyCoil: true,
    isEarlyCoilPending: earlyCoilMutation.isPending,
    onCreateEarlyCoil: (row, candidate) =>
      runProtectedEdit('досрочная врезка катушки', () => createEarlyCoilFromChain(row, candidate)),
    onOpenOfficiality: openLnkOfficialityWorkflowForRow,
    onRetry: retryChainRows,
  })
  const allowedArchivedOfficialStampsForEditing = getArchivedOfficialStampValuesForRecord(editing?.record, welderStamps)
  const activeRootCauseTarget = currentWorkflowRootCauseAction?.target
  const saveEditedWeld = (value: WeldInput) => {
    if (!editing) return
    const saveValue: WeldDraft = {
      ...value,
      officiality: editing.record.officiality ?? null,
      id: editing.record.id,
    }
    if (!saveValue.id) {
      saveMutation.mutate(saveValue)
      return
    }

    const lineMoveSaveData = getPstoLineMoveSaveData(saveValue)
    saveMutation.mutate(lineMoveSaveData
      ? { ...saveValue, ...lineMoveSaveData }
      : saveValue)
  }
  const reportWeldEditorProps = createReportWeldEditorProps({
    editing,
    suggestionRows: rows.length > 0 ? rows : undefined,
    stampSelectOptions: (draft) => getWeldFormStampSelectOptions(draft, allowedArchivedOfficialStampsForEditing),
    getExternalSaveBlockReason: (draft) => {
      const stampReason = shouldValidateOfficialStampCompatibilityForSave(draft, editing?.record)
        ? getOfficialStampCompatibilitySaveBlockReason(draft, welderStamps, {
            saveCheckSettings,
            suspensions: welderStampSuspensions,
          })
        : null
      return stampReason ?? getPstoLineMoveSaveBlockReason(draft)
    },
    onLineIdentityChange: checkEditedWeldLineMove,
    preSaveDecision: pstoLineMovePreSaveDecision,
    isSaving: saveMutation.isPending,
    onCancel: () => {
      resetPstoLineMoveDraftState()
      setEditing(null)
    },
    onSave: (value) =>
      runProtectedEdit('сохранение стыка', () => saveEditedWeld(value)),
    moveDialogProps: pstoLineMoveDraftState?.status === 'required' && pstoLineMoveDraftState.dialogOpen
      ? {
          preview: pstoLineMoveDraftState.preview,
          initialDecisions: pstoLineMoveDraftState.decisions,
          pending: false,
          error: null,
          onClose: () => {
            const current = pstoLineMoveDraftStateRef.current
            if (current?.status !== 'required') return
            commitPstoLineMoveDraftState({ ...current, dialogOpen: false })
          },
          onConfirm: confirmPstoLineMove,
        }
      : null,
    elevated: currentWorkflowRootCauseDestination === 'weld-form',
    onRunRootCauseAction: openWorkflowRootCauseAction,
  })
  const reportFieldEditorProps = createReportFieldEditorProps({
    editing: heatTreatmentFieldEditing,
    requestOptions: lnkRequestOptions,
    isSaving:
      heatTreatmentFieldMutation.isPending ||
      lnkFieldMutation.isPending ||
      Boolean(
        heatTreatmentFieldEditing &&
          (heatTreatmentFieldEditing.report === 'lnk' ? !isLnkRowsContextReady : !isPstoRowsContextReady),
      ),
    onChange: (value) => setHeatTreatmentFieldEditing((current) => (current ? { ...current, value } : current)),
    onClose: () => setHeatTreatmentFieldEditing(null),
    onSave: () => runProtectedEdit('сохранение поля отчета', saveEditedHeatTreatmentField),
  })
  const reportRkExposureDialogProps = rkExposureEditing
    ? {
        editing: rkExposureEditing,
        isSaving: rkExposureMutation.isPending,
        onClose: () => setRkExposureEditing(null),
        onSave: ({ lines, confirmedDiameter }: {
          lines: import('@/lib/rk-exposure').RkExposureLine[]
          confirmedDiameter: number | null
        }) => {
          void runProtectedEdit('сохранение снимков и описания РК', () => {
            rkExposureMutation.mutate({
              record: rkExposureEditing.record,
              lines,
              confirmedDiameter,
              stage: rkExposureEditing.stage,
            })
          })
        },
      }
    : null
  const confirmClearSelectedRows = async (
    selectedCount: number,
    contextLabel: string,
    onConfirm: () => void,
    warning?: string,
  ) => {
    if (selectedCount === 0) return
    const confirmed = await confirmAction({
      title: 'Снять весь выбор?',
      itemName: `Выбрано стыков: ${selectedCount}`,
      description: `Все галочки будут сняты в окне ${contextLabel}. Данные сварочного журнала не изменятся.`,
      warning,
      confirmLabel: 'Снять выбор',
      tone: 'warning',
    })
    if (confirmed) onConfirm()
  }

  const openModalRowsInWeldingJournal = (dialogRows: readonly WeldRow[], sourceLabel: string) => {
    const opened = openJournalSelectionInNewTab(
      dialogRows.map((row) => row.id),
      sourceLabel,
    )
    if (!opened) {
      setMessage('Браузер заблокировал открытие сварочного журнала в новой вкладке.')
    }
  }
  const copyManagerDocumentName = (documentName: string) => {
    void copyTextToClipboard(documentName)
      .then((copied) => setMessage(copied ? 'Название документа скопировано.' : 'Не удалось скопировать название документа.'))
      .catch(() => setMessage('Не удалось скопировать название документа.'))
  }

  const reportPstoDialogsProps = createReportPstoDialogsProps({
    requestModalOpen: isPstoRequestModalOpen,
    request: {
      nextRequestName: nextPstoRequestName,
      nextRequestNumber: nextPstoRequestNumber,
      selectedRows: selectedHeatTreatmentRows,
      requestNaming: pstoRequestNaming,
      requestDate: pstoRequestDate,
      requestSearch: pstoRequestSearch,
      message,
      requestManagerOptions: pstoRequestManagerOptions,
      heatTreatmentRowsCount: heatTreatmentRows.length,
      filteredRows: filteredPstoRequestRows,
      requestRows: heatTreatmentRows,
      availableRowsCount: filteredAvailablePstoRequestRows.length,
      selectedIds: selectedHeatTreatmentIds,
      isPending: pstoRequestMutation.isPending,
      saveCheckSettings,
      onClose: closeCreatePstoRequestModal,
      onOpenRequestManager: () => {
        setPstoWorkflowRequestSearch('')
        openPstoRequestManager()
      },
      onRequestNamingChange: setPstoRequestNaming,
      onRequestDateChange: setPstoRequestDate,
      onRequestSearchChange: setPstoRequestSearch,
      onClearSelection: () => {
        void confirmClearSelectedRows(
          selectedHeatTreatmentIds.size,
          'создания заявки ПСТО',
          () => setSelectedHeatTreatmentIds(new Set()),
        )
      },
      onSetSelectedRows: (rowIds) => setSelectedHeatTreatmentIds(new Set(rowIds)),
      onOpenJournalRows: openModalRowsInWeldingJournal,
      onOpenPstoHistory: openPstoHistoryFromDialog,
      onToggleAllRows: toggleAllPstoRequestRows,
      onToggleRow: togglePstoRequestRow,
      onSubmit: () => runProtectedEdit('создание заявки ПСТО', submitCreatePstoRequest),
      onRunRootCauseAction: openWorkflowRootCauseAction,
    },
    filteredAvailableRequestRows: filteredAvailablePstoRequestRows,
    requestManagerOpen: isPstoRequestManagerOpen,
    requestManager: {
      elevated: currentWorkflowRootCauseDestination === 'psto-request-manager',
      requestName: managedPstoRequestName,
      requestDate: managedPstoRequestDate,
      requestOptions: pstoRequestManagerOptions,
      requestOptionsHasMore: pstoWorkflowRequestOptionsQuery.data?.hasMore ?? false,
      requestSearch: pstoWorkflowRequestSearch,
      requestRows: managedPstoRequestRows,
      requestNameDraft: managedPstoRequestNameDraft,
      isManagerPending: pstoRequestManagerMutation.isPending,
      isCorrectionPending: pstoRequestCorrectionMutation.isPending,
      canOpenDocument: availableSystemDocumentTypes.has('pstoRequest'),
      onClose: currentWorkflowRootCauseDestination === 'psto-request-manager'
        ? returnFromWorkflowRootCause
        : () => setIsPstoRequestManagerOpen(false),
      onChangeRequest: changeManagedPstoRequest,
      onRequestSearchChange: setPstoWorkflowRequestSearch,
      onRequestNameDraftChange: setManagedPstoRequestNameDraft,
      onRenameRequest: () => runProtectedEdit('переименование заявки ПСТО', renameManagedPstoRequest),
      onOpenDocument: (row) => openReportDocument(row, 'pstoRequest'),
      onOpenJournalRows: openModalRowsInWeldingJournal,
      onOpenPstoHistory: openPstoHistoryFromDialog,
      onCopyDocumentName: copyManagerDocumentName,
      onClearPosition: (row) => runProtectedDelete('очистку позиции заявки ПСТО', () => clearManagedPstoRequestPosition(row)),
      onDeleteRequest: (request) => runProtectedDelete('удаление заявки ПСТО', () => deleteManagedPstoRequest(request)),
      rootCauseTarget: activeRootCauseTarget?.kind === 'psto-cycle' ? activeRootCauseTarget : undefined,
      onRunRootCauseAction: openWorkflowRootCauseAction,
      onDocumentDateSaved: returnFromWorkflowRootCause,
      onMessage: setMessage,
    },
    resultModalOpen: isPstoResultModalOpen,
    result: {
      draft: pstoResultDraft,
      requestSearch: pstoResultRequestSearch,
      nextDiagramName: nextPstoDiagramName,
      systemDocumentCreationPlan: pstoResultSystemDocumentCreationPlan,
      saveCheckSettings,
      filteredRows: filteredPstoResultRows,
      selectedRows: selectedPstoResultRows,
      filteredRequestOptions: filteredPstoResultRequestOptions,
      availableRequestOptions: pstoResultAvailableRequestOptions,
      saveBlockReason: pstoResultSaveBlockReason,
      rootCauseActions: pstoResultRootCauseActions,
      onRunRootCauseAction: openWorkflowRootCauseAction,
      requestRows: pstoResultSearchRows,
      onDraftChange: setPstoResultDraft,
      onRequestSearchChange: setPstoResultRequestSearch,
      onRequestChange: changePstoResultRequest,
      onClearFilters: () => {
        setPstoResultRequestSearch('')
        setPstoResultDraft((current) => ({
          ...current,
          requestName: '',
          rowIds: new Set(),
          search: '',
        }))
      },
      onClearSelection: () => {
        void confirmClearSelectedRows(
          pstoResultDraft.rowIds.size,
          'внесения результата ПСТО',
          () => setPstoResultDraft((current) => ({ ...current, rowIds: new Set() })),
        )
      },
      onSetSelectedRows: setPstoResultRows,
      onOpenJournalRows: openModalRowsInWeldingJournal,
      onOpenPstoHistory: openPstoHistoryFromDialog,
      onToggleAll: toggleAllPstoResultRows,
      onToggleRow: togglePstoResultRow,
      onOpenManager: () => {
        setIsPstoResultRegistryAll(false)
        openPstoResultManager()
      },
      onClose: closeAddPstoResultModal,
      onSave: () => runProtectedEdit('сохранение результата ПСТО', handleAddPstoResult),
    },
    resultManagerOpen: isPstoResultManagerOpen,
    resultManager: {
      elevated: currentWorkflowRootCauseDestination === 'psto-result-manager',
      rows: managedPstoResultRows,
      diagramDrafts: managedPstoDiagramDrafts,
      isPending:
        pstoResultCorrectionMutation.isPending ||
        pstoCycleCorrectionMutation.isPending ||
        pstoTvmtCorrectionWithLaterCycleRemovalMutation.isPending,
      canOpenDocument: availableSystemDocumentTypes.has('pstoConclusion'),
      hasMoreRows:
        isPstoResultRegistryAll &&
        (pstoWorkflowRowsQuery.data?.length ?? 0) >= pstoResultRegistryLimit &&
        pstoResultRegistryLimit < WORKFLOW_REGISTRY_MAX_LOADED_ROWS,
      onLoadMoreRows: () => setPstoResultRegistryLimit((current) =>
        Math.min(current + WORKFLOW_REGISTRY_PAGE_SIZE, WORKFLOW_REGISTRY_MAX_LOADED_ROWS),
      ),
      onRegistrySearchChange: (value) => {
        setPstoResultRegistrySearch(value)
        setPstoResultRegistryLimit(WORKFLOW_REGISTRY_PAGE_SIZE)
      },
      onClose: currentWorkflowRootCauseDestination === 'psto-result-manager'
        ? returnFromWorkflowRootCause
        : closePstoResultManager,
      onDiagramDraftChange: (rowId, value) =>
        setManagedPstoDiagramDrafts((current) => ({ ...current, [rowId]: value })),
      onRenameDiagram: (row, diagramName) =>
        runProtectedEdit('переименование диаграммы ПСТО', () => renameManagedPstoDiagram(row, diagramName)),
      onDeleteResult: (row) => runProtectedDelete('удаление результата ПСТО', () => deleteManagedPstoResult(row)),
      onCorrectStage: (payload) => {
        void runProtectedEdit('изменение этапа ПСТО/ТВМТ', () =>
          pstoCycleCorrectionMutation.mutateAsync(payload),
        )
      },
      onDeleteStage: async (row, payload) => {
        const confirmed = await confirmAction({
          title: `Удалить: ${getPstoCycleStageInlineLabel(payload.stage)}`,
          itemName: String(row.joint ?? '-').trim() || '-',
          description: 'Будет удален только выбранный последний этап. Предыдущие заявки, результаты и документы сохранятся.',
          warning: 'Документы основного ЛНК не удаляются. Если от этапа зависят последующие документы или возникнет новое нарушение хронологии, удаление будет заблокировано.',
          confirmLabel: 'Удалить этап',
          tone: 'danger',
        })
        if (!confirmed) return
        await runProtectedDelete('удаление этапа ПСТО/ТВМТ', async () => {
          await pstoCycleCorrectionMutation.mutateAsync(payload)
        })
      },
      onCorrectTvmtAndRemoveLaterCycles: async (row, payload) => {
        const laterCycles = [...(row.pstoRepeatCycles ?? [])]
          .filter((cycle) => cycle.sequence > payload.sequence)
          .sort((left, right) => left.sequence - right.sequence)
        if (laterCycles.length === 0) {
          setMessage('Последующих повторных циклов больше нет. Обновите историю ПСТО и ТВМТ.')
          return
        }
        const cycleLabels = laterCycles.map((cycle) => `№${cycle.sequence}`).join(', ')
        const documentCount = laterCycles.reduce((count, cycle) => count + [
          cycle.pstoRequest,
          cycle.heatTreatmentDiagram,
          cycle.tvmtRequest,
          cycle.tvmtConclusion,
        ].filter((value) => String(value ?? '').trim()).length, 0)
        const confirmed = await confirmAction({
          title: 'Исправить ТВМТ и удалить последующие циклы',
          itemName: `${String(row.line ?? '-').trim() || '-'} · ${String(row.joint ?? '-').trim() || '-'}`,
          description: `Результат ТВМТ цикла №${payload.sequence} будет изменен на «годен». ` +
            `Циклы ${cycleLabels} и связанные с ними документы (${documentCount}) будут удалены.`,
          warning: 'Основной ЛНК сохранится. Перед записью система проверит его даты относительно исправленного цикла; при конфликте не изменится ничего. Действие нельзя отменить.',
          confirmLabel: 'Удалить циклы и сохранить',
          tone: 'danger',
        })
        if (!confirmed) return
        await runProtectedDelete('исправление ТВМТ с удалением последующих циклов', async () => {
          await pstoTvmtCorrectionWithLaterCycleRemovalMutation.mutateAsync(payload)
        })
      },
      onOpenDocument: (row, fieldKey = 'heatTreatmentDiagram') => openReportDocument(row, fieldKey),
      onOpenJournalRows: openModalRowsInWeldingJournal,
      onOpenPstoHistory: openPstoHistoryFromDialog,
      onCopyDocumentName: copyManagerDocumentName,
      canOpenDocumentForField: (fieldKey) => {
        const templateId = getSystemDocumentTemplateIdForField(fieldKey)
        return Boolean(templateId && availableSystemDocumentTypes.has(templateId))
      },
      initialRowId: activeRootCauseTarget?.kind === 'psto-cycle' ? activeRootCauseTarget.rowId : undefined,
      initialSequence: activeRootCauseTarget?.kind === 'psto-cycle' ? activeRootCauseTarget.sequence : undefined,
      initialStage: activeRootCauseTarget?.kind === 'psto-cycle' ? activeRootCauseTarget.stage : undefined,
      rootCauseTarget: activeRootCauseTarget?.kind === 'psto-cycle' ? activeRootCauseTarget : undefined,
      onRunRootCauseAction: openWorkflowRootCauseAction,
      onDocumentDateSaved: returnFromWorkflowRootCause,
      onMessage: setMessage,
    },
    tvmtWorkflow: tvmtWorkflowMode
      ? {
          mode: tvmtWorkflowMode,
          rows: heatTreatmentRows,
          initialSelectedIds: selectedHeatTreatmentIds,
          onCandidateSearchChange: setTvmtCandidateSearch,
          onCandidateSelectionChange: setTvmtCandidateIds,
          onCandidateRequestChange: handleTvmtCandidateRequestChange,
          onClose: () => setTvmtWorkflowMode(null),
          onRunProtectedEdit: (actionLabel, action) => runProtectedEdit(actionLabel, action),
          onSaved: (savedRows, fieldKeys, nextMessage) => {
            if (savedRows.length > 0) highlightChangedRows(savedRows, fieldKeys)
            setMessage(nextMessage)
          },
          onOpenJournalRows: openModalRowsInWeldingJournal,
          onOpenPstoHistory: openPstoHistoryFromDialog,
          onOpenResultManager: openPstoHistoryRowsFromDialog,
          onRunRootCauseAction: openWorkflowRootCauseAction,
        }
      : null,
    repeatWorkflow: pstoRepeatWorkflowMode
      ? {
          mode: pstoRepeatWorkflowMode,
          rows: heatTreatmentRows,
          initialSelectedIds: selectedHeatTreatmentIds,
          onCandidateSearchChange: setPstoRepeatCandidateSearch,
          onCandidateSelectionChange: setPstoRepeatCandidateIds,
          onCandidateRequestChange: handlePstoRepeatCandidateRequestChange,
          onClose: () => setPstoRepeatWorkflowMode(null),
          onRunProtectedEdit: (actionLabel, action) => runProtectedEdit(actionLabel, action),
          onSaved: (savedRows, fieldKeys, nextMessage) => {
            if (savedRows.length > 0) highlightChangedRows(savedRows, fieldKeys)
            setMessage(nextMessage)
          },
          onOpenJournalRows: openModalRowsInWeldingJournal,
          onOpenPstoHistory: openPstoHistoryFromDialog,
          onOpenResultManager: openPstoHistoryRowsFromDialog,
          onRunRootCauseAction: openWorkflowRootCauseAction,
        }
      : null,
    lineProgram: isPstoLineProgramOpen
      ? {
          open: true,
          onClose: () => setIsPstoLineProgramOpen(false),
          onRunProtectedEdit: (actionLabel, action) => runProtectedEdit(actionLabel, action),
          onRunProtectedDelete: (actionLabel, action) => runProtectedDelete(actionLabel, action),
          onSaved: (savedRows, nextMessage) => {
            if (savedRows.length > 0) highlightChangedRows(savedRows, ['pstoRequired', 'finalStatus'])
            setMessage(nextMessage)
          },
        }
      : null,
  })
  const reportLnkDialogsProps = createReportLnkDialogsProps({
    requestModalOpen: isLnkRequestModalOpen,
    request: {
      elevated: currentWorkflowRootCauseDestination === 'lnk-request-dialog',
      nextRequestName: nextLnkRequestName,
      nextRequestNumber: nextLnkRequestNumber,
      selectedRowsCount: selectedLnkRows.length,
      selectedRows: selectedLnkRows,
      requestNaming: lnkRequestNaming,
      requestDate: lnkRequestDraft.requestDate,
      requestExtensionOptions: lnkRequestExtensionOptions,
      requestOptionsHasMore: lnkWorkflowRequestSummaryQuery.data?.hasMore ?? false,
      initialMode: lnkRequestComposerMode,
      initialRequestKey: lnkRequestTargetKey,
      initialSelectedMethods: lnkRequestDraft.methods,
      requestSearch: lnkRequestSearch,
      message,
      lnkRowsCount: lnkRows.length,
      filteredRows: filteredLnkRequestRows,
      filteredAvailableRows: filteredAvailableLnkRequestRows,
      filteredReadyRows: filteredReadyLnkRequestRows,
      availableRows: availableLnkRequestRows,
      readyRows: readyLnkRequestRows,
      selectedIds: selectedLnkIds,
      isPending: lnkRequestMutation.isPending || lnkRequestExtensionMutation.isPending,
      saveCheckSettings,
      controlProcessSettings,
      onClose: currentWorkflowRootCauseDestination === 'lnk-request-dialog'
        ? returnFromWorkflowRootCause
        : closeCreateLnkRequestModal,
      onOpenRequestRegistry: () => openLnkRequestRegistry(),
      onRequestNamingChange: setLnkRequestNaming,
      onRequestDateChange: (requestDate) => setLnkRequestDraft((current) => ({ ...current, requestDate })),
      onRequestSearchChange: setLnkRequestSearch,
      onCandidateMethodsChange: (methodKeys) => setLnkRequestDraft((current) => ({
        ...current,
        methods: new Set(methodKeys),
      })),
      onExistingRequestSearchChange: setLnkWorkflowRequestSearch,
      onClearSelection: () => {
        void confirmClearSelectedRows(
          selectedLnkIds.size,
          'создания заявки ЛНК',
          () => setSelectedLnkIds(new Set()),
        )
      },
      onSetSelectedRows: (rowIds) => setSelectedLnkIds(new Set(rowIds)),
      onOpenJournalRows: openModalRowsInWeldingJournal,
      onOpenPstoHistory: openPstoHistoryFromDialog,
      onStageChange: controlProcessSettings.preHeatTreatmentLnkEnabled
        ? (stage, rowIds, requestSubmitMode) => switchLnkWorkflowStage(
            'request',
            stage,
            rowIds,
            requestSubmitMode,
          )
        : undefined,
      onToggleAllRows: toggleAllLnkRequestRows,
      onToggleRow: toggleLnkRequestRow,
      onSubmit: (methodKeys) => runProtectedEdit('создание заявки ЛНК', () => handleCreateLnkRequest(methodKeys)),
      onExtendRequest: (methodKeys, request) =>
        runProtectedEdit('добавление позиций в заявку ЛНК', () => handleExtendLnkRequest(methodKeys, request)),
      onRunRootCauseAction: openWorkflowRootCauseAction,
    },
    requestManagerOpen: isLnkRequestManagerOpen,
    requestManager: {
      elevated: currentWorkflowRootCauseDestination === 'lnk-request-manager',
      requestName: managedLnkRequestName,
      requestDate: managedLnkRequestDate,
      requestOptions: lnkRequestExtensionOptions,
      requestOptionsHasMore: lnkWorkflowRequestSummaryQuery.data?.hasMore ?? false,
      allRows: lnkRows,
      requestRows: managedLnkRequestRows,
      requestMethods: managedLnkRequestMethods,
      requestNameDraft: managedLnkRequestNameDraft,
      isManagerPending: lnkRequestManagerMutation.isPending,
      isCorrectionPending: lnkRequestCorrectionMutation.isPending,
      canOpenDocument: (fieldKey) => {
        const templateId = getSystemDocumentTemplateIdForField(fieldKey)
        return Boolean(templateId && availableSystemDocumentTypes.has(templateId))
      },
      onClose: currentWorkflowRootCauseDestination === 'lnk-request-manager'
        ? returnFromWorkflowRootCause
        : closeLnkRequestManager,
      onStageChange: controlProcessSettings.preHeatTreatmentLnkEnabled
        ? () => openPreHeatTreatmentResultRegistry({
            rowIds: managedLnkRequestRows.map((row) => row.id),
            registryMode: 'request',
          })
        : undefined,
      onChangeRequest: changeManagedLnkRequest,
      onRequestSearchChange: setLnkWorkflowRequestSearch,
      onCreateRequest: openCreateLnkRequestFromRegistry,
      onAddPositions: (request) => {
        setIsLnkRequestManagerOpen(false)
        openExtendLnkRequestModal(request)
      },
      onOpenRows: () => {
        setIsLnkRequestManagerOpen(false)
        openGeneratedDocumentRows(
          managedLnkRequestRows.map((row) => row.id),
          managedLnkRequestName,
          'lnk',
        )
      },
      onOpenDocument: openReportDocument,
      onChangeControlStage: controlProcessSettings.preHeatTreatmentLnkEnabled
        ? setLnkStageTransferReference
        : undefined,
      onOpenJournalRows: openModalRowsInWeldingJournal,
      onOpenPstoHistory: openPstoHistoryFromDialog,
      onCopyDocumentName: copyManagerDocumentName,
      onRequestNameDraftChange: setManagedLnkRequestNameDraft,
      onRenameRequest: () => runProtectedEdit('переименование заявки ЛНК', renameManagedLnkRequest),
      onClearPosition: (row, methodKey) =>
        runProtectedDelete('очистку позиции заявки ЛНК', () => clearManagedLnkRequestPosition(row, methodKey)),
      onDeleteRequest: (request) => runProtectedDelete('удаление заявки ЛНК', () => deleteManagedLnkRequest(request)),
      rootCauseTarget: activeRootCauseTarget?.kind === 'lnk-control' ? activeRootCauseTarget : undefined,
      onRunRootCauseAction: openWorkflowRootCauseAction,
      onDocumentDateSaved: returnFromWorkflowRootCause,
      onMessage: setMessage,
    },
    resultManagerOpen: isLnkResultManagerOpen,
    resultManager: {
      elevated: currentWorkflowRootCauseDestination === 'lnk-result-manager',
      rows: managedLnkResultRows,
      methods: managedLnkResultMethods,
      entries: managedLnkResultEntries,
      pendingEntries: managedLnkPendingResultRows,
      isContextReady: isLnkRowsContextReady,
      methodKey: managedLnkResultMethodKey,
      initialEntryKey: managedLnkResultTargetKey,
      conclusionDrafts: managedLnkConclusionDrafts,
      pendingResultChanges: managedLnkPendingResultChanges,
      changeHint: managedLnkResultChangeHint,
      isResultCorrectionPending: lnkResultCorrectionMutation.isPending,
      isResultReplacementPending: lnkResultReplacementMutation.isPending,
      isConclusionCorrectionPending: lnkConclusionCorrectionMutation.isPending,
      isRequestCorrectionPending: lnkRequestCorrectionMutation.isPending,
      hasMoreRows:
        managedLnkResultOrderIds === null &&
        (lnkWorkflowRowsQuery.data?.length ?? 0) >= lnkResultRegistryLimit &&
        lnkResultRegistryLimit < WORKFLOW_REGISTRY_MAX_LOADED_ROWS,
      onLoadMoreRows: () => setLnkResultRegistryLimit((current) =>
        Math.min(current + WORKFLOW_REGISTRY_PAGE_SIZE, WORKFLOW_REGISTRY_MAX_LOADED_ROWS),
      ),
      onRegistrySearchChange: (value) => {
        setLnkResultRegistrySearch(value)
        setLnkResultRegistryLimit(WORKFLOW_REGISTRY_PAGE_SIZE)
      },
      onRegistryResultFilterChange: (value) => {
        setLnkResultRegistryFilter(value)
        setLnkResultRegistryLimit(WORKFLOW_REGISTRY_PAGE_SIZE)
      },
      onClose: currentWorkflowRootCauseDestination === 'lnk-result-manager'
        ? returnFromWorkflowRootCause
        : closeLnkResultManager,
      onStageChange: controlProcessSettings.preHeatTreatmentLnkEnabled
        ? () => openPreHeatTreatmentResultRegistry({
            rowIds: managedLnkResultRows.map((row) => row.id),
            registryMode: 'result',
          })
        : undefined,
      onOpenAddResult: openAddLnkResultFromRegistry,
      onOpenRows: (row) => {
        closeLnkResultManager()
        filterSelectedRowsInCurrentReport([row])
      },
      onOpenDocument: openReportDocument,
      onChangeControlStage: controlProcessSettings.preHeatTreatmentLnkEnabled
        ? setLnkStageTransferReference
        : undefined,
      onOpenJournalRows: openModalRowsInWeldingJournal,
      onOpenPstoHistory: openPstoHistoryFromDialog,
      onCopyDocumentName: copyManagerDocumentName,
      canOpenDocument: (fieldKey) => {
        const templateId = getSystemDocumentTemplateIdForField(fieldKey)
        return Boolean(templateId && availableSystemDocumentTypes.has(templateId))
      },
      onMethodChange: changeManagedLnkResultMethod,
      onConclusionDraftChange: changeManagedLnkConclusionDraft,
      onRenameConclusion: (row, methodKey, conclusionName) =>
        runProtectedEdit(
          'переименование заключения ЛНК',
          () => renameManagedLnkConclusionForRow(row, methodKey, conclusionName),
        ),
      onRepairRequest: (row, methodKey, requestName, requestDate) =>
        runProtectedEdit(
          'восстановление заявки ЛНК',
          () => lnkRequestCorrectionMutation.mutateAsync({
            record: row,
            methodKey,
            requestName,
            requestDate,
          }),
        ),
      onReplaceResult: (row, methodKey, result) =>
        runProtectedEdit('изменение результата ЛНК', () => replaceLnkResult(row, methodKey, result)),
      onClearResult: (row, methodKey) => runProtectedDelete('очистку результата ЛНК', () => clearLnkResult(row, methodKey)),
      onResetPendingChanges: resetManagedLnkResultChanges,
      onSaveChanges: () => runProtectedEdit('сохранение изменений результатов ЛНК', saveManagedLnkResultChanges),
      rootCauseTarget: activeRootCauseTarget?.kind === 'lnk-control' ? activeRootCauseTarget : undefined,
      onRunRootCauseAction: openWorkflowRootCauseAction,
      onDocumentDateSaved: returnFromWorkflowRootCause,
      onMessage: setMessage,
    },
    officialityModalOpen: isLnkOfficialityModalOpen,
    officiality: {
      draft: lnkOfficialityDraft,
      filteredRows: filteredLnkOfficialityRows,
      selectedRows: selectedLnkOfficialityRows,
      counters: lnkOfficialityCounters,
      saveBlockReason: lnkOfficialitySaveBlockReason,
      isSaveDisabled: isLnkOfficialitySaveDisabled,
      onClose: closeLnkOfficialityModal,
      onSave: () => runProtectedEdit('сохранение официальности ЛНК', saveLnkOfficiality),
      onDraftChange: setLnkOfficialityDraft,
      onToggleRow: toggleLnkOfficialityRow,
      onSetVisibleRowsSelected: setVisibleLnkOfficialityRowsSelected,
    },
    duplicateControlModalOpen: isDuplicateControlModalOpen,
    duplicateControl: {
      elevated: currentWorkflowRootCauseDestination === 'duplicate-control',
      draft: duplicateControlDraft,
      filteredRows: filteredDuplicateControlRows,
      filteredRowCount: duplicateControlCandidates.totalCount,
      candidateRowsLoading: duplicateControlCandidates.isLoading,
      candidateRowsError: duplicateControlCandidates.error instanceof Error
        ? duplicateControlCandidates.error.message
        : null,
      candidatePagination: {
        totalCount: duplicateControlCandidates.totalCount,
        firstItemNumber: duplicateControlCandidates.firstItemNumber,
        lastItemNumber: duplicateControlCandidates.lastItemNumber,
        pageSize: duplicateControlCandidates.pageSize,
        hasMore: duplicateControlCandidates.hasMore,
        onLoadMore: duplicateControlCandidates.loadMore,
        onPageSizeChange: duplicateControlCandidates.setPageSize,
      },
      selectedRows: selectedDuplicateControlRows,
      selectedRowsLoading: selectedDuplicateControlRowsLoading,
      selectingFilteredRows: isSelectingDuplicateControlRows,
      controls: duplicateControlDialogControls,
      controlCount: duplicateControlDraft.rowIds.size > 0
        ? duplicateControlDialogControls.length
        : duplicateControlRegistryReady
          ? duplicateControlCount
          : undefined,
      controlsLoading: duplicateControlDraft.rowIds.size > 0
        ? selectedDuplicateControlRowsLoading
        : duplicateControlRegistryLoading || duplicateControlRegistryFetching,
      controlsError: duplicateControlDraft.rowIds.size > 0
        ? selectedDuplicateControlRowsError
        : duplicateControlRegistryError instanceof Error
          ? duplicateControlRegistryError.message
          : null,
      controlsPagination: duplicateControlDraft.rowIds.size > 0
        ? undefined
        : {
            totalCount: duplicateControlCount,
            firstItemNumber: duplicateControlRegistryFirstItemNumber,
            lastItemNumber: duplicateControlRegistryLastItemNumber,
            pageSize: duplicateControlRegistryPageSize,
            hasMore: duplicateControlRegistryHasMore,
            onLoadMore: loadMoreDuplicateControls,
            onPageSizeChange: setDuplicateControlPageSize,
          },
      saveBlockReason: duplicateControlSaveBlockReason,
      isSaving: saveDuplicateControlMutation.isPending || deleteDuplicateControlMutation.isPending,
      onClose: currentWorkflowRootCauseDestination === 'duplicate-control'
        ? returnFromWorkflowRootCause
        : closeDuplicateControlModal,
      onSave: saveDuplicateControl,
      onDelete: deleteDuplicateControlRecord,
      onEdit: editDuplicateControl,
      onDraftChange: setDuplicateControlDraft,
      onToggleRow: toggleDuplicateControlRow,
      onSetVisibleRowsSelected: setVisibleDuplicateControlRowsSelected,
      onToggleMethod: toggleDuplicateControlMethod,
      onExistingControlsOpenChange: setIsDuplicateControlRegistryOpen,
    },
    resultModalOpen: isLnkResultModalOpen,
    result: {
      elevated: currentWorkflowRootCauseDestination === 'lnk-result-dialog',
      draft: lnkResultDraft,
      selectedMethods: selectedLnkResultMethods,
      requestRows: lnkResultSearchRows,
      selectedRows: selectedLnkResultRows,
      visibleRows: visibleLnkResultRows,
      availableRequestOptions: lnkResultAvailableRequestOptions,
      systemDocumentCreationPlan: lnkResultSystemDocumentCreationPlan,
      saveCheckSettings,
      controlProcessSettings,
      saveBlockReason: lnkResultSaveBlockReason,
      rootCauseActions: lnkResultRootCauseActions,
      onRunRootCauseAction: openWorkflowRootCauseAction,
      isSaveDisabled: isLnkResultSaveDisabled,
      contextReady: lnkResultContextReady,
      canBulkToggleRows: canBulkToggleLnkResultRows,
      onClose: currentWorkflowRootCauseDestination === 'lnk-result-dialog'
        ? returnFromWorkflowRootCause
        : closeAddLnkResultModal,
      onOpenManager: openAllLnkResultRegistry,
      onMethodChange: changeLnkResultMethod,
      onControlDateChange: (controlDate) => setLnkResultDraft((current) => ({ ...current, controlDate })),
      onDefaultResultChange: (result) => {
        if (saveCheckSettings.lnkResultRepairRules && result === 'ремонт' && selectedLnkResultRows.some(isLnkRepairForbidden)) return
        setLnkResultDraft((current) => ({
          ...current,
          result,
          rowResults: {},
        }))
      },
      onConclusionNamingChange: (conclusionNaming) =>
        setLnkResultDraft((current) => ({ ...current, conclusionNaming })),
      onClearSelection: () => {
        void confirmClearSelectedRows(
          lnkResultDraft.rowIds.size,
          'внесения результатов ЛНК',
          () => {
            setLnkResultDraft((current) => ({
              ...current,
              rowIds: new Set(),
              rowResults: {},
            }))
          },
          'Несохраненные индивидуальные результаты выбранных стыков также будут очищены.',
        )
      },
      onSetSelectedRows: setLnkResultRows,
      onSetRowsResult: setLnkResultForRows,
      onOpenJournalRows: openModalRowsInWeldingJournal,
      onOpenPstoHistory: openPstoHistoryFromDialog,
      onStageChange: controlProcessSettings.preHeatTreatmentLnkEnabled
        ? (stage, rowIds) => switchLnkWorkflowStage('result', stage, rowIds)
        : undefined,
      onToggleAllRows: toggleAllLnkResultRows,
      onSearchChange: (search) => setLnkResultDraft((current) => ({ ...current, search })),
      onRequestChange: changeLnkResultRequest,
      onToggleRow: toggleLnkResultRow,
      onSetRowResult: setLnkResultForRow,
      onSave: () => runProtectedEdit('сохранение результата ЛНК', handleAddLnkResult),
    },
    selectableResultRows: selectableVisibleLnkResultRows,
    preHeatTreatmentWorkflow: preHeatTreatmentLnkWorkflowMode && controlProcessSettings.preHeatTreatmentLnkEnabled
      ? {
          mode: preHeatTreatmentLnkWorkflowMode,
          rows: lnkRows,
          initialSelectedIds: selectedLnkIds,
          initialMethodCode: preHeatTreatmentLnkInitialMethodCode,
          initialRequestSubmitMode: preHeatTreatmentLnkRequestSubmitMode,
          onCandidateSearchChange: setPreHeatTreatmentCandidateSearch,
          onCandidateSelectionChange: setPreHeatTreatmentCandidateIds,
          onCandidateFilterChange: handlePreHeatTreatmentCandidateFilterChange,
          onClose: currentWorkflowRootCauseDestination === 'pre-lnk-workflow'
            ? returnFromWorkflowRootCause
            : () => {
                setPreHeatTreatmentLnkWorkflowMode(null)
                setPreHeatTreatmentLnkInitialMethodCode(undefined)
              },
          onRunProtectedEdit: (actionLabel, action) => runProtectedEdit(actionLabel, action),
          onSaved: (savedRows, fieldKeys, nextMessage) => {
            if (savedRows.length > 0) highlightChangedRows(savedRows, fieldKeys)
            setMessage(nextMessage)
            completeWorkflowRootCause('pre-lnk-workflow')
          },
          onOpenJournalRows: openModalRowsInWeldingJournal,
          onOpenPstoHistory: openPstoHistoryFromDialog,
          onOpenResultRegistry: () => openPreHeatTreatmentResultRegistry({
            registryMode: preHeatTreatmentLnkWorkflowMode,
          }),
          onStageChange: (stage, rowIds, requestSubmitMode) => switchLnkWorkflowStage(
            preHeatTreatmentLnkWorkflowMode,
            stage,
            rowIds,
            requestSubmitMode,
          ),
          onRunRootCauseAction: openWorkflowRootCauseAction,
        }
      : null,
    preHeatTreatmentResultManager: isPreHeatTreatmentResultManagerOpen
      ? {
          elevated: currentWorkflowRootCauseDestination === 'pre-lnk-manager',
          readOnly: !controlProcessSettings.preHeatTreatmentLnkEnabled,
          rows: preHeatTreatmentResultRegistryRows,
          registryMode: preHeatTreatmentResultManagerMode,
          initialRelationId: preHeatTreatmentResultManagerInitialRelationId,
          isPending: preHeatTreatmentResultCorrectionMutation.isPending,
          onClose: currentWorkflowRootCauseDestination === 'pre-lnk-manager'
            ? returnFromWorkflowRootCause
            : closePreHeatTreatmentResultRegistry,
          onStageChange: openPrimaryLnkRegistryFromPreHeatTreatment,
          onOpenWorkflow: () => openPreHeatTreatmentLnkWorkflow(preHeatTreatmentResultManagerMode),
          onCorrect: (payload) => {
            void runProtectedEdit('изменение НК до ТО', () =>
              preHeatTreatmentResultCorrectionMutation.mutateAsync(payload),
            )
          },
          onDeleteRequest: deletePreHeatTreatmentRequest,
          onDeleteResult: deletePreHeatTreatmentResult,
          onOpenDocument: openReportDocument,
          onChangeControlStage: controlProcessSettings.preHeatTreatmentLnkEnabled
            ? setLnkStageTransferReference
            : undefined,
          onOpenJournalRows: openModalRowsInWeldingJournal,
          onOpenPstoHistory: openPstoHistoryFromDialog,
          onCopyDocumentName: copyManagerDocumentName,
          canOpenDocument: (fieldKey) => {
            const templateId = getSystemDocumentTemplateIdForField(fieldKey)
            return Boolean(templateId && availableSystemDocumentTypes.has(templateId))
          },
          rootCauseTarget: activeRootCauseTarget?.kind === 'lnk-control' ? activeRootCauseTarget : undefined,
          onRunRootCauseAction: openWorkflowRootCauseAction,
          onDocumentDateSaved: returnFromWorkflowRootCause,
          onMessage: setMessage,
      }
      : null,
    stageTransfer: lnkStageTransferReference
      ? {
          reference: lnkStageTransferReference,
          onClose: () => setLnkStageTransferReference(null),
          onPendingChange: setIsLnkStageTransferPending,
          onTransferred: async (result) => {
            await invalidateWeldJoints(queryClient, { upsertRows: result.rows })
            const targetLabel = result.preview.targetStage === 'beforeHeatTreatment' ? 'До ТО' : 'Основной'
            setMessage(
              `Перенесено комплектов: ${result.preview.positionCount}. Новый этап: «${targetLabel}».`,
            )
          },
        }
      : null,
  })

  return {
    activeReport,
    activeTitle,
    freezeReportBackground: isReportModalOpen || Boolean(documentGenerationRequest),
    navCollapsed,
    registerMinWidth,
    stickyLeft,
    onNavCollapsedChange: setNavCollapsed,
    onReportChange: changeActiveReport,
    reportHeaderActionsProps,
    reportNotificationToastProps,
    reportSummaryBarProps,
    reportTaskPanelsProps,
    documentGenerationRequest,
    documentGenerationContextLoading:
      Boolean(documentGenerationRequest) && finalStatusContextQuery.isFetching,
    documentGenerationContextError:
      documentGenerationRequest && finalStatusContextQuery.error instanceof Error
        ? finalStatusContextQuery.error.message
        : '',
    documentGenerationFinalStatusContext: remoteFinalStatusContext,
    welderStamps,
    welderStampsRegistryProps,
    weldTableProps,
    onAssignPercentageLineMissingControls: assignPercentageLineMissingControls,
    onCancelPercentageLineMissingControls: cancelPercentageLineMissingControls,
    onOpenPercentageLineStampRows: openPercentageLineStampRows,
    onOpenReportRowIds: openReportRowIds,
    onOpenWeldRowIds: openWeldRowIds,
    percentageLineNavigationRequest,
    onPercentageLineNavigationRequestHandled: (
      requestId: number,
      outcome: PercentageLineNavigationOutcome,
    ) => {
      if (percentageLineNavigationRequest?.id !== requestId) return
      setPercentageLineNavigationRequest((current) => current?.id === requestId ? null : current)
      setMessage(
        outcome === 'opened'
          ? `Открыто назначение контроля по линии ${percentageLineNavigationRequest.line}, клеймо ${percentageLineNavigationRequest.stamp}.`
          : 'Задача уже не актуальна: данные изменились или другой пользователь уже назначил контроль.',
      )
    },
    onDocumentGenerationRequestHandled: handleDocumentGenerationRequest,
    onDocumentGenerated: setMessage,
    onOpenDocumentRows: openGeneratedDocumentRows,
    onOpenDocumentJointHistory: openDocumentJointHistory,
    documentsPageType,
    onDocumentsPageTypeChange: setDocumentsPageType,
    documentNavigationRequest,
    onDocumentNavigationRequestHandled: handleDocumentNavigationRequest,
    reportChainDialogProps,
    reportWeldEditorProps,
    reportPstoDialogsProps,
    reportLnkDialogsProps,
    reportFieldEditorProps,
    reportRkExposureDialogProps,
    reportImportDialogProps,
    rootCauseNavigationProps: currentWorkflowRootCauseAction
      ? {
          actionLabel: currentWorkflowRootCauseAction.label,
          depth: workflowRootCauseStackRef.current.length,
          onReturn: returnFromWorkflowRootCause,
        }
      : null,
  }
}

function getLnkStageTransferReferences(
  row: WeldRow,
  fieldKey?: WeldFieldKey,
): Array<SystemDocumentReference & { documentId: number }> {
  const exactReference = fieldKey
    ? getSystemDocumentReferenceForField(row, fieldKey)
    : null
  if (isLnkStageTransferReference(exactReference)) return [exactReference]

  const fieldKeys = [
    ...LNK_METHODS.flatMap((method) => isPreHeatTreatmentLnkMethodCode(method.code)
      ? [method.requestKey, method.conclusionKey]
      : []),
    ...PRE_HEAT_TREATMENT_REPORT_FIELD_KEYS,
  ]
  const byDocumentId = new Map<number, SystemDocumentReference & { documentId: number }>()
  for (const candidateFieldKey of fieldKeys) {
    const reference = getSystemDocumentReferenceForField(row, candidateFieldKey)
    if (isLnkStageTransferReference(reference)) {
      byDocumentId.set(reference.documentId, reference)
    }
  }
  return [...byDocumentId.values()].sort((left, right) => {
    if (left.type !== right.type) return left.type === 'lnkRequest' ? -1 : 1
    return left.title.localeCompare(right.title, 'ru')
  })
}

function isLnkStageTransferReference(
  reference: SystemDocumentReference | null,
): reference is SystemDocumentReference & { documentId: number } {
  if (!reference?.documentId || reference.documentId <= 0) return false
  if (reference.type !== 'lnkRequest' && reference.type !== 'lnkConclusion') return false
  if (reference.sourceKind && reference.sourceKind !== 'beforeHeatTreatment') return false
  return !reference.methodCode || isPreHeatTreatmentLnkMethodCode(reference.methodCode)
}

function formatLnkStageTransferReference(reference: SystemDocumentReference) {
  const documentLabel = reference.type === 'lnkRequest' ? 'Заявка' : 'Заключение'
  const stageLabel = reference.sourceKind === 'beforeHeatTreatment' ? 'До ТО' : 'Основной'
  return `${documentLabel} · ${stageLabel} · ${reference.title}`
}

function getDuplicateControlSaveBlockReason({
  draft,
  isSaving,
  saveCheckSettings,
  selectedRows,
  systemIndexSettings,
}: {
  draft: DuplicateControlDraft
  isSaving: boolean
  saveCheckSettings: SaveCheckSettings
  selectedRows: WeldRow[]
  systemIndexSettings: SystemIndexSettings
}) {
  if (isSaving) return 'Дубль-контроль сохраняется, дождитесь завершения.'
  if (selectedRows.length === 0) return 'Выберите один или несколько стыков.'
  if (draft.methods.size === 0) return 'Выберите метод дубль-контроля.'
  if (!draft.result) return 'Выберите результат дубль-контроля.'
  if (draft.id && (selectedRows.length !== 1 || draft.methods.size !== 1)) {
    return 'При редактировании должна быть выбрана одна запись дубль-контроля.'
  }
  if (String(draft.result).trim().toLowerCase() === 'ремонт') {
    const methodCodes = [...draft.methods].map((method) => `${method} (дубль)`).join(', ')
    for (const row of selectedRows) {
      const reason = getLnkRepairResultSaveReason(
        row,
        methodCodes,
        saveCheckSettings,
        systemIndexSettings,
      )
      if (reason) return formatSaveCheckBlockReason('lnkResultRepairRules', reason)
    }
  }
  return null
}
