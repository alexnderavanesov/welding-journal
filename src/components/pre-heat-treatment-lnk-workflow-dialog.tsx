import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { DialogContextMenuLayer, type DialogContextMenuLayerHandle } from '@/components/dialog-context-menu-layer'
import { DialogRowPagination } from '@/components/dialog-row-pagination'
import { DialogVirtualizedRows } from '@/components/dialog-virtualized-rows'
import { DocumentWorkspaceTabs, type DocumentWorkspaceTab } from '@/components/document-workspace-tabs'
import { WorkflowDialogShell } from '@/components/workflow-dialog-shell'
import { LnkExistingRequestSearch } from '@/components/lnk-existing-request-search'
import {
  LNK_RESULT_ROW_GRID_CLASS,
} from '@/components/lnk-dialog-layout'
import { LnkControlStageSwitch } from '@/components/lnk-control-stage-switch'
import { LnkRequestMethods } from '@/components/lnk-request-methods'
import { LnkRequestModeToolbar } from '@/components/lnk-request-mode-toolbar'
import { LnkResultControlBar } from '@/components/lnk-result-control-bar'
import {
  PreHeatTreatmentLnkWorkflowRow,
  type PreHeatTreatmentLnkWorkflowRowMode,
} from '@/components/pre-heat-treatment-lnk-workflow-row'
import { RequestDialogFooter } from '@/components/request-dialog-footer'
import { RequestDialogHeader } from '@/components/request-dialog-header'
import { RequestDocumentCombobox } from '@/components/request-document-combobox'
import { RequestRowsPanel } from '@/components/request-rows-panel'
import { ResultDialogHeader } from '@/components/result-dialog-header'
import { SelectedRowsViewToggle, type SelectedRowsViewMode } from '@/components/selected-rows-view-toggle'
import { SystemDocumentNamesPanel } from '@/components/system-document-names-panel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { formatDateInputValue, getDateInputValidationReason } from '@/lib/date-format'
import {
  buildDialogRowContextMenu,
  buildDocumentGroupContextMenu,
  getDialogMenuPoint,
} from '@/lib/dialog-context-menu-items'
import type { WeldRow } from '@/lib/dispatcher-types'
import {
  getPreHeatTreatmentControl,
  PRE_HEAT_TREATMENT_LNK_METHODS,
  type PreHeatTreatmentLnkMethodCode,
  type LnkControlStage,
} from '@/lib/lnk-control-stage'
import { LNK_CUSTOM_RESULT_VALUE } from '@/lib/lnk-report-config'
import {
  buildPreHeatTreatmentRequestWrites,
  buildPreHeatTreatmentResultWrite,
  canAddPreHeatTreatmentResult,
  canCreatePreHeatTreatmentRequest,
  getPreHeatTreatmentRequestBlockReason,
  getPreHeatTreatmentResultBlockReason,
  PRE_HEAT_TREATMENT_RESULT_OPTIONS,
} from '@/lib/pre-heat-treatment-control-updates'
import {
  collectRequestDocumentIdentities,
  createRequestDocumentIdentity,
  isSameRequestDocument,
  type RequestDocumentIdentity,
} from '@/lib/request-document-identity'
import {
  getDefaultNamingState,
  useRequestConclusionSettings,
} from '@/lib/request-conclusion-settings'
import type { RequestNamingState } from '@/lib/request-naming-state'
import { normalizeSearchText } from '@/lib/report-row-utils'
import {
  SYSTEM_DOCUMENT_SEQUENCES_QUERY_KEY,
  loadSystemDocumentSequences,
} from '@/lib/system-document-sequence-storage'
import {
  buildSystemDocumentCreationPlan,
  type SystemDocumentCreationGroup,
} from '@/lib/system-document-creation-plan'
import { getSystemDocumentTemplateId } from '@/lib/system-document-template-types'
import { usePagePagination } from '@/lib/use-page-pagination'
import { useStableEventCallback } from '@/lib/use-stable-event-callback'
import { invalidateWeldJoints } from '@/lib/weld-query-utils'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { LnkRequestComposerMode } from '@/lib/use-lnk-request-modal-state'
import { useSaveCheckSettings, type SaveCheckSettings } from '@/lib/save-check-settings'
import {
  getWorkflowDraftRootCauseState,
  type WorkflowDraftUpdate,
} from '@/lib/workflow-root-cause-preview'
import type { WorkflowRootCauseAction } from '@/lib/workflow-root-cause-actions'
import {
  savePreHeatTreatmentLnkWorkflow,
  type PreHeatTreatmentLnkPosition,
} from '@/server/pre-heat-treatment-lnk-workflow'

export type PreHeatTreatmentLnkWorkflowDialogProps = {
  embedded?: boolean
  mode: PreHeatTreatmentLnkWorkflowRowMode
  rows: WeldRow[]
  initialSelectedIds: ReadonlySet<number>
  initialMethodCode?: PreHeatTreatmentLnkMethodCode
  initialRequestSubmitMode?: LnkRequestComposerMode
  onClose: () => void
  onRunProtectedEdit: (actionLabel: string, action: () => void) => void
  onSaved: (rows: WeldRow[], fieldKeys: WeldFieldKey[], message: string) => void
  onOpenJournalRows: (rows: readonly WeldRow[], sourceLabel: string) => void
  onOpenPstoHistory?: (row: WeldRow) => void
  onOpenResultRegistry?: () => void
  onRunRootCauseAction?: (action: WorkflowRootCauseAction) => void
  onStageChange?: (
    stage: LnkControlStage,
    selectedRowIds: number[],
    submitMode: LnkRequestComposerMode,
  ) => void
}

type SaveResult = {
  rows: WeldRow[]
  documentCount: number
  positionCount: number
}

