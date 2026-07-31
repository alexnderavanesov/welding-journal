import { ExternalLink } from 'lucide-react'

import { JointSpoolDateMeta, OfficialityBadge } from '@/components/joint-meta'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getJointChainResultItems, getJointStatusBadgeClass, getJointStatusDisplayLabel } from '@/lib/lnk-status'
import { getJointTitle } from '@/lib/report-ui-state'

export type JointChainCardProps = {
  row: WeldRow
  index: number
  isCurrent: boolean
  onOpenRow: (row: WeldRow) => void
}

export function JointChainCard({ row, index, isCurrent, onOpenRow }: JointChainCardProps) {
  const resultItems = getJointChainResultItems(row)
  const jointName = String(row.joint ?? '-')

  return (
    <div
      className={`rounded-md border px-4 py-3 ${
        isCurrent ? 'border-sky-200 bg-sky-50/70 shadow-sm shadow-sky-100' : 'border-slate-200 bg-white'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-slate-100 px-2 text-xs font-semibold text-slate-600">
          {index + 1}
        </span>
        <span className="text-base font-semibold text-slate-900">{jointName}</span>
        <button
          type="button"
          onClick={() => onOpenRow(row)}
          className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700"
          title="Открыть только этот стык в текущем отчете"
          aria-label={`Открыть стык ${jointName} в текущем отчете`}
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

      <div className="mt-2 grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(260px,auto)]">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-slate-200/90 bg-white/75 px-3 py-2 text-xs text-slate-500">
          <span>
            <JointSpoolDateMeta row={row} />
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span>Статус:</span>
            <span className={`rounded border px-1.5 py-0.5 font-semibold ${getJointStatusBadgeClass(row)}`}>
              {getJointStatusDisplayLabel(row)}
            </span>
          </span>
        </div>

        <div className="rounded-md border border-slate-200/90 bg-white/75 px-3 py-2">
          <div className="mb-1.5 text-[10px] font-semibold uppercase text-slate-400">Контроль</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {resultItems.length > 0 ? (
              resultItems.map((item) => (
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
    </div>
  )
}
