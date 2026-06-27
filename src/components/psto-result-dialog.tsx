import type { Dispatch, SetStateAction } from 'react'
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
import { Select } from '@/components/ui/select'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getJointStatusBadgeClass, getJointStatusLabel } from '@/lib/lnk-status'
import { PSTO_EMPTY_RESULT_VALUE } from '@/lib/report-config'
import type { PstoResultDraftState } from '@/lib/report-draft-state'
import { getPstoResultBadgeClass, getPstoResultLabel } from '@/lib/report-badges'
import { getJointTitle } from '@/lib/report-ui-state'

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
        <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">Добавление результата ПСТО</h2>
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
              <h3 className="mb-3 text-sm font-semibold text-slate-800">1. Результат ПСТО</h3>
              <div className="grid grid-cols-1 gap-3">
                <label className="block space-y-1.5 text-sm">
                  <span className="text-[13px] font-medium leading-none text-slate-700">Дата ПСТО</span>
                  <Input
                    type="date"
                    value={draft.pstoDate}
                    disabled={draft.result === PSTO_EMPTY_RESULT_VALUE}
                    onChange={(event) => onDraftChange((current) => ({ ...current, pstoDate: event.target.value }))}
                  />
                </label>

                <label className="block space-y-1.5 text-sm">
                  <span className="text-[13px] font-medium leading-none text-slate-700">Результат</span>
                  <Select
                    value={draft.result}
                    onChange={(event) => onDraftChange((current) => ({ ...current, result: event.target.value }))}
                  >
                    <option value="">Выберите результат</option>
                    <option value="проведено">проведено</option>
                    <option value={PSTO_EMPTY_RESULT_VALUE}>аннулировать</option>
                  </Select>
                </label>
              </div>
            </div>

            <div
              className={`rounded-md border border-slate-200 p-3 ${
                draft.result === PSTO_EMPTY_RESULT_VALUE ? 'bg-slate-50 opacity-60' : 'bg-white'
              }`}
            >
              <RequestNamingControls
                naming={draft.diagramNaming}
                systemName={nextDiagramName}
                label="Диаграмма термообработки"
                placeholder="Введите наименование диаграммы"
                disabled={draft.result === PSTO_EMPTY_RESULT_VALUE}
                onChange={(diagramNaming) => onDraftChange((current) => ({ ...current, diagramNaming }))}
              />
            </div>

            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-xs leading-5 text-slate-600">
              Результат «проведено» заполнит дату ПСТО и диаграмму термообработки. Если выбрать «аннулировать»,
              результат, дата и диаграмма очистятся, заявка ПСТО останется.
            </div>
          </section>

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

            <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
              <Input
                value={draft.search}
                onChange={(event) => onDraftChange((current) => ({ ...current, search: event.target.value }))}
                placeholder="Проект, шифр, линия, спул или стык"
                className="h-9 min-w-56 flex-[0.8] bg-white"
              />
              <Input
                value={requestSearch}
                onChange={(event) => onRequestSearchChange(event.target.value)}
                placeholder="Поиск заявки"
                className="h-9 min-w-44 flex-[0.45] bg-white"
              />
              <Select
                value={draft.requestName}
                onChange={(event) => onRequestChange(event.target.value)}
                className="h-9 min-w-48 flex-[0.5] bg-white"
              >
                <option value="">Все заявки</option>
                {filteredRequestOptions.map((requestName) => (
                  <option key={requestName} value={requestName}>
                    {requestName}
                  </option>
                ))}
              </Select>
              {requestSearch ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onRequestSearchChange('')}
                  className="h-9 px-2"
                  aria-label="Очистить поиск заявки"
                >
                  <X className="h-4 w-4" />
                </Button>
              ) : null}
              <span className="whitespace-nowrap px-2 text-xs text-slate-500">
                Заявок: {filteredRequestOptions.length}/{availableRequestOptions.length}
              </span>
              <span className="whitespace-nowrap px-2 text-xs text-slate-500">
                Найдено: {filteredRows.length} · Выбрано: {draft.rowIds.size}
              </span>
              {draft.search || requestSearch ? (
                <Button variant="outline" size="sm" onClick={onClearFilters}>
                  Очистить
                </Button>
              ) : null}
            </div>

            <div className="min-h-0 overflow-auto rounded-md border border-slate-200">
              {filteredRows.length === 0 ? (
                <div className="flex min-h-72 items-center justify-center px-4 py-10 text-center text-sm text-slate-500">
                  {draft.search || requestSearch ? 'По фильтру ничего не найдено.' : 'Нет стыков для добавления результата ПСТО.'}
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {filteredRows.map((row) => {
                    const selected = draft.rowIds.has(row.id)
                    const disabled = !canSelectRow(row, draft.requestName)
                    const requestName = String(row.pstoRequest ?? '').trim()
                    const diagramName = String(row.heatTreatmentDiagram ?? '').trim()

                    return (
                      <div
                        key={row.id}
                        onClick={() => {
                          if (!disabled) onToggleRow(row.id)
                        }}
                        className={`grid grid-cols-[28px_minmax(260px,1fr)_minmax(220px,0.8fr)] gap-3 px-4 py-3 text-sm transition-colors ${
                          disabled
                            ? 'cursor-not-allowed bg-slate-100 text-slate-400'
                            : selected
                              ? 'cursor-pointer border-l-4 border-emerald-400 bg-emerald-100/80 shadow-[inset_0_0_0_1px_rgba(52,211,153,0.35)]'
                              : 'cursor-pointer bg-white hover:bg-slate-50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onClick={(event) => event.stopPropagation()}
                          onChange={() => onToggleRow(row.id)}
                          disabled={disabled}
                          className="mt-1 h-4 w-4 rounded border-slate-300 text-slate-900"
                        />
                        <span className="min-w-0">
                          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                            <span className="truncate font-medium text-slate-900">{getJointTitle(row)}</span>
                            <OfficialityBadge row={row} compact />
                          </span>
                          <span className="block text-xs leading-5 text-slate-500">
                            <JointProjectSubtitleMeta row={row} />
                          </span>
                          <span className="block text-xs leading-5 text-slate-500">
                            <JointSpoolDiameterMeta row={row} />
                            <MetaSeparator />
                            <JointWeldDateMeta row={row} />
                          </span>
                          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                            <span className={`rounded border px-1.5 py-0.5 font-semibold ${getJointStatusBadgeClass(row)}`}>
                              Стык: {getJointStatusLabel(row)}
                            </span>
                            <span className={`rounded border px-1.5 py-0.5 font-semibold ${getPstoResultBadgeClass(row.pstoResult)}`}>
                              ПСТО: {getPstoResultLabel(row.pstoResult)}
                            </span>
                          </span>
                          {disabled ? (
                            <span className="mt-1 block text-xs leading-5 text-slate-500">
                              {requestName ? 'Выберите эту заявку ПСТО, чтобы отметить стык.' : 'На этот стык еще нет заявки ПСТО.'}
                            </span>
                          ) : null}
                        </span>
                        <span className="flex flex-wrap content-start gap-1.5">
                          {requestName ? (
                            <span
                              className={`inline-flex max-w-full flex-col gap-0.5 rounded border px-2 py-1 text-xs font-medium ${getPstoResultBadgeClass(row.pstoResult)}`}
                            >
                              <span className="max-w-full overflow-visible break-all whitespace-normal [text-overflow:clip]">
                                ПСТО {requestName}
                              </span>
                              {diagramName ? (
                                <span className="max-w-full overflow-visible break-all whitespace-normal text-[11px] text-slate-500 [text-overflow:clip]">
                                  {diagramName}
                                </span>
                              ) : null}
                            </span>
                          ) : (
                            <span className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">
                              Нет заявки
                            </span>
                          )}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-200/80 px-5 py-4">
          <div className="min-h-5 text-sm text-slate-500">
            {saveBlockReason ? <span className="text-sm text-slate-500">Чтобы сохранить: {saveBlockReason}</span> : null}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Отмена
            </Button>
            <span title={saveBlockReason || 'Можно сохранить результат'}>
              <Button onClick={onSave} disabled={Boolean(saveBlockReason)} className={saveBlockReason ? 'pointer-events-none' : ''}>
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