const PRE_REPORT_FIELD_KEYS: Record<PreHeatTreatmentLnkMethodCode, {
  request: WeldFieldKey[]
  result: WeldFieldKey[]
}> = {
  ВИК: {
    request: ['preVikRequest', 'preVikRequestDate', 'preVikResult'],
    result: ['preVikResult', 'preVikConclusionDate', 'preVikConclusion'],
  },
  РК: {
    request: ['preRkRequest', 'preRkRequestDate', 'preRkResult'],
    result: ['preRkResult', 'preRkConclusionDate', 'preRkConclusion'],
  },
  УЗК: {
    request: ['preUzkRequest', 'preUzkRequestDate', 'preUzkResult'],
    result: ['preUzkResult', 'preUzkConclusionDate', 'preUzkConclusion'],
  },
  ПВК: {
    request: ['prePvkRequest', 'prePvkRequestDate', 'prePvkResult'],
    result: ['prePvkResult', 'prePvkConclusionDate', 'prePvkConclusion'],
  },
}

const PRE_HEAT_TREATMENT_REQUEST_METHOD_OPTIONS = PRE_HEAT_TREATMENT_LNK_METHODS.map((method) => ({
  code: method.code,
  requestKey: method.code,
}))

export function PreHeatTreatmentLnkWorkflowDialog({
  embedded = false,
  mode,
  rows,
  initialSelectedIds,
  initialMethodCode,
  initialRequestSubmitMode = 'create',
  onClose,
  onRunProtectedEdit,
  onSaved,
  onOpenJournalRows,
  onOpenPstoHistory,
  onOpenResultRegistry,
  onRunRootCauseAction,
  onStageChange,
}: PreHeatTreatmentLnkWorkflowDialogProps) {
  const queryClient = useQueryClient()
  const settings = useRequestConclusionSettings()
  const saveCheckSettings = useSaveCheckSettings()
  const contextMenuRef = useRef<DialogContextMenuLayerHandle>(null)
  const dateInputRef = useRef<HTMLInputElement>(null)
  const appliedInitialSelectionRef = useRef('')
  const didApplyInitialResultSelectionRef = useRef(false)
  const [date, setDate] = useState(() => formatDateInputValue(new Date()))
  const [search, setSearch] = useState('')
  const [selectedSearch, setSelectedSearch] = useState('')
  const [rowsViewMode, setRowsViewMode] = useState<SelectedRowsViewMode>('all')
  const [workspaceTab, setWorkspaceTab] = useState<DocumentWorkspaceTab>('joints')
  const [naming, setNaming] = useState<RequestNamingState>(() =>
    getDefaultNamingState(settings, mode === 'request' ? 'lnkRequest' : 'lnkConclusion'),
  )
  const [selectedMethods, setSelectedMethods] = useState<Set<PreHeatTreatmentLnkMethodCode>>(() =>
    getInitialRequestMethods(mode, rows, initialSelectedIds, initialMethodCode),
  )
  const [resultMethod, setResultMethod] = useState<PreHeatTreatmentLnkMethodCode | ''>(() =>
    getInitialResultMethod(mode, rows, initialSelectedIds, initialMethodCode),
  )
  const [requestKey, setRequestKey] = useState('')
  const [requestSubmitMode, setRequestSubmitMode] = useState<LnkRequestComposerMode>(initialRequestSubmitMode)
  const [existingRequestKey, setExistingRequestKey] = useState('')
  const [existingRequestSearch, setExistingRequestSearch] = useState('')
  const [defaultResult, setDefaultResult] = useState('')
  const [rowResults, setRowResults] = useState<Record<number, string>>({})
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => (
    mode === 'request'
      ? new Set(rows.flatMap((row) => (
          initialSelectedIds.has(row.id) && hasAvailableRequestPosition(row, selectedMethods)
            ? [row.id]
            : []
        )))
      : new Set()
  ))
  const initialSelectionSignature = useMemo(
    () => [...initialSelectedIds].sort((left, right) => left - right).join(','),
    [initialSelectedIds],
  )
  const loadedInitialRowsSignature = useMemo(
    () => rows
      .flatMap((row) => initialSelectedIds.has(row.id) ? [row.id] : [])
      .sort((left, right) => left - right)
      .join(','),
    [initialSelectedIds, rows],
  )
  useEffect(() => {
    const contextKey = `${mode}:${initialMethodCode ?? ''}:${initialSelectionSignature}:${loadedInitialRowsSignature}`
    if (appliedInitialSelectionRef.current === contextKey) return

    const nextSelectedMethods = getInitialRequestMethods(mode, rows, initialSelectedIds, initialMethodCode)
    const nextResultMethod = getInitialResultMethod(mode, rows, initialSelectedIds, initialMethodCode)
    setSelectedMethods(nextSelectedMethods)
    setResultMethod(nextResultMethod)
    setRequestKey('')
    setRowsViewMode('all')
    didApplyInitialResultSelectionRef.current = false
    setSelectedIds(mode === 'request'
      ? new Set(rows.flatMap((row) => (
          initialSelectedIds.has(row.id) && hasAvailableRequestPosition(row, nextSelectedMethods)
            ? [row.id]
            : []
        )))
      : new Set())
    appliedInitialSelectionRef.current = contextKey
  }, [initialMethodCode, initialSelectedIds, initialSelectionSignature, loadedInitialRowsSignature, mode, rows])
  const { data: sequences } = useQuery({
    queryKey: SYSTEM_DOCUMENT_SEQUENCES_QUERY_KEY,
    queryFn: loadSystemDocumentSequences,
    staleTime: 30_000,
  })

  const requestOptions = useMemo(
    () => getPreHeatTreatmentRequestOptions(rows, resultMethod),
    [resultMethod, rows],
  )
  const existingRequestOptions = useMemo(
    () => getAllPreHeatTreatmentRequestOptions(rows),
    [rows],
  )
  const filteredExistingRequestOptions = useMemo(() => {
    const query = normalizeSearchText(existingRequestSearch)
    if (!query) return existingRequestOptions
    return existingRequestOptions.filter((option) => normalizeSearchText([
      option.label,
      option.name,
      option.date,
    ].join(' ')).includes(query))
  }, [existingRequestOptions, existingRequestSearch])
  const selectedExistingRequest = existingRequestOptions.find((option) => option.key === existingRequestKey) ?? null
  const visibleExistingRequestOptions = selectedExistingRequest && !filteredExistingRequestOptions.some((option) => option.key === selectedExistingRequest.key)
    ? [selectedExistingRequest, ...filteredExistingRequestOptions]
    : filteredExistingRequestOptions
  const requestSelectionReason = resultMethod && requestOptions.length === 0
    ? `Нет заявок ${resultMethod} до ТО, ожидающих результата. Сначала создайте заявку до ТО.`
    : 'Выберите заявку НК до ТО.'
  const selectedRequest = requestOptions.find((option) => option.key === requestKey) ?? null
  useEffect(() => {
    if (mode !== 'result' || !resultMethod) return
    if (requestOptions.some((option) => option.key === requestKey)) return
    const initialKeys = new Set(rows.flatMap((row) => {
      if (!initialSelectedIds.has(row.id)) return []
      const control = getPreHeatTreatmentControl(row, resultMethod)
      const identity = createRequestDocumentIdentity(control?.requestName, control?.requestDate)
      return identity && canAddPreHeatTreatmentResult(row, resultMethod, saveCheckSettings) ? [identity.key] : []
    }))
    const nextKey = initialKeys.size === 1
      ? [...initialKeys][0] ?? ''
      : requestOptions.length === 1
        ? requestOptions[0]?.key ?? ''
        : ''
    setRequestKey(nextKey)
  }, [initialSelectedIds, mode, requestKey, requestOptions, resultMethod, rows, saveCheckSettings])

  useEffect(() => {
    if (
      mode !== 'result' ||
      !resultMethod ||
      !selectedRequest ||
      didApplyInitialResultSelectionRef.current
    ) return
    didApplyInitialResultSelectionRef.current = true
    setSelectedIds(new Set(rows.flatMap((row) => {
      const control = getPreHeatTreatmentControl(row, resultMethod)
      return initialSelectedIds.has(row.id) &&
        canAddPreHeatTreatmentResult(row, resultMethod, saveCheckSettings) &&
        isSameRequestDocument(control?.requestName, control?.requestDate, selectedRequest)
        ? [row.id]
        : []
    })))
  }, [initialSelectedIds, mode, resultMethod, rows, saveCheckSettings, selectedRequest])

  const sourceRows = useMemo(() => {
    if (mode === 'request') return rows
    if (!resultMethod || !selectedRequest) return []
    return rows.filter((row) => {
      const control = getPreHeatTreatmentControl(row, resultMethod)
      return isSameRequestDocument(control?.requestName, control?.requestDate, selectedRequest)
    })
  }, [mode, resultMethod, rows, selectedRequest])
  const getRowBlockReason = useCallback((row: WeldRow): string => {
    if (mode === 'request') {
      if (selectedMethods.size === 0) return 'Выберите хотя бы один вид НК до ТО.'
      return hasAvailableRequestPosition(row, selectedMethods)
        ? ''
        : getFirstRequestBlockReason(row, selectedMethods)
    }
    if (!resultMethod) return 'Выберите вид НК до ТО.'
    if (!selectedRequest) return requestSelectionReason
    return getPreHeatTreatmentResultBlockReason(row, resultMethod, saveCheckSettings)
  }, [mode, requestSelectionReason, resultMethod, saveCheckSettings, selectedMethods, selectedRequest])
  const availableRows = useMemo(
    () => sourceRows.filter((row) => !getRowBlockReason(row)),
    [getRowBlockReason, sourceRows],
  )
  const filteredRows = useMemo(() => filterRows(sourceRows, search), [search, sourceRows])
  const filteredAvailableRows = useMemo(
    () => filteredRows.filter((row) => !getRowBlockReason(row)),
    [filteredRows, getRowBlockReason],
  )
  const selectedRows = useMemo(
    () => rows.filter((row) => selectedIds.has(row.id) && !getRowBlockReason(row)),
    [getRowBlockReason, rows, selectedIds],
  )
  const filteredSelectedRows = useMemo(
    () => filterRows(selectedRows, selectedSearch),
    [selectedRows, selectedSearch],
  )
  const displayedRows = rowsViewMode === 'selected' ? filteredSelectedRows : filteredRows
  const displayedSearch = rowsViewMode === 'selected' ? selectedSearch : search
  const pagination = usePagePagination({
    items: displayedRows,
    defaultPageSize: 50,
    resetKeys: [displayedSearch, rowsViewMode, requestKey, resultMethod, [...selectedMethods].join('|')],
  })
  useEffect(() => {
    if (selectedRows.length === 0 && rowsViewMode === 'selected') setRowsViewMode('all')
  }, [rowsViewMode, selectedRows.length])

  const selectedPositionCount = mode === 'request'
    ? selectedRows.reduce((count, row) => count + getAvailableRequestMethods(row, selectedMethods).length, 0)
    : selectedRows.length
  const displayedDefaultResult = useMemo(() => {
    if (mode !== 'result' || selectedRows.length === 0) return defaultResult
    const values = new Set(selectedRows.map((row) => rowResults[row.id] ?? ''))
    return values.size === 1 ? [...values][0] ?? '' : LNK_CUSTOM_RESULT_VALUE
  }, [defaultResult, mode, rowResults, selectedRows])
  const conclusionTemplateId = resultMethod
    ? getSystemDocumentTemplateId({ type: 'lnkConclusion', methodCode: resultMethod })
    : null
  const nextNumber = mode === 'request'
    ? sequences?.lnkRequest
    : conclusionTemplateId
      ? sequences?.[conclusionTemplateId]
      : undefined
  const creationPlan = useMemo(() => buildSystemDocumentCreationPlan({
    type: mode === 'request' ? 'lnkRequest' : 'lnkConclusion',
    ...(mode === 'result' && resultMethod ? { methodCode: resultMethod } : {}),
    date,
    rows: selectedRows,
    naming,
    settings,
    nextNumber,
    allowAllNamesEmpty: mode === 'result' && !saveCheckSettings.lnkResultConclusionRequired,
  }), [date, mode, naming, nextNumber, resultMethod, saveCheckSettings.lnkResultConclusionRequired, selectedRows, settings])
  const effectiveDate = mode === 'request' && requestSubmitMode === 'extend'
    ? selectedExistingRequest?.date ?? ''
    : date
  const workflowGroups = useMemo(() => {
    if (mode !== 'request' || requestSubmitMode === 'create') {
      return creationPlan.groups.map((group) => ({
        name: group.name,
        useSystemName: group.useSystemName,
        positions: getGroupPositions(group, mode, selectedMethods, resultMethod),
      }))
    }
    if (!selectedExistingRequest) return []
    return [{
      name: selectedExistingRequest.name,
      useSystemName: false,
      positions: selectedRows.flatMap((row) => getAvailableRequestMethods(row, selectedMethods).map((methodCode) => ({
        rowId: row.id,
        methodCode,
      }))),
    }]
  }, [creationPlan.groups, mode, requestSubmitMode, resultMethod, selectedExistingRequest, selectedMethods, selectedRows])
  const creationPlanError = mode === 'request' && requestSubmitMode === 'extend'
    ? ''
    : creationPlan.error
  const dateReason = mode === 'request'
    ? getDateInputValidationReason(effectiveDate, 'Дата заявки НК до ТО')
    : getOptionalPreHeatTreatmentResultDateReason(
        effectiveDate,
        saveCheckSettings,
        naming.mode === 'system',
      )
  const domainReason = useMemo(() => {
    if (selectedRows.length === 0 || dateReason || creationPlanError) return ''
    try {
      const rowsById = new Map(selectedRows.map((row) => [row.id, row]))
      for (const group of workflowGroups) {
        if (mode === 'request') {
          const methodsByRowId = new Map<number, PreHeatTreatmentLnkMethodCode[]>()
          for (const position of group.positions) {
            const methodCodes = methodsByRowId.get(position.rowId) ?? []
            methodCodes.push(position.methodCode)
            methodsByRowId.set(position.rowId, methodCodes)
          }
          for (const [rowId, methodCodes] of methodsByRowId) {
            buildPreHeatTreatmentRequestWrites({
              row: rowsById.get(rowId)!,
              methodCodes,
              requestName: group.name,
              requestDate: effectiveDate,
              saveCheckSettings,
            })
          }
          continue
        }
        if (!resultMethod) return 'Выберите вид НК до ТО.'
        for (const position of group.positions) {
          const row = rowsById.get(position.rowId)!
          buildPreHeatTreatmentResultWrite({
            row,
            methodCode: resultMethod,
            controlDate: effectiveDate,
            result: rowResults[row.id] ?? '',
            conclusionName: group.name,
            saveCheckSettings,
          })
        }
      }
      return ''
    } catch (error) {
      return (error as Error).message
    }
  }, [creationPlanError, dateReason, effectiveDate, mode, resultMethod, rowResults, saveCheckSettings, selectedRows, workflowGroups])
  const rootCauseState = useMemo(() => {
    if (selectedRows.length === 0 || dateReason || creationPlanError) {
      return { message: null, actions: [] }
    }
    const updates: WorkflowDraftUpdate[] = workflowGroups.flatMap((group) =>
      group.positions.flatMap((position): WorkflowDraftUpdate[] => {
        if (mode === 'request') {
          return [{
            kind: 'pre-lnk-request' as const,
            rowId: position.rowId,
            methodCode: position.methodCode,
            documentName: group.name,
            date: effectiveDate,
          }]
        }
        if (!resultMethod) return []
        return [{
          kind: 'pre-lnk-result' as const,
          rowId: position.rowId,
          methodCode: resultMethod,
          documentName: group.name,
          date: effectiveDate,
          result: rowResults[position.rowId] ?? '',
        }]
      }),
    )
    return getWorkflowDraftRootCauseState({ rows: selectedRows, updates, settings: saveCheckSettings })
  }, [creationPlanError, dateReason, effectiveDate, mode, resultMethod, rowResults, saveCheckSettings, selectedRows, workflowGroups])
  const effectiveDomainReason = domainReason || rootCauseState.message || ''

  const mutation = useMutation({
    mutationFn: async (): Promise<SaveResult> => {
      const savedRows = await savePreHeatTreatmentLnkWorkflow({ data: {
        action: mode,
        date: effectiveDate,
        groups: workflowGroups,
        expectedVersions: selectedRows.map((row) => ({
          id: row.id,
          version: String(row.rowVersion ?? '').trim(),
        })),
        results: mode === 'result' && resultMethod
          ? selectedRows.map((row) => ({
              rowId: row.id,
              methodCode: resultMethod,
              result: rowResults[row.id] ?? '',
            }))
          : [],
      } })
      return {
        rows: savedRows as WeldRow[],
        documentCount: workflowGroups.length,
        positionCount: workflowGroups.reduce((count, group) => count + group.positions.length, 0),
      }
    },
    onSuccess: async (result) => {
      await invalidateWeldJoints(queryClient, { upsertRows: result.rows })
      await queryClient.invalidateQueries({ queryKey: SYSTEM_DOCUMENT_SEQUENCES_QUERY_KEY })
      const methodCodes = mode === 'request' ? [...selectedMethods] : resultMethod ? [resultMethod] : []
      const fieldKeys = methodCodes.flatMap((methodCode) => PRE_REPORT_FIELD_KEYS[methodCode][mode])
      onSaved(
        result.rows,
        [...new Set<WeldFieldKey>([...fieldKeys, 'finalStatus'])],
        mode === 'request'
          ? requestSubmitMode === 'extend'
            ? `Добавлено позиций в заявку НК до ТО: ${result.positionCount}`
            : `Создано заявок НК до ТО: ${result.documentCount} · позиций: ${result.positionCount}`
          : `Внесено результатов НК до ТО: ${result.positionCount} · заключений: ${result.documentCount}`,
      )
      onClose()
    },
    onError: (error) => onSaved([], [], (error as Error).message),
  })

  const saveBlockReason = getSaveBlockReason({
    mode,
    isPending: mutation.isPending,
    selectedMethodsCount: selectedMethods.size,
    resultMethod,
    requestSelected: Boolean(selectedRequest),
    existingRequestSelected: Boolean(selectedExistingRequest),
    requestSubmitMode,
    requestSelectionReason,
    selectedRowsCount: selectedRows.length,
    dateReason,
    creationPlanError,
    domainReason: effectiveDomainReason,
  })
  const runRootCauseAction = (action: WorkflowRootCauseAction) => {
    const target = action.target
    const editsCurrentMethod = target.kind === 'lnk-control' &&
      PRE_HEAT_TREATMENT_LNK_METHODS.some((method) =>
        method.code === target.methodCode &&
        (mode === 'request' ? selectedMethods.has(method.code) : resultMethod === method.code),
      )
    const editsCurrentDraft = target.kind === 'lnk-control' &&
      target.stage === 'beforeHeatTreatment' &&
      target.focus === 'date' &&
      editsCurrentMethod &&
      selectedIds.has(target.rowId) &&
      target.documentDate === effectiveDate &&
      ((mode === 'request' && requestSubmitMode === 'create' && target.documentPart === 'request') ||
        (mode === 'result' && target.documentPart === 'conclusion'))
    if (editsCurrentDraft) {
      dateInputRef.current?.focus()
      return
    }
    onRunRootCauseAction?.(action)
  }
  const setSelectedRows = useStableEventCallback((rowIds: number[]) => {
    const allowedIds = new Set(availableRows.map((row) => row.id))
    const next = new Set(rowIds.filter((rowId) => allowedIds.has(rowId)))
    setSelectedIds(next)
    if (mode === 'result' && defaultResult) {
      setRowResults((current) => {
        const updated = { ...current }
        next.forEach((rowId) => { if (!updated[rowId]) updated[rowId] = defaultResult })
        return updated
      })
    }
  })
  const toggleRow = useStableEventCallback((rowId: number) => {
    const row = rows.find((candidate) => candidate.id === rowId)
    if (!row || getRowBlockReason(row)) return
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(rowId)) next.delete(rowId)
      else next.add(rowId)
      return next
    })
    if (mode === 'result' && defaultResult) {
      setRowResults((current) => current[rowId] ? current : { ...current, [rowId]: defaultResult })
    }
  })
  const setRowsResult = useStableEventCallback((rowIds: number[], result: string) => {
    setRowResults((current) => {
      const next = { ...current }
      rowIds.forEach((rowId) => { next[rowId] = result })
      return next
    })
  })
  const allFilteredAvailableSelected = filteredAvailableRows.length > 0 && filteredAvailableRows.every((row) => selectedIds.has(row.id))
  const toggleAll = useStableEventCallback(() => {
    if (allFilteredAvailableSelected) {
      setSelectedIds((current) => {
        const next = new Set(current)
        filteredAvailableRows.forEach((row) => next.delete(row.id))
        return next
      })
      return
    }
    setSelectedRows([...selectedIds, ...filteredAvailableRows.map((row) => row.id)])
  })
  const openRowContextMenu = useStableEventCallback((event: MouseEvent<HTMLElement>, row: WeldRow) => {
    const point = getDialogMenuPoint(event)
    contextMenuRef.current?.open(buildDialogRowContextMenu({
      ...point,
      row,
      selectedRows,
      selectedIds,
      selectableRows: availableRows,
      isRowSelectable: (candidate) => !getRowBlockReason(candidate),
      sourceLabel: mode === 'request' ? 'заявки НК до ТО' : 'результата НК до ТО',
      relatedSelection: mode === 'result' && selectedRequest
        ? { label: 'Выбрать доступные по этой заявке', rows: availableRows }
        : undefined,
      resultAssignment: mode === 'result'
        ? {
            values: PRE_HEAT_TREATMENT_RESULT_OPTIONS,
            getDisabledReason: () => null,
            onAssign: (targetRows, value) => setRowsResult(targetRows.map((item) => item.id), value),
          }
        : undefined,
      onSetSelectedRows: setSelectedRows,
      onShowSelectedRows: () => setRowsViewMode('selected'),
      onClearSelection: () => setSelectedIds(new Set()),
      onOpenJournalRows,
      onOpenPstoHistory,
    }))
  })
  const openGroupContextMenu = useStableEventCallback((event: MouseEvent<HTMLElement>, group: SystemDocumentCreationGroup) => {
    const point = getDialogMenuPoint(event)
    contextMenuRef.current?.open(buildDocumentGroupContextMenu({
      ...point,
      group,
      allRows: selectedRows,
      sourceLabel: mode === 'request' ? 'заявки НК до ТО' : 'заключения НК до ТО',
      onOpenJournalRows,
    }))
  })
  const toggleMethod = (methodCode: PreHeatTreatmentLnkMethodCode) => {
    setSelectedMethods((current) => {
      const next = new Set(current)
      if (next.has(methodCode)) next.delete(methodCode)
      else next.add(methodCode)
      return next
    })
  }
  const changeResultMethod = (value: string) => {
    const method = PRE_HEAT_TREATMENT_LNK_METHODS.find((candidate) => candidate.code === value)?.code ?? ''
    setResultMethod(method)
    setRequestKey('')
    setSelectedIds(new Set())
    setRowResults({})
    didApplyInitialResultSelectionRef.current = true
  }
  const changeRequest = (value: string) => {
    setRequestKey(value)
    setSelectedIds(new Set())
    setRowResults({})
    setRowsViewMode('all')
    didApplyInitialResultSelectionRef.current = true
  }
  const changeDefaultResult = (result: string) => {
    setDefaultResult(result)
    if (result) setRowsResult([...selectedIds], result)
  }

  const content = (
    <>
      {mode === 'request' ? (
        <RequestDialogHeader
          title="Заявка ЛНК до ТО"
          subtitle={`Этап: до термообработки · Выбрано стыков: ${selectedRows.length} · Позиций: ${selectedPositionCount}`}
          onClose={onClose}
          actions={onStageChange ? (
            <LnkControlStageSwitch
              value="beforeHeatTreatment"
              disabled={mutation.isPending}
              onChange={(stage) => onStageChange(stage, [...selectedIds], requestSubmitMode)}
            />
          ) : undefined}
        />
      ) : (
        <ResultDialogHeader
          title="Внесение результатов ЛНК до ТО"
          requestName={selectedRequest?.name ?? ''}
          selectedCount={selectedRows.length}
          managerDisabled={!onOpenResultRegistry}
          managerDisabledReason="Реестр результатов НК до ТО недоступен в этом контексте."
          onOpenManager={() => onOpenResultRegistry?.()}
          onClose={onClose}
          stageControl={onStageChange ? (
            <LnkControlStageSwitch
              value="beforeHeatTreatment"
              disabled={mutation.isPending}
              onChange={(stage) => onStageChange(stage, [...selectedIds], 'create')}
            />
          ) : undefined}
        />
      )}

      {mode === 'request' ? (
        <LnkRequestModeToolbar
          mode={requestSubmitMode}
          disabled={mutation.isPending}
          onModeChange={(nextMode) => {
            setRequestSubmitMode(nextMode)
            if (nextMode === 'extend') setWorkspaceTab('joints')
          }}
          onOpenRegistry={() => onOpenResultRegistry?.()}
        />
      ) : null}

      {mode === 'request' && requestSubmitMode === 'extend' ? (
        <div className="border-b border-slate-100 px-5 py-3">
          <div className="grid gap-3 xl:grid-cols-[300px_minmax(0,1fr)] xl:items-end">
            <LnkExistingRequestSearch
              value={existingRequestSearch}
              resultCount={filteredExistingRequestOptions.length}
              totalCount={existingRequestOptions.length}
              onCommit={setExistingRequestSearch}
            />
            <label className="block min-w-0 space-y-1.5 text-sm">
              <span className="text-[13px] font-medium leading-none text-slate-700">Существующая заявка</span>
              <RequestDocumentCombobox
                ariaLabel="Существующая заявка"
                value={existingRequestKey}
                options={visibleExistingRequestOptions}
                onChange={(request) => setExistingRequestKey(request?.key ?? '')}
              />
            </label>
          </div>
          <div className="mt-2 flex h-10 min-w-0 items-center overflow-hidden rounded-md border border-sky-200 bg-sky-50 px-3 text-xs text-sky-900">
            {selectedExistingRequest
              ? <span className="truncate">Выбрана заявка: <strong>{selectedExistingRequest.name}</strong> · {selectedExistingRequest.date || 'дата не указана'}</span>
              : existingRequestOptions.length === 0
                ? 'Созданных заявок ЛНК до ТО пока нет.'
                : 'Выберите заявку из списка.'}
          </div>
        </div>
      ) : null}

      {mode === 'request' ? (
        <LnkRequestMethods
          methods={PRE_HEAT_TREATMENT_REQUEST_METHOD_OPTIONS}
          selectedMethodKeys={[...selectedMethods]}
          selectedMethods={selectedMethods}
          requestDate={requestSubmitMode === 'create' ? date : undefined}
          requestDateInputRef={requestSubmitMode === 'create' ? dateInputRef : undefined}
          onRequestDateChange={requestSubmitMode === 'create' ? setDate : undefined}
          onToggleMethod={toggleMethod}
        />
      ) : (
        <LnkResultControlBar
          methodControl={(
            <label className="block space-y-1.5 text-sm">
              <span className="text-[13px] font-medium leading-none text-slate-700">Метод контроля</span>
              <Select aria-label="Метод контроля" value={resultMethod} onChange={(event) => changeResultMethod(event.target.value)} className="h-9 bg-white">
                <option value="">Выберите метод</option>
                {PRE_HEAT_TREATMENT_LNK_METHODS.map((method) => <option key={method.code} value={method.code}>{method.code}</option>)}
              </Select>
            </label>
          )}
          dateControl={(
            <label className="block space-y-1.5 text-sm">
              <span className="text-[13px] font-medium leading-none text-slate-700">Дата контроля</span>
              <Input ref={dateInputRef} type="date" value={date} onChange={(event) => setDate(event.target.value)} className="h-9 bg-white" />
            </label>
          )}
          resultControl={(
            <label className="block space-y-1.5 text-sm">
              <span className="text-[13px] font-medium leading-none text-slate-700">Результат для всех выбранных</span>
              <Select
                aria-label="Результат для всех выбранных"
                value={displayedDefaultResult}
                onChange={(event) => changeDefaultResult(event.target.value)}
                className="h-9 bg-white"
              >
                <option value="">Выберите результат</option>
                <option value={LNK_CUSTOM_RESULT_VALUE} disabled>Разные результаты</option>
                {PRE_HEAT_TREATMENT_RESULT_OPTIONS.map((result) => <option key={result} value={result}>{result}</option>)}
              </Select>
            </label>
          )}
          requestControl={(
            <label className="block min-w-0 space-y-1.5 text-sm">
              <span className="text-[13px] font-medium leading-none text-slate-700">Заявка ЛНК до ТО</span>
              <RequestDocumentCombobox
                ariaLabel="Заявка ЛНК до ТО"
                value={requestKey}
                options={requestOptions}
                onChange={(request) => changeRequest(request?.key ?? '')}
              />
            </label>
          )}
        />
      )}

      {mode === 'result' || requestSubmitMode === 'create' ? (
        <DocumentWorkspaceTabs
          activeTab={workspaceTab}
          ariaLabel={mode === 'request' ? 'Разделы заявки ЛНК до ТО' : 'Разделы результата ЛНК до ТО'}
          documentsLabel={mode === 'request' ? 'Заявки и имена' : 'Заключения и имена'}
          documentsCount={workflowGroups.length}
          documentsHaveError={Boolean(creationPlanError)}
          onChange={setWorkspaceTab}
        />
      ) : null}

      {workspaceTab === 'documents' && !(mode === 'request' && requestSubmitMode === 'extend') ? (
        <SystemDocumentNamesPanel
          plan={creationPlan}
          naming={naming}
          documentNameLabel={mode === 'request' ? 'Наименование заявки' : 'Наименование заключения'}
          documentNameAriaLabel={mode === 'request' ? 'Название заявки НК до ТО' : 'Название заключения НК до ТО'}
          documentNamePlaceholder={mode === 'request' ? 'Название заявки' : 'Название заключения'}
          emptyMessage="Выберите хотя бы один стык."
          disabled={mutation.isPending}
          onNamingChange={setNaming}
          onOpenGroupContextMenu={openGroupContextMenu}
        />
      ) : (
        <div className="flex min-h-0 flex-1 overflow-hidden px-5 py-3">
          <RequestRowsPanel
            title="Стыки"
            description=""
            viewToggle={<SelectedRowsViewToggle mode={rowsViewMode} selectedCount={selectedRows.length} onChange={setRowsViewMode} />}
            action={rowsViewMode === 'selected' ? (
              <Button variant="outline" size="sm" onClick={() => setSelectedIds(new Set())}>Снять весь выбор</Button>
            ) : (
              <Button variant="outline" size="sm" onClick={toggleAll} disabled={filteredAvailableRows.length === 0}>
                {mode === 'result' && !resultMethod
                  ? 'Выберите метод'
                  : mode === 'result' && !selectedRequest
                    ? 'Выберите заявку'
                    : allFilteredAvailableSelected
                  ? mode === 'result' ? 'Снять все' : 'Снять доступные'
                  : mode === 'result' ? 'Выбрать все доступные' : 'Выбрать доступные'}
              </Button>
            )}
            searchValue={displayedSearch}
            searchPlaceholder={rowsViewMode === 'selected' ? 'Поиск среди выбранных стыков' : 'Проект, шифр, линия, спул или стык'}
            filteredCount={displayedRows.length}
            availableCount={rowsViewMode === 'selected' ? selectedRows.length : filteredAvailableRows.length}
            statsLabel={rowsViewMode === 'selected' ? <>Найдено: {filteredSelectedRows.length} · Выбрано: {selectedRows.length}</> : undefined}
            isEmpty={displayedRows.length === 0}
            emptyMessage={mode === 'result' && !resultMethod
              ? 'Выберите вид контроля.'
              : mode === 'result' && !selectedRequest
                ? requestSelectionReason
                : rowsViewMode === 'selected'
                  ? 'Среди выбранных стыков ничего не найдено.'
                  : 'Стыков для этого действия не найдено.'}
            onSearchChange={rowsViewMode === 'selected' ? setSelectedSearch : setSearch}
          >
            {mode === 'result' ? (
              <div className={`grid shrink-0 ${LNK_RESULT_ROW_GRID_CLASS} gap-3 border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-semibold text-slate-500`}>
                <span />
                <span>Стык</span>
                <span>Заявки и заключения</span>
                <span>Результат</span>
                <span />
              </div>
            ) : null}
            <DialogVirtualizedRows
              key={`${pagination.page}:${pagination.pageSize}:${displayedSearch}:${rowsViewMode}:${requestKey}:${resultMethod}:${[...selectedMethods].join('|')}`}
              items={pagination.pageItems}
              estimateRowHeight={mode === 'result' ? 92 : 62}
              getItemKey={(row) => row.id}
              renderItem={(row) => (
                <PreHeatTreatmentLnkWorkflowRow
                  row={row}
                  mode={mode}
                  selectedMethods={selectedMethods}
                  resultMethod={resultMethod}
                  selected={selectedIds.has(row.id)}
                  disabledReason={getRowBlockReason(row) ?? ''}
                  rowResult={rowResults[row.id] ?? ''}
                  saveCheckSettings={saveCheckSettings}
                  onToggle={toggleRow}
                  onResultChange={(rowId, result) => setRowsResult([rowId], result)}
                  onOpenContextMenu={openRowContextMenu}
                />
              )}
              footer={(
                <DialogRowPagination
                  totalCount={pagination.totalCount}
                  firstItemNumber={pagination.firstItemNumber}
                  lastItemNumber={pagination.lastItemNumber}
                  page={pagination.page}
                  pageCount={pagination.pageCount}
                  pageSize={pagination.pageSize}
                  onPreviousPage={pagination.goToPreviousPage}
                  onNextPage={pagination.goToNextPage}
                  onPageSizeChange={pagination.setPageSize}
                />
              )}
            />
          </RequestRowsPanel>
        </div>
      )}

      <RequestDialogFooter
        isPending={mutation.isPending}
        isCreateDisabled={Boolean(saveBlockReason)}
        disabledReason={saveBlockReason}
        disabledReasonActions={saveBlockReason === effectiveDomainReason
          ? rootCauseState.actions.map((action) => ({
              key: action.key,
              label: action.label,
              onAction: () => runRootCauseAction(action),
            }))
          : undefined}
        disabledReasonActionLabel={creationPlanError && workspaceTab !== 'documents'
          ? `Открыть ${mode === 'request' ? 'заявки' : 'заключения'} и имена`
          : undefined}
        submitLabel={mode === 'request'
          ? requestSubmitMode === 'extend'
            ? 'Добавить в заявку до ТО'
            : 'Создать заявку до ТО'
          : 'Сохранить результат до ТО'}
        onDisabledReasonAction={creationPlanError && workspaceTab !== 'documents' ? () => setWorkspaceTab('documents') : undefined}
        onClose={onClose}
        onSubmit={() => onRunProtectedEdit(
          mode === 'request'
            ? requestSubmitMode === 'extend'
              ? 'добавление позиций в заявку НК до ТО'
              : 'создание заявки НК до ТО'
            : 'сохранение результата НК до ТО',
          () => mutation.mutate(),
        )}
      />
      <DialogContextMenuLayer ref={contextMenuRef} />
    </>
  )
  return embedded ? content : <WorkflowDialogShell>{content}</WorkflowDialogShell>
}

