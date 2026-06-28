import { Check } from 'lucide-react'

import { LnkResultFilters } from '@/components/lnk-result-filters'
import { LnkResultRow } from '@/components/lnk-result-row'
import { LnkResultSettings } from '@/components/lnk-result-settings'
import { ResultDialogHeader } from '@/components/result-dialog-header'
import { Button } from '@/components/ui/button'
import type { WeldRow } from '@/lib/dispatcher-types'
import { LNK_METHODS } from '@/lib/report-config'
import type { LnkResultDraftState } from '@/lib/report-draft-state'
import type { RequestNamingState } from '@/lib/request-naming-state'
import type { WeldFieldKey } from '@/lib/weld-fields'

type LnkResultMethod = (typeof LNK_METHODS)[number]

export type LnkResultDialogProps = {
  draft: LnkResultDraftState
  requestSearch: string
  selectedMethods: LnkResultMethod[]
  selectedRows: WeldRow[]
  visibleRows: WeldRow[]
  filteredRequestOptions: string[]
  availableRequestOptions: string[]
  nextConclusionName: string
  saveBlockReason: string | null
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
  onToggleAllRows: () => void
  onSearchChange: (search: string) => void
  onRequestSearchChange: (search: string) => void
  onRequestChange: (requestName: string) => void
  onClearRequestSearch: () => void
  onClearSearch: () => void
  onToggleRow: (rowId: number) => void
  onSetRowResult: (rowId: number, result: string) => void
  onOpenPreview: () => void
  onSave: () => void
}

export function LnkResultDialog({
  draft,
  requestSearch,
  selectedMethods,
  selectedRows,
  visibleRows,
  filteredRequestOptions,
  availableRequestOptions,
  nextConclusionName,
  saveBlockReason,
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
  onToggleAllRows,
  onSearchChange,
  onRequestSearchChange,
  onRequestChange,
  onClearRequestSearch,
  onClearSearch,
  onToggleRow,
  onSetRowResult,
  onOpenPreview,
  onSave,
}: LnkResultDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/20 px-4 backdrop-blur-[1px]">
      <div className="flex h-[94vh] w-full max-w-[1480px] flex-col rounded-md border border-slate-200 bg-white shadow-2xl shadow-slate-950/10">
        <ResultDialogHeader
          title="Добавление результата ЛНК"
          requestName={draft.requestName}
          selectedCount={draft.rowIds.size}
          managerDisabled={draft.rowIds.size === 0}
          onOpenManager={onOpenManager}
          onClose={onClose}
        />

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-hidden px-6 py-5 lg:grid-cols-[340px_minmax(0,1fr)]">
          <LnkResultSettings
            draft={draft}
            selectedMethods={selectedMethods}
            selectedRows={selectedRows}
            nextConclusionName={nextConclusionName}
            onMethodChange={onMethodChange}
            onControlDateChange={onControlDateChange}
            onDefaultResultChange={onDefaultResultChange}
            onConclusionNamingChange={onConclusionNamingChange}
          />

          <section className="flex min-h-0 flex-col space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">Стыки для результата</h3>
                <p className="text-xs leading-5 text-slate-500">
                  Видны проект, шифр, линия, спул и номер стыка для проверки перед сохранением.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {draft.rowIds.size > 0 ? (
                  <Button variant="outline" size="sm" onClick={onClearSelection}>
                    Снять выбор
                  </Button>
                ) : null}
                <Button variant="outline" size="sm" onClick={onToggleAllRows} disabled={!canBulkToggleRows}>
                  {!contextReady
                    ? 'Выберите метод'
                    : !canBulkToggleRows
                      ? 'Сузьте поиск'
                      : areAllFilteredRowsSelected
                        ? 'Снять все'
                        : 'Выбрать все доступные'}
                </Button>
              </div>
            </div>

            <LnkResultFilters
              search={draft.search}
              requestSearch={requestSearch}
              requestName={draft.requestName}
              filteredRequestOptions={filteredRequestOptions}
              availableRequestOptionsCount={availableRequestOptions.length}
              filteredRowsCount={visibleRows.length}
              selectedRowsCount={draft.rowIds.size}
              onSearchChange={onSearchChange}
              onRequestSearchChange={onRequestSearchChange}
              onRequestChange={onRequestChange}
              onClearRequestSearch={onClearRequestSearch}
              onClearSearch={onClearSearch}
            />

            <div className="min-h-0 overflow-auto rounded-md border border-slate-200">
              {visibleRows.length === 0 ? (
                <div className="flex min-h-72 items-center justify-center px-4 py-10 text-center text-sm text-slate-500">
                  {draft.search
                    ? 'По фильтру ничего не найдено.'
                    : 'По выбранному методу нет стыков для добавления результата.'}
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {visibleRows.map((row) => (
                    <LnkResultRow
                      key={row.id}
                      row={row}
                      draft={draft}
                      onToggleRow={onToggleRow}
                      onSetRowResult={onSetRowResult}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="flex items-end justify-between gap-4 border-t border-slate-200/80 px-5 py-4">
          <div className="min-h-5 text-sm text-slate-500">
            {saveBlockReason ? (
              <span className="text-sm text-slate-500">Чтобы сохранить: {saveBlockReason}</span>
            ) : null}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Отмена
            </Button>
            <Button variant="outline" onClick={onOpenPreview} disabled={selectedRows.length === 0}>
              Предпросмотр ({selectedRows.length})
            </Button>
            <span title={saveBlockReason || 'Можно сохранить результат'}>
              <Button onClick={onSave} disabled={isSaveDisabled} className={isSaveDisabled ? 'pointer-events-none' : ''}>
                <Check className="mr-2 h-4 w-4" />
                Сохранить результат
              </Button>
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
