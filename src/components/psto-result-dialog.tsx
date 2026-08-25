import { useMemo, type Dispatch, type SetStateAction } from 'react'

import { DialogRowPagination } from '@/components/dialog-row-pagination'
import { LargeDialogShell } from '@/components/large-dialog-shell'
import { PstoResultFilters } from '@/components/psto-result-filters'
import { PstoResultRow } from '@/components/psto-result-row'
import { PstoResultSettings } from '@/components/psto-result-settings'
import { ResultDialogFooter } from '@/components/result-dialog-footer'
import { ResultDialogHeader } from '@/components/result-dialog-header'
import { ResultDialogRowsPanel } from '@/components/result-dialog-rows-panel'
import { Button } from '@/components/ui/button'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { PstoResultDraftState } from '@/lib/report-draft-state'
import type { SaveCheckSettings } from '@/lib/save-check-settings'
import type { SystemDocumentCreationPlan } from '@/lib/system-document-creation-plan'
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
  filteredRequestOptions: RequestDocumentIdentity[]
  availableRequestOptions: RequestDocumentIdentity[]
  saveBlockReason: string | null
  allFilteredSelectableRowsSelected: boolean
  canSelectRow: (row: WeldRow, requestName: string, requestDate?: string) => boolean
  onDraftChange: Dispatch<SetStateAction<PstoResultDraftState>>
  onRequestSearchChange: (value: string) => void
  onRequestChange: (request: RequestDocumentIdentity | null) => void
  onClearFilters: () => void
  onToggleAll: () => void
  onToggleRow: (rowId: number) => void
  onOpenManager: () => void
  onClose: () => void
  onSave: () => void
}

export function PstoResultDialog({
  draft,
  requestSearch,
  nextDiagramName,
  systemDocumentCreationPlan,
  saveCheckSettings,
  filteredRows,
  filteredRequestOptions,
  availableRequestOptions,
  saveBlockReason,
  allFilteredSelectableRowsSelected,
  canSelectRow,
  onDraftChange,
  onRequestSearchChange,
  onRequestChange,
  onClearFilters,
  onToggleAll,
  onToggleRow,
  onOpenManager,
  onClose,
  onSave,
}: PstoResultDialogProps) {
  const stableOnToggleRow = useStableEventCallback(onToggleRow)
  const paginationResetKeys = useMemo(
    () => [draft.search, draft.requestName, draft.requestDate, requestSearch],
    [draft.requestDate, draft.requestName, draft.search, requestSearch],
  )
  const rowsPagination = usePagePagination({
    items: filteredRows,
    defaultPageSize: 50,
    resetKeys: paginationResetKeys,
  })
  const selectedRequest = createRequestDocumentIdentity(draft.requestName, draft.requestDate)

  return (
    <LargeDialogShell
      maxWidthClassName="max-w-[1480px]"
      maxHeightClassName="h-[94vh]"
      overlayClassName="z-50 bg-slate-950/20"
      panelShadowClassName="shadow-slate-950/10"
    >
      <ResultDialogHeader
        title="Добавление результата ПСТО"
        requestName={draft.requestName}
        selectedCount={draft.rowIds.size}
        managerDisabled={draft.rowIds.size === 0}
        onOpenManager={onOpenManager}
        onClose={onClose}
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-hidden px-6 py-5 lg:grid-cols-[340px_minmax(0,1fr)]">
        <PstoResultSettings
          draft={draft}
          nextDiagramName={nextDiagramName}
          creationPlan={systemDocumentCreationPlan}
          saveCheckSettings={saveCheckSettings}
          onDraftChange={onDraftChange}
        />

        <ResultDialogRowsPanel
          title={draft.requestName ? 'Стыки в выбранной заявке' : 'Стыки для результата'}
          description={
            draft.requestName
              ? 'Видны проект, шифр, линия, спул и номер стыка для проверки перед сохранением.'
              : 'Найдите стык, посмотрите его заявку ПСТО и статус стыка, затем выберите нужную заявку.'
          }
          actions={
            <Button variant="outline" size="sm" onClick={onToggleAll} disabled={filteredRows.length === 0}>
              {allFilteredSelectableRowsSelected ? 'Снять все' : 'Выбрать все'}
            </Button>
          }
          filters={
            <PstoResultFilters
              search={draft.search}
              requestSearch={requestSearch}
              requestKey={selectedRequest?.key ?? ''}
              filteredRequestOptions={filteredRequestOptions}
              availableRequestOptionsCount={availableRequestOptions.length}
              filteredRowsCount={filteredRows.length}
              selectedRowsCount={draft.rowIds.size}
              onSearchChange={(search) => onDraftChange((current) => ({ ...current, search }))}
              onRequestSearchChange={onRequestSearchChange}
              onRequestChange={onRequestChange}
              onClearFilters={onClearFilters}
            />
          }
          isEmpty={filteredRows.length === 0}
          emptyMessage={
            draft.search || requestSearch
              ? 'По фильтру ничего не найдено.'
              : 'Нет стыков для добавления результата ПСТО.'
          }
        >
          <div className="divide-y divide-slate-100">
            {rowsPagination.pageItems.map((row) => (
              <PstoResultRow
                key={row.id}
                row={row}
                selected={draft.rowIds.has(row.id)}
                disabled={!canSelectRow(row, draft.requestName, draft.requestDate)}
                onToggle={stableOnToggleRow}
              />
            ))}
          </div>
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
        </ResultDialogRowsPanel>
      </div>

      <ResultDialogFooter
        saveBlockReason={saveBlockReason}
        isSaveDisabled={Boolean(saveBlockReason)}
        saveBlockReasonVariant="danger"
        onClose={onClose}
        onSave={onSave}
      />
    </LargeDialogShell>
  )
}
