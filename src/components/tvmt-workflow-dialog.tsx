import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { DialogContextMenuLayer, type DialogContextMenuLayerHandle } from '@/components/dialog-context-menu-layer'
import { DialogRowPagination } from '@/components/dialog-row-pagination'
import { DialogVirtualizedRows } from '@/components/dialog-virtualized-rows'
import { DocumentWorkspaceTabs, type DocumentWorkspaceTab } from '@/components/document-workspace-tabs'
import { WorkflowDialogShell } from '@/components/workflow-dialog-shell'
import { RequestDocumentCombobox } from '@/components/request-document-combobox'
import { RequestDialogFooter } from '@/components/request-dialog-footer'
import { RequestDialogHeader } from '@/components/request-dialog-header'
import { ResultDialogHeader } from '@/components/result-dialog-header'
import { RequestRowsPanel } from '@/components/request-rows-panel'
import { SelectedRowsViewToggle, type SelectedRowsViewMode } from '@/components/selected-rows-view-toggle'
import { SystemDocumentNamesPanel } from '@/components/system-document-names-panel'
import { TvmtWorkflowRow, type TvmtWorkflowRowMode } from '@/components/tvmt-workflow-row'
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
import {
  canAddTvmtResult,
  canCreateTvmtRequest,
  getTvmtWorkflowBlockReason,
  buildPrimaryTvmtRequestRows,
  buildPrimaryTvmtResultRows,
  getCurrentTvmtDocumentFields,
} from '@/lib/tvmt-field-updates'
import {
  buildRepeatTvmtRequestCycle,
  buildRepeatTvmtResultCycle,
} from '@/lib/psto-repeat-cycle-updates'
import {
  getCurrentPstoCycle,
  TVMT_RESULT_OPTIONS,
} from '@/lib/tvmt-cycle'
import { usePagePagination } from '@/lib/use-page-pagination'
import { useStableEventCallback } from '@/lib/use-stable-event-callback'
import { invalidateWeldJoints } from '@/lib/weld-query-utils'
import type { WeldFieldKey } from '@/lib/weld-fields'
import { savePstoRepeatWorkflow } from '@/server/psto-repeat-workflow'

export type TvmtWorkflowDialogProps = {
  mode: TvmtWorkflowRowMode
  rows: WeldRow[]
  initialSelectedIds: ReadonlySet<number>
  onClose: () => void
  onRunProtectedEdit: (actionLabel: string, action: () => void) => void
  onSaved: (rows: WeldRow[], fieldKeys: WeldFieldKey[], message: string) => void
  onOpenJournalRows: (rows: readonly WeldRow[], sourceLabel: string) => void
  onOpenPstoHistory?: (row: WeldRow) => void
  onOpenResultManager?: (rows: readonly WeldRow[]) => void
}

type SaveResult = {
  rows: WeldRow[]
  documentCount: number
}

const TVMT_CONCLUSION_SEQUENCE_ID = getSystemDocumentTemplateId({
  type: 'lnkConclusion',
  methodCode: 'ТВМТ',
})

