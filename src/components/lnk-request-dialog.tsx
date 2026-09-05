import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { WorkflowDialogShell } from '@/components/workflow-dialog-shell'
import { LnkExistingRequestSearch } from '@/components/lnk-existing-request-search'
import { LnkRequestMethods } from '@/components/lnk-request-methods'
import { LnkRequestModeToolbar } from '@/components/lnk-request-mode-toolbar'
import { LnkControlStageSwitch } from '@/components/lnk-control-stage-switch'
import { LnkRequestRow } from '@/components/lnk-request-row'
import { DialogRowPagination } from '@/components/dialog-row-pagination'
import { DialogVirtualizedRows } from '@/components/dialog-virtualized-rows'
import { DialogContextMenuLayer, type DialogContextMenuLayerHandle } from '@/components/dialog-context-menu-layer'
import { DocumentWorkspaceTabs, type DocumentWorkspaceTab } from '@/components/document-workspace-tabs'
import { RequestDialogFooter } from '@/components/request-dialog-footer'
import { RequestDialogHeader } from '@/components/request-dialog-header'
import { RequestDocumentCombobox } from '@/components/request-document-combobox'
import { RequestRowsPanel } from '@/components/request-rows-panel'
import { SelectedRowsViewToggle, type SelectedRowsViewMode } from '@/components/selected-rows-view-toggle'
import { SystemDocumentNamesPanel } from '@/components/system-document-names-panel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getDateInputValidationReason } from '@/lib/date-format'
import {
  buildDialogRowContextMenu,
  buildDocumentGroupContextMenu,
  getDialogMenuPoint,
} from '@/lib/dialog-context-menu-items'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getLnkChronologyIssues } from '@/lib/lnk-chronology-checks'
import { buildLnkRequestDraftRows } from '@/lib/lnk-request-mutation-updates'
import {
  analyzeLnkRequestExtensionTargets,
  type LnkRequestExtensionOption,
} from '@/lib/lnk-request-extension'
import {
  countLnkRequestTargets,
  filterLnkRequestRows,
  isEveryFilteredLnkRequestRowSelected,
} from '@/lib/report-modal-rows'
import { LNK_METHODS } from '@/lib/report-config'
import { getRequestNameFromNaming } from '@/lib/report-naming'
import { pinInitiallySelectedRows } from '@/lib/report-row-utils'
import type { RequestNamingState } from '@/lib/request-naming-state'
import { formatSaveCheckBlockReason, type SaveCheckSettings } from '@/lib/save-check-settings'
import { usePagePagination } from '@/lib/use-page-pagination'
import { useStableEventCallback } from '@/lib/use-stable-event-callback'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { LnkRequestComposerMode } from '@/lib/use-lnk-request-modal-state'
import { useRequestConclusionSettings } from '@/lib/request-conclusion-settings'
import { buildSystemDocumentCreationPlan } from '@/lib/system-document-creation-plan'
import type { SystemDocumentCreationGroup } from '@/lib/system-document-creation-plan'
import type { LnkControlStage } from '@/lib/lnk-control-stage'
import {
  getLnkChronologyRootCauseActions,
  type WorkflowRootCauseAction,
} from '@/lib/workflow-root-cause-actions'

