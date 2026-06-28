import { ResultRowJointHeading } from '@/components/result-row-joint-heading'
import { PstoJointStatusBadge, PstoResultStatusBadge } from '@/components/psto-status-badges'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getPstoResultBadgeClass } from '@/lib/report-badges'

type PstoResultRowProps = {
  row: WeldRow
  selected: boolean
  disabled: boolean
  onToggle: (rowId: number) => void
}

export function PstoResultRow({ row, selected, disabled, onToggle }: PstoResultRowProps) {
  const requestName = String(row.pstoRequest ?? '').trim()
  const diagramName = String(row.heatTreatmentDiagram ?? '').trim()

  return (
    <div
      onClick={() => {
        if (!disabled) onToggle(row.id)
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
        onChange={() => onToggle(row.id)}
        disabled={disabled}
        className="mt-1 h-4 w-4 rounded border-slate-300 text-slate-900"
      />
      <span className="min-w-0">
        <ResultRowJointHeading row={row} />
        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
          <PstoJointStatusBadge row={row} />
          <PstoResultStatusBadge row={row} />
        </span>
        {disabled ? (
          <span className="mt-1 block text-xs leading-5 text-slate-500">
            {requestName ? 'Выберите эту заявку ПСТО, чтобы отметить стык.' : 'На этот стык еще нет заявки ПСТО.'}
          </span>
        ) : null}
      </span>
      <span className="flex flex-wrap content-start gap-1.5">
        {requestName ? (
          <span className={`inline-flex max-w-full flex-col gap-0.5 rounded border px-2 py-1 text-xs font-medium ${getPstoResultBadgeClass(row.pstoResult)}`}>
            <span className="max-w-full overflow-visible break-all whitespace-normal [text-overflow:clip]">ПСТО {requestName}</span>
            {diagramName ? (
              <span className="max-w-full overflow-visible break-all whitespace-normal text-[11px] text-slate-500 [text-overflow:clip]">
                {diagramName}
              </span>
            ) : null}
          </span>
        ) : (
          <span className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">Нет заявки</span>
        )}
      </span>
    </div>
  )
}
