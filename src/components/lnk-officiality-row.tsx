import { memo } from 'react'
import { Check } from 'lucide-react'

import { ManagerRowJointHeading } from '@/components/manager-row-joint-heading'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getJointStatusBadgeClass, getJointStatusLabel, hasRejectedLnkResult } from '@/lib/lnk-status'
import { isUnofficialJoint } from '@/lib/joint-display'

export type LnkOfficialityRowProps = {
  row: WeldRow
  selected: boolean
  onToggle: (rowId: number) => void
}

function LnkOfficialityRowComponent({ row, selected, onToggle }: LnkOfficialityRowProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onToggle(row.id)}
      className={`grid w-full grid-cols-[16px_minmax(0,1fr)] items-start gap-x-3 gap-y-2 px-4 py-3 text-left transition-colors sm:grid-cols-[16px_minmax(0,1fr)_auto] ${
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
        <ManagerRowJointHeading
          row={row}
          titleClassName="text-sm font-semibold text-slate-900"
          metaClassName="mt-1 block text-xs text-slate-500"
          metaElement="span"
        />
        {isUnofficialJoint(row) && !hasRejectedLnkResult(row) ? (
          <span className="mt-2 block text-xs leading-5 text-amber-800">
            Неофициальный стык без негодного результата. Проверьте историю и официальность.
          </span>
        ) : null}
      </span>
      <span className={`col-start-2 justify-self-start rounded border px-2 py-1 text-xs font-semibold sm:col-start-3 sm:row-start-1 ${getJointStatusBadgeClass(row)}`}>
        {getJointStatusLabel(row)}
      </span>
    </button>
  )
}

export const LnkOfficialityRow = memo(LnkOfficialityRowComponent, (previous, next) => (
  previous.row === next.row &&
  previous.selected === next.selected &&
  previous.onToggle === next.onToggle
))
