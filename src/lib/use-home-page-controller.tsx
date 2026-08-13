import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, ClipboardCheck, ExternalLink, FileSpreadsheet, FilePlus2, FileText, GitBranch, ListFilter, Pencil, Trash2 } from 'lucide-react'
import type { DispatcherTask, PercentageLineControlTask, WeldRow } from '@/lib/dispatcher-types'
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
import { prepareReportRows, useReportRows } from '@/lib/use-report-rows'
import { useWeldPageQuery } from '@/lib/use-weld-page-query'
import { usePreparedReportRows } from '@/lib/use-prepared-report-rows'
import { useReportRequestDerivedState } from '@/lib/use-report-request-derived-state'
import { useActiveReportLayoutState } from '@/lib/use-active-report-layout-state'
import { usePstoResultDerivedState } from '@/lib/use-psto-result-derived-state'
import { useLnkResultDerivedState } from '@/lib/use-lnk-result-derived-state'
import { useManagedLnkResultDerivedState } from '@/lib/use-managed-lnk-result-derived-state'
import { useLnkOfficialityDerivedState } from '@/lib/use-lnk-officiality-derived-state'
import { useJointChainActions } from '@/lib/use-joint-chain-actions'
import { useLnkOfficialityActions } from '@/lib/use-lnk-officiality-actions'
import { useLnkRequestActions } from '@/lib/use-lnk-request-actions'
import { useLnkResultActions } from '@/lib/use-lnk-result-actions'
import { useLnkResultSaveActions } from '@/lib/use-lnk-result-save-actions'
import { useReportEditActions } from '@/lib/use-report-edit-actions'
import { useManagedLnkRequestActions } from '@/lib/use-managed-lnk-request-actions'
import { useManagedLnkResultActions } from '@/lib/use-managed-lnk-result-actions'
import { usePstoModalState } from '@/lib/use-psto-modal-state'
import { useLnkRequestModalState } from '@/lib/use-lnk-request-modal-state'
import { useLnkResultModalState } from '@/lib/use-lnk-result-modal-state'
import { useReportFilterState } from '@/lib/use-report-filter-state'
import { useReportSelectionState } from '@/lib/use-report-selection-state'
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
import type { DocumentGenerationRequest } from '@/lib/document-generation'
import {
  getGeneratedDocumentProfile,
  isGeneratedDocumentFieldKey,
} from '@/lib/generated-document-types'
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
import { getAvailableLnkRequestMethods } from '@/lib/lnk-status'
import { isLnkRepairForbidden } from '@/lib/lnk-result-rules'
import { filterWeldRowsByColumns } from '@/lib/weld-table-filtering'
import { buildHeatTreatmentReportRows, buildLnkReportRows, sumAcceptedWdi } from '@/lib/report-row-utils'
import type { ReportImportRecord } from '@/lib/report-import-preview'
import type { WeldRowVersionTarget } from '@/lib/weld-row-version'
import { buildFinalStatusRowsContext, type WeldFieldKey, type WeldInput } from '@/lib/weld-fields'
import {
  createDefaultLnkRequestDraft,
  createDefaultLnkResultDraft,
  createDefaultPstoResultDraft,
} from '@/lib/report-draft-state'
import { canCreatePstoRequest } from '@/lib/psto-status'
import { canCreateLnkRequest, withOfficialJointStatus } from '@/lib/report-control-state'
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
import { useSaveCheckSettings } from '@/lib/save-check-settings'
import { useWeldJournalMutations } from '@/lib/use-weld-journal-mutations'
import {
  buildLineFilters,
  buildPercentageLineStampFilters,
  buildRowIdListFilters,
  type PercentageLineStampFilter,
} from '@/lib/report-navigation'
import type { PercentageControlMethod } from '@/lib/percentage-line-summary'
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
import { getWeldJointById, listWeldJointRowsByIds } from '@/server/welds'
import { GENERATED_DOCUMENT_STORAGE_EVENT } from '@/lib/document-storage-events'
import { useSystemDocumentTemplateAvailability } from '@/lib/use-system-document-template-availability'
import { useRkExposureMutation } from '@/lib/use-rk-exposure-mutation'
import {
  getSystemDocumentReferenceForField,
  type SystemDocumentReference,
  type SystemDocumentNavigationRequest,
} from '@/lib/system-document-types'

