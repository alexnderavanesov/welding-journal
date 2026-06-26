import { Check, Pencil, X } from 'lucide-react'

import {
  JointProjectSubtitleMeta,
  JointSpoolDiameterMeta,
  JointWeldDateMeta,
  MetaSeparator,
  OfficialityBadge,
} from '@/components/joint-meta'
import { RequestNamingControls } from '@/components/request-naming-controls'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { LNK_METHODS } from '@/lib/report-config'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getAvailableLnkRequestMethods } from '@/lib/lnk-status'
import { getLnkRowRequestMethods, isEveryFilteredLnkRequestRowSelected } from '@/lib/report-modal-rows'
import { getJointTitle } from '@/lib/report-ui-state'
import type { RequestNamingState } from '@/lib/request-naming-state'
import type { WeldFieldKey } from '@/lib/weld-fields'

type LnkRequestDialogProps = {
  nextRequestName: string
  selectedRowsCount: number
  selectedTargetCount: number
  requestNaming: RequestNamingState
  requestManagerOptions: string[]
  selectedMethodKeys: readonly WeldFieldKey[]
  selectedMethods: ReadonlySet<WeldFieldKey>
  requestSearch: string
  lnkRowsCount: number
  filteredRows: WeldRow[]
  filteredAvailableRows: WeldRow[]
  selectedIds: ReadonlySet<number>
  isPending: boolean
  onClose: () => void
  onOpenRequestManager: () => void
  onRequestNamingChange: (value: RequestNamingState) => void
  onToggleMethod: (methodKey: WeldFieldKey) => void
  onRequestSearchChange: (value: string) => void
  onToggleAllRows: () => void
  onToggleRow: (rowId: number) => void
  onSubmit: () => void
}

