import type { Dispatch, SetStateAction } from 'react'
import { Check, X } from 'lucide-react'

import {
  JointProjectSubtitleMeta,
  JointSpoolDiameterMeta,
  JointWeldDateMeta,
  MetaSeparator,
  OfficialityBadge,
} from '@/components/joint-meta'
import { Button } from '@/components/ui/button'
import { getJointStatusBadgeClass, getJointStatusLabel, hasRejectedLnkResult } from '@/lib/lnk-status'
import type { LnkOfficialityDraftState } from '@/lib/report-draft-state'
import { getJointTitle } from '@/lib/report-ui-state'
import type { WeldRow } from '@/lib/dispatcher-types'

export type LnkOfficialityDialogProps = {
  draft: LnkOfficialityDraftState
  filteredRows: WeldRow[]
  selectedRows: WeldRow[]
  saveBlockReason: string | null
  isSaveDisabled: boolean
  onClose: () => void
  onSave: () => void
  onDraftChange: Dispatch<SetStateAction<LnkOfficialityDraftState>>
  onToggleRow: (rowId: number) => void
  onSetVisibleRowsSelected: (selected: boolean) => void
}

const OFFICIALITY_OPTIONS = [
  {
    value: 'official' as const,
    title: 'Официальный',
    description: 'Рабочий статус по умолчанию. В таблице поле остается пустым.',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  },
  {
    value: 'unofficial' as const,
    title: 'Неофициальный',
    description: 'Помечает стык как неофициальный для будущих правил и фильтров.',
    className: 'border-slate-300 bg-slate-100 text-slate-800',
  },
]

export function LnkOfficialityDialog({
  draft,
  filteredRows,
  selectedRows,
  saveBlockReason,
  isSaveDisabled,
  onClose,
  onSave,
  onDraftChange,
  onToggleRow,
  onSetVisibleRowsSelected,
}: LnkOfficialityDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/20 px-4 backdrop-blur-[1px]">
      <div className="flex h-[86vh] w-full max-w-[1180px] flex-col rounded-md border border-slate-200 bg-white shadow-2xl shadow-slate-950/10">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">Официальность стыков</h2>
            <p className="text-sm text-muted-foreground">Выбрано: {draft.rowIds.size}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Закрыть">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-hidden px-6 py-5 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="space-y-3">
            <section className="rounded-md border border-slate-200 bg-slate-50/60 p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900">1. Статус</h3>
                <span className="rounded border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-800">ЛНК</span>
              </div>
              <div className="space-y-2">
                {OFFICIALITY_OPTIONS.map((option) => {
                  const selected = draft.status === option.value
                  const unavailable =
                    option.value === 'unofficial' &&
                    selectedRows.length > 0 &&
                    selectedRows.some((row) => !hasRejectedLnkResult(row))
                  return (
                    <button
                      key={option.value}
                      type="button"
                      disabled={unavailable}
                      onClick={() => onDraftChange((current) => ({ ...current, status: option.value }))}
                      className={`w-full rounded-md border p-3 text-left transition-colors ${
                        unavailable
                          ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                          : selected
                            ? option.className
                            : 'border-slate-200 bg-white text-slate-700 hover:border-sky-200 hover:bg-sky-50'
                      }`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold">{option.title}</span>
                        {selected ? <Check className="h-4 w-4" /> : null}
                      </span>
                      <span className="mt-1 block text-xs leading-5 opacity-80">
                        {unavailable ? 'Доступно только для стыков с результатом "ремонт" или "вырез".' : option.description}
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>

            <section className="rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-600">
              <h3 className="mb-2 text-sm font-semibold text-slate-900">2. Что изменится</h3>
              <p className="leading-6">
                Изменяется только поле <span className="font-semibold text-slate-800">Статус</span>. Заявки, результаты,
                заключения и даты не затрагиваются.
              </p>
            </section>
          </aside>

          <section className="flex min-h-0 flex-col">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Стыки</h3>
                <p className="text-xs text-muted-foreground">Поиск по проекту, шифру, линии, спулу или номеру стыка.</p>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => onSetVisibleRowsSelected(true)} disabled={filteredRows.length === 0}>
                  Выбрать найденные
                </Button>
                <Button type="button" variant="outline" onClick={() => onSetVisibleRowsSelected(false)} disabled={draft.rowIds.size === 0}>
                  Снять выбор
                </Button>
              </div>
            </div>

            <div className="mb-3 flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
              <input
                value={draft.search}
                onChange={(event) => onDraftChange((current) => ({ ...current, search: event.target.value }))}
                placeholder="Проект, шифр, линия, спул или стык"
                className="h-10 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
              />
              <span className="shrink-0 text-xs text-slate-500">
                Найдено: {filteredRows.length} · Выбрано: {draft.rowIds.size}
              </span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-slate-200">
              {filteredRows.length === 0 ? (
                <div className="flex min-h-60 items-center justify-center px-4 py-10 text-center text-sm text-slate-500">
                  По фильтру ничего не найдено.
                </div>
              ) : (
                filteredRows.map((row) => {
                  const selected = draft.rowIds.has(row.id)
                  return (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => onToggleRow(row.id)}
                      className={`flex w-full items-start gap-3 border-b border-slate-100 px-4 py-3 text-left transition-colors last:border-b-0 ${
                        selected ? 'bg-sky-50 ring-1 ring-inset ring-sky-200' : 'bg-white hover:bg-slate-50'
                      }`}
                    >
                      <span
                        className={`mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          selected ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white'
                        }`}
                      >
                        {selected ? <Check className="h-3 w-3" /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                          <span className="text-sm font-semibold text-slate-900">{getJointTitle(row)}</span>
                          <OfficialityBadge row={row} compact />
                        </span>
                        <span className="mt-1 block text-xs text-slate-500">
                          <JointProjectSubtitleMeta row={row} />
                          <MetaSeparator />
                          <JointSpoolDiameterMeta row={row} />
                          <MetaSeparator />
                          <JointWeldDateMeta row={row} />
                        </span>
                      </span>
                      <span className={`shrink-0 rounded border px-2 py-1 text-xs font-semibold ${getJointStatusBadgeClass(row)}`}>
                        {getJointStatusLabel(row)}
                      </span>
                    </button>
                  )
                })
              )}
            </div>
          </section>
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-slate-200/80 px-6 py-4">
          <div className="text-sm text-slate-500">
            {saveBlockReason ? saveBlockReason : `Будет обновлено стыков: ${selectedRows.length}`}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Отмена
            </Button>
            <Button onClick={onSave} disabled={isSaveDisabled}>
              <Check className="mr-2 h-4 w-4" />
              Сохранить статус
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