export type LnkRequestDialogProps = {
  elevated?: boolean
  nextRequestName: string
  nextRequestNumber?: number
  selectedRowsCount: number
  selectedRows: WeldRow[]
  requestNaming: RequestNamingState
  requestDate: string
  requestExtensionOptions: LnkRequestExtensionOption[]
  initialMode: LnkRequestComposerMode
  initialRequestKey: string
  initialSelectedMethods: ReadonlySet<WeldFieldKey>
  requestSearch: string
  message?: string | null
  lnkRowsCount: number
  filteredRows: WeldRow[]
  filteredAvailableRows: WeldRow[]
  availableRows: WeldRow[]
  selectedIds: ReadonlySet<number>
  isPending: boolean
  saveCheckSettings: SaveCheckSettings
  onClose: () => void
  onOpenRequestRegistry: () => void
  onRequestNamingChange: (value: RequestNamingState) => void
  onRequestDateChange: (value: string) => void
  onRequestSearchChange: (value: string) => void
  onClearSelection: () => void
  onSetSelectedRows: (rowIds: number[]) => void
  onToggleAllRows: () => void
  onToggleRow: (rowId: number) => void
  onOpenJournalRows: (rows: readonly WeldRow[], sourceLabel: string) => void
  onOpenPstoHistory?: (row: WeldRow) => void
  onStageChange?: (
    stage: LnkControlStage,
    selectedRowIds: number[],
    submitMode: LnkRequestComposerMode,
  ) => void
  onSubmit: (methodKeys: WeldFieldKey[]) => void
  onExtendRequest: (methodKeys: WeldFieldKey[], request: LnkRequestExtensionOption) => void
  onRunRootCauseAction?: (action: WorkflowRootCauseAction) => void
}