function getInitialRequestMethods(
  mode: PreHeatTreatmentLnkWorkflowRowMode,
  rows: WeldRow[],
  selectedIds: ReadonlySet<number>,
  initialMethodCode?: PreHeatTreatmentLnkMethodCode,
) {
  if (mode !== 'request') return new Set<PreHeatTreatmentLnkMethodCode>()
  if (
    initialMethodCode &&
    rows.some((row) => selectedIds.has(row.id) && canCreatePreHeatTreatmentRequest(row, initialMethodCode))
  ) {
    return new Set([initialMethodCode])
  }
  return new Set(PRE_HEAT_TREATMENT_LNK_METHODS.flatMap((method) =>
    rows.some((row) => selectedIds.has(row.id) && canCreatePreHeatTreatmentRequest(row, method.code))
      ? [method.code]
      : [],
  ))
}

function getInitialResultMethod(
  mode: PreHeatTreatmentLnkWorkflowRowMode,
  rows: WeldRow[],
  selectedIds: ReadonlySet<number>,
  initialMethodCode?: PreHeatTreatmentLnkMethodCode,
): PreHeatTreatmentLnkMethodCode | '' {
  if (mode !== 'result') return ''
  if (
    initialMethodCode &&
    rows.some((row) => selectedIds.has(row.id) && canAddPreHeatTreatmentResult(row, initialMethodCode))
  ) {
    return initialMethodCode
  }
  const selectedMethods = PRE_HEAT_TREATMENT_LNK_METHODS.filter((method) =>
    rows.some((row) => selectedIds.has(row.id) && canAddPreHeatTreatmentResult(row, method.code)),
  )
  if (selectedMethods.length > 0) return selectedMethods[0]!.code
  return PRE_HEAT_TREATMENT_LNK_METHODS.find((method) =>
    rows.some((row) => canAddPreHeatTreatmentResult(row, method.code)),
  )?.code ?? ''
}

