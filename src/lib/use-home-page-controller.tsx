import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, ClipboardCheck, ExternalLink, FileSpreadsheet, FilePlus2, FileText, GitBranch, ListFilter, Pencil, Trash2 } from 'lucide-react'
import type { DispatcherTask, PercentageLineControlTask, WeldDraft, WeldRow } from '@/lib/dispatcher-types'
import { copyTextToClipboard } from '@/lib/clipboard'
import type { ActiveReport } from '@/lib/home-state'
import {
  useAutoCollapseNavOnHorizontalScroll,
  useEscapeToClearReportFilters,
} from '@/lib/report-page-effects'
import { useWelderStampRegistryState } from '@/lib/use-welder-stamp-registry-state'
import { useReportSwitchReset } from '@/lib/use-report-switch-reset'
import { useReportHighlights } from '@/lib/use-report-highlights'
import { useReportOutputActions } from '@/lib/use-report-output-actions'
import { useReportModalEscapeKey } from '@/lib/use-report-modal-escape-key'
import { useReportModalSyncEffects } from '@/lib/use-report-modal-sync-effects'
import { useJointChainDialogState } from '@/lib/use-joint-chain-dialog-state'
import { useDispatcherTaskSnapshot } from '@/lib/use-dispatcher-task-snapshot'
import {
  buildDispatcherTaskServerFilters,
} from '@/lib/dispatcher-task-row-codes'
import { useDispatcherAcceptedWarnings } from '@/lib/use-dispatcher-accepted-warnings'
import { useDispatcherTaskUiState } from '@/lib/use-dispatcher-task-ui-state'
import { useReportRows } from '@/lib/use-report-rows'
import { useWeldPageQuery } from '@/lib/use-weld-page-query'
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
import { useLnkOfficialityActions } from '@/lib/use-lnk-officiality-actions'
import { useLnkRequestActions } from '@/lib/use-lnk-request-actions'
import type { LnkRequestComposerMode } from '@/lib/use-lnk-request-modal-state'
import { useLnkResultActions } from '@/lib/use-lnk-result-actions'
import { useLnkResultSaveActions } from '@/lib/use-lnk-result-save-actions'
import { useReportEditActions } from '@/lib/use-report-edit-actions'
import { useManagedLnkRequestActions } from '@/lib/use-managed-lnk-request-actions'
import { useManagedLnkResultActions } from '@/lib/use-managed-lnk-result-actions'
import { useHomeDocumentController } from '@/lib/use-home-document-controller'
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
  useWeldReportContextQuery,
  useWeldsQuery,
} from '@/lib/use-welds-query'
import { useDuplicateControls } from '@/lib/use-duplicate-controls'
import type { ContextActionMenuItem } from '@/components/context-action-menu'
import { updateWeldRowsOrThrow } from '@/lib/weld-save-utils'
import { invalidateWeldJoints } from '@/lib/weld-query-utils'
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
import { isLnkRepairForbidden } from '@/lib/lnk-result-rules'
import { isFinalLnkResultValue } from '@/lib/lnk-status'
import { filterWeldRowsByColumns } from '@/lib/weld-table-filtering'
import { buildHeatTreatmentReportRows, buildLnkReportRows, sumAcceptedWdi } from '@/lib/report-row-utils'
import type { ReportImportRecord } from '@/lib/report-import-preview'
import type { WeldRowVersionTarget } from '@/lib/weld-row-version'
import { buildFinalStatusRowsContext, type WeldFieldKey, type WeldInput } from '@/lib/weld-fields'
import {
  createDefaultLnkResultDraft,
  createDefaultPstoResultDraft,
} from '@/lib/report-draft-state'
import { canCreatePstoRequest } from '@/lib/psto-status'
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
import { getPstoCycleStageLabel } from '@/lib/psto-cycle-corrections'
import {
  canCreateRepeatPstoCycle,
  getCurrentPstoCycle,
  getPstoTvmtWorkflowState,
} from '@/lib/tvmt-cycle'
import { withOfficialJoint } from '@/lib/report-control-state'
import { getLnkRowRequestNames } from '@/lib/report-modal-rows'
import {
  getLnkRequestDocumentIdentities,
  getPstoRequestDocumentIdentities,
} from '@/lib/request-document-identity'
import {
  getArchivedOfficialStampValuesForRecord,
  getOfficialStampCompatibilitySaveBlockReason,
} from '@/lib/welder-stamp-compatibility'
import { useOtherSettings } from '@/lib/other-settings'
import { useControlProcessSettings } from '@/lib/control-process-settings'
import { getLnkVisibleFieldSections } from '@/lib/lnk-visible-field-layout'
import { useSaveCheckSettings } from '@/lib/save-check-settings'
import { useSystemIndexSettings } from '@/lib/system-index-settings'
import { useWeldJournalMutations } from '@/lib/use-weld-journal-mutations'
import {
  buildLineFilters,
  buildPercentageLineStampFilters,
  buildRowIdListFilters,
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
import {
  createEmptyDuplicateControlDraft,
  type DuplicateControlDraft,
  type DuplicateControlMethod,
  type DuplicateControlRecord,
} from '@/lib/duplicate-control-types'
import {
  getDefaultNamingState,
  useRequestConclusionSettings,
} from '@/lib/request-conclusion-settings'
import { getWeldJointById, listWeldJointRowsByIds } from '@/server/weld-read-api'
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
  action: JointNextAction
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
    getPstoLineMoveDisposition,
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
    documentsPageType,
    message,
    lnkNotice,
    setChainRecord,
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
    onSaved: (row) => highlightChangedRows([row], PRE_HEAT_TREATMENT_REPORT_FIELD_KEYS),
  })
  const pstoCycleCorrectionMutation = usePstoCycleCorrectionMutation({
    setMessage,
    onSaved: (row) => highlightChangedRows([row], [
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
    ]),
  })
  const pstoTvmtCorrectionWithLaterCycleRemovalMutation = usePstoTvmtCorrectionWithLaterCycleRemovalMutation({
    setMessage,
    onSaved: (row) => highlightChangedRows([row], [
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
    ]),
  })
  const {
    selectedHeatTreatmentIds,
    selectedLnkIds,
    selectedWeldingJournalIds,
    setSelectedHeatTreatmentIds,
    setSelectedLnkIds,
    setSelectedWeldingJournalIds,
  } = useReportSelectionState()
  const deferredJointNextActionRef = useRef<DeferredJointNextAction | null>(null)
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
  } = useWelderStampRegistryState({ setMessage })
  const {
    documentGenerationRequest,
    generateDocumentForRows,
    handleDocumentGenerationRequest,
    openReportDocument,
    systemDocumentNavigationRequest,
    setSystemDocumentNavigationRequest,
    handleSystemDocumentNavigationRequest,
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
    }) || Boolean(tvmtWorkflowMode) || Boolean(pstoRepeatWorkflowMode) || Boolean(preHeatTreatmentLnkWorkflowMode) || isPreHeatTreatmentResultManagerOpen
  const isPstoDataModalOpen =
    isPstoRequestModalOpen ||
    isPstoRequestManagerOpen ||
    isPstoResultModalOpen ||
    isPstoResultManagerOpen ||
    Boolean(tvmtWorkflowMode) ||
    Boolean(pstoRepeatWorkflowMode)
  const isLnkDataModalOpen =
    isLnkRequestModalOpen ||
    isLnkRequestManagerOpen ||
    isLnkResultModalOpen ||
    isLnkResultManagerOpen ||
    isLnkOfficialityModalOpen ||
    Boolean(preHeatTreatmentLnkWorkflowMode) ||
    isPreHeatTreatmentResultManagerOpen
  const isReportModalOpen =
    isImportDialogOpen || Boolean(rkExposureEditing) || isReportDataModalOpen || isPstoLineProgramOpen

  useEffect(() => {
    if (activeReport !== 'heatTreatment' && tvmtWorkflowMode) setTvmtWorkflowMode(null)
    if (activeReport !== 'heatTreatment' && pstoRepeatWorkflowMode) setPstoRepeatWorkflowMode(null)
    if (activeReport !== 'heatTreatment' && isPstoLineProgramOpen) setIsPstoLineProgramOpen(false)
    if (activeReport !== 'lnk' && preHeatTreatmentLnkWorkflowMode) setPreHeatTreatmentLnkWorkflowMode(null)
    if (activeReport !== 'lnk' && isPreHeatTreatmentResultManagerOpen) setIsPreHeatTreatmentResultManagerOpen(false)
  }, [activeReport, isPreHeatTreatmentResultManagerOpen, isPstoLineProgramOpen, preHeatTreatmentLnkWorkflowMode, pstoRepeatWorkflowMode, tvmtWorkflowMode])

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
  const shouldLoadFullWeldRows =
    Boolean(documentGenerationRequest) ||
    isDuplicateControlModalOpen ||
    isWeldingJournalGenerateMenuOpen ||
    isWeldingJournalShowMenuOpen
  const weldsQuery = useWeldsQuery({ enabled: shouldLoadFullWeldRows })
  const shouldLoadLnkContext =
    !shouldLoadFullWeldRows &&
    (isLnkDataModalOpen || isLnkShowMenuOpen || isLnkWorkflowMenuOpen || heatTreatmentFieldEditing?.report === 'lnk')
  const shouldLoadPstoContext =
    !shouldLoadFullWeldRows &&
    (isPstoDataModalOpen || isPstoShowMenuOpen || isPstoWorkflowMenuOpen || Boolean(heatTreatmentFieldEditing && heatTreatmentFieldEditing.report !== 'lnk'))
  const lnkContextQuery = useWeldReportContextQuery({
    enabled: shouldLoadLnkContext,
    report: 'lnk',
  })
  const pstoContextQuery = useWeldReportContextQuery({
    enabled: shouldLoadPstoContext,
    report: 'heatTreatment',
  })
  const finalStatusContextQuery = useWeldFinalStatusContextQuery({
    enabled: isServerPagedTab && !shouldLoadFullWeldRows,
  })
  const remoteFinalStatusContext = useMemo(
    () => ({
      rejectedUnofficialSameNameRepairKeys: new Set(finalStatusContextQuery.data ?? []),
    }),
    [finalStatusContextQuery.data],
  )
  const isRemoteFinalStatusContextReady =
    finalStatusContextQuery.data !== undefined && !finalStatusContextQuery.isFetching
  const {
    duplicateControls,
    saveDuplicateControlMutation,
    deleteDuplicateControlMutation,
  } = useDuplicateControls({
    enabled: shouldLoadFullWeldRows,
  })

  const reportContextSourceRows = useMemo(() => {
    if (shouldLoadFullWeldRows) return weldsQuery.data
    const rowsById = new Map<number, WeldRow>()
    const contextRows = [
      ...(shouldLoadLnkContext ? lnkContextQuery.data ?? [] : []),
      ...(shouldLoadPstoContext ? pstoContextQuery.data ?? [] : []),
    ]
    for (const row of contextRows) {
      rowsById.set(Number(row.id), row)
    }
    return [...rowsById.values()]
  }, [
    lnkContextQuery.data,
    pstoContextQuery.data,
    shouldLoadFullWeldRows,
    shouldLoadLnkContext,
    shouldLoadPstoContext,
    weldsQuery.data,
  ])
  const rows = useReportRows(
    reportContextSourceRows,
    shouldLoadFullWeldRows ? duplicateControls : [],
    undefined,
    shouldLoadFullWeldRows ? undefined : remoteFinalStatusContext,
    otherSettings,
  )
  const isLnkRowsContextReady = shouldLoadFullWeldRows
    ? weldsQuery.data !== undefined && !weldsQuery.isFetching
    : shouldLoadLnkContext &&
      lnkContextQuery.data !== undefined &&
      !lnkContextQuery.isFetching &&
      isRemoteFinalStatusContextReady
  const isPstoRowsContextReady = shouldLoadFullWeldRows
    ? weldsQuery.data !== undefined && !weldsQuery.isFetching
    : shouldLoadPstoContext &&
      pstoContextQuery.data !== undefined &&
      !pstoContextQuery.isFetching &&
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
    ? dispatcherTaskSnapshot.allRepeatedJointTasks
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
    filteredLnkRequestRows,
    filteredAvailableLnkRequestRows,
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
  })
  const {
    lnkRequestMutation,
    lnkRequestExtensionMutation,
    lnkRequestCorrectionMutation,
    lnkRequestManagerMutation,
    lnkResultMutation,
    lnkOfficialityMutation,
    lnkResultCorrectionMutation,
    lnkResultReplacementMutation,
    lnkConclusionCorrectionMutation,
    lnkFieldMutation,
  } = useLnkReportMutations({
    lnkRows,
    lnkRequestOptions,
    setMessage,
    setLnkNotice,
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
    draft: lnkRequestDraft,
    filteredRows: filteredAvailableLnkRequestRows,
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
    openLnkRequestManager(requestName, requestDate)
  }
  const openCreateLnkRequestFromRegistry = () => {
    if (lnkRequestManagerMutation.isPending || lnkRequestCorrectionMutation.isPending) return
    setIsLnkRequestManagerOpen(false)
    openCreateLnkRequestModal()
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
    isLnkResultSaveDisabled,
  } = useLnkResultDerivedState({
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

  const openAllLnkResultRegistry = () => openLnkResultManager({ rowIds: null })
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
    if (stage === PRE_HEAT_TREATMENT_LNK_CONTROL_STAGE) {
      if (!controlProcessSettings.preHeatTreatmentLnkEnabled) {
        setMessage('НК до ТО выключен в настройках проекта.')
        return
      }
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
    const selectedRows = lnkRows.filter((row) => selectedLnkIds.has(row.id))
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
    isLnkOfficialitySaving: lnkOfficialityMutation.isPending,
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
    setDraft: setLnkOfficialityDraft,
    setIsOpen: setIsLnkOfficialityModalOpen,
  })
  const filteredDuplicateControlRows = useMemo(
    () => filterDuplicateControlRows(rows, duplicateControlDraft.search, duplicateControlDraft.rowIds),
    [duplicateControlDraft.search, duplicateControlDraft.rowIds, rows],
  )
  const selectedDuplicateControlRows = useMemo(
    () => rows.filter((row) => duplicateControlDraft.rowIds.has(row.id)),
    [duplicateControlDraft.rowIds, rows],
  )
  const duplicateControlDialogControls = useMemo(() => {
    if (duplicateControlDraft.rowIds.size === 0) return duplicateControls
    return duplicateControls.filter((control) => duplicateControlDraft.rowIds.has(control.weldJointId))
  }, [duplicateControlDraft.rowIds, duplicateControls])
  const duplicateControlSaveBlockReason = getDuplicateControlSaveBlockReason({
    draft: duplicateControlDraft,
    isSaving: saveDuplicateControlMutation.isPending,
    selectedRows: selectedDuplicateControlRows,
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
  const fullFinalStatusContext = useMemo(() => buildFinalStatusRowsContext(rows), [rows])
  const basePagedReportRows = useReportRows(
    weldPageQuery.rows,
    duplicateControls,
    shouldLoadFullWeldRows ? rows : undefined,
    shouldLoadFullWeldRows ? fullFinalStatusContext : remoteFinalStatusContext,
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
      if (shouldLoadFullWeldRows) void weldsQuery.refetch()
      if (lnkContextQuery.isEnabled) void lnkContextQuery.refetch()
      if (pstoContextQuery.isEnabled) void pstoContextQuery.refetch()
      if (isServerPagedTab) void weldPageQuery.refetch()
    }
    window.addEventListener(GENERATED_DOCUMENT_STORAGE_EVENT, refreshDocumentAssignments)
    return () => window.removeEventListener(GENERATED_DOCUMENT_STORAGE_EVENT, refreshDocumentAssignments)
  }, [
    isServerPagedTab,
    lnkContextQuery.isEnabled,
    lnkContextQuery.refetch,
    pstoContextQuery.isEnabled,
    pstoContextQuery.refetch,
    shouldLoadFullWeldRows,
    weldPageQuery.refetch,
    weldsQuery.refetch,
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
  const generateWeldingJournalDocumentForRows = (documentRows: WeldRow[]) =>
    generateDocumentForRows('weldingJournal', documentRows)
  const generateChecklistDocumentForRows = (documentRows: WeldRow[]) =>
    generateDocumentForRows('checklist', documentRows)
  const generateZniDocumentForRows = (documentRows: WeldRow[]) =>
    generateDocumentForRows('zni', documentRows)
  const generateWeldingJournalDocument = () => generateWeldingJournalDocumentForRows(filteredVisibleRows)
  const generateChecklistDocument = () => generateChecklistDocumentForRows(filteredVisibleRows)
  const generateZniDocument = () => generateZniDocumentForRows(filteredVisibleRows)
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
    heatTreatmentRows,
    isLnkRowsContextReady,
    isPstoRowsContextReady,
    lnkRows,
    setIsLnkShowMenuOpen,
    setIsPstoShowMenuOpen,
    setIsWeldingJournalShowMenuOpen,
    setMessage,
    weldingJournalRows: rows,
    visibleRows,
  })
  useReportModalSyncEffects({
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
    openLinkedReportRow,
    openRowsInReport,
    showRepeatedJointTask,
  } = useJointChainActions({
    activeReport,
    setActiveReport,
    setChainRecord,
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
    const initialRowIds = selectedLnkIds.size > 0 ? new Set(selectedLnkIds) : new Set<number>()
    setDuplicateControlDraft({
      ...createEmptyDuplicateControlDraft(),
      rowIds: initialRowIds,
    })
    setIsDuplicateControlModalOpen(true)
  }

  const openDuplicateControlModalForRow = useCallback((row: WeldRow) => {
    setDuplicateControlDraft({
      ...createEmptyDuplicateControlDraft(),
      rowIds: new Set([row.id]),
      search: String(row.joint ?? ''),
    })
    setIsDuplicateControlModalOpen(true)
  }, [setDuplicateControlDraft])

  const closeDuplicateControlModal = () => {
    setIsDuplicateControlModalOpen(false)
    setDuplicateControlDraft(createEmptyDuplicateControlDraft())
  }

  const toggleDuplicateControlRow = (rowId: number) => {
    setDuplicateControlDraft((current) => {
      if (current.id) return current
      const rowIds = new Set(current.rowIds)
      if (rowIds.has(rowId)) rowIds.delete(rowId)
      else rowIds.add(rowId)
      return { ...current, rowIds }
    })
  }

  const setVisibleDuplicateControlRowsSelected = (selected: boolean) => {
    setDuplicateControlDraft((current) => {
      if (current.id) return current
      const rowIds = new Set(current.rowIds)
      for (const row of filteredDuplicateControlRows) {
        if (selected) rowIds.add(row.id)
        else rowIds.delete(row.id)
      }
      return { ...current, rowIds }
    })
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
        weldJointId: row.id,
        method,
        result,
        controlDate: duplicateControlDraft.controlDate,
        conclusion: duplicateControlDraft.conclusion,
        conclusionDate: duplicateControlDraft.conclusionDate,
      })),
    )

    await saveDuplicateControlMutation.mutateAsync(payloads)
    closeDuplicateControlModal()
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
    await deleteDuplicateControlMutation.mutateAsync(control.id)
    setMessage('Дубль-контроль удален')
  }

  async function runProtectedEdit<T>(actionLabel: string, action: () => T | Promise<T>) {
    if (!(await requireEditPassword(actionLabel))) return undefined
    return action()
  }

  async function runProtectedImport(actionLabel: string, action: () => void | Promise<void>) {
    if (!(await requireImportPassword(actionLabel))) return false
    await action()
    return true
  }

  async function runProtectedDelete(actionLabel: string, action: () => void | Promise<void>) {
    if (!(await requireDeletePassword(actionLabel))) return
    await action()
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

  async function deleteWeldRowById(id: number) {
    if (!(await requireDeletePassword('удаление стыка'))) return
    const row = rows.find((candidate) => candidate.id === id)
    const confirmed = await confirmAction({
      title: 'Удалить стык',
      itemName: row ? `${String(row.line ?? '-')} · ${String(row.joint ?? '-')}` : 'Запись стыка',
      description: 'Запись будет удалена из сварочного журнала.',
      warning: 'Связанные данные по этому стыку могут стать неактуальными. Это действие нельзя отменить.',
    })
    if (confirmed) deleteMutation.mutate(id)
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

    try {
      await deleteManyMutation.mutateAsync(rowIds)
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

  const assignPercentageLineMissingControls = async (rowIds: number[], method: PercentageControlMethod) => {
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

    const fieldKey = method === 'УЗК' ? 'hasUzk' : method === 'ПВК' ? 'hasPvk' : 'hasRk'
    const savedRows = await updateWeldRowsOrThrow(
      targetRows.map((row) => ({
        ...row,
        [fieldKey]: 'да',
      })),
      'Не удалось назначить контроль по процентной линии',
    )
    highlightChangedRows(savedRows, [fieldKey])
    setMessage(`Назначен ${method} по процентной линии: ${savedRows.length}.`)
    await invalidateWeldJoints(queryClient, { upsertRows: savedRows })
  }

  const cancelPercentageLineMissingControls = async (rowIds: number[]) => {
    const targetRows = await listWeldJointRowsByIds({ data: { ids: rowIds } })
    if (targetRows.length === 0) {
      setMessage('Стыки для закрытия недобора не найдены')
      return
    }

    const savedRows = await updateWeldRowsOrThrow(
      targetRows.map((row) => ({
        ...row,
        hasRk: 'отменен',
        hasUzk: 'отменен',
      })),
      'Не удалось закрыть недобор процентной линии',
    )
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
  }

  const openAllPstoHistory = () => {
    setIsPstoResultRegistryAll(true)
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
    isPstoRequestManagerOpen,
    isPstoResultManagerOpen,
    isLnkRequestManagerOpen,
    isLnkResultManagerOpen,
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
    canClosePreHeatTreatmentResultManager: !preHeatTreatmentResultCorrectionMutation.isPending,
    canCloseRkExposureModal: !rkExposureMutation.isPending,
    onClosePstoRequestManager: () => setIsPstoRequestManagerOpen(false),
    onClosePstoResultManager: closePstoResultManager,
    onCloseLnkRequestManager: () => setIsLnkRequestManagerOpen(false),
    onCloseLnkResultManager: closeLnkResultManager,
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
  })

  const dispatcherTaskCardProps = createDispatcherTaskCardHandlers({
    activeReport,
    isTaskExpanded: isRepeatedJointTaskExpanded,
    onToggleDetails: toggleRepeatedJointTaskDetails,
    onShowTask: showRepeatedJointTask,
    onOpenTaskOfficiality: openPercentageLineTaskOfficiality,
    onCreateTask: createRepeatedJoint,
    onCreateEarlyCoil: (task) => runProtectedEdit('досрочная врезка катушки', () => createEarlyCoil(task)),
    onDeleteTask: (task) => runProtectedDelete('удаление повторного стыка', () => deleteObsoleteRepeatedJoint(task)),
    onRenameTask: (task) => runProtectedEdit('переименование стыка', () => renameObsoleteRepeatedJoint(task)),
    onAcceptPercentageLineTask: acceptPercentageLineTask,
    onEditPercentageLineTaskStamp: (task) => runProtectedEdit('редактирование клейма стыка', () => editPercentageLineTaskStamp(task)),
    onSuspendPercentageLineWelder: (task) =>
      runProtectedEdit('добавление отстранения сварщика', () => openWelderSuspensionFromPercentageLineTask(task)),
    onSkipPercentageLineWelderSuspension: skipWelderSuspensionFromPercentageLineTask,
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

  const openLnkOfficialityModalForRow = (row: WeldRow) => {
    setLnkOfficialityDraft({
      rowIds: new Set([row.id]),
      search: String(row.joint ?? row.line ?? ''),
      officiality: '',
    })
    setIsLnkOfficialityModalOpen(true)
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
    const systemDocumentReference = fieldKey
      ? getSystemDocumentReferenceForField(row, fieldKey)
      : null

    if (systemDocumentReference) {
      items.push(
        { type: 'label', id: 'document-navigation-label', label: 'Документ' },
        {
          id: 'open-in-documents',
          label: 'Открыть в документах',
          icon: FileText,
          onSelect: () => {
            captureReportContext('documents')
            setSystemDocumentNavigationRequest({
              requestId: Date.now(),
              ...systemDocumentReference,
            })
            setChainRecord(null)
            setEditing(null)
            setActiveReport('documents')
          },
        },
        {
          id: 'filter-system-document-rows',
          label: 'Показать все стыки документа',
          icon: ListFilter,
          onSelect: () => {
            void filterSystemDocumentRowsInCurrentReport(systemDocumentReference)
          },
        },
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
        label: 'История и цепочка стыка',
        description: 'Полная хронология, активные ДЗ/ЗВ и следующий доступный шаг.',
        icon: GitBranch,
        disabled: isGroupAction,
        title: isGroupAction ? 'Историю и цепочку можно открыть только для одного стыка' : undefined,
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
      const hasPreHeatTreatmentRequestOption = lnkRows.some((candidate) => (
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
        canCreatePstoRequest(candidate) || canCreateRepeatPstoCycle(candidate)
      ))
      const hasPstoResultCandidate = contextRows.some((candidate) => (
        getPstoTvmtWorkflowState(candidate) === 'waiting-psto'
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
    () => heatTreatmentRows.some(canCreateTvmtRequest),
    [heatTreatmentRows],
  )
  const hasAvailableTvmtResultRows = useMemo(
    () => heatTreatmentRows.some(canAddTvmtResult),
    [heatTreatmentRows],
  )
  const hasAvailablePstoWorkflowRequestRows = useMemo(
    () => heatTreatmentRows.some((row) => canCreatePstoRequest(row) || canCreateRepeatPstoCycle(row)),
    [heatTreatmentRows],
  )
  const hasAvailablePstoWorkflowResultRows = useMemo(
    () => heatTreatmentRows.some((row) => getPstoTvmtWorkflowState(row) === 'waiting-psto'),
    [heatTreatmentRows],
  )
  const preHeatTreatmentResultRegistryRows = useMemo(() => {
    const scopedIds = preHeatTreatmentResultManagerRowIds
      ? new Set(preHeatTreatmentResultManagerRowIds)
      : null
    return lnkRows.filter((row) => (
      (!scopedIds || scopedIds.has(row.id)) &&
      getPreHeatTreatmentControls(row).some((control) => Boolean(String(control.requestName ?? '').trim()))
    ))
  }, [lnkRows, preHeatTreatmentResultManagerRowIds])
  const hasPreHeatTreatmentResultRegistryRows = useMemo(
    () => lnkRows.some((row) => getPreHeatTreatmentControls(row).some((control) =>
      isFinalLnkResultValue(control.result),
    )),
    [lnkRows],
  )
  const hasPrimaryLnkResultRegistryRows = useMemo(
    () => lnkRows.some((row) => getLnkResultNavigationEntries(row).length > 0),
    [lnkRows],
  )
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
    createPstoRequestDisabled: !isPstoRowsContextReady || !hasAvailablePstoWorkflowRequestRows,
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
    pstoResultDisabled: !isPstoRowsContextReady || !hasAvailablePstoWorkflowResultRows,
    onEditSelectedPstoResults: () => {
      setIsPstoResultRegistryAll(false)
      openPstoResultManagerForRows(selectedPstoHeaderRows)
    },
    editSelectedPstoResultsDisabled: !selectedPstoHeaderRows.some(hasPstoResultData),
    onOpenPstoResultRegistry: () => {
      openAllPstoHistory()
    },
    pstoResultRegistryDisabled: !isPstoRowsContextReady || pstoResultRegistryRows.length === 0,
    onCreateTvmtRequest: () => openTvmtWorkflow('request'),
    createTvmtRequestDisabled: !isPstoRowsContextReady || !hasAvailableTvmtRequestRows,
    onAddTvmtResult: () => openTvmtWorkflow('result'),
    addTvmtResultDisabled: !isPstoRowsContextReady || !hasAvailableTvmtResultRows,
    tvmtPending: false,
    isPstoShowMenuOpen,
    onTogglePstoShowMenu: () => setIsPstoShowMenuOpen((current) => !current),
    onOpenPstoCurrentReport: openPstoCurrentReport,
    onOpenPstoWaitingRequestReport: openPstoWaitingRequestReport,
    onOpenPstoResultsReport: openPstoResultsReport,
    onPstoWorkflowMenuOpenChange: setIsPstoWorkflowMenuOpen,
    onCreateLnkRequest: () => {
      const selectedRows = lnkRows.filter((row) => selectedLnkIds.has(row.id))
      openCreateLnkWorkflowRequestForRows(selectedRows)
    },
    onExtendLnkRequest: () => openExtendLnkRequestModal(),
    onOpenLnkRequestRegistry: () => openLnkRequestRegistry(),
    lnkRequestPending: lnkRequestMutation.isPending,
    onAddLnkResult: openAddLnkWorkflowResultFromHeader,
    lnkResultDisabled:
      lnkResultMutation.isPending ||
      !isLnkRowsContextReady ||
      selectedLnkResultMethods.length === 0,
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
      isLnkRowsContextReady &&
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
    onMassFillRecords: (records: ReportImportRecord[], skippedRows: number) =>
      runProtectedImport('массовое заполнение данных', async () => {
        await weldMassFillMutation.mutateAsync({ records, skippedRows })
      }),
    onReplaceDataRecords: async (
      records: ReportImportRecord[],
      skippedRows: number,
      expectedVersions: WeldRowVersionTarget[],
    ) => runProtectedImport('замену данных импортом', async () => {
      await weldReplaceDataMutation.mutateAsync({ records, skippedRows, expectedVersions })
    }),
  }

  function openPercentageLineTaskOfficiality(task: DispatcherTask) {
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
    setEditing({ record: record as WeldRow, focusField: 'stamp1K' })
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

  const reportLoadError = isServerPagedTab ? weldPageQuery.error : weldsQuery.error
  const reportLoadErrorMessage = reportLoadError instanceof Error ? reportLoadError.message : null
  const reportSummaryBarProps = createReportSummaryBarProps({
    activeReport,
    left: stickyLeft,
    isLoading: isServerPagedTab ? weldPageQuery.isLoading : weldsQuery.isLoading,
    weldingRows: activeReport === 'weldingJournal' ? filteredVisibleRows : rows,
    weldingRowCount: activeReport === 'weldingJournal' && isServerPagedTab ? weldPageQuery.totalCount : undefined,
    acceptedWdiTotal:
      activeReport === 'weldingJournal' && isServerPagedTab ? weldPageQuery.acceptedWdiTotal : filteredAcceptedWdiTotal,
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
  })
  const reportNotificationToastProps = {
    message: reportLoadErrorMessage ?? lnkNotice ?? message ?? undefined,
    tone: reportLoadErrorMessage
      ? 'error' as const
      : lnkNotice
        ? 'success' as const
        : 'info' as const,
    onDismiss: reportLoadErrorMessage
      ? undefined
      : lnkNotice
        ? dismissLnkNotice
        : dismissMessage,
  }

  const reportTaskPanelsProps = createReportTaskPanelsProps({
    activeReport,
    repeatedJointTasks: visibleRepeatedJointTasks,
    repeatedJointTaskGroups: visibleRepeatedJointTaskGroups,
    welderStampExpiryTasks: visibleWelderStampExpiryTasks,
    welderStampNotificationGroups: visibleWelderStampNotificationGroups,
    stickyLeft,
    handlers: dispatcherTaskCardProps,
    isTaskExpanded: isRepeatedJointTaskExpanded,
    onToggleDetails: toggleRepeatedJointTaskDetails,
    onDismissTasks: dismissRepeatedJointTasks,
    columnFilters: activeColumnFilters,
    onColumnFiltersChange: activeFiltersSetter,
  })
  function runJointNextAction(row: WeldRow, action: JointNextAction) {
    const targetReport = action.kind === 'editWeld' || action.kind === 'dispatcherTask'
      ? 'weldingJournal'
      : action.kind === 'pstoRequest' || action.kind === 'pstoResult' || action.kind === 'tvmtRequest' || action.kind === 'tvmtResult'
        ? 'heatTreatment'
        : action.kind === 'preLnkRequest' || action.kind === 'preLnkResult' || action.kind === 'primaryLnkRequest' || action.kind === 'primaryLnkResult'
          ? 'lnk'
          : null
    if (targetReport) captureReportContext(targetReport)
    setChainRecord(null)
    if (targetReport && targetReport !== activeReport) {
      deferredJointNextActionRef.current = { targetReport, row, action }
      setActiveReport(targetReport)
      return
    }
    openJointNextAction(row, action)
  }

  function openJointNextAction(row: WeldRow, action: JointNextAction) {
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
      const method = getPendingLnkResultMethods(row)
        .find((candidate) => candidate.code === action.methodCode)
      if (method) openAddLnkResultModalForMethod(row, method.requestKey)
      else openAddLnkResultModalForRow(row)
      return
    }
    if (action.kind === 'dispatcherTask') {
      const task = adviceRepeatedJointTasks.find((candidate) => candidate.key === action.taskKey)
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

  useEffect(() => {
    const deferred = deferredJointNextActionRef.current
    if (!deferred || deferred.targetReport !== activeReport) return
    deferredJointNextActionRef.current = null
    openJointNextAction(deferred.row, deferred.action)
  }, [activeReport])
  const reportChainDialogProps = createReportChainDialogProps({
    chainRecord,
    chainRows,
    transitions: chainTransitions,
    earlyCoilCandidates: chainEarlyCoilCandidates,
    dispatcherTasks: adviceRepeatedJointTasks,
    errorMessage: chainRowsError,
    isLoading: isChainRowsLoading,
    onClose: () => setChainRecord(null),
    onOpenBase: openChainBaseInCurrentReport,
    onOpenRow: openChainRowInCurrentReport,
    onOpenDocument: openReportDocument,
    onOpenReport: (row, report) => openRowsInReport([row], report),
    onRunNextAction: runJointNextAction,
    canCreateEarlyCoil: activeReport === 'weldingJournal',
    isEarlyCoilPending: earlyCoilMutation.isPending,
    onCreateEarlyCoil: (row, candidate) =>
      runProtectedEdit('досрочная врезка катушки', () => createEarlyCoilFromChain(row, candidate)),
    onRetry: retryChainRows,
  })
  const allowedArchivedOfficialStampsForEditing = getArchivedOfficialStampValuesForRecord(editing?.record, welderStamps)
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

    const disposition = getPstoLineMoveDisposition(saveValue)
    saveMutation.mutate(disposition
      ? { ...saveValue, pstoLineMoveDisposition: disposition }
      : saveValue)
  }
  const reportWeldEditorProps = createReportWeldEditorProps({
    editing,
    suggestionRows: rows.length > 0 ? rows : undefined,
    stampSelectOptions: (draft) => getWeldFormStampSelectOptions(draft, allowedArchivedOfficialStampsForEditing),
    getExternalSaveBlockReason: (draft) => {
      const stampReason = getOfficialStampCompatibilitySaveBlockReason(draft, welderStamps, {
        saveCheckSettings,
        suspensions: welderStampSuspensions,
      })
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
          initialDisposition: pstoLineMoveDraftState.disposition,
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
      onOpenRequestManager: openPstoRequestManager,
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
    },
    filteredAvailableRequestRows: filteredAvailablePstoRequestRows,
    requestManagerOpen: isPstoRequestManagerOpen,
    requestManager: {
      requestName: managedPstoRequestName,
      requestDate: managedPstoRequestDate,
      requestOptions: pstoRequestManagerOptions,
      requestRows: managedPstoRequestRows,
      requestNameDraft: managedPstoRequestNameDraft,
      isManagerPending: pstoRequestManagerMutation.isPending,
      isCorrectionPending: pstoRequestCorrectionMutation.isPending,
      canOpenDocument: availableSystemDocumentTypes.has('pstoRequest'),
      onClose: () => setIsPstoRequestManagerOpen(false),
      onChangeRequest: changeManagedPstoRequest,
      onRequestNameDraftChange: setManagedPstoRequestNameDraft,
      onRenameRequest: () => runProtectedEdit('переименование заявки ПСТО', renameManagedPstoRequest),
      onOpenDocument: (row) => openReportDocument(row, 'pstoRequest'),
      onOpenJournalRows: openModalRowsInWeldingJournal,
      onOpenPstoHistory: openPstoHistoryFromDialog,
      onCopyDocumentName: copyManagerDocumentName,
      onClearPosition: (row) => runProtectedDelete('очистку позиции заявки ПСТО', () => clearManagedPstoRequestPosition(row)),
      onDeleteRequest: (request) => runProtectedDelete('удаление заявки ПСТО', () => deleteManagedPstoRequest(request)),
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
      rows: managedPstoResultRows,
      diagramDrafts: managedPstoDiagramDrafts,
      isPending:
        pstoResultCorrectionMutation.isPending ||
        pstoCycleCorrectionMutation.isPending ||
        pstoTvmtCorrectionWithLaterCycleRemovalMutation.isPending,
      canOpenDocument: availableSystemDocumentTypes.has('pstoConclusion'),
      onClose: closePstoResultManager,
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
          title: `Удалить: ${getPstoCycleStageLabel(payload.stage).toLocaleLowerCase('ru-RU')}`,
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
    },
    tvmtWorkflow: tvmtWorkflowMode
      ? {
          mode: tvmtWorkflowMode,
          rows: heatTreatmentRows,
          initialSelectedIds: selectedHeatTreatmentIds,
          onClose: () => setTvmtWorkflowMode(null),
          onRunProtectedEdit: (actionLabel, action) => runProtectedEdit(actionLabel, action),
          onSaved: (savedRows, fieldKeys, nextMessage) => {
            if (savedRows.length > 0) highlightChangedRows(savedRows, fieldKeys)
            setMessage(nextMessage)
          },
          onOpenJournalRows: openModalRowsInWeldingJournal,
          onOpenPstoHistory: openPstoHistoryFromDialog,
          onOpenResultManager: openPstoHistoryRowsFromDialog,
        }
      : null,
    repeatWorkflow: pstoRepeatWorkflowMode
      ? {
          mode: pstoRepeatWorkflowMode,
          rows: heatTreatmentRows,
          initialSelectedIds: selectedHeatTreatmentIds,
          onClose: () => setPstoRepeatWorkflowMode(null),
          onRunProtectedEdit: (actionLabel, action) => runProtectedEdit(actionLabel, action),
          onSaved: (savedRows, fieldKeys, nextMessage) => {
            if (savedRows.length > 0) highlightChangedRows(savedRows, fieldKeys)
            setMessage(nextMessage)
          },
          onOpenJournalRows: openModalRowsInWeldingJournal,
          onOpenPstoHistory: openPstoHistoryFromDialog,
          onOpenResultManager: openPstoHistoryRowsFromDialog,
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
      nextRequestName: nextLnkRequestName,
      nextRequestNumber: nextLnkRequestNumber,
      selectedRowsCount: selectedLnkRows.length,
      selectedRows: selectedLnkRows,
      requestNaming: lnkRequestNaming,
      requestDate: lnkRequestDraft.requestDate,
      requestExtensionOptions: lnkRequestExtensionOptions,
      initialMode: lnkRequestComposerMode,
      initialRequestKey: lnkRequestTargetKey,
      initialSelectedMethods: lnkRequestDraft.methods,
      requestSearch: lnkRequestSearch,
      message,
      lnkRowsCount: lnkRows.length,
      filteredRows: filteredLnkRequestRows,
      filteredAvailableRows: filteredAvailableLnkRequestRows,
      availableRows: availableLnkRequestRows,
      selectedIds: selectedLnkIds,
      isPending: lnkRequestMutation.isPending || lnkRequestExtensionMutation.isPending,
      saveCheckSettings,
      onClose: closeCreateLnkRequestModal,
      onOpenRequestRegistry: () => openLnkRequestRegistry(),
      onRequestNamingChange: setLnkRequestNaming,
      onRequestDateChange: (requestDate) => setLnkRequestDraft((current) => ({ ...current, requestDate })),
      onRequestSearchChange: setLnkRequestSearch,
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
    },
    requestManagerOpen: isLnkRequestManagerOpen,
    requestManager: {
      requestName: managedLnkRequestName,
      requestDate: managedLnkRequestDate,
      requestOptions: lnkRequestExtensionOptions,
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
      onClose: closeLnkRequestManager,
      onStageChange: controlProcessSettings.preHeatTreatmentLnkEnabled
        ? () => openPreHeatTreatmentResultRegistry({
            rowIds: managedLnkRequestRows.map((row) => row.id),
            registryMode: 'request',
          })
        : undefined,
      onChangeRequest: changeManagedLnkRequest,
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
      onOpenJournalRows: openModalRowsInWeldingJournal,
      onOpenPstoHistory: openPstoHistoryFromDialog,
      onCopyDocumentName: copyManagerDocumentName,
      onRequestNameDraftChange: setManagedLnkRequestNameDraft,
      onRenameRequest: () => runProtectedEdit('переименование заявки ЛНК', renameManagedLnkRequest),
      onClearPosition: (row, methodKey) =>
        runProtectedDelete('очистку позиции заявки ЛНК', () => clearManagedLnkRequestPosition(row, methodKey)),
      onDeleteRequest: (request) => runProtectedDelete('удаление заявки ЛНК', () => deleteManagedLnkRequest(request)),
    },
    resultManagerOpen: isLnkResultManagerOpen,
    resultManager: {
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
      onClose: closeLnkResultManager,
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
      onReplaceResult: (row, methodKey, result) =>
        runProtectedEdit('изменение результата ЛНК', () => replaceLnkResult(row, methodKey, result)),
      onClearResult: (row, methodKey) => runProtectedDelete('очистку результата ЛНК', () => clearLnkResult(row, methodKey)),
      onResetPendingChanges: resetManagedLnkResultChanges,
      onSaveChanges: () => runProtectedEdit('сохранение изменений результатов ЛНК', saveManagedLnkResultChanges),
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
      draft: duplicateControlDraft,
      filteredRows: filteredDuplicateControlRows,
      selectedRows: selectedDuplicateControlRows,
      allRows: rows,
      controls: duplicateControlDialogControls,
      saveBlockReason: duplicateControlSaveBlockReason,
      isSaving: saveDuplicateControlMutation.isPending || deleteDuplicateControlMutation.isPending,
      onClose: closeDuplicateControlModal,
      onSave: saveDuplicateControl,
      onDelete: deleteDuplicateControlRecord,
      onEdit: editDuplicateControl,
      onDraftChange: setDuplicateControlDraft,
      onToggleRow: toggleDuplicateControlRow,
      onSetVisibleRowsSelected: setVisibleDuplicateControlRowsSelected,
      onToggleMethod: toggleDuplicateControlMethod,
    },
    resultModalOpen: isLnkResultModalOpen,
    result: {
      draft: lnkResultDraft,
      selectedMethods: selectedLnkResultMethods,
      requestRows: lnkResultSearchRows,
      selectedRows: selectedLnkResultRows,
      visibleRows: visibleLnkResultRows,
      availableRequestOptions: lnkResultAvailableRequestOptions,
      systemDocumentCreationPlan: lnkResultSystemDocumentCreationPlan,
      saveCheckSettings,
      saveBlockReason: lnkResultSaveBlockReason,
      isSaveDisabled: isLnkResultSaveDisabled,
      contextReady: lnkResultContextReady,
      canBulkToggleRows: canBulkToggleLnkResultRows,
      onClose: closeAddLnkResultModal,
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
          onClose: () => {
            setPreHeatTreatmentLnkWorkflowMode(null)
            setPreHeatTreatmentLnkInitialMethodCode(undefined)
          },
          onRunProtectedEdit: (actionLabel, action) => runProtectedEdit(actionLabel, action),
          onSaved: (savedRows, fieldKeys, nextMessage) => {
            if (savedRows.length > 0) highlightChangedRows(savedRows, fieldKeys)
            setMessage(nextMessage)
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
        }
      : null,
    preHeatTreatmentResultManager: isPreHeatTreatmentResultManagerOpen
      ? {
          readOnly: !controlProcessSettings.preHeatTreatmentLnkEnabled,
          rows: preHeatTreatmentResultRegistryRows,
          registryMode: preHeatTreatmentResultManagerMode,
          initialRelationId: preHeatTreatmentResultManagerInitialRelationId,
          isPending: preHeatTreatmentResultCorrectionMutation.isPending,
          onClose: closePreHeatTreatmentResultRegistry,
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
          onOpenJournalRows: openModalRowsInWeldingJournal,
          onOpenPstoHistory: openPstoHistoryFromDialog,
          onCopyDocumentName: copyManagerDocumentName,
          canOpenDocument: (fieldKey) => {
            const templateId = getSystemDocumentTemplateIdForField(fieldKey)
            return Boolean(templateId && availableSystemDocumentTypes.has(templateId))
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
    documentGenerationContextLoading: Boolean(documentGenerationRequest) && weldsQuery.isFetching,
    statisticsRows: rows,
    welderStamps,
    welderStampsRegistryProps,
    weldTableProps,
    onAssignPercentageLineMissingControls: assignPercentageLineMissingControls,
    onCancelPercentageLineMissingControls: cancelPercentageLineMissingControls,
    onOpenPercentageLineStampRows: openPercentageLineStampRows,
    onOpenReportRowIds: openReportRowIds,
    onOpenWeldRowIds: openWeldRowIds,
    onDocumentGenerationRequestHandled: handleDocumentGenerationRequest,
    onDocumentGenerated: setMessage,
    onOpenDocumentRows: openGeneratedDocumentRows,
    onOpenDocumentJointHistory: openDocumentJointHistory,
    documentsPageType,
    onDocumentsPageTypeChange: setDocumentsPageType,
    systemDocumentNavigationRequest,
    onSystemDocumentNavigationRequestHandled: handleSystemDocumentNavigationRequest,
    reportChainDialogProps,
    reportWeldEditorProps,
    reportPstoDialogsProps,
    reportLnkDialogsProps,
    reportFieldEditorProps,
    reportRkExposureDialogProps,
    reportImportDialogProps,
  }
}

function filterDuplicateControlRows(rows: WeldRow[], search: string, _selectedIds: Set<number>) {
  const query = search.trim().toLowerCase()
  return query
    ? rows.filter((row) =>
        [row.projectTitle, row.subtitleCode, row.line, row.spool, row.joint]
          .map((value) => String(value ?? '').toLowerCase())
          .some((value) => value.includes(query)),
      )
    : rows
}

function getDuplicateControlSaveBlockReason({
  draft,
  isSaving,
  selectedRows,
}: {
  draft: DuplicateControlDraft
  isSaving: boolean
  selectedRows: WeldRow[]
}) {
  if (isSaving) return 'Дубль-контроль сохраняется, дождитесь завершения.'
  if (selectedRows.length === 0) return 'Выберите один или несколько стыков.'
  if (draft.methods.size === 0) return 'Выберите метод дубль-контроля.'
  if (!draft.result) return 'Выберите результат дубль-контроля.'
  if (draft.id && (selectedRows.length !== 1 || draft.methods.size !== 1)) {
    return 'При редактировании должна быть выбрана одна запись дубль-контроля.'
  }
  return null
}
