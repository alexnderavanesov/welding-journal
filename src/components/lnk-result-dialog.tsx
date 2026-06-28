import { Check, Pencil, X } from 'lucide-react'

import { LnkResultFilters } from '@/components/lnk-result-filters'
import { LnkResultRow } from '@/components/lnk-result-row'
import { RequestNamingControls } from '@/components/request-naming-controls'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import type { WeldRow } from '@/lib/dispatcher-types'
import { hasNonEmptyLnkResultDraftRows } from '@/lib/lnk-result-draft'
import {
  getLnkResultRepairForbiddenSummary,
  isLnkRepairForbidden,
} from '@/lib/lnk-result-rules'
import { LNK_CUSTOM_RESULT_VALUE, LNK_METHODS, LNK_RESULT_OPTIONS } from '@/lib/report-config'
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
  const hasNonEmptyRows = hasNonEmptyLnkResultDraftRows(selectedRows, draft)
  const hasRepairForbiddenRows = selectedRows.some(isLnkRepairForbidden)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/20 px-4 backdrop-blur-[1px]">
      <div className="flex h-[94vh] w-full max-w-[1480px] flex-col rounded-md border border-slate-200 bg-white shadow-2xl shadow-slate-950/10">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">Добавление результата ЛНК</h2>
            <p className="text-sm text-muted-foreground">
              Заявка: {draft.requestName || '-'} · Выбрано: {draft.rowIds.size}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={onOpenManager}
              disabled={draft.rowIds.size === 0}
              className="border-sky-300 bg-sky-100 text-sky-900 shadow-sm shadow-sky-100 hover:bg-sky-200 disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
            >
              <Pencil className="mr-2 h-4 w-4" />
              Редактировать результаты
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Закрыть">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-hidden px-6 py-5 lg:grid-cols-[340px_minmax(0,1fr)]">
          <section className="min-h-0 space-y-3 overflow-y-auto pr-1">
            <div className="rounded-md border border-slate-200 bg-white p-3">
              <h3 className="mb-3 text-sm font-semibold text-slate-800">1. Метод и результат</h3>
              <div className="grid grid-cols-1 gap-3">
                <label className="block space-y-1.5 text-sm">
                  <span className="text-[13px] font-medium leading-none text-slate-700">Метод контроля</span>
                  <Select
                    value={draft.methodKey}
                    onChange={(event) => onMethodChange(event.target.value as WeldFieldKey)}
                    disabled={selectedMethods.length === 0}
                    className={!draft.methodKey && selectedMethods.length > 0 ? 'text-slate-700' : undefined}
                  >
                    <option value="">Выберите метод</option>
                    {selectedMethods.map((method) => (
                      <option key={method.requestKey} value={method.requestKey}>
                        {method.code}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="block space-y-1.5 text-sm">
                  <span className="text-[13px] font-medium leading-none text-slate-700">Дата контроля</span>
                  <Input
                    type="date"
                    value={draft.controlDate}
                    disabled={!hasNonEmptyRows}
                    onChange={(event) => onControlDateChange(event.target.value)}
                  />
                </label>

                <label className="block space-y-1.5 text-sm">
                  <span className="text-[13px] font-medium leading-none text-slate-700">Результат по умолчанию</span>
                  <Select value={draft.result} onChange={(event) => onDefaultResultChange(event.target.value)}>
                    <option value="">Выберите результат</option>
                    <option value={LNK_CUSTOM_RESULT_VALUE} disabled>
                      пользовательский
                    </option>
                    {LNK_RESULT_OPTIONS.map((option) => (
                      <option key={option} value={option} disabled={option === 'ремонт' && hasRepairForbiddenRows}>
                        {option}
                      </option>
                    ))}
                  </Select>
                  {hasRepairForbiddenRows ? (
                    <span className="block text-xs text-slate-500">
                      Ремонт недоступен: {getLnkResultRepairForbiddenSummary(selectedRows)}.
                    </span>
                  ) : null}
                </label>
              </div>
            </div>

            <div className={`rounded-md border border-slate-200 p-3 ${!hasNonEmptyRows ? 'bg-slate-50 opacity-60' : 'bg-white'}`}>
              <h3 className="mb-3 text-sm font-semibold text-slate-800">2. Заключение</h3>
              <RequestNamingControls
                naming={draft.conclusionNaming}
                systemName={nextConclusionName}
                label="Наименование заключения"
                placeholder="Введите наименование заключения"
                disabled={!hasNonEmptyRows}
                onChange={onConclusionNamingChange}
              />
            </div>

            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-xs leading-5 text-slate-600">
              Результат заменит статус «ожидает НК» в выбранном виде контроля. Наименование заключения попадет в
              соответствующий столбец раздела «Заключения». Уже внесенные результаты изменяются только через
              «Редактировать результаты».
            </div>
          </section>

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
