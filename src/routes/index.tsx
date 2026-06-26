import { useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
  clearLnkGeneratedWeldData,
  createWeldJoint,
  deleteWeldJoint,
  importWeldJoints,
  listWeldJoints,
  updateWeldJoint,
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
import { useWindowEscapeKey } from '@/lib/use-window-escape-key'
import {
  FIELD_BY_KEY,
  calculateFinalStatus,
  type WeldFieldKey,
  type WeldInput,
} from '@/lib/weld-fields'
import {
  HEAT_TREATMENT_EDITABLE_FIELD_KEYS as heatTreatmentEditableFieldKeys,
  LNK_CONCLUSION_FIELD_KEYS as lnkConclusionFieldKeys,
  LNK_CUSTOM_RESULT_VALUE,
  LNK_EDITABLE_FIELD_KEYS as lnkEditableFieldKeys,
  LNK_EMPTY_RESULT_VALUE,
  LNK_GENERATED_FIELD_KEYS as lnkGeneratedFieldKeys,
  LNK_METHODS,
  LNK_REQUEST_FIELD_KEYS as lnkRequestFieldKeys,
  LNK_REPORT_FIELD_KEYS as lnkReportFieldKeys,
  LNK_RESULT_OPTIONS,
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
  getLnkMethodByResultKey,
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
  normalizeEditableImportValue,
  normalizeExistingRequestImportValue,
} from '@/lib/report-import'
import { buildEditableImportUpdates, buildHeatTreatmentImportUpdates } from '@/lib/report-import-updates'
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
import { useDispatcherTasks } from '@/lib/use-dispatcher-tasks'
import { useReportRows } from '@/lib/use-report-rows'
import { usePreparedReportRows } from '@/lib/use-prepared-report-rows'
import { useReportRequestDerivedState } from '@/lib/use-report-request-derived-state'
import { useActiveReportLayoutState } from '@/lib/use-active-report-layout-state'
import { usePstoResultDerivedState } from '@/lib/use-psto-result-derived-state'
import { useLnkResultDerivedState } from '@/lib/use-lnk-result-derived-state'
import { useManagedLnkResultDerivedState } from '@/lib/use-managed-lnk-result-derived-state'
import { useLnkOfficialityDerivedState } from '@/lib/use-lnk-officiality-derived-state'
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
  isEnabledControlValue,
} from '@/lib/report-value-utils'
import {
  canCreatePstoRequest,
  withAutoHeatTreatmentDiagram,
  withAutoHeatTreatmentDiagrams,
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
import {
  buildRepeatedJointDraft,
  buildRepeatedJointTasks,
  getJointChainRows,
} from '@/lib/repeated-joint-tasks'
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
  applyLnkFieldUpdate,
  clearDisabledLnkRequests,
  clearLnkGeneratedData,
  hasLnkGeneratedDataChanged,
  isLnkRequestAllowedForRow,
  isLnkRequestField,
  isLnkResultField,
  normalizeLnkResultValue,
  withTouchedLnkTimestamp,
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
  type LnkOfficialityDraftState,
  type LnkRequestDraftState,
  type LnkResultDraftState,
  type PstoResultDraftState,
} from '@/lib/report-draft-state'
import {
  collectRequestNames,
  formatRequestCreatedMessage,
  getRequestNameFromNaming,
  sortPstoRequestNamesNewestFirst,
} from '@/lib/report-naming'
import {
  defaultRequestNamingState,
  type RequestNamingState,
} from '@/lib/request-naming-state'
import type { ActiveReport, EditingState, HeatTreatmentFieldEditingState } from '@/lib/home-state'
import {
  validateManualJointNameForSave,
  validateManualJointNamesForImport,
  validateRequiredRootStampForSave,
  validateRequiredRootStampsForImport,
  validateWeldDatesForImport,
} from '@/lib/weld-validation'
import {
  formatOfficialStampCompatibilityIssue,
  getOfficialStampCompatibilityIssues,
  getOfficialStampCompatibilitySaveBlockReason,
  normalizeWeldingMethodsForImport,
  validateOfficialStampCompatibilityForImport,
  validateOfficialStampCompatibilityForSave,
  validateWelderStampFieldsForImport,
} from '@/lib/welder-stamp-registry'
import type { DispatcherTask, RepeatedJointTask, WeldRow } from '@/lib/dispatcher-types'

export const Route = createFileRoute('/')({
  component: Home,
})

const emptyFilters: WeldFilters = {}

