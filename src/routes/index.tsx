import { useEffect, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { ReportHeaderActions } from '@/components/report-header-actions'
import { ReportMainContent } from '@/components/report-main-content'
import { ReportPageHeader } from '@/components/report-page-header'
import { ReportSummaryBar } from '@/components/report-summary-bar'
import { ReportTaskPanels } from '@/components/report-task-panels'
import { ReportDialogs } from '@/components/report-dialogs'
import { ReportWorkspace } from '@/components/report-workspace'
import {
  listWeldJoints,
  type WeldFilters,
} from '@/server/welds'
import {
  isMeaningfulRecord,
  normalizeWeldInput,
  parseEditableCsv,
  parseEditableWorkbook,
  parseCsv,
  parseWorkbook,
} from '@/lib/weld-import-export'
import {
  FIELD_BY_KEY,
  type WeldFieldKey,
  type WeldInput,
} from '@/lib/weld-fields'
import {
  HEAT_TREATMENT_EDITABLE_FIELD_KEYS as heatTreatmentEditableFieldKeys,
  LNK_CONCLUSION_FIELD_KEYS as lnkConclusionFieldKeys,
  LNK_CUSTOM_RESULT_VALUE,
  LNK_EDITABLE_FIELD_KEYS as lnkEditableFieldKeys,
  LNK_EMPTY_RESULT_VALUE,
  LNK_REPORT_FIELD_KEYS as lnkReportFieldKeys,
  PSTO_EMPTY_RESULT_VALUE,
  REPAIR_FORBIDDEN_BY_DIAMETER_REASON,
  REPEATED_JOINT_CLEARED_FIELD_KEYS as repeatedJointClearedFieldKeys,
  REQUEST_AND_RESULT_FIELD_KEYS as requestAndResultFieldKeys,
  UNOFFICIAL_REJECTED_WITH_COIL_REASON,
  WELD_STAMP_COMPLETION_GROUPS,
} from '@/lib/report-config'
import {
  getPstoResultBadgeClass,
  getPstoResultLabel,
} from '@/lib/report-badges'
import {
  getJointChainResultItems,
  getJointStatusBadgeClass,
  getJointStatusLabel,
  getLnkDisplayValue,
  getAvailableLnkRequestMethods,
  getLnkMethodByRequestKey,
  hasAnyEnabledLnkControl,
  hasAnyLnkRequest,
  hasPendingLnkRequestResult,
  isFinalLnkResultValue,
} from '@/lib/lnk-status'
import {
  canCreateLnkRequest,
  withOfficialJointStatus,
} from '@/lib/report-control-state'
import { formatWdiTotal } from '@/lib/report-export'
import {
  filterPstoResultRows,
} from '@/lib/report-row-utils'
import { getReportRowActions } from '@/lib/report-row-actions'
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
import { useDispatcherTasks } from '@/lib/use-dispatcher-tasks'
import { useDispatcherTaskUiState } from '@/lib/use-dispatcher-task-ui-state'
import { useReportRows } from '@/lib/use-report-rows'
import { usePreparedReportRows } from '@/lib/use-prepared-report-rows'
import { useReportRequestDerivedState } from '@/lib/use-report-request-derived-state'
import { useActiveReportLayoutState } from '@/lib/use-active-report-layout-state'
import { usePstoResultDerivedState } from '@/lib/use-psto-result-derived-state'
import { useLnkResultDerivedState } from '@/lib/use-lnk-result-derived-state'
import { useManagedLnkResultDerivedState } from '@/lib/use-managed-lnk-result-derived-state'
import { useLnkOfficialityDerivedState } from '@/lib/use-lnk-officiality-derived-state'
import { usePstoModalState } from '@/lib/use-psto-modal-state'
import { useLnkRequestModalState } from '@/lib/use-lnk-request-modal-state'
import { useLnkResultModalState } from '@/lib/use-lnk-result-modal-state'
import { useReportFilterState } from '@/lib/use-report-filter-state'
import { useReportSelectionState } from '@/lib/use-report-selection-state'
import { useReportShowMenuState } from '@/lib/use-report-show-menu-state'
import { useReportPageUiState } from '@/lib/use-report-page-ui-state'
import { useReportImportMutations } from '@/lib/use-report-import-mutations'
import { usePstoReportMutations } from '@/lib/use-psto-report-mutations'
import { usePstoReportActions } from '@/lib/use-psto-report-actions'
import { useLnkReportMutations } from '@/lib/use-lnk-report-mutations'
import { getReportModalOpenState } from '@/lib/report-modal-open-state'
import {
  canOpenLinkedReport,
  getEditableReportImportLabel,
  getJointTitle,
  getOpenLinkedReportTitle,
  getReportBlockedFieldKeys,
  getReportEditableFieldKeys,
  getReportHiddenFieldKeys,
  getReportImportFieldKeys,
  isReadOnlyReport,
  setNumberSetValues,
  shouldMergePstoSections,
  toggleNumberSetValue,
  toggleNumberSetValues,
} from '@/lib/report-ui-state'
import {
  hasText,
} from '@/lib/report-value-utils'
import {
  canCreatePstoRequest,
} from '@/lib/psto-status'
import {
  canSelectLnkResultRow,
  canSelectPstoResultRow,
  filterLnkRowsByRequestName,
  filterPstoRowsByRequestName,
  getLnkInputMethodsForRows,
  getLnkRowRequestNames,
  isEveryFilteredLnkRequestRowSelected,
  rowBelongsToLnkRequest,
  rowBelongsToPstoRequest,
  sortLnkRequestRows,
  sortPstoRequestRows,
} from '@/lib/report-modal-rows'
import {
  buildExactJointFilters,
  buildJointChainFilters,
  getJointBaseFromRow,
  getRepeatedJointTaskActionText,
  getRepeatedJointTaskBaseJoint,
} from '@/lib/report-navigation'
import { buildRepeatedJointTasks } from '@/lib/repeated-joint-tasks'
import {
  formatDateInputValue,
  formatLongDate,
} from '@/lib/date-format'
import {
  getWeldDateOrderValue,
  isDateBeforeWeldDate,
} from '@/lib/report-date-rules'
import {
  compareJointChainSuffix,
  findLastIndex,
  formatRepeatedJointName,
  getCoilJointNames,
  getRepeatedJointFailureCount,
  normalizeJointChainPart,
  parseRepeatedJointName,
} from '@/lib/joint-chain'
import {
  formatJointDiameterLabel,
  getJointChainIdentity,
  isUnofficialJoint,
} from '@/lib/joint-display'
import {
  getLnkRepairForbiddenReason,
  isLnkRepairForbidden,
  isLnkRepairForbiddenByDiameter,
  isLnkRepairForbiddenByOfficialRepairLimit,
} from '@/lib/lnk-result-rules'
import {
  isLnkRequestAllowedForRow,
  isLnkRequestField,
  isLnkResultField,
} from '@/lib/lnk-field-updates'
import {
  buildLnkResultDraftById,
  filterLnkResultDraftRowResults,
  getEffectiveLnkResultDraftValueForRow,
  getManagedLnkResultChangeKey,
  isValidLnkResultDraftValue,
} from '@/lib/lnk-result-draft'
import {
  createDefaultLnkOfficialityDraft,
  createDefaultLnkResultDraft,
  createDefaultPstoResultDraft,
} from '@/lib/report-draft-state'
import {
  collectRequestNames,
  getRequestNameFromNaming,
  sortPstoRequestNamesNewestFirst,
} from '@/lib/report-naming'
import { defaultRequestNamingState } from '@/lib/request-naming-state'
import type { ActiveReport } from '@/lib/home-state'
import {
  formatOfficialStampCompatibilityIssue,
  getOfficialStampCompatibilityIssues,
  getOfficialStampCompatibilitySaveBlockReason,
} from '@/lib/welder-stamp-registry'
import type { RepeatedJointTask, WeldRow } from '@/lib/dispatcher-types'
import { useWeldJournalMutations } from '@/lib/use-weld-journal-mutations'

export const Route = createFileRoute('/')({
  component: Home,
})

const emptyFilters: WeldFilters = {}

function Home() {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
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
  } = useReportFilterState()
  const {
    editing,
    chainRecord,
    heatTreatmentFieldEditing,
    message,
    setEditing,
    setChainRecord,
    setHeatTreatmentFieldEditing,
    setMessage,
  } = useReportPageUiState()
  const {
    highlightedRowIds,
    highlightedCellKeys,
    highlightChangedRows,
    replayLatestHighlight,
  } = useReportHighlights()
  const {
    selectedHeatTreatmentIds,
    selectedLnkIds,
    setSelectedHeatTreatmentIds,
    setSelectedLnkIds,
  } = useReportSelectionState()
  const {
    lnkRequestDraft,
    lnkRequestNaming,
    isLnkRequestModalOpen,
    isLnkRequestManagerOpen,
    managedLnkRequestName,
    managedLnkRequestNameDraft,
    lnkRequestSearch,
    setLnkRequestDraft,
    setLnkRequestNaming,
    setIsLnkRequestModalOpen,
    setIsLnkRequestManagerOpen,
    setManagedLnkRequestName,
    setManagedLnkRequestNameDraft,
    setLnkRequestSearch,
  } = useLnkRequestModalState()
  const {
    pstoRequestNaming,
    pstoRequestSearch,
    pstoResultRequestSearch,
    isPstoRequestModalOpen,
    isPstoRequestManagerOpen,
    managedPstoRequestName,
    managedPstoRequestNameDraft,
    isPstoResultModalOpen,
    isPstoResultManagerOpen,
    managedPstoDiagramDrafts,
    pstoResultDraft,
    setPstoRequestNaming,
    setPstoRequestSearch,
    setPstoResultRequestSearch,
    setIsPstoRequestModalOpen,
    setIsPstoRequestManagerOpen,
    setManagedPstoRequestName,
    setManagedPstoRequestNameDraft,
    setIsPstoResultModalOpen,
    setIsPstoResultManagerOpen,
    setManagedPstoDiagramDrafts,
    setPstoResultDraft,
  } = usePstoModalState()
  const {
    isLnkResultModalOpen,
    isLnkResultPreviewOpen,
    shouldPinPreviewedLnkResultRows,
    lnkResultDraft,
    lnkResultRequestSearch,
    isLnkOfficialityModalOpen,
    lnkOfficialityDraft,
    isLnkResultManagerOpen,
    managedLnkResultRequestName,
    managedLnkResultMethodKey,
    managedLnkResultRequestSearch,
    managedLnkConclusionDrafts,
    managedLnkResultOrderIds,
    managedLnkResultPreview,
    managedLnkResultChangeHint,
    managedLnkPendingResultChanges,
    preservedLnkOrderIds,
    setIsLnkResultModalOpen,
    setIsLnkResultPreviewOpen,
    setShouldPinPreviewedLnkResultRows,
    setLnkResultDraft,
    setLnkResultRequestSearch,
    setIsLnkOfficialityModalOpen,
    setLnkOfficialityDraft,
    setIsLnkResultManagerOpen,
    setManagedLnkResultRequestName,
    setManagedLnkResultMethodKey,
    setManagedLnkResultRequestSearch,
    setManagedLnkConclusionDrafts,
    setManagedLnkResultOrderIds,
    setManagedLnkResultPreview,
    setManagedLnkResultChangeHint,
    setManagedLnkPendingResultChanges,
    setPreservedLnkOrderIds,
  } = useLnkResultModalState()
  const {
    isPstoShowMenuOpen,
    isLnkShowMenuOpen,
    setIsPstoShowMenuOpen,
    setIsLnkShowMenuOpen,
  } = useReportShowMenuState()
  const {
    dismissedRepeatedJointTaskKeys,
    dismissRepeatedJointTask,
    dismissRepeatedJointTasks,
    isRepeatedJointTaskExpanded,
    resetDismissedRepeatedJointTasks,
    setExpandedRepeatedJointTaskKeys,
    toggleRepeatedJointTaskDetails,
  } = useDispatcherTaskUiState()
  const {
    welderStamps,
    welderStampDraft,
    welderStampSearch,
    welderStampFilters,
    editingWelderStampId,
    showArchivedWelderStamps,
    filteredWelderStamps,
    activeWelderStamps,
    archivedWelderStamps,
    weldFormStampSelectOptions,
    getWeldFormStampSelectOptions,
    setWelderStampSearch,
    setWelderStampFilters,
    setShowArchivedWelderStamps,
    updateWelderStampDraft,
    resetWelderStampForm,
    saveWelderStampRecord,
    editWelderStampRecord,
    archiveWelderStampRecord,
    restoreWelderStampRecord,
    deleteWelderStampRecord,
  } = useWelderStampRegistryState({ setMessage })
  const isReportModalOpen = getReportModalOpenState({
    isPstoRequestModalOpen,
    isPstoRequestManagerOpen,
    isPstoResultModalOpen,
    isPstoResultManagerOpen,
    isLnkRequestModalOpen,
    isLnkRequestManagerOpen,
    isLnkResultModalOpen,
    isLnkResultPreviewOpen,
    isLnkResultManagerOpen,
    isLnkOfficialityModalOpen,
  })

  useEscapeToClearReportFilters({
    activeReport,
    editingOpen: Boolean(editing),
    isReportModalOpen,
    chainOpen: Boolean(chainRecord),
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
    setIsLnkRequestModalOpen,
    setIsLnkResultModalOpen,
    setIsLnkResultPreviewOpen,
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
    setShouldPinPreviewedLnkResultRows,
    setWelderStampSearch,
  })

  const weldsQuery = useQuery({
    queryKey: ['weld-joints', emptyFilters],
    queryFn: async () => listWeldJoints({ data: emptyFilters }),
  })

  const rows = useReportRows(weldsQuery.data)

  const {
    repeatedJointTaskGroups,
    repeatedJointTasks,
    welderStampExpiryTasks,
    welderStampNotificationGroups,
  } = useDispatcherTasks({
    activeReport,
    dismissedRepeatedJointTaskKeys,
    rows,
    setExpandedRepeatedJointTaskKeys,
    welderStamps,
  })

  const {
    weldedRows,
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
    rows,
    preservedLnkOrderIds,
    pstoRequestSearch,
    lnkRequestSearch,
  })
  const { chainRows } = useJointChainDialogState({
    rows,
    chainRecord,
    onClose: () => setChainRecord(null),
  })
  const {
    selectedHeatTreatmentRows,
    selectedLnkRows,
    selectedLnkMethodKeys,
    selectedLnkRequestTargetCount,
    nextPstoRequestName,
    nextLnkRequestName,
    pstoRequestOptions,
    pstoRequestManagerOptions,
    managedPstoRequestRows,
    pstoResultRequestOptions,
    lnkRequestOptions,
    lnkRequestManagerOptions,
    lnkResultRequestOptions,
    managedLnkRequestRows,
    managedLnkRequestMethods,
    nextLnkConclusionName,
    nextPstoDiagramName,
    selectedPstoResultRequestRows,
    pstoResultSelectedRows,
    selectedLnkResultRequestRows,
    lnkResultSelectedRows,
  } = useReportRequestDerivedState({
    rows,
    heatTreatmentRows,
    lnkRows,
    availablePstoRequestRows,
    availableLnkRequestRows,
    selectedHeatTreatmentIds,
    selectedLnkIds,
    lnkRequestDraft,
    pstoResultDraft,
    lnkResultDraft,
    managedPstoRequestName,
    managedLnkRequestName,
  })
  const {
    lnkRequestMutation,
    lnkRequestCorrectionMutation,
    lnkRequestManagerMutation,
    lnkResultMutation,
    lnkOfficialityMutation,
    lnkResultCorrectionMutation,
    lnkResultReplacementMutation,
    lnkConclusionCorrectionMutation,
    lnkFieldMutation,
    clearLnkGeneratedDataMutation,
  } = useLnkReportMutations({
    lnkRows,
    lnkRequestOptions,
    setMessage,
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
    setManagedLnkResultPreview,
    setHeatTreatmentFieldEditing,
  })
  const {
    deleteMutation,
    importMutation,
    obsoleteRepeatedJointMutation,
    renameRepeatedJointMutation,
    repeatedJointMutation,
    saveMutation,
  } = useWeldJournalMutations({
    rows,
    welderStamps,
    weldFormStampSelectOptions,
    editingFocusField: editing?.focusField,
    setEditing,
    setMessage,
    highlightChangedRows,
    dismissRepeatedJointTask,
  })

  const { heatTreatmentImportMutation, lnkImportMutation } = useReportImportMutations({
    rows,
    heatTreatmentRows,
    lnkRows,
    pstoRequestOptions,
    lnkRequestOptions,
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
    setIsPstoRequestModalOpen,
    setIsPstoResultModalOpen,
    setPstoResultDraft,
    setManagedPstoRequestName,
    setManagedPstoRequestNameDraft,
    setIsPstoRequestManagerOpen,
    setHeatTreatmentFieldEditing,
  })
  const {
    pstoResultAvailableRequestOptions,
    filteredPstoResultRequestOptions,
    filteredPstoResultRows,
    selectedPstoResultRows,
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
    isPstoResultSaving: pstoResultMutation.isPending,
  })
  const {
    lnkResultAvailableRequestOptions,
    filteredLnkResultRequestOptions,
    selectedLnkResultMethods,
    filteredLnkResultRows,
    lnkResultContextReady,
    visibleLnkResultRows,
    selectableVisibleLnkResultRows,
    canBulkToggleLnkResultRows,
    selectedLnkResultRows,
    lnkResultSaveBlockReason,
    isLnkResultSaveDisabled,
  } = useLnkResultDerivedState({
    lnkRows,
    lnkResultSelectedRows,
    lnkResultRequestOptions,
    lnkResultRequestSearch,
    selectedLnkResultRequestRows,
    lnkResultDraft,
    nextLnkConclusionName,
    shouldPinPreviewedLnkResultRows,
    isLnkResultSaving: lnkResultMutation.isPending,
  })
  const {
    filteredManagedLnkResultRequestOptions,
    managedLnkResultRows,
    managedLnkResultMethods,
    managedLnkResultEntries,
    managedLnkPendingResultRows,
  } = useManagedLnkResultDerivedState({
    lnkRows,
    lnkResultRequestOptions,
    managedLnkResultRequestSearch,
    managedLnkResultRequestName,
    managedLnkResultOrderIds,
    managedLnkResultMethodKey,
    managedLnkPendingResultChanges,
  })
  const {
    filteredLnkOfficialityRows,
    selectedLnkOfficialityRows,
    lnkOfficialitySaveBlockReason,
    isLnkOfficialitySaveDisabled,
  } = useLnkOfficialityDerivedState({
    lnkRows,
    lnkOfficialityDraft,
    isLnkOfficialitySaving: lnkOfficialityMutation.isPending,
  })
  const {
    acceptedWdiTotal,
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
    rows,
    setColumnFilters,
    setHeatTreatmentFilters,
    setLnkFilters,
  })
  const {
    exportXlsx,
    openLnkConclusionsReport,
    openLnkToRequestReport,
    openLnkWaitingNkReport,
    openPstoResultsReport,
    openPstoWaitingRequestReport,
  } = useReportOutputActions({
    activeReport,
    activeTitle,
    heatTreatmentRows,
    lnkRows,
    setIsLnkShowMenuOpen,
    setIsPstoShowMenuOpen,
    setMessage,
    visibleRows,
  })
  useReportModalSyncEffects({
    availableLnkRequestRows,
    availablePstoRequestRows,
    heatTreatmentRows,
    isLnkResultManagerOpen,
    isLnkResultModalOpen,
    isPstoResultManagerOpen,
    isPstoResultModalOpen,
    lnkRequestOptions,
    lnkResultRequestOptions,
    lnkRows,
    managedLnkResultEntries,
    managedLnkResultMethodKey,
    managedLnkResultMethods,
    managedLnkResultRequestName,
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
    handleCreatePstoRequest,
    openAddPstoResultModal,
    openAddPstoResultModalForRow,
    openCreatePstoRequestModal,
    openCreatePstoRequestModalForRow,
    openPstoRequestManager,
    openPstoResultManager,
    renameManagedPstoDiagram,
    renameManagedPstoRequest,
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
    managedPstoDiagramDrafts,
    managedPstoRequestName,
    managedPstoRequestNameDraft,
    nextPstoDiagramName,
    nextPstoRequestName,
    pstoRequestManagerOptions,
    pstoRequestNaming,
    pstoResultDraft,
    pstoResultSaveBlockReason,
    selectedHeatTreatmentRows,
    selectedPstoResultRows,
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
    setManagedPstoRequestNameDraft,
    setMessage,
    setPstoRequestNaming,
    setPstoRequestSearch,
    setPstoResultDraft,
    setPstoResultRequestSearch,
    setSelectedHeatTreatmentIds,
  })

  async function handleImport(file: File) {
    setMessage(null)
    if (activeReport === 'heatTreatment' || activeReport === 'lnk') {
      const options = getReportImportFieldKeys(activeReport)
      if (!options) return
      const result = file.name.toLowerCase().endsWith('.csv')
        ? parseEditableCsv(await file.text(), options)
        : parseEditableWorkbook(await file.arrayBuffer(), options)
      const importResult =
        activeReport === 'heatTreatment'
          ? await heatTreatmentImportMutation.mutateAsync(result.records)
          : await lnkImportMutation.mutateAsync(result.records)
      setMessage(
        `Обновлено ${getEditableReportImportLabel(activeReport)}: ${importResult.updated}; пропущено: ${importResult.skipped + result.skippedRows}`,
      )
      return
    }

    const result = file.name.toLowerCase().endsWith('.csv') ? parseCsv(await file.text()) : parseWorkbook(await file.arrayBuffer())
    const importResult = await importMutation.mutateAsync(result.records.map(withOfficialJointStatus))
    setMessage(`Добавлено ${importResult.inserted}, пропущено служебных строк: ${result.skippedRows}`)
  }

  function handleCreateLnkRequest() {
    const methodKeys = selectedLnkMethodKeys
    if (selectedLnkRows.length === 0) {
      setMessage('Выберите один или несколько стыков для заявки ЛНК')
      return
    }
    if (methodKeys.length === 0) {
      setMessage('Выберите один или несколько видов контроля для заявки ЛНК')
      return
    }
    if (selectedLnkRequestTargetCount === 0) {
      setMessage('Нет доступных комбинаций стыков и видов контроля для заявки ЛНК')
      return
    }

    const requestName = getRequestNameFromNaming(lnkRequestNaming, nextLnkRequestName)
    if (!requestName) {
      setMessage('Укажите пользовательское наименование заявки ЛНК')
      return
    }

    lnkRequestMutation.mutate({ records: selectedLnkRows, methodKeys, requestName })
  }

  function openCreateLnkRequestModal() {
    setPreservedLnkOrderIds(null)
    setSelectedLnkIds(new Set())
    setLnkRequestDraft({ methods: new Set() })
    setLnkRequestNaming(defaultRequestNamingState)
    setLnkRequestSearch('')
    setIsLnkRequestModalOpen(true)
  }

  function openCreateLnkRequestModalForRow(row: WeldInput & { id: number }) {
    const availableMethods = getAvailableLnkRequestMethods(row)
    if (availableMethods.length === 0) {
      setMessage('Все заявки ЛНК для этого стыка уже созданы')
      return
    }

    setPreservedLnkOrderIds(lnkRows.map((lnkRow) => lnkRow.id))
    setSelectedLnkIds(new Set([row.id]))
    setLnkRequestDraft({ methods: new Set(availableMethods.map((method) => method.requestKey)) })
    setLnkRequestNaming(defaultRequestNamingState)
    setLnkRequestSearch(String(row.joint ?? row.line ?? ''))
    setIsLnkRequestModalOpen(true)
  }

  function closeCreateLnkRequestModal() {
    if (lnkRequestMutation.isPending) return
    setIsLnkRequestModalOpen(false)
  }

  function openAddLnkResultModal() {
    setPreservedLnkOrderIds(null)
    setLnkResultRequestSearch('')
    setLnkResultDraft(createDefaultLnkResultDraft())
    setShouldPinPreviewedLnkResultRows(false)
    setIsLnkResultModalOpen(true)
  }

  function openAddLnkResultModalForRow(row: WeldInput & { id: number }) {
    const requestNames = getLnkRowRequestNames(row)
    if (requestNames.length === 0) {
      setMessage('Сначала создайте заявку ЛНК для этого стыка')
      return
    }

    const requestName = requestNames.length === 1 ? requestNames[0] : ''
    setPreservedLnkOrderIds(lnkRows.map((lnkRow) => lnkRow.id))
    setLnkResultRequestSearch(requestName)
    setLnkResultDraft({
      ...createDefaultLnkResultDraft(),
      requestName,
      rowIds: new Set([row.id]),
      search: String(row.joint ?? row.line ?? ''),
    })
    setShouldPinPreviewedLnkResultRows(false)
    setIsLnkResultModalOpen(true)
  }

  function closeAddLnkResultModal() {
    if (lnkResultMutation.isPending) return
    setLnkResultRequestSearch('')
    setIsLnkResultPreviewOpen(false)
    setShouldPinPreviewedLnkResultRows(false)
    setIsLnkResultModalOpen(false)
  }

  function openLnkOfficialityModal() {
    setLnkOfficialityDraft(createDefaultLnkOfficialityDraft())
    setIsLnkOfficialityModalOpen(true)
  }

  function closeLnkOfficialityModal() {
    if (lnkOfficialityMutation.isPending) return
    setIsLnkOfficialityModalOpen(false)
  }

  useReportModalEscapeKey({
    isReportModalOpen,
    isLnkResultPreviewOpen,
    isPstoRequestManagerOpen,
    isPstoResultManagerOpen,
    isLnkRequestManagerOpen,
    isLnkResultManagerOpen,
    isPstoResultModalOpen,
    isPstoRequestModalOpen,
    isLnkOfficialityModalOpen,
    isLnkResultModalOpen,
    isLnkRequestModalOpen,
    canClosePstoRequestManager: !pstoRequestManagerMutation.isPending && !pstoRequestCorrectionMutation.isPending,
    canClosePstoResultManager: !pstoResultCorrectionMutation.isPending,
    canCloseLnkRequestManager: !lnkRequestManagerMutation.isPending && !lnkRequestCorrectionMutation.isPending,
    canCloseLnkResultManager:
      !lnkResultCorrectionMutation.isPending &&
      !lnkResultReplacementMutation.isPending &&
      !lnkConclusionCorrectionMutation.isPending,
    onCloseLnkResultPreview: () => setIsLnkResultPreviewOpen(false),
    onClosePstoRequestManager: () => setIsPstoRequestManagerOpen(false),
    onClosePstoResultManager: () => setIsPstoResultManagerOpen(false),
    onCloseLnkRequestManager: () => setIsLnkRequestManagerOpen(false),
    onCloseLnkResultManager: () => setIsLnkResultManagerOpen(false),
    onClosePstoResultModal: closeAddPstoResultModal,
    onClosePstoRequestModal: closeCreatePstoRequestModal,
    onCloseLnkOfficialityModal: closeLnkOfficialityModal,
    onCloseLnkResultModal: closeAddLnkResultModal,
    onCloseLnkRequestModal: closeCreateLnkRequestModal,
  })

  function toggleLnkOfficialityRow(rowId: number) {
    setLnkOfficialityDraft((current) => {
      return { ...current, rowIds: toggleNumberSetValue(current.rowIds, rowId) }
    })
  }

  function setVisibleLnkOfficialityRowsSelected(selected: boolean) {
    setLnkOfficialityDraft((current) => {
      return { ...current, rowIds: setNumberSetValues(current.rowIds, filteredLnkOfficialityRows.map((row) => row.id), selected) }
    })
  }

  function saveLnkOfficiality() {
    if (isLnkOfficialitySaveDisabled) return
    lnkOfficialityMutation.mutate({
      records: selectedLnkOfficialityRows,
      status: lnkOfficialityDraft.status as 'official' | 'unofficial',
    })
  }

  function openLnkResultManager() {
    const selectedRows = lnkRows.filter((row) => lnkResultDraft.rowIds.has(row.id))
    if (selectedRows.length === 0) {
      setMessage('Выберите один или несколько стыков для редактирования результатов')
      return
    }
    setManagedLnkResultRequestName('')
    setManagedLnkResultMethodKey('')
    setManagedLnkResultRequestSearch('')
    setManagedLnkResultOrderIds(selectedRows.map((row) => row.id))
    setManagedLnkPendingResultChanges({})
    setManagedLnkResultChangeHint(null)
    setManagedLnkResultPreview(null)
    setIsLnkResultManagerOpen(true)
  }

  function changeManagedLnkResultRequest(requestName: string) {
    const rowsForRequest = filterLnkRowsByRequestName(lnkRows, requestName)
    setManagedLnkResultRequestName(requestName)
    setManagedLnkResultMethodKey('')
    setManagedLnkResultOrderIds(rowsForRequest.map((row) => row.id))
    setManagedLnkPendingResultChanges({})
    setManagedLnkResultChangeHint(null)
    setManagedLnkResultPreview(null)
  }

  function renameManagedLnkConclusionForRow(row: WeldInput & { id: number }, methodKey: WeldFieldKey) {
    lnkConclusionCorrectionMutation.mutate({
      records: [row],
      methodKey,
      conclusionName: managedLnkConclusionDrafts[getManagedLnkResultChangeKey(row.id, methodKey)] ?? '',
    })
  }

  function changeLnkResultRequest(requestName: string) {
    setLnkResultDraft((current) => {
      const rowIds = new Set(current.rowIds)
      const selectedRows = lnkRows.filter((row) => rowIds.has(row.id))
      const requestRows = requestName ? filterLnkRowsByRequestName(lnkRows, requestName) : []
      const methodRows = selectedRows.length > 0 ? [...selectedRows, ...requestRows] : requestName ? requestRows : lnkRows
      const methods = getLnkInputMethodsForRows(methodRows, '')
      const methodKey = current.methodKey && methods.some((method) => method.requestKey === current.methodKey) ? current.methodKey : ''
      return { ...current, requestName, methodKey, rowIds, rowResults: filterLnkResultDraftRowResults(current.rowResults, rowIds) }
    })
  }

  function changeLnkResultMethod(methodKey: WeldFieldKey | '') {
    setLnkResultDraft((current) => {
      if (!methodKey) return { ...current, methodKey: '' }
      const rowIds = new Set(
        [...current.rowIds].filter((id) => {
          const row = lnkRows.find((candidate) => candidate.id === id)
          return row ? canSelectLnkResultRow(row, '', methodKey) : false
        }),
      )
      return { ...current, methodKey, rowIds, rowResults: filterLnkResultDraftRowResults(current.rowResults, rowIds) }
    })
  }

  function toggleLnkResultRow(rowId: number) {
    const row = filteredLnkResultRows.find((candidate) => candidate.id === rowId)
    if (!row || !canSelectLnkResultRow(row, lnkResultDraft.requestName, lnkResultDraft.methodKey)) return

    setLnkResultDraft((current) => {
      const rowIds = new Set(current.rowIds)
      if (rowIds.has(rowId)) {
        rowIds.delete(rowId)
      } else {
        rowIds.add(rowId)
      }
      const selectedRows = lnkRows.filter((candidate) => rowIds.has(candidate.id))
      const requestName = current.requestName && selectedRows.some((candidate) => rowBelongsToLnkRequest(candidate, current.requestName))
        ? current.requestName
        : ''
      const methodRows = requestName ? filterLnkRowsByRequestName(lnkRows, requestName) : selectedRows.length > 0 ? selectedRows : lnkRows
      const methods = getLnkInputMethodsForRows(methodRows, requestName)
      const methodKey = current.methodKey && methods.some((method) => method.requestKey === current.methodKey) ? current.methodKey : ''
      return { ...current, requestName, methodKey, rowIds, rowResults: filterLnkResultDraftRowResults(current.rowResults, rowIds) }
    })
  }

  function toggleAllLnkResultRows() {
    setLnkResultDraft((current) => {
      const filteredIds = new Set(
        filteredLnkResultRows
          .filter((row) => canSelectLnkResultRow(row, current.requestName, current.methodKey))
          .map((row) => row.id),
      )
      if (filteredIds.size === 0) return current
      const allSelected = [...filteredIds].every((id) => current.rowIds.has(id))
      const rowIds = allSelected
        ? new Set([...current.rowIds].filter((id) => !filteredIds.has(id)))
        : new Set([...current.rowIds, ...filteredIds])
      const selectedRows = lnkRows.filter((row) => rowIds.has(row.id))
      const requestName = current.requestName && selectedRows.some((row) => rowBelongsToLnkRequest(row, current.requestName))
        ? current.requestName
        : ''
      const methodRows = requestName ? filterLnkRowsByRequestName(lnkRows, requestName) : selectedRows.length > 0 ? selectedRows : lnkRows
      const methods = getLnkInputMethodsForRows(methodRows, requestName)
      const methodKey = current.methodKey && methods.some((method) => method.requestKey === current.methodKey) ? current.methodKey : ''
      return { ...current, requestName, methodKey, rowIds, rowResults: filterLnkResultDraftRowResults(current.rowResults, rowIds) }
    })
  }

  function setLnkResultForRow(rowId: number, result: string) {
    setLnkResultDraft((current) => {
      if (!current.rowIds.has(rowId)) return current
      const row = lnkRows.find((candidate) => candidate.id === rowId)
      if (row && result === 'ремонт' && isLnkRepairForbidden(row)) return current
      const baseline = current.result && current.result !== LNK_CUSTOM_RESULT_VALUE ? current.result : ''
      const rowResults: Record<number, string> = {}
      for (const id of current.rowIds) {
        rowResults[id] = current.rowResults[id] || baseline
      }
      rowResults[rowId] = result
      return { ...current, result: LNK_CUSTOM_RESULT_VALUE, rowResults }
    })
  }

  function handleAddLnkResult() {
    if (lnkResultSaveBlockReason) {
      setMessage(lnkResultSaveBlockReason)
      return
    }
    if (!lnkResultDraft.methodKey) {
      setMessage('Выберите метод контроля')
      return
    }
    if (selectedLnkResultRows.length === 0) {
      setMessage('Выберите один или несколько стыков')
      return
    }
    const resultById = buildLnkResultDraftById(selectedLnkResultRows, lnkResultDraft)
    const resultValues = Object.values(resultById)
    if (resultValues.some((result) => !isValidLnkResultDraftValue(result))) {
      setMessage('Укажите результат для каждого выбранного стыка')
      return
    }
    const hasNonEmptyResult = resultValues.some((result) => result !== LNK_EMPTY_RESULT_VALUE)
    if (hasNonEmptyResult && !lnkResultDraft.controlDate) {
      setMessage('Укажите дату контроля')
      return
    }
    const conclusionName =
      !hasNonEmptyResult
        ? ''
        : getRequestNameFromNaming(lnkResultDraft.conclusionNaming, nextLnkConclusionName)
    if (hasNonEmptyResult && !conclusionName) {
      setMessage('Укажите наименование заключения')
      return
    }

    lnkResultMutation.mutate({
      records: selectedLnkResultRows,
      methodKey: lnkResultDraft.methodKey,
      controlDate: lnkResultDraft.controlDate,
      resultById,
      conclusionName,
    })
  }

  function replaceLnkResult(row: WeldInput & { id: number }, methodKey: WeldFieldKey, result: string) {
    const method = getLnkMethodByRequestKey(methodKey)
    const currentResult = method ? String(row[method.resultKey] ?? '').trim() : ''
    const changeKey = getManagedLnkResultChangeKey(row.id, methodKey)
    setManagedLnkResultPreview(null)
    if (currentResult && currentResult !== result) {
      setManagedLnkResultChangeHint({ changeKey, rowId: row.id, methodKey, from: currentResult, to: result })
      setManagedLnkPendingResultChanges((current) => ({ ...current, [changeKey]: result }))
    } else {
      setManagedLnkResultChangeHint(null)
      setManagedLnkPendingResultChanges((current) => {
        const next = { ...current }
        delete next[changeKey]
        return next
      })
    }
  }

  function saveManagedLnkResultChanges() {
    if (managedLnkPendingResultRows.length === 0) {
      setMessage('Нет изменений результата для сохранения')
      return
    }
    const updates = managedLnkPendingResultRows.map(({ row, method, changeKey }) => ({
      record: row,
      methodKey: method.requestKey,
      result: managedLnkPendingResultChanges[changeKey],
    }))
    lnkResultReplacementMutation.mutate({
      updates,
    })
  }

  function clearLnkResult(row: WeldInput & { id: number }, methodKey: WeldFieldKey) {
    const method = getLnkMethodByRequestKey(methodKey)
    if (!method) return
    setManagedLnkPendingResultChanges((current) => {
      const next = { ...current }
      delete next[row.id]
      return next
    })
    const confirmed = window.confirm(
      `Удалить результат ${method.code} по стыку ${String(row.joint ?? '-')}? Заключение и дата контроля по этому методу тоже будут очищены.`,
    )
    if (!confirmed) return
    setManagedLnkResultChangeHint(null)
    lnkResultCorrectionMutation.mutate({ record: row, methodKey, result: null })
  }

  function handleClearLnkGeneratedData() {
    const confirmed = window.confirm(
      'Очистить результаты, даты и заключения ЛНК? Заявки ЛНК, сами стыки и отметки наличия контроля останутся.',
    )
    if (!confirmed) return
    clearLnkGeneratedDataMutation.mutate(lnkRows)
  }

  function createRepeatedJoint(task: RepeatedJointCreateTask | RepeatedJointCoilTask) {
    if (activeReport === 'lnk') {
      setMessage('В отчете ЛНК диспетчер только показывает цепочку. Создание стыков доступно из сварочного журнала.')
      return
    }
    const currentTask = buildRepeatedJointTasks(rows, welderStamps).find(
      (candidate): candidate is RepeatedJointCreateTask | RepeatedJointCoilTask =>
        (candidate.kind === 'create' || candidate.kind === 'coil') && candidate.key === task.key,
    )
    if (!currentTask) {
      setMessage('Задача уже не актуальна. Плашка обновлена по текущим данным.')
      return
    }
    repeatedJointMutation.mutate(currentTask)
  }

  function deleteObsoleteRepeatedJoint(task: RepeatedJointDeleteTask) {
    if (activeReport === 'lnk') {
      setMessage('В отчете ЛНК диспетчер только показывает цепочку. Удаление стыков доступно из сварочного журнала.')
      return
    }
    const currentTask = buildRepeatedJointTasks(rows, welderStamps).find(
      (candidate): candidate is RepeatedJointDeleteTask => candidate.kind === 'delete' && candidate.key === task.key,
    )
    if (!currentTask) {
      setMessage('Задача уже не актуальна. Плашка обновлена по текущим данным.')
      return
    }
    if (!isUnusedRepeatedJointDraft(currentTask.row)) {
      setMessage('Повторный стык уже содержит данные. Диспетчер не удаляет такие стыки автоматически, проверьте цепочку вручную.')
      return
    }
    const confirmed = window.confirm(`Удалить повторный стык ${task.targetJoint}? Исходный стык ${task.sourceJoint} больше не требует повтора.`)
    if (!confirmed) return
    obsoleteRepeatedJointMutation.mutate(currentTask)
  }

  function renameObsoleteRepeatedJoint(task: RepeatedJointRenameTask) {
    if (activeReport === 'lnk') {
      setMessage('В отчете ЛНК диспетчер только показывает цепочку. Переименование стыков доступно из сварочного журнала.')
      return
    }
    const currentTask = buildRepeatedJointTasks(rows, welderStamps).find(
      (candidate): candidate is RepeatedJointRenameTask => candidate.kind === 'rename' && candidate.key === task.key,
    )
    if (!currentTask) {
      setMessage('Задача уже не актуальна. Плашка обновлена по текущим данным.')
      return
    }
    const confirmed = window.confirm(`Переименовать повторный стык ${task.currentJoint} в ${task.targetJoint}?`)
    if (!confirmed) return
    renameRepeatedJointMutation.mutate(currentTask)
  }

  function showRepeatedJointTask(task: RepeatedJointTask) {
    const baseJoint = getRepeatedJointTaskBaseJoint(task)
    const actionText = getRepeatedJointTaskActionText(task)
    showRepeatedJointTaskChain(task.row, baseJoint, `Показана цепочка стыка ${baseJoint}: ${actionText}`)
  }

  function showRepeatedJointTaskChain(row: WeldRow, baseJoint: string, messageText: string) {
    const filters = buildJointChainFilters(row, baseJoint)
    if (activeReport === 'lnk') {
      setActiveReport('lnk')
      setLnkFilters(filters)
    } else {
      setActiveReport('weldingJournal')
      setColumnFilters(filters)
    }
    setChainRecord(row)
    setMessage(messageText)
  }

  function openChainRowInCurrentReport(row: WeldRow) {
    setChainRecord(null)
    const filters = buildExactJointFilters(row)
    if (activeReport === 'lnk') {
      setActiveReport('lnk')
      setLnkFilters(filters)
    } else {
      setActiveReport('weldingJournal')
      setColumnFilters(filters)
    }
    setMessage(`Открыт стык ${String(row.joint ?? '-')} в текущем отчете`)
  }

  function openLinkedReportRow(row: WeldInput & { id: number }) {
    setChainRecord(null)
    const filters = buildExactJointFilters(row)
    if (activeReport === 'lnk') {
      setActiveReport('weldingJournal')
      setColumnFilters(filters)
      setMessage(`Открыт стык ${String(row.joint ?? '-')} в сварочном журнале`)
      return
    }
    if (activeReport === 'weldingJournal') {
      setActiveReport('lnk')
      setLnkFilters(filters)
      setMessage(`Открыт стык ${String(row.joint ?? '-')} в отчете ЛНК`)
    }
  }

  function openChainBaseInCurrentReport(row: WeldRow) {
    const baseJoint = getJointBaseFromRow(row)
    showRepeatedJointTaskChain(row, baseJoint, `Показана вся цепочка стыка ${baseJoint}`)
  }

  function toggleLnkRequestMethod(requestKey: WeldFieldKey) {
    setLnkRequestDraft((current) => {
      const methods = new Set(current.methods)
      if (methods.has(requestKey)) {
        methods.delete(requestKey)
      } else {
        methods.add(requestKey)
      }
      return { methods }
    })
  }

  function clearLnkRequestFromRow(row: WeldInput & { id: number }, methodKey: WeldFieldKey) {
    lnkRequestCorrectionMutation.mutate({ record: row, methodKey, requestName: null })
  }

  function openLnkRequestManager() {
    const requestName = managedLnkRequestName || lnkRequestManagerOptions[0] || ''
    setManagedLnkRequestName(requestName)
    setManagedLnkRequestNameDraft(requestName)
    setIsLnkRequestManagerOpen(true)
  }

  function changeManagedLnkRequest(requestName: string) {
    setManagedLnkRequestName(requestName)
    setManagedLnkRequestNameDraft(requestName)
  }

  function renameManagedLnkRequest() {
    lnkRequestManagerMutation.mutate({
      action: 'rename',
      requestName: managedLnkRequestName,
      nextRequestName: managedLnkRequestNameDraft,
    })
  }

  function deleteManagedLnkRequest() {
    const requestName = managedLnkRequestName.trim()
    if (!requestName) return
    const confirmed = window.confirm(
      `Удалить заявку ${requestName}? Будут очищены связанные заявки, результаты, даты и заключения ЛНК для этой заявки.`,
    )
    if (!confirmed) return
    lnkRequestManagerMutation.mutate({ action: 'delete', requestName })
  }

  function clearManagedLnkRequestPosition(row: WeldInput & { id: number }, methodKey: WeldFieldKey) {
    const method = getLnkMethodByRequestKey(methodKey)
    if (!method) return
    const requestName = String(row[method.requestKey] ?? '').trim()
    const confirmed = window.confirm(
      `Очистить ${method.code} по стыку ${String(row.joint ?? '-')} из заявки ${requestName}? Будут очищены заявка, результат, дата и заключение только для этой позиции.`,
    )
    if (!confirmed) return
    clearLnkRequestFromRow(row, methodKey)
  }

  function toggleLnkRequestRow(rowId: number) {
    setSelectedLnkIds((current) => toggleNumberSetValue(current, rowId))
  }

  function toggleAllLnkRequestRows() {
    setSelectedLnkIds((current) => toggleNumberSetValues(current, filteredAvailableLnkRequestRows.map((row) => row.id)))
  }

  function handleEditRecord(record: WeldInput & { id: number }, focusField?: WeldFieldKey) {
    if (activeReport === 'heatTreatment') {
      if (focusField && heatTreatmentEditableFieldKeys.has(focusField)) {
        const field = FIELD_BY_KEY.get(focusField)
        setHeatTreatmentFieldEditing({
          record,
          fieldKey: focusField,
          label: field?.label ?? 'Поле ПСТО',
          kind: field?.kind === 'date' ? 'date' : 'text',
          value: String(record[focusField] ?? ''),
        })
      }
      return
    }

    if (activeReport === 'lnk') {
      if (focusField && lnkEditableFieldKeys.has(focusField)) {
        if (isLnkRequestField(focusField) && !isLnkRequestAllowedForRow(record, focusField)) {
          setMessage('Сначала укажите наличие этого вида контроля в сварочном журнале')
          return
        }
        const field = FIELD_BY_KEY.get(focusField)
        setHeatTreatmentFieldEditing({
          record,
          fieldKey: focusField,
          label: field?.label ?? 'Поле ЛНК',
          kind: field?.kind === 'date' ? 'date' : 'text',
          value: String(record[focusField] ?? ''),
          report: 'lnk',
          mode: isLnkResultField(focusField) ? 'result' : isLnkRequestField(focusField) ? 'request' : 'text',
        })
      }
      return
    }

    if (focusField && requestAndResultFieldKeys.has(focusField)) {
      setMessage('Поля заявок и результатов редактируются только в отчетах Термообработка и ЛНК')
      return
    }

    setEditing({ record, focusField })
  }

  function saveEditedHeatTreatmentField() {
    if (!heatTreatmentFieldEditing) return
    if (heatTreatmentFieldEditing.report === 'lnk') {
      const value = heatTreatmentFieldEditing.value.trim()
      if (heatTreatmentFieldEditing.mode === 'request' && value && !lnkRequestOptions.includes(value)) {
        setMessage('Можно выбрать только существующую заявку ЛНК или очистить поле')
        return
      }
      lnkFieldMutation.mutate({
        record: heatTreatmentFieldEditing.record,
        fieldKey: heatTreatmentFieldEditing.fieldKey,
        value: value || null,
      })
      return
    }
    heatTreatmentFieldMutation.mutate({
      record: heatTreatmentFieldEditing.record,
      fieldKey: heatTreatmentFieldEditing.fieldKey,
      value: heatTreatmentFieldEditing.value.trim() || null,
      rows,
    })
  }

  const dispatcherTaskCardProps = {
    isTaskExpanded: isRepeatedJointTaskExpanded,
    onToggleDetails: toggleRepeatedJointTaskDetails,
    onShowTask: showRepeatedJointTask,
    onCreateTask: createRepeatedJoint,
    onDeleteTask: deleteObsoleteRepeatedJoint,
    onRenameTask: renameObsoleteRepeatedJoint,
    canRunDispatcherMutation: activeReport !== 'lnk',
    isCreatePending: repeatedJointMutation.isPending,
    isDeletePending: obsoleteRepeatedJointMutation.isPending,
    isRenamePending: renameRepeatedJointMutation.isPending,
  }

  function changeActiveReport(report: ActiveReport) {
    setActiveReport(report)
    if (report === 'heatTreatment' || report === 'lnk' || report === 'welderStamps') {
      setEditing(null)
    }
  }

  return (
    <ReportWorkspace
      activeReport={activeReport}
      navCollapsed={navCollapsed}
      registerMinWidth={registerMinWidth}
      onNavCollapsedChange={setNavCollapsed}
      onReportChange={changeActiveReport}
    >
          <ReportPageHeader title={activeTitle} stickyLeft={stickyLeft} minWidth={registerMinWidth}>
            <ReportHeaderActions
              activeReport={activeReport}
              fileInputRef={fileInputRef}
              onImportFile={(file) => void handleImport(file)}
              onExportXlsx={exportXlsx}
              onCreateWeldJoint={() => setEditing({ record: {} })}
              importDisabled={importMutation.isPending || heatTreatmentImportMutation.isPending || lnkImportMutation.isPending}
              onCreatePstoRequest={openCreatePstoRequestModal}
              pstoRequestPending={pstoRequestMutation.isPending}
              onAddPstoResult={openAddPstoResultModal}
              pstoResultDisabled={pstoResultMutation.isPending || pstoResultRequestOptions.length === 0}
              isPstoShowMenuOpen={isPstoShowMenuOpen}
              onTogglePstoShowMenu={() => setIsPstoShowMenuOpen((current) => !current)}
              onOpenPstoWaitingRequestReport={openPstoWaitingRequestReport}
              onOpenPstoResultsReport={openPstoResultsReport}
              onCreateLnkRequest={openCreateLnkRequestModal}
              lnkRequestPending={lnkRequestMutation.isPending}
              onAddLnkResult={openAddLnkResultModal}
              lnkResultDisabled={lnkResultMutation.isPending || lnkResultRequestOptions.length === 0}
              onOpenLnkOfficiality={openLnkOfficialityModal}
              lnkOfficialityPending={lnkOfficialityMutation.isPending}
              isLnkShowMenuOpen={isLnkShowMenuOpen}
              onToggleLnkShowMenu={() => setIsLnkShowMenuOpen((current) => !current)}
              onOpenLnkToRequestReport={openLnkToRequestReport}
              onOpenLnkWaitingNkReport={openLnkWaitingNkReport}
              onOpenLnkConclusionsReport={openLnkConclusionsReport}
            />
          </ReportPageHeader>

          <ReportSummaryBar
            activeReport={activeReport}
            left={stickyLeft}
            minWidth={registerMinWidth}
            isLoading={weldsQuery.isLoading}
            weldingRowCount={rows.length}
            acceptedWdiTotalText={formatWdiTotal(acceptedWdiTotal)}
            heatTreatmentRowCount={heatTreatmentRows.length}
            selectedHeatTreatmentRowCount={selectedHeatTreatmentRows.length}
            lnkRowCount={lnkRows.length}
            availableLnkRequestRowCount={availableLnkRequestRows.length}
            activeWelderStampCount={welderStamps.filter((record) => !record.archived).length}
            archivedWelderStampCount={welderStamps.filter((record) => record.archived).length}
            filteredWelderStampCount={filteredWelderStamps.length}
            errorMessage={weldsQuery.error ? (weldsQuery.error as Error).message : null}
            message={message}
          />

          <ReportTaskPanels
            activeReport={activeReport}
            repeatedJointTasks={repeatedJointTasks}
            repeatedJointTaskGroups={repeatedJointTaskGroups}
            welderStampExpiryTasks={welderStampExpiryTasks}
            welderStampNotificationGroups={welderStampNotificationGroups}
            stickyLeft={stickyLeft}
            handlers={dispatcherTaskCardProps}
            isTaskExpanded={isRepeatedJointTaskExpanded}
            onToggleDetails={toggleRepeatedJointTaskDetails}
            onDismissTasks={dismissRepeatedJointTasks}
          />

          <ReportMainContent
            activeReport={activeReport}
            welderStampsRegistryProps={{
              records: activeWelderStamps,
              archivedRecords: archivedWelderStamps,
              draft: welderStampDraft,
              search: welderStampSearch,
              filters: welderStampFilters,
              editingId: editingWelderStampId,
              showArchived: showArchivedWelderStamps,
              onSearchChange: setWelderStampSearch,
              onFiltersChange: setWelderStampFilters,
              onDraftChange: updateWelderStampDraft,
              onSave: saveWelderStampRecord,
              onReset: resetWelderStampForm,
              onEdit: editWelderStampRecord,
              onArchive: archiveWelderStampRecord,
              onRestore: restoreWelderStampRecord,
              onToggleArchived: setShowArchivedWelderStamps,
              onDelete: deleteWelderStampRecord,
            }}
            weldTableProps={{
              rows: visibleRows as Array<WeldInput & { id: number }>,
              columnFilters: activeColumnFilters,
              onColumnFiltersChange: activeFiltersSetter,
              onEdit: handleEditRecord,
              onDelete: (id) => {
                if (confirm('Удалить запись стыка?')) deleteMutation.mutate(id)
              },
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
              getDisplayValue: activeReport === 'lnk' ? getLnkDisplayValue : undefined,
              onOpenChain: (row) => setChainRecord(row),
              onOpenLinkedReport: canOpenLinkedReport(activeReport) ? openLinkedReportRow : undefined,
              openLinkedReportTitle: getOpenLinkedReportTitle(activeReport),
              rowActions: getReportRowActions(activeReport, {
                openCreatePstoRequestModalForRow,
                openAddPstoResultModalForRow,
                canCreatePstoRequest,
                canAddPstoResult: (row) => hasText(row.pstoRequest),
                openCreateLnkRequestModalForRow,
                openAddLnkResultModalForRow,
                canCreateLnkRequest,
                canAddLnkResult: (row) => getLnkRowRequestNames(row).length > 0,
              }),
              storageKey: activeReport,
              hiddenFieldKeys: getReportHiddenFieldKeys(activeReport),
              mergePstoSections: shouldMergePstoSections(activeReport),
            }}
          />

      <ReportDialogs
        chainDialogProps={{
          dialogProps: chainRecord
            ? {
                record: chainRecord,
                rows: chainRows,
                onClose: () => setChainRecord(null),
                onOpenBase: openChainBaseInCurrentReport,
                onOpenRow: openChainRowInCurrentReport,
              }
            : null,
        }}
        weldEditorProps={{
          formKey: editing ? `${editing.record.id ?? 'new'}:${editing.focusField ?? 'form'}` : null,
          formProps: editing
            ? {
                value: editing.record,
                focusField: editing.focusField,
                stampSelectOptions: getWeldFormStampSelectOptions,
                getExternalSaveBlockReason: (draft) => getOfficialStampCompatibilitySaveBlockReason(draft, welderStamps),
                busy: saveMutation.isPending,
                onCancel: () => setEditing(null),
                onSave: (value) =>
                  saveMutation.mutate({ ...value, status: editing.record.status ?? null, id: editing.record.id }),
              }
            : null,
        }}
        pstoDialogsProps={{
          requestDialogProps: isPstoRequestModalOpen
            ? {
                nextRequestName: nextPstoRequestName,
                selectedRows: selectedHeatTreatmentRows,
                requestNaming: pstoRequestNaming,
                requestSearch: pstoRequestSearch,
                requestManagerOptions: pstoRequestManagerOptions,
                heatTreatmentRowsCount: heatTreatmentRows.length,
                filteredRows: filteredPstoRequestRows,
                availableRowsCount: filteredAvailablePstoRequestRows.length,
                selectedIds: selectedHeatTreatmentIds,
                areAllAvailableRowsSelected: isEveryFilteredLnkRequestRowSelected(
                  selectedHeatTreatmentIds,
                  filteredAvailablePstoRequestRows,
                ),
                isPending: pstoRequestMutation.isPending,
                canCreateRequest: canCreatePstoRequest,
                onClose: closeCreatePstoRequestModal,
                onOpenRequestManager: openPstoRequestManager,
                onRequestNamingChange: setPstoRequestNaming,
                onRequestSearchChange: setPstoRequestSearch,
                onToggleAllRows: toggleAllPstoRequestRows,
                onToggleRow: togglePstoRequestRow,
                onSubmit: submitCreatePstoRequest,
              }
            : null,
          requestManagerDialogProps: isPstoRequestManagerOpen
            ? {
                requestName: managedPstoRequestName,
                requestOptions: pstoRequestManagerOptions,
                requestRows: managedPstoRequestRows,
                requestNameDraft: managedPstoRequestNameDraft,
                isManagerPending: pstoRequestManagerMutation.isPending,
                isCorrectionPending: pstoRequestCorrectionMutation.isPending,
                onClose: () => setIsPstoRequestManagerOpen(false),
                onChangeRequest: changeManagedPstoRequest,
                onRequestNameDraftChange: setManagedPstoRequestNameDraft,
                onRenameRequest: renameManagedPstoRequest,
                onClearPosition: clearManagedPstoRequestPosition,
                onDeleteRequest: deleteManagedPstoRequest,
              }
            : null,
          resultDialogProps: isPstoResultModalOpen
            ? {
                draft: pstoResultDraft,
                requestSearch: pstoResultRequestSearch,
                nextDiagramName: nextPstoDiagramName,
                filteredRows: filteredPstoResultRows,
                filteredRequestOptions: filteredPstoResultRequestOptions,
                availableRequestOptions: pstoResultAvailableRequestOptions,
                saveBlockReason: pstoResultSaveBlockReason,
                allFilteredSelectableRowsSelected: isEveryFilteredLnkRequestRowSelected(
                  pstoResultDraft.rowIds,
                  filteredPstoResultRows.filter((row) => canSelectPstoResultRow(row, pstoResultDraft.requestName)),
                ),
                canSelectRow: canSelectPstoResultRow,
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
                onToggleAll: toggleAllPstoResultRows,
                onToggleRow: togglePstoResultRow,
                onOpenManager: openPstoResultManager,
                onClose: closeAddPstoResultModal,
                onSave: handleAddPstoResult,
              }
            : null,
          resultManagerDialogProps: isPstoResultManagerOpen
            ? {
                rows: managedPstoResultRows,
                diagramDrafts: managedPstoDiagramDrafts,
                isPending: pstoResultCorrectionMutation.isPending,
                onClose: () => {
                  setIsPstoResultManagerOpen(false)
                  setManagedPstoDiagramDrafts({})
                },
                onDiagramDraftChange: (rowId, value) =>
                  setManagedPstoDiagramDrafts((current) => ({ ...current, [rowId]: value })),
                onRenameDiagram: renameManagedPstoDiagram,
                onDeleteResult: deleteManagedPstoResult,
              }
            : null,
        }}
        lnkDialogsProps={{
          requestDialogProps: isLnkRequestModalOpen
            ? {
                nextRequestName: nextLnkRequestName,
                selectedRowsCount: selectedLnkRows.length,
                selectedTargetCount: selectedLnkRequestTargetCount,
                requestNaming: lnkRequestNaming,
                requestManagerOptions: lnkRequestManagerOptions,
                selectedMethodKeys: selectedLnkMethodKeys,
                selectedMethods: lnkRequestDraft.methods,
                requestSearch: lnkRequestSearch,
                lnkRowsCount: lnkRows.length,
                filteredRows: filteredLnkRequestRows,
                filteredAvailableRows: filteredAvailableLnkRequestRows,
                selectedIds: selectedLnkIds,
                isPending: lnkRequestMutation.isPending,
                onClose: closeCreateLnkRequestModal,
                onOpenRequestManager: openLnkRequestManager,
                onRequestNamingChange: setLnkRequestNaming,
                onToggleMethod: toggleLnkRequestMethod,
                onRequestSearchChange: setLnkRequestSearch,
                onToggleAllRows: toggleAllLnkRequestRows,
                onToggleRow: toggleLnkRequestRow,
                onSubmit: handleCreateLnkRequest,
              }
            : null,
          requestManagerDialogProps: isLnkRequestManagerOpen
            ? {
                requestName: managedLnkRequestName,
                requestOptions: lnkRequestManagerOptions,
                requestRows: managedLnkRequestRows,
                requestMethods: managedLnkRequestMethods,
                requestNameDraft: managedLnkRequestNameDraft,
                isManagerPending: lnkRequestManagerMutation.isPending,
                isCorrectionPending: lnkRequestCorrectionMutation.isPending,
                onClose: () => setIsLnkRequestManagerOpen(false),
                onChangeRequest: changeManagedLnkRequest,
                onRequestNameDraftChange: setManagedLnkRequestNameDraft,
                onRenameRequest: renameManagedLnkRequest,
                onClearPosition: clearManagedLnkRequestPosition,
                onDeleteRequest: deleteManagedLnkRequest,
              }
            : null,
          resultManagerDialogProps: isLnkResultManagerOpen
            ? {
                rows: managedLnkResultRows,
                methods: managedLnkResultMethods,
                entries: managedLnkResultEntries,
                pendingEntries: managedLnkPendingResultRows,
                methodKey: managedLnkResultMethodKey,
                conclusionDrafts: managedLnkConclusionDrafts,
                pendingResultChanges: managedLnkPendingResultChanges,
                preview: managedLnkResultPreview,
                changeHint: managedLnkResultChangeHint,
                isResultCorrectionPending: lnkResultCorrectionMutation.isPending,
                isResultReplacementPending: lnkResultReplacementMutation.isPending,
                isConclusionCorrectionPending: lnkConclusionCorrectionMutation.isPending,
                onClose: () => {
                  setIsLnkResultManagerOpen(false)
                  setManagedLnkResultOrderIds(null)
                  setManagedLnkResultPreview(null)
                  setManagedLnkResultChangeHint(null)
                  setManagedLnkPendingResultChanges({})
                },
                onMethodChange: (nextMethodKey) => {
                  setManagedLnkResultMethodKey(nextMethodKey)
                  setManagedLnkPendingResultChanges({})
                  setManagedLnkResultChangeHint(null)
                  setManagedLnkResultPreview(null)
                },
                onConclusionDraftChange: (changeKey, value) =>
                  setManagedLnkConclusionDrafts((current) => ({ ...current, [changeKey]: value })),
                onRenameConclusion: renameManagedLnkConclusionForRow,
                onReplaceResult: replaceLnkResult,
                onClearResult: clearLnkResult,
                onPreviewEnter: setManagedLnkResultPreview,
                onPreviewLeave: (changeKey) =>
                  setManagedLnkResultPreview((current) => (current?.changeKey === changeKey ? null : current)),
                onResetPendingChanges: () => {
                  setManagedLnkPendingResultChanges({})
                  setManagedLnkResultChangeHint(null)
                  setManagedLnkResultPreview(null)
                },
                onSaveChanges: saveManagedLnkResultChanges,
              }
            : null,
          officialityDialogProps: isLnkOfficialityModalOpen
            ? {
                draft: lnkOfficialityDraft,
                filteredRows: filteredLnkOfficialityRows,
                selectedRows: selectedLnkOfficialityRows,
                saveBlockReason: lnkOfficialitySaveBlockReason,
                isSaveDisabled: isLnkOfficialitySaveDisabled,
                onClose: closeLnkOfficialityModal,
                onSave: saveLnkOfficiality,
                onDraftChange: setLnkOfficialityDraft,
                onToggleRow: toggleLnkOfficialityRow,
                onSetVisibleRowsSelected: setVisibleLnkOfficialityRowsSelected,
              }
            : null,
          resultDialogProps: isLnkResultModalOpen
            ? {
                draft: lnkResultDraft,
                requestSearch: lnkResultRequestSearch,
                selectedMethods: selectedLnkResultMethods,
                selectedRows: selectedLnkResultRows,
                visibleRows: visibleLnkResultRows,
                filteredRequestOptions: filteredLnkResultRequestOptions,
                availableRequestOptions: lnkResultAvailableRequestOptions,
                nextConclusionName: nextLnkConclusionName,
                saveBlockReason: lnkResultSaveBlockReason,
                isSaveDisabled: isLnkResultSaveDisabled,
                contextReady: lnkResultContextReady,
                canBulkToggleRows: canBulkToggleLnkResultRows,
                areAllFilteredRowsSelected: isEveryFilteredLnkRequestRowSelected(
                  lnkResultDraft.rowIds,
                  selectableVisibleLnkResultRows,
                ),
                onClose: closeAddLnkResultModal,
                onOpenManager: openLnkResultManager,
                onMethodChange: changeLnkResultMethod,
                onControlDateChange: (controlDate) => setLnkResultDraft((current) => ({ ...current, controlDate })),
                onDefaultResultChange: (result) => {
                  if (result === 'ремонт' && selectedLnkResultRows.some(isLnkRepairForbidden)) return
                  setLnkResultDraft((current) => ({
                    ...current,
                    result,
                    rowResults: {},
                  }))
                },
                onConclusionNamingChange: (conclusionNaming) =>
                  setLnkResultDraft((current) => ({ ...current, conclusionNaming })),
                onClearSelection: () => {
                  setShouldPinPreviewedLnkResultRows(false)
                  setLnkResultDraft((current) => ({
                    ...current,
                    rowIds: new Set(),
                    rowResults: {},
                  }))
                },
                onToggleAllRows: toggleAllLnkResultRows,
                onSearchChange: (search) => setLnkResultDraft((current) => ({ ...current, search })),
                onRequestSearchChange: setLnkResultRequestSearch,
                onRequestChange: changeLnkResultRequest,
                onClearRequestSearch: () => setLnkResultRequestSearch(''),
                onClearSearch: () => {
                  setLnkResultRequestSearch('')
                  setShouldPinPreviewedLnkResultRows(false)
                  setLnkResultDraft((current) => ({
                    ...current,
                    requestName: '',
                    rowIds: new Set(),
                    rowResults: {},
                    search: '',
                  }))
                },
                onToggleRow: toggleLnkResultRow,
                onSetRowResult: setLnkResultForRow,
                onOpenPreview: () => {
                  setShouldPinPreviewedLnkResultRows(true)
                  setIsLnkResultPreviewOpen(true)
                },
                onSave: handleAddLnkResult,
              }
            : null,
          resultPreviewDialogProps: isLnkResultPreviewOpen
            ? {
                rows: selectedLnkResultRows,
                draft: lnkResultDraft,
                onClose: () => setIsLnkResultPreviewOpen(false),
              }
            : null,
        }}
        fieldEditorProps={{
          dialogProps: heatTreatmentFieldEditing
            ? {
                editing: heatTreatmentFieldEditing,
                requestOptions: lnkRequestOptions,
                isSaving: heatTreatmentFieldMutation.isPending || lnkFieldMutation.isPending,
                onChange: (value) =>
                  setHeatTreatmentFieldEditing((current) => (current ? { ...current, value } : current)),
                onClose: () => setHeatTreatmentFieldEditing(null),
                onSave: saveEditedHeatTreatmentField,
              }
            : null,
        }}
      />
    </ReportWorkspace>
  )
}
