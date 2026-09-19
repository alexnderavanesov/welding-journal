import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { DialogContextMenuLayer, type DialogContextMenuLayerHandle } from '@/components/dialog-context-menu-layer'
import {
  LNK_RESULT_ROW_GRID_CLASS,
} from '@/components/lnk-dialog-layout'
import { WorkflowDialogShell } from '@/components/workflow-dialog-shell'
import { LnkControlStageSwitch } from '@/components/lnk-control-stage-switch'
import { DialogRowPagination } from '@/components/dialog-row-pagination'
import { DialogVirtualizedRows } from '@/components/dialog-virtualized-rows'
import { DocumentWorkspaceTabs, type DocumentWorkspaceTab } from '@/components/document-workspace-tabs'
import { LnkResultConclusionsPanel } from '@/components/lnk-result-conclusions-panel'
import { LnkResultRow } from '@/components/lnk-result-row'
import { LnkResultSettings } from '@/components/lnk-result-settings'
import { RequestRowsPanel } from '@/components/request-rows-panel'
import { ResultDialogFooter } from '@/components/result-dialog-footer'
import { ResultDialogHeader } from '@/components/result-dialog-header'
import { SelectedRowsViewToggle, type SelectedRowsViewMode } from '@/components/selected-rows-view-toggle'
import { Button } from '@/components/ui/button'
import {
  buildDialogRowContextMenu,
  buildDocumentGroupContextMenu,
  getDialogMenuPoint,
} from '@/lib/dialog-context-menu-items'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getEffectiveLnkResultDraftValue, hasNonEmptyLnkResultDraftRows } from '@/lib/lnk-result-draft'
import { getLnkRepairForbiddenReason, isLnkRepairForbidden } from '@/lib/lnk-result-rules'
import { LNK_METHODS, LNK_RESULT_OPTIONS } from '@/lib/report-config'
import type { LnkResultDraftState } from '@/lib/report-draft-state'
import type { RequestNamingState } from '@/lib/request-naming-state'
import type { SaveCheckSettings } from '@/lib/save-check-settings'
import type { SystemDocumentCreationGroup, SystemDocumentCreationPlan } from '@/lib/system-document-creation-plan'
import { pinInitiallySelectedRows } from '@/lib/report-row-utils'
import { canSelectLnkResultRow, filterLnkResultRows } from '@/lib/report-modal-rows'
import { usePagePagination } from '@/lib/use-page-pagination'
import { useStableEventCallback } from '@/lib/use-stable-event-callback'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { LnkControlStage } from '@/lib/lnk-control-stage'
import type { WorkflowRootCauseAction } from '@/lib/workflow-root-cause-actions'
import type { ControlProcessSettings } from '@/lib/control-process-settings'
import {
  createRequestDocumentIdentity,
  type RequestDocumentIdentity,
} from '@/lib/request-document-identity'

type LnkResultMethod = (typeof LNK_METHODS)[number]
export type LnkResultDialogProps = {
  elevated?: boolean
  draft: LnkResultDraftState
  selectedMethods: LnkResultMethod[]
  selectedRows: WeldRow[]
  visibleRows: WeldRow[]
  requestRows: WeldRow[]
  availableRequestOptions: RequestDocumentIdentity[]
  systemDocumentCreationPlan: SystemDocumentCreationPlan | null
  saveCheckSettings: SaveCheckSettings
  controlProcessSettings: ControlProcessSettings
  saveBlockReason: string | null
  rootCauseActions?: WorkflowRootCauseAction[]
  onRunRootCauseAction?: (action: WorkflowRootCauseAction) => void
  isSaveDisabled: boolean
  contextReady: boolean
  canBulkToggleRows: boolean
  areAllFilteredRowsSelected: boolean
  onClose: () => void
  onOpenManager: () => void
  onMethodChange: (methodKey: WeldFieldKey | '') => void
  onControlDateChange: (controlDate: string) => void
  onDefaultResultChange: (result: string) => void
  onConclusionNamingChange: (conclusionNaming: RequestNamingState) => void
  onClearSelection: () => void
  onSetSelectedRows: (rowIds: number[]) => void
  onToggleAllRows: () => void
  onSearchChange: (search: string) => void
  onRequestChange: (request: RequestDocumentIdentity | null) => void
  onToggleRow: (rowId: number) => void
  onSetRowResult: (rowId: number, result: string) => void
  onSetRowsResult: (rowIds: number[], result: string) => void
  onOpenJournalRows: (rows: readonly WeldRow[], sourceLabel: string) => void
  onOpenPstoHistory?: (row: WeldRow) => void
  onStageChange?: (stage: LnkControlStage, selectedRowIds: number[]) => void
  onSave: () => void
}

