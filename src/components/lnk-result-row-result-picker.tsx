import type { WeldRow } from '@/lib/dispatcher-types'
import { getLnkRepairForbiddenReason, isLnkRepairForbidden } from '@/lib/lnk-result-rules'
import { getLnkResultBadgeClass } from '@/lib/report-badges'
import { LNK_RESULT_OPTIONS } from '@/lib/report-config'

type LnkResultRowResultPickerProps = {
  row: WeldRow
  rowResult: string
  onSetRowResult: (rowId: number, result: string) => void
}

export function LnkResultRowResultPicker({
  row,
  rowResult,
  onSetRowResult,
}: LnkResultRowResultPickerProps) {
  return (
    <span className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs font-medium text-slate-500">Результат:</span>
      {LNK_RESULT_OPTIONS.map((option) => {
        const active = rowResult === option
        const disabledByRepairRule = option === 'ремонт' && isLnkRepairForbidden(row)
        return (
          <button
            key={option}
            type="button"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              if (disabledByRepairRule) return
              onSetRowResult(row.id, option)
            }}
            disabled={disabledByRepairRule}
            title={disabledByRepairRule ? getLnkRepairForbiddenReason(row) : undefined}
            className={`rounded border px-2 py-1 text-xs font-medium transition-colors ${
              disabledByRepairRule
                ? 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400'
                : active
                  ? getLnkResultBadgeClass(option)
                  : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
            }`}
          >
            {option}
          </button>
        )
      })}
    </span>
  )
}
