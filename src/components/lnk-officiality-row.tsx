import { Check } from 'lucide-react'

import {
  JointFullMeta,
  JointTitleLine,
} from '@/components/joint-meta'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getJointStatusBadgeClass, getJointStatusLabel } from '@/lib/lnk-status'

export type LnkOfficialityRowProps = {
  row: WeldRow
  selected: boolean
  onToggle: (rowId: number) => void
}

export function LnkOfficialityRow({ row, selected, onToggle }: LnkOfficialityRowProps) {
  return (
    <button
      type="button"
      onClick={() => onToggle(row.id)}
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
        <JointTitleLine row={row} className="text-sm font-semibold text-slate-900" />
        <span className="mt-1 block text-xs text-slate-500">
          <JointFullMeta row={row} />
        </span>
      </span>
      <span className={`shrink-0 rounded border px-2 py-1 text-xs font-semibold ${getJointStatusBadgeClass(row)}`}>
        {getJointStatusLabel(row)}
      </span>
    </button>
  )
}
