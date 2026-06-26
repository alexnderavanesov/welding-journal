import { useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, ClipboardCheck, ExternalLink, FileSpreadsheet, Flame, NotebookTabs, PanelLeftClose, PanelLeftOpen, Pencil, Plus, ShieldCheck, Stamp, Trash2, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import {
  JointProjectSubtitleMeta,
  JointSpoolDiameterMeta,
  JointWeldDateMeta,
  MetaSeparator,
  OfficialityBadge,
} from '@/components/joint-meta'
import { RequestNamingControls } from '@/components/request-naming-controls'
import { WelderStampsRegistry } from '@/components/welder-stamps-registry'
import { WeldForm } from '@/components/weld-form'
import { WeldTable } from '@/components/weld-table'
import { DispatcherTaskPanel, WelderStampNotificationPanel } from '@/components/dispatcher-panels'
import {
  clearLnkGeneratedWeldData,
  createWeldJoint,
  deleteWeldJoint,
  importWeldJoints,
  listWeldJoints,
  updateWeldJoint,
  type WeldFilters,
} from '@/server/welds'
import { listWelderStampRecords, saveWelderStampRecords } from '@/server/welder-stamps'
import {
  buildExportXlsxBytes,
  isMeaningfulRecord,
  normalizeWeldInput,
  parseEditableCsv,
  parseEditableWorkbook,
  parseCsv,
  parseWorkbook,
  withAutoVikForWeldDate,
} from '@/lib/weld-import-export'
import { getWeldTableWidth } from '@/lib/weld-column-widths'
import {
  FIELD_BY_KEY,
  RESULT_STATUS_OPTIONS,
  VISIBLE_FIELDS,
  calculateFinalStatus,
  type WeldFieldKey,
  type WeldInput,
} from '@/lib/weld-fields'
import {
  HEAT_TREATMENT_EDITABLE_FIELD_KEYS as heatTreatmentEditableFieldKeys,
  HEAT_TREATMENT_HIDDEN_FIELD_KEYS as heatTreatmentHiddenFieldKeys,
  HEAT_TREATMENT_IMPORT_MATCH_FIELD_KEYS as heatTreatmentImportMatchFieldKeys,
  HIGHLIGHT_DURATION_MS as highlightDurationMs,
  LNK_CONCLUSION_FIELD_KEYS as lnkConclusionFieldKeys,
  LNK_CONCLUSIONS_FIELDS,
  LNK_CUSTOM_RESULT_VALUE,
  LNK_EDITABLE_FIELD_KEYS as lnkEditableFieldKeys,
  LNK_EMPTY_RESULT_VALUE,
  LNK_GENERATED_FIELD_KEYS as lnkGeneratedFieldKeys,
  LNK_HIDDEN_FIELD_KEYS as lnkHiddenFieldKeys,
  LNK_IMPORT_MATCH_FIELD_KEYS as lnkImportMatchFieldKeys,
  LNK_METHODS,
  LNK_REQUEST_FIELD_KEYS as lnkRequestFieldKeys,
  LNK_REPORT_FIELD_KEYS as lnkReportFieldKeys,
  LNK_RESULT_OPTIONS,
  LNK_WAITING_NK_FIELDS,
  PSTO_EMPTY_RESULT_VALUE,
  PSTO_RESULTS_FIELDS,
  PSTO_WAITING_REQUEST_FIELDS,
  REPAIR_FORBIDDEN_BY_DIAMETER_REASON,
  REPEATED_JOINT_CLEARED_FIELD_KEYS as repeatedJointClearedFieldKeys,
  REQUEST_AND_RESULT_FIELD_KEYS as requestAndResultFieldKeys,
  UNOFFICIAL_REJECTED_WITH_COIL_REASON,
  WELD_STAMP_COMPLETION_GROUPS,
  WELDING_JOURNAL_BLOCKED_FIELD_KEYS as weldingJournalBlockedFieldKeys,
  WELDING_JOURNAL_HIDDEN_FIELD_KEYS as weldingJournalHiddenFieldKeys,
} from '@/lib/report-config'
import {
  getInactiveLnkRequestBadgeClass,
  getLnkResultBadgeClass,
  getPstoResultBadgeClass,
  getPstoResultLabel,
} from '@/lib/report-badges'
import {
  formatLnkResultSummaryItems,
  getJointChainResultItems,
  getJointStatusBadgeClass,
  getJointStatusLabel,
  getLnkDisplayValue,
  getAvailableLnkRequestMethods,
  getLnkMethodByRequestKey,
  getLnkMethodByResultKey,
  getLnkRequestMethodBadgeClass,
  hasAnyEnabledLnkControl,
  hasAnyLnkRequest,
  hasPendingLnkRequestResult,
  hasRejectedLnkResult,
  isFinalLnkResultValue,
  isLnkMethodNoNeed,
} from '@/lib/lnk-status'
import {
  buildLnkConclusionsRows,
  buildLnkToRequestRows,
  buildLnkWaitingNkRows,
} from '@/lib/lnk-report-rows'
import {
  canCreateLnkRequest,
  hasAnyLnkReportControl,
  hasHeatTreatmentReportState,
  toControlCancellationReportRow,
  toHeatTreatmentReportRow,
  toLnkReportRow,
  withOfficialJointStatus,
  withPendingLnkResults,
} from '@/lib/report-control-state'
import { formatWdiTotal, getReportExportFields, getReportReadOnlyFieldKeys } from '@/lib/report-export'
import {
  normalizeEditableImportValue,
  normalizeExistingRequestImportValue,
} from '@/lib/report-import'
import { buildEditableImportUpdates, buildHeatTreatmentImportUpdates } from '@/lib/report-import-updates'
import { downloadExcelBytes, openTabularReportWindow } from '@/lib/report-window'
import {
  compactSearchText,
  compareHeatTreatmentReportRows,
  compareLnkReportRows,
  compareReportRows,
  filterPstoResultRows,
  normalizeSearchText,
  sortRowsByPreservedOrder,
  sumAcceptedWdi,
} from '@/lib/report-row-utils'
import {
  expandHighlightFieldKeys,
  getCellKey,
  getJointTitle,
} from '@/lib/report-ui-state'
import {
  hasText,
  hasWeldDate,
  isEnabledControlValue,
} from '@/lib/report-value-utils'
import {
  buildPstoResultsRows,
  buildPstoWaitingRequestRows,
  canCreatePstoRequest,
  normalizeRowPstoRequest,
  withAutoHeatTreatmentDiagram,
  withAutoHeatTreatmentDiagrams,
  withPstoCreatedAt,
} from '@/lib/psto-status'
import {
  canSelectLnkResultRow,
  canSelectPstoResultRow,
  countLnkRequestTargets,
  filterLnkOfficialityRows,
  filterLnkRequestRows,
  filterLnkResultRows,
  filterLnkRowsByRequestName,
  filterPstoRequestRows,
  filterPstoRowsByRequestName,
  getLnkInputMethodsForRows,
  getLnkRequestMethodsForRows,
  getLnkResultMethodsForRows,
  getLnkRowRequestMethods,
  getLnkRowRequestNames,
  isEveryFilteredLnkRequestRowSelected,
  isLnkResultRowApplicable,
  rowBelongsToLnkRequest,
  rowBelongsToPstoRequest,
  sortLnkRequestRows,
  sortPstoRequestRows,
} from '@/lib/report-modal-rows'
import { buildDispatcherTaskGroups, getVisibleDispatcherTaskKeys } from '@/lib/dispatcher-view'
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
  getJointChainConsistencyKey,
  getJointChainRows,
} from '@/lib/repeated-joint-tasks'
import {
  formatDateInputValue,
  formatDisplayDate,
  formatLongDate,
} from '@/lib/date-format'
import {
  findFirstDateBeforeWeldDateIssue,
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
  getJointChainSubtitle,
  isUnofficialJoint,
} from '@/lib/joint-display'
import {
  getLnkRepairForbiddenReason,
  getLnkResultRepairForbiddenSummary,
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
  areLnkResultDraftRowsReady,
  buildLnkResultDraftById,
  filterLnkResultDraftRowResults,
  findFirstLnkResultDateBeforeWeldDateIssue,
  getEffectiveLnkResultDraftValueForRow,
  getManagedLnkResultChangeKey,
  hasNonEmptyLnkResultDraftRows,
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
  collectLnkResultRequestNames,
  collectRequestNames,
  formatRequestCreatedMessage,
  formatLnkConclusionName,
  formatLnkRequestName,
  formatPstoDiagramName,
  formatPstoRequestName,
  getRequestNameFromNaming,
  sortLnkRequestNamesNewestFirst,
  sortPstoRequestNamesNewestFirst,
  withCurrentOption,
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
  buildWeldFormStampSelectOptions,
  buildWelderStampExpiryTasks,
  createEmptyWelderStampDraft,
  createEmptyWelderStampFilters,
  filterWelderStampRecords,
  formatOfficialStampCompatibilityIssue,
  getOfficialStampCompatibilityIssues,
  getOfficialStampCompatibilitySaveBlockReason,
  isValidNaksStamp,
  normalizeNaksStamp,
  normalizeWelderStampRecord,
  normalizeWeldingMethodsForImport,
  validateOfficialStampCompatibilityForImport,
  validateOfficialStampCompatibilityForSave,
  validateWelderStampFieldsForImport,
  validateWelderStampRecord,
} from '@/lib/welder-stamp-registry'
import type { DispatcherTask, RepeatedJointTask, WeldRow } from '@/lib/dispatcher-types'
import type { WelderStampFilters, WelderStampRecord } from '@/lib/welder-stamp-types'

export const Route = createFileRoute('/')({
  component: Home,
})

const emptyFilters: WeldFilters = {}

