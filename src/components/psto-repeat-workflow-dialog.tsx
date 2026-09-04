import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { DialogContextMenuLayer, type DialogContextMenuLayerHandle } from '@/components/dialog-context-menu-layer'
import { DialogRowPagination } from '@/components/dialog-row-pagination'
import { DialogVirtualizedRows } from '@/components/dialog-virtualized-rows'
import { DocumentWorkspaceTabs, type DocumentWorkspaceTab } from '@/components/document-workspace-tabs'
import { WorkflowDialogShell } from '@/components/workflow-dialog-shell'
import {
  PstoRepeatWorkflowRow,
  type PstoRepeatWorkflowRowMode,
} from '@/components/psto-repeat-workflow-row'
import { RequestDialogFooter } from '@/components/request-dialog-footer'
import { RequestDialogHeader } from '@/components/request-dialog-header'
import { ResultDialogHeader } from '@/components/result-dialog-header'
import { RequestRowsPanel } from '@/components/request-rows-panel'
import { RequestDocumentCombobox } from '@/components/request-document-combobox'
import { SelectedRowsViewToggle, type SelectedRowsViewMode } from '@/components/selected-rows-view-toggle'
import { SystemDocumentNamesPanel } from '@/components/system-document-names-panel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatDateInputValue, getDateInputValidationReason } from '@/lib/date-format'
import {
  buildDialogRowContextMenu,
  buildDocumentGroupContextMenu,
  getDialogMenuPoint,
} from '@/lib/dialog-context-menu-items'
import type { WeldRow } from '@/lib/dispatcher-types'
import {
  buildRepeatPstoRequestCycle,
  buildRepeatPstoResultCycle,
} from '@/lib/psto-repeat-cycle-updates'
import {
  buildPstoRequestRows,
  buildPstoResultRows,
} from '@/lib/psto-report-mutation-updates'
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
import {
  canCreateRepeatPstoCycle,
  getCurrentPstoCycle,
  getPstoWorkflowCycleSequence,
} from '@/lib/tvmt-cycle'
import {
  canAddPstoWorkflowResult as canAddPstoResult,
  canCreatePstoWorkflowRequest as canCreatePstoRequest,
} from '@/lib/psto-status'
import { usePagePagination } from '@/lib/use-page-pagination'
import { useStableEventCallback } from '@/lib/use-stable-event-callback'
import { invalidateWeldJoints } from '@/lib/weld-query-utils'
import type { WeldFieldKey } from '@/lib/weld-fields'
import { useSaveCheckSettings, type SaveCheckSettings } from '@/lib/save-check-settings'
import { savePstoRepeatWorkflow } from '@/server/psto-repeat-workflow'

export type PstoRepeatWorkflowDialogProps = {
  mode: PstoRepeatWorkflowRowMode
  rows: WeldRow[]
  initialSelectedIds: ReadonlySet<number>
  onClose: () => void
  onRunProtectedEdit: (actionLabel: string, action: () => void) => void
  onSaved: (rows: WeldRow[], fieldKeys: WeldFieldKey[], message: string) => void
  onOpenJournalRows: (rows: readonly WeldRow[], sourceLabel: string) => void
  onOpenPstoHistory?: (row: WeldRow) => void
  onOpenResultManager?: (rows: readonly WeldRow[]) => void
}

