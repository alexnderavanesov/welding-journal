import { X } from 'lucide-react'
import {
  JointProjectSubtitleMeta,
  JointSpoolDiameterMeta,
  JointWeldDateMeta,
  MetaSeparator,
  OfficialityBadge,
} from '@/components/joint-meta'
import { Button } from '@/components/ui/button'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getEffectiveLnkResultDraftValueForRow, type LnkResultDraftLike } from '@/lib/lnk-result-draft'
import { getLnkMethodByRequestKey } from '@/lib/lnk-status'
import { getLnkResultBadgeClass } from '@/lib/report-badges'
import { getJointTitle } from '@/lib/report-ui-state'

type LnkResultPreviewDialogProps = {
  rows: WeldRow[]
  draft: LnkResultDraftLike
  onClose: () => void
}

export function LnkResultPreviewDialog({ rows, draft, onClose }: LnkResultPreviewDialogProps) {
  const method = getLnkMethodByRequestKey(draft.methodKey)

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-slate-950/25 px-4 backdrop-blur-[1px]">
      <div className="flex max-h-[86vh] w-full max-w-4xl flex-col rounded-md border border-slate-200 bg-white shadow-2xl shadow-slate-950/20">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">Предпросмотр выбранных стыков</h2>
            <p className="text-sm text-muted-foreground">
              Метод: {method?.code || '-'} · Выбрано: {rows.length}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Закрыть предпросмотр">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-5">
          {rows.length === 0 ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
              Нет выбранных стыков.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 rounded-md border border-slate-200">
              {rows.map((row) => {
                const currentResult = method ? String(row[method.resultKey] ?? '').trim() || 'заявка' : '-'
                const requestName = method ? String(row[method.requestKey] ?? '').trim() : ''
                const result = getEffectiveLnkResultDraftValueForRow(row, draft)
                return (
                  <div key={row.id} className="grid grid-cols-[minmax(320px,1fr)_minmax(220px,0.45fr)] gap-4 px-4 py-3 text-sm">
                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <span className="font-medium text-slate-900">{getJointTitle(row)}</span>
                        <OfficialityBadge row={row} compact />
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        <JointProjectSubtitleMeta row={row} />
                        <MetaSeparator />
                        <JointSpoolDiameterMeta row={row} />
                        <MetaSeparator />
                        <JointWeldDateMeta row={row} />
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                        <span className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-bold text-slate-700">
                          {method?.code || '-'}
                        </span>
                        {requestName ? (
                          <span className="rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 font-medium text-sky-800">
                            {requestName}
                          </span>
                        ) : null}
                        <span className={`rounded border px-1.5 py-0.5 font-semibold ${getLnkResultBadgeClass(currentResult)}`}>
                          Сейчас: {currentResult}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end justify-start gap-1.5">
                      <span className="text-xs font-medium text-slate-500">Будет записано:</span>
                      <span className={`rounded border px-2 py-1 text-xs font-semibold ${getLnkResultBadgeClass(result)}`}>
                        {result || '-'}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200/80 px-5 py-4">
          <Button variant="outline" onClick={onClose}>
            Закрыть
          </Button>
        </div>
      </div>
    </div>
  )
}
