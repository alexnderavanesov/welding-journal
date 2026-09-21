import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'

import { DialogContextMenuLayer, type DialogContextMenuLayerHandle } from '@/components/dialog-context-menu-layer'
import { DialogRowPagination } from '@/components/dialog-row-pagination'
import { DialogVirtualizedRows } from '@/components/dialog-virtualized-rows'
import { DocumentWorkspaceTabs, type DocumentWorkspaceTab } from '@/components/document-workspace-tabs'
import { WorkflowDialogShell } from '@/components/workflow-dialog-shell'
import { PstoRequestRow } from '@/components/psto-request-row'
import { RequestDialogFooter } from '@/components/request-dialog-footer'
import { RequestDialogHeader } from '@/components/request-dialog-header'
import { RequestManagerButton } from '@/components/request-manager-button'
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
import { getPstoChronologyIssues } from '@/lib/psto-chronology-checks'
import { filterPstoRequestRows } from '@/lib/psto-modal-rows'
import { buildPstoRequestDraftRows } from '@/lib/psto-report-mutation-updates'
import { getPstoRequestBlockReason } from '@/lib/psto-status'
import { getRequestNameFromNaming } from '@/lib/report-naming'
import type { RequestNamingState } from '@/lib/request-naming-state'
import { formatSaveCheckBlockReason, type SaveCheckSettings } from '@/lib/save-check-settings'
import { usePagePagination } from '@/lib/use-page-pagination'
import { useStableEventCallback } from '@/lib/use-stable-event-callback'
import type { RequestDocumentIdentity } from '@/lib/request-document-identity'
import { useRequestConclusionSettings } from '@/lib/request-conclusion-settings'
import { buildSystemDocumentCreationPlan, type SystemDocumentCreationGroup } from '@/lib/system-document-creation-plan'
import {
  getPstoChronologyRootCauseActions,
  type WorkflowRootCauseAction,
} from '@/lib/workflow-root-cause-actions'

export type PstoRequestDialogProps = {
  nextRequestName: string
  nextRequestNumber?: number
  selectedRows: WeldRow[]
  requestNaming: RequestNamingState
  requestDate: string
  requestSearch: string
  message?: string | null
  requestManagerOptions: RequestDocumentIdentity[]
  heatTreatmentRowsCount: number
  filteredRows: WeldRow[]
  requestRows: WeldRow[]
  availableRowsCount: number
  selectedIds: ReadonlySet<number>
  areAllAvailableRowsSelected: boolean
  isPending: boolean
  saveCheckSettings: SaveCheckSettings
  canCreateRequest: (row: WeldRow) => boolean
  onClose: () => void
  onOpenRequestManager: () => void
  onRequestNamingChange: (value: RequestNamingState) => void
  onRequestDateChange: (value: string) => void
  onRequestSearchChange: (value: string) => void
  onClearSelection: () => void
  onSetSelectedRows: (rowIds: number[]) => void
  onToggleAllRows: () => void
  onToggleRow: (rowId: number) => void
  onOpenJournalRows: (rows: readonly WeldRow[], sourceLabel: string) => void
  onOpenPstoHistory?: (row: WeldRow) => void
  onSubmit: () => void
  onRunRootCauseAction?: (action: WorkflowRootCauseAction) => void
}