function getPreHeatTreatmentRequestOptions(
  rows: WeldRow[],
  methodCode: PreHeatTreatmentLnkMethodCode | '',
): RequestDocumentIdentity[] {
  if (!methodCode) return []
  return collectRequestDocumentIdentities(rows.flatMap((row) => {
    if (!canAddPreHeatTreatmentResult(row, methodCode)) return []
    const control = getPreHeatTreatmentControl(row, methodCode)
    const identity = createRequestDocumentIdentity(control?.requestName, control?.requestDate)
    return identity ? [identity] : []
  }))
}

function getAllPreHeatTreatmentRequestOptions(rows: WeldRow[]) {
  return collectRequestDocumentIdentities(rows.flatMap((row) =>
    PRE_HEAT_TREATMENT_LNK_METHODS.flatMap((method) => {
      const control = getPreHeatTreatmentControl(row, method.code)
      const identity = createRequestDocumentIdentity(control?.requestName, control?.requestDate)
      return identity ? [identity] : []
    }),
  ))
}

function getAvailableRequestMethods(
  row: WeldRow,
  selectedMethods: ReadonlySet<PreHeatTreatmentLnkMethodCode>,
) {
  return PRE_HEAT_TREATMENT_LNK_METHODS.flatMap((method) =>
    selectedMethods.has(method.code) && canCreatePreHeatTreatmentRequest(row, method.code)
      ? [method.code]
      : [],
  )
}

