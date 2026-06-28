import { RequestRowJointHeading } from '@/components/request-row-joint-heading'
import { PstoJointStatusBadge, PstoResultStatusBadge } from '@/components/psto-status-badges'
import type { WeldRow } from '@/lib/dispatcher-types'

type PstoRequestRowProps = {
  row: WeldRow
  selected: boolean
  disabled: boolean
  onToggleRow: (rowId: number) => void
}

export function PstoRequestRow({ row, selected, disabled, onToggleRow }: PstoRequestRowProps) {
  return (
    <label
      className={`grid grid-cols-[28px_minmax(220px,1fr)_minmax(180px,0.8fr)] items-center gap-3 px-4 py-3 text-sm transition-colors ${
        disabled
          ? 'cursor-not-allowed bg-slate-100 text-slate-400'
          : selected
            ? 'cursor-pointer bg-sky-50/80'
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
        <RequestRowJointHeading row={row} />
        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
          <PstoJointStatusBadge row={row} />
          <PstoResultStatusBadge row={row} />
        </span>
      </span>
      <span className="flex flex-wrap gap-1.5">
        {disabled ? (
          <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-500">
            {String(row.pstoRequest ?? '').trim() || 'Заявка уже создана'}
          </span>
        ) : (
          <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-600">
            ПСТО
          </span>
        )}
      </span>
    </label>
  )
}