export function PstoRequestDialog({
  nextRequestName,
  nextRequestNumber,
  selectedRows,
  requestNaming,
  requestDate,
  requestSearch,
  message,
  requestManagerOptions,
  heatTreatmentRowsCount,
  filteredRows,
  requestRows,
  availableRowsCount,
  selectedIds,
  areAllAvailableRowsSelected,
  isPending,
  saveCheckSettings,
  canCreateRequest,
  onClose,
  onOpenRequestManager,
  onRequestNamingChange,
  onRequestDateChange,
  onRequestSearchChange,
  onClearSelection,
  onSetSelectedRows,
  onToggleAllRows,
  onToggleRow,
  onOpenJournalRows,
  onOpenPstoHistory,
  onSubmit,
  onRunRootCauseAction,
}: PstoRequestDialogProps) {
  const requestConclusionSettings = useRequestConclusionSettings()
  const contextMenuRef = useRef<DialogContextMenuLayerHandle>(null)
  const requestDateInputRef = useRef<HTMLInputElement>(null)
  const stableOnToggleRow = useStableEventCallback(onToggleRow)
  const [rowsViewMode, setRowsViewMode] = useState<SelectedRowsViewMode>('all')
  const [workspaceTab, setWorkspaceTab] = useState<DocumentWorkspaceTab>('joints')
  const [selectedRowsSearch, setSelectedRowsSearch] = useState('')
  const filteredSelectedRows = useMemo(
    () => filterPstoRequestRows(selectedRows, selectedRowsSearch),
    [selectedRows, selectedRowsSearch],
  )
  useEffect(() => {
    if (selectedRows.length === 0 && rowsViewMode === 'selected') setRowsViewMode('all')
  }, [rowsViewMode, selectedRows.length])
  const displayedRows = rowsViewMode === 'selected' ? filteredSelectedRows : filteredRows
  const displayedSearch = rowsViewMode === 'selected' ? selectedRowsSearch : requestSearch
  const paginationResetKeys = useMemo(
    () => [displayedSearch, rowsViewMode],
    [displayedSearch, rowsViewMode],
  )
  const rowsPagination = usePagePagination({
    items: displayedRows,
    defaultPageSize: 50,
    resetKeys: paginationResetKeys,
  })
  const rowsViewportResetKey = `${rowsPagination.page}:${rowsPagination.pageSize}:${displayedSearch}:${rowsViewMode}`
  const requestName = getRequestNameFromNaming(requestNaming, nextRequestName)
  const creationPlan = useMemo(() => buildSystemDocumentCreationPlan({
    type: 'pstoRequest',
    date: requestDate,
    rows: selectedRows,
    naming: requestNaming,
    settings: requestConclusionSettings,
    nextNumber: nextRequestNumber,
  }), [nextRequestNumber, requestConclusionSettings, requestDate, requestNaming, selectedRows])
  const effectiveRequestName = creationPlan.groups[0]?.name ?? requestName
  const requestDateReason = getDateInputValidationReason(requestDate, 'Дата заявки ПСТО')
  const chronologyIssues = useMemo(() => {
    if (selectedRows.length === 0 || !effectiveRequestName || requestDateReason) return []
    const proposedRows = buildPstoRequestDraftRows({ records: selectedRows, requestName: effectiveRequestName, requestDate })
    return getPstoChronologyIssues(proposedRows, saveCheckSettings)
  }, [effectiveRequestName, requestDate, requestDateReason, saveCheckSettings, selectedRows])
  const chronologyReason = chronologyIssues[0]
    ? formatSaveCheckBlockReason('pstoResultRequestDateOrder', chronologyIssues[0].message)
    : ''
  const rootCauseActions = useMemo(
    () => getPstoChronologyRootCauseActions(chronologyIssues),
    [chronologyIssues],
  )
  const runRootCauseAction = (action: WorkflowRootCauseAction) => {
    const target = action.target
    const editsCurrentDraft = target.kind === 'psto-cycle' &&
      target.sequence === 1 &&
      target.stage === 'pstoRequest' &&
      target.documentName === effectiveRequestName &&
      target.documentDate === requestDate
    if (editsCurrentDraft) {
      requestDateInputRef.current?.focus()
      return
    }
    onRunRootCauseAction?.(action)
  }
  const createDisabledReason = getPstoRequestCreateDisabledReason({
    selectedRowsCount: selectedRows.length,
    requestName: effectiveRequestName,
    requestDateReason,
    chronologyReason,
    creationPlanError: creationPlan.error,
  })
  const feedbackMessage = createDisabledReason ?? message
  const selectableRequestRows = useMemo(
    () => requestRows.filter(canCreateRequest),
    [canCreateRequest, requestRows],
  )
  const headerDocumentLabel = creationPlan.groups.length > 1
    ? `Будет создано заявок: ${creationPlan.groups.length}`
    : effectiveRequestName || 'Новая заявка'
  const openRowContextMenu = useStableEventCallback((event: MouseEvent<HTMLElement>, row: WeldRow) => {
    const point = getDialogMenuPoint(event)
    contextMenuRef.current?.open(buildDialogRowContextMenu({
      ...point,
      row,
      selectedRows,
      selectedIds,
      selectableRows: selectableRequestRows,
      isRowSelectable: canCreateRequest,
      sourceLabel: 'заявки ПСТО',
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
      sourceLabel: 'заявки ПСТО',
      onOpenJournalRows,
    }))
  })

  return (
    <WorkflowDialogShell>
      <RequestDialogHeader
        title="Заявка ПСТО"
        subtitle={`${headerDocumentLabel} · Стыков: ${selectedRows.length}`}
        onClose={onClose}
        actions={
          <RequestManagerButton
            disabled={requestManagerOptions.length === 0}
            disabledReason="Нет созданных заявок ПСТО для редактирования."
            onClick={onOpenRequestManager}
          />
        }
      />

      <section className="shrink-0 border-b border-slate-100 bg-slate-50/40 px-5 py-2.5">
        <label className="block w-[190px] space-y-1.5 text-sm">
          <span className="text-[13px] font-medium leading-none text-slate-700">Дата заявки</span>
          <Input
            ref={requestDateInputRef}
            type="date"
            value={requestDate}
            onChange={(event) => onRequestDateChange(event.target.value)}
            className="h-9 bg-white"
          />
        </label>
      </section>

      <DocumentWorkspaceTabs
        activeTab={workspaceTab}
        ariaLabel="Разделы заявки ПСТО"
        documentsLabel="Заявки и имена"
        documentsCount={creationPlan.groups.length}
        documentsHaveError={Boolean(creationPlan.error)}
        onChange={setWorkspaceTab}
      />

      {workspaceTab === 'documents' ? (
        <SystemDocumentNamesPanel
          plan={creationPlan}
          naming={requestNaming}
          documentNameLabel="Наименование заявки"
          documentNameAriaLabel="Название заявки"
          documentNamePlaceholder="Название заявки"
          emptyMessage="Выберите хотя бы один стык."
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
              selectedCount={selectedRows.length}
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
                disabled={availableRowsCount === 0}
              >
                {areAllAvailableRowsSelected ? 'Снять все' : 'Выбрать доступные'}
              </Button>
            )
          }
          searchValue={displayedSearch}
          searchPlaceholder={rowsViewMode === 'selected' ? 'Поиск среди выбранных стыков' : 'Проект, шифр, линия, спул или стык'}
          filteredCount={displayedRows.length}
          availableCount={rowsViewMode === 'selected' ? selectedRows.length : availableRowsCount}
          statsLabel={rowsViewMode === 'selected'
            ? <>Найдено: {filteredSelectedRows.length} · Выбрано: {selectedRows.length}</>
            : undefined}
          isEmpty={displayedRows.length === 0}
          emptyMessage={
            rowsViewMode === 'selected'
              ? selectedRows.length === 0
                ? 'Выбранных стыков пока нет.'
                : 'Среди выбранных стыков ничего не найдено.'
              : heatTreatmentRowsCount === 0
                ? 'Нет стыков для отчета ПСТО и ТВМТ.'
                : 'По фильтру ничего не найдено.'
          }
          onSearchChange={rowsViewMode === 'selected' ? setSelectedRowsSearch : onRequestSearchChange}
        >
          <DialogVirtualizedRows
            key={rowsViewportResetKey}
            items={rowsPagination.pageItems}
            estimateRowHeight={72}
            getItemKey={(row) => row.id}
            renderItem={(row) => {
              const disabled = !canCreateRequest(row)
              const selected = selectedIds.has(row.id)
              return (
                <PstoRequestRow
                  row={row}
                  selected={selected}
                  disabled={disabled}
                  disabledReason={disabled ? getPstoRequestBlockReason(row) : ''}
                  onToggleRow={stableOnToggleRow}
                  onOpenContextMenu={openRowContextMenu}
                />
              )
            }}
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
        disabledReasonActions={chronologyReason
          ? rootCauseActions.map((action) => ({
              key: action.key,
              label: action.label,
              onAction: () => runRootCauseAction(action),
            }))
          : undefined}
        disabledReasonActionLabel={creationPlan.error && workspaceTab !== 'documents'
          ? 'Открыть заявки и имена'
          : undefined}
        onDisabledReasonAction={creationPlan.error && workspaceTab !== 'documents'
          ? () => setWorkspaceTab('documents')
          : undefined}
        onClose={onClose}
        onSubmit={onSubmit}
      />
      <DialogContextMenuLayer ref={contextMenuRef} />
    </WorkflowDialogShell>
  )
}

function getPstoRequestCreateDisabledReason({
  selectedRowsCount,
  requestName,
  requestDateReason,
  chronologyReason,
  creationPlanError,
}: {
  selectedRowsCount: number
  requestName: string
  requestDateReason: string | null
  chronologyReason: string
  creationPlanError: string
}) {
  if (selectedRowsCount === 0) return 'Чтобы создать заявку ПСТО, выберите один или несколько стыков.'
  if (!requestName) return 'Укажите пользовательское наименование заявки ПСТО или переключитесь на системное имя.'
  if (creationPlanError) return creationPlanError
  if (requestDateReason) return requestDateReason
  if (chronologyReason) return chronologyReason
  return null
}
