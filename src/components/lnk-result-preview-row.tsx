import {
  JointProjectSubtitleMeta,
  JointSpoolDiameterMeta,
  JointWeldDateMeta,
  MetaSeparator,
  OfficialityBadge,
} from '@/components/joint-meta'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getEffectiveLnkResultDraftValueForRow, type LnkResultDraftLike } from '@/lib/lnk-result-draft'
import type { LnkMethod } from '@/lib/lnk-status'
import { getLnkResultBadgeClass } from '@/lib/report-badges'
import { getJointTitle } from '@/lib/report-ui-state'

type LnkResultPreviewRowProps = {
  row: WeldRow
  method: LnkMethod | undefined
  draft: LnkResultDraftLike
}

export function LnkResultPreviewRow({ row, method, draft }: LnkResultPreviewRowProps) {
  const currentResult = method ? String(row[method.resultKey] ?? '').trim() || 'заявка' : '-'
  const requestName = method ? String(row[method.requestKey] ?? '').trim() : ''
  const result = getEffectiveLnkResultDraftValueForRow(row, draft)

  return (
    <div className="grid grid-cols-[minmax(320px,1fr)_minmax(220px,0.45fr)] gap-4 px-4 py-3 text-sm">
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
}
