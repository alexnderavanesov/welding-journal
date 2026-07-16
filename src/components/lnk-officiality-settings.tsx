import { Check } from 'lucide-react'

import { hasRejectedLnkResult } from '@/lib/lnk-status'
import type { LnkOfficialityCounters } from '@/lib/lnk-officiality-derived-utils'
import type { LnkOfficialityDraftState } from '@/lib/report-draft-state'
import type { WeldRow } from '@/lib/dispatcher-types'

type LnkOfficialityStatus = LnkOfficialityDraftState['status']

type LnkOfficialitySettingsProps = {
  status: LnkOfficialityStatus
  selectedRows: WeldRow[]
  counters: LnkOfficialityCounters
  onStatusChange: (status: LnkOfficialityStatus) => void
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

export function LnkOfficialitySettings({
  status,
  selectedRows,
  counters,
  onStatusChange,
}: LnkOfficialitySettingsProps) {
  return (
    <aside className="space-y-3">
      <section className="rounded-md border border-slate-200 bg-slate-50/60 p-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900">1. Статус</h3>
          <span className="rounded border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-800">
            ЛНК
          </span>
        </div>
        <div className="space-y-2">
          {OFFICIALITY_OPTIONS.map((option) => {
            const selected = status === option.value
            const unavailable =
              option.value === 'unofficial' &&
              selectedRows.length > 0 &&
              selectedRows.some((row) => !hasRejectedLnkResult(row))
            return (
              <button
                key={option.value}
                type="button"
                disabled={unavailable}
                onClick={() => onStatusChange(option.value)}
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
                  {unavailable
                    ? 'Доступно только для стыков с результатом "ремонт" или "вырез".'
                    : option.description}
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

      <section className="rounded-md border border-slate-200 bg-white p-3">
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Счетчики</h3>
        <div className="grid gap-2 text-sm">
          <OfficialityCounter
            label="Уже неофициальные стыки"
            value={counters.unofficial}
            className="border-slate-200 bg-slate-50 text-slate-700"
          />
          <OfficialityCounter
            label="Не годные официальные"
            value={counters.rejectedOfficial}
            className="border-rose-200 bg-rose-50 text-rose-800"
          />
        </div>
      </section>
    </aside>
  )
}

function OfficialityCounter({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <div className={`flex items-center justify-between gap-3 rounded border px-3 py-2 ${className}`}>
      <span>{label}</span>
      <span className="text-base font-semibold">{value}</span>
    </div>
  )
}
