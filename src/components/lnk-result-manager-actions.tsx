import type { WeldRow } from '@/lib/dispatcher-types'
import { getLnkRepairForbiddenReason, isLnkRepairForbidden } from '@/lib/lnk-result-rules'
import { getLnkResultBadgeClass } from '@/lib/report-badges'
import { LNK_METHODS, LNK_RESULT_OPTIONS } from '@/lib/report-config'
import type { WeldFieldKey } from '@/lib/weld-fields'

type LnkResultMethod = (typeof LNK_METHODS)[number]

type LnkResultManagerActionsProps = {
  row: WeldRow
  method: LnkResultMethod
  currentResult: string
  pendingResult: string
  isResultCorrectionPending: boolean
  isResultReplacementPending: boolean
  onReplaceResult: (row: WeldRow, methodKey: WeldFieldKey, result: string) => void
  onClearResult: (row: WeldRow, methodKey: WeldFieldKey) => void
}

export function LnkResultManagerActions({
  row,
  method,
  currentResult,
  pendingResult,
  isResultCorrectionPending,
  isResultReplacementPending,
  onReplaceResult,
  onClearResult,
}: LnkResultManagerActionsProps) {
  return (
    <div className="flex flex-wrap content-start justify-end gap-1.5">
      <span className="w-full text-right text-xs font-medium text-slate-500">Изменить на:</span>
      {LNK_RESULT_OPTIONS.map((option) => {
        const disabledByRepairRule = option === 'ремонт' && isLnkRepairForbidden(row)
        return (
          <button
            key={option}
            type="button"
            onClick={() => {
              if (!disabledByRepairRule) onReplaceResult(row, method.requestKey, option)
            }}
            disabled={disabledByRepairRule || isResultCorrectionPending || isResultReplacementPending}
            title={disabledByRepairRule ? getLnkRepairForbiddenReason(row) : undefined}
            className={`rounded border px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              disabledByRepairRule
                ? 'border-slate-200 bg-slate-50 text-slate-400'
                : (pendingResult || currentResult) === option
                  ? getLnkResultBadgeClass(option)
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {option}
          </button>
        )
      })}
      <button
        type="button"
        onClick={() => onClearResult(row, method.requestKey)}
        disabled={!currentResult || isResultCorrectionPending || isResultReplacementPending}
        className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-800 transition-colors hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        удалить результат
      </button>
    </div>
  )
}
