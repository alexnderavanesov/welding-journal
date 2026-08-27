import { useEffect, useMemo, useRef, useState, type Dispatch, type MouseEvent, type SetStateAction } from 'react'

import { DialogContextMenuLayer, type DialogContextMenuLayerHandle } from '@/components/dialog-context-menu-layer'
import { DialogRowPagination } from '@/components/dialog-row-pagination'
import { DialogVirtualizedRows } from '@/components/dialog-virtualized-rows'
import { DocumentWorkspaceTabs, type DocumentWorkspaceTab } from '@/components/document-workspace-tabs'
import { LargeDialogShell } from '@/components/large-dialog-shell'
import { PstoResultFilters } from '@/components/psto-result-filters'
import { PstoResultRow } from '@/components/psto-result-row'
import { PstoResultSettings } from '@/components/psto-result-settings'
import { RequestRowsSearch } from '@/components/request-rows-search'
import { ResultDialogFooter } from '@/components/result-dialog-footer'
import { ResultDialogHeader } from '@/components/result-dialog-header'
import { SelectedRowsViewToggle, type SelectedRowsViewMode } from '@/components/selected-rows-view-toggle'
import { SystemDocumentNamesPanel } from '@/components/system-document-names-panel'
import { Button } from '@/components/ui/button'
import {
  buildDialogRowContextMenu,
  buildDocumentGroupContextMenu,
  getDialogMenuPoint,
} from '@/lib/dialog-context-menu-items'
import type { WeldRow } from '@/lib/dispatcher-types'
import { filterPstoResultRows } from '@/lib/report-row-utils'
import type { PstoResultDraftState } from '@/lib/report-draft-state'
import type { SaveCheckSettings } from '@/lib/save-check-settings'
import type { SystemDocumentCreationGroup, SystemDocumentCreationPlan } from '@/lib/system-document-creation-plan'
import { usePagePagination } from '@/lib/use-page-pagination'
import { useStableEventCallback } from '@/lib/use-stable-event-callback'
import {
  createRequestDocumentIdentity,
  type RequestDocumentIdentity,
} from '@/lib/request-document-identity'

export type PstoResultDialogProps = {
  draft: PstoResultDraftState
  requestSearch: string
  nextDiagramName: string
  systemDocumentCreationPlan: SystemDocumentCreationPlan
  saveCheckSettings: SaveCheckSettings
  filteredRows: WeldRow[]
  selectedRows: WeldRow[]
  requestRows: WeldRow[]
  filteredRequestOptions: RequestDocumentIdentity[]
  availableRequestOptions: RequestDocumentIdentity[]
  saveBlockReason: string | null
  allFilteredSelectableRowsSelected: boolean
  canSelectRow: (row: WeldRow, requestName: string, requestDate?: string) => boolean
  onDraftChange: Dispatch<SetStateAction<PstoResultDraftState>>
  onRequestSearchChange: (value: string) => void
  onRequestChange: (request: RequestDocumentIdentity | null) => void
  onClearFilters: () => void
  onClearSelection: () => void
  onSetSelectedRows: (rowIds: number[]) => void
  onToggleAll: () => void
  onToggleRow: (rowId: number) => void
  onOpenJournalRows: (rows: readonly WeldRow[], sourceLabel: string) => void
  onOpenManager: () => void
  onClose: () => void
  onSave: () => void
}