function hasAvailableRequestPosition(
  row: WeldRow,
  selectedMethods: ReadonlySet<PreHeatTreatmentLnkMethodCode>,
) {
  return getAvailableRequestMethods(row, selectedMethods).length > 0
}

function getFirstRequestBlockReason(
  row: WeldRow,
  selectedMethods: ReadonlySet<PreHeatTreatmentLnkMethodCode>,
) {
  const reasons = [...selectedMethods].map((methodCode) =>
    getPreHeatTreatmentRequestBlockReason(row, methodCode),
  ).filter(Boolean)
  return reasons[0] ?? 'Нет доступных позиций НК до ТО.'
}

function getGroupPositions(
  group: SystemDocumentCreationGroup,
  mode: PreHeatTreatmentLnkWorkflowRowMode,
  selectedMethods: ReadonlySet<PreHeatTreatmentLnkMethodCode>,
  resultMethod: PreHeatTreatmentLnkMethodCode | '',
): PreHeatTreatmentLnkPosition[] {
  if (mode === 'result') {
    return resultMethod ? group.rows.map((row) => ({ rowId: row.id, methodCode: resultMethod })) : []
  }
  return group.rows.flatMap((row) => getAvailableRequestMethods(row, selectedMethods).map((methodCode) => ({
    rowId: row.id,
    methodCode,
  })))
}