export function TvmtWorkflowDialog({
  mode,
  rows,
  initialSelectedIds,
  onClose,
  onRunProtectedEdit,
  onSaved,
  onOpenJournalRows,
  onOpenPstoHistory,
  onOpenResultManager,
}: TvmtWorkflowDialogProps) {
  const queryClient = useQueryClient()
  const settings = useRequestConclusionSettings()
  const contextMenuRef = useRef<DialogContextMenuLayerHandle>(null)
  const appliedInitialSelectionRef = useRef('')
  const [date, setDate] = useState(() => formatDateInputValue(new Date()))
  const [search, setSearch] = useState('')
  const [selectedSearch, setSelectedSearch] = useState('')
  const [rowsViewMode, setRowsViewMode] = useState<SelectedRowsViewMode>('all')
  const [workspaceTab, setWorkspaceTab] = useState<DocumentWorkspaceTab>('joints')
  const [naming, setNaming] = useState<RequestNamingState>(() =>
    getDefaultNamingState(settings, mode === 'request' ? 'lnkRequest' : 'lnkConclusion'),
  )
  const requestOptions = useMemo(() => getTvmtRequestOptions(rows), [rows])
  const [requestKey, setRequestKey] = useState(() =>
    mode === 'result' ? getInitialRequestKey(rows, initialSelectedIds, requestOptions) : '',
  )
  const [defaultResult, setDefaultResult] = useState('')
  const [rowResults, setRowResults] = useState<Record<number, string>>({})
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() =>
    getInitialSelectedIds(mode, rows, initialSelectedIds, requestKey, requestOptions),
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
    setRequestKey(nextRequestKey)
    setSelectedIds(getInitialSelectedIds(mode, rows, initialSelectedIds, nextRequestKey, requestOptions))
    setRowsViewMode('all')
    appliedInitialSelectionRef.current = contextKey
  }, [initialSelectedIds, initialSelectionSignature, loadedInitialRowsSignature, mode, requestOptions, rows])
  const { data: sequences } = useQuery({
    queryKey: SYSTEM_DOCUMENT_SEQUENCES_QUERY_KEY,
    queryFn: loadSystemDocumentSequences,
    staleTime: 30_000,
  })
  const selectedRequest = requestOptions.find((option) => option.key === requestKey) ?? null
  const requestRows = useMemo(() => {
    if (mode !== 'result') return rows
    if (!selectedRequest) return []
    return rows.filter((row) => {
      const current = getCurrentTvmtDocumentFields(row)
      return isSameRequestDocument(current.requestName, current.requestDate, selectedRequest)
    })
  }, [mode, rows, selectedRequest])
  const canSelectRow = useStableEventCallback((row: WeldRow) => (
    mode === 'request' ? canCreateTvmtRequest(row) : canAddTvmtResult(row)
  ))
  const availableRows = useMemo(
    () => requestRows.filter((row) => (
      mode === 'request' ? canCreateTvmtRequest(row) : canAddTvmtResult(row)
    )),
    [requestRows, mode],
  )
  const filteredRows = useMemo(
    () => filterTvmtRows(requestRows, search),
    [requestRows, search],
  )
  const filteredAvailableRows = useMemo(
    () => filteredRows.filter((row) => (
      mode === 'request' ? canCreateTvmtRequest(row) : canAddTvmtResult(row)
    )),
    [filteredRows, mode],
  )
  const selectedRows = useMemo(
    () => rows.filter((row) => selectedIds.has(row.id)),
    [rows, selectedIds],
  )
  const filteredSelectedRows = useMemo(
    () => filterTvmtRows(selectedRows, selectedSearch),
    [selectedRows, selectedSearch],
  )
  const displayedRows = rowsViewMode === 'selected' ? filteredSelectedRows : filteredRows
  const displayedSearch = rowsViewMode === 'selected' ? selectedSearch : search
  const pagination = usePagePagination({
    items: displayedRows,
    defaultPageSize: 50,
    resetKeys: [displayedSearch, rowsViewMode, requestKey],
  })
  const nextNumber = mode === 'request'
    ? sequences?.lnkRequest
    : sequences?.[TVMT_CONCLUSION_SEQUENCE_ID]
  const creationPlan = useMemo(() => buildSystemDocumentCreationPlan({
    type: mode === 'request' ? 'lnkRequest' : 'lnkConclusion',
    methodCode: 'ТВМТ',
    date,
    rows: selectedRows,
    naming,
    settings,
    nextNumber,
  }), [date, mode, naming, nextNumber, selectedRows, settings])
  const dateReason = getDateInputValidationReason(
    date,
    mode === 'request' ? 'Дата заявки ТВМТ' : 'Дата ТВМТ',
  )
  const domainReason = useMemo(() => {
    if (selectedRows.length === 0 || dateReason || creationPlan.error) return ''
    try {
      for (const group of creationPlan.groups) {
        if (mode === 'request') {
          for (const row of group.rows) validateTvmtRequestRow(row, group.name, date)
          continue
        }
        for (const row of group.rows) {
          validateTvmtResultRow(row, date, rowResults[row.id] ?? '', group.name)
        }
      }
      return ''
    } catch (error) {
      return (error as Error).message
    }
  }, [creationPlan, date, dateReason, mode, rowResults, selectedRows.length])
  useEffect(() => {
    if (selectedIds.size === 0 && rowsViewMode === 'selected') setRowsViewMode('all')
  }, [rowsViewMode, selectedIds.size])

  const mutation = useMutation({
    mutationFn: async (): Promise<SaveResult> => {
      const savedRows = await savePstoRepeatWorkflow({ data: {
        action: mode === 'request' ? 'tvmtRequest' : 'tvmtResult',
        date,
        groups: creationPlan.groups.map((group) => ({
          rowIds: group.rowIds,
          name: group.name,
          useSystemName: group.useSystemName,
        })),
        results: mode === 'result'
          ? selectedRows.map((row) => ({ rowId: row.id, result: rowResults[row.id] ?? '' }))
          : [],
      } })
      return { rows: savedRows as WeldRow[], documentCount: creationPlan.groups.length }
    },
    onSuccess: async (result) => {
      await invalidateWeldJoints(queryClient, { upsertRows: result.rows })
      await queryClient.invalidateQueries({ queryKey: SYSTEM_DOCUMENT_SEQUENCES_QUERY_KEY })
      onSaved(
        result.rows,
        mode === 'request'
          ? ['tvmtRequest', 'tvmtRequestDate', 'tvmtResult', 'finalStatus']
          : ['tvmtResult', 'tvmtConclusionDate', 'tvmtConclusion', 'finalStatus'],
        mode === 'request'
          ? `Создано заявок ТВМТ: ${result.documentCount} · стыков: ${result.rows.length}`
          : `Внесено результатов ТВМТ: ${result.rows.length} · заключений: ${result.documentCount}`,
      )
      onClose()
    },
    onError: (error) => {
      onSaved([], [], (error as Error).message)
    },
  })
  const effectiveSaveBlockReason = getSaveBlockReason({
    mode,
    isPending: mutation.isPending,
    selectedRowsCount: selectedRows.length,
    requestSelected: Boolean(selectedRequest),
    dateReason,
    creationPlanError: creationPlan.error,
    domainReason,
  })
  const setSelectedRows = useStableEventCallback((rowIds: number[]) => {
    const allowedIds = new Set(requestRows.filter(canSelectRow).map((row) => row.id))
    const nextIds = new Set(rowIds.filter((id) => allowedIds.has(id)))
    setSelectedIds(nextIds)
    if (mode === 'result' && defaultResult) {
      setRowResults((current) => {
        const next = { ...current }
        nextIds.forEach((id) => { if (!next[id]) next[id] = defaultResult })
        return next
      })
    }
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
      isRowSelectable: (candidate) => Boolean(canSelectRow(candidate)),
      sourceLabel: mode === 'request' ? 'заявки ТВМТ' : 'результата ТВМТ',
      relatedSelection: mode === 'result' && selectedRequest
        ? { label: 'Выбрать доступные по этой заявке', rows: availableRows }
        : undefined,
      resultAssignment: mode === 'result'
        ? {
            values: TVMT_RESULT_OPTIONS,
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
      sourceLabel: mode === 'request' ? 'заявки ТВМТ' : 'заключения ТВМТ',
      onOpenJournalRows,
    }))
  })
  const changeRequest = (nextKey: string) => {
    setRequestKey(nextKey)
    setSelectedIds(new Set())
    setRowsViewMode('all')
  }
  const changeDefaultResult = (result: string) => {
    setDefaultResult(result)
    if (!result) return
    setRowsResult([...selectedIds], result)
  }

  return (
    <WorkflowDialogShell>
      {mode === 'request' ? (
        <RequestDialogHeader
          title="Заявка ТВМТ"
          subtitle={`После проведенной ПСТО · Выбрано стыков: ${selectedRows.length}`}
          onClose={onClose}
        />
      ) : (
        <ResultDialogHeader
          title="Внесение результатов ТВМТ"
          requestName={selectedRequest?.name ?? ''}
          selectedCount={selectedRows.length}
          managerDisabled={!onOpenResultManager || requestRows.length === 0}
          managerDisabledReason="Сначала выберите заявку ТВМТ с доступными позициями."
          onOpenManager={() => onOpenResultManager?.(requestRows)}
          onClose={onClose}
        />
      )}

      <section className={`grid shrink-0 gap-3 border-b border-slate-100 bg-slate-50/40 px-5 py-2.5 ${
        mode === 'result'
          ? 'grid-cols-[190px_220px_minmax(320px,1fr)]'
          : 'grid-cols-[190px]'
      }`}>
        <label className="block space-y-1.5 text-sm">
          <span className="text-[13px] font-medium leading-none text-slate-700">
            {mode === 'request' ? 'Дата заявки' : 'Дата ТВМТ'}
          </span>
          <Input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="h-9 bg-white"
          />
        </label>
        {mode === 'result' ? (
          <label className="block space-y-1.5 text-sm">
            <span className="text-[13px] font-medium leading-none text-slate-700">Результат для выбранных</span>
            <Select
              aria-label="Результат для выбранных"
              value={defaultResult}
              onChange={(event) => changeDefaultResult(event.target.value)}
              className="h-9 bg-white"
            >
              <option value="">По строкам</option>
              {TVMT_RESULT_OPTIONS.map((result) => <option key={result} value={result}>{result}</option>)}
            </Select>
          </label>
        ) : null}
        {mode === 'result' ? (
          <label className="block min-w-0 space-y-1.5 text-sm">
            <span className="text-[13px] font-medium leading-none text-slate-700">Заявка ТВМТ</span>
            <RequestDocumentCombobox
              ariaLabel="Заявка ТВМТ"
              value={requestKey}
              options={requestOptions}
              placeholder="Найдите заявку по названию или дате"
              onChange={(request) => changeRequest(request?.key ?? '')}
            />
          </label>
        ) : null}
      </section>

      <DocumentWorkspaceTabs
        activeTab={workspaceTab}
        ariaLabel={mode === 'request' ? 'Разделы заявки ТВМТ' : 'Разделы результата ТВМТ'}
        documentsLabel={mode === 'request' ? 'Заявки и имена' : 'Заключения и имена'}
        documentsCount={creationPlan.groups.length}
        documentsHaveError={Boolean(creationPlan.error)}
        onChange={setWorkspaceTab}
      />

      {workspaceTab === 'documents' ? (
        <SystemDocumentNamesPanel
          plan={creationPlan}
          naming={naming}
          documentNameLabel={mode === 'request' ? 'Наименование заявки' : 'Наименование заключения'}
          documentNameAriaLabel={mode === 'request' ? 'Название заявки ТВМТ' : 'Название заключения ТВМТ'}
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
            viewToggle={(
              <SelectedRowsViewToggle mode={rowsViewMode} selectedCount={selectedIds.size} onChange={setRowsViewMode} />
            )}
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
              ? 'Выберите заявку ТВМТ.'
              : rowsViewMode === 'selected'
                ? 'Среди выбранных стыков ничего не найдено.'
                : 'Стыков для этого действия не найдено.'}
            onSearchChange={rowsViewMode === 'selected' ? setSelectedSearch : setSearch}
          >
            <DialogVirtualizedRows
              key={`${pagination.page}:${pagination.pageSize}:${displayedSearch}:${rowsViewMode}:${requestKey}`}
              items={pagination.pageItems}
              estimateRowHeight={82}
              getItemKey={(row) => row.id}
              renderItem={(row) => (
                <TvmtWorkflowRow
                  row={row}
                  mode={mode}
                  selected={selectedIds.has(row.id)}
                  disabled={!canSelectRow(row)}
                  disabledReason={getTvmtWorkflowBlockReason(row, mode)}
                  rowResult={rowResults[row.id] ?? ''}
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
        isCreateDisabled={Boolean(effectiveSaveBlockReason)}
        disabledReason={effectiveSaveBlockReason}
        disabledReasonActionLabel={creationPlan.error && workspaceTab !== 'documents'
          ? `Открыть ${mode === 'request' ? 'заявки' : 'заключения'} и имена`
          : undefined}
        submitLabel={mode === 'request' ? 'Создать заявку' : 'Сохранить результат'}
        onDisabledReasonAction={creationPlan.error && workspaceTab !== 'documents'
          ? () => setWorkspaceTab('documents')
          : undefined}
        onClose={onClose}
        onSubmit={() => onRunProtectedEdit(
          mode === 'request' ? 'создание заявки ТВМТ' : 'сохранение результата ТВМТ',
          () => mutation.mutate(),
        )}
      />
      <DialogContextMenuLayer ref={contextMenuRef} />
    </WorkflowDialogShell>
  )
}

function getTvmtRequestOptions(rows: WeldRow[]) {
  return collectRequestDocumentIdentities(rows.flatMap((row) => {
    const current = getCurrentTvmtDocumentFields(row)
    const identity = createRequestDocumentIdentity(current.requestName, current.requestDate)
    return identity ? [identity] : []
  }))
}

function getInitialRequestKey(
  rows: WeldRow[],
  initialSelectedIds: ReadonlySet<number>,
  options: RequestDocumentIdentity[],
) {
  const selectedKeys = new Set(rows.flatMap((row) => {
    if (!initialSelectedIds.has(row.id) || !canAddTvmtResult(row)) return []
    const current = getCurrentTvmtDocumentFields(row)
    const identity = createRequestDocumentIdentity(current.requestName, current.requestDate)
    return identity ? [identity.key] : []
  }))
  if (selectedKeys.size === 1) return [...selectedKeys][0] ?? ''
  return options.length === 1 ? options[0]?.key ?? '' : ''
}

function getInitialSelectedIds(
  mode: TvmtWorkflowRowMode,
  rows: WeldRow[],
  initialSelectedIds: ReadonlySet<number>,
  requestKey: string,
  requestOptions: RequestDocumentIdentity[],
) {
  const request = requestOptions.find((option) => option.key === requestKey)
  return new Set(rows.flatMap((row) => {
    if (!initialSelectedIds.has(row.id)) return []
    if (mode === 'request') return canCreateTvmtRequest(row) ? [row.id] : []
    const current = getCurrentTvmtDocumentFields(row)
    return request &&
      canAddTvmtResult(row) &&
      isSameRequestDocument(current.requestName, current.requestDate, request)
      ? [row.id]
      : []
  }))
}

function filterTvmtRows(rows: WeldRow[], search: string) {
  const query = normalizeSearchText(search)
  if (!query) return rows
  return rows.filter((row) => normalizeSearchText([
    row.projectTitle,
    row.subtitleCode,
    row.line,
    row.spool,
    row.joint,
    getCurrentTvmtDocumentFields(row).requestName,
    getCurrentTvmtDocumentFields(row).conclusionName,
  ].join(' ')).includes(query))
}

function validateTvmtRequestRow(row: WeldRow, requestName: string, requestDate: string) {
  if (getCurrentPstoCycle(row)?.source === 'repeat') {
    buildRepeatTvmtRequestCycle({ row, requestName, requestDate })
    return
  }
  buildPrimaryTvmtRequestRows({ records: [row], requestName, requestDate })
}

function validateTvmtResultRow(
  row: WeldRow,
  controlDate: string,
  result: string,
  conclusionName: string,
) {
  if (getCurrentPstoCycle(row)?.source === 'repeat') {
    buildRepeatTvmtResultCycle({ row, controlDate, result, conclusionName })
    return
  }
  buildPrimaryTvmtResultRows({ records: [row], controlDate, result, conclusionName })
}

function getSaveBlockReason({
  mode,
  isPending,
  selectedRowsCount,
  requestSelected,
  dateReason,
  creationPlanError,
  domainReason,
}: {
  mode: TvmtWorkflowRowMode
  isPending: boolean
  selectedRowsCount: number
  requestSelected: boolean
  dateReason: string | null
  creationPlanError: string
  domainReason: string
}) {
  if (isPending) return 'Сохранение выполняется.'
  if (mode === 'result' && !requestSelected) return 'Выберите заявку ТВМТ.'
  if (selectedRowsCount === 0) return 'Выберите хотя бы один доступный стык.'
  return dateReason || creationPlanError || domainReason || ''
}