export function PstoResultDialog({
  draft,
  requestSearch,
  systemDocumentCreationPlan,
  filteredRows,
  selectedRows,
  requestRows,
  filteredRequestOptions,
  availableRequestOptions,
  saveBlockReason,
  allFilteredSelectableRowsSelected,
  canSelectRow,
  onDraftChange,
  onRequestSearchChange,
  onRequestChange,
  onClearFilters,
  onClearSelection,
  onSetSelectedRows,
  onToggleAll,
  onToggleRow,
  onOpenJournalRows,
  onOpenManager,
  onClose,
  onSave,
}: PstoResultDialogProps) {
  const contextMenuRef = useRef<DialogContextMenuLayerHandle>(null)
  const stableOnToggleRow = useStableEventCallback(onToggleRow)
  const [rowsViewMode, setRowsViewMode] = useState<SelectedRowsViewMode>('all')
  const [workspaceTab, setWorkspaceTab] = useState<DocumentWorkspaceTab>('joints')
  const [selectedRowsSearch, setSelectedRowsSearch] = useState('')
  const filteredSelectedRows = useMemo(
    () => filterPstoResultRows(selectedRows, selectedRowsSearch),
    [selectedRows, selectedRowsSearch],
  )
  useEffect(() => {
    if (draft.rowIds.size === 0 && rowsViewMode === 'selected') setRowsViewMode('all')
  }, [draft.rowIds.size, rowsViewMode])
  const displayedRows = rowsViewMode === 'selected' ? filteredSelectedRows : filteredRows
  const displayedSearch = rowsViewMode === 'selected' ? selectedRowsSearch : draft.search
  const paginationResetKeys = useMemo(
    () => [displayedSearch, rowsViewMode, draft.requestName, draft.requestDate, requestSearch],
    [displayedSearch, draft.requestDate, draft.requestName, requestSearch, rowsViewMode],
  )
  const rowsPagination = usePagePagination({
    items: displayedRows,
    defaultPageSize: 50,
    resetKeys: paginationResetKeys,
  })
  const rowsViewportResetKey = `${rowsPagination.page}:${rowsPagination.pageSize}:${displayedSearch}:${rowsViewMode}:${draft.requestName}:${draft.requestDate}:${requestSearch}`
  const selectedRequest = createRequestDocumentIdentity(draft.requestName, draft.requestDate)
  const diagramCount = systemDocumentCreationPlan.groups.length
  const selectedRowsViewToggle = (
    <SelectedRowsViewToggle
      mode={rowsViewMode}
      selectedCount={draft.rowIds.size}
      onChange={setRowsViewMode}
    />
  )
  const rowsAction = rowsViewMode === 'selected' ? (
    <Button variant="outline" size="sm" onClick={onClearSelection}>
      Снять весь выбор
    </Button>
  ) : (
    <Button variant="outline" size="sm" onClick={onToggleAll} disabled={filteredRows.length === 0}>
      {allFilteredSelectableRowsSelected ? 'Снять все' : 'Выбрать все доступные'}
    </Button>
  )
  const selectableRequestRows = useMemo(
    () => requestRows.filter((row) => canSelectRow(row, draft.requestName, draft.requestDate)),
    [canSelectRow, draft.requestDate, draft.requestName, requestRows],
  )
  const openRowContextMenu = useStableEventCallback((event: MouseEvent<HTMLElement>, row: WeldRow) => {
    const point = getDialogMenuPoint(event)
    contextMenuRef.current?.open(buildDialogRowContextMenu({
      ...point,
      row,
      selectedRows,
      selectedIds: draft.rowIds,
      selectableRows: selectableRequestRows,
      isRowSelectable: (candidate) => canSelectRow(candidate, draft.requestName, draft.requestDate),
      sourceLabel: 'результата ПСТО',
      relatedSelection: draft.requestName
        ? { label: 'Выбрать доступные по этой заявке', rows: selectableRequestRows }
        : undefined,
      onSetSelectedRows,
      onShowSelectedRows: () => setRowsViewMode('selected'),
      onClearSelection,
      onOpenJournalRows,
    }))
  })
  const openGroupContextMenu = useStableEventCallback((event: MouseEvent<HTMLElement>, group: SystemDocumentCreationGroup) => {
    const point = getDialogMenuPoint(event)
    contextMenuRef.current?.open(buildDocumentGroupContextMenu({
      ...point,
      group,
      allRows: selectedRows,
      sourceLabel: 'результата ПСТО',
      onOpenJournalRows,
    }))
  })

  return (
    <LargeDialogShell
      maxWidthClassName="max-w-[1480px]"
      maxHeightClassName="h-full"
      overlayClassName="z-50 bg-slate-950/20 py-2"
      panelShadowClassName="shadow-slate-950/10"
    >
      <ResultDialogHeader
        title="Внесение результатов ПСТО"
        requestName={draft.requestName}
        selectedCount={draft.rowIds.size}
        managerDisabled={draft.rowIds.size === 0}
        onOpenManager={onOpenManager}
        onClose={onClose}
      />

      <PstoResultSettings draft={draft} onDraftChange={onDraftChange} />

      <DocumentWorkspaceTabs
        activeTab={workspaceTab}
        ariaLabel="Разделы результата ПСТО"
        documentsLabel="Диаграммы и имена"
        documentsCount={diagramCount}
        documentsHaveError={Boolean(systemDocumentCreationPlan.error)}
        onChange={setWorkspaceTab}
      />

      {workspaceTab === 'documents' ? (
        <SystemDocumentNamesPanel
          plan={systemDocumentCreationPlan}
          naming={draft.diagramNaming}
          documentNameLabel="Наименование диаграммы"
          documentNameAriaLabel="Название диаграммы"
          documentNamePlaceholder="Название диаграммы"
          emptyMessage="Выберите результат и хотя бы один стык."
          onNamingChange={(diagramNaming) => onDraftChange((current) => ({ ...current, diagramNaming }))}
          onOpenGroupContextMenu={openGroupContextMenu}
        />
      ) : (
        <section className="flex min-h-0 flex-1 flex-col gap-2 px-5 py-3">
          {rowsViewMode === 'selected' ? (
            <RequestRowsSearch
              value={selectedRowsSearch}
              placeholder="Поиск среди выбранных стыков"
              filteredCount={filteredSelectedRows.length}
              availableCount={draft.rowIds.size}
              statsLabel={<>Найдено: {filteredSelectedRows.length} · Выбрано: {draft.rowIds.size}</>}
              viewToggle={selectedRowsViewToggle}
              action={rowsAction}
              onChange={setSelectedRowsSearch}
            />
          ) : (
            <PstoResultFilters
              search={draft.search}
              requestSearch={requestSearch}
              requestKey={selectedRequest?.key ?? ''}
              filteredRequestOptions={filteredRequestOptions}
              availableRequestOptionsCount={availableRequestOptions.length}
              filteredRowsCount={filteredRows.length}
              selectedRowsCount={draft.rowIds.size}
              leading={selectedRowsViewToggle}
              action={rowsAction}
              onSearchChange={(search) => onDraftChange((current) => ({ ...current, search }))}
              onRequestSearchChange={onRequestSearchChange}
              onRequestChange={onRequestChange}
              onClearFilters={onClearFilters}
            />
          )}

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-slate-200 bg-white">
            <div className="grid shrink-0 grid-cols-[28px_minmax(360px,1.05fr)_minmax(320px,0.95fr)_32px] gap-3 border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-semibold text-slate-500">
              <span />
              <span>Стык</span>
              <span>Заявка и диаграмма</span>
              <span />
            </div>
            {displayedRows.length === 0 ? (
              <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-sm text-slate-500">
                {rowsViewMode === 'selected'
                  ? draft.rowIds.size === 0
                    ? 'Выбранных стыков пока нет.'
                    : 'Среди выбранных стыков ничего не найдено.'
                  : draft.search || requestSearch
                    ? 'По фильтру ничего не найдено.'
                    : 'Нет стыков для добавления результата ПСТО.'}
              </div>
            ) : (
              <DialogVirtualizedRows
                key={rowsViewportResetKey}
                items={rowsPagination.pageItems}
                estimateRowHeight={92}
                getItemKey={(row) => row.id}
                renderItem={(row) => (
                  <PstoResultRow
                    row={row}
                    selected={draft.rowIds.has(row.id)}
                    disabled={!canSelectRow(row, draft.requestName, draft.requestDate)}
                    onToggle={stableOnToggleRow}
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
            )}
          </div>
        </section>
      )}

      <ResultDialogFooter
        saveBlockReason={saveBlockReason}
        isSaveDisabled={Boolean(saveBlockReason)}
        saveBlockReasonVariant="danger"
        blockReasonActionLabel={systemDocumentCreationPlan.error && workspaceTab !== 'documents' ? 'Открыть диаграммы и имена' : undefined}
        onBlockReasonAction={systemDocumentCreationPlan.error && workspaceTab !== 'documents' ? () => setWorkspaceTab('documents') : undefined}
        onClose={onClose}
        onSave={onSave}
      />
      <DialogContextMenuLayer ref={contextMenuRef} />
    </LargeDialogShell>
  )
}
