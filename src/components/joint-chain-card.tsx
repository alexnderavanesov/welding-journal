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
  onSelect?: (row: WeldRow) => void
}

export function JointChainCard({ row, index, isCurrent, onOpenRow, onSelect }: JointChainCardProps) {
  const resultItems = getJointChainResultItems(row)
  const pstoTvmtItems = resultItems.filter((item) => item.stage === 'pstoTvmt')
  const mainLnkItems = resultItems.filter((item) => item.stage === 'mainLnk')
  const duplicateItems = resultItems.filter((item) => item.stage === 'duplicate')
  const jointName = String(row.joint ?? '-')

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect?.(row)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onSelect?.(row)
      }}
      className={`rounded-md border px-3 py-2.5 transition-colors ${
        isCurrent ? 'border-sky-300 bg-sky-50/70 shadow-sm shadow-sky-100' : 'border-slate-200 bg-white hover:border-slate-300'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-slate-100 px-2 text-xs font-semibold text-slate-600">
          {index + 1}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">{jointName}</span>
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

      <div className="mt-1 truncate text-xs text-slate-500" title={getJointTitle(row)}>{getJointTitle(row)}</div>
      <div className="mt-1 text-xs text-slate-500"><JointSpoolDateMeta row={row} /></div>

      <div className="mt-3 space-y-2.5">
        {pstoTvmtItems.length > 0 ? (
          <ChainStatusGroup title="ПСТО и ТВМТ" items={pstoTvmtItems} />
        ) : null}
        {mainLnkItems.length > 0 ? (
          <ChainStatusGroup title="Основной этап НК" items={mainLnkItems} />
        ) : null}
        {duplicateItems.length > 0 ? (
          <ChainStatusGroup title="Дубль-контроль" items={duplicateItems} />
        ) : null}
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase leading-4 text-slate-400">Итог по стыку</div>
          <span className={`rounded border px-1.5 py-0.5 text-xs font-semibold ${getJointStatusBadgeClass(row)}`}>
            {getJointStatusDisplayLabel(row)}
          </span>
        </div>
      </div>
    </div>
  )
}

function ChainStatusGroup({
  title,
  items,
}: {
  title: string
  items: ReturnType<typeof getJointChainResultItems>
}) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase leading-4 text-slate-400">{title}</div>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {items.map((item) => (
          <span
            key={`${item.stage}:${item.label}:${item.value}`}
            className={`max-w-full break-words rounded border px-1.5 py-0.5 text-xs font-semibold leading-4 ${item.className}`}
          >
            {item.label}: {item.value}
          </span>
        ))}
      </div>
    </div>
  )
}