export function LnkRequestDialog({
  nextRequestName,
  selectedRowsCount,
  selectedTargetCount,
  requestNaming,
  requestManagerOptions,
  selectedMethodKeys,
  selectedMethods,
  requestSearch,
  lnkRowsCount,
  filteredRows,
  filteredAvailableRows,
  selectedIds,
  isPending,
  onClose,
  onOpenRequestManager,
  onRequestNamingChange,
  onToggleMethod,
  onRequestSearchChange,
  onToggleAllRows,
  onToggleRow,
  onSubmit,
}: LnkRequestDialogProps) {
  const hasSearch = requestSearch.trim().length > 0
  const allFilteredRowsSelected = isEveryFilteredLnkRequestRowSelected(selectedIds, filteredAvailableRows)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/20 px-4 backdrop-blur-[1px]">
      <div className="flex max-h-[92vh] w-full max-w-[1320px] flex-col rounded-md border border-slate-200 bg-white shadow-2xl shadow-slate-950/10">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">Создание заявки ЛНК</h2>
            <p className="text-sm text-muted-foreground">
              {nextRequestName} · Стыков: {selectedRowsCount} · Позиций: {selectedTargetCount}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Закрыть">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="border-b border-slate-100 px-5 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
            <div className="min-w-0 flex-1">
              <RequestNamingControls
                naming={requestNaming}
                systemName={nextRequestName}
                label="Наименование заявки ЛНК"
                onChange={onRequestNamingChange}
              />
            </div>
            <Button
              variant="outline"
              onClick={onOpenRequestManager}
              disabled={requestManagerOptions.length === 0}
              className="shrink-0 border-sky-300 bg-sky-100 text-sky-900 shadow-sm shadow-sky-100 hover:bg-sky-200 disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
            >
              <Pencil className="mr-2 h-4 w-4" />
              Управление заявками
            </Button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-hidden px-6 py-5 lg:grid-cols-[300px_minmax(0,1fr)]">
          <section className="min-h-0 space-y-3 overflow-y-auto pr-1">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-800">Виды контроля</h3>
              <span className="text-xs text-slate-500">
                {selectedMethodKeys.length}/{LNK_METHODS.length}
              </span>
            </div>
            <p className="text-xs leading-5 text-slate-500">Выберите один или несколько видов контроля для этой заявки.</p>
            <div className="grid grid-cols-2 gap-2">
              {LNK_METHODS.map((method) => (
                <button
                  key={method.requestKey}
                  type="button"
                  onClick={() => onToggleMethod(method.requestKey)}
                  className={`inline-flex h-10 items-center justify-center rounded-md border px-3 text-sm font-medium transition-colors ${
                    selectedMethods.has(method.requestKey)
                      ? 'border-sky-300 bg-sky-100 text-sky-900 shadow-sm shadow-sky-100'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {method.code}
                </button>
              ))}
            </div>
          </section>

          <section className="flex min-h-0 flex-col space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">Стыки</h3>
                <p className="text-xs leading-5 text-slate-500">
                  Галочка доступна только там, где есть хотя бы один вид контроля без заявки.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={onToggleAllRows}
                disabled={!hasSearch || filteredAvailableRows.length === 0}
                title={!hasSearch ? 'Сначала сузьте список поиском' : undefined}
              >
                {allFilteredRowsSelected ? 'Снять все' : 'Выбрать доступные'}
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
              <Input
                value={requestSearch}
                onChange={(event) => onRequestSearchChange(event.target.value)}
                placeholder="Линия, спул или стык"
                className="h-9 min-w-64 flex-1 bg-white"
              />
              <span className="whitespace-nowrap px-2 text-xs text-slate-500">
                Найдено: {filteredRows.length} · Доступно: {filteredAvailableRows.length}
              </span>
              {requestSearch ? (
                <Button variant="outline" size="sm" onClick={() => onRequestSearchChange('')}>
                  Очистить
                </Button>
              ) : null}
            </div>

            <div className="min-h-0 overflow-auto rounded-md border border-slate-200">
              {filteredAvailableRows.length === 0 ? (
                <div className="px-4 py-6 text-sm text-slate-500">
                  {lnkRowsCount === 0
                    ? 'Нет стыков для отчета ЛНК.'
                    : filteredRows.length === 0
                      ? 'По фильтру ничего не найдено.'
                      : 'По найденным стыкам нет доступных методов для новой заявки.'}
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {filteredAvailableRows.map((row) => {
                    const availableMethods = getAvailableLnkRequestMethods(row)
                    const existingMethods = getLnkRowRequestMethods(row, '')
                    const disabled = availableMethods.length === 0
                    const selected = selectedIds.has(row.id)

                    return (
                      <label
                        key={row.id}
                        className={`grid grid-cols-[28px_minmax(180px,1fr)_minmax(220px,1.4fr)] items-center gap-3 px-4 py-3 text-sm transition-colors ${
                          disabled
                            ? 'cursor-not-allowed bg-slate-100 text-slate-400'
                            : selected
                              ? 'cursor-pointer bg-emerald-50/80'
                              : 'cursor-pointer bg-white hover:bg-slate-50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => onToggleRow(row.id)}
                          disabled={disabled}
                          className="h-4 w-4 rounded border-slate-300 text-slate-900"
                        />
                        <span className="min-w-0">
                          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                            <span className="truncate font-medium text-slate-900">{getJointTitle(row)}</span>
                            <OfficialityBadge row={row} compact />
                          </span>
                          <span className="block text-xs leading-5 text-slate-500">
                            <JointProjectSubtitleMeta row={row} />
                            <MetaSeparator />
                            <JointSpoolDiameterMeta row={row} />
                            <MetaSeparator />
                            <JointWeldDateMeta row={row} />
                          </span>
                        </span>
                        <span className="flex flex-wrap gap-1.5">
                          {availableMethods.length > 0 ? (
                            availableMethods.map((method) => {
                              const isSelectedMethod = selected && selectedMethods.has(method.requestKey)
                              return (
                                <span
                                  key={method.requestKey}
                                  className={`rounded border px-2 py-1 text-xs font-medium ${
                                    isSelectedMethod
                                      ? 'border-sky-300 bg-sky-100 text-sky-900'
                                      : 'border-slate-200 bg-slate-50 text-slate-600'
                                  }`}
                                >
                                  {method.code}
                                </span>
                              )
                            })
                          ) : (
                            <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-500">
                              Все заявки уже созданы
                            </span>
                          )}
                          {existingMethods.map((method) => (
                            <span
                              key={`${method.requestKey}-existing`}
                              className="inline-flex max-w-full flex-wrap items-center gap-1 overflow-visible rounded border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-medium text-sky-800"
                              title={`${method.code}: ${String(row[method.requestKey] ?? '')}`}
                            >
                              <span>{method.code}</span>
                              <span className="overflow-visible break-all whitespace-normal text-sky-600 [text-overflow:clip]">
                                {String(row[method.requestKey] ?? '')}
                              </span>
                            </span>
                          ))}
                        </span>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200/80 px-5 py-4">
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={onSubmit} disabled={isPending || selectedTargetCount === 0}>
            <Check className="mr-2 h-4 w-4" />
            Создать заявку
          </Button>
        </div>
      </div>
    </div>
  )
}