function Home() {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const importHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestHighlightRef = useRef<{
    rows: Array<{ id?: number }>
    fieldKeys: WeldFieldKey[]
    createdAt: number
  } | null>(null)
  const previousReportRef = useRef<ActiveReport>('weldingJournal')
  const [activeReport, setActiveReport] = useState<ActiveReport>('weldingJournal')
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({})
  const [heatTreatmentFilters, setHeatTreatmentFilters] = useState<Record<string, string>>({})
  const [lnkFilters, setLnkFilters] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<EditingState | null>(null)
  const [chainRecord, setChainRecord] = useState<WeldRow | null>(null)
  const [heatTreatmentFieldEditing, setHeatTreatmentFieldEditing] = useState<HeatTreatmentFieldEditingState | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [navCollapsed, setNavCollapsed] = useState(false)
  const [highlightedRowIds, setHighlightedRowIds] = useState<Set<number>>(new Set())
  const [highlightedCellKeys, setHighlightedCellKeys] = useState<Set<string>>(new Set())
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
  const [welderStamps, setWelderStamps] = useState<WelderStampRecord[]>([])
  const [welderStampDraft, setWelderStampDraft] = useState<WelderStampRecord>(() => createEmptyWelderStampDraft())
  const [editingWelderStampId, setEditingWelderStampId] = useState<number | null>(null)
  const [welderStampSearch, setWelderStampSearch] = useState('')
  const [welderStampFilters, setWelderStampFilters] = useState<WelderStampFilters>(() => createEmptyWelderStampFilters())
  const [showArchivedWelderStamps, setShowArchivedWelderStamps] = useState(false)
  const welderStampsQuery = useQuery({
    queryKey: ['welder-stamps'],
    queryFn: async () => listWelderStampRecords(),
  })
  const welderStampsMutation = useMutation({
    mutationFn: async (records: WelderStampRecord[]) => saveWelderStampRecords({ data: { records } }),
    onSuccess: async (records) => {
      setWelderStamps(records)
      await queryClient.invalidateQueries({ queryKey: ['welder-stamps'] })
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })
  const weldFormStampSelectOptions = useMemo(() => buildWeldFormStampSelectOptions(welderStamps), [welderStamps])
  const getWeldFormStampSelectOptions = useMemo(
    () => (draft: WeldInput) => buildWeldFormStampSelectOptions(welderStamps, draft),
    [welderStamps],
  )
  const isReportModalOpen =
    isPstoRequestModalOpen ||
    isPstoRequestManagerOpen ||
    isPstoResultModalOpen ||
    isPstoResultManagerOpen ||
    isLnkRequestModalOpen ||
    isLnkRequestManagerOpen ||
    isLnkResultModalOpen ||
    isLnkResultPreviewOpen ||
    isLnkResultManagerOpen ||
    isLnkOfficialityModalOpen

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || editing || isReportModalOpen || chainRecord) return
      if (activeReport === 'heatTreatment') {
        setHeatTreatmentFilters({})
      } else if (activeReport === 'lnk') {
        setLnkFilters({})
      } else {
        setColumnFilters({})
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeReport, chainRecord, editing, isReportModalOpen])

  useEffect(() => {
    if (welderStampsQuery.data) {
      setWelderStamps(welderStampsQuery.data)
    }
  }, [welderStampsQuery.data])

  useEffect(() => {
    function handleHorizontalScroll() {
      if (window.scrollX > 8) {
        setNavCollapsed(true)
      }
    }

    window.addEventListener('scroll', handleHorizontalScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleHorizontalScroll)
  }, [])

  useEffect(() => {
    return () => {
      if (importHighlightTimerRef.current) {
        clearTimeout(importHighlightTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    let frameId: number | null = null
    if (previousReportRef.current !== activeReport) {
      previousReportRef.current = activeReport
      frameId = window.requestAnimationFrame(() => {
        window.scrollTo({ left: 0, top: 0, behavior: 'auto' })
      })
      replayLatestHighlight()
    }

    if (activeReport !== 'heatTreatment') {
      setSelectedHeatTreatmentIds(new Set())
      setHeatTreatmentFieldEditing(null)
      setPstoRequestNaming(defaultRequestNamingState)
      setPstoRequestSearch('')
      setPstoResultRequestSearch('')
      setIsPstoRequestModalOpen(false)
      setIsPstoRequestManagerOpen(false)
      setManagedPstoRequestName('')
      setManagedPstoRequestNameDraft('')
      setIsPstoResultModalOpen(false)
      setIsPstoResultManagerOpen(false)
      setManagedPstoDiagramDrafts({})
      setPstoResultDraft(createDefaultPstoResultDraft())
      setIsPstoShowMenuOpen(false)
    }
    if (activeReport !== 'lnk') {
      setSelectedLnkIds(new Set())
      setLnkRequestDraft({ methods: new Set() })
      setLnkRequestNaming(defaultRequestNamingState)
      setIsLnkRequestModalOpen(false)
      setIsLnkResultModalOpen(false)
      setIsLnkResultPreviewOpen(false)
      setShouldPinPreviewedLnkResultRows(false)
      setLnkResultDraft(createDefaultLnkResultDraft())
      setLnkRequestSearch('')
      setPreservedLnkOrderIds(null)
    }
    if (activeReport !== 'welderStamps') {
      setWelderStampDraft(createEmptyWelderStampDraft())
      setEditingWelderStampId(null)
      setWelderStampSearch('')
    }

    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId)
    }
  }, [activeReport])

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

  const rows = useMemo(
    () =>
      (weldsQuery.data ?? []).map((row): WeldRow => {
        const normalizedRow = clearDisabledLnkRequests(withAutoVikForWeldDate(normalizeRowPstoRequest(row as WeldRow)))
        const withTimestamps = withPstoCreatedAt([normalizedRow])[0]
        const withPendingLnk = withPendingLnkResults(withTimestamps)
        const withCancellationState = toControlCancellationReportRow(withPendingLnk)
        return { ...withCancellationState, finalStatus: calculateFinalStatus(withCancellationState) }
      }),
    [weldsQuery.data],
  )

  const repeatedJointTasks = useMemo(
    () => buildRepeatedJointTasks(rows, welderStamps).filter((task) => !dismissedRepeatedJointTaskKeys.has(task.key)),
    [dismissedRepeatedJointTaskKeys, rows, welderStamps],
  )
  const welderStampExpiryTasks = useMemo(
    () => buildWelderStampExpiryTasks(welderStamps).filter((task) => !dismissedRepeatedJointTaskKeys.has(task.key)),
    [dismissedRepeatedJointTaskKeys, welderStamps],
  )
  const { repeatedJointTaskGroups, welderStampNotificationGroups } = useMemo(
    () =>
      buildDispatcherTaskGroups({
        repeatedJointTasks,
        welderStampExpiryTasks,
        getJointChainConsistencyKey,
      }),
    [repeatedJointTasks, welderStampExpiryTasks],
  )
  useEffect(() => {
    const visibleKeys = getVisibleDispatcherTaskKeys(activeReport, repeatedJointTasks, welderStampExpiryTasks)
    setExpandedRepeatedJointTaskKeys((current) => {
      const next = new Set([...current].filter((key) => visibleKeys.has(key)))
      return next.size === current.size ? current : next
    })
  }, [activeReport, repeatedJointTasks, welderStampExpiryTasks])

  const weldedRows = useMemo(() => rows.filter(hasWeldDate), [rows])
  const heatTreatmentRows = useMemo(
    () => weldedRows.filter(hasHeatTreatmentReportState).map(toHeatTreatmentReportRow).sort(compareHeatTreatmentReportRows),
    [weldedRows],
  )
  const availablePstoRequestRows = useMemo(() => heatTreatmentRows.filter(canCreatePstoRequest), [heatTreatmentRows])
  const filteredPstoRequestRows = useMemo(
    () => filterPstoRequestRows(heatTreatmentRows, pstoRequestSearch),
    [heatTreatmentRows, pstoRequestSearch],
  )
  const filteredAvailablePstoRequestRows = useMemo(
    () => filteredPstoRequestRows.filter(canCreatePstoRequest),
    [filteredPstoRequestRows],
  )
  const lnkRows = useMemo(() => {
    const sortedRows = weldedRows.filter(hasAnyLnkReportControl).map(toLnkReportRow).sort(compareLnkReportRows)
    return preservedLnkOrderIds ? sortRowsByPreservedOrder(sortedRows, preservedLnkOrderIds) : sortedRows
  }, [preservedLnkOrderIds, weldedRows])
  const availableLnkRequestRows = useMemo(() => lnkRows.filter(canCreateLnkRequest), [lnkRows])
  const filteredLnkRequestRows = useMemo(
    () => filterLnkRequestRows(lnkRows, lnkRequestSearch),
    [lnkRequestSearch, lnkRows],
  )
  const filteredAvailableLnkRequestRows = useMemo(
    () => filteredLnkRequestRows.filter(canCreateLnkRequest),
    [filteredLnkRequestRows],
  )
  const filteredWelderStamps = useMemo(
    () => filterWelderStampRecords(welderStamps, welderStampSearch, welderStampFilters),
    [welderStampFilters, welderStampSearch, welderStamps],
  )
  const activeWelderStamps = useMemo(() => filteredWelderStamps.filter((record) => !record.archived), [filteredWelderStamps])
  const archivedWelderStamps = useMemo(() => filteredWelderStamps.filter((record) => record.archived), [filteredWelderStamps])
  const visibleRows = activeReport === 'heatTreatment' ? heatTreatmentRows : activeReport === 'lnk' ? lnkRows : rows
  const chainRows = useMemo(() => (chainRecord ? getJointChainRows(rows, chainRecord) : []), [chainRecord, rows])
  useEffect(() => {
    if (!chainRecord) return

    function handleChainKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        setChainRecord(null)
      }
    }

    window.addEventListener('keydown', handleChainKeyDown)
    return () => window.removeEventListener('keydown', handleChainKeyDown)
  }, [chainRecord])
  const selectedHeatTreatmentRows = useMemo(
    () => availablePstoRequestRows.filter((row) => selectedHeatTreatmentIds.has(row.id)),
    [availablePstoRequestRows, selectedHeatTreatmentIds],
  )
  const selectedLnkRows = useMemo(
    () => availableLnkRequestRows.filter((row) => selectedLnkIds.has(row.id)),
    [availableLnkRequestRows, selectedLnkIds],
  )
  const selectedLnkMethodKeys = useMemo(() => [...lnkRequestDraft.methods], [lnkRequestDraft.methods])
  const selectedLnkRequestTargetCount = useMemo(
    () => countLnkRequestTargets(selectedLnkRows, selectedLnkMethodKeys),
    [selectedLnkMethodKeys, selectedLnkRows],
  )
  const nextPstoRequestName = useMemo(() => formatPstoRequestName(heatTreatmentRows), [heatTreatmentRows])
  const nextLnkRequestName = useMemo(() => formatLnkRequestName(rows), [rows])
  const pstoRequestOptions = useMemo(() => collectRequestNames(rows, ['pstoRequest']), [rows])
  const pstoRequestManagerOptions = useMemo(() => sortPstoRequestNamesNewestFirst(pstoRequestOptions), [pstoRequestOptions])
  const managedPstoRequestRows = useMemo(
    () => filterPstoRowsByRequestName(heatTreatmentRows, managedPstoRequestName),
    [heatTreatmentRows, managedPstoRequestName],
  )
  const pstoResultRequestOptions = useMemo(() => sortPstoRequestNamesNewestFirst(collectRequestNames(heatTreatmentRows, ['pstoRequest'])), [heatTreatmentRows])
  const lnkRequestOptions = useMemo(() => collectRequestNames(rows, lnkRequestFieldKeys), [rows])
  const lnkRequestManagerOptions = useMemo(() => sortLnkRequestNamesNewestFirst(lnkRequestOptions), [lnkRequestOptions])
  const lnkResultRequestOptions = useMemo(() => collectLnkResultRequestNames(lnkRows), [lnkRows])
  const managedLnkRequestRows = useMemo(() => filterLnkRowsByRequestName(lnkRows, managedLnkRequestName), [lnkRows, managedLnkRequestName])
  const managedLnkRequestMethods = useMemo(
    () => getLnkRequestMethodsForRows(managedLnkRequestRows, managedLnkRequestName),
    [managedLnkRequestName, managedLnkRequestRows],
  )
  const nextLnkConclusionName = useMemo(
    () => formatLnkConclusionName(rows, lnkResultDraft.controlDate, lnkResultDraft.methodKey),
    [lnkResultDraft.controlDate, lnkResultDraft.methodKey, rows],
  )
  const nextPstoDiagramName = useMemo(
    () => formatPstoDiagramName(rows, pstoResultDraft.pstoDate),
    [pstoResultDraft.pstoDate, rows],
  )
  const selectedPstoResultRequestRows = useMemo(
    () => filterPstoRowsByRequestName(heatTreatmentRows, pstoResultDraft.requestName),
    [heatTreatmentRows, pstoResultDraft.requestName],
  )
  const pstoResultSelectedRows = useMemo(
    () => heatTreatmentRows.filter((row) => pstoResultDraft.rowIds.has(row.id)),
    [heatTreatmentRows, pstoResultDraft.rowIds],
  )
  const pstoResultAvailableRequestOptions = useMemo(() => {
    const selectedRequestOptions = sortPstoRequestNamesNewestFirst(collectRequestNames(pstoResultSelectedRows, ['pstoRequest']))
    return selectedRequestOptions.length > 0 ? selectedRequestOptions : pstoResultRequestOptions
  }, [pstoResultRequestOptions, pstoResultSelectedRows])
  const filteredPstoResultRequestOptions = useMemo(() => {
    const query = normalizeSearchText(pstoResultRequestSearch)
    const compactQuery = compactSearchText(query)
    if (!query) return pstoResultAvailableRequestOptions
    return pstoResultAvailableRequestOptions.filter((requestName) => {
      const normalized = normalizeSearchText(requestName)
      return normalized.includes(query) || compactSearchText(normalized).includes(compactQuery)
    })
  }, [pstoResultAvailableRequestOptions, pstoResultRequestSearch])
  const pstoResultSearchRows = pstoResultDraft.requestName ? selectedPstoResultRequestRows : heatTreatmentRows
  const filteredPstoResultRows = useMemo(
    () => filterPstoResultRows(pstoResultSearchRows, pstoResultDraft.search),
    [pstoResultDraft.search, pstoResultSearchRows],
  )
  const selectedPstoResultRows = useMemo(
    () =>
      filteredPstoResultRows.filter(
        (row) => pstoResultDraft.rowIds.has(row.id) && canSelectPstoResultRow(row, pstoResultDraft.requestName),
      ),
    [filteredPstoResultRows, pstoResultDraft.requestName, pstoResultDraft.rowIds],
  )
  const pstoResultSaveBlockReason = useMemo(() => {
    if (pstoResultMutation.isPending) return 'Результат сохраняется, дождитесь завершения.'
    if (!pstoResultDraft.requestName) return 'Выберите заявку ПСТО.'
    if (selectedPstoResultRows.length === 0) return 'Отметьте один или несколько стыков галочкой.'
    if (!pstoResultDraft.result) return 'Выберите результат ПСТО.'
    if (pstoResultDraft.result !== PSTO_EMPTY_RESULT_VALUE && pstoResultDraft.result !== 'проведено') return 'Выберите результат ПСТО.'
    if (pstoResultDraft.result !== PSTO_EMPTY_RESULT_VALUE && !pstoResultDraft.pstoDate) return 'Укажите дату ПСТО.'
    const dateIssue =
      pstoResultDraft.result === PSTO_EMPTY_RESULT_VALUE
        ? null
        : findFirstDateBeforeWeldDateIssue(selectedPstoResultRows, pstoResultDraft.pstoDate, 'Дата ПСТО')
    if (dateIssue) return dateIssue
    if (
      pstoResultDraft.result !== PSTO_EMPTY_RESULT_VALUE &&
      !getRequestNameFromNaming(pstoResultDraft.diagramNaming, nextPstoDiagramName)
    ) {
      return 'Укажите наименование диаграммы термообработки.'
    }
    return ''
  }, [nextPstoDiagramName, pstoResultDraft, pstoResultMutation.isPending, selectedPstoResultRows])
  const managedPstoResultRows = useMemo(
    () =>
      heatTreatmentRows.filter(
        (row) => pstoResultDraft.rowIds.has(row.id) && (hasText(row.pstoResult) || hasText(row.heatTreatmentDiagram) || hasText(row.pstoDate)),
      ),
    [heatTreatmentRows, pstoResultDraft.rowIds],
  )
  const selectedLnkResultRequestRows = useMemo(
    () => filterLnkRowsByRequestName(lnkRows, lnkResultDraft.requestName),
    [lnkResultDraft.requestName, lnkRows],
  )
  const lnkResultSelectedRows = useMemo(
    () => lnkRows.filter((row) => lnkResultDraft.rowIds.has(row.id)),
    [lnkResultDraft.rowIds, lnkRows],
  )
  const lnkResultMethodRequestOptions = useMemo(() => {
    const method = getLnkMethodByRequestKey(lnkResultDraft.methodKey)
    if (!method) return lnkResultRequestOptions
    return sortLnkRequestNamesNewestFirst([
      ...new Set(
        lnkRows.flatMap((row) => {
          const requestName = String(row[method.requestKey] ?? '').trim()
          if (!requestName || isFinalLnkResultValue(row[method.resultKey])) return []
          return [requestName]
        }),
      ),
    ])
  }, [lnkResultDraft.methodKey, lnkResultRequestOptions, lnkRows])
  const lnkResultAvailableRequestOptions = useMemo(() => {
    return lnkResultMethodRequestOptions
  }, [lnkResultMethodRequestOptions])
  const filteredLnkResultRequestOptions = useMemo(() => {
    const query = normalizeSearchText(lnkResultRequestSearch)
    const compactQuery = compactSearchText(query)
    const options = !query
      ? lnkResultAvailableRequestOptions
      : lnkResultAvailableRequestOptions.filter((requestName) => {
          const haystack = normalizeSearchText(requestName)
          return haystack.includes(query) || compactSearchText(haystack).includes(compactQuery)
        })
    return withCurrentOption(options, lnkResultDraft.requestName)
  }, [lnkResultAvailableRequestOptions, lnkResultDraft.requestName, lnkResultRequestSearch])
  const filteredManagedLnkResultRequestOptions = useMemo(() => {
    const query = normalizeSearchText(managedLnkResultRequestSearch)
    const compactQuery = compactSearchText(query)
    const options = !query
      ? lnkResultRequestOptions
      : lnkResultRequestOptions.filter((requestName) => {
          const haystack = normalizeSearchText(requestName)
          return haystack.includes(query) || compactSearchText(haystack).includes(compactQuery)
        })
    return withCurrentOption(options, managedLnkResultRequestName)
  }, [lnkResultRequestOptions, managedLnkResultRequestName, managedLnkResultRequestSearch])
  const managedLnkResultRows = useMemo(
    () => {
      if (managedLnkResultOrderIds) {
        const selectedIds = new Set(managedLnkResultOrderIds)
        return sortRowsByPreservedOrder(
          lnkRows.filter((row) => selectedIds.has(row.id)),
          managedLnkResultOrderIds,
        )
      }
      const requestRows = filterLnkRowsByRequestName(lnkRows, managedLnkResultRequestName)
      return requestRows
    },
    [lnkRows, managedLnkResultOrderIds, managedLnkResultRequestName],
  )
  const managedLnkResultMethods = useMemo(
    () => getLnkResultMethodsForRows(managedLnkResultRows, managedLnkResultRequestName),
    [managedLnkResultRequestName, managedLnkResultRows],
  )
  const managedLnkResultMethodRows = useMemo(
    () =>
      managedLnkResultRows.filter((row) => {
        const method = getLnkMethodByRequestKey(managedLnkResultMethodKey)
        return Boolean(
          method &&
            isLnkResultRowApplicable(row, managedLnkResultRequestName, managedLnkResultMethodKey) &&
            isFinalLnkResultValue(row[method.resultKey]),
        )
      }),
    [managedLnkResultMethodKey, managedLnkResultRequestName, managedLnkResultRows],
  )
  const managedLnkResultEntries = useMemo(
    () =>
      (managedLnkResultMethodKey
        ? managedLnkResultMethodRows.flatMap((row) => {
            const method = getLnkMethodByRequestKey(managedLnkResultMethodKey)
            return method ? [{ row, method, changeKey: getManagedLnkResultChangeKey(row.id, method.requestKey) }] : []
          })
        : managedLnkResultRows.flatMap((row) =>
            LNK_METHODS.flatMap((method) =>
              isLnkResultRowApplicable(row, managedLnkResultRequestName, method.requestKey) &&
              isFinalLnkResultValue(row[method.resultKey])
                ? [{ row, method, changeKey: getManagedLnkResultChangeKey(row.id, method.requestKey) }]
                : [],
            ),
          )),
    [managedLnkResultMethodKey, managedLnkResultMethodRows, managedLnkResultRequestName, managedLnkResultRows],
  )
  const managedLnkPendingResultRows = useMemo(() => {
    return managedLnkResultEntries.filter(({ row, method, changeKey }) => {
      const nextResult = managedLnkPendingResultChanges[changeKey]
      const currentResult = String(row[method.resultKey] ?? '').trim()
      return Boolean(nextResult && nextResult !== currentResult)
    })
  }, [managedLnkPendingResultChanges, managedLnkResultEntries])
  useEffect(() => {
    if (!isLnkResultManagerOpen) return
    setManagedLnkConclusionDrafts(
      Object.fromEntries(
        managedLnkResultEntries.map(({ row, method, changeKey }) => [changeKey, String(row[method.conclusionKey] ?? '').trim()]),
      ),
    )
  }, [isLnkResultManagerOpen, managedLnkResultEntries])
  useEffect(() => {
    if (!isLnkResultManagerOpen) return
    if (managedLnkResultMethodKey && !managedLnkResultMethods.some((method) => method.requestKey === managedLnkResultMethodKey)) {
      setManagedLnkResultMethodKey('')
    }
  }, [isLnkResultManagerOpen, managedLnkResultMethodKey, managedLnkResultMethods, managedLnkResultRequestName])
  const lnkResultSearchRows = useMemo(() => {
    const baseRows = lnkResultDraft.requestName ? selectedLnkResultRequestRows : lnkRows
    const method = getLnkMethodByRequestKey(lnkResultDraft.methodKey)
    if (!method) return baseRows
    return baseRows.filter(
      (row) => isLnkResultRowApplicable(row, lnkResultDraft.requestName, lnkResultDraft.methodKey) && !isFinalLnkResultValue(row[method.resultKey]),
    )
  }, [lnkResultDraft.methodKey, lnkResultDraft.requestName, lnkRows, selectedLnkResultRequestRows])
  const lnkResultMethodRows =
    lnkResultDraft.rowIds.size > 0
      ? lnkResultSelectedRows
      : lnkResultDraft.requestName
        ? selectedLnkResultRequestRows
        : lnkRows
  const selectedLnkResultMethods = useMemo(
    () => getLnkInputMethodsForRows(lnkResultMethodRows, ''),
    [lnkResultMethodRows],
  )
  const filteredLnkResultRows = useMemo(
    () => filterLnkResultRows(lnkResultSearchRows, lnkResultDraft.search, lnkResultDraft.methodKey),
    [lnkResultDraft.methodKey, lnkResultDraft.search, lnkResultSearchRows],
  )
  const lnkResultContextReady = Boolean(lnkResultDraft.methodKey)
  const visibleLnkResultRows = useMemo(() => {
    if (!shouldPinPreviewedLnkResultRows || lnkResultDraft.rowIds.size === 0) return filteredLnkResultRows

    return [...filteredLnkResultRows].sort((left, right) => {
      const leftSelected = lnkResultDraft.rowIds.has(left.id)
      const rightSelected = lnkResultDraft.rowIds.has(right.id)
      if (leftSelected === rightSelected) return 0
      return leftSelected ? -1 : 1
    })
  }, [filteredLnkResultRows, lnkResultDraft.rowIds, shouldPinPreviewedLnkResultRows])
  const selectableVisibleLnkResultRows = useMemo(
    () => visibleLnkResultRows.filter((row) => canSelectLnkResultRow(row, lnkResultDraft.requestName, lnkResultDraft.methodKey)),
    [lnkResultDraft.methodKey, lnkResultDraft.requestName, visibleLnkResultRows],
  )
  const canBulkToggleLnkResultRows = Boolean(
    lnkResultDraft.methodKey &&
      selectableVisibleLnkResultRows.length > 0 &&
      (lnkResultDraft.requestName || lnkResultDraft.search.trim() || visibleLnkResultRows.length <= 20),
  )
  const selectedLnkResultRows = useMemo(
    () =>
      lnkRows.filter(
        (row) => lnkResultDraft.rowIds.has(row.id) && canSelectLnkResultRow(row, '', lnkResultDraft.methodKey),
      ),
    [lnkResultDraft.methodKey, lnkResultDraft.rowIds, lnkRows],
  )
  const filteredLnkOfficialityRows = useMemo(
    () => filterLnkOfficialityRows(lnkRows, lnkOfficialityDraft.search, lnkOfficialityDraft.rowIds),
    [lnkOfficialityDraft.rowIds, lnkOfficialityDraft.search, lnkRows],
  )
  const selectedLnkOfficialityRows = useMemo(
    () => lnkRows.filter((row) => lnkOfficialityDraft.rowIds.has(row.id)),
    [lnkOfficialityDraft.rowIds, lnkRows],
  )
  const lnkResultSaveBlockReason = useMemo(() => {
    if (lnkResultMutation.isPending) return 'Результат сохраняется, дождитесь завершения.'
    if (!lnkResultDraft.methodKey) return 'Выберите метод контроля.'
    if (selectedLnkResultRows.length === 0) return 'Отметьте один или несколько стыков галочкой.'
    if (!areLnkResultDraftRowsReady(selectedLnkResultRows, lnkResultDraft)) return 'Укажите результат для каждого выбранного стыка.'
    if (hasNonEmptyLnkResultDraftRows(selectedLnkResultRows, lnkResultDraft) && !lnkResultDraft.controlDate) {
      return 'Укажите дату контроля.'
    }
    const dateIssue = hasNonEmptyLnkResultDraftRows(selectedLnkResultRows, lnkResultDraft)
      ? findFirstLnkResultDateBeforeWeldDateIssue(selectedLnkResultRows, lnkResultDraft)
      : null
    if (dateIssue) return dateIssue
    if (
      hasNonEmptyLnkResultDraftRows(selectedLnkResultRows, lnkResultDraft) &&
      !getRequestNameFromNaming(lnkResultDraft.conclusionNaming, nextLnkConclusionName)
    ) {
      return 'Укажите наименование заключения.'
    }
    return ''
  }, [
    lnkResultDraft,
    lnkResultMutation.isPending,
    nextLnkConclusionName,
    selectedLnkResultRows,
  ])
  const isLnkResultSaveDisabled = Boolean(lnkResultSaveBlockReason)
  const lnkOfficialitySaveBlockReason = useMemo(() => {
    if (lnkOfficialityMutation.isPending) return 'Статус сохраняется, дождитесь завершения.'
    if (!lnkOfficialityDraft.status) return 'Выберите официальный или неофициальный статус.'
    if (selectedLnkOfficialityRows.length === 0) return 'Отметьте один или несколько стыков.'
    if (lnkOfficialityDraft.status === 'unofficial' && selectedLnkOfficialityRows.some((row) => !hasRejectedLnkResult(row))) {
      return 'Неофициальный статус можно назначить только стыкам с результатом контроля "ремонт" или "вырез".'
    }
    return ''
  }, [lnkOfficialityDraft.status, lnkOfficialityMutation.isPending, selectedLnkOfficialityRows])
  const isLnkOfficialitySaveDisabled = Boolean(lnkOfficialitySaveBlockReason)
  const activeColumnFilters =
    activeReport === 'heatTreatment' ? heatTreatmentFilters : activeReport === 'lnk' ? lnkFilters : columnFilters
  const activeFiltersSetter =
    activeReport === 'heatTreatment' ? setHeatTreatmentFilters : activeReport === 'lnk' ? setLnkFilters : setColumnFilters
  const acceptedWdiTotal = useMemo(() => sumAcceptedWdi(rows), [rows])
  const registerMinWidth = activeReport === 'welderStamps' ? 1120 : getWeldTableWidth(VISIBLE_FIELDS)
  const stickyLeft = navCollapsed ? 80 : 288
  const activeTitle =
    activeReport === 'heatTreatment'
      ? 'Термообработка'
      : activeReport === 'lnk'
        ? 'ЛНК'
        : activeReport === 'welderStamps'
          ? 'Клейма'
          : 'Сварочный журнал'

  useEffect(() => {
    setSelectedHeatTreatmentIds((current) => {
      const selectableIds = new Set(availablePstoRequestRows.map((row) => row.id))
      const next = new Set([...current].filter((id) => selectableIds.has(id)))
      return next.size === current.size ? current : next
    })
  }, [availablePstoRequestRows])

  useEffect(() => {
    setPstoResultDraft((current) => {
      if (!isPstoResultModalOpen) return current
      const selectedRows = heatTreatmentRows.filter((row) => current.rowIds.has(row.id))
      const requestOptions = sortPstoRequestNamesNewestFirst(collectRequestNames(selectedRows, ['pstoRequest']))
      const allowedRequestOptions = requestOptions.length > 0 ? requestOptions : pstoResultRequestOptions
      const requestName = !current.requestName || allowedRequestOptions.includes(current.requestName) ? current.requestName : ''
      const availableRows = filterPstoResultRows(requestName ? filterPstoRowsByRequestName(heatTreatmentRows, requestName) : heatTreatmentRows, current.search)
      const availableIds = new Set(availableRows.filter((row) => canSelectPstoResultRow(row, requestName)).map((row) => row.id))
      const rowIds = new Set([...current.rowIds].filter((id) => availableIds.has(id)))
      return { ...current, requestName, rowIds }
    })
  }, [heatTreatmentRows, isPstoResultModalOpen, pstoResultRequestOptions])

  useEffect(() => {
    if (!isPstoResultManagerOpen) return
    setManagedPstoDiagramDrafts(
      Object.fromEntries(managedPstoResultRows.map((row) => [row.id, String(row.heatTreatmentDiagram ?? '').trim()])),
    )
  }, [isPstoResultManagerOpen, managedPstoResultRows])

  useEffect(() => {
    setSelectedLnkIds((current) => {
      const ids = new Set(availableLnkRequestRows.map((row) => row.id))
      const next = new Set([...current].filter((id) => ids.has(id)))
      return next.size === current.size ? current : next
    })
  }, [availableLnkRequestRows])

  useEffect(() => {
    setLnkResultDraft((current) => {
      if (!isLnkResultModalOpen) return current
      const selectedRows = lnkRows.filter((row) => current.rowIds.has(row.id))
      const requestName = !current.requestName || lnkResultRequestOptions.includes(current.requestName) ? current.requestName : ''
      const requestRows = filterLnkRowsByRequestName(lnkRows, requestName)
      const methodRows = current.rowIds.size > 0 ? [...selectedRows, ...requestRows] : requestName ? requestRows : lnkRows
      const methods = getLnkInputMethodsForRows(methodRows, '')
      const methodKey = !current.methodKey || methods.some((method) => method.requestKey === current.methodKey) ? current.methodKey : ''
      const rowIds = new Set(
        [...current.rowIds].filter((id) => {
          const row = lnkRows.find((candidate) => candidate.id === id)
          return row ? !methodKey || canSelectLnkResultRow(row, '', methodKey) : false
        }),
      )
      return { ...current, requestName, methodKey, rowIds, rowResults: filterLnkResultDraftRowResults(current.rowResults, rowIds) }
    })
  }, [isLnkResultModalOpen, lnkRequestOptions, lnkResultRequestOptions, lnkRows])

  async function handleImport(file: File) {
    setMessage(null)
    if (activeReport === 'heatTreatment' || activeReport === 'lnk') {
      const editableFieldKeys = activeReport === 'heatTreatment' ? heatTreatmentEditableFieldKeys : lnkEditableFieldKeys
      const matchFieldKeys = activeReport === 'heatTreatment' ? heatTreatmentImportMatchFieldKeys : lnkImportMatchFieldKeys
      const options = {
        editableFieldKeys,
        matchFieldKeys,
      }
      const result = file.name.toLowerCase().endsWith('.csv')
        ? parseEditableCsv(await file.text(), options)
        : parseEditableWorkbook(await file.arrayBuffer(), options)
      const importResult =
        activeReport === 'heatTreatment'
          ? await heatTreatmentImportMutation.mutateAsync(result.records)
          : await lnkImportMutation.mutateAsync(result.records)
      setMessage(
        `Обновлено ${activeReport === 'heatTreatment' ? 'ПСТО' : 'ЛНК'}: ${importResult.updated}; пропущено: ${importResult.skipped + result.skippedRows}`,
      )
      return
    }

    const result = file.name.toLowerCase().endsWith('.csv') ? parseCsv(await file.text()) : parseWorkbook(await file.arrayBuffer())
    const importResult = await importMutation.mutateAsync(result.records.map(withOfficialJointStatus))
    setMessage(`Добавлено ${importResult.inserted}, пропущено служебных строк: ${result.skippedRows}`)
  }

  function exportXlsx() {
    const fields = getReportExportFields({
      storageKey: activeReport,
      hiddenFieldKeys:
        activeReport === 'heatTreatment'
          ? heatTreatmentHiddenFieldKeys
          : activeReport === 'lnk'
            ? lnkHiddenFieldKeys
            : weldingJournalHiddenFieldKeys,
      mergePstoSections: activeReport === 'heatTreatment',
    })
    const exportOptions = {
      fields,
      readOnlyFieldKeys: getReportReadOnlyFieldKeys(activeReport),
      sheetName: activeTitle,
    }
    const bytes = buildExportXlsxBytes(visibleRows, exportOptions)
    downloadExcelBytes(
      bytes,
      activeReport === 'heatTreatment'
        ? 'heat-treatment-register.xlsx'
        : activeReport === 'lnk'
          ? 'lnk-register.xlsx'
          : 'welding-register.xlsx',
    )
  }

  function openLnkWaitingNkReport() {
    const reportRows = buildLnkWaitingNkRows(lnkRows)
    setIsLnkShowMenuOpen(false)
    if (reportRows.length === 0) {
      setMessage('Нет стыков со статусом «ожидает НК»')
      return
    }

    const opened = openTabularReportWindow({
      rows: reportRows as WeldInput[],
      fields: LNK_WAITING_NK_FIELDS,
      sheetName: 'Ожидание НК',
      title: 'Ожидание НК',
      filename: 'lnk-waiting-nk.xlsx',
    })
    if (!opened) {
      setMessage('Браузер заблокировал открытие новой вкладки')
    }
  }

  function openLnkToRequestReport() {
    const reportRows = buildLnkToRequestRows(lnkRows)
    setIsLnkShowMenuOpen(false)
    if (reportRows.length === 0) {
      setMessage('Нет стыков, по которым нужно создать заявку ЛНК')
      return
    }

    const opened = openTabularReportWindow({
      rows: reportRows as WeldInput[],
      fields: LNK_WAITING_NK_FIELDS,
      sheetName: 'Ожидание заявки',
      title: 'Ожидание заявки',
      filename: 'lnk-waiting-request.xlsx',
    })
    if (!opened) {
      setMessage('Браузер заблокировал открытие новой вкладки')
    }
  }

  function openLnkConclusionsReport() {
    const reportRows = buildLnkConclusionsRows(lnkRows)
    setIsLnkShowMenuOpen(false)
    if (reportRows.length === 0) {
      setMessage('Нет заключений ЛНК для показа')
      return
    }

    const opened = openTabularReportWindow({
      rows: reportRows as WeldInput[],
      fields: LNK_CONCLUSIONS_FIELDS,
      sheetName: 'Заключения ЛНК',
      title: 'Заключения ЛНК',
      filename: 'lnk-conclusions.xlsx',
    })
    if (!opened) {
      setMessage('Браузер заблокировал открытие новой вкладки')
    }
  }

  function openPstoWaitingRequestReport() {
    const reportRows = buildPstoWaitingRequestRows(heatTreatmentRows)
    setIsPstoShowMenuOpen(false)
    if (reportRows.length === 0) {
      setMessage('Нет стыков, по которым нужно создать заявку ПСТО')
      return
    }

    const opened = openTabularReportWindow({
      rows: reportRows as WeldInput[],
      fields: PSTO_WAITING_REQUEST_FIELDS,
      sheetName: 'Ожидает заявку ПСТО',
      title: 'Ожидает заявку ПСТО',
      filename: 'psto-waiting-request.xlsx',
    })
    if (!opened) {
      setMessage('Браузер заблокировал открытие новой вкладки')
    }
  }

  function openPstoResultsReport() {
    const reportRows = buildPstoResultsRows(heatTreatmentRows)
    setIsPstoShowMenuOpen(false)
    if (reportRows.length === 0) {
      setMessage('Нет результатов ПСТО для показа')
      return
    }

    const opened = openTabularReportWindow({
      rows: reportRows as WeldInput[],
      fields: PSTO_RESULTS_FIELDS,
      sheetName: 'Результаты ПСТО',
      title: 'Результаты ПСТО',
      filename: 'psto-results.xlsx',
    })
    if (!opened) {
      setMessage('Браузер заблокировал открытие новой вкладки')
    }
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
    setSelectedHeatTreatmentIds((current) => {
      const next = new Set(current)
      if (next.has(rowId)) {
        next.delete(rowId)
      } else {
        next.add(rowId)
      }
      return next
    })
  }

  function toggleAllPstoRequestRows() {
    setSelectedHeatTreatmentIds((current) => {
      const filteredIds = new Set(filteredAvailablePstoRequestRows.map((row) => row.id))
      if (filteredIds.size === 0) return current
      const allFilteredSelected = [...filteredIds].every((id) => current.has(id))
      if (allFilteredSelected) {
        return new Set([...current].filter((id) => !filteredIds.has(id)))
      }
      return new Set([...current, ...filteredIds])
    })
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

  useEffect(() => {
    if (!isReportModalOpen) return

    function handleReportModalKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()

      if (isLnkResultPreviewOpen) {
        setIsLnkResultPreviewOpen(false)
        return
      }
      if (isPstoRequestManagerOpen) {
        if (!pstoRequestManagerMutation.isPending && !pstoRequestCorrectionMutation.isPending) {
          setIsPstoRequestManagerOpen(false)
        }
        return
      }
      if (isPstoResultManagerOpen) {
        if (!pstoResultCorrectionMutation.isPending) {
          setIsPstoResultManagerOpen(false)
        }
        return
      }
      if (isLnkRequestManagerOpen) {
        if (!lnkRequestManagerMutation.isPending && !lnkRequestCorrectionMutation.isPending) {
          setIsLnkRequestManagerOpen(false)
        }
        return
      }
      if (isLnkResultManagerOpen) {
        if (
          !lnkResultCorrectionMutation.isPending &&
          !lnkResultReplacementMutation.isPending &&
          !lnkConclusionCorrectionMutation.isPending
        ) {
          setIsLnkResultManagerOpen(false)
        }
        return
      }
      if (isPstoResultModalOpen) {
        closeAddPstoResultModal()
        return
      }
      if (isPstoRequestModalOpen) {
        closeCreatePstoRequestModal()
        return
      }
      if (isLnkOfficialityModalOpen) {
        closeLnkOfficialityModal()
        return
      }
      if (isLnkResultModalOpen) {
        closeAddLnkResultModal()
        return
      }
      if (isLnkRequestModalOpen) {
        closeCreateLnkRequestModal()
      }
    }

    window.addEventListener('keydown', handleReportModalKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleReportModalKeyDown, { capture: true })
  }, [
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
    pstoRequestManagerMutation.isPending,
    pstoRequestCorrectionMutation.isPending,
    pstoResultCorrectionMutation.isPending,
    lnkRequestManagerMutation.isPending,
    lnkRequestCorrectionMutation.isPending,
    lnkResultCorrectionMutation.isPending,
    lnkResultReplacementMutation.isPending,
    lnkConclusionCorrectionMutation.isPending,
    pstoResultMutation.isPending,
    pstoRequestMutation.isPending,
    lnkOfficialityMutation.isPending,
    lnkResultMutation.isPending,
    lnkRequestMutation.isPending,
  ])

  function toggleLnkOfficialityRow(rowId: number) {
    setLnkOfficialityDraft((current) => {
      const rowIds = new Set(current.rowIds)
      if (rowIds.has(rowId)) {
        rowIds.delete(rowId)
      } else {
        rowIds.add(rowId)
      }
      return { ...current, rowIds }
    })
  }

  function setVisibleLnkOfficialityRowsSelected(selected: boolean) {
    setLnkOfficialityDraft((current) => {
      const rowIds = new Set(current.rowIds)
      for (const row of filteredLnkOfficialityRows) {
        if (selected) {
          rowIds.add(row.id)
        } else {
          rowIds.delete(row.id)
        }
      }
      return { ...current, rowIds }
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
    setSelectedLnkIds((current) => {
      const next = new Set(current)
      if (next.has(rowId)) {
        next.delete(rowId)
      } else {
        next.add(rowId)
      }
      return next
    })
  }

  function toggleAllLnkRequestRows() {
    setSelectedLnkIds((current) => {
      const filteredIds = new Set(filteredAvailableLnkRequestRows.map((row) => row.id))
      if (filteredIds.size === 0) return current
      const allFilteredSelected = [...filteredIds].every((id) => current.has(id))
      if (allFilteredSelected) {
        return new Set([...current].filter((id) => !filteredIds.has(id)))
      }
      return new Set([...current, ...filteredIds])
    })
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

  function highlightChangedRows(rows: Array<{ id?: number }> | undefined, cellFieldKeys: WeldFieldKey[] = []) {
    if (rows && rows.length > 0) {
      latestHighlightRef.current = {
        rows,
        fieldKeys: expandHighlightFieldKeys(cellFieldKeys),
        createdAt: Date.now(),
      }
    }
    applyChangedRowsHighlight(rows, cellFieldKeys)
  }

  function replayLatestHighlight() {
    const latestHighlight = latestHighlightRef.current
    if (!latestHighlight) return
    if (Date.now() - latestHighlight.createdAt > highlightDurationMs * 4) return
    applyChangedRowsHighlight(latestHighlight.rows, latestHighlight.fieldKeys)
  }

  function applyChangedRowsHighlight(rows: Array<{ id?: number }> | undefined, cellFieldKeys: WeldFieldKey[] = []) {
    const ids = new Set(
      (rows ?? [])
        .map((row) => row.id)
        .filter((id): id is number => typeof id === 'number' && Number.isFinite(id)),
    )
    if (ids.size === 0) return

    const cellKeys = new Set<string>()
    const expandedFieldKeys = expandHighlightFieldKeys(cellFieldKeys)
    for (const id of ids) {
      for (const fieldKey of expandedFieldKeys) {
        cellKeys.add(getCellKey(id, fieldKey))
      }
    }

    setHighlightedRowIds(ids)
    setHighlightedCellKeys(cellKeys)
    if (importHighlightTimerRef.current) {
      clearTimeout(importHighlightTimerRef.current)
    }
    importHighlightTimerRef.current = setTimeout(() => {
      setHighlightedRowIds(new Set())
      setHighlightedCellKeys(new Set())
      importHighlightTimerRef.current = null
    }, highlightDurationMs)
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

  function updateWelderStampDraft(field: keyof WelderStampRecord, value: string) {
    setWelderStampDraft((current) => ({ ...current, [field]: field === 'naksStamp' ? normalizeNaksStamp(value) : value }))
  }

  function resetWelderStampForm() {
    setWelderStampDraft(createEmptyWelderStampDraft())
    setEditingWelderStampId(null)
  }

  function persistWelderStampRecords(nextRecords: WelderStampRecord[]) {
    setWelderStamps(nextRecords)
    welderStampsMutation.mutate(nextRecords)
  }

  function saveWelderStampRecord() {
    const draft = normalizeWelderStampRecord(welderStampDraft)
    if (!draft.naksStamp && !draft.internalStamp) {
      setMessage('Укажите Клеймо НАКС или Клеймо внутреннее')
      return
    }
    if (draft.naksStamp && !isValidNaksStamp(draft.naksStamp)) {
      setMessage('Клеймо НАКС должно состоять из 4 латинских букв или цифр')
      return
    }
    const validationError = validateWelderStampRecord(draft)
    if (validationError) {
      setMessage(validationError)
      return
    }

    if (editingWelderStampId !== null) {
      persistWelderStampRecords(
        welderStamps.map((record) => (record.id === editingWelderStampId ? { ...draft, id: editingWelderStampId } : record)),
      )
      setMessage('Клеймо обновлено')
    } else {
      const nextId = Math.max(0, ...welderStamps.map((record) => record.id)) + 1
      persistWelderStampRecords([{ ...draft, id: nextId }, ...welderStamps])
      setMessage('Клеймо добавлено')
    }
    resetWelderStampForm()
  }

  function editWelderStampRecord(record: WelderStampRecord) {
    setWelderStampDraft(record)
    setEditingWelderStampId(record.id)
  }

  function archiveWelderStampRecord(id: number) {
    persistWelderStampRecords(welderStamps.map((record) => (record.id === id ? { ...record, archived: true } : record)))
    if (editingWelderStampId === id) resetWelderStampForm()
    setMessage('Клеймо добавлено в архив')
  }

  function restoreWelderStampRecord(id: number) {
    persistWelderStampRecords(welderStamps.map((record) => (record.id === id ? { ...record, archived: false } : record)))
    setMessage('Клеймо возвращено в общий список')
  }

  function deleteWelderStampRecord(id: number) {
    if (!confirm('Удалить запись клейма?')) return
    persistWelderStampRecords(welderStamps.filter((record) => record.id !== id))
    if (editingWelderStampId === id) resetWelderStampForm()
    setMessage('Клеймо удалено')
  }

  return (
    <main className="relative min-h-screen bg-white">
      <aside
        className={`fixed left-0 top-0 z-30 h-screen border-r border-slate-100 bg-white px-3 py-5 transition-[width] duration-200 ${
          navCollapsed ? 'w-16' : 'w-48 lg:w-64 lg:px-4'
        }`}
      >
        <div
          className={`mb-3 flex items-start ${navCollapsed ? 'justify-center [&>div]:sr-only' : 'justify-between gap-3'}`}
        >
          <div className="text-lg font-semibold tracking-tight">Сварка</div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setNavCollapsed((value) => !value)}
            aria-label={navCollapsed ? 'Раскрыть меню' : 'Скрыть меню'}
            title={navCollapsed ? 'Раскрыть меню' : 'Скрыть меню'}
            className="h-9 w-9 shrink-0"
          >
            {navCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </Button>
        </div>
        <nav className="space-y-1">
          <button
            className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors ${
              activeReport === 'weldingJournal'
                ? 'bg-primary text-primary-foreground'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'
            } ${
              navCollapsed ? 'justify-center px-0' : ''
            }`}
            onClick={() => setActiveReport('weldingJournal')}
            title="Сварочный журнал"
          >
            <NotebookTabs className="h-4 w-4 shrink-0" />
            <span className={navCollapsed ? 'sr-only' : ''}>Сварочный журнал</span>
          </button>
          <button
            className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors ${
              activeReport === 'heatTreatment'
                ? 'bg-primary text-primary-foreground'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'
            } ${
              navCollapsed ? 'justify-center px-0' : ''
            }`}
            onClick={() => {
              setActiveReport('heatTreatment')
              setEditing(null)
            }}
            title="Термообработка"
          >
            <Flame className="h-4 w-4 shrink-0" />
            <span className={navCollapsed ? 'sr-only' : ''}>Термообработка</span>
          </button>
          <button
            className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors ${
              activeReport === 'lnk'
                ? 'bg-primary text-primary-foreground'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'
            } ${
              navCollapsed ? 'justify-center px-0' : ''
            }`}
            onClick={() => {
              setActiveReport('lnk')
              setEditing(null)
            }}
            title="ЛНК"
          >
            <ClipboardCheck className="h-4 w-4 shrink-0" />
            <span className={navCollapsed ? 'sr-only' : ''}>ЛНК</span>
          </button>
          <button
            className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors ${
              activeReport === 'welderStamps'
                ? 'bg-primary text-primary-foreground'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'
            } ${
              navCollapsed ? 'justify-center px-0' : ''
            }`}
            onClick={() => {
              setActiveReport('welderStamps')
              setEditing(null)
            }}
            title="Клейма"
          >
            <Stamp className="h-4 w-4 shrink-0" />
            <span className={navCollapsed ? 'sr-only' : ''}>Клейма</span>
          </button>
        </nav>
      </aside>

      <div
        className={`min-w-0 bg-white py-5 pr-4 transition-[padding-left] duration-200 lg:pr-6 ${
          navCollapsed ? 'pl-20' : 'pl-52 lg:pl-72'
        }`}
      >
        <div className="min-w-full w-max space-y-4 bg-white" style={{ minWidth: registerMinWidth }}>
          <header
            className="sticky z-40 flex w-full items-start gap-4 bg-white pb-1"
            style={{ left: stickyLeft, minWidth: registerMinWidth }}
          >
            <div className="shrink-0">
              <h1 className="text-2xl font-semibold tracking-tight">{activeTitle}</h1>
            </div>
            <div className="flex flex-wrap gap-2 lg:pt-0.5">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void handleImport(file)
                  event.currentTarget.value = ''
                }}
              />
              {activeReport === 'heatTreatment' ? (
                <>
                  <Button onClick={openCreatePstoRequestModal} disabled={pstoRequestMutation.isPending}>
                    <Plus className="mr-2 h-4 w-4" />
                    Заявка
                  </Button>
                  <Button onClick={openAddPstoResultModal} disabled={pstoResultMutation.isPending || pstoResultRequestOptions.length === 0}>
                    <ClipboardCheck className="mr-2 h-4 w-4" />
                    Результат
                  </Button>
                  <div className="relative">
                    <Button variant="outline" onClick={() => setIsPstoShowMenuOpen((current) => !current)}>
                      Показать
                      <ChevronDown className="ml-2 h-4 w-4" />
                    </Button>
                    {isPstoShowMenuOpen ? (
                      <div className="absolute right-0 z-50 mt-2 w-56 rounded-md border border-slate-200 bg-white p-1 shadow-lg shadow-slate-950/10">
                        <button
                          type="button"
                          onClick={openPstoWaitingRequestReport}
                          className="flex min-h-10 w-full items-center rounded px-3 py-2 text-left text-sm font-semibold leading-5 text-slate-900 hover:bg-sky-50 hover:text-sky-900"
                        >
                          Ожидает заявку ПСТО
                        </button>
                        <button
                          type="button"
                          onClick={openPstoResultsReport}
                          className="flex min-h-10 w-full items-center rounded px-3 py-2 text-left text-sm font-semibold leading-5 text-slate-900 hover:bg-sky-50 hover:text-sky-900"
                        >
                          Результаты ПСТО
                        </button>
                      </div>
                    ) : null}
                  </div>
                </>
              ) : null}
              {activeReport === 'lnk' ? (
                <>
                  <Button onClick={openCreateLnkRequestModal} disabled={lnkRequestMutation.isPending}>
                    <Plus className="mr-2 h-4 w-4" />
                    Заявка
                  </Button>
                  <Button onClick={openAddLnkResultModal} disabled={lnkResultMutation.isPending || lnkResultRequestOptions.length === 0}>
                    <ClipboardCheck className="mr-2 h-4 w-4" />
                    Результат
                  </Button>
                  <Button variant="outline" onClick={openLnkOfficialityModal} disabled={lnkOfficialityMutation.isPending}>
                    <ShieldCheck className="mr-2 h-4 w-4" />
                    Официальность
                  </Button>
                  <div className="relative">
                    <Button variant="outline" onClick={() => setIsLnkShowMenuOpen((current) => !current)}>
                      Показать
                      <ChevronDown className="ml-2 h-4 w-4" />
                    </Button>
                    {isLnkShowMenuOpen ? (
                      <div className="absolute right-0 z-50 mt-2 w-52 rounded-md border border-slate-200 bg-white p-1 shadow-lg shadow-slate-950/10">
                        <button
                          type="button"
                          onClick={openLnkToRequestReport}
                          className="flex min-h-10 w-full items-center rounded px-3 py-2 text-left text-sm font-semibold leading-5 text-slate-900 hover:bg-sky-50 hover:text-sky-900"
                        >
                          Ожидание заявки
                        </button>
                        <button
                          type="button"
                          onClick={openLnkWaitingNkReport}
                          className="flex min-h-10 w-full items-center rounded px-3 py-2 text-left text-sm font-semibold leading-5 text-slate-900 hover:bg-sky-50 hover:text-sky-900"
                        >
                          Ожидание НК
                        </button>
                        <button
                          type="button"
                          onClick={openLnkConclusionsReport}
                          className="flex min-h-10 w-full items-center rounded px-3 py-2 text-left text-sm font-semibold leading-5 text-slate-900 hover:bg-sky-50 hover:text-sky-900"
                        >
                          Показать заключения
                        </button>
                      </div>
                    ) : null}
                  </div>
                </>
              ) : null}
              {activeReport === 'weldingJournal' ? (
                <Button onClick={() => setEditing({ record: {} })}>
                  <Plus className="mr-2 h-4 w-4" />
                  Новый стык
                </Button>
              ) : null}
              {activeReport === 'weldingJournal' ? (
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={importMutation.isPending || heatTreatmentImportMutation.isPending || lnkImportMutation.isPending}
                >
                  <Upload className="mr-2 h-4 w-4" />
                  Импорт
                </Button>
              ) : null}
              {activeReport !== 'welderStamps' ? (
                <Button variant="outline" onClick={exportXlsx}>
                  <FileSpreadsheet className="mr-2 h-4 w-4" />
                  Excel
                </Button>
              ) : null}
            </div>
          </header>

          <div
            className="sticky z-20 flex min-h-6 w-full items-center justify-between bg-white text-sm text-muted-foreground"
            style={{ left: stickyLeft, minWidth: registerMinWidth }}
          >
            <span>
              {weldsQuery.isLoading
                ? 'Загрузка...'
                : activeReport === 'heatTreatment'
                  ? `Стыков на ПСТО: ${heatTreatmentRows.length} · Выбрано: ${selectedHeatTreatmentRows.length}`
                  : activeReport === 'lnk'
                    ? `Стыков на ЛНК: ${lnkRows.length} · Доступно для новой заявки: ${availableLnkRequestRows.length}`
                    : activeReport === 'welderStamps'
                      ? `Клейм: ${welderStamps.filter((record) => !record.archived).length} · Архив: ${welderStamps.filter((record) => record.archived).length} · Найдено: ${filteredWelderStamps.length}`
                      : `Записей: ${rows.length} · WDI годных: ${formatWdiTotal(acceptedWdiTotal)}`}
              {weldsQuery.error ? ` Ошибка: ${(weldsQuery.error as Error).message}` : null}
            </span>
            <span>{message}</span>
          </div>

          {activeReport !== 'heatTreatment' && activeReport !== 'welderStamps' ? (
            <DispatcherTaskPanel
              tasks={repeatedJointTasks}
              groups={repeatedJointTaskGroups}
              stickyLeft={stickyLeft}
              handlers={dispatcherTaskCardProps}
              onDismissAll={(tasks) =>
                setDismissedRepeatedJointTaskKeys((current) => new Set([...current, ...tasks.map((task) => task.key)]))
              }
            />
          ) : null}

          {activeReport === 'welderStamps' ? (
            <WelderStampNotificationPanel
              tasks={welderStampExpiryTasks}
              groups={welderStampNotificationGroups}
              isTaskExpanded={isRepeatedJointTaskExpanded}
              onToggleDetails={toggleRepeatedJointTaskDetails}
              onDismissAll={(tasks) =>
                setDismissedRepeatedJointTaskKeys((current) => new Set([...current, ...tasks.map((task) => task.key)]))
              }
            />
          ) : null}

          {activeReport === 'welderStamps' ? (
            <WelderStampsRegistry
              records={activeWelderStamps}
              archivedRecords={archivedWelderStamps}
              draft={welderStampDraft}
              search={welderStampSearch}
              filters={welderStampFilters}
              editingId={editingWelderStampId}
              showArchived={showArchivedWelderStamps}
              onSearchChange={setWelderStampSearch}
              onFiltersChange={setWelderStampFilters}
              onDraftChange={updateWelderStampDraft}
              onSave={saveWelderStampRecord}
              onReset={resetWelderStampForm}
              onEdit={editWelderStampRecord}
              onArchive={archiveWelderStampRecord}
              onRestore={restoreWelderStampRecord}
              onToggleArchived={setShowArchivedWelderStamps}
              onDelete={deleteWelderStampRecord}
            />
          ) : (
            <WeldTable
              rows={visibleRows as Array<WeldInput & { id: number }>}
              columnFilters={activeColumnFilters}
              onColumnFiltersChange={activeFiltersSetter}
              onEdit={handleEditRecord}
              onDelete={(id) => {
                if (confirm('Удалить запись стыка?')) deleteMutation.mutate(id)
              }}
              stickyLeft={stickyLeft}
              highlightedRowIds={highlightedRowIds}
              highlightedCellKeys={highlightedCellKeys}
              readOnly={activeReport === 'heatTreatment' || activeReport === 'lnk'}
              editableFieldKeys={
                activeReport === 'heatTreatment'
                  ? heatTreatmentEditableFieldKeys
                  : activeReport === 'lnk'
                    ? lnkEditableFieldKeys
                    : undefined
              }
              blockedFieldKeys={activeReport === 'weldingJournal' ? weldingJournalBlockedFieldKeys : undefined}
              isCellEditable={
                activeReport === 'lnk'
                  ? (row, fieldKey) => !isLnkRequestField(fieldKey) || isLnkRequestAllowedForRow(row, fieldKey)
                  : undefined
              }
              getDisplayValue={activeReport === 'lnk' ? getLnkDisplayValue : undefined}
              onOpenChain={(row) => setChainRecord(row)}
              onOpenLinkedReport={activeReport === 'weldingJournal' || activeReport === 'lnk' ? openLinkedReportRow : undefined}
              openLinkedReportTitle={activeReport === 'lnk' ? 'Открыть стык в сварочном журнале' : 'Открыть стык в отчете ЛНК'}
              rowActions={
                activeReport === 'heatTreatment'
                  ? {
                      onCreateRequest: openCreatePstoRequestModalForRow,
                      onAddResult: openAddPstoResultModalForRow,
                      canCreateRequest: canCreatePstoRequest,
                      canAddResult: (row) => hasText(row.pstoRequest),
                      headerLabel: 'Действия ПСТО',
                      createTitle: 'Создать заявку ПСТО на этот стык',
                      createDisabledTitle: 'Заявка ПСТО по этому стыку уже создана',
                      createAriaLabel: 'Создать заявку ПСТО на этот стык',
                      resultTitle: 'Добавить результат ПСТО на этот стык',
                      resultDisabledTitle: 'Сначала создайте заявку ПСТО на этот стык',
                      resultAriaLabel: 'Добавить результат ПСТО на этот стык',
                    }
                  : activeReport === 'lnk'
                  ? {
                      onCreateRequest: openCreateLnkRequestModalForRow,
                      onAddResult: openAddLnkResultModalForRow,
                      canCreateRequest: canCreateLnkRequest,
                      canAddResult: (row) => getLnkRowRequestNames(row).length > 0,
                      headerLabel: 'Действия ЛНК',
                      createTitle: 'Создать заявку ЛНК на этот стык',
                      createDisabledTitle: 'Все заявки ЛНК по этому стыку уже созданы',
                      createAriaLabel: 'Создать заявку ЛНК на этот стык',
                      resultTitle: 'Добавить результат ЛНК на этот стык',
                      resultDisabledTitle: 'Сначала создайте заявку ЛНК на этот стык',
                      resultAriaLabel: 'Добавить результат ЛНК на этот стык',
                    }
                  : undefined
              }
              storageKey={activeReport}
              hiddenFieldKeys={
                activeReport === 'heatTreatment'
                  ? heatTreatmentHiddenFieldKeys
                  : activeReport === 'lnk'
                    ? lnkHiddenFieldKeys
                    : weldingJournalHiddenFieldKeys
              }
              mergePstoSections={activeReport === 'heatTreatment'}
            />
          )}
        </div>
      </div>

      {chainRecord ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/25 px-4 backdrop-blur-[1px]">
          <div className="flex max-h-[82vh] w-full max-w-4xl flex-col rounded-lg border border-slate-200 bg-white shadow-2xl shadow-slate-950/15">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-slate-900">Цепочка стыка {String(chainRecord.joint ?? '-')}</h2>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => openChainBaseInCurrentReport(chainRecord)}
                    className="h-7 border-sky-200 bg-sky-50 px-2.5 text-xs font-semibold text-sky-800 hover:bg-sky-100"
                  >
                    Показать всю цепочку
                  </Button>
                </div>
                <p className="mt-1 text-sm text-slate-500">{getJointChainSubtitle(chainRecord)}</p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setChainRecord(null)} aria-label="Закрыть цепочку стыка">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {chainRows.length === 0 ? (
                <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                  По этому стыку цепочка не найдена.
                </div>
              ) : (
                <div className="space-y-2">
                  {chainRows.map((row, index) => {
                    const isCurrent = row.id === chainRecord.id
                    return (
                      <div
                        key={row.id}
                        className={`rounded-md border px-4 py-3 ${
                          isCurrent ? 'border-sky-200 bg-sky-50/70 shadow-sm shadow-sky-100' : 'border-slate-200 bg-white'
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-slate-100 px-2 text-xs font-semibold text-slate-600">
                                {index + 1}
                              </span>
                              <span className="text-base font-semibold text-slate-900">{String(row.joint ?? '-')}</span>
                              <button
                                type="button"
                                onClick={() => openChainRowInCurrentReport(row)}
                                className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700"
                                title="Открыть только этот стык в текущем отчете"
                                aria-label={`Открыть стык ${String(row.joint ?? '-')} в текущем отчете`}
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                              </button>
                              {isCurrent ? (
                                <span className="rounded border border-sky-200 bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-800">
                                  текущий
                                </span>
                              ) : null}
                              <OfficialityBadge row={row} />
                            </div>
                            <div className="mt-1 text-sm text-slate-600">{getJointTitle(row)}</div>
                            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                              <span>
                                Дата сварки:{' '}
                                <span className="font-semibold text-slate-700">{formatDisplayDate(row.weldDate) || '-'}</span>
                              </span>
                              <span>
                                Статус:{' '}
                                <span className={`rounded border px-1.5 py-0.5 font-semibold ${getJointStatusBadgeClass(row)}`}>
                                  {getJointStatusLabel(row)}
                                </span>
                              </span>
                            </div>
                          </div>

                          <div className="flex max-w-[420px] flex-wrap justify-end gap-1.5">
                            {getJointChainResultItems(row).length > 0 ? (
                              getJointChainResultItems(row).map((item) => (
                                <span
                                  key={`${row.id}:${item.label}:${item.value}`}
                                  className={`rounded border px-2 py-1 text-xs font-semibold ${item.className}`}
                                >
                                  {item.label} {item.value}
                                </span>
                              ))
                            ) : (
                              <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-500">
                                результатов пока нет
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="flex justify-end border-t border-slate-200 px-5 py-4">
              <Button variant="outline" onClick={() => setChainRecord(null)}>
                Закрыть
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {editing ? (
        <WeldForm
          key={`${editing.record.id ?? 'new'}:${editing.focusField ?? 'form'}`}
          value={editing.record}
          focusField={editing.focusField}
          stampSelectOptions={getWeldFormStampSelectOptions}
          getExternalSaveBlockReason={(draft) => getOfficialStampCompatibilitySaveBlockReason(draft, welderStamps)}
          busy={saveMutation.isPending}
          onCancel={() => setEditing(null)}
          onSave={(value) => saveMutation.mutate({ ...value, status: editing.record.status ?? null, id: editing.record.id })}
        />
      ) : null}

      {isPstoRequestModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/20 px-4 backdrop-blur-[1px]">
          <div className="flex h-[94vh] w-full max-w-[1480px] flex-col rounded-md border border-slate-200 bg-white shadow-2xl shadow-slate-950/10">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold">Создание заявки ПСТО</h2>
                <p className="text-sm text-muted-foreground">
                  {nextPstoRequestName} · Стыков: {selectedHeatTreatmentRows.length}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={openPstoRequestManager}
                  disabled={pstoRequestManagerOptions.length === 0}
                  className="border-sky-300 bg-sky-100 text-sky-900 shadow-sm shadow-sky-100 hover:bg-sky-200 disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  Управление заявками
                </Button>
                <Button variant="ghost" size="icon" onClick={closeCreatePstoRequestModal} aria-label="Закрыть">
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="border-b border-slate-100 px-5 py-4">
              <RequestNamingControls
                naming={pstoRequestNaming}
                systemName={nextPstoRequestName}
                label="Наименование заявки ПСТО"
                onChange={setPstoRequestNaming}
              />
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-hidden px-6 py-5 lg:grid-cols-[300px_minmax(0,1fr)]">
              <section className="min-h-0 space-y-3 overflow-y-auto pr-1">
                <h3 className="text-sm font-semibold text-slate-800">Термообработка</h3>
                <p className="text-xs leading-5 text-slate-500">
                  В заявку можно добавить один или несколько стыков, где ПСТО требуется и заявка еще не создана.
                </p>
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-xs leading-5 text-slate-600">
                  После создания наименование заявки попадет в столбец «Заявка ПСТО», а строка обновит дату «Внесен ПСТО».
                </div>
              </section>

              <section className="flex min-h-0 flex-col space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-800">Стыки</h3>
                    <p className="text-xs leading-5 text-slate-500">
                      Галочка доступна только там, где заявка ПСТО еще не создана.
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={toggleAllPstoRequestRows}>
                    {isEveryFilteredLnkRequestRowSelected(selectedHeatTreatmentIds, filteredAvailablePstoRequestRows)
                      ? 'Снять все'
                      : 'Выбрать доступные'}
                  </Button>
                </div>

                <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
                  <Input
                    value={pstoRequestSearch}
                    onChange={(event) => setPstoRequestSearch(event.target.value)}
                    placeholder="Проект, шифр, линия, спул или стык"
                    className="h-9 min-w-64 flex-1 bg-white"
                  />
                  <span className="whitespace-nowrap px-2 text-xs text-slate-500">
                    Найдено: {filteredPstoRequestRows.length} · Доступно: {filteredAvailablePstoRequestRows.length}
                  </span>
                  {pstoRequestSearch ? (
                    <Button variant="outline" size="sm" onClick={() => setPstoRequestSearch('')}>
                      Очистить
                    </Button>
                  ) : null}
                </div>

                <div className="min-h-0 overflow-auto rounded-md border border-slate-200">
                  {filteredPstoRequestRows.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-slate-500">
                      {heatTreatmentRows.length === 0 ? 'Нет стыков для отчета Термообработка.' : 'По фильтру ничего не найдено.'}
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {filteredPstoRequestRows.map((row) => {
                        const disabled = !canCreatePstoRequest(row)
                        const selected = selectedHeatTreatmentIds.has(row.id)
                        return (
                          <label
                            key={row.id}
                            className={`grid grid-cols-[28px_minmax(220px,1fr)_minmax(180px,0.8fr)] items-center gap-3 px-4 py-3 text-sm transition-colors ${
                              disabled
                                ? 'cursor-not-allowed bg-slate-100 text-slate-400'
                                : selected
                                  ? 'cursor-pointer bg-sky-50/80'
                                  : 'cursor-pointer bg-white hover:bg-slate-50'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => togglePstoRequestRow(row.id)}
                              disabled={disabled}
                              className="h-4 w-4 rounded border-slate-300 text-slate-900"
                            />
                            <span className="min-w-0">
                              <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                                <span className="truncate font-medium text-slate-900">{getJointTitle(row)}</span>
                                <OfficialityBadge row={row} compact />
                              </span>
                              <span className="block text-xs leading-5 text-slate-500">
                                <JointProjectSubtitleMeta row={row} />
                                <MetaSeparator />
                                <JointSpoolDiameterMeta row={row} />
                                <MetaSeparator />
                                <JointWeldDateMeta row={row} />
                              </span>
                              <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                                <span className={`rounded border px-1.5 py-0.5 font-semibold ${getJointStatusBadgeClass(row)}`}>
                                  Стык: {getJointStatusLabel(row)}
                                </span>
                                <span className={`rounded border px-1.5 py-0.5 font-semibold ${getPstoResultBadgeClass(row.pstoResult)}`}>
                                  ПСТО: {getPstoResultLabel(row.pstoResult)}
                                </span>
                              </span>
                            </span>
                            <span className="flex flex-wrap gap-1.5">
                              {disabled ? (
                                <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-500">
                                  {String(row.pstoRequest ?? '').trim() || 'Заявка уже создана'}
                                </span>
                              ) : (
                                <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-600">
                                  ПСТО
                                </span>
                              )}
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  )}
                </div>
              </section>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200/80 px-5 py-4">
              <Button variant="outline" onClick={closeCreatePstoRequestModal}>
                Отмена
              </Button>
              <Button onClick={submitCreatePstoRequest} disabled={pstoRequestMutation.isPending || selectedHeatTreatmentRows.length === 0}>
                <Check className="mr-2 h-4 w-4" />
                Создать заявку
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {isPstoRequestManagerOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/30 px-4 backdrop-blur-[1px]">
          <div className="flex max-h-[90vh] w-full max-w-[920px] flex-col rounded-md border border-slate-200 bg-white shadow-2xl shadow-slate-950/20">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold">Управление заявками ПСТО</h2>
                <p className="text-sm text-muted-foreground">Переименование и удаление уже созданных заявок.</p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setIsPstoRequestManagerOpen(false)} aria-label="Закрыть">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="min-h-0 space-y-4 overflow-auto px-5 py-4">
              <label className="block space-y-1.5 text-sm">
                <span className="text-[13px] font-medium leading-none text-slate-700">Заявка ПСТО</span>
                <Select value={managedPstoRequestName} onChange={(event) => changeManagedPstoRequest(event.target.value)}>
                  <option value="">Выберите заявку</option>
                  {pstoRequestManagerOptions.map((requestName) => (
                    <option key={requestName} value={requestName}>
                      {requestName}
                    </option>
                  ))}
                </Select>
              </label>

              {managedPstoRequestName ? (
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-semibold text-slate-800">Используется:</span>
                    <span className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600">
                      Стыков: {managedPstoRequestRows.length}
                    </span>
                    <span className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600">
                      С результатом: {managedPstoRequestRows.filter((row) => hasText(row.pstoResult)).length}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                  Созданных заявок ПСТО пока нет.
                </div>
              )}

              <div className="rounded-md border border-slate-200 bg-white p-3">
                <h3 className="mb-3 text-sm font-semibold text-slate-800">Переименовать заявку</h3>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    value={managedPstoRequestNameDraft}
                    onChange={(event) => setManagedPstoRequestNameDraft(event.target.value)}
                    placeholder="Новое наименование заявки"
                    disabled={!managedPstoRequestName || pstoRequestManagerMutation.isPending}
                    className="h-10 flex-1"
                  />
                  <Button
                    onClick={renameManagedPstoRequest}
                    disabled={
                      !managedPstoRequestName ||
                      !managedPstoRequestNameDraft.trim() ||
                      managedPstoRequestNameDraft.trim() === managedPstoRequestName ||
                      pstoRequestManagerMutation.isPending
                    }
                  >
                    <Pencil className="mr-2 h-4 w-4" />
                    Переименовать
                  </Button>
                </div>
              </div>

              <div className="rounded-md border border-slate-200 bg-white p-3">
                <div className="mb-3">
                  <h3 className="text-sm font-semibold text-slate-800">Очистить конкретный стык</h3>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    Можно удалить заявку только у выбранного стыка, не затрагивая остальные стыки этой заявки.
                  </p>
                </div>
                {managedPstoRequestName && managedPstoRequestRows.length > 0 ? (
                  <div className="max-h-72 overflow-auto rounded-md border border-slate-200">
                    <div className="divide-y divide-slate-100">
                      {managedPstoRequestRows.map((row) => (
                        <div
                          key={row.id}
                          className="grid grid-cols-[minmax(220px,1fr)_auto] items-center gap-3 px-3 py-2.5 text-sm"
                        >
                          <div className="min-w-0">
                            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                              <span className="truncate font-medium text-slate-900">{getJointTitle(row)}</span>
                              <OfficialityBadge row={row} compact />
                            </div>
                            <div className="text-xs leading-5 text-slate-500">
                              <JointProjectSubtitleMeta row={row} />
                              <MetaSeparator />
                              <JointSpoolDiameterMeta row={row} />
                              <MetaSeparator />
                              <JointWeldDateMeta row={row} />
                              <MetaSeparator />
                              Результат: {getPstoResultLabel(row.pstoResult)}
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => clearManagedPstoRequestPosition(row)}
                            disabled={pstoRequestCorrectionMutation.isPending}
                            className="border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100"
                          >
                            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                            Очистить
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-5 text-center text-sm text-slate-500">
                    Выберите заявку, чтобы увидеть ее стыки.
                  </div>
                )}
              </div>

              <div className="rounded-md border border-rose-200 bg-rose-50/60 p-3">
                <h3 className="mb-1 text-sm font-semibold text-rose-900">Удалить заявку</h3>
                <p className="mb-3 text-xs leading-5 text-rose-800">
                  Будут очищены заявка, результат, дата и диаграмма ПСТО по всем стыкам, где используется выбранная заявка.
                </p>
                <Button
                  variant="outline"
                  onClick={deleteManagedPstoRequest}
                  disabled={!managedPstoRequestName || pstoRequestManagerMutation.isPending}
                  className="border-rose-300 bg-white text-rose-800 hover:bg-rose-50"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Удалить выбранную заявку
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {isPstoResultModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/20 px-4 backdrop-blur-[1px]">
          <div className="flex h-[94vh] w-full max-w-[1480px] flex-col rounded-md border border-slate-200 bg-white shadow-2xl shadow-slate-950/10">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold">Добавление результата ПСТО</h2>
                <p className="text-sm text-muted-foreground">
                  Заявка: {pstoResultDraft.requestName || '-'} · Выбрано: {pstoResultDraft.rowIds.size}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={openPstoResultManager}
                  disabled={pstoResultDraft.rowIds.size === 0}
                  className="border-sky-300 bg-sky-100 text-sky-900 shadow-sm shadow-sky-100 hover:bg-sky-200 disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  Редактировать результаты
                </Button>
                <Button variant="ghost" size="icon" onClick={closeAddPstoResultModal} aria-label="Закрыть">
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-hidden px-6 py-5 lg:grid-cols-[340px_minmax(0,1fr)]">
              <section className="min-h-0 space-y-3 overflow-y-auto pr-1">
                <div className="rounded-md border border-slate-200 bg-white p-3">
                  <h3 className="mb-3 text-sm font-semibold text-slate-800">1. Результат ПСТО</h3>
                  <div className="grid grid-cols-1 gap-3">
                  <label className="block space-y-1.5 text-sm">
                    <span className="text-[13px] font-medium leading-none text-slate-700">Дата ПСТО</span>
                    <Input
                      type="date"
                      value={pstoResultDraft.pstoDate}
                      disabled={pstoResultDraft.result === PSTO_EMPTY_RESULT_VALUE}
                      onChange={(event) => setPstoResultDraft((current) => ({ ...current, pstoDate: event.target.value }))}
                    />
                  </label>

                  <label className="block space-y-1.5 text-sm">
                    <span className="text-[13px] font-medium leading-none text-slate-700">Результат</span>
                    <Select
                      value={pstoResultDraft.result}
                      onChange={(event) => setPstoResultDraft((current) => ({ ...current, result: event.target.value }))}
                    >
                      <option value="">Выберите результат</option>
                      <option value="проведено">проведено</option>
                      <option value={PSTO_EMPTY_RESULT_VALUE}>аннулировать</option>
                    </Select>
                  </label>
                  </div>
                </div>

                <div
                  className={`rounded-md border border-slate-200 p-3 ${
                    pstoResultDraft.result === PSTO_EMPTY_RESULT_VALUE ? 'bg-slate-50 opacity-60' : 'bg-white'
                  }`}
                >
                  <RequestNamingControls
                    naming={pstoResultDraft.diagramNaming}
                    systemName={nextPstoDiagramName}
                    label="Диаграмма термообработки"
                    placeholder="Введите наименование диаграммы"
                    disabled={pstoResultDraft.result === PSTO_EMPTY_RESULT_VALUE}
                    onChange={(diagramNaming) => setPstoResultDraft((current) => ({ ...current, diagramNaming }))}
                  />
                </div>

                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-xs leading-5 text-slate-600">
                  Результат «проведено» заполнит дату ПСТО и диаграмму термообработки. Если выбрать «аннулировать», результат,
                  дата и диаграмма очистятся, заявка ПСТО останется.
                </div>
              </section>

              <section className="flex min-h-0 flex-col space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-800">
                      {pstoResultDraft.requestName ? 'Стыки в выбранной заявке' : 'Стыки для результата'}
                    </h3>
                    <p className="text-xs leading-5 text-slate-500">
                      {pstoResultDraft.requestName
                        ? 'Видны проект, шифр, линия, спул и номер стыка для проверки перед сохранением.'
                        : 'Найдите стык, посмотрите его заявку ПСТО и статус стыка, затем выберите нужную заявку.'}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={toggleAllPstoResultRows} disabled={filteredPstoResultRows.length === 0}>
                    {isEveryFilteredLnkRequestRowSelected(
                      pstoResultDraft.rowIds,
                      filteredPstoResultRows.filter((row) => canSelectPstoResultRow(row, pstoResultDraft.requestName)),
                    )
                      ? 'Снять все'
                      : 'Выбрать все'}
                  </Button>
                </div>

                <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
                  <Input
                    value={pstoResultDraft.search}
                    onChange={(event) => setPstoResultDraft((current) => ({ ...current, search: event.target.value }))}
                    placeholder="Проект, шифр, линия, спул или стык"
                    className="h-9 min-w-56 flex-[0.8] bg-white"
                  />
                  <Input
                    value={pstoResultRequestSearch}
                    onChange={(event) => setPstoResultRequestSearch(event.target.value)}
                    placeholder="Поиск заявки"
                    className="h-9 min-w-44 flex-[0.45] bg-white"
                  />
                  <Select
                    value={pstoResultDraft.requestName}
                    onChange={(event) => changePstoResultRequest(event.target.value)}
                    className="h-9 min-w-48 flex-[0.5] bg-white"
                  >
                    <option value="">Все заявки</option>
                    {filteredPstoResultRequestOptions.map((requestName) => (
                      <option key={requestName} value={requestName}>
                        {requestName}
                      </option>
                    ))}
                  </Select>
                  {pstoResultRequestSearch ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setPstoResultRequestSearch('')}
                      className="h-9 px-2"
                      aria-label="Очистить поиск заявки"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  ) : null}
                  <span className="whitespace-nowrap px-2 text-xs text-slate-500">
                    Заявок: {filteredPstoResultRequestOptions.length}/{pstoResultAvailableRequestOptions.length}
                  </span>
                  <span className="whitespace-nowrap px-2 text-xs text-slate-500">
                    Найдено: {filteredPstoResultRows.length} · Выбрано: {pstoResultDraft.rowIds.size}
                  </span>
                  {pstoResultDraft.search || pstoResultRequestSearch ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setPstoResultRequestSearch('')
                        setPstoResultDraft((current) => ({
                          ...current,
                          requestName: '',
                          rowIds: new Set(),
                          search: '',
                        }))
                      }}
                    >
                      Очистить
                    </Button>
                  ) : null}
                </div>

                <div className="min-h-0 overflow-auto rounded-md border border-slate-200">
                  {filteredPstoResultRows.length === 0 ? (
                    <div className="flex min-h-72 items-center justify-center px-4 py-10 text-center text-sm text-slate-500">
                      {pstoResultDraft.search || pstoResultRequestSearch ? 'По фильтру ничего не найдено.' : 'Нет стыков для добавления результата ПСТО.'}
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {filteredPstoResultRows.map((row) => {
                        const selected = pstoResultDraft.rowIds.has(row.id)
                        const disabled = !canSelectPstoResultRow(row, pstoResultDraft.requestName)
                        const requestName = String(row.pstoRequest ?? '').trim()
                        const diagramName = String(row.heatTreatmentDiagram ?? '').trim()
                        return (
	                          <div
	                            key={row.id}
	                            onClick={() => {
	                              if (!disabled) togglePstoResultRow(row.id)
	                            }}
                            className={`grid grid-cols-[28px_minmax(260px,1fr)_minmax(220px,0.8fr)] gap-3 px-4 py-3 text-sm transition-colors ${
                              disabled
                                ? 'cursor-not-allowed bg-slate-100 text-slate-400'
                                : selected
                                  ? 'cursor-pointer border-l-4 border-emerald-400 bg-emerald-100/80 shadow-[inset_0_0_0_1px_rgba(52,211,153,0.35)]'
                                  : 'cursor-pointer bg-white hover:bg-slate-50'
                            }`}
                          >
	                            <input
	                              type="checkbox"
	                              checked={selected}
	                              onClick={(event) => event.stopPropagation()}
	                              onChange={() => togglePstoResultRow(row.id)}
	                              disabled={disabled}
	                              className="mt-1 h-4 w-4 rounded border-slate-300 text-slate-900"
                            />
                            <span className="min-w-0">
                              <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                                <span className="truncate font-medium text-slate-900">{getJointTitle(row)}</span>
                                <OfficialityBadge row={row} compact />
                              </span>
                              <span className="block text-xs leading-5 text-slate-500">
                                <JointProjectSubtitleMeta row={row} />
                              </span>
	                              <span className="block text-xs leading-5 text-slate-500">
	                                <JointSpoolDiameterMeta row={row} />
                                  <MetaSeparator />
                                  <JointWeldDateMeta row={row} />
	                              </span>
                              <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                                <span className={`rounded border px-1.5 py-0.5 font-semibold ${getJointStatusBadgeClass(row)}`}>
                                  Стык: {getJointStatusLabel(row)}
                                </span>
                                <span className={`rounded border px-1.5 py-0.5 font-semibold ${getPstoResultBadgeClass(row.pstoResult)}`}>
                                  ПСТО: {getPstoResultLabel(row.pstoResult)}
                                </span>
                              </span>
                              {disabled ? (
                                <span className="mt-1 block text-xs leading-5 text-slate-500">
                                  {requestName ? 'Выберите эту заявку ПСТО, чтобы отметить стык.' : 'На этот стык еще нет заявки ПСТО.'}
                                </span>
                              ) : null}
                            </span>
                            <span className="flex flex-wrap content-start gap-1.5">
                              {requestName ? (
                                <span className={`inline-flex max-w-full flex-col gap-0.5 rounded border px-2 py-1 text-xs font-medium ${getPstoResultBadgeClass(row.pstoResult)}`}>
                                  <span className="max-w-full overflow-visible break-all whitespace-normal [text-overflow:clip]">ПСТО {requestName}</span>
                                  {diagramName ? (
                                    <span className="max-w-full overflow-visible break-all whitespace-normal text-[11px] text-slate-500 [text-overflow:clip]">
                                      {diagramName}
                                    </span>
                                  ) : null}
                                </span>
                              ) : (
                                <span className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">
                                  Нет заявки
                                </span>
                              )}
                            </span>
	                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </section>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-slate-200/80 px-5 py-4">
              <div className="min-h-5 text-sm text-slate-500">
                {pstoResultSaveBlockReason ? (
                  <span className="text-sm text-slate-500">
                    Чтобы сохранить: {pstoResultSaveBlockReason}
                  </span>
                ) : null}
              </div>
              <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={closeAddPstoResultModal}>
                Отмена
              </Button>
              <span title={pstoResultSaveBlockReason || 'Можно сохранить результат'}>
                <Button
                  onClick={handleAddPstoResult}
                  disabled={Boolean(pstoResultSaveBlockReason)}
                  className={pstoResultSaveBlockReason ? 'pointer-events-none' : ''}
                >
                  <Check className="mr-2 h-4 w-4" />
                  Сохранить результат
                </Button>
              </span>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {isPstoResultManagerOpen ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/30 px-4 backdrop-blur-[1px]">
          <div className="flex max-h-[92vh] w-full max-w-[1180px] flex-col rounded-md border border-slate-200 bg-white shadow-2xl shadow-slate-950/20">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold">Редактирование результатов ПСТО</h2>
                <p className="text-sm text-muted-foreground">
                  Переименование диаграммы или удаление результата вместе с датой и диаграммой.
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setIsPstoResultManagerOpen(false)
                  setManagedPstoDiagramDrafts({})
                }}
                aria-label="Закрыть"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-hidden px-5 py-4 lg:grid-cols-[320px_minmax(0,1fr)]">
              <section className="min-h-0 space-y-3 overflow-y-auto pr-1">
                <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3">
                  <h3 className="mb-3 text-sm font-semibold text-slate-800">Что редактируем</h3>
                  <div className="space-y-2 text-sm text-slate-600">
                    <div className="rounded border border-slate-200 bg-white px-3 py-2">
                      Выбрано стыков: <span className="font-semibold text-slate-900">{managedPstoResultRows.length}</span>
                    </div>
                    <div className="rounded border border-slate-200 bg-white px-3 py-2">
                      С результатом:{' '}
                      <span className="font-semibold text-slate-900">
                        {managedPstoResultRows.filter((row) => hasText(row.pstoResult)).length}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-xs leading-5 text-slate-600">
                  Переименование меняет только номер диаграммы у конкретного стыка. Удаление очищает результат, дату ПСТО и
                  диаграмму, но оставляет заявку ПСТО.
                </div>
              </section>

              <section className="min-h-0 overflow-auto rounded-md border border-slate-200">
                {managedPstoResultRows.length > 0 ? (
                  <div className="divide-y divide-slate-100">
                    {managedPstoResultRows.map((row) => {
                      const requestName = String(row.pstoRequest ?? '').trim()
                      const pstoDate = String(row.pstoDate ?? '').trim()
                      const diagramName = String(row.heatTreatmentDiagram ?? '').trim()
                      const diagramDraft = managedPstoDiagramDrafts[row.id] ?? diagramName
                      return (
                        <div key={row.id} className="grid grid-cols-[minmax(420px,1fr)_minmax(230px,0.45fr)] gap-4 px-4 py-3 text-sm">
                          <div className="min-w-0">
                            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                              <span className="font-medium text-slate-900">{getJointTitle(row)}</span>
                              <OfficialityBadge row={row} compact />
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                              <span>
                                <JointProjectSubtitleMeta row={row} />
                                <MetaSeparator />
                                <JointSpoolDiameterMeta row={row} />
                                <MetaSeparator />
                                <JointWeldDateMeta row={row} />
                              </span>
                              <span className={`rounded border px-2 py-0.5 text-xs font-semibold ${getJointStatusBadgeClass(row)}`}>
                                Стык: {getJointStatusLabel(row)}
                              </span>
                              <span className={`rounded border px-2 py-0.5 text-xs font-semibold ${getPstoResultBadgeClass(row.pstoResult)}`}>
                                ПСТО: {getPstoResultLabel(row.pstoResult)}
                              </span>
                            </div>
                            <div className="mt-1 text-xs leading-5 text-slate-500">
                              <span className="font-medium text-slate-700">Заявка:</span> <span className="break-words">{requestName || '-'}</span>
                              <span className="mx-1 text-slate-300">·</span>
                              <span className="font-medium text-slate-700">Дата:</span> {pstoDate || '-'}
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <Input
                                value={diagramDraft}
                                onChange={(event) =>
                                  setManagedPstoDiagramDrafts((current) => ({ ...current, [row.id]: event.target.value }))
                                }
                                placeholder="Наименование диаграммы для этого стыка"
                                disabled={pstoResultCorrectionMutation.isPending}
                                className="h-8 min-w-72 max-w-xl flex-1 bg-white text-xs"
                              />
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => renameManagedPstoDiagram(row)}
                                disabled={
                                  pstoResultCorrectionMutation.isPending ||
                                  !diagramDraft.trim() ||
                                  diagramDraft.trim() === diagramName
                                }
                                className="h-8"
                              >
                                <Pencil className="mr-1.5 h-3.5 w-3.5" />
                                Переименовать
                              </Button>
                            </div>
                          </div>
                          <div className="flex flex-col items-end justify-start gap-2">
                            <span className={`rounded border px-2 py-1 text-xs font-semibold ${getPstoResultBadgeClass(row.pstoResult)}`}>
                              Сейчас: {getPstoResultLabel(row.pstoResult)}
                            </span>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => deleteManagedPstoResult(row)}
                              disabled={
                                pstoResultCorrectionMutation.isPending ||
                                (!hasText(row.pstoResult) && !hasText(row.pstoDate) && !hasText(row.heatTreatmentDiagram))
                              }
                              className="border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100"
                            >
                              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                              Удалить результат
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="flex min-h-72 items-center justify-center px-4 py-10 text-center text-sm text-slate-500">
                    Выберите стыки с результатом ПСТО в окне добавления результата.
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      ) : null}

      {isLnkRequestModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/20 px-4 backdrop-blur-[1px]">
          <div className="flex max-h-[92vh] w-full max-w-[1320px] flex-col rounded-md border border-slate-200 bg-white shadow-2xl shadow-slate-950/10">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold">Создание заявки ЛНК</h2>
                <p className="text-sm text-muted-foreground">
                  {nextLnkRequestName} · Стыков: {selectedLnkRows.length} · Позиций: {selectedLnkRequestTargetCount}
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={closeCreateLnkRequestModal} aria-label="Закрыть">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="border-b border-slate-100 px-5 py-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
                <div className="min-w-0 flex-1">
                  <RequestNamingControls
                    naming={lnkRequestNaming}
                    systemName={nextLnkRequestName}
                    label="Наименование заявки ЛНК"
                    onChange={setLnkRequestNaming}
                  />
                </div>
                <Button
                  variant="outline"
                  onClick={openLnkRequestManager}
                  disabled={lnkRequestManagerOptions.length === 0}
                  className="shrink-0 border-sky-300 bg-sky-100 text-sky-900 shadow-sm shadow-sky-100 hover:bg-sky-200 disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  Управление заявками
                </Button>
              </div>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-hidden px-6 py-5 lg:grid-cols-[300px_minmax(0,1fr)]">
              <section className="min-h-0 space-y-3 overflow-y-auto pr-1">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-slate-800">Виды контроля</h3>
                  <span className="text-xs text-slate-500">{selectedLnkMethodKeys.length}/{LNK_METHODS.length}</span>
                </div>
                <p className="text-xs leading-5 text-slate-500">
                  Выберите один или несколько видов контроля для этой заявки.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {LNK_METHODS.map((method) => (
                    <button
                      key={method.requestKey}
                      type="button"
                      onClick={() => toggleLnkRequestMethod(method.requestKey)}
                      className={`inline-flex h-10 items-center justify-center rounded-md border px-3 text-sm font-medium transition-colors ${
                        lnkRequestDraft.methods.has(method.requestKey)
                          ? 'border-sky-300 bg-sky-100 text-sky-900 shadow-sm shadow-sky-100'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {method.code}
                    </button>
                  ))}
                </div>
              </section>

              <section className="flex min-h-0 flex-col space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-800">Стыки</h3>
                    <p className="text-xs leading-5 text-slate-500">
                      Галочка доступна только там, где есть хотя бы один вид контроля без заявки.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={toggleAllLnkRequestRows}
                    disabled={!lnkRequestSearch.trim() || filteredAvailableLnkRequestRows.length === 0}
                    title={!lnkRequestSearch.trim() ? 'Сначала сузьте список поиском' : undefined}
                  >
                    {isEveryFilteredLnkRequestRowSelected(selectedLnkIds, filteredAvailableLnkRequestRows)
                      ? 'Снять все'
                      : 'Выбрать доступные'}
                  </Button>
                </div>

                <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
                  <Input
                    value={lnkRequestSearch}
                    onChange={(event) => setLnkRequestSearch(event.target.value)}
                    placeholder="Линия, спул или стык"
                    className="h-9 min-w-64 flex-1 bg-white"
                  />
                  <span className="whitespace-nowrap px-2 text-xs text-slate-500">
                    Найдено: {filteredLnkRequestRows.length} · Доступно: {filteredAvailableLnkRequestRows.length}
                  </span>
                  {lnkRequestSearch ? (
                    <Button variant="outline" size="sm" onClick={() => setLnkRequestSearch('')}>
                      Очистить
                    </Button>
                  ) : null}
                </div>

                <div className="min-h-0 overflow-auto rounded-md border border-slate-200">
                  {filteredAvailableLnkRequestRows.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-slate-500">
                      {lnkRows.length === 0
                        ? 'Нет стыков для отчета ЛНК.'
                        : filteredLnkRequestRows.length === 0
                          ? 'По фильтру ничего не найдено.'
                          : 'По найденным стыкам нет доступных методов для новой заявки.'}
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {filteredAvailableLnkRequestRows.map((row) => {
                        const availableMethods = getAvailableLnkRequestMethods(row)
                        const existingMethods = getLnkRowRequestMethods(row, '')
                        const disabled = availableMethods.length === 0
                        const selected = selectedLnkIds.has(row.id)
                        return (
                          <label
                            key={row.id}
                            className={`grid grid-cols-[28px_minmax(180px,1fr)_minmax(220px,1.4fr)] items-center gap-3 px-4 py-3 text-sm transition-colors ${
                              disabled
                                ? 'cursor-not-allowed bg-slate-100 text-slate-400'
                                : selected
                                  ? 'cursor-pointer bg-emerald-50/80'
                                  : 'cursor-pointer bg-white hover:bg-slate-50'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => toggleLnkRequestRow(row.id)}
                              disabled={disabled}
                              className="h-4 w-4 rounded border-slate-300 text-slate-900"
                            />
                            <span className="min-w-0">
                              <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                                <span className="truncate font-medium text-slate-900">{getJointTitle(row)}</span>
                                <OfficialityBadge row={row} compact />
                              </span>
                              <span className="block text-xs leading-5 text-slate-500">
                                <JointProjectSubtitleMeta row={row} />
                                <MetaSeparator />
                                <JointSpoolDiameterMeta row={row} />
                                <MetaSeparator />
                                <JointWeldDateMeta row={row} />
                              </span>
                            </span>
                            <span className="flex flex-wrap gap-1.5">
                              {availableMethods.length > 0 ? (
                                availableMethods.map((method) => {
                                  const isSelectedMethod = selected && lnkRequestDraft.methods.has(method.requestKey)
                                  return (
                                    <span
                                      key={method.requestKey}
                                      className={`rounded border px-2 py-1 text-xs font-medium ${
                                        isSelectedMethod
                                          ? 'border-sky-300 bg-sky-100 text-sky-900'
                                          : 'border-slate-200 bg-slate-50 text-slate-600'
                                      }`}
                                    >
                                      {method.code}
                                    </span>
                                  )
                                })
                              ) : (
                                <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-500">
                                  Все заявки уже созданы
                                </span>
                              )}
                              {existingMethods.map((method) => (
                                <span
                                  key={`${method.requestKey}-existing`}
                                  className="inline-flex max-w-full flex-wrap items-center gap-1 overflow-visible rounded border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-medium text-sky-800"
                                  title={`${method.code}: ${String(row[method.requestKey] ?? '')}`}
                                >
                                  <span>{method.code}</span>
                                  <span className="overflow-visible break-all whitespace-normal text-sky-600 [text-overflow:clip]">
                                    {String(row[method.requestKey] ?? '')}
                                  </span>
                                </span>
                              ))}
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  )}
                </div>
              </section>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200/80 px-5 py-4">
              <Button variant="outline" onClick={closeCreateLnkRequestModal}>
                Отмена
              </Button>
              <Button
                onClick={handleCreateLnkRequest}
                disabled={lnkRequestMutation.isPending || selectedLnkRequestTargetCount === 0}
              >
                <Check className="mr-2 h-4 w-4" />
                Создать заявку
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {isLnkRequestManagerOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/30 px-4 backdrop-blur-[1px]">
          <div className="flex max-h-[90vh] w-full max-w-[920px] flex-col rounded-md border border-slate-200 bg-white shadow-2xl shadow-slate-950/20">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold">Управление заявками ЛНК</h2>
                <p className="text-sm text-muted-foreground">Переименование и удаление уже созданных заявок.</p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setIsLnkRequestManagerOpen(false)} aria-label="Закрыть">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="min-h-0 space-y-4 overflow-auto px-5 py-4">
              <label className="block space-y-1.5 text-sm">
                <span className="text-[13px] font-medium leading-none text-slate-700">Заявка ЛНК</span>
                <Select value={managedLnkRequestName} onChange={(event) => changeManagedLnkRequest(event.target.value)}>
                  <option value="">Выберите заявку</option>
                  {lnkRequestManagerOptions.map((requestName) => (
                    <option key={requestName} value={requestName}>
                      {requestName}
                    </option>
                  ))}
                </Select>
              </label>

              {managedLnkRequestName ? (
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-semibold text-slate-800">Используется:</span>
                    <span className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600">
                      Стыков: {managedLnkRequestRows.length}
                    </span>
                    <span className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600">
                      Позиций:{' '}
                      {LNK_METHODS.reduce(
                        (count, method) =>
                          count + managedLnkRequestRows.filter((row) => String(row[method.requestKey] ?? '').trim() === managedLnkRequestName).length,
                        0,
                      )}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {managedLnkRequestMethods.map((method) => (
                      <span
                        key={method.requestKey}
                        className="rounded border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-medium text-sky-800"
                      >
                        {method.code}:{' '}
                        {managedLnkRequestRows.filter((row) => String(row[method.requestKey] ?? '').trim() === managedLnkRequestName).length}
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                  Созданных заявок ЛНК пока нет.
                </div>
              )}

              <div className="rounded-md border border-slate-200 bg-white p-3">
                <h3 className="mb-3 text-sm font-semibold text-slate-800">Переименовать заявку</h3>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    value={managedLnkRequestNameDraft}
                    onChange={(event) => setManagedLnkRequestNameDraft(event.target.value)}
                    placeholder="Новое наименование заявки"
                    disabled={!managedLnkRequestName || lnkRequestManagerMutation.isPending}
                    className="h-10 flex-1"
                  />
                  <Button
                    onClick={renameManagedLnkRequest}
                    disabled={
                      !managedLnkRequestName ||
                      !managedLnkRequestNameDraft.trim() ||
                      managedLnkRequestNameDraft.trim() === managedLnkRequestName ||
                      lnkRequestManagerMutation.isPending
                    }
                  >
                    <Pencil className="mr-2 h-4 w-4" />
                    Переименовать
                  </Button>
                </div>
              </div>

              <div className="rounded-md border border-slate-200 bg-white p-3">
                <div className="mb-3">
                  <h3 className="text-sm font-semibold text-slate-800">Очистить конкретную позицию</h3>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    Можно удалить заявку только у выбранного стыка и метода контроля, не затрагивая остальные позиции заявки.
                  </p>
                </div>
                {managedLnkRequestName && managedLnkRequestRows.length > 0 ? (
                  <div className="max-h-72 overflow-auto rounded-md border border-slate-200">
                    <div className="divide-y divide-slate-100">
                      {managedLnkRequestRows.map((row) => {
                        const methods = getLnkRowRequestMethods(row, managedLnkRequestName)
                        return (
                          <div
                            key={row.id}
                            className="grid grid-cols-[minmax(220px,1fr)_minmax(220px,1.2fr)] gap-3 px-3 py-2.5 text-sm"
                          >
                            <div className="min-w-0">
                              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                <span className="truncate font-medium text-slate-900">{getJointTitle(row)}</span>
                                <OfficialityBadge row={row} compact />
                              </div>
                              <div className="text-xs leading-5 text-slate-500">
                                <JointProjectSubtitleMeta row={row} />
                                <MetaSeparator />
                                <JointSpoolDiameterMeta row={row} />
                                <MetaSeparator />
                                <JointWeldDateMeta row={row} />
                              </div>
                            </div>
                            <div className="flex flex-wrap justify-end gap-1.5">
                              {methods.map((method) => (
                                <button
                                  key={method.requestKey}
                                  type="button"
                                  onClick={() => clearManagedLnkRequestPosition(row, method.requestKey)}
                                  disabled={lnkRequestCorrectionMutation.isPending}
                                  className="inline-flex items-center gap-1.5 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-800 transition-colors hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                                  title={`Очистить ${method.code} только для этого стыка`}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  {method.code}
                                </button>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-5 text-center text-sm text-slate-500">
                    Выберите заявку, чтобы увидеть ее стыки и методы контроля.
                  </div>
                )}
              </div>

              <div className="rounded-md border border-rose-200 bg-rose-50/60 p-3">
                <h3 className="mb-1 text-sm font-semibold text-rose-900">Удалить заявку</h3>
                <p className="mb-3 text-xs leading-5 text-rose-800">
                  Будут очищены заявка, результат, дата и заключение ЛНК по всем стыкам, где используется выбранная заявка.
                </p>
                <Button
                  variant="outline"
                  onClick={deleteManagedLnkRequest}
                  disabled={!managedLnkRequestName || lnkRequestManagerMutation.isPending}
                  className="border-rose-300 bg-white text-rose-800 hover:bg-rose-50"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Удалить выбранную заявку
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {isLnkResultManagerOpen ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/30 px-4 backdrop-blur-[1px]">
          <div className="flex max-h-[92vh] w-full max-w-[1320px] flex-col rounded-md border border-slate-200 bg-white shadow-2xl shadow-slate-950/20">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold">Редактирование результатов ЛНК</h2>
                <p className="text-sm text-muted-foreground">Замена результата или удаление результата вместе с датой и заключением.</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setIsLnkResultManagerOpen(false)
                  setManagedLnkResultOrderIds(null)
                  setManagedLnkResultPreview(null)
                  setManagedLnkResultChangeHint(null)
                  setManagedLnkPendingResultChanges({})
                }}
                aria-label="Закрыть"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-hidden px-5 py-4 lg:grid-cols-[360px_minmax(0,1fr)]">
              <section className="min-h-0 space-y-3 overflow-y-auto pr-1">
                <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3">
                  <h3 className="mb-3 text-sm font-semibold text-slate-800">Что редактируем</h3>
                  <div className="space-y-3">
                    <div className="rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                      Выбрано стыков: <span className="font-semibold text-slate-900">{managedLnkResultRows.length}</span>
                    </div>

                    <label className="block space-y-1.5 text-sm">
                      <span className="text-[13px] font-medium leading-none text-slate-700">Метод контроля</span>
                      <Select
                        value={managedLnkResultMethodKey}
                        onChange={(event) => {
                          setManagedLnkResultMethodKey(event.target.value as WeldFieldKey)
                          setManagedLnkPendingResultChanges({})
                          setManagedLnkResultChangeHint(null)
                          setManagedLnkResultPreview(null)
                        }}
                        disabled={managedLnkResultMethods.length === 0}
                      >
                        <option value="">Все методы</option>
                        {managedLnkResultMethods.map((method) => (
                          <option key={method.requestKey} value={method.requestKey}>
                            {method.code}
                          </option>
                        ))}
                      </Select>
                    </label>
                  </div>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-xs leading-5 text-slate-600">
                  Замена меняет только результат и сохраняет существующее заключение. Наименование заключения редактируется отдельно у
                  конкретного стыка. Удаление очищает результат, дату контроля и заключение.
                </div>
              </section>

              <section className="min-h-0 overflow-auto rounded-md border border-slate-200">
                {managedLnkResultEntries.length > 0 ? (
                  <div className="divide-y divide-slate-100">
                    {managedLnkResultEntries
                      .map(({ row, method, changeKey }) => {
                        const currentResult = String(row[method.resultKey] ?? '').trim()
                        const conclusionName = String(row[method.conclusionKey] ?? '').trim()
                        const conclusionDate = String(row[method.conclusionDateKey] ?? '').trim()
                        const conclusionDraft = managedLnkConclusionDrafts[changeKey] ?? conclusionName
                        const previewResult = managedLnkResultPreview?.changeKey === changeKey ? managedLnkResultPreview.result : ''
                        const pendingResult = managedLnkPendingResultChanges[changeKey] ?? ''
                        const changeHint = pendingResult && pendingResult !== currentResult
                          ? { changeKey, rowId: row.id, methodKey: method.requestKey, from: currentResult, to: pendingResult }
                          : managedLnkResultChangeHint?.changeKey === changeKey
                            ? managedLnkResultChangeHint
                            : null
                        return (
                          <div key={changeKey} className="grid grid-cols-[minmax(520px,1fr)_minmax(260px,0.5fr)] gap-4 px-4 py-3 text-sm">
                            <div className="min-w-0">
                              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                <span className="font-medium text-slate-900">{getJointTitle(row)}</span>
                                <OfficialityBadge row={row} compact />
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                <span>
                                  <JointProjectSubtitleMeta row={row} />
                                  <MetaSeparator />
                                  <JointSpoolDiameterMeta row={row} />
                                  <MetaSeparator />
                                  <JointWeldDateMeta row={row} />
                                </span>
                                {changeHint || (previewResult && previewResult !== currentResult) ? (
                                  <span className="inline-flex items-center gap-1.5">
                                    <span className="font-medium text-slate-500">{pendingResult && pendingResult !== currentResult ? 'Будет:' : 'Проверка:'}</span>
                                    <span className={`rounded border px-2 py-0.5 text-xs font-semibold ${getLnkResultBadgeClass(changeHint?.from || currentResult)}`}>
                                      {changeHint?.from || currentResult || '-'}
                                    </span>
                                    <span className="px-0.5 text-sm font-bold leading-none text-slate-700">→</span>
                                    <span className={`rounded border px-2 py-0.5 text-xs font-semibold ${getLnkResultBadgeClass(changeHint?.to || previewResult)}`}>
                                      {changeHint?.to || previewResult}
                                    </span>
                                  </span>
                                ) : (
                                  <span className={`rounded border px-2 py-0.5 text-xs font-semibold ${currentResult ? getLnkResultBadgeClass(currentResult) : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
                                    Сейчас {method.code}: {currentResult || '-'}
                                  </span>
                                )}
                              </div>
                              {conclusionName || conclusionDate ? (
                                <div className="mt-1 text-xs leading-5 text-slate-500">
                                  <span className="font-medium text-slate-700">Заключение:</span> <span className="break-words">{conclusionName || '-'}</span>
                                  <span className="mx-1 text-slate-300">·</span>
                                  <span className="font-medium text-slate-700">Дата:</span> {conclusionDate || '-'}
                                </div>
                              ) : null}
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <Input
                                  value={conclusionDraft}
                                  onChange={(event) =>
                                    setManagedLnkConclusionDrafts((current) => ({ ...current, [changeKey]: event.target.value }))
                                  }
                                  placeholder="Наименование заключения для этого стыка"
                                  disabled={lnkConclusionCorrectionMutation.isPending}
                                  className="h-8 min-w-72 max-w-xl flex-1 bg-white text-xs"
                                />
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => renameManagedLnkConclusionForRow(row, method.requestKey)}
                                  disabled={
                                    lnkConclusionCorrectionMutation.isPending ||
                                    !conclusionDraft.trim() ||
                                    conclusionDraft.trim() === conclusionName
                                  }
                                  className="h-8"
                                >
                                  <Pencil className="mr-1.5 h-3.5 w-3.5" />
                                  Переименовать
                                </Button>
                              </div>
                            </div>
                            <div className="flex flex-wrap content-start justify-end gap-1.5">
                              <span className="w-full text-right text-xs font-medium text-slate-500">Изменить на:</span>
	                              {LNK_RESULT_OPTIONS.map((option) => {
	                                const disabledByRepairRule = option === 'ремонт' && isLnkRepairForbidden(row)
	                                return (
	                                  <button
	                                    key={option}
	                                    type="button"
	                                    onClick={() => {
	                                      if (!disabledByRepairRule) replaceLnkResult(row, method.requestKey, option)
	                                    }}
	                                    onMouseEnter={() => {
	                                      if (!disabledByRepairRule) setManagedLnkResultPreview({ changeKey, rowId: row.id, methodKey: method.requestKey, result: option })
	                                    }}
	                                    onMouseLeave={() => setManagedLnkResultPreview((current) => (current?.changeKey === changeKey ? null : current))}
	                                    onFocus={() => {
	                                      if (!disabledByRepairRule) setManagedLnkResultPreview({ changeKey, rowId: row.id, methodKey: method.requestKey, result: option })
	                                    }}
	                                    onBlur={() => setManagedLnkResultPreview((current) => (current?.changeKey === changeKey ? null : current))}
	                                    disabled={disabledByRepairRule || lnkResultCorrectionMutation.isPending || lnkResultReplacementMutation.isPending}
	                                    title={disabledByRepairRule ? getLnkRepairForbiddenReason(row) : undefined}
	                                    className={`rounded border px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
	                                      disabledByRepairRule
	                                        ? 'border-slate-200 bg-slate-50 text-slate-400'
	                                        : (pendingResult || currentResult) === option
	                                          ? getLnkResultBadgeClass(option)
	                                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
	                                    }`}
	                                  >
	                                    {option}
	                                  </button>
	                                )
	                              })}
                              <button
                                type="button"
                                onClick={() => clearLnkResult(row, method.requestKey)}
                                disabled={!currentResult || lnkResultCorrectionMutation.isPending || lnkResultReplacementMutation.isPending}
                                className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-800 transition-colors hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                удалить результат
                              </button>
                            </div>
                          </div>
                        )
                      })}
                  </div>
                ) : (
                  <div className="flex min-h-72 items-center justify-center px-4 py-10 text-center text-sm text-slate-500">
                    {managedLnkResultRows.length === 0
                      ? 'Выберите стыки в окне добавления результата.'
                      : 'По выбранным стыкам нет внесенных результатов для редактирования.'}
                  </div>
                )}
              </section>
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-slate-200/80 px-5 py-4">
              <div className="text-sm text-slate-500">
                {managedLnkPendingResultRows.length > 0 ? (
                  <span className="inline-flex rounded border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-800">
                    Подготовлено изменений: {managedLnkPendingResultRows.length}
                  </span>
                ) : (
                  <span className="text-xs">Выберите новый результат, затем сохраните изменения.</span>
                )}
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setManagedLnkPendingResultChanges({})
                    setManagedLnkResultChangeHint(null)
                    setManagedLnkResultPreview(null)
                  }}
                  disabled={managedLnkPendingResultRows.length === 0 || lnkResultReplacementMutation.isPending}
                >
                  Отменить изменения
                </Button>
                <Button
                  onClick={saveManagedLnkResultChanges}
                  disabled={managedLnkPendingResultRows.length === 0 || lnkResultReplacementMutation.isPending}
                >
                  <Check className="mr-2 h-4 w-4" />
                  Сохранить изменения
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {isLnkOfficialityModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/20 px-4 backdrop-blur-[1px]">
          <div className="flex h-[86vh] w-full max-w-[1180px] flex-col rounded-md border border-slate-200 bg-white shadow-2xl shadow-slate-950/10">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold">Официальность стыков</h2>
                <p className="text-sm text-muted-foreground">Выбрано: {lnkOfficialityDraft.rowIds.size}</p>
              </div>
              <Button variant="ghost" size="icon" onClick={closeLnkOfficialityModal} aria-label="Закрыть">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-hidden px-6 py-5 lg:grid-cols-[300px_minmax(0,1fr)]">
              <aside className="space-y-3">
                <section className="rounded-md border border-slate-200 bg-slate-50/60 p-3">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-900">1. Статус</h3>
                    <span className="rounded border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-800">ЛНК</span>
                  </div>
                  <div className="space-y-2">
                    {[
                      {
                        value: 'official' as const,
                        title: 'Официальный',
                        description: 'Рабочий статус по умолчанию. В таблице поле остается пустым.',
                        className: 'border-emerald-200 bg-emerald-50 text-emerald-900',
                      },
                      {
                        value: 'unofficial' as const,
                        title: 'Неофициальный',
                        description: 'Помечает стык как неофициальный для будущих правил и фильтров.',
                        className: 'border-slate-300 bg-slate-100 text-slate-800',
                      },
                    ].map((option) => {
                      const selected = lnkOfficialityDraft.status === option.value
                      const unavailable =
                        option.value === 'unofficial' &&
                        selectedLnkOfficialityRows.length > 0 &&
                        selectedLnkOfficialityRows.some((row) => !hasRejectedLnkResult(row))
                      return (
                        <button
                          key={option.value}
                          type="button"
                          disabled={unavailable}
                          onClick={() => setLnkOfficialityDraft((current) => ({ ...current, status: option.value }))}
                          className={`w-full rounded-md border p-3 text-left transition-colors ${
                            unavailable
                              ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                              : selected
                                ? option.className
                                : 'border-slate-200 bg-white text-slate-700 hover:border-sky-200 hover:bg-sky-50'
                          }`}
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className="text-sm font-semibold">{option.title}</span>
                            {selected ? <Check className="h-4 w-4" /> : null}
                          </span>
                          <span className="mt-1 block text-xs leading-5 opacity-80">
                            {unavailable ? 'Доступно только для стыков с результатом "ремонт" или "вырез".' : option.description}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </section>

                <section className="rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-600">
                  <h3 className="mb-2 text-sm font-semibold text-slate-900">2. Что изменится</h3>
                  <p className="leading-6">
                    Изменяется только поле <span className="font-semibold text-slate-800">Статус</span>. Заявки, результаты, заключения и даты не затрагиваются.
                  </p>
                </section>
              </aside>

              <section className="flex min-h-0 flex-col">
                <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">Стыки</h3>
                    <p className="text-xs text-muted-foreground">Поиск по проекту, шифру, линии, спулу или номеру стыка.</p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setVisibleLnkOfficialityRowsSelected(true)}
                      disabled={filteredLnkOfficialityRows.length === 0}
                    >
                      Выбрать найденные
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setVisibleLnkOfficialityRowsSelected(false)}
                      disabled={lnkOfficialityDraft.rowIds.size === 0}
                    >
                      Снять выбор
                    </Button>
                  </div>
                </div>

                <div className="mb-3 flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  <input
                    value={lnkOfficialityDraft.search}
                    onChange={(event) => setLnkOfficialityDraft((current) => ({ ...current, search: event.target.value }))}
                    placeholder="Проект, шифр, линия, спул или стык"
                    className="h-10 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                  />
                  <span className="shrink-0 text-xs text-slate-500">
                    Найдено: {filteredLnkOfficialityRows.length} · Выбрано: {lnkOfficialityDraft.rowIds.size}
                  </span>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-slate-200">
                  {filteredLnkOfficialityRows.length === 0 ? (
                    <div className="flex min-h-60 items-center justify-center px-4 py-10 text-center text-sm text-slate-500">
                      По фильтру ничего не найдено.
                    </div>
                  ) : (
                    filteredLnkOfficialityRows.map((row) => {
                      const selected = lnkOfficialityDraft.rowIds.has(row.id)
                      return (
                        <button
                          key={row.id}
                          type="button"
                          onClick={() => toggleLnkOfficialityRow(row.id)}
                          className={`flex w-full items-start gap-3 border-b border-slate-100 px-4 py-3 text-left transition-colors last:border-b-0 ${
                            selected ? 'bg-sky-50 ring-1 ring-inset ring-sky-200' : 'bg-white hover:bg-slate-50'
                          }`}
                        >
                          <span
                            className={`mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                              selected ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white'
                            }`}
                          >
                            {selected ? <Check className="h-3 w-3" /> : null}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                              <span className="text-sm font-semibold text-slate-900">{getJointTitle(row)}</span>
                              <OfficialityBadge row={row} compact />
                            </span>
                            <span className="mt-1 block text-xs text-slate-500">
                              <JointProjectSubtitleMeta row={row} />
                              <MetaSeparator />
                              <JointSpoolDiameterMeta row={row} />
                              <MetaSeparator />
                              <JointWeldDateMeta row={row} />
                            </span>
                          </span>
                          <span className={`shrink-0 rounded border px-2 py-1 text-xs font-semibold ${getJointStatusBadgeClass(row)}`}>
                            {getJointStatusLabel(row)}
                          </span>
                        </button>
                      )
                    })
                  )}
                </div>
              </section>
            </div>

            <div className="flex items-center justify-between gap-4 border-t border-slate-200/80 px-6 py-4">
              <div className="text-sm text-slate-500">
                {lnkOfficialitySaveBlockReason ? lnkOfficialitySaveBlockReason : `Будет обновлено стыков: ${selectedLnkOfficialityRows.length}`}
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={closeLnkOfficialityModal}>
                  Отмена
                </Button>
                <Button onClick={saveLnkOfficiality} disabled={isLnkOfficialitySaveDisabled}>
                  <Check className="mr-2 h-4 w-4" />
                  Сохранить статус
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {isLnkResultModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/20 px-4 backdrop-blur-[1px]">
          <div className="flex h-[94vh] w-full max-w-[1480px] flex-col rounded-md border border-slate-200 bg-white shadow-2xl shadow-slate-950/10">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold">Добавление результата ЛНК</h2>
                <p className="text-sm text-muted-foreground">
                  Заявка: {lnkResultDraft.requestName || '-'} · Выбрано: {lnkResultDraft.rowIds.size}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={openLnkResultManager}
                  disabled={lnkResultDraft.rowIds.size === 0}
                  className="border-sky-300 bg-sky-100 text-sky-900 shadow-sm shadow-sky-100 hover:bg-sky-200 disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  Редактировать результаты
                </Button>
                <Button variant="ghost" size="icon" onClick={closeAddLnkResultModal} aria-label="Закрыть">
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-hidden px-6 py-5 lg:grid-cols-[340px_minmax(0,1fr)]">
              <section className="min-h-0 space-y-3 overflow-y-auto pr-1">
                <div className="rounded-md border border-slate-200 bg-white p-3">
                  <h3 className="mb-3 text-sm font-semibold text-slate-800">1. Метод и результат</h3>
                  <div className="grid grid-cols-1 gap-3">
                  <label className="block space-y-1.5 text-sm">
                    <span className="text-[13px] font-medium leading-none text-slate-700">Метод контроля</span>
                    <Select
                      value={lnkResultDraft.methodKey}
                      onChange={(event) => changeLnkResultMethod(event.target.value as WeldFieldKey)}
                      disabled={selectedLnkResultMethods.length === 0}
                      className={!lnkResultDraft.methodKey && selectedLnkResultMethods.length > 0 ? 'text-slate-700' : undefined}
                    >
                      <option value="">Выберите метод</option>
                      {selectedLnkResultMethods.map((method) => (
                        <option key={method.requestKey} value={method.requestKey}>
                          {method.code}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label className="block space-y-1.5 text-sm">
                    <span className="text-[13px] font-medium leading-none text-slate-700">Дата контроля</span>
                    <Input
                      type="date"
                      value={lnkResultDraft.controlDate}
                      disabled={!hasNonEmptyLnkResultDraftRows(selectedLnkResultRows, lnkResultDraft)}
                      onChange={(event) => setLnkResultDraft((current) => ({ ...current, controlDate: event.target.value }))}
                    />
                  </label>

                  <label className="block space-y-1.5 text-sm">
                    <span className="text-[13px] font-medium leading-none text-slate-700">Результат по умолчанию</span>
	                    <Select
	                      value={lnkResultDraft.result}
	                      onChange={(event) => {
	                        const result = event.target.value
	                        if (result === 'ремонт' && selectedLnkResultRows.some(isLnkRepairForbidden)) return
	                        setLnkResultDraft((current) => ({
	                          ...current,
	                          result,
	                          rowResults: {},
	                        }))
	                      }}
	                    >
	                      <option value="">Выберите результат</option>
	                      <option value={LNK_CUSTOM_RESULT_VALUE} disabled>
	                        пользовательский
	                      </option>
	                      {LNK_RESULT_OPTIONS.map((option) => (
	                        <option key={option} value={option} disabled={option === 'ремонт' && selectedLnkResultRows.some(isLnkRepairForbidden)}>
	                          {option}
	                        </option>
	                      ))}
	                    </Select>
	                    {selectedLnkResultRows.some(isLnkRepairForbidden) ? (
	                      <span className="block text-xs text-slate-500">
                          Ремонт недоступен: {getLnkResultRepairForbiddenSummary(selectedLnkResultRows)}.
                        </span>
	                    ) : null}
	                  </label>
                  </div>
                </div>

                <div
                  className={`rounded-md border border-slate-200 p-3 ${
                    !hasNonEmptyLnkResultDraftRows(selectedLnkResultRows, lnkResultDraft) ? 'bg-slate-50 opacity-60' : 'bg-white'
                  }`}
                >
                  <h3 className="mb-3 text-sm font-semibold text-slate-800">2. Заключение</h3>
                  <RequestNamingControls
                    naming={lnkResultDraft.conclusionNaming}
                    systemName={nextLnkConclusionName}
                    label="Наименование заключения"
                    placeholder="Введите наименование заключения"
                    disabled={!hasNonEmptyLnkResultDraftRows(selectedLnkResultRows, lnkResultDraft)}
                    onChange={(conclusionNaming) => setLnkResultDraft((current) => ({ ...current, conclusionNaming }))}
                  />
                </div>

                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-xs leading-5 text-slate-600">
                  Результат заменит статус «ожидает НК» в выбранном виде контроля. Наименование заключения попадет в
                  соответствующий столбец раздела «Заключения». Уже внесенные результаты изменяются только через
                  «Редактировать результаты».
                </div>
              </section>

              <section className="flex min-h-0 flex-col space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-800">Стыки для результата</h3>
                    <p className="text-xs leading-5 text-slate-500">
                      Видны проект, шифр, линия, спул и номер стыка для проверки перед сохранением.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {lnkResultDraft.rowIds.size > 0 ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setShouldPinPreviewedLnkResultRows(false)
                          setLnkResultDraft((current) => ({
                            ...current,
                            rowIds: new Set(),
                            rowResults: {},
                          }))
                        }}
                      >
                        Снять выбор
                      </Button>
                    ) : null}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={toggleAllLnkResultRows}
                      disabled={!canBulkToggleLnkResultRows}
                    >
                      {!lnkResultContextReady
                        ? 'Выберите метод'
                        : !canBulkToggleLnkResultRows
                          ? 'Сузьте поиск'
                        : isEveryFilteredLnkRequestRowSelected(
                        lnkResultDraft.rowIds,
                        selectableVisibleLnkResultRows,
                      )
                        ? 'Снять все'
                        : 'Выбрать все доступные'}
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
                  <Input
                    value={lnkResultDraft.search}
                    onChange={(event) => setLnkResultDraft((current) => ({ ...current, search: event.target.value }))}
                    placeholder="Проект, шифр, линия, спул или стык"
                    className="h-9 min-w-56 flex-[0.85] bg-white"
                  />
                  <Input
                    value={lnkResultRequestSearch}
                    onChange={(event) => setLnkResultRequestSearch(event.target.value)}
                    placeholder="Поиск заявки"
                    className="h-9 min-w-44 flex-[0.45] bg-white"
                  />
                  <Select
                    value={lnkResultDraft.requestName}
                    onChange={(event) => changeLnkResultRequest(event.target.value)}
                    className="h-9 min-w-48 flex-[0.5] bg-white"
                  >
                    <option value="">Все заявки</option>
                    {filteredLnkResultRequestOptions.map((requestName) => (
                      <option key={requestName} value={requestName}>
                        {requestName}
                      </option>
                    ))}
                  </Select>
                  {lnkResultRequestSearch ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setLnkResultRequestSearch('')}
                      className="h-9 px-2"
                      aria-label="Очистить поиск заявки"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  ) : null}
                  <span className="whitespace-nowrap px-2 text-xs text-slate-500">
                    Заявок: {filteredLnkResultRequestOptions.length}/{lnkResultAvailableRequestOptions.length}
                  </span>
                  <span className="whitespace-nowrap px-2 text-xs text-slate-500">
                    Найдено: {visibleLnkResultRows.length} · Выбрано: {lnkResultDraft.rowIds.size}
                  </span>
                  {lnkResultDraft.search ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setLnkResultRequestSearch('')
                        setShouldPinPreviewedLnkResultRows(false)
                        setLnkResultDraft((current) => ({
                          ...current,
                          requestName: '',
                          rowIds: new Set(),
                          rowResults: {},
                          search: '',
                        }))
                      }}
                    >
                      Очистить
                    </Button>
                  ) : null}
                </div>

                <div className="min-h-0 overflow-auto rounded-md border border-slate-200">
                  {visibleLnkResultRows.length === 0 ? (
                    <div className="flex min-h-72 items-center justify-center px-4 py-10 text-center text-sm text-slate-500">
                      {lnkResultDraft.search
                          ? 'По фильтру ничего не найдено.'
                          : 'По выбранному методу нет стыков для добавления результата.'}
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {visibleLnkResultRows.map((row) => {
                        const method = getLnkMethodByRequestKey(lnkResultDraft.methodKey)
                        const disabled = !canSelectLnkResultRow(row, lnkResultDraft.requestName, lnkResultDraft.methodKey)
                        const selected = lnkResultDraft.rowIds.has(row.id) && !disabled
                        const rowRequestNames = getLnkRowRequestNames(row)
	                        const rowResult = getEffectiveLnkResultDraftValueForRow(row, lnkResultDraft)
                        const hasSavedFinalResult = Boolean(
                          method && LNK_RESULT_OPTIONS.includes(String(row[method.resultKey] ?? '').trim().toLowerCase() as never),
                        )
                        return (
	                          <div
	                            key={row.id}
	                            onClick={() => {
	                              if (!disabled) toggleLnkResultRow(row.id)
	                            }}
	                            className={`grid grid-cols-[28px_minmax(220px,1fr)_minmax(180px,0.8fr)] gap-3 px-4 py-3 text-sm transition-colors ${
                              disabled
                                ? 'cursor-not-allowed bg-slate-100 text-slate-400'
                                : selected
                                  ? 'cursor-pointer bg-emerald-50/80'
                                  : 'cursor-pointer bg-white hover:bg-slate-50'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={selected}
                              onClick={(event) => event.stopPropagation()}
                              onChange={() => toggleLnkResultRow(row.id)}
                              disabled={disabled}
                              className="mt-1 h-4 w-4 rounded border-slate-300 text-slate-900"
                            />
                            <span className="min-w-0">
                              <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                                <span className="truncate font-medium text-slate-900">{getJointTitle(row)}</span>
                                <OfficialityBadge row={row} compact />
                              </span>
                              <span className="block text-xs leading-5 text-slate-500">
                                <JointProjectSubtitleMeta row={row} />
                              </span>
                              <span className="block text-xs leading-5 text-slate-500">
                                <JointSpoolDiameterMeta row={row} />
                                <MetaSeparator />
                                <JointWeldDateMeta row={row} />
                              </span>
                              <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
                                {formatLnkResultSummaryItems(row).map((item) => (
                                  <span
                                    key={item.method}
                                    className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-medium ${item.inactive ? getInactiveLnkRequestBadgeClass() : getLnkResultBadgeClass(item.result)}`}
                                  >
                                    <span className="font-bold">{item.method}</span>
                                    <span>{item.result}</span>
                                  </span>
                                ))}
                              </span>
                              {disabled ? (
                                <span className="block truncate text-xs text-amber-700">
                                  {rowRequestNames.length === 0
                                    ? 'На этот стык еще нет заявки ЛНК.'
                                    : !lnkResultDraft.methodKey
                                      ? 'Выберите метод контроля, чтобы отметить стык.'
                                    : hasSavedFinalResult
                                      ? 'Результат уже внесен. Используйте «Редактировать результаты».'
                                    : lnkResultDraft.requestName
                                      ? 'Для выбранных заявки и метода этот стык не подходит.'
                                      : 'На выбранный метод по этому стыку нет заявки ЛНК.'}
                                </span>
                              ) : null}
                              {selected ? (
                                <span className="mt-2 flex flex-wrap items-center gap-1.5">
	                                  <span className="mr-1 text-xs font-medium text-slate-500">Результат:</span>
	                                  {LNK_RESULT_OPTIONS.map((option) => {
	                                    const active = rowResult === option
	                                    const disabledByRepairRule = option === 'ремонт' && isLnkRepairForbidden(row)
	                                    return (
	                                      <button
	                                        key={option}
	                                        type="button"
	                                        onClick={(event) => {
	                                          event.preventDefault()
	                                          event.stopPropagation()
	                                          if (disabledByRepairRule) return
	                                          setLnkResultForRow(row.id, option)
	                                        }}
	                                        disabled={disabledByRepairRule}
	                                        title={disabledByRepairRule ? getLnkRepairForbiddenReason(row) : undefined}
	                                        className={`rounded border px-2 py-1 text-xs font-medium transition-colors ${
	                                          disabledByRepairRule
	                                            ? 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400'
	                                            : active
	                                            ? getLnkResultBadgeClass(option)
	                                            : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
	                                        }`}
	                                      >
                                        {option}
                                      </button>
                                    )
                                  })}
                                </span>
                              ) : null}
                            </span>
                            <span className="flex flex-wrap content-start gap-1.5">
                              {rowRequestNames.length === 0 ? (
                                <span className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">
                                  Нет заявки
                                </span>
                              ) : (
                                getLnkRowRequestMethods(row, lnkResultDraft.requestName).map((availableMethod) => {
                                  const requestName = String(row[availableMethod.requestKey] ?? '').trim()
                                  const conclusionName = String(row[availableMethod.conclusionKey] ?? '').trim()
                                  const hasNoNeed = isLnkMethodNoNeed(row, availableMethod)
                                  const isSelectedMethod = availableMethod.requestKey === lnkResultDraft.methodKey
                                  const isSelectedRowMethod = selected && isSelectedMethod
                                  return (
                                    <span
                                      key={availableMethod.requestKey}
                                      className={`inline-flex max-w-full flex-col gap-0.5 rounded border px-2 py-1 text-xs font-medium ${
                                        isSelectedRowMethod
                                          ? 'border-sky-200 bg-sky-50 text-sky-900'
                                          : getLnkRequestMethodBadgeClass(row, availableMethod)
                                      }`}
                                    >
                                      <span
                                        className={`flex max-w-full items-center gap-1.5 whitespace-normal break-words ${
                                          isSelectedRowMethod ? 'text-sky-700' : 'text-slate-500'
                                        }`}
                                      >
                                        <span
                                          className={`rounded px-1.5 py-0.5 text-[11px] font-bold leading-none ${
                                            isSelectedRowMethod
                                              ? 'bg-sky-100 text-sky-900'
                                              : 'border border-slate-200 bg-slate-100 text-slate-700'
                                          }`}
                                        >
                                          {availableMethod.code}
                                        </span>
                                        <span className="min-w-0 overflow-visible break-all whitespace-normal [text-overflow:clip]">
                                          {hasNoNeed ? 'нет потребности' : requestName}
                                        </span>
                                      </span>
                                      {conclusionName && !hasNoNeed ? (
                                        <span className="max-w-full overflow-visible break-all whitespace-normal [text-overflow:clip]">
                                          {conclusionName}
                                        </span>
                                      ) : null}
                                    </span>
                                  )
                                })
                              )}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </section>
            </div>

            <div className="flex items-end justify-between gap-4 border-t border-slate-200/80 px-5 py-4">
              <div className="min-h-5 text-sm text-slate-500">
                {lnkResultSaveBlockReason ? (
                  <span className="text-sm text-slate-500">
                    Чтобы сохранить: {lnkResultSaveBlockReason}
                  </span>
                ) : null}
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={closeAddLnkResultModal}>
                  Отмена
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShouldPinPreviewedLnkResultRows(true)
                    setIsLnkResultPreviewOpen(true)
                  }}
                  disabled={selectedLnkResultRows.length === 0}
                >
                  Предпросмотр ({selectedLnkResultRows.length})
                </Button>
                <span title={lnkResultSaveBlockReason || 'Можно сохранить результат'}>
                  <Button
                    onClick={handleAddLnkResult}
                    disabled={isLnkResultSaveDisabled}
                    className={isLnkResultSaveDisabled ? 'pointer-events-none' : ''}
                  >
                    <Check className="mr-2 h-4 w-4" />
                    Сохранить результат
                  </Button>
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {isLnkResultPreviewOpen ? (
        <div className="fixed inset-0 z-[65] flex items-center justify-center bg-slate-950/25 px-4 backdrop-blur-[1px]">
          <div className="flex max-h-[86vh] w-full max-w-4xl flex-col rounded-md border border-slate-200 bg-white shadow-2xl shadow-slate-950/20">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold">Предпросмотр выбранных стыков</h2>
                <p className="text-sm text-muted-foreground">
                  Метод: {getLnkMethodByRequestKey(lnkResultDraft.methodKey)?.code || '-'} · Выбрано: {selectedLnkResultRows.length}
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setIsLnkResultPreviewOpen(false)} aria-label="Закрыть предпросмотр">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-5">
              {selectedLnkResultRows.length === 0 ? (
                <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                  Нет выбранных стыков.
                </div>
              ) : (
                <div className="divide-y divide-slate-100 rounded-md border border-slate-200">
                  {selectedLnkResultRows.map((row) => {
                    const method = getLnkMethodByRequestKey(lnkResultDraft.methodKey)
                    const currentResult = method ? String(row[method.resultKey] ?? '').trim() || 'заявка' : '-'
                    const requestName = method ? String(row[method.requestKey] ?? '').trim() : ''
	                    const result = getEffectiveLnkResultDraftValueForRow(row, lnkResultDraft)
                    return (
                      <div key={row.id} className="grid grid-cols-[minmax(320px,1fr)_minmax(220px,0.45fr)] gap-4 px-4 py-3 text-sm">
                        <div className="min-w-0">
                          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                            <span className="font-medium text-slate-900">{getJointTitle(row)}</span>
                            <OfficialityBadge row={row} compact />
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            <JointProjectSubtitleMeta row={row} />
                            <MetaSeparator />
                            <JointSpoolDiameterMeta row={row} />
                            <MetaSeparator />
                            <JointWeldDateMeta row={row} />
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                            <span className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-bold text-slate-700">
                              {method?.code || '-'}
                            </span>
                            {requestName ? (
                              <span className="rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 font-medium text-sky-800">
                                {requestName}
                              </span>
                            ) : null}
                            <span className={`rounded border px-1.5 py-0.5 font-semibold ${getLnkResultBadgeClass(currentResult)}`}>
                              Сейчас: {currentResult}
                            </span>
                          </div>
                        </div>
                        <div className="flex flex-col items-end justify-start gap-1.5">
                          <span className="text-xs font-medium text-slate-500">Будет записано:</span>
                          <span className={`rounded border px-2 py-1 text-xs font-semibold ${getLnkResultBadgeClass(result)}`}>
                            {result || '-'}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200/80 px-5 py-4">
              <Button variant="outline" onClick={() => setIsLnkResultPreviewOpen(false)}>
                Закрыть
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {heatTreatmentFieldEditing ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/20 px-4 backdrop-blur-[1px]">
          <div className="w-full max-w-xl rounded-md border border-slate-200 bg-white shadow-2xl shadow-slate-950/10">
            <div className="flex items-center justify-between border-b border-slate-200/80 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold">{heatTreatmentFieldEditing.label}</h2>
                <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
                  <span>{getJointTitle(heatTreatmentFieldEditing.record)}</span>
                  <OfficialityBadge row={heatTreatmentFieldEditing.record} compact />
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setHeatTreatmentFieldEditing(null)} aria-label="Закрыть">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="space-y-2 px-5 py-5">
              <label className="space-y-1.5 text-sm">
                <span className="text-[13px] font-medium leading-none text-slate-700">{heatTreatmentFieldEditing.label}</span>
                {heatTreatmentFieldEditing.mode === 'result' ? (
                  <Select
                    autoFocus
                    value={heatTreatmentFieldEditing.value}
                    onChange={(event) =>
                      setHeatTreatmentFieldEditing((current) =>
                        current ? { ...current, value: event.target.value } : current,
                      )
                    }
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') setHeatTreatmentFieldEditing(null)
                      if (event.key === 'Enter') saveEditedHeatTreatmentField()
                    }}
                  >
                    <option value="">пусто</option>
                    {RESULT_STATUS_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </Select>
                ) : heatTreatmentFieldEditing.mode === 'request' ? (
                  <Select
                    autoFocus
                    value={heatTreatmentFieldEditing.value}
                    onChange={(event) =>
                      setHeatTreatmentFieldEditing((current) =>
                        current ? { ...current, value: event.target.value } : current,
                      )
                    }
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') setHeatTreatmentFieldEditing(null)
                      if (event.key === 'Enter') saveEditedHeatTreatmentField()
                    }}
                  >
                    <option value="">пусто</option>
                    {withCurrentOption(lnkRequestOptions, heatTreatmentFieldEditing.value).map((requestName) => (
                      <option key={requestName} value={requestName}>
                        {requestName}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    autoFocus
                    type={heatTreatmentFieldEditing.kind}
                    value={heatTreatmentFieldEditing.value}
                    onChange={(event) =>
                      setHeatTreatmentFieldEditing((current) =>
                        current ? { ...current, value: event.target.value } : current,
                      )
                    }
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') setHeatTreatmentFieldEditing(null)
                      if (event.key === 'Enter') saveEditedHeatTreatmentField()
                    }}
                  />
                )}
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200/80 px-5 py-4">
              <Button variant="outline" onClick={() => setHeatTreatmentFieldEditing(null)}>
                Отмена
              </Button>
              <Button
                onClick={saveEditedHeatTreatmentField}
                disabled={heatTreatmentFieldMutation.isPending || lnkFieldMutation.isPending}
              >
                <Check className="mr-2 h-4 w-4" />
                Сохранить
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}


async function invalidate(queryClient: ReturnType<typeof useQueryClient>) {
  await queryClient.invalidateQueries({ queryKey: ['weld-joints'] })
}