export function LnkRequestDialog({
  elevated = false,
  nextRequestName,
  nextRequestNumber,
  selectedRowsCount,
  selectedRows,
  requestNaming,
  requestDate,
  requestExtensionOptions,
  initialMode,
  initialRequestKey,
  initialSelectedMethods,
  requestSearch,
  message,
  lnkRowsCount,
  filteredRows,
  filteredAvailableRows,
  availableRows,
  selectedIds,
  isPending,
  saveCheckSettings,
  onClose,
  onOpenRequestRegistry,
  onRequestNamingChange,
  onRequestDateChange,
  onRequestSearchChange,
  onClearSelection,
  onSetSelectedRows,
  onToggleAllRows,
  onToggleRow,
  onOpenJournalRows,
  onOpenPstoHistory,
  onStageChange,
  onSubmit,
  onExtendRequest,
  onRunRootCauseAction,
}: LnkRequestDialogProps) {
  const requestConclusionSettings = useRequestConclusionSettings()
  const contextMenuRef = useRef<DialogContextMenuLayerHandle>(null)
  const requestDateInputRef = useRef<HTMLInputElement>(null)
  const stableOnToggleRow = useStableEventCallback(onToggleRow)
  const [submitMode, setSubmitMode] = useState<LnkRequestComposerMode>(initialMode)
  const [existingRequestKey, setExistingRequestKey] = useState(initialRequestKey)
  const [existingRequestSearch, setExistingRequestSearch] = useState('')
  const [selectedMethods, setSelectedMethods] = useState(() => new Set(initialSelectedMethods))
  const [initiallySelectedIds] = useState(() => new Set(selectedIds))
  const [rowsViewMode, setRowsViewMode] = useState<SelectedRowsViewMode>('all')
  const [workspaceTab, setWorkspaceTab] = useState<DocumentWorkspaceTab>('joints')
  const [selectedRowsSearch, setSelectedRowsSearch] = useState('')
  const selectedMethodKeys = useMemo(() => [...selectedMethods], [selectedMethods])
  const createTargetCount = useMemo(
    () => countLnkRequestTargets(selectedRows, selectedMethodKeys),
    [selectedMethodKeys, selectedRows],
  )
  const selectedExistingRequest = useMemo(
    () => requestExtensionOptions.find((request) => request.key === existingRequestKey),
    [existingRequestKey, requestExtensionOptions],
  )
  const filteredRequestExtensionOptions = useMemo(() => {
    const query = existingRequestSearch.trim().toLocaleLowerCase('ru-RU')
    if (!query) return requestExtensionOptions
    return requestExtensionOptions.filter((request) => [
      request.label,
      request.name,
      request.date,
      request.methodCodes.join(' '),
      request.searchText,
    ].join(' ').toLocaleLowerCase('ru-RU').includes(query))
  }, [existingRequestSearch, requestExtensionOptions])
  const visibleRequestExtensionOptions = useMemo(() => {
    if (!selectedExistingRequest || filteredRequestExtensionOptions.some((request) => request.key === selectedExistingRequest.key)) {
      return filteredRequestExtensionOptions
    }
    return [selectedExistingRequest, ...filteredRequestExtensionOptions]
  }, [filteredRequestExtensionOptions, selectedExistingRequest])
  useEffect(() => {
    if (submitMode !== 'extend' || selectedExistingRequest) return
    setExistingRequestKey(
      requestExtensionOptions.find((request) => !request.disabledReason)?.key ?? requestExtensionOptions[0]?.key ?? '',
    )
  }, [requestExtensionOptions, selectedExistingRequest, submitMode])
  const extensionAnalysis = useMemo(
    () => analyzeLnkRequestExtensionTargets({
      rows: selectedRows,
      methodKeys: selectedMethodKeys,
      requestName: selectedExistingRequest?.name ?? '',
      requestDate: selectedExistingRequest?.date ?? '',
    }),
    [selectedExistingRequest?.date, selectedExistingRequest?.name, selectedMethodKeys, selectedRows],
  )
  const selectedTargetCount = submitMode === 'create' ? createTargetCount : extensionAnalysis.targets.length
  const hasSearch = requestSearch.trim().length > 0
  const orderedAvailableRows = useMemo(
    () => pinInitiallySelectedRows(filteredAvailableRows, selectedIds, initiallySelectedIds),
    [filteredAvailableRows, initiallySelectedIds, selectedIds],
  )
  const filteredSelectedRows = useMemo(
    () => filterLnkRequestRows(selectedRows, selectedRowsSearch),
    [selectedRows, selectedRowsSearch],
  )
  useEffect(() => {
    if (selectedRowsCount === 0 && rowsViewMode === 'selected') setRowsViewMode('all')
  }, [rowsViewMode, selectedRowsCount])
  const displayedRows = rowsViewMode === 'selected' ? filteredSelectedRows : orderedAvailableRows
  const displayedSearch = rowsViewMode === 'selected' ? selectedRowsSearch : requestSearch
  const paginationResetKeys = useMemo(
    () => [displayedSearch, rowsViewMode, submitMode, existingRequestKey],
    [displayedSearch, existingRequestKey, rowsViewMode, submitMode],
  )
  const rowsPagination = usePagePagination({
    items: displayedRows,
    defaultPageSize: 50,
    resetKeys: paginationResetKeys,
  })
  const rowsViewportResetKey = `${rowsPagination.page}:${rowsPagination.pageSize}:${displayedSearch}:${rowsViewMode}:${submitMode}:${existingRequestKey}`
  const allFilteredRowsSelected = isEveryFilteredLnkRequestRowSelected(selectedIds, filteredAvailableRows)
  const requestName = submitMode === 'create' ? getRequestNameFromNaming(requestNaming, nextRequestName) : ''
  const creationPlan = useMemo(() => {
    const eligibleRowIds = new Set(buildLnkRequestDraftRows({
      records: selectedRows,
      methodKeys: selectedMethodKeys,
      requestName: '__system-document-group-preview__',
      requestDate,
    }).map((row) => row.id))
    return buildSystemDocumentCreationPlan({
      type: 'lnkRequest',
      date: requestDate,
      rows: selectedRows.filter((row) => eligibleRowIds.has(row.id)),
      naming: requestNaming,
      settings: requestConclusionSettings,
      nextNumber: nextRequestNumber,
    })
  }, [nextRequestNumber, requestConclusionSettings, requestDate, requestNaming, selectedMethodKeys, selectedRows])
  const effectiveRequestName = creationPlan.groups[0]?.name ?? requestName
  const requestDateReason = submitMode === 'create' ? getDateInputValidationReason(requestDate, 'Дата заявки ЛНК') : null
  const chronologyIssues = useMemo(() => {
    if (selectedRows.length === 0 || selectedMethodKeys.length === 0 || !effectiveRequestName || requestDateReason) return []
    const proposedRows = buildLnkRequestDraftRows({
      records: selectedRows,
      methodKeys: [...selectedMethodKeys],
      requestName: effectiveRequestName,
      requestDate,
    })
    return getLnkChronologyIssues(proposedRows, saveCheckSettings)
  }, [effectiveRequestName, requestDate, requestDateReason, saveCheckSettings, selectedMethodKeys, selectedRows])
  const chronologyReason = chronologyIssues[0]
    ? formatSaveCheckBlockReason('lnkResultRequestDateOrder', chronologyIssues[0].message)
    : ''
  const rootCauseActions = useMemo(
    () => getLnkChronologyRootCauseActions(chronologyIssues),
    [chronologyIssues],
  )
  const runRootCauseAction = (action: WorkflowRootCauseAction) => {
    const target = action.target
    const editsCurrentDraft = target.kind === 'lnk-control' &&
      target.stage === 'primary' &&
      target.documentPart === 'request' &&
      LNK_METHODS.some((method) =>
        method.code === target.methodCode && selectedMethods.has(method.requestKey),
      ) &&
      target.documentName === effectiveRequestName &&
      target.documentDate === requestDate
    if (editsCurrentDraft) {
      requestDateInputRef.current?.focus()
      return
    }
    onRunRootCauseAction?.(action)
  }
  const createDisabledReason = submitMode === 'create'
    ? getLnkRequestCreateDisabledReason({
        selectedRowsCount,
        selectedMethodKeysCount: selectedMethodKeys.length,
        selectedTargetCount,
        requestName: effectiveRequestName,
        requestDateReason,
        chronologyReason,
        creationPlanError: creationPlan.error,
      })
    : getLnkRequestExtendDisabledReason({
        selectedRowsCount,
        selectedMethodKeysCount: selectedMethodKeys.length,
        selectedTargetCount,
        selectedRequest: selectedExistingRequest,
        firstIssueReason: extensionAnalysis.issues[0]?.reason,
      })
  const feedbackMessage = createDisabledReason ?? message
  const extensionIssueSummary = formatLnkRequestExtensionIssueSummary(extensionAnalysis.issues)
  const extensionOutcomeSummary = extensionIssueSummary || (extensionAnalysis.targets.length > 0
    ? `Войдут все выбранные позиции: ${extensionAnalysis.targets.length}.`
    : 'Выберите виды контроля и стыки, чтобы увидеть состав добавления.')
  const headerDocumentLabel = creationPlan.groups.length > 1
    ? `Будет создано заявок: ${creationPlan.groups.length}`
    : effectiveRequestName || 'Новая заявка'
  const toggleMethod = (methodKey: WeldFieldKey) => {
    setSelectedMethods((current) => {
      const next = new Set(current)
      if (next.has(methodKey)) next.delete(methodKey)
      else next.add(methodKey)
      return next
    })
  }
  const changeSubmitMode = (mode: LnkRequestComposerMode) => {
    setSubmitMode(mode)
    if (mode === 'extend') setWorkspaceTab('joints')
  }
  const openRowContextMenu = useStableEventCallback((event: MouseEvent<HTMLElement>, row: WeldRow) => {
    const point = getDialogMenuPoint(event)
    contextMenuRef.current?.open(buildDialogRowContextMenu({
      ...point,
      row,
      selectedRows,
      selectedIds,
      selectableRows: availableRows,
      isRowSelectable: (candidate) => availableRows.some((availableRow) => availableRow.id === candidate.id),
      sourceLabel: submitMode === 'create' ? 'заявки ЛНК' : 'добавления в заявку ЛНК',
      onSetSelectedRows,
      onShowSelectedRows: () => setRowsViewMode('selected'),
      onClearSelection,
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
      sourceLabel: 'заявки ЛНК',
      onOpenJournalRows,
    }))
  })
  return (
    <WorkflowDialogShell elevated={elevated}>
      <RequestDialogHeader
        title="Заявка ЛНК"
        subtitle={`${submitMode === 'create' ? headerDocumentLabel : selectedExistingRequest?.label ?? 'Выберите заявку'} · Стыков: ${selectedRowsCount} · Добавится позиций: ${selectedTargetCount}`}
        onClose={onClose}
        actions={onStageChange ? (
          <LnkControlStageSwitch
            value="primary"
            disabled={isPending}
            onChange={(stage) => onStageChange(stage, [...selectedIds], submitMode)}
          />
        ) : undefined}
      />

      <LnkRequestModeToolbar
        mode={submitMode}
        disabled={isPending}
        onModeChange={changeSubmitMode}
        onOpenRegistry={onOpenRequestRegistry}
      />

      {submitMode === 'create' ? (
        <LnkRequestMethods
          methods={LNK_METHODS}
          selectedMethodKeys={selectedMethodKeys}
          selectedMethods={selectedMethods}
          requestDate={requestDate}
          requestDateInputRef={requestDateInputRef}
          onRequestDateChange={onRequestDateChange}
          onToggleMethod={toggleMethod}
        />
      ) : null}

      {submitMode === 'create' ? (
        <DocumentWorkspaceTabs
          activeTab={workspaceTab}
          ariaLabel="Разделы заявки ЛНК"
          documentsLabel="Заявки и имена"
          documentsCount={creationPlan.groups.length}
          documentsHaveError={Boolean(creationPlan.error)}
          onChange={setWorkspaceTab}
        />
      ) : null}

      {submitMode === 'extend' ? (
        <div className="border-b border-slate-100 px-5 py-3">
          <div className="grid gap-3 xl:grid-cols-[300px_minmax(0,1fr)] xl:items-end">
            <LnkExistingRequestSearch
              value={existingRequestSearch}
              resultCount={filteredRequestExtensionOptions.length}
              totalCount={requestExtensionOptions.length}
              onCommit={setExistingRequestSearch}
            />
            <label className="block space-y-1.5 text-sm">
              <span className="text-[13px] font-medium leading-none text-slate-700">Существующая заявка</span>
              <RequestDocumentCombobox
                ariaLabel="Существующая заявка"
                value={existingRequestKey}
                options={visibleRequestExtensionOptions}
                onChange={(request) => setExistingRequestKey(request?.key ?? '')}
              />
            </label>
          </div>

          {selectedExistingRequest ? (
            <div
              data-request-extension-summary="true"
              className={`mt-2 flex h-10 min-w-0 items-center gap-4 overflow-hidden rounded-md border px-3 ${
              selectedExistingRequest.disabledReason
                ? 'border-rose-200 bg-rose-50 text-rose-800'
                : 'border-sky-200 bg-sky-50 text-sky-900'
              }`}
            >
              {selectedExistingRequest.disabledReason ? (
                <p className="truncate text-xs font-medium" title={selectedExistingRequest.disabledReason}>
                  {selectedExistingRequest.disabledReason}
                </p>
              ) : (
                <div className="flex min-w-0 flex-1 items-center gap-4 text-xs">
                  <span className="shrink-0">Сейчас: <strong>{selectedExistingRequest.rowCount}</strong> стыков</span>
                  <span className="shrink-0"><strong>{selectedExistingRequest.positionCount}</strong> позиций НК</span>
                  <span className="shrink-0">Добавится: <strong>{extensionAnalysis.targets.length}</strong> позиций</span>
                  <span className="h-4 w-px shrink-0 bg-sky-200" />
                  <span className="min-w-0 truncate text-sky-800" title={extensionOutcomeSummary}>
                    {extensionOutcomeSummary}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="mt-2 flex h-10 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-xs text-slate-500">
              {requestExtensionOptions.length === 0 ? 'Созданных заявок ЛНК пока нет.' : 'Выберите заявку из списка.'}
            </div>
          )}
        </div>
      ) : null}

      {submitMode === 'extend' ? (
        <LnkRequestMethods
          methods={LNK_METHODS}
          selectedMethodKeys={selectedMethodKeys}
          selectedMethods={selectedMethods}
          onToggleMethod={toggleMethod}
        />
      ) : null}

      {submitMode === 'create' && workspaceTab === 'documents' ? (
        <SystemDocumentNamesPanel
          plan={creationPlan}
          naming={requestNaming}
          documentNameLabel="Наименование заявки"
          documentNameAriaLabel="Название заявки"
          documentNamePlaceholder="Название заявки"
          emptyMessage="Выберите виды контроля и хотя бы один стык."
          disabled={isPending}
          onNamingChange={onRequestNamingChange}
          onOpenGroupContextMenu={openGroupContextMenu}
        />
      ) : (
      <div className="flex min-h-0 flex-1 overflow-hidden px-5 py-3">
        <RequestRowsPanel
          title="Стыки"
          description=""
          viewToggle={(
            <SelectedRowsViewToggle
              mode={rowsViewMode}
              selectedCount={selectedRowsCount}
              onChange={setRowsViewMode}
            />
          )}
          action={
            rowsViewMode === 'selected' ? (
              <Button variant="outline" size="sm" onClick={onClearSelection}>
                Снять весь выбор
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={onToggleAllRows}
                disabled={!hasSearch || filteredAvailableRows.length === 0}
                title={!hasSearch ? 'Сначала сузьте список поиском' : undefined}
              >
                {allFilteredRowsSelected ? 'Снять все' : 'Выбрать доступные'}
              </Button>
            )
          }
          searchValue={displayedSearch}
          searchPlaceholder={rowsViewMode === 'selected' ? 'Поиск среди выбранных стыков' : 'Проект, шифр, линия, спул или стык'}
          filteredCount={rowsViewMode === 'selected' ? filteredSelectedRows.length : filteredRows.length}
          availableCount={rowsViewMode === 'selected' ? selectedRowsCount : filteredAvailableRows.length}
          statsLabel={rowsViewMode === 'selected'
            ? <>Найдено: {filteredSelectedRows.length} · Выбрано: {selectedRowsCount}</>
            : undefined}
          isEmpty={displayedRows.length === 0}
          emptyMessage={
            rowsViewMode === 'selected'
              ? selectedRowsCount === 0
                ? 'Выбранных стыков пока нет.'
                : 'Среди выбранных стыков ничего не найдено.'
              : lnkRowsCount === 0
                ? 'Нет стыков для отчета ЛНК.'
                : filteredRows.length === 0
                  ? 'По фильтру ничего не найдено.'
                  : 'По найденным стыкам нет доступных методов для новой заявки.'
          }
          onSearchChange={rowsViewMode === 'selected' ? setSelectedRowsSearch : onRequestSearchChange}
        >
          <DialogVirtualizedRows
            key={rowsViewportResetKey}
            items={rowsPagination.pageItems}
            estimateRowHeight={62}
            getItemKey={(row) => row.id}
            renderItem={(row) => (
              <LnkRequestRow
                row={row}
                selected={selectedIds.has(row.id)}
                selectedMethods={selectedMethods}
                onToggleRow={stableOnToggleRow}
                onOpenContextMenu={openRowContextMenu}
              />
            )}
            footer={(
              <DialogRowPagination
                totalCount={rowsPagination.totalCount}
                firstItemNumber={rowsPagination.firstItemNumber}
                lastItemNumber={rowsPagination.lastItemNumber}
                page={rowsPagination.page}
                pageCount={rowsPagination.pageCount}
                pageSize={rowsPagination.pageSize}
                onPreviousPage={rowsPagination.goToPreviousPage}
                onNextPage={rowsPagination.goToNextPage}
                onPageSizeChange={rowsPagination.setPageSize}
              />
            )}
          />
        </RequestRowsPanel>
      </div>
      )}

      <RequestDialogFooter
        isPending={isPending}
        isCreateDisabled={Boolean(createDisabledReason)}
        disabledReason={feedbackMessage}
        disabledReasonActionLabel={submitMode === 'create' && creationPlan.error && workspaceTab !== 'documents'
          ? 'Открыть заявки и имена'
          : undefined}
        onDisabledReasonAction={submitMode === 'create' && creationPlan.error && workspaceTab !== 'documents'
          ? () => setWorkspaceTab('documents')
          : undefined}
        disabledReasonActions={chronologyReason
          ? rootCauseActions.map((action) => ({
              key: action.key,
              label: action.label,
              onAction: () => runRootCauseAction(action),
            }))
          : undefined}
        onClose={onClose}
        submitLabel={submitMode === 'create' ? 'Создать заявку' : 'Добавить в заявку'}
        onSubmit={() => {
          if (submitMode === 'create') onSubmit(selectedMethodKeys)
          else if (selectedExistingRequest) onExtendRequest(selectedMethodKeys, selectedExistingRequest)
        }}
      />
      <DialogContextMenuLayer ref={contextMenuRef} />
    </WorkflowDialogShell>
  )
}

function getLnkRequestExtendDisabledReason({
  selectedRowsCount,
  selectedMethodKeysCount,
  selectedTargetCount,
  selectedRequest,
  firstIssueReason,
}: {
  selectedRowsCount: number
  selectedMethodKeysCount: number
  selectedTargetCount: number
  selectedRequest: LnkRequestExtensionOption | undefined
  firstIssueReason?: string
}) {
  if (!selectedRequest) return 'Выберите существующую заявку ЛНК.'
  if (selectedRequest.disabledReason) return selectedRequest.disabledReason
  if (selectedRowsCount === 0) return 'Выберите один или несколько стыков для добавления в заявку ЛНК.'
  if (selectedMethodKeysCount === 0) return 'Выберите один или несколько видов контроля для добавления в заявку ЛНК.'
  if (selectedTargetCount === 0) {
    return firstIssueReason
      ? `Нет доступных позиций: ${firstIssueReason}`
      : 'По выбранным стыкам и видам контроля нет позиций для добавления в эту заявку.'
  }
  return null
}

function formatLnkRequestExtensionIssueSummary(
  issues: Array<{ reason: string }>,
) {
  if (issues.length === 0) return ''
  const reasonCounts = new Map<string, number>()
  for (const issue of issues) reasonCounts.set(issue.reason, (reasonCounts.get(issue.reason) ?? 0) + 1)
  const details = [...reasonCounts.entries()]
    .slice(0, 2)
    .map(([reason, count]) => `${count} — ${reason}`)
    .join(' ')
  const remainingReasonCount = Math.max(0, reasonCounts.size - 2)
  return `Не войдут ${issues.length} позиций: ${details}${remainingReasonCount ? ` Еще причин: ${remainingReasonCount}.` : ''}`
}

function getLnkRequestCreateDisabledReason({
  selectedRowsCount,
  selectedMethodKeysCount,
  selectedTargetCount,
  requestName,
  requestDateReason,
  chronologyReason,
  creationPlanError,
}: {
  selectedRowsCount: number
  selectedMethodKeysCount: number
  selectedTargetCount: number
  requestName: string
  requestDateReason: string | null
  chronologyReason: string
  creationPlanError: string
}) {
  if (selectedRowsCount === 0) return 'Чтобы создать заявку ЛНК, выберите один или несколько стыков.'
  if (selectedMethodKeysCount === 0) return 'Чтобы создать заявку ЛНК, выберите один или несколько видов контроля.'
  if (selectedTargetCount === 0) {
    return 'По выбранным стыкам и видам контроля нет доступных позиций: заявка уже создана, контроль не назначен или стык больше не доступен для новой заявки.'
  }
  if (!requestName) return 'Укажите пользовательское наименование заявки ЛНК или переключитесь на системное имя.'
  if (creationPlanError) return creationPlanError
  if (requestDateReason) return requestDateReason
  if (chronologyReason) return chronologyReason
  return null
}
