import { Trash2 } from 'lucide-react'

import {
  JointProjectSubtitleMeta,
  JointSpoolDiameterMeta,
  JointWeldDateMeta,
  MetaSeparator,
  OfficialityBadge,
} from '@/components/joint-meta'
import type { WeldRow } from '@/lib/dispatcher-types'
import { LNK_METHODS } from '@/lib/report-config'
import { getJointTitle } from '@/lib/report-ui-state'

type LnkRequestMethod = (typeof LNK_METHODS)[number]

type LnkRequestManagerPositionProps = {
  row: WeldRow
  methods: LnkRequestMethod[]
  isCorrectionPending: boolean
  onClearPosition: (row: WeldRow, requestKey: LnkRequestMethod['requestKey']) => void
}

export function LnkRequestManagerPosition({
  row,
  methods,
  isCorrectionPending,
  onClearPosition,
}: LnkRequestManagerPositionProps) {
  return (
    <div className="grid grid-cols-[minmax(220px,1fr)_minmax(220px,1.2fr)] gap-3 px-3 py-2.5 text-sm">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="truncate font-medium text-slate-900">{getJointTitle(row)}</span>
          <OfficialityBadge row={row} compact />
        </div>
        <div className="text-xs leading-5 text-slate-500">
          <JointProjectSubtitleMeta row={row} />
          <MetaSeparator />
          <JointSpoolDiameterMeta row={row} />
          <MetaSeparator />
          <JointWeldDateMeta row={row} />
        </div>
      </div>
      <div className="flex flex-wrap justify-end gap-1.5">
        {methods.map((method) => (
          <button
            key={method.requestKey}
            type="button"
            onClick={() => onClearPosition(row, method.requestKey)}
            disabled={isCorrectionPending}
            className="inline-flex items-center gap-1.5 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-800 transition-colors hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
            title={`Очистить ${method.code} только для этого стыка`}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {method.code}
          </button>
        ))}
      </div>
    </div>
  )
}
