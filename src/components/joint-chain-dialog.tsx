import { ExternalLink, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { OfficialityBadge } from '@/components/joint-meta'
import type { WeldRow } from '@/lib/dispatcher-types'
import { formatDisplayDate } from '@/lib/date-format'
import {
  getJointChainResultItems,
  getJointStatusBadgeClass,
  getJointStatusLabel,
} from '@/lib/lnk-status'
import { getJointChainSubtitle } from '@/lib/joint-display'
import { getJointTitle } from '@/lib/report-ui-state'

type JointChainDialogProps = {
  record: WeldRow
  rows: WeldRow[]
  onClose: () => void
  onOpenBase: (row: WeldRow) => void
  onOpenRow: (row: WeldRow) => void
}

export function JointChainDialog({ record, rows, onClose, onOpenBase, onOpenRow }: JointChainDialogProps) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/25 px-4 backdrop-blur-[1px]">
      <div className="flex max-h-[82vh] w-full max-w-4xl flex-col rounded-lg border border-slate-200 bg-white shadow-2xl shadow-slate-950/15">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-slate-900">Цепочка стыка {String(record.joint ?? '-')}</h2>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onOpenBase(record)}
                className="h-7 border-sky-200 bg-sky-50 px-2.5 text-xs font-semibold text-sky-800 hover:bg-sky-100"
              >
                Показать всю цепочку
              </Button>
            </div>
            <p className="mt-1 text-sm text-slate-500">{getJointChainSubtitle(record)}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Закрыть цепочку стыка">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {rows.length === 0 ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
              По этому стыку цепочка не найдена.
            </div>
          ) : (
            <div className="space-y-2">
              {rows.map((row, index) => {
                const isCurrent = row.id === record.id
                return (
                  <div
                    key={row.id}
                    className={`rounded-md border px-4 py-3 ${
                      isCurrent ? 'border-sky-200 bg-sky-50/70 shadow-sm shadow-sky-100' : 'border-slate-200 bg-white'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-slate-100 px-2 text-xs font-semibold text-slate-600">
                            {index + 1}
                          </span>
                          <span className="text-base font-semibold text-slate-900">{String(row.joint ?? '-')}</span>
                          <button
                            type="button"
                            onClick={() => onOpenRow(row)}
                            className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700"
                            title="Открыть только этот стык в текущем отчете"
                            aria-label={`Открыть стык ${String(row.joint ?? '-')} в текущем отчете`}
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </button>
                          {isCurrent ? (
                            <span className="rounded border border-sky-200 bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-800">
                              текущий
                            </span>
                          ) : null}
                          <OfficialityBadge row={row} />
                        </div>
                        <div className="mt-1 text-sm text-slate-600">{getJointTitle(row)}</div>
                        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                          <span>
                            Дата сварки:{' '}
                            <span className="font-semibold text-slate-700">{formatDisplayDate(row.weldDate) || '-'}</span>
                          </span>
                          <span>
                            Статус:{' '}
                            <span className={`rounded border px-1.5 py-0.5 font-semibold ${getJointStatusBadgeClass(row)}`}>
                              {getJointStatusLabel(row)}
                            </span>
                          </span>
                        </div>
                      </div>

                      <div className="flex max-w-[420px] flex-wrap justify-end gap-1.5">
                        {getJointChainResultItems(row).length > 0 ? (
                          getJointChainResultItems(row).map((item) => (
                            <span
                              key={`${row.id}:${item.label}:${item.value}`}
                              className={`rounded border px-2 py-1 text-xs font-semibold ${item.className}`}
                            >
                              {item.label} {item.value}
                            </span>
                          ))
                        ) : (
                          <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-500">
                            результатов пока нет
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="flex justify-end border-t border-slate-200 px-5 py-4">
          <Button variant="outline" onClick={onClose}>
            Закрыть
          </Button>
        </div>
      </div>
    </div>
  )
}