export function PstoRepeatWorkflowDialog({
  mode,
  rows,
  initialSelectedIds,
  onClose,
  onRunProtectedEdit,
  onSaved,
  onOpenJournalRows,
  onOpenPstoHistory,
  onOpenResultManager,
}: PstoRepeatWorkflowDialogProps) {
  const queryClient = useQueryClient()
  const settings = useRequestConclusionSettings()
  const saveCheckSettings = useSaveCheckSettings()
  const contextMenuRef = useRef<DialogContextMenuLayerHandle>(null)
  const appliedInitialSelectionRef = useRef('')
  const [date, setDate] = useState(() => formatDateInputValue(new Date()))
  const [search, setSearch] = useState('')
  const [selectedSearch, setSelectedSearch] = useState('')
  const [rowsViewMode, setRowsViewMode] = useState<SelectedRowsViewMode>('all')
  const [workspaceTab, setWorkspaceTab] = useState<DocumentWorkspaceTab>('joints')
  const [naming, setNaming] = useState<RequestNamingState>(() =>
    getDefaultNamingState(settings, mode === 'request' ? 'pstoRequest' : 'pstoConclusion'),
  )
  const requestOptions = useMemo(() => getPstoRequestOptions(rows), [rows])
  const [requestKey, setRequestKey] = useState(() =>
    mode === 'result' ? getInitialRequestKey(rows, initialSelectedIds, requestOptions) : '',
  )
  const selectedRequest = requestOptions.find((option) => option.key === requestKey) ?? null
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() =>
    getInitialSelectedIds(mode, rows, initialSelectedIds, selectedRequest),
  )
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
    const contextKey = `${mode}:${initialSelectionSignature}:${loadedInitialRowsSignature}`
    if (appliedInitialSelectionRef.current === contextKey) return

    const nextRequestKey = mode === 'result'
      ? getInitialRequestKey(rows, initialSelectedIds, requestOptions)
      : ''
    const nextRequest = requestOptions.find((option) => option.key === nextRequestKey) ?? null
    setRequestKey(nextRequestKey)
    setSelectedIds(getInitialSelectedIds(mode, rows, initialSelectedIds, nextRequest))
    setRowsViewMode('all')
    appliedInitialSelectionRef.current = contextKey
  }, [initialSelectedIds, initialSelectionSignature, loadedInitialRowsSignature, mode, requestOptions, rows])
  const { data: sequences } = useQuery({
    queryKey: SYSTEM_DOCUMENT_SEQUENCES_QUERY_KEY,
    queryFn: loadSystemDocumentSequences,
    staleTime: 30_000,
  })
  const requestRows = useMemo(() => {
    if (mode !== 'result') return rows
    if (!selectedRequest) return []
    return rows.filter((row) => {
      const cycle = getCurrentPstoCycle(row)
      return isSameRequestDocument(cycle?.pstoRequest, cycle?.pstoRequestDate, selectedRequest)
    })
  }, [mode, rows, selectedRequest])
  const canSelectRow = useStableEventCallback((row: WeldRow) => (
    mode === 'request' ? canCreatePstoRequest(row) : canAddPstoResult(row)
  ))
  const availableRows = useMemo(
    () => requestRows.filter((row) => (
      mode === 'request' ? canCreatePstoRequest(row) : canAddPstoResult(row)
    )),
    [requestRows, mode],
  )
  const filteredRows = useMemo(() => filterRows(requestRows, search), [requestRows, search])
  const filteredAvailableRows = useMemo(
    () => filteredRows.filter((row) => (
      mode === 'request' ? canCreatePstoRequest(row) : canAddPstoResult(row)
    )),
    [filteredRows, mode],
  )
  const selectedRows = useMemo(
    () => rows.filter((row) => selectedIds.has(row.id)),
    [rows, selectedIds],
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
    resetKeys: [displayedSearch, rowsViewMode, requestKey],
  })
  const creationPlan = useMemo(() => buildSystemDocumentCreationPlan({
    type: mode === 'request' ? 'pstoRequest' : 'pstoConclusion',
    date,
    rows: selectedRows,
    naming,
    settings,
    nextNumber: mode === 'request' ? sequences?.pstoRequest : sequences?.pstoConclusion,
    allowAllNamesEmpty: mode === 'result' && !saveCheckSettings.pstoResultDiagramRequired,
  }), [date, mode, naming, saveCheckSettings.pstoResultDiagramRequired, selectedRows, sequences, settings])
  const dateReason = mode === 'request'
    ? getDateInputValidationReason(date, 'Дата заявки ПСТО')
    : getOptionalPstoResultDateReason(date, saveCheckSettings, naming.mode === 'system')
  const domainReason = useMemo(() => {
    if (selectedRows.length === 0 || dateReason || creationPlan.error) return ''
    try {
      for (const group of creationPlan.groups) {
        for (const row of group.rows) {
          if (mode === 'request') {
            validatePstoRequestRow(row, group.name, date, saveCheckSettings)
          } else {
            validatePstoResultRow(row, date, group.name, saveCheckSettings)
          }
        }
      }
      return ''
    } catch (error) {
      return (error as Error).message
    }
  }, [creationPlan, date, dateReason, mode, saveCheckSettings, selectedRows.length])
  useEffect(() => {
    if (selectedIds.size === 0 && rowsViewMode === 'selected') setRowsViewMode('all')
  }, [rowsViewMode, selectedIds.size])

  const mutation = useMutation({
    mutationFn: async () => savePstoRepeatWorkflow({ data: {
      action: mode === 'request' ? 'pstoRequest' : 'pstoResult',
      date,
      groups: creationPlan.groups.map((group) => ({
        rowIds: group.rowIds,
        name: group.name,
        useSystemName: group.useSystemName,
      })),
      expectedVersions: selectedRows.map((row) => ({
        id: row.id,
        version: String(row.rowVersion ?? '').trim(),
      })),
    } }),
    onSuccess: async (savedRows) => {
      const resultRows = savedRows as WeldRow[]
      await invalidateWeldJoints(queryClient, { upsertRows: resultRows })
      await queryClient.invalidateQueries({ queryKey: SYSTEM_DOCUMENT_SEQUENCES_QUERY_KEY })
      onSaved(
        resultRows,
        mode === 'request'
          ? ['pstoRequest', 'pstoRequestDate', 'finalStatus']
          : ['pstoDate', 'pstoResult', 'heatTreatmentDiagram', 'finalStatus'],
        mode === 'request'
          ? `Создано заявок ПСТО: ${creationPlan.groups.length} · стыков: ${resultRows.length}`
          : `Внесено результатов ПСТО: ${resultRows.length} · диаграмм: ${creationPlan.groups.length}`,
      )
      onClose()
    },
    onError: (error) => onSaved([], [], (error as Error).message),
  })
  const saveBlockReason = mutation.isPending
    ? 'Сохранение выполняется.'
    : mode === 'result' && !selectedRequest
      ? 'Выберите заявку ПСТО.'
      : selectedRows.length === 0
        ? 'Выберите хотя бы один доступный стык.'
        : dateReason || creationPlan.error || domainReason

  const setSelectedRows = useStableEventCallback((rowIds: number[]) => {
    const allowedIds = new Set(requestRows.filter(canSelectRow).map((row) => row.id))
    setSelectedIds(new Set(rowIds.filter((rowId) => allowedIds.has(rowId))))
  })
  const toggleRow = useStableEventCallback((rowId: number) => {
    const row = rows.find((candidate) => candidate.id === rowId)
    if (!row || !canSelectRow(row)) return
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(rowId)) next.delete(rowId)
      else next.add(rowId)
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
      isRowSelectable: (candidate) => Boolean(canSelectRow(candidate)),
      sourceLabel: mode === 'request' ? 'заявки ПСТО' : 'результата ПСТО',
      relatedSelection: mode === 'result' && selectedRequest
        ? { label: 'Выбрать доступные по этой заявке', rows: availableRows }
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
      sourceLabel: mode === 'request' ? 'заявки ПСТО' : 'диаграммы ПСТО',
      onOpenJournalRows,
    }))
  })

  return (
    <WorkflowDialogShell>
      {mode === 'request' ? (
        <RequestDialogHeader
          title="Заявка ПСТО"
          subtitle={`Первичный и повторные циклы · Выбрано стыков: ${selectedRows.length}`}
          onClose={onClose}
        />
      ) : (
        <ResultDialogHeader
          title="Внесение результатов ПСТО"
          requestName={selectedRequest?.name ?? ''}
          selectedCount={selectedRows.length}
          managerDisabled={!onOpenResultManager || requestRows.length === 0}
          managerDisabledReason="Сначала выберите заявку ПСТО с доступными позициями."
          onOpenManager={() => onOpenResultManager?.(requestRows)}
          onClose={onClose}
        />
      )}

      <section className={`grid shrink-0 gap-3 border-b border-slate-100 bg-slate-50/40 px-5 py-2.5 ${
        mode === 'result' ? 'grid-cols-[190px_minmax(360px,1fr)]' : 'grid-cols-[190px]'
      }`}>
        <label className="block space-y-1.5 text-sm">
          <span className="text-[13px] font-medium leading-none text-slate-700">
            {mode === 'request' ? 'Дата заявки' : 'Дата ПСТО'}
          </span>
          <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="h-9 bg-white" />
        </label>
        {mode === 'result' ? (
          <label className="block min-w-0 space-y-1.5 text-sm">
            <span className="text-[13px] font-medium leading-none text-slate-700">Заявка ПСТО</span>
            <RequestDocumentCombobox
              ariaLabel="Заявка ПСТО"
              value={requestKey}
              options={requestOptions}
              placeholder="Найдите заявку по названию или дате"
              onChange={(request) => {
                setRequestKey(request?.key ?? '')
                setSelectedIds(new Set())
                setRowsViewMode('all')
              }}
            />
          </label>
        ) : null}
      </section>

      <DocumentWorkspaceTabs
        activeTab={workspaceTab}
        ariaLabel="Разделы ПСТО"
        documentsLabel={mode === 'request' ? 'Заявки и имена' : 'Диаграммы и имена'}
        documentsCount={creationPlan.groups.length}
        documentsHaveError={Boolean(creationPlan.error)}
        onChange={setWorkspaceTab}
      />

      {workspaceTab === 'documents' ? (
        <SystemDocumentNamesPanel
          plan={creationPlan}
          naming={naming}
          documentNameLabel={mode === 'request' ? 'Наименование заявки' : 'Наименование диаграммы'}
          documentNameAriaLabel={mode === 'request' ? 'Название заявки ПСТО' : 'Название диаграммы ПСТО'}
          documentNamePlaceholder={mode === 'request' ? 'Название заявки' : 'Название диаграммы'}
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
            viewToggle={<SelectedRowsViewToggle mode={rowsViewMode} selectedCount={selectedIds.size} onChange={setRowsViewMode} />}
            action={rowsViewMode === 'selected' ? (
              <Button variant="outline" size="sm" onClick={() => setSelectedIds(new Set())}>Снять весь выбор</Button>
            ) : (
              <Button variant="outline" size="sm" onClick={toggleAll} disabled={filteredAvailableRows.length === 0}>
                {allFilteredAvailableSelected ? 'Снять доступные' : 'Выбрать доступные'}
              </Button>
            )}
            searchValue={displayedSearch}
            searchPlaceholder={rowsViewMode === 'selected' ? 'Поиск среди выбранных стыков' : 'Проект, шифр, линия, спул или стык'}
            filteredCount={displayedRows.length}
            availableCount={rowsViewMode === 'selected' ? selectedRows.length : filteredAvailableRows.length}
            statsLabel={rowsViewMode === 'selected'
              ? <>Найдено: {filteredSelectedRows.length} · Выбрано: {selectedRows.length}</>
              : undefined}
            isEmpty={displayedRows.length === 0}
            emptyMessage={mode === 'result' && !selectedRequest
              ? 'Выберите заявку ПСТО.'
              : 'Стыков для этого действия не найдено.'}
            onSearchChange={rowsViewMode === 'selected' ? setSelectedSearch : setSearch}
          >
            <DialogVirtualizedRows
              key={`${pagination.page}:${pagination.pageSize}:${displayedSearch}:${rowsViewMode}:${requestKey}`}
              items={pagination.pageItems}
              estimateRowHeight={82}
              getItemKey={(row) => row.id}
              renderItem={(row) => (
                <PstoRepeatWorkflowRow
                  row={row}
                  mode={mode}
                  selected={selectedIds.has(row.id)}
                  disabled={!canSelectRow(row)}
                  onToggle={toggleRow}
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
        disabledReasonActionLabel={creationPlan.error && workspaceTab !== 'documents'
          ? `Открыть ${mode === 'request' ? 'заявки' : 'диаграммы'} и имена`
          : undefined}
        submitLabel={mode === 'request' ? 'Создать заявку' : 'Сохранить результат'}
        onDisabledReasonAction={creationPlan.error && workspaceTab !== 'documents'
          ? () => setWorkspaceTab('documents')
          : undefined}
        onClose={onClose}
        onSubmit={() => onRunProtectedEdit(
          mode === 'request' ? 'создание заявки ПСТО' : 'сохранение результата ПСТО',
          () => mutation.mutate(),
        )}
      />
      <DialogContextMenuLayer ref={contextMenuRef} />
    </WorkflowDialogShell>
  )
}

function getPstoRequestOptions(rows: WeldRow[]) {
  return collectRequestDocumentIdentities(rows.flatMap((row) => {
    if (!canAddPstoResult(row)) return []
    const cycle = getCurrentPstoCycle(row)
    const identity = createRequestDocumentIdentity(cycle?.pstoRequest, cycle?.pstoRequestDate)
    return identity ? [identity] : []
  }))
}

function getInitialRequestKey(
  rows: WeldRow[],
  initialSelectedIds: ReadonlySet<number>,
  options: RequestDocumentIdentity[],
) {
  const keys = new Set(rows.flatMap((row) => {
    if (!initialSelectedIds.has(row.id) || !canAddPstoResult(row)) return []
    const cycle = getCurrentPstoCycle(row)
    const identity = createRequestDocumentIdentity(cycle?.pstoRequest, cycle?.pstoRequestDate)
    return identity ? [identity.key] : []
  }))
  if (keys.size === 1) return [...keys][0] ?? ''
  return options.length === 1 ? options[0]?.key ?? '' : ''
}

function getInitialSelectedIds(
  mode: PstoRepeatWorkflowRowMode,
  rows: WeldRow[],
  initialSelectedIds: ReadonlySet<number>,
  selectedRequest: RequestDocumentIdentity | null,
) {
  return new Set(rows.flatMap((row) => {
    if (!initialSelectedIds.has(row.id)) return []
    if (mode === 'request') return canCreatePstoRequest(row) ? [row.id] : []
    const cycle = getCurrentPstoCycle(row)
    return selectedRequest &&
      canAddPstoResult(row) &&
      isSameRequestDocument(cycle?.pstoRequest, cycle?.pstoRequestDate, selectedRequest)
      ? [row.id]
      : []
  }))
}

function validatePstoRequestRow(
  row: WeldRow,
  requestName: string,
  requestDate: string,
  saveCheckSettings: SaveCheckSettings,
) {
  if (canCreateRepeatPstoCycle(row)) {
    buildRepeatPstoRequestCycle({ row, requestName, requestDate, saveCheckSettings })
    return
  }
  buildPstoRequestRows({ records: [row], requestName, requestDate, saveCheckSettings })
}

function validatePstoResultRow(
  row: WeldRow,
  pstoDate: string,
  diagramName: string,
  saveCheckSettings: SaveCheckSettings,
) {
  if (getCurrentPstoCycle(row)?.source === 'repeat') {
    buildRepeatPstoResultCycle({ row, pstoDate, diagramName, saveCheckSettings })
    return
  }
  buildPstoResultRows({
    records: [row],
    pstoDate,
    result: 'проведено',
    diagramName,
    rows: [row],
    saveCheckSettings,
  })
}

function getOptionalPstoResultDateReason(
  date: string,
  settings: SaveCheckSettings,
  systemNameRequiresDate: boolean,
) {
  if (!date.trim()) {
    return settings.pstoResultDateRequired || systemNameRequiresDate
      ? getDateInputValidationReason(date, 'Дата ПСТО')
      : null
  }
  return getDateInputValidationReason(date, 'Дата ПСТО')
}

function filterRows(rows: WeldRow[], search: string) {
  const query = normalizeSearchText(search)
  if (!query) return rows
  return rows.filter((row) => {
    const cycle = getCurrentPstoCycle(row)
    return normalizeSearchText([
      row.projectTitle,
      row.subtitleCode,
      row.line,
      row.spool,
      row.joint,
      cycle?.pstoRequest,
      cycle?.heatTreatmentDiagram,
    ].join(' ')).includes(query)
  })
}
