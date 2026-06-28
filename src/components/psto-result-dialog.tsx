import type { Dispatch, SetStateAction } from 'react'

import { PstoResultFilters } from '@/components/psto-result-filters'
import { PstoResultRow } from '@/components/psto-result-row'
import { PstoResultSettings } from '@/components/psto-result-settings'
import { ResultDialogFooter } from '@/components/result-dialog-footer'
import { ResultDialogHeader } from '@/components/result-dialog-header'
import { Button } from '@/components/ui/button'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { PstoResultDraftState } from '@/lib/report-draft-state'

export type PstoResultDialogProps = {
  draft: PstoResultDraftState
  requestSearch: string
  nextDiagramName: string
  filteredRows: WeldRow[]
  filteredRequestOptions: string[]
  availableRequestOptions: string[]
  saveBlockReason: string | null
  allFilteredSelectableRowsSelected: boolean
  canSelectRow: (row: WeldRow, requestName: string) => boolean
  onDraftChange: Dispatch<SetStateAction<PstoResultDraftState>>
  onRequestSearchChange: (value: string) => void
  onRequestChange: (requestName: string) => void
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
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/20 px-4 backdrop-blur-[1px]">
      <div className="flex h-[94vh] w-full max-w-[1480px] flex-col rounded-md border border-slate-200 bg-white shadow-2xl shadow-slate-950/10">
        <ResultDialogHeader
          title="Добавление результата ПСТО"
          requestName={draft.requestName}
          selectedCount={draft.rowIds.size}
          managerDisabled={draft.rowIds.size === 0}
          onOpenManager={onOpenManager}
          onClose={onClose}
        />

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-hidden px-6 py-5 lg:grid-cols-[340px_minmax(0,1fr)]">
          <PstoResultSettings draft={draft} nextDiagramName={nextDiagramName} onDraftChange={onDraftChange} />

          <section className="flex min-h-0 flex-col space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">
                  {draft.requestName ? 'Стыки в выбранной заявке' : 'Стыки для результата'}
                </h3>
                <p className="text-xs leading-5 text-slate-500">
                  {draft.requestName
                    ? 'Видны проект, шифр, линия, спул и номер стыка для проверки перед сохранением.'
                    : 'Найдите стык, посмотрите его заявку ПСТО и статус стыка, затем выберите нужную заявку.'}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={onToggleAll} disabled={filteredRows.length === 0}>
                {allFilteredSelectableRowsSelected ? 'Снять все' : 'Выбрать все'}
              </Button>
            </div>

            <PstoResultFilters
              search={draft.search}
              requestSearch={requestSearch}
              requestName={draft.requestName}
              filteredRequestOptions={filteredRequestOptions}
              availableRequestOptionsCount={availableRequestOptions.length}
              filteredRowsCount={filteredRows.length}
              selectedRowsCount={draft.rowIds.size}
              onSearchChange={(search) => onDraftChange((current) => ({ ...current, search }))}
              onRequestSearchChange={onRequestSearchChange}
              onRequestChange={onRequestChange}
              onClearFilters={onClearFilters}
            />

            <div className="min-h-0 overflow-auto rounded-md border border-slate-200">
              {filteredRows.length === 0 ? (
                <div className="flex min-h-72 items-center justify-center px-4 py-10 text-center text-sm text-slate-500">
                  {draft.search || requestSearch ? 'По фильтру ничего не найдено.' : 'Нет стыков для добавления результата ПСТО.'}
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {filteredRows.map((row) => (
                    <PstoResultRow
                      key={row.id}
                      row={row}
                      selected={draft.rowIds.has(row.id)}
                      disabled={!canSelectRow(row, draft.requestName)}
                      onToggle={onToggleRow}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>

        <ResultDialogFooter
          saveBlockReason={saveBlockReason}
          isSaveDisabled={Boolean(saveBlockReason)}
          onClose={onClose}
          onSave={onSave}
        />
      </div>
    </div>
  )
}