function Home() {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [activeReport, setActiveReport] = useState<ActiveReport>('weldingJournal')
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({})
  const [heatTreatmentFilters, setHeatTreatmentFilters] = useState<Record<string, string>>({})
  const [lnkFilters, setLnkFilters] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<EditingState | null>(null)
  const [chainRecord, setChainRecord] = useState<WeldRow | null>(null)
  const [heatTreatmentFieldEditing, setHeatTreatmentFieldEditing] = useState<HeatTreatmentFieldEditingState | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [navCollapsed, setNavCollapsed] = useState(false)
  const {
    highlightedRowIds,
    highlightedCellKeys,
    highlightChangedRows,
    replayLatestHighlight,
  } = useReportHighlights()
  const [selectedHeatTreatmentIds, setSelectedHeatTreatmentIds] = useState<Set<number>>(new Set())
  const [selectedLnkIds, setSelectedLnkIds] = useState<Set<number>>(new Set())
  const [lnkRequestDraft, setLnkRequestDraft] = useState<LnkRequestDraftState>(() => ({ methods: new Set() }))
  const [pstoRequestNaming, setPstoRequestNaming] = useState<RequestNamingState>(defaultRequestNamingState)
  const [pstoRequestSearch, setPstoRequestSearch] = useState('')
  const [pstoResultRequestSearch, setPstoResultRequestSearch] = useState('')
  const [isPstoRequestModalOpen, setIsPstoRequestModalOpen] = useState(false)
  const [isPstoRequestManagerOpen, setIsPstoRequestManagerOpen] = useState(false)
  const [managedPstoRequestName, setManagedPstoRequestName] = useState('')
  const [managedPstoRequestNameDraft, setManagedPstoRequestNameDraft] = useState('')
  const [isPstoResultModalOpen, setIsPstoResultModalOpen] = useState(false)
  const [isPstoResultManagerOpen, setIsPstoResultManagerOpen] = useState(false)
  const [managedPstoDiagramDrafts, setManagedPstoDiagramDrafts] = useState<Record<number, string>>({})
  const [pstoResultDraft, setPstoResultDraft] = useState<PstoResultDraftState>(() => createDefaultPstoResultDraft())
  const [lnkRequestNaming, setLnkRequestNaming] = useState<RequestNamingState>(defaultRequestNamingState)
  const [isLnkRequestModalOpen, setIsLnkRequestModalOpen] = useState(false)
  const [isLnkRequestManagerOpen, setIsLnkRequestManagerOpen] = useState(false)
  const [managedLnkRequestName, setManagedLnkRequestName] = useState('')
  const [managedLnkRequestNameDraft, setManagedLnkRequestNameDraft] = useState('')
  const [isLnkResultModalOpen, setIsLnkResultModalOpen] = useState(false)
  const [isLnkResultPreviewOpen, setIsLnkResultPreviewOpen] = useState(false)
  const [shouldPinPreviewedLnkResultRows, setShouldPinPreviewedLnkResultRows] = useState(false)
  const [lnkResultDraft, setLnkResultDraft] = useState<LnkResultDraftState>(() => createDefaultLnkResultDraft())
  const [lnkResultRequestSearch, setLnkResultRequestSearch] = useState('')
  const [isLnkOfficialityModalOpen, setIsLnkOfficialityModalOpen] = useState(false)
  const [lnkOfficialityDraft, setLnkOfficialityDraft] = useState<LnkOfficialityDraftState>(() => createDefaultLnkOfficialityDraft())
  const [isLnkResultManagerOpen, setIsLnkResultManagerOpen] = useState(false)
  const [managedLnkResultRequestName, setManagedLnkResultRequestName] = useState('')
  const [managedLnkResultMethodKey, setManagedLnkResultMethodKey] = useState<WeldFieldKey | ''>('')
  const [managedLnkResultRequestSearch, setManagedLnkResultRequestSearch] = useState('')
  const [managedLnkConclusionDrafts, setManagedLnkConclusionDrafts] = useState<Record<string, string>>({})
  const [managedLnkResultOrderIds, setManagedLnkResultOrderIds] = useState<number[] | null>(null)
  const [managedLnkResultPreview, setManagedLnkResultPreview] = useState<{ changeKey: string; rowId: number; methodKey: WeldFieldKey; result: string } | null>(null)
  const [managedLnkResultChangeHint, setManagedLnkResultChangeHint] = useState<{ changeKey: string; rowId: number; methodKey: WeldFieldKey; from: string; to: string } | null>(null)
  const [managedLnkPendingResultChanges, setManagedLnkPendingResultChanges] = useState<Record<string, string>>({})
  const [lnkRequestSearch, setLnkRequestSearch] = useState('')
  const [preservedLnkOrderIds, setPreservedLnkOrderIds] = useState<number[] | null>(null)
  const [isPstoShowMenuOpen, setIsPstoShowMenuOpen] = useState(false)
  const [isLnkShowMenuOpen, setIsLnkShowMenuOpen] = useState(false)
  const [dismissedRepeatedJointTaskKeys, setDismissedRepeatedJointTaskKeys] = useState<Set<string>>(new Set())
  const [expandedRepeatedJointTaskKeys, setExpandedRepeatedJointTaskKeys] = useState<Set<string>>(new Set())
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

  const saveMutation = useMutation({
    mutationFn: async (value: WeldInput & { id?: number }) => {
      const preparedValue = value
      validateRequiredRootStampForSave(preparedValue)
      validateManualJointNameForSave(preparedValue, rows)
      validateOfficialStampCompatibilityForSave(preparedValue, welderStamps)
      const saved = preparedValue.id ? await updateWeldJoint({ data: preparedValue }) : await createWeldJoint({ data: preparedValue })
      if (!saved) throw new Error('Запись не найдена')
      return saved
    },
    onSuccess: async (saved, variables) => {
      highlightChangedRows(saved ? [saved] : [variables], variables.id && editing?.focusField ? [editing.focusField] : [])
      setEditing(null)
      setMessage('Запись сохранена')
      await invalidate(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const repeatedJointMutation = useMutation({
    mutationFn: async (task: RepeatedJointCreateTask | RepeatedJointCoilTask) => {
      const targetJoints = task.kind === 'coil' ? task.targetJoints : [task.targetJoint]
      const drafts = targetJoints.map((targetJoint) => buildRepeatedJointDraft(task.row, targetJoint))
      const savedRows = await Promise.all(drafts.map((draft) => createWeldJoint({ data: draft })))
      if (!savedRows.every(Boolean)) throw new Error('Не удалось создать повторный стык')
      return savedRows as WeldRow[]
    },
    onSuccess: async (createdRows, task) => {
      highlightChangedRows(createdRows, ['joint', 'weldDate', 'finalStatus'])
      setDismissedRepeatedJointTaskKeys((current) => new Set([...current, task.key]))
      setMessage(
        task.kind === 'coil'
          ? `Созданы стыки катушки ${task.targetJoints.join(', ')} для ${task.sourceJoint}`
          : `Создан повторный стык ${task.targetJoint} для ${task.sourceJoint}`,
      )
      await invalidate(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const obsoleteRepeatedJointMutation = useMutation({
    mutationFn: async (task: RepeatedJointDeleteTask) => {
      const result = await deleteWeldJoint({ data: { id: task.row.id } })
      if (!result) throw new Error('Запись не найдена')
      return result
    },
    onSuccess: async (_result, task) => {
      setDismissedRepeatedJointTaskKeys((current) => new Set([...current, task.key]))
      setMessage(`Удален лишний повторный стык ${task.targetJoint}`)
      await invalidate(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const renameRepeatedJointMutation = useMutation({
    mutationFn: async (task: RepeatedJointRenameTask) => {
      const updatedRecord = { ...task.row, joint: task.targetJoint }
      const saved = await updateWeldJoint({ data: updatedRecord })
      if (!saved) throw new Error('Запись не найдена')
      return saved
    },
    onSuccess: async (saved, task) => {
      highlightChangedRows(saved ? [saved] : [task.row], ['joint'])
      setDismissedRepeatedJointTaskKeys((current) => new Set([...current, task.key]))
      setMessage(`Стык ${task.currentJoint} переименован в ${task.targetJoint}`)
      await invalidate(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const result = await deleteWeldJoint({ data: { id } })
      if (!result) throw new Error('Запись не найдена')
      return result
    },
    onSuccess: async () => {
      setMessage('Запись удалена')
      await invalidate(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const importMutation = useMutation({
    mutationFn: async (records: WeldInput[]) => {
      const preparedRecords = records
      validateRequiredRootStampsForImport(preparedRecords)
      validateManualJointNamesForImport(preparedRecords)
      validateWeldDatesForImport(preparedRecords)
      normalizeWeldingMethodsForImport(preparedRecords)
      validateWelderStampFieldsForImport(preparedRecords, weldFormStampSelectOptions)
      validateOfficialStampCompatibilityForImport(preparedRecords, welderStamps)
      return importWeldJoints({ data: { records: preparedRecords } })
    },
    onSuccess: async (result) => {
      highlightChangedRows(result.rows)
      setMessage(`Добавлено записей: ${result.inserted}`)
      await invalidate(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const heatTreatmentImportMutation = useMutation({
    mutationFn: async (records: WeldInput[]) => {
      const { updatedRows, changedFieldKeys, matched, skipped } = buildHeatTreatmentImportUpdates(
        records,
        heatTreatmentRows,
        rows,
        new Set(pstoRequestOptions),
      )
      if (updatedRows.length === 0) {
        return { updated: 0, rows: [], changedFieldKeys, matched, skipped }
      }

      const savedRows = await Promise.all(updatedRows.map((record) => updateWeldJoint({ data: record })))
      if (!savedRows.every(Boolean)) throw new Error('Не удалось сохранить часть записей ПСТО')
      return {
        updated: savedRows.length,
        rows: savedRows as unknown as WeldRow[],
        changedFieldKeys,
        matched,
        skipped,
      }
    },
    onSuccess: async (result, variables) => {
      highlightChangedRows(result.rows, result.changedFieldKeys)
      setMessage(`Обновлено ПСТО: ${result.updated} из ${variables.length}; пропущено: ${result.skipped}`)
      await invalidate(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const lnkImportMutation = useMutation({
    mutationFn: async (records: WeldInput[]) => {
      const { updatedRows, changedFieldKeys, matched, skipped } = buildEditableImportUpdates({
        importedRecords: records,
        targetRows: lnkRows,
        rows,
        editableFieldKeys: lnkEditableFieldKeys,
        normalizeValue: (fieldKey, value, currentRow) => {
          if (isLnkRequestField(fieldKey)) {
            if (!isLnkRequestAllowedForRow(currentRow, fieldKey)) return { skip: true, value: null }
            return normalizeExistingRequestImportValue(value, new Set(lnkRequestOptions))
          }
          return { skip: false, value: normalizeEditableImportValue(fieldKey, value) }
        },
        transformRow: (row) => {
          const nextRow = { ...row }
          for (const method of LNK_METHODS) {
            if (hasText(nextRow[method.resultKey]) && !hasText(nextRow[method.requestKey])) {
              nextRow[method.resultKey] = null
            }
          }
          const cleanedRow = clearDisabledLnkRequests(nextRow)
          const touchedRow = withTouchedLnkTimestamp(cleanedRow)
          return { ...touchedRow, finalStatus: calculateFinalStatus(touchedRow) }
        },
      })
      if (updatedRows.length === 0) {
        return { updated: 0, rows: [], changedFieldKeys, matched, skipped }
      }

      const savedRows = await Promise.all(updatedRows.map((record) => updateWeldJoint({ data: record })))
      if (!savedRows.every(Boolean)) throw new Error('Не удалось сохранить часть записей ЛНК')
      return { updated: savedRows.length, rows: savedRows as unknown as WeldRow[], changedFieldKeys, matched, skipped }
    },
    onSuccess: async (result, variables) => {
      highlightChangedRows(result.rows, result.updated > 0 ? [...result.changedFieldKeys, 'lnkCreatedAt'] : result.changedFieldKeys)
      setMessage(`Обновлено ЛНК: ${result.updated} из ${variables.length}; пропущено: ${result.skipped}`)
      await invalidate(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const pstoRequestMutation = useMutation({
    mutationFn: async ({
      records,
      requestName,
    }: {
      records: Array<WeldInput & { id: number }>
      requestName: string
      mode?: 'create' | 'edit'
    }) => {
      const pstoUpdatedAt = new Date().toISOString()
      const updatedRecords = records.map((record) => ({ ...record, pstoRequest: requestName, pstoCreatedAt: pstoUpdatedAt }))
      const savedRows = await Promise.all(updatedRecords.map((record) => updateWeldJoint({ data: record })))
      if (!savedRows.every(Boolean)) throw new Error('Не удалось сохранить часть записей')
      return savedRows
    },
    onSuccess: async (_result, variables) => {
      highlightChangedRows(_result, ['pstoRequest', 'pstoCreatedAt'])
      setMessage(
        variables.mode === 'edit'
          ? 'Заявка ПСТО обновлена'
          : formatRequestCreatedMessage(variables.requestName, variables.records.length),
      )
      setSelectedHeatTreatmentIds(new Set())
      setPstoRequestNaming(defaultRequestNamingState)
      setPstoRequestSearch('')
      setIsPstoRequestModalOpen(false)
      await invalidate(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const pstoResultMutation = useMutation({
    mutationFn: async ({
      records,
      pstoDate,
      result,
      diagramName,
      rows,
    }: {
      records: Array<WeldInput & { id: number }>
      pstoDate: string
      result: string
      diagramName: string
      rows: Array<WeldInput & { id: number }>
    }) => {
      const shouldClearResult = result === PSTO_EMPTY_RESULT_VALUE
      if (!shouldClearResult && result !== 'проведено') throw new Error('Выберите результат ПСТО')
      if (!shouldClearResult && !pstoDate) throw new Error('Укажите дату ПСТО')
      if (!shouldClearResult && !diagramName.trim()) throw new Error('Укажите наименование диаграммы термообработки')
      if (records.some((record) => !hasText(record.pstoRequest))) throw new Error('Сначала укажите заявку ПСТО')

      const pstoUpdatedAt = new Date().toISOString()
      const proposedRowsById = new Map<number, WeldInput & { id: number }>()
      for (const record of records) {
        proposedRowsById.set(record.id, {
          ...record,
          pstoDate: shouldClearResult ? null : pstoDate,
          pstoResult: shouldClearResult ? null : 'проведено',
          heatTreatmentDiagram: shouldClearResult ? null : diagramName.trim(),
          pstoCreatedAt: pstoUpdatedAt,
        })
      }
      const recalculatedRows = withAutoHeatTreatmentDiagrams(rows.map((row) => proposedRowsById.get(row.id) ?? row))
      const updatedRecords = recalculatedRows.filter((row) => proposedRowsById.has(row.id))
      const savedRows = await Promise.all(updatedRecords.map((record) => updateWeldJoint({ data: record })))
      if (!savedRows.every(Boolean)) throw new Error('Не удалось сохранить часть записей')
      return savedRows as unknown as WeldRow[]
    },
    onSuccess: async (savedRows, variables) => {
      highlightChangedRows(savedRows, ['pstoDate', 'pstoResult', 'heatTreatmentDiagram', 'pstoCreatedAt'])
      setMessage(
        variables.result === PSTO_EMPTY_RESULT_VALUE
          ? `Результат ПСТО аннулирован для стыков: ${savedRows.length}`
          : `Результат ПСТО внесен для стыков: ${savedRows.length}`,
      )
      setIsPstoResultModalOpen(false)
      setPstoResultDraft(createDefaultPstoResultDraft())
      await invalidate(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const pstoRequestManagerMutation = useMutation({
    mutationFn: async ({
      requestName,
      nextRequestName,
      action,
    }: {
      requestName: string
      nextRequestName?: string
      action: 'rename' | 'delete'
    }) => {
      const currentName = requestName.trim()
      const renamedName = nextRequestName?.trim() ?? ''
      if (!currentName) throw new Error('Выберите заявку ПСТО')
      if (action === 'rename') {
        if (!renamedName) throw new Error('Введите новое наименование заявки')
        if (renamedName === currentName) throw new Error('Новое наименование совпадает с текущим')
        if (pstoRequestOptions.includes(renamedName)) throw new Error('Заявка с таким наименованием уже существует')
      }

      const pstoUpdatedAt = new Date().toISOString()
      const updatedRecords = heatTreatmentRows.flatMap((record) => {
        if (String(record.pstoRequest ?? '').trim() !== currentName) return []
        const nextRecord = {
          ...record,
          pstoRequest: action === 'rename' ? renamedName : null,
          pstoDate: action === 'rename' ? record.pstoDate : null,
          pstoResult: action === 'rename' ? record.pstoResult : null,
          heatTreatmentDiagram: action === 'rename' ? record.heatTreatmentDiagram : null,
          pstoCreatedAt: pstoUpdatedAt,
        } as WeldInput & { id: number }
        return [nextRecord]
      })

      if (updatedRecords.length === 0) throw new Error('Заявка ПСТО не найдена')

      const savedRows = await Promise.all(updatedRecords.map((record) => updateWeldJoint({ data: record })))
      if (!savedRows.every(Boolean)) throw new Error('Не удалось сохранить часть записей')
      return savedRows as unknown as WeldRow[]
    },
    onSuccess: async (savedRows, variables) => {
      highlightChangedRows(savedRows, ['pstoRequest', 'pstoDate', 'pstoResult', 'heatTreatmentDiagram', 'pstoCreatedAt'])
      setMessage(
        variables.action === 'rename'
          ? `Заявка ${variables.requestName} переименована в ${variables.nextRequestName}`
          : `Заявка ${variables.requestName} удалена`,
      )
      if (variables.action === 'rename' && variables.nextRequestName) {
        setManagedPstoRequestName(variables.nextRequestName)
        setManagedPstoRequestNameDraft(variables.nextRequestName)
      } else {
        setManagedPstoRequestName('')
        setManagedPstoRequestNameDraft('')
        setIsPstoRequestManagerOpen(false)
      }
      await invalidate(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const pstoRequestCorrectionMutation = useMutation({
    mutationFn: async ({ record }: { record: WeldInput & { id: number } }) => {
      const updatedRecord = {
        ...record,
        pstoRequest: null,
        pstoDate: null,
        pstoResult: null,
        heatTreatmentDiagram: null,
        pstoCreatedAt: new Date().toISOString(),
      } as WeldInput & { id: number }

      const saved = await updateWeldJoint({ data: updatedRecord })
      if (!saved) throw new Error('Запись не найдена')
      return saved as unknown as WeldRow
    },
    onSuccess: async (saved, variables) => {
      const removedRequestName = String(variables.record.pstoRequest ?? '').trim()
      highlightChangedRows(saved ? [saved] : [], ['pstoRequest', 'pstoDate', 'pstoResult', 'heatTreatmentDiagram', 'pstoCreatedAt'])
      const hasRemainingRequestPositions = heatTreatmentRows.some((row) => row.id !== variables.record.id && String(row.pstoRequest ?? '').trim() === removedRequestName)
      if (removedRequestName && !hasRemainingRequestPositions) {
        setManagedPstoRequestName('')
        setManagedPstoRequestNameDraft('')
        setMessage(`Заявка ${removedRequestName} удалена, так как в ней не осталось стыков`)
      } else {
        setMessage('Позиция заявки ПСТО удалена')
      }
      await invalidate(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const pstoResultCorrectionMutation = useMutation({
    mutationFn: async ({
      record,
      action,
      diagramName,
    }: {
      record: WeldInput & { id: number }
      action: 'renameDiagram' | 'deleteResult'
      diagramName?: string
    }) => {
      const nextDiagramName = diagramName?.trim() ?? ''
      if (action === 'renameDiagram' && !nextDiagramName) throw new Error('Укажите наименование диаграммы')
      const updatedRecord = {
        ...record,
        pstoDate: action === 'deleteResult' ? null : record.pstoDate,
        pstoResult: action === 'deleteResult' ? null : record.pstoResult,
        heatTreatmentDiagram: action === 'deleteResult' ? null : nextDiagramName,
        pstoCreatedAt: new Date().toISOString(),
      } as WeldInput & { id: number }

      const saved = await updateWeldJoint({ data: updatedRecord })
      if (!saved) throw new Error('Запись не найдена')
      return saved as unknown as WeldRow
    },
    onSuccess: async (saved, variables) => {
      highlightChangedRows(saved ? [saved] : [], ['pstoDate', 'pstoResult', 'heatTreatmentDiagram', 'pstoCreatedAt'])
      setMessage(variables.action === 'deleteResult' ? 'Результат ПСТО удален' : 'Диаграмма ПСТО переименована')
      await invalidate(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const heatTreatmentFieldMutation = useMutation({
    mutationFn: async ({
      record,
      fieldKey,
      value,
      rows,
    }: {
      record: WeldInput & { id: number }
      fieldKey: WeldFieldKey
      value: string | null
      rows: Array<WeldInput & { id: number }>
    }) => {
      const updatedRecord = withAutoHeatTreatmentDiagram({ ...record, [fieldKey]: value }, rows)
      const saved = await updateWeldJoint({ data: updatedRecord })
      if (!saved) throw new Error('Запись не найдена')
      return saved as unknown as WeldRow
    },
    onSuccess: async (saved, variables) => {
      highlightChangedRows(saved ? [saved] : [], [variables.fieldKey])
      setMessage(`${variables.fieldKey === 'pstoDate' ? 'Дата ПСТО' : 'Поле ПСТО'} обновлено`)
      setHeatTreatmentFieldEditing(null)
      await invalidate(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const lnkRequestMutation = useMutation({
    mutationFn: async ({
      records,
      methodKeys,
      requestName,
    }: {
      records: Array<WeldInput & { id: number }>
      methodKeys: WeldFieldKey[]
      requestName: string
    }) => {
      const updatedRecords = records.flatMap((record) => {
        const nextRecord = { ...record }
        let changed = false
        for (const requestKey of methodKeys) {
          const method = getLnkMethodByRequestKey(requestKey)
          if (!method) continue
          if (!isEnabledControlValue(record[method.enabledKey])) continue
          const existingRequestName = String(record[method.requestKey] ?? '').trim()
          if (existingRequestName) continue
          nextRecord[method.requestKey] = requestName
          if (!hasText(nextRecord[method.resultKey])) {
            nextRecord[method.resultKey] = 'ожидает НК'
          }
          changed = true
        }
        return changed ? [withTouchedLnkTimestamp(nextRecord)] : []
      })

      if (updatedRecords.length === 0) {
        throw new Error('Нет доступных стыков или видов контроля для новой заявки ЛНК')
      }

      const savedRows = await Promise.all(updatedRecords.map((record) => updateWeldJoint({ data: record })))
      if (!savedRows.every(Boolean)) throw new Error('Не удалось сохранить часть записей')
      return savedRows as unknown as WeldRow[]
    },
    onSuccess: async (savedRows, variables) => {
      highlightChangedRows(savedRows, [...variables.methodKeys, 'lnkCreatedAt'])
      setMessage(formatRequestCreatedMessage(variables.requestName, savedRows.length))
      setSelectedLnkIds(new Set())
      setLnkRequestDraft({ methods: new Set() })
      setLnkRequestNaming(defaultRequestNamingState)
      setIsLnkRequestModalOpen(false)
      await invalidate(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const lnkRequestCorrectionMutation = useMutation({
    mutationFn: async ({
      record,
      methodKey,
      requestName,
    }: {
      record: WeldInput & { id: number }
      methodKey: WeldFieldKey
      requestName: string | null
    }) => {
      const method = getLnkMethodByRequestKey(methodKey)
      if (!method) throw new Error('Выберите вид контроля')
      if (requestName && !isEnabledControlValue(record[method.enabledKey])) {
        throw new Error('Нельзя указать заявку ЛНК без наличия этого вида контроля')
      }

      const proposedRecord = { ...record } as WeldInput & { id: number }
      if (requestName) {
        proposedRecord[method.requestKey] = requestName
        if (!hasText(proposedRecord[method.resultKey])) {
          proposedRecord[method.resultKey] = 'ожидает НК'
        }
      } else {
        proposedRecord[method.requestKey] = null
        proposedRecord[method.resultKey] = null
        proposedRecord[method.conclusionDateKey] = null
        proposedRecord[method.conclusionKey] = null
      }

      const touchedRecord = withTouchedLnkTimestamp(proposedRecord)
      const updatedRecord = { ...touchedRecord, finalStatus: calculateFinalStatus(touchedRecord) }
      const saved = await updateWeldJoint({ data: updatedRecord })
      if (!saved) throw new Error('Запись не найдена')
      return saved as unknown as WeldRow
    },
    onSuccess: async (saved, variables) => {
      const method = getLnkMethodByRequestKey(variables.methodKey)
      const changedFieldKeys = method
        ? [method.requestKey, method.resultKey, method.conclusionDateKey, method.conclusionKey, 'lnkCreatedAt', 'finalStatus']
        : ['lnkCreatedAt', 'finalStatus']
      highlightChangedRows(saved ? [saved] : [], changedFieldKeys)
      if (!variables.requestName && method) {
        const removedRequestName = String(variables.record[method.requestKey] ?? '').trim()
        const hasRemainingRequestPositions = lnkRows.some((row) =>
          LNK_METHODS.some((candidateMethod) => {
            const isRemovedPosition = row.id === variables.record.id && candidateMethod.requestKey === method.requestKey
            return !isRemovedPosition && String(row[candidateMethod.requestKey] ?? '').trim() === removedRequestName
          }),
        )
        if (removedRequestName && !hasRemainingRequestPositions) {
          setManagedLnkRequestName('')
          setManagedLnkRequestNameDraft('')
          setMessage(`Заявка ${removedRequestName} удалена, так как в ней не осталось позиций`)
        } else {
          setMessage('Позиция заявки ЛНК удалена')
        }
      } else {
        setMessage(variables.requestName ? 'Заявка ЛНК заменена' : 'Заявка ЛНК удалена')
      }
      await invalidate(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const lnkRequestManagerMutation = useMutation({
    mutationFn: async ({
      requestName,
      nextRequestName,
      action,
    }: {
      requestName: string
      nextRequestName?: string
      action: 'rename' | 'delete'
    }) => {
      const currentName = requestName.trim()
      const renamedName = nextRequestName?.trim() ?? ''
      if (!currentName) throw new Error('Выберите заявку ЛНК')
      if (action === 'rename') {
        if (!renamedName) throw new Error('Введите новое наименование заявки')
        if (renamedName === currentName) throw new Error('Новое наименование совпадает с текущим')
        if (lnkRequestOptions.includes(renamedName)) throw new Error('Заявка с таким наименованием уже существует')
      }

      const updatedRecords = lnkRows.flatMap((record) => {
        const nextRecord = { ...record } as WeldInput & { id: number }
        let changed = false
        for (const method of LNK_METHODS) {
          if (String(record[method.requestKey] ?? '').trim() !== currentName) continue
          if (action === 'rename') {
            nextRecord[method.requestKey] = renamedName
          } else {
            nextRecord[method.requestKey] = null
            nextRecord[method.resultKey] = null
            nextRecord[method.conclusionDateKey] = null
            nextRecord[method.conclusionKey] = null
          }
          changed = true
        }
        if (!changed) return []
        const touchedRecord = withTouchedLnkTimestamp(nextRecord)
        return [{ ...touchedRecord, finalStatus: calculateFinalStatus(touchedRecord) }]
      })

      if (updatedRecords.length === 0) throw new Error('Заявка ЛНК не найдена')

      const savedRows = await Promise.all(updatedRecords.map((record) => updateWeldJoint({ data: record })))
      if (!savedRows.every(Boolean)) throw new Error('Не удалось сохранить часть записей')
      return savedRows as unknown as WeldRow[]
    },
    onSuccess: async (savedRows, variables) => {
      const requestFields = [...lnkRequestFieldKeys, 'lnkCreatedAt', 'finalStatus'] as WeldFieldKey[]
      const generatedFields =
        variables.action === 'delete'
          ? [...LNK_METHODS.flatMap((method) => [method.resultKey, method.conclusionDateKey, method.conclusionKey]), ...requestFields]
          : requestFields
      highlightChangedRows(savedRows, generatedFields)
      setMessage(
        variables.action === 'rename'
          ? `Заявка ${variables.requestName} переименована в ${variables.nextRequestName}`
          : `Заявка ${variables.requestName} удалена`,
      )
      if (variables.action === 'rename' && variables.nextRequestName) {
        setManagedLnkRequestName(variables.nextRequestName)
        setManagedLnkRequestNameDraft(variables.nextRequestName)
      } else {
        setManagedLnkRequestName('')
        setManagedLnkRequestNameDraft('')
        setIsLnkRequestManagerOpen(false)
      }
      await invalidate(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const lnkResultMutation = useMutation({
    mutationFn: async ({
      records,
      methodKey,
      controlDate,
      resultById,
      conclusionName,
    }: {
      records: Array<WeldInput & { id: number }>
      methodKey: WeldFieldKey
      controlDate: string
      resultById: Record<number, string>
      conclusionName: string
    }) => {
      const method = getLnkMethodByRequestKey(methodKey)
      if (!method) throw new Error('Выберите метод контроля')
      const results = records.map((record) => resultById[record.id] ?? '')
      const hasNonEmptyResult = results.some((result) => result !== LNK_EMPTY_RESULT_VALUE)
      if (results.some((result) => !isValidLnkResultDraftValue(result))) throw new Error('Укажите результат для каждого выбранного стыка')
      if (hasNonEmptyResult && !controlDate) throw new Error('Укажите дату контроля')
      if (hasNonEmptyResult && !conclusionName.trim()) throw new Error('Укажите наименование заключения')
      const repairForbiddenRecord = records.find((record) => resultById[record.id] === 'ремонт' && isLnkRepairForbidden(record))
      if (repairForbiddenRecord) {
        throw new Error(`Ремонт недоступен для стыка ${String(repairForbiddenRecord.joint ?? '-')}: ${getLnkRepairForbiddenReason(repairForbiddenRecord)}`)
      }

      const lnkUpdatedAt = new Date().toISOString()
      const updatedRecords = records.map((record) => {
        const result = resultById[record.id] ?? ''
        const shouldClearResult = result === LNK_EMPTY_RESULT_VALUE
        const proposedRecord = {
          ...record,
          [method.resultKey]: shouldClearResult ? null : result,
          [method.conclusionDateKey]: shouldClearResult ? null : controlDate,
          [method.conclusionKey]: shouldClearResult ? null : conclusionName.trim(),
          lnkCreatedAt: lnkUpdatedAt,
        }
        return { ...proposedRecord, finalStatus: calculateFinalStatus(proposedRecord) }
      })

      const savedRows = await Promise.all(updatedRecords.map((record) => updateWeldJoint({ data: record })))
      if (!savedRows.every(Boolean)) throw new Error('Не удалось сохранить часть записей')
      return savedRows as unknown as WeldRow[]
    },
    onSuccess: async (savedRows, variables) => {
      const method = getLnkMethodByRequestKey(variables.methodKey)
      const changedFieldKeys = method
        ? [method.resultKey, method.conclusionDateKey, method.conclusionKey, 'lnkCreatedAt', 'finalStatus']
        : ['lnkCreatedAt', 'finalStatus']
      highlightChangedRows(savedRows, changedFieldKeys)
      const changedResults = Object.values(variables.resultById)
      setMessage(
        changedResults.every((result) => result === LNK_EMPTY_RESULT_VALUE)
          ? `Результат ЛНК очищен для стыков: ${savedRows.length}`
          : `Результат ЛНК внесен для стыков: ${savedRows.length}`,
      )
      setIsLnkResultModalOpen(false)
      setLnkResultDraft(createDefaultLnkResultDraft())
      await invalidate(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const lnkOfficialityMutation = useMutation({
    mutationFn: async ({
      records,
      status,
    }: {
      records: Array<WeldInput & { id: number }>
      status: 'official' | 'unofficial'
    }) => {
      if (status === 'unofficial') {
        const invalidRecords = records.filter((record) => !hasRejectedLnkResult(record))
        if (invalidRecords.length > 0) {
          throw new Error('Неофициальный статус можно назначить только после результата контроля "ремонт" или "вырез"')
        }
      }
      const nextStatus = status === 'unofficial' ? 'неофициальный' : null
      const updatedRecords = records
        .map((record) => ({ ...record, status: nextStatus }))
        .filter((record, index) => String(records[index].status ?? '').trim() !== String(nextStatus ?? '').trim()) as Array<WeldInput & { id: number }>

      if (updatedRecords.length === 0) throw new Error('Выбранные стыки уже имеют такой статус')

      const savedRows = await Promise.all(updatedRecords.map((record) => updateWeldJoint({ data: record })))
      if (!savedRows.every(Boolean)) throw new Error('Не удалось сохранить часть записей')
      return savedRows as unknown as WeldRow[]
    },
    onSuccess: async (savedRows, variables) => {
      highlightChangedRows(savedRows, ['status'])
      setDismissedRepeatedJointTaskKeys(new Set())
      setMessage(
        variables.status === 'unofficial'
          ? `Статус "неофициальный" установлен для стыков: ${savedRows.length}`
          : `Статус "официальный" установлен для стыков: ${savedRows.length}`,
      )
      setLnkOfficialityDraft(createDefaultLnkOfficialityDraft())
      setIsLnkOfficialityModalOpen(false)
      await invalidate(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const lnkResultCorrectionMutation = useMutation({
    mutationFn: async ({
      record,
      methodKey,
      result,
    }: {
      record: WeldInput & { id: number }
      methodKey: WeldFieldKey
      result: string | null
    }) => {
      const method = getLnkMethodByRequestKey(methodKey)
      if (!method) throw new Error('Выберите метод контроля')
      if (result && !LNK_RESULT_OPTIONS.includes(result as never)) throw new Error('Укажите корректный результат')
      if (result === 'ремонт' && isLnkRepairForbidden(record)) {
        throw new Error(`Ремонт недоступен для стыка ${String(record.joint ?? '-')}: ${getLnkRepairForbiddenReason(record)}`)
      }
      const proposedRecord = {
        ...record,
        [method.resultKey]: result,
        [method.conclusionDateKey]: result ? record[method.conclusionDateKey] : null,
        [method.conclusionKey]: result ? record[method.conclusionKey] : null,
      } as WeldInput & { id: number }
      const touchedRecord = withTouchedLnkTimestamp(proposedRecord)
      const updatedRecord = { ...touchedRecord, finalStatus: calculateFinalStatus(touchedRecord) }

      const saved = await updateWeldJoint({ data: updatedRecord })
      if (!saved) throw new Error('Запись не найдена')
      return saved as unknown as WeldRow
    },
    onSuccess: async (saved, variables) => {
      const method = getLnkMethodByRequestKey(variables.methodKey)
      const changedFieldKeys = method
        ? [method.resultKey, method.conclusionDateKey, method.conclusionKey, 'lnkCreatedAt', 'finalStatus']
        : ['lnkCreatedAt', 'finalStatus']
      highlightChangedRows(saved ? [saved] : [], changedFieldKeys)
      setMessage(variables.result ? 'Результат ЛНК изменен' : 'Результат ЛНК удален')
      await invalidate(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const lnkResultReplacementMutation = useMutation({
    mutationFn: async ({
      updates,
    }: {
      updates: Array<{ record: WeldInput & { id: number }; methodKey: WeldFieldKey; result: string }>
    }) => {
      const updatedById = new Map<number, WeldInput & { id: number }>()
      for (const { record, methodKey, result } of updates) {
        const method = getLnkMethodByRequestKey(methodKey)
        if (!method) throw new Error('Выберите метод контроля')
        if (!LNK_RESULT_OPTIONS.includes(result as never)) throw new Error('Укажите корректный результат')
        if (result === 'ремонт' && isLnkRepairForbidden(record)) {
          throw new Error(`Ремонт недоступен для стыка ${String(record.joint ?? '-')}: ${getLnkRepairForbiddenReason(record)}`)
        }
        const currentRecord = updatedById.get(record.id) ?? record
        updatedById.set(record.id, {
          ...currentRecord,
          [method.resultKey]: result,
        } as WeldInput & { id: number })
      }
      const updatedRecords = [...updatedById.values()].map((record) => {
        const touchedRecord = withTouchedLnkTimestamp(record)
        return { ...touchedRecord, finalStatus: calculateFinalStatus(touchedRecord) }
      })

      const savedRows = await Promise.all(updatedRecords.map((record) => updateWeldJoint({ data: record })))
      if (!savedRows.every(Boolean)) throw new Error('Не удалось сохранить часть записей')
      return savedRows as unknown as WeldRow[]
    },
    onSuccess: async (savedRows, variables) => {
      const changedFieldKeys = [
        ...new Set(
          variables.updates
            .map(({ methodKey }) => getLnkMethodByRequestKey(methodKey)?.resultKey)
            .filter(Boolean) as WeldFieldKey[],
        ),
        'lnkCreatedAt',
        'finalStatus',
      ]
      highlightChangedRows(savedRows, changedFieldKeys)
      const savedKeys = new Set(variables.updates.map(({ record, methodKey }) => getManagedLnkResultChangeKey(record.id, methodKey)))
      setManagedLnkPendingResultChanges((current) =>
        Object.fromEntries(Object.entries(current).filter(([changeKey]) => !savedKeys.has(changeKey))),
      )
      setManagedLnkResultChangeHint(null)
      setManagedLnkResultPreview(null)
      setMessage(`Результат ЛНК изменен для стыков: ${savedRows.length}`)
      await invalidate(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const lnkConclusionCorrectionMutation = useMutation({
    mutationFn: async ({
      records,
      methodKey,
      conclusionName,
    }: {
      records: Array<WeldInput & { id: number }>
      methodKey: WeldFieldKey
      conclusionName: string
    }) => {
      const method = getLnkMethodByRequestKey(methodKey)
      const nextConclusionName = conclusionName.trim()
      if (!method) throw new Error('Выберите метод контроля')
      if (!nextConclusionName) throw new Error('Укажите наименование заключения')

      const updatedRecords = records
        .filter((record) => hasText(record[method.resultKey]))
        .map((record) => {
          const proposedRecord = {
            ...record,
            [method.conclusionKey]: nextConclusionName,
          } as WeldInput & { id: number }
          const touchedRecord = withTouchedLnkTimestamp(proposedRecord)
          return { ...touchedRecord, finalStatus: calculateFinalStatus(touchedRecord) }
        })

      if (updatedRecords.length === 0) throw new Error('Нет результатов для переименования заключения')

      const savedRows = await Promise.all(updatedRecords.map((record) => updateWeldJoint({ data: record })))
      if (!savedRows.every(Boolean)) throw new Error('Не удалось сохранить часть записей')
      return savedRows as unknown as WeldRow[]
    },
    onSuccess: async (savedRows, variables) => {
      const method = getLnkMethodByRequestKey(variables.methodKey)
      const changedFieldKeys = method ? [method.conclusionKey, 'lnkCreatedAt', 'finalStatus'] : ['lnkCreatedAt', 'finalStatus']
      highlightChangedRows(savedRows, changedFieldKeys)
      setMessage(`Заключение переименовано для позиций: ${savedRows.length}`)
      await invalidate(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const lnkFieldMutation = useMutation({
    mutationFn: async ({
      record,
      fieldKey,
      value,
    }: {
      record: WeldInput & { id: number }
      fieldKey: WeldFieldKey
      value: string | null
    }) => {
      const method = getLnkMethodByResultKey(fieldKey)
      if (method && value && !hasText(record[method.requestKey])) {
        throw new Error('Сначала создайте заявку ЛНК для этого вида контроля')
      }
      const requestMethod = getLnkMethodByRequestKey(fieldKey)
      if (requestMethod && value && !isEnabledControlValue(record[requestMethod.enabledKey])) {
        throw new Error('Нельзя указать заявку ЛНК без наличия этого вида контроля')
      }
      if (isLnkRequestField(fieldKey) && value && !lnkRequestOptions.includes(value)) {
        throw new Error('Можно выбрать только существующую заявку ЛНК или очистить поле')
      }

      const proposedRecord = clearDisabledLnkRequests(withTouchedLnkTimestamp(applyLnkFieldUpdate(record, fieldKey, value)))
      const updatedRecord = { ...proposedRecord, finalStatus: calculateFinalStatus(proposedRecord) }
      const saved = await updateWeldJoint({ data: updatedRecord })
      if (!saved) throw new Error('Запись не найдена')
      return saved as unknown as WeldRow
    },
    onSuccess: async (saved, variables) => {
      highlightChangedRows(saved ? [saved] : [], [variables.fieldKey, 'lnkCreatedAt', 'finalStatus'])
      setMessage('Поле ЛНК обновлено')
      setHeatTreatmentFieldEditing(null)
      await invalidate(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const clearLnkGeneratedDataMutation = useMutation({
    mutationFn: async (targetRows: WeldRow[]) => {
      const updatedRows = targetRows.flatMap((row) => {
        const cleanedRow = clearLnkGeneratedData(row)
        return hasLnkGeneratedDataChanged(row, cleanedRow) ? [{ ...cleanedRow, finalStatus: calculateFinalStatus(cleanedRow) }] : []
      })
      if (updatedRows.length === 0) return []

      const savedRows = await clearLnkGeneratedWeldData()
      if (!Array.isArray(savedRows)) throw new Error('Не удалось очистить данные ЛНК')
      return savedRows as unknown as WeldRow[]
    },
    onSuccess: async (savedRows) => {
      highlightChangedRows(savedRows, [...lnkGeneratedFieldKeys, 'finalStatus'])
      setSelectedLnkIds(new Set())
      setLnkResultDraft(createDefaultLnkResultDraft())
      setMessage(savedRows.length > 0 ? `Очищены результаты и заключения ЛНК: ${savedRows.length} строк` : 'В ЛНК нечего очищать')
      await invalidate(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
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
  const chainRows = useMemo(() => (chainRecord ? getJointChainRows(rows, chainRecord) : []), [chainRecord, rows])
  useWindowEscapeKey(Boolean(chainRecord), (event) => {
    event.preventDefault()
    event.stopImmediatePropagation()
    setChainRecord(null)
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

  function handleCreatePstoRequest() {
    if (selectedHeatTreatmentRows.length === 0) {
      setMessage('Выберите один или несколько стыков для заявки ПСТО')
      return
    }

    const requestName = getRequestNameFromNaming(pstoRequestNaming, nextPstoRequestName)
    if (!requestName) {
      setMessage('Укажите пользовательское наименование заявки ПСТО')
      return
    }

    pstoRequestMutation.mutate({ records: selectedHeatTreatmentRows, requestName, mode: 'create' })
  }

  function openCreatePstoRequestModal() {
    setSelectedHeatTreatmentIds(new Set())
    setPstoRequestNaming(defaultRequestNamingState)
    setPstoRequestSearch('')
    setIsPstoRequestModalOpen(true)
  }

  function openCreatePstoRequestModalForRow(row: WeldInput & { id: number }) {
    if (!canCreatePstoRequest(row)) {
      setMessage('Заявка ПСТО для этого стыка уже создана')
      return
    }

    setSelectedHeatTreatmentIds(new Set([row.id]))
    setPstoRequestNaming(defaultRequestNamingState)
    setPstoRequestSearch(String(row.joint ?? row.line ?? ''))
    setIsPstoRequestModalOpen(true)
  }

  function closeCreatePstoRequestModal() {
    if (pstoRequestMutation.isPending) return
    setIsPstoRequestModalOpen(false)
  }

  function openPstoRequestManager() {
    const requestName = managedPstoRequestName || pstoRequestManagerOptions[0] || ''
    setManagedPstoRequestName(requestName)
    setManagedPstoRequestNameDraft(requestName)
    setIsPstoRequestManagerOpen(true)
  }

  function changeManagedPstoRequest(requestName: string) {
    setManagedPstoRequestName(requestName)
    setManagedPstoRequestNameDraft(requestName)
  }

  function renameManagedPstoRequest() {
    pstoRequestManagerMutation.mutate({
      action: 'rename',
      requestName: managedPstoRequestName,
      nextRequestName: managedPstoRequestNameDraft,
    })
  }

  function deleteManagedPstoRequest() {
    const requestName = managedPstoRequestName.trim()
    if (!requestName) return
    if (!confirm(`Удалить заявку ${requestName} и все связанные результаты ПСТО?`)) return
    pstoRequestManagerMutation.mutate({ action: 'delete', requestName })
  }

  function clearManagedPstoRequestPosition(record: WeldInput & { id: number }) {
    const requestName = String(record.pstoRequest ?? '').trim()
    if (!requestName) return
    if (!confirm(`Очистить заявку ${requestName} только для стыка ${String(record.joint ?? '-')}?`)) return
    pstoRequestCorrectionMutation.mutate({ record })
  }

  function submitCreatePstoRequest() {
    const requestName = getRequestNameFromNaming(pstoRequestNaming, nextPstoRequestName)
    if (!requestName) {
      setMessage('Укажите пользовательское наименование заявки ПСТО')
      return
    }
    pstoRequestMutation.mutate({ records: selectedHeatTreatmentRows, requestName, mode: 'create' })
  }

  function openAddPstoResultModal() {
    setPstoResultRequestSearch('')
    setPstoResultDraft(createDefaultPstoResultDraft())
    setIsPstoResultModalOpen(true)
  }

  function openAddPstoResultModalForRow(row: WeldInput & { id: number }) {
    const requestName = String(row.pstoRequest ?? '').trim()
    if (!requestName) {
      setMessage('Сначала создайте заявку ПСТО для этого стыка')
      return
    }

    setPstoResultDraft({
      ...createDefaultPstoResultDraft(),
      requestName,
      rowIds: new Set([row.id]),
      search: String(row.joint ?? row.line ?? ''),
    })
    setPstoResultRequestSearch(requestName)
    setIsPstoResultModalOpen(true)
  }

  function closeAddPstoResultModal() {
    if (pstoResultMutation.isPending) return
    setPstoResultRequestSearch('')
    setIsPstoResultModalOpen(false)
  }

  function openPstoResultManager() {
    const selectedRows = heatTreatmentRows.filter((row) => pstoResultDraft.rowIds.has(row.id))
    if (selectedRows.length === 0) {
      setMessage('Выберите один или несколько стыков для редактирования результатов ПСТО')
      return
    }
    setManagedPstoDiagramDrafts(
      Object.fromEntries(
        selectedRows
          .filter((row) => hasText(row.pstoResult) || hasText(row.heatTreatmentDiagram) || hasText(row.pstoDate))
          .map((row) => [row.id, String(row.heatTreatmentDiagram ?? '').trim()]),
      ),
    )
    setIsPstoResultManagerOpen(true)
  }

  function renameManagedPstoDiagram(row: WeldInput & { id: number }) {
    pstoResultCorrectionMutation.mutate({
      record: row,
      action: 'renameDiagram',
      diagramName: managedPstoDiagramDrafts[row.id] ?? '',
    })
  }

  function deleteManagedPstoResult(row: WeldInput & { id: number }) {
    if (!confirm(`Удалить результат ПСТО для стыка ${String(row.joint ?? '-')}?`)) return
    pstoResultCorrectionMutation.mutate({ record: row, action: 'deleteResult' })
  }

  function changePstoResultRequest(requestName: string) {
    setPstoResultDraft((current) => {
      if (!requestName) return { ...current, requestName: '' }
      const rowIds = new Set(
        [...current.rowIds].filter((id) => {
          const row = heatTreatmentRows.find((candidate) => candidate.id === id)
          return row ? rowBelongsToPstoRequest(row, requestName) : false
        }),
      )
      return { ...current, requestName, rowIds }
    })
  }

  function togglePstoResultRow(rowId: number) {
    const row = filteredPstoResultRows.find((candidate) => candidate.id === rowId)
    if (!row || !canSelectPstoResultRow(row, pstoResultDraft.requestName)) return

    setPstoResultDraft((current) => {
      const rowIds = new Set(current.rowIds)
      if (rowIds.has(rowId)) {
        rowIds.delete(rowId)
      } else {
        rowIds.add(rowId)
      }
      const selectedRows = heatTreatmentRows.filter((candidate) => rowIds.has(candidate.id))
      const requestOptions = sortPstoRequestNamesNewestFirst(collectRequestNames(selectedRows, ['pstoRequest']))
      const requestName =
        current.requestName && requestOptions.includes(current.requestName)
          ? current.requestName
          : requestOptions.length === 1
            ? requestOptions[0]
            : ''
      return { ...current, requestName, rowIds }
    })
  }

  function toggleAllPstoResultRows() {
    setPstoResultDraft((current) => {
      const filteredIds = new Set(
        filteredPstoResultRows.filter((row) => canSelectPstoResultRow(row, current.requestName)).map((row) => row.id),
      )
      if (filteredIds.size === 0) return current
      const allSelected = [...filteredIds].every((id) => current.rowIds.has(id))
      const rowIds = allSelected
        ? new Set([...current.rowIds].filter((id) => !filteredIds.has(id)))
        : new Set([...current.rowIds, ...filteredIds])
      const selectedRows = heatTreatmentRows.filter((row) => rowIds.has(row.id))
      const requestOptions = sortPstoRequestNamesNewestFirst(collectRequestNames(selectedRows, ['pstoRequest']))
      const requestName =
        current.requestName && requestOptions.includes(current.requestName)
          ? current.requestName
          : requestOptions.length === 1
            ? requestOptions[0]
            : ''
      return { ...current, requestName, rowIds }
    })
  }

  function togglePstoRequestRow(rowId: number) {
    setSelectedHeatTreatmentIds((current) => toggleNumberSetValue(current, rowId))
  }

  function toggleAllPstoRequestRows() {
    setSelectedHeatTreatmentIds((current) => toggleNumberSetValues(current, filteredAvailablePstoRequestRows.map((row) => row.id)))
  }

  function handleAddPstoResult() {
    if (pstoResultSaveBlockReason) {
      setMessage(pstoResultSaveBlockReason)
      return
    }
    if (!pstoResultDraft.requestName) {
      setMessage('Выберите заявку ПСТО')
      return
    }
    if (selectedPstoResultRows.length === 0) {
      setMessage('Выберите один или несколько стыков')
      return
    }
    if (pstoResultDraft.result !== PSTO_EMPTY_RESULT_VALUE && pstoResultDraft.result !== 'проведено') {
      setMessage('Выберите результат ПСТО')
      return
    }
    if (pstoResultDraft.result !== PSTO_EMPTY_RESULT_VALUE && !pstoResultDraft.pstoDate) {
      setMessage('Укажите дату ПСТО')
      return
    }
    const diagramName =
      pstoResultDraft.result === PSTO_EMPTY_RESULT_VALUE
        ? ''
        : getRequestNameFromNaming(pstoResultDraft.diagramNaming, nextPstoDiagramName)
    if (pstoResultDraft.result !== PSTO_EMPTY_RESULT_VALUE && !diagramName) {
      setMessage('Укажите наименование диаграммы термообработки')
      return
    }

    pstoResultMutation.mutate({
      records: selectedPstoResultRows,
      pstoDate: pstoResultDraft.pstoDate,
      result: pstoResultDraft.result,
      diagramName,
      rows,
    })
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

  function dismissRepeatedJointTask(task: RepeatedJointTask) {
    setDismissedRepeatedJointTaskKeys((current) => new Set([...current, task.key]))
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

  function isRepeatedJointTaskExpanded(task: DispatcherTask) {
    return expandedRepeatedJointTaskKeys.has(task.key)
  }

  function toggleRepeatedJointTaskDetails(task: DispatcherTask) {
    setExpandedRepeatedJointTaskKeys((current) => {
      const next = new Set(current)
      if (next.has(task.key)) {
        next.delete(task.key)
      } else {
        next.add(task.key)
      }
      return next
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
            onDismissTasks={(tasks) =>
              setDismissedRepeatedJointTaskKeys((current) => new Set([...current, ...tasks.map((task) => task.key)]))
            }
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


async function invalidate(queryClient: ReturnType<typeof useQueryClient>) {
  await queryClient.invalidateQueries({ queryKey: ['weld-joints'] })
}