export function LnkResultDialog({
  elevated = false,
  draft,
  selectedMethods,
  selectedRows,
  visibleRows,
  requestRows,
  availableRequestOptions,
  systemDocumentCreationPlan,
  saveCheckSettings,
  controlProcessSettings,
  saveBlockReason,
  rootCauseActions = [],
  onRunRootCauseAction,
  isSaveDisabled,
  contextReady,
  canBulkToggleRows,
  areAllFilteredRowsSelected,
  onClose,
  onOpenManager,
  onMethodChange,
  onControlDateChange,
  onDefaultResultChange,
  onConclusionNamingChange,
  onClearSelection,
  onSetSelectedRows,
  onToggleAllRows,
  onSearchChange,
  onRequestChange,
  onToggleRow,
  onSetRowResult,
  onSetRowsResult,
  onOpenJournalRows,
  onOpenPstoHistory,
  onStageChange,
  onSave,
}: LnkResultDialogProps) {
  const contextMenuRef = useRef<DialogContextMenuLayerHandle>(null)
  const controlDateInputRef = useRef<HTMLInputElement>(null)
  const [initiallySelectedIds] = useState(() => new Set(draft.rowIds))
  const [rowsViewMode, setRowsViewMode] = useState<SelectedRowsViewMode>('all')
  const [workspaceTab, setWorkspaceTab] = useState<DocumentWorkspaceTab>('joints')
  const [selectedRowsSearch, setSelectedRowsSearch] = useState('')
  const stableOnToggleRow = useStableEventCallback(onToggleRow)
  const stableOnSetRowResult = useStableEventCallback(onSetRowResult)
  const orderedVisibleRows = useMemo(
    () => pinInitiallySelectedRows(visibleRows, draft.rowIds, initiallySelectedIds),
    [draft.rowIds, initiallySelectedIds, visibleRows],
  )
  const filteredSelectedRows = useMemo(
    () => filterLnkResultRows(selectedRows, selectedRowsSearch, draft.methodKey),
    [draft.methodKey, selectedRows, selectedRowsSearch],
  )
  useEffect(() => {
    if (draft.rowIds.size === 0 && rowsViewMode === 'selected') setRowsViewMode('all')
  }, [draft.rowIds.size, rowsViewMode])
  useEffect(() => {
    if ((!draft.methodKey || !systemDocumentCreationPlan) && workspaceTab === 'documents') {
      setWorkspaceTab('joints')
    }
  }, [draft.methodKey, systemDocumentCreationPlan, workspaceTab])
  const displayedRows = rowsViewMode === 'selected' ? filteredSelectedRows : orderedVisibleRows
  const displayedSearch = rowsViewMode === 'selected' ? selectedRowsSearch : draft.search
  const paginationResetKeys = useMemo(
    () => [displayedSearch, rowsViewMode, draft.requestName, draft.requestDate, draft.methodKey],
    [displayedSearch, draft.methodKey, draft.requestDate, draft.requestName, rowsViewMode],
  )
  const rowsPagination = usePagePagination({
    items: displayedRows,
    defaultPageSize: 50,
    resetKeys: paginationResetKeys,
  })
  const rowsViewportResetKey = `${rowsPagination.page}:${rowsPagination.pageSize}:${displayedSearch}:${rowsViewMode}:${draft.requestName}:${draft.requestDate}:${draft.methodKey}`
  const selectedRequest = createRequestDocumentIdentity(draft.requestName, draft.requestDate)
  const canOpenConclusions = Boolean(draft.methodKey && systemDocumentCreationPlan)
  const conclusionCount = systemDocumentCreationPlan?.groups.length ?? 0
  const hasNonEmptyRows = hasNonEmptyLnkResultDraftRows(selectedRows, draft, saveCheckSettings)
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
    <Button variant="outline" size="sm" onClick={onToggleAllRows} disabled={!canBulkToggleRows}>
      {!contextReady
        ? 'Выберите метод'
        : !canBulkToggleRows
          ? 'Сузьте поиск'
          : areAllFilteredRowsSelected
            ? 'Снять все'
            : 'Выбрать все доступные'}
    </Button>
  )
  const selectableRequestRows = useMemo(
    () => requestRows.filter((row) => canSelectLnkResultRow(row, draft.requestName, draft.methodKey, draft.requestDate)),
    [draft.methodKey, draft.requestDate, draft.requestName, requestRows],
  )
  const openRowContextMenu = useStableEventCallback((event: MouseEvent<HTMLElement>, row: WeldRow) => {
    const point = getDialogMenuPoint(event)
    const isRowSelectable = (candidate: WeldRow) => canSelectLnkResultRow(
      candidate,
      draft.requestName,
      draft.methodKey,
      draft.requestDate,
      controlProcessSettings,
    )
    contextMenuRef.current?.open(buildDialogRowContextMenu({
      ...point,
      row,
      selectedRows,
      selectedIds: draft.rowIds,
      selectableRows: selectableRequestRows,
      isRowSelectable,
      sourceLabel: 'результата ЛНК',
      relatedSelection: draft.requestName
        ? { label: 'Выбрать доступные по этой заявке', rows: selectableRequestRows }
        : undefined,
      resultAssignment: {
        values: LNK_RESULT_OPTIONS,
        getDisabledReason: (value, rows) => {
          if (!saveCheckSettings.lnkResultRepairRules || value !== 'ремонт') return null
          const forbiddenRow = rows.find(isLnkRepairForbidden)
          return forbiddenRow ? getLnkRepairForbiddenReason(forbiddenRow) : null
        },
        onAssign: (rows, value) => onSetRowsResult(rows.map((item) => item.id), value),
      },
      onSetSelectedRows,
      onShowSelectedRows: () => setRowsViewMode('selected'),
      onClearSelection,
      onOpenJournalRows,
      onOpenPstoHistory,
    }))
  })
  const openGroupContextMenu = useStableEventCallback((event: MouseEvent<HTMLElement>, group: SystemDocumentCreationGroup) => {
    if (!systemDocumentCreationPlan) return
    const point = getDialogMenuPoint(event)
    contextMenuRef.current?.open(buildDocumentGroupContextMenu({
      ...point,
      group,
      allRows: selectedRows,
      sourceLabel: 'результата ЛНК',
      onOpenJournalRows,
    }))
  })
  const runRootCauseAction = (action: WorkflowRootCauseAction) => {
    const target = action.target
    const editsCurrentDraft = target.kind === 'lnk-control' &&
      target.stage === 'primary' &&
      target.documentPart === 'conclusion' &&
      target.focus === 'date' &&
      LNK_METHODS.some((method) =>
        method.code === target.methodCode && method.requestKey === draft.methodKey,
      ) &&
      draft.rowIds.has(target.rowId) &&
      target.documentDate === draft.controlDate
    if (editsCurrentDraft) {
      controlDateInputRef.current?.focus()
      return
    }
    onRunRootCauseAction?.(action)
  }

  return (
    <WorkflowDialogShell elevated={elevated}>
      <ResultDialogHeader
        title="Внесение результатов ЛНК"
        requestName={draft.requestName}
        selectedCount={draft.rowIds.size}
        managerDisabled={false}
        onOpenManager={onOpenManager}
        onClose={onClose}
        stageControl={onStageChange ? (
          <LnkControlStageSwitch
            value="primary"
            onChange={(stage) => onStageChange(stage, [...draft.rowIds])}
          />
        ) : undefined}
      />

      <LnkResultSettings
        draft={draft}
        selectedMethods={selectedMethods}
        selectedRows={selectedRows}
        requestKey={selectedRequest?.key ?? ''}
        requestOptions={availableRequestOptions}
        saveCheckSettings={saveCheckSettings}
        controlDateInputRef={controlDateInputRef}
        onMethodChange={onMethodChange}
        onControlDateChange={onControlDateChange}
        onDefaultResultChange={onDefaultResultChange}
        onRequestChange={onRequestChange}
      />

      <DocumentWorkspaceTabs
        activeTab={workspaceTab}
        ariaLabel="Разделы результата ЛНК"
        documentsLabel="Заключения и имена"
        documentsCount={conclusionCount}
        documentsDisabled={!canOpenConclusions}
        documentsHaveError={Boolean(systemDocumentCreationPlan?.error)}
        onChange={setWorkspaceTab}
      />

      {workspaceTab === 'documents' && systemDocumentCreationPlan ? (
        <LnkResultConclusionsPanel
          plan={systemDocumentCreationPlan}
          naming={draft.conclusionNaming}
          disabled={!hasNonEmptyRows}
          onNamingChange={onConclusionNamingChange}
          onOpenGroupContextMenu={openGroupContextMenu}
        />
      ) : (
        <div className="flex min-h-0 flex-1 overflow-hidden px-5 py-3">
          <RequestRowsPanel
            title="Стыки"
            description=""
            viewToggle={selectedRowsViewToggle}
            action={rowsAction}
            searchValue={displayedSearch}
            searchPlaceholder={rowsViewMode === 'selected' ? 'Поиск среди выбранных стыков' : 'Проект, шифр, линия, спул или стык'}
            filteredCount={rowsViewMode === 'selected' ? filteredSelectedRows.length : visibleRows.length}
            availableCount={rowsViewMode === 'selected' ? draft.rowIds.size : selectableRequestRows.length}
            statsLabel={rowsViewMode === 'selected' ? <>Найдено: {filteredSelectedRows.length} · Выбрано: {draft.rowIds.size}</> : undefined}
            isEmpty={displayedRows.length === 0}
            emptyMessage={rowsViewMode === 'selected'
              ? draft.rowIds.size === 0
                ? 'Выбранных стыков пока нет.'
                : 'Среди выбранных стыков ничего не найдено.'
              : draft.search
                ? 'По фильтру ничего не найдено.'
                : 'По выбранному методу нет стыков для добавления результата.'}
            onSearchChange={rowsViewMode === 'selected' ? setSelectedRowsSearch : onSearchChange}
          >
            <div className={`grid shrink-0 ${LNK_RESULT_ROW_GRID_CLASS} gap-3 border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-semibold text-slate-500`}>
              <span />
              <span>Стык</span>
              <span>Заявки и заключения</span>
              <span>Результат</span>
              <span />
            </div>
            <DialogVirtualizedRows
              key={rowsViewportResetKey}
              items={rowsPagination.pageItems}
              estimateRowHeight={92}
              getItemKey={(row) => row.id}
              renderItem={(row) => (
                <LnkResultRow
                  row={row}
                  controlProcessSettings={controlProcessSettings}
                  requestName={draft.requestName}
                  requestDate={draft.requestDate}
                  methodKey={draft.methodKey}
                  selected={draft.rowIds.has(row.id)}
                  rowResult={getEffectiveLnkResultDraftValue(row.id, draft)}
                  saveCheckSettings={saveCheckSettings}
                  onToggleRow={stableOnToggleRow}
                  onSetRowResult={stableOnSetRowResult}
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

      <ResultDialogFooter
        saveBlockReason={saveBlockReason}
        blockReasonActions={rootCauseActions.map((action) => ({
          key: action.key,
          label: action.label,
          onAction: () => runRootCauseAction(action),
        }))}
        isSaveDisabled={isSaveDisabled}
        saveBlockReasonVariant="danger"
        blockReasonActionLabel={systemDocumentCreationPlan?.error && workspaceTab !== 'documents' ? 'Открыть заключения и имена' : undefined}
        onBlockReasonAction={systemDocumentCreationPlan?.error && workspaceTab !== 'documents' ? () => setWorkspaceTab('documents') : undefined}
        onClose={onClose}
        onSave={onSave}
      />
      <DialogContextMenuLayer ref={contextMenuRef} />
    </WorkflowDialogShell>
  )
}