function filterRows(rows: WeldRow[], search: string) {
  const query = normalizeSearchText(search)
  if (!query) return rows
  return rows.filter((row) => normalizeSearchText([
    row.projectTitle,
    row.subtitleCode,
    row.line,
    row.spool,
    row.joint,
    ...PRE_HEAT_TREATMENT_LNK_METHODS.flatMap((method) => {
      const control = getPreHeatTreatmentControl(row, method.code)
      return [control?.requestName, control?.conclusionName]
    }),
  ].join(' ')).includes(query))
}

function getOptionalPreHeatTreatmentResultDateReason(
  date: string,
  settings: SaveCheckSettings,
  systemNameRequiresDate: boolean,
) {
  if (!date.trim()) {
    return settings.lnkResultControlDateRequired || systemNameRequiresDate
      ? getDateInputValidationReason(date, 'Дата контроля НК до ТО')
      : null
  }
  return getDateInputValidationReason(date, 'Дата контроля НК до ТО')
}

function getSaveBlockReason({
  mode,
  isPending,
  selectedMethodsCount,
  resultMethod,
  requestSelected,
  existingRequestSelected,
  requestSubmitMode,
  requestSelectionReason,
  selectedRowsCount,
  dateReason,
  creationPlanError,
  domainReason,
}: {
  mode: PreHeatTreatmentLnkWorkflowRowMode
  isPending: boolean
  selectedMethodsCount: number
  resultMethod: PreHeatTreatmentLnkMethodCode | ''
  requestSelected: boolean
  existingRequestSelected: boolean
  requestSubmitMode: 'create' | 'extend'
  requestSelectionReason: string
  selectedRowsCount: number
  dateReason: string | null
  creationPlanError: string
  domainReason: string
}) {
  if (isPending) return 'Сохранение выполняется.'
  if (mode === 'request' && selectedMethodsCount === 0) return 'Выберите хотя бы один вид НК до ТО.'
  if (mode === 'request' && requestSubmitMode === 'extend' && !existingRequestSelected) {
    return 'Выберите существующую заявку НК до ТО.'
  }
  if (mode === 'result' && !resultMethod) return 'Выберите вид НК до ТО.'
  if (mode === 'result' && !requestSelected) return requestSelectionReason
  if (selectedRowsCount === 0) return 'Выберите хотя бы один доступный стык.'
  return dateReason || creationPlanError || domainReason || ''
}
