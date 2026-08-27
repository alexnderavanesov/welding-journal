import type { WeldRow } from '@/lib/dispatcher-types'
import { getLnkRepairForbiddenReason, isLnkRepairForbidden } from '@/lib/lnk-result-rules'
import { getLnkResultBadgeClass } from '@/lib/report-badges'
import { LNK_RESULT_OPTIONS } from '@/lib/report-config'
import type { SaveCheckSettings } from '@/lib/save-check-settings'

type LnkResultRowResultPickerProps = {
  row: WeldRow
  rowResult: string
  saveCheckSettings: SaveCheckSettings
  compact?: boolean
  onSetRowResult: (rowId: number, result: string) => void
}

export function LnkResultRowResultPicker({
  row,
  rowResult,
  saveCheckSettings,
  compact = false,
  onSetRowResult,
}: LnkResultRowResultPickerProps) {
  return (
    <span className={compact ? 'flex min-w-0 flex-col gap-1' : 'mt-2 flex flex-wrap items-center gap-1.5'}>
      <span className="text-[11px] font-medium text-slate-500">Результат</span>
      <span className="flex items-center gap-1">
        {LNK_RESULT_OPTIONS.map((option) => {
        const active = rowResult === option
        const disabledByRepairRule = saveCheckSettings.lnkResultRepairRules && option === 'ремонт' && isLnkRepairForbidden(row)
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
    </span>
  )
}