export function useHomePageController() {
  const queryClient = useQueryClient()
  const saveCheckSettings = useSaveCheckSettings()
  const otherSettings = useOtherSettings()
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false)
  const [systemDocumentNavigationRequest, setSystemDocumentNavigationRequest] =
    useState<SystemDocumentNavigationRequest | null>(null)
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
  } = useReportFilterState()
  const availableSystemDocumentTypes = useSystemDocumentTemplateAvailability({
    enabled: activeReport === 'lnk' || activeReport === 'heatTreatment',
  })
  const {
    editing,
    chainRecord,
    heatTreatmentFieldEditing,
    rkExposureEditing,
    message,
    lnkNotice,
    setEditing,
    setChainRecord,
    setHeatTreatmentFieldEditing,
    setRkExposureEditing,
    setMessage,
    setLnkNotice,
  } = useReportPageUiState()
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
  const {
    selectedHeatTreatmentIds,
    selectedLnkIds,
    selectedWeldingJournalIds,
    setSelectedHeatTreatmentIds,
    setSelectedLnkIds,
    setSelectedWeldingJournalIds,
  } = useReportSelectionState()
  const {
    lnkRequestDraft,
    lnkRequestNaming,
    isLnkRequestModalOpen,
    isLnkRequestManagerOpen,
    managedLnkRequestName,
    managedLnkRequestDate,
    managedLnkRequestNameDraft,
    lnkRequestSearch,
    setLnkRequestDraft,
    setLnkRequestNaming,
    setIsLnkRequestModalOpen,
    setIsLnkRequestManagerOpen,
    setManagedLnkRequestName,
    setManagedLnkRequestDate,
    setManagedLnkRequestNameDraft,
    setLnkRequestSearch,
  } = useLnkRequestModalState()
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
    managedLnkResultMethodKey,
    managedLnkConclusionDrafts,
    managedLnkResultOrderIds,
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
    setManagedLnkResultMethodKey,
    setManagedLnkConclusionDrafts,
    setManagedLnkResultOrderIds,
    setManagedLnkResultChangeHint,
    setManagedLnkPendingResultChanges,
    setPreservedLnkOrderIds,
  } = useLnkResultModalState()
  const [isDuplicateControlModalOpen, setIsDuplicateControlModalOpen] = useState(false)
  const [documentGenerationRequest, setDocumentGenerationRequest] = useState<DocumentGenerationRequest | null>(null)
  const [duplicateControlDraft, setDuplicateControlDraft] = useState<DuplicateControlDraft>(() =>
    createEmptyDuplicateControlDraft(),
  )
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
  const isReportDataModalOpen = getReportModalOpenState({
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
      isDuplicateControlModalOpen,
    })
  const isPstoDataModalOpen =
    isPstoRequestModalOpen ||
    isPstoRequestManagerOpen ||
    isPstoResultModalOpen ||
    isPstoResultManagerOpen
  const isLnkDataModalOpen =
    isLnkRequestModalOpen ||
    isLnkRequestManagerOpen ||
    isLnkResultModalOpen ||
    isLnkResultPreviewOpen ||
    isLnkResultManagerOpen ||
    isLnkOfficialityModalOpen
  const isReportModalOpen = isImportDialogOpen || Boolean(rkExposureEditing) || isReportDataModalOpen

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
    (isLnkDataModalOpen || isLnkShowMenuOpen || heatTreatmentFieldEditing?.report === 'lnk')
  const shouldLoadPstoContext =
    !shouldLoadFullWeldRows &&
    (isPstoDataModalOpen || isPstoShowMenuOpen || Boolean(heatTreatmentFieldEditing && heatTreatmentFieldEditing.report !== 'lnk'))
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
    refetchDuplicateControls,
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
    enabled: isServerPagedTab || activeReport === 'welderStamps',
  })
  const tableDuplicateKeys = isServerPagedTab && dispatcherTaskSnapshot.data
    ? dispatcherTaskSnapshot.duplicateKeys
    : undefined
  const visibleRepeatedJointTasks = isServerPagedTab
    ? dispatcherTaskSnapshot.repeatedJointTasks
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
    isDuplicateControlModalOpen
  const enableLnkResultState =
    activeReport === 'lnk' ||
    isImportDialogOpen ||
    isLnkResultModalOpen ||
    isLnkResultPreviewOpen ||
    isLnkResultManagerOpen ||
    isLnkOfficialityModalOpen ||
    isDuplicateControlModalOpen
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
    openCreateLnkRequestModal,
    openCreateLnkRequestModalForRow,
    toggleAllLnkRequestRows,
    toggleLnkRequestMethod,
    toggleLnkRequestRow,
  } = useLnkRequestActions({
    draft: lnkRequestDraft,
    filteredRows: filteredAvailableLnkRequestRows,
    lnkRows,
    naming: lnkRequestNaming,
    nextRequestName: nextLnkRequestName,
    selectedMethodKeys: selectedLnkMethodKeys,
    selectedRows: selectedLnkRows,
    selectedTargetCount: selectedLnkRequestTargetCount,
    mutation: lnkRequestMutation,
    setDraft: setLnkRequestDraft,
    setIsOpen: setIsLnkRequestModalOpen,
    setMessage,
    setNaming: setLnkRequestNaming,
    setPreservedOrderIds: setPreservedLnkOrderIds,
    setSearch: setLnkRequestSearch,
    setSelectedIds: setSelectedLnkIds,
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
  const {
    deleteManyMutation,
    deleteMutation,
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
    deleteObsoleteRepeatedJoint,
    renameObsoleteRepeatedJoint,
  } = useRepeatedJointTaskActions({
    activeReport,
    rows,
    loadRows: async () => {
      const [weldResult, controlsResult] = await Promise.all([
        weldsQuery.refetch(),
        refetchDuplicateControls(),
      ])
      return prepareReportRows(
        weldResult.data,
        controlsResult.data ?? [],
        undefined,
        undefined,
        otherSettings,
      )
    },
    welderStamps,
    welderStampSuspensions,
    repeatedJointMutation,
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
    saveCheckSettings,
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
    changeLnkResultMethod,
    changeLnkResultRequest,
    closeAddLnkResultModal,
    openAddLnkResultModal,
    openAddLnkResultModalForRow,
    toggleAllLnkResultRows,
    toggleLnkResultRow,
  } = useLnkResultActions({
    filteredRows: filteredLnkResultRows,
    lnkRows,
    draft: lnkResultDraft,
    mutation: lnkResultMutation,
    setDraft: setLnkResultDraft,
    setIsModalOpen: setIsLnkResultModalOpen,
    setIsPreviewOpen: setIsLnkResultPreviewOpen,
    setMessage,
    setPreservedOrderIds: setPreservedLnkOrderIds,
    setRequestSearch: setLnkResultRequestSearch,
    setShouldPinPreviewedRows: setShouldPinPreviewedLnkResultRows,
    defaultConclusionNaming: defaultLnkConclusionNaming,
  })
  const {
    handleAddLnkResult,
    setLnkResultForRow,
  } = useLnkResultSaveActions({
    lnkRows,
    draft: lnkResultDraft,
    selectedRows: selectedLnkResultRows,
    saveBlockReason: lnkResultSaveBlockReason,
    nextConclusionName: nextLnkConclusionName,
    resultMutation: lnkResultMutation,
    clearGeneratedDataMutation: clearLnkGeneratedDataMutation,
    setDraft: setLnkResultDraft,
    setMessage,
  })
  const {
    managedLnkResultRows,
    managedLnkResultMethods,
    managedLnkResultEntries,
    managedLnkPendingResultRows,
  } = useManagedLnkResultDerivedState({
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
    lnkRows,
    selectedLnkResultRowIds: lnkResultDraft.rowIds,
    managedLnkConclusionDrafts,
    managedLnkPendingResultChanges,
    managedLnkPendingResultRows,
    lnkResultCorrectionMutation,
    lnkResultReplacementMutation,
    lnkConclusionCorrectionMutation,
    setMessage,
    setIsLnkResultManagerOpen,
    setManagedLnkResultMethodKey,
    setManagedLnkConclusionDrafts,
    setManagedLnkResultOrderIds,
    setManagedLnkResultChangeHint,
    setManagedLnkPendingResultChanges,
  })
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
  const dispatcherTaskServerFilters = useMemo(
    () => buildDispatcherTaskServerFilters(activeColumnFilters),
    [activeColumnFilters],
  )
  const weldPageQuery = useWeldPageQuery({
    enabled: isServerPagedTab,
    report: isServerPagedTab ? activeReport : 'weldingJournal',
    columnFilters: isServerPagedTab ? dispatcherTaskServerFilters : {},
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
  const generateDocumentForRows = (
    type: DocumentGenerationRequest['type'],
    documentRows: WeldRow[],
  ) => {
    const documentLabel = getGeneratedDocumentProfile(type).formationLabel
    if (documentRows.length === 0) {
      setMessage(`Нет стыков для формирования ${documentLabel}.`)
      return
    }
    setDocumentGenerationRequest({
      id: Date.now(),
      type,
      rows: documentRows,
    })
    setIsWeldingJournalGenerateMenuOpen(false)
    setIsWeldingJournalShowMenuOpen(false)
  }
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
    lnkRequestOptions,
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
    managedPstoRequestDate,
    managedPstoRequestNameDraft,
    nextPstoDiagramName,
    nextPstoRequestName,
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
  })

  const { changeActiveReport: changeActiveReportUnsafe } = useReportChangeActions({
    setActiveReport,
    setEditing,
  })

  async function changeActiveReport(report: Parameters<typeof changeActiveReportUnsafe>[0]) {
    setMessage(null)
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

  const openDuplicateControlModalForRow = (row: WeldRow) => {
    setDuplicateControlDraft({
      ...createEmptyDuplicateControlDraft(),
      rowIds: new Set([row.id]),
      search: String(row.joint ?? ''),
    })
    setIsDuplicateControlModalOpen(true)
  }

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
    setActiveReport('weldingJournal')
    setChainRecord(null)
    setEditing(null)
    setColumnFilters(buildPercentageLineStampFilters(filter))
    setMessage(`Показаны стыки клейма ${filter.stamp} на линии ${filter.line}.`)
  }

  const openWeldRowIds = (rowIds: number[], messageText?: string) => {
    setActiveReport('weldingJournal')
    setChainRecord(null)
    setEditing(null)
    setColumnFilters(buildRowIdListFilters(rowIds))
    setMessage(messageText || `Показано стыков: ${rowIds.length}.`)
  }

  const openGeneratedDocumentRows = (
    rowIds: number[],
    documentTitle: string,
    targetReport: 'weldingJournal' | 'lnk' | 'heatTreatment' = 'weldingJournal',
  ) => {
    const uniqueRowIds = Array.from(new Set(rowIds)).filter(Number.isFinite)
    if (targetReport === 'lnk') {
      setActiveReport('lnk')
      setChainRecord(null)
      setEditing(null)
      setLnkFilters(buildRowIdListFilters(uniqueRowIds))
      setMessage(`Показаны стыки системного документа ЛНК «${documentTitle}»: ${uniqueRowIds.length}.`)
      return
    }
    if (targetReport === 'heatTreatment') {
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

  const handleDocumentGenerationRequest = (requestId: number) => {
    setDocumentGenerationRequest((current) => (current?.id === requestId ? null : current))
  }

  const handleSystemDocumentNavigationRequest = (requestId: number) => {
    setSystemDocumentNavigationRequest((current) =>
      current?.requestId === requestId ? null : current,
    )
  }

  const assignPercentageLineMissingControls = async (rowIds: number[], method: PercentageControlMethod) => {
    const targetRows = await listWeldJointRowsByIds({ data: { ids: rowIds } })
    if (targetRows.length === 0) {
      setMessage('Стыки для назначения РК/УЗК не найдены')
      return
    }

    const fieldKey = method === 'УЗК' ? 'hasUzk' : 'hasRk'
    const savedRows = await updateWeldRowsOrThrow(
      targetRows.map((row) => ({
        ...row,
        [fieldKey]: 'да',
      })),
      'Не удалось назначить РК/УЗК по процентной линии',
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

  useReportModalEscapeKey({
    isReportModalOpen,
    isLnkResultPreviewOpen,
    isPstoRequestManagerOpen,
    isPstoResultManagerOpen,
    isLnkRequestManagerOpen,
    isLnkResultManagerOpen,
    isRkExposureModalOpen: Boolean(rkExposureEditing),
    isPstoResultModalOpen,
    isPstoRequestModalOpen,
    isLnkOfficialityModalOpen,
    isDuplicateControlModalOpen,
    isLnkResultModalOpen,
    isLnkRequestModalOpen,
    isReportImportModalOpen: isImportDialogOpen,
    canClosePstoRequestManager: !pstoRequestManagerMutation.isPending && !pstoRequestCorrectionMutation.isPending,
    canClosePstoResultManager: !pstoResultCorrectionMutation.isPending,
    canCloseLnkRequestManager: !lnkRequestManagerMutation.isPending && !lnkRequestCorrectionMutation.isPending,
    canCloseLnkResultManager:
      !lnkResultCorrectionMutation.isPending &&
      !lnkResultReplacementMutation.isPending &&
      !lnkConclusionCorrectionMutation.isPending,
    canCloseRkExposureModal: !rkExposureMutation.isPending,
    onCloseLnkResultPreview: () => setIsLnkResultPreviewOpen(false),
    onClosePstoRequestManager: () => setIsPstoRequestManagerOpen(false),
    onClosePstoResultManager: () => setIsPstoResultManagerOpen(false),
    onCloseLnkRequestManager: () => setIsLnkRequestManagerOpen(false),
    onCloseLnkResultManager: closeLnkResultManager,
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
    onDeleteTask: (task) => runProtectedDelete('удаление повторного стыка', () => deleteObsoleteRepeatedJoint(task)),
    onRenameTask: (task) => runProtectedEdit('переименование стыка', () => renameObsoleteRepeatedJoint(task)),
    onAcceptPercentageLineTask: acceptPercentageLineTask,
    onEditPercentageLineTaskStamp: (task) => runProtectedEdit('редактирование клейма стыка', () => editPercentageLineTaskStamp(task)),
    onSuspendPercentageLineWelder: (task) =>
      runProtectedEdit('добавление отстранения сварщика', () => openWelderSuspensionFromPercentageLineTask(task)),
    onSkipPercentageLineWelderSuspension: skipWelderSuspensionFromPercentageLineTask,
    isCreatePending: repeatedJointMutation.isPending,
    isDeletePending: obsoleteRepeatedJointMutation.isPending,
    isRenamePending: renameRepeatedJointMutation.isPending,
  })

  const rowActionHandlers = createReportRowActionHandlers({
    openCreatePstoRequestModalForRow,
    openAddPstoResultModalForRow,
    openCreateLnkRequestModalForRow,
    openAddLnkResultModalForRow,
  })

  const openLnkRequestContextForRow = (row: WeldRow) => {
    if (canCreateLnkRequest(row)) {
      openCreateLnkRequestModalForRow(row)
      return
    }

    const request = getLnkRequestDocumentIdentities([row])[0]
    if (request) {
      openLnkRequestManager(request.name, request.date)
      return
    }

    setMessage('Для этого стыка нет заявок ЛНК')
  }

  const openPstoRequestContextForRow = (row: WeldRow) => {
    if (canCreatePstoRequest(row)) {
      openCreatePstoRequestModalForRow(row)
      return
    }

    const request = getPstoRequestDocumentIdentities([row])[0]
    if (request) {
      openPstoRequestManager(request.name, request.date)
      return
    }

    setMessage('Для этого стыка нет заявки ПСТО')
  }

  const openLnkOfficialityModalForRow = (row: WeldRow) => {
    setLnkOfficialityDraft({
      rowIds: new Set([row.id]),
      search: String(row.joint ?? row.line ?? ''),
      status: '',
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

  const openLnkRequestContextForRows = (selectedRows: WeldRow[]) => {
    if (selectedRows.length <= 1) {
      openLnkRequestContextForRow(selectedRows[0])
      return
    }

    const creatableRows = selectedRows.filter(canCreateLnkRequest)
    if (creatableRows.length === selectedRows.length) {
      const methodKeys = new Set<WeldFieldKey>(
        selectedRows.flatMap((selectedRow) => getAvailableLnkRequestMethods(selectedRow).map((method) => method.requestKey)),
      )
      setPreservedLnkOrderIds(lnkRows.map((lnkRow) => lnkRow.id))
      setSelectedLnkIds(new Set(selectedRows.map((selectedRow) => selectedRow.id)))
      setLnkRequestDraft({ ...createDefaultLnkRequestDraft(), methods: methodKeys })
      setLnkRequestNaming(defaultLnkRequestNaming)
      setLnkRequestSearch('')
      setIsLnkRequestModalOpen(true)
      return
    }

    if (creatableRows.length === 0) {
      const commonRequests = getCommonLnkRequests(selectedRows)
      if (commonRequests.length === 1) {
        openLnkRequestManager(commonRequests[0].name, commonRequests[0].date)
        return
      }
    }

    setMessage('Для выбранных стыков заявка ЛНК ведет в разные действия')
  }

  const openPstoRequestContextForRows = (selectedRows: WeldRow[]) => {
    if (selectedRows.length <= 1) {
      openPstoRequestContextForRow(selectedRows[0])
      return
    }

    const creatableRows = selectedRows.filter(canCreatePstoRequest)
    if (creatableRows.length === selectedRows.length) {
      setSelectedHeatTreatmentIds(new Set(selectedRows.map((selectedRow) => selectedRow.id)))
      setPstoRequestNaming(defaultPstoRequestNaming)
      setPstoRequestSearch('')
      setIsPstoRequestModalOpen(true)
      return
    }

    if (creatableRows.length === 0) {
      const requests = getPstoRequestDocumentIdentities(selectedRows)
      if (requests.length === 1) {
        openPstoRequestManager(requests[0].name, requests[0].date)
        return
      }
    }

    setMessage('Для выбранных стыков заявка ПСТО ведет в разные действия')
  }

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
    setLnkResultRequestSearch(request?.name ?? '')
    setLnkResultDraft({
      ...createDefaultLnkResultDraft(defaultLnkConclusionNaming),
      requestName: request?.name ?? '',
      requestDate: request?.date ?? '',
      rowIds: new Set(selectedRows.map((selectedRow) => selectedRow.id)),
      search: '',
    })
    setShouldPinPreviewedLnkResultRows(false)
    setIsLnkResultModalOpen(true)
  }

  const openPstoResultModalForRows = (selectedRows: WeldRow[]) => {
    if (selectedRows.length <= 1) {
      openAddPstoResultModalForRow(selectedRows[0])
      return
    }
    if (selectedRows.some((selectedRow) => getPstoRequestDocumentIdentities([selectedRow]).length === 0)) {
      setMessage('Для части выбранных стыков нет заявки ПСТО')
      return
    }
    const requests = getPstoRequestDocumentIdentities(selectedRows)
    if (requests.length !== 1) {
      setMessage('Для результата ПСТО выберите стыки одной заявки ПСТО')
      return
    }

    const request = requests[0]
    setPstoResultDraft({
      ...createDefaultPstoResultDraft(defaultPstoConclusionNaming),
      requestName: request.name,
      requestDate: request.date,
      rowIds: new Set(selectedRows.map((selectedRow) => selectedRow.id)),
      search: '',
    })
    setPstoResultRequestSearch(request.name)
    setIsPstoResultModalOpen(true)
  }

  const openLnkOfficialityModalForRows = (selectedRows: WeldRow[]) => {
    if (selectedRows.length <= 1) {
      openLnkOfficialityModalForRow(selectedRows[0])
      return
    }
    setLnkOfficialityDraft({
      rowIds: new Set(selectedRows.map((selectedRow) => selectedRow.id)),
      search: '',
      status: '',
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
    if (selectedRows.length <= 1) return undefined
    const creatableCount = selectedRows.filter(canCreateLnkRequest).length
    if (creatableCount > 0 && creatableCount < selectedRows.length) {
      return 'Часть стыков требует создания заявки, а часть уже находится в заявке'
    }
    if (creatableCount === selectedRows.length) return undefined
    return getCommonLnkRequests(selectedRows).length === 1 ? undefined : 'Выбранные стыки находятся в разных заявках ЛНК'
  }

  const getPstoRequestGroupDisabledReason = (selectedRows: WeldRow[]) => {
    if (selectedRows.length <= 1) return undefined
    const creatableCount = selectedRows.filter(canCreatePstoRequest).length
    if (creatableCount > 0 && creatableCount < selectedRows.length) {
      return 'Часть стыков требует создания заявки, а часть уже находится в заявке'
    }
    if (creatableCount === selectedRows.length) return undefined
    const allRowsHaveRequest = selectedRows.every(
      (selectedRow) => getPstoRequestDocumentIdentities([selectedRow]).length > 0,
    )
    return allRowsHaveRequest && getPstoRequestDocumentIdentities(selectedRows).length === 1
      ? undefined
      : 'Выбранные стыки находятся в разных заявках ПСТО'
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
    const pstoRequestDisabledReason = activeReport === 'heatTreatment' ? getPstoRequestGroupDisabledReason(contextRows) : undefined
    const lnkResultDisabledReason =
      activeReport === 'lnk' && contextRows.some((selectedRow) => getLnkRowRequestNames(selectedRow).length === 0)
        ? 'Сначала создайте заявку ЛНК для всех выбранных стыков'
        : undefined
    const pstoResultRequests = activeReport === 'heatTreatment'
      ? getPstoRequestDocumentIdentities(contextRows)
      : []
    const pstoResultRowsHaveRequests =
      activeReport !== 'heatTreatment' ||
      contextRows.every((selectedRow) => getPstoRequestDocumentIdentities([selectedRow]).length > 0)
    const pstoResultDisabledReason =
      activeReport === 'heatTreatment' &&
      (!pstoResultRowsHaveRequests || pstoResultRequests.length === 0 || (isGroupAction && pstoResultRequests.length !== 1))
        ? isGroupAction
          ? 'Для результата ПСТО выберите стыки одной заявки ПСТО'
          : 'Сначала создайте заявку ПСТО для этого стыка'
        : undefined

    const items: ContextActionMenuItem[] = []
    const systemDocumentReference = fieldKey
      ? getSystemDocumentReferenceForField(row, fieldKey)
      : null

    if (systemDocumentReference) {
      items.push(
        {
          id: 'open-in-documents',
          label: 'Открыть в документах',
          icon: FileText,
          onSelect: () => {
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

    if (activeSelectedRowIds.has(row.id)) {
      items.push(
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
      {
        id: 'open-chain',
        label: 'Открыть цепочку',
        icon: GitBranch,
        disabled: isGroupAction,
        title: isGroupAction ? 'Цепочку можно открыть только для одного стыка' : undefined,
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
      { type: 'separator', id: 'navigation-separator' },
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
        {
          id: 'edit-row',
          label: 'Редактировать стык',
          icon: Pencil,
          disabled: isGroupAction,
          title: isGroupAction ? 'Редактирование открывается только для одного стыка' : undefined,
          onSelect: () => handleProtectedEditRecord(row),
        },
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
      items.push(
        {
          id: 'lnk-request',
          label: 'Заявка ЛНК',
          icon: FilePlus2,
          disabled: Boolean(lnkRequestDisabledReason),
          title: lnkRequestDisabledReason,
          onSelect: () => openLnkRequestContextForRows(contextRows),
        },
        {
          id: 'lnk-result',
          label: 'Результат ЛНК',
          icon: ClipboardCheck,
          disabled: Boolean(lnkResultDisabledReason),
          title: lnkResultDisabledReason,
          onSelect: () => openLnkResultModalForRows(contextRows),
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
      )
      return items
    }

    if (activeReport === 'heatTreatment') {
      items.push(
        {
          id: 'psto-request',
          label: 'Заявка ПСТО',
          icon: FilePlus2,
          disabled: Boolean(pstoRequestDisabledReason),
          title: pstoRequestDisabledReason,
          onSelect: () => openPstoRequestContextForRows(contextRows),
        },
        {
          id: 'psto-result',
          label: 'Результат ПСТО',
          icon: ClipboardCheck,
          disabled: Boolean(pstoResultDisabledReason),
          title: pstoResultDisabledReason,
          onSelect: () => openPstoResultModalForRows(contextRows),
        },
      )
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
    onEdit: handleProtectedEditRecord,
    onDelete: deleteWeldRowById,
    stickyLeft,
    highlightedRowIds,
    highlightedCellKeys,
    dispatcherTaskRowIds: tableDispatcherTaskRowIds,
    onOpenChain: (row) => setChainRecord(row),
    onFilterLine: filterLineInCurrentReport,
    onOpenLinkedReport: openLinkedReportRow,
    onOpenDocument: (row, fieldKey) => {
      const previewWindow = openDocumentPreviewWindow()
      if (!previewWindow) return
      if (isGeneratedDocumentFieldKey(fieldKey)) {
        void import('@/lib/welding-journal-document')
          .then(({ openGeneratedDocumentForRow }) =>
            openGeneratedDocumentForRow(row, fieldKey, welderStamps, previewWindow),
          )
          .catch((reason) => writeDocumentPreviewImportError(previewWindow, reason))
        return
      }
      void import('@/lib/system-document-storage')
        .then(({ openSystemDocumentForRow }) =>
          openSystemDocumentForRow(row, fieldKey, welderStamps, previewWindow),
        )
        .catch((reason) => writeDocumentPreviewImportError(previewWindow, reason))
    },
    availableSystemDocumentTypes,
    onOpenDuplicateControl: openDuplicateControlModalForRow,
    rowActionHandlers,
    getContextMenuItems: getReportContextMenuItems,
    selectable: activeReport === 'weldingJournal' || activeReport === 'lnk' || activeReport === 'heatTreatment',
    selectedRowIds: activeSelectedRowIds,
    onSelectedRowIdsChange: setActiveSelectedRowIds,
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
    onCreatePstoRequest: openCreatePstoRequestModal,
    pstoRequestPending: pstoRequestMutation.isPending,
    onAddPstoResult: openAddPstoResultModal,
    pstoResultDisabled:
      pstoResultMutation.isPending ||
      (isPstoRowsContextReady && pstoResultRequestOptions.length === 0),
    isPstoShowMenuOpen,
    onTogglePstoShowMenu: () => setIsPstoShowMenuOpen((current) => !current),
    onOpenPstoCurrentReport: openPstoCurrentReport,
    onOpenPstoWaitingRequestReport: openPstoWaitingRequestReport,
    onOpenPstoResultsReport: openPstoResultsReport,
    onCreateLnkRequest: openCreateLnkRequestModal,
    lnkRequestPending: lnkRequestMutation.isPending,
    onAddLnkResult: openAddLnkResultModal,
    lnkResultDisabled:
      lnkResultMutation.isPending ||
      (isLnkRowsContextReady && lnkResultRequestOptions.length === 0),
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
        const result = await importMutation.mutateAsync(records.map(withOfficialJointStatus))
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
    setChainRecord(null)
    setActiveReport('lnk')
    setLnkFilters(buildPercentageLineStampFilters(task))
    setLnkOfficialityDraft({
      rowIds: new Set(rowIds),
      search: '',
      status: '',
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
      return 'Диспетчер скроет текущее предупреждение о лишнем РК/УЗК для этой процентной линии и клейма. Используй это только если дополнительный контроль действительно нужен и его не нужно исправлять.'
    }
    if (task.issue === 'new-welder') {
      return 'Диспетчер скроет текущее предупреждение о новом сварщике на процентной линии. Используй это только если клеймо указано верно и увеличение объема контроля принято осознанно.'
    }
    return 'Диспетчер скроет текущее предупреждение о негодном первичном стыке процентной линии. Используй это только если стык должен остаться официальным, а увеличение объема РК/УЗК принято осознанно.'
  }

  async function editPercentageLineTaskStamp(task: PercentageLineControlTask) {
    if (task.issue !== 'new-welder') return
    const record = await getWeldJointById({ data: { id: task.row.id } })
    if (!record) {
      setMessage('Стык для редактирования не найден')
      return
    }
    setActiveReport('weldingJournal')
    setChainRecord(null)
    setColumnFilters(buildPercentageLineStampFilters(task))
    setEditing({ record: record as WeldRow, focusField: 'stamp1K' })
    setMessage(`Открыто редактирование стыка ${String(task.row.joint ?? '-')}: проверь официальное клеймо ${task.stamp}`)
  }

  function openWelderSuspensionFromPercentageLineTask(task: PercentageLineControlTask) {
    if (task.issue !== 'suspend-welder') return
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

  const reportSummaryBarProps = createReportSummaryBarProps({
    activeReport,
    left: stickyLeft,
    minWidth: registerMinWidth,
    isLoading: isServerPagedTab ? weldPageQuery.isLoading : weldsQuery.isLoading,
    weldingRows: activeReport === 'weldingJournal' ? filteredVisibleRows : rows,
    weldingRowCount: activeReport === 'weldingJournal' && isServerPagedTab ? weldPageQuery.totalCount : undefined,
    acceptedWdiTotal:
      activeReport === 'weldingJournal' && isServerPagedTab ? weldPageQuery.acceptedWdiTotal : filteredAcceptedWdiTotal,
    heatTreatmentRows: activeReport === 'heatTreatment' ? filteredVisibleRows : heatTreatmentRows,
    heatTreatmentRowCount: activeReport === 'heatTreatment' && isServerPagedTab ? weldPageQuery.totalCount : undefined,
    selectedHeatTreatmentRows,
    lnkRows: activeReport === 'lnk' ? filteredVisibleRows : lnkRows,
    lnkRowCount: activeReport === 'lnk' && isServerPagedTab ? weldPageQuery.totalCount : undefined,
    availableLnkRequestRows: activeReport === 'lnk' ? filteredAvailableLnkRequestRowsForSummary : availableLnkRequestRows,
    availableLnkRequestRowCount:
      activeReport === 'lnk' && isServerPagedTab ? weldPageQuery.availableRequestCount : undefined,
    welderStamps,
    filteredWelderStamps,
    errorMessage: (isServerPagedTab ? weldPageQuery.error : weldsQuery.error)
      ? ((isServerPagedTab ? weldPageQuery.error : weldsQuery.error) as Error).message
      : null,
    message,
    lnkNotice: activeReport === 'lnk' ? lnkNotice : null,
  })

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
  const reportChainDialogProps = createReportChainDialogProps({
    chainRecord,
    chainRows,
    errorMessage: chainRowsError,
    isLoading: isChainRowsLoading,
    onClose: () => setChainRecord(null),
    onOpenBase: openChainBaseInCurrentReport,
    onOpenRow: openChainRowInCurrentReport,
    onRetry: retryChainRows,
  })
  const allowedArchivedOfficialStampsForEditing = getArchivedOfficialStampValuesForRecord(editing?.record, welderStamps)
  const reportWeldEditorProps = createReportWeldEditorProps({
    editing,
    suggestionRows: rows.length > 0 ? rows : undefined,
    stampSelectOptions: (draft) => getWeldFormStampSelectOptions(draft, allowedArchivedOfficialStampsForEditing),
    getExternalSaveBlockReason: (draft) =>
      getOfficialStampCompatibilitySaveBlockReason(draft, welderStamps, {
        saveCheckSettings,
        suspensions: welderStampSuspensions,
      }),
    isSaving: saveMutation.isPending,
    onCancel: () => setEditing(null),
    onSave: (value) =>
      runProtectedEdit('сохранение стыка', () => {
        if (editing) saveMutation.mutate({ ...value, status: editing.record.status ?? null, id: editing.record.id })
      }),
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
            })
          })
        },
      }
    : null
  const reportPstoDialogsProps = createReportPstoDialogsProps({
    requestModalOpen: isPstoRequestModalOpen,
    request: {
      nextRequestName: nextPstoRequestName,
      selectedRows: selectedHeatTreatmentRows,
      requestNaming: pstoRequestNaming,
      requestDate: pstoRequestDate,
      requestSearch: pstoRequestSearch,
      message,
      requestManagerOptions: pstoRequestManagerOptions,
      heatTreatmentRowsCount: heatTreatmentRows.length,
      filteredRows: filteredPstoRequestRows,
      availableRowsCount: filteredAvailablePstoRequestRows.length,
      selectedIds: selectedHeatTreatmentIds,
      isPending: pstoRequestMutation.isPending,
      saveCheckSettings,
      onClose: closeCreatePstoRequestModal,
      onOpenRequestManager: openPstoRequestManager,
      onRequestNamingChange: setPstoRequestNaming,
      onRequestDateChange: setPstoRequestDate,
      onRequestSearchChange: setPstoRequestSearch,
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
      onClose: () => setIsPstoRequestManagerOpen(false),
      onChangeRequest: changeManagedPstoRequest,
      onRequestNameDraftChange: setManagedPstoRequestNameDraft,
      onRenameRequest: () => runProtectedEdit('переименование заявки ПСТО', renameManagedPstoRequest),
      onClearPosition: (row) => runProtectedDelete('очистку позиции заявки ПСТО', () => clearManagedPstoRequestPosition(row)),
      onDeleteRequest: () => runProtectedDelete('удаление заявки ПСТО', deleteManagedPstoRequest),
    },
    resultModalOpen: isPstoResultModalOpen,
    result: {
      draft: pstoResultDraft,
      requestSearch: pstoResultRequestSearch,
      nextDiagramName: nextPstoDiagramName,
      filteredRows: filteredPstoResultRows,
      filteredRequestOptions: filteredPstoResultRequestOptions,
      availableRequestOptions: pstoResultAvailableRequestOptions,
      saveBlockReason: pstoResultSaveBlockReason,
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
      onSave: () => runProtectedEdit('сохранение результата ПСТО', handleAddPstoResult),
    },
    resultManagerOpen: isPstoResultManagerOpen,
    resultManager: {
      rows: managedPstoResultRows,
      diagramDrafts: managedPstoDiagramDrafts,
      isPending: pstoResultCorrectionMutation.isPending,
      onClose: () => {
        setIsPstoResultManagerOpen(false)
        setManagedPstoDiagramDrafts({})
      },
      onDiagramDraftChange: (rowId, value) =>
        setManagedPstoDiagramDrafts((current) => ({ ...current, [rowId]: value })),
      onRenameDiagram: (row) => runProtectedEdit('переименование диаграммы ПСТО', () => renameManagedPstoDiagram(row)),
      onDeleteResult: (row) => runProtectedDelete('удаление результата ПСТО', () => deleteManagedPstoResult(row)),
    },
  })
  const reportLnkDialogsProps = createReportLnkDialogsProps({
    requestModalOpen: isLnkRequestModalOpen,
    request: {
      nextRequestName: nextLnkRequestName,
      selectedRowsCount: selectedLnkRows.length,
      selectedRows: selectedLnkRows,
      selectedTargetCount: selectedLnkRequestTargetCount,
      requestNaming: lnkRequestNaming,
      requestDate: lnkRequestDraft.requestDate,
      requestManagerOptions: lnkRequestManagerOptions,
      selectedMethodKeys: selectedLnkMethodKeys,
      selectedMethods: lnkRequestDraft.methods,
      requestSearch: lnkRequestSearch,
      message,
      lnkRowsCount: lnkRows.length,
      filteredRows: filteredLnkRequestRows,
      filteredAvailableRows: filteredAvailableLnkRequestRows,
      selectedIds: selectedLnkIds,
      isPending: lnkRequestMutation.isPending,
      saveCheckSettings,
      onClose: closeCreateLnkRequestModal,
      onOpenRequestManager: openLnkRequestManager,
      onRequestNamingChange: setLnkRequestNaming,
      onRequestDateChange: (requestDate) => setLnkRequestDraft((current) => ({ ...current, requestDate })),
      onToggleMethod: toggleLnkRequestMethod,
      onRequestSearchChange: setLnkRequestSearch,
      onToggleAllRows: toggleAllLnkRequestRows,
      onToggleRow: toggleLnkRequestRow,
      onSubmit: () => runProtectedEdit('создание заявки ЛНК', handleCreateLnkRequest),
    },
    requestManagerOpen: isLnkRequestManagerOpen,
    requestManager: {
      requestName: managedLnkRequestName,
      requestDate: managedLnkRequestDate,
      requestOptions: lnkRequestManagerOptions,
      requestRows: managedLnkRequestRows,
      requestMethods: managedLnkRequestMethods,
      requestNameDraft: managedLnkRequestNameDraft,
      isManagerPending: lnkRequestManagerMutation.isPending,
      isCorrectionPending: lnkRequestCorrectionMutation.isPending,
      onClose: closeLnkRequestManager,
      onChangeRequest: changeManagedLnkRequest,
      onRequestNameDraftChange: setManagedLnkRequestNameDraft,
      onRenameRequest: () => runProtectedEdit('переименование заявки ЛНК', renameManagedLnkRequest),
      onClearPosition: (row, methodKey) =>
        runProtectedDelete('очистку позиции заявки ЛНК', () => clearManagedLnkRequestPosition(row, methodKey)),
      onDeleteRequest: () => runProtectedDelete('удаление заявки ЛНК', deleteManagedLnkRequest),
    },
    resultManagerOpen: isLnkResultManagerOpen,
    resultManager: {
      rows: managedLnkResultRows,
      methods: managedLnkResultMethods,
      entries: managedLnkResultEntries,
      pendingEntries: managedLnkPendingResultRows,
      methodKey: managedLnkResultMethodKey,
      conclusionDrafts: managedLnkConclusionDrafts,
      pendingResultChanges: managedLnkPendingResultChanges,
      changeHint: managedLnkResultChangeHint,
      isResultCorrectionPending: lnkResultCorrectionMutation.isPending,
      isResultReplacementPending: lnkResultReplacementMutation.isPending,
      isConclusionCorrectionPending: lnkConclusionCorrectionMutation.isPending,
      onClose: closeLnkResultManager,
      onMethodChange: changeManagedLnkResultMethod,
      onConclusionDraftChange: changeManagedLnkConclusionDraft,
      onRenameConclusion: (row, methodKey) =>
        runProtectedEdit('переименование заключения ЛНК', () => renameManagedLnkConclusionForRow(row, methodKey)),
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
      onClose: closeAddLnkResultModal,
      onOpenManager: openLnkResultManager,
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
      onSave: () => runProtectedEdit('сохранение результата ЛНК', handleAddLnkResult),
    },
    selectableResultRows: selectableVisibleLnkResultRows,
    resultPreviewOpen: isLnkResultPreviewOpen,
    resultPreview: {
      rows: selectedLnkResultRows,
      draft: lnkResultDraft,
      onClose: () => setIsLnkResultPreviewOpen(false),
    },
  })

  return {
    activeReport,
    activeTitle,
    navCollapsed,
    registerMinWidth,
    stickyLeft,
    onNavCollapsedChange: setNavCollapsed,
    onReportChange: changeActiveReport,
    reportHeaderActionsProps,
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
    onOpenWeldRowIds: openWeldRowIds,
    onDocumentGenerationRequestHandled: handleDocumentGenerationRequest,
    onDocumentGenerated: setMessage,
    onOpenDocumentRows: openGeneratedDocumentRows,
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

function openDocumentPreviewWindow() {
  const previewWindow = window.open('', '_blank')
  if (!previewWindow) {
    window.alert('Браузер заблокировал открытие новой вкладки.')
    return null
  }
  previewWindow.opener = null
  previewWindow.document.title = 'Подготовка документа'
  previewWindow.document.body.textContent = 'Подготавливаем документ...'
  return previewWindow
}

function writeDocumentPreviewImportError(previewWindow: Window, reason: unknown) {
  if (previewWindow.closed) return
  previewWindow.document.title = 'Не удалось открыть документ'
  previewWindow.document.body.textContent =
    reason instanceof Error ? reason.message : 'Не удалось загрузить модуль документа.'
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
