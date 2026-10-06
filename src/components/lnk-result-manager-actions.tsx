import type { WeldRow } from '@/lib/dispatcher-types'
import { getLnkResultRemovalBlockReason } from '@/lib/lnk-chronology-checks'
import { getLnkRepairForbiddenReason, isLnkRepairForbidden } from '@/lib/lnk-result-rules'
import { getLnkResultBadgeClass } from '@/lib/report-badges'
import { LNK_METHODS, LNK_RESULT_OPTIONS } from '@/lib/report-config'
import { useSaveCheckSettings } from '@/lib/save-check-settings'
import type { WeldFieldKey } from '@/lib/weld-fields'
import { getUnofficialLnkGoodResultReason } from '@/lib/unofficial-lnk-result-guard'

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
  const saveCheckSettings = useSaveCheckSettings()
  const removalBlockReason = getLnkResultRemovalBlockReason(row, method.requestKey, saveCheckSettings)
  const officialityReason = getUnofficialLnkGoodResultReason(row, 'годен', currentResult, method.code)
  return (
    <div className="flex content-start flex-col items-end gap-1.5">
      <div className="flex flex-wrap justify-end gap-1.5">
        <span className="w-full text-right text-xs font-medium text-slate-500">Изменить на:</span>
        {LNK_RESULT_OPTIONS.map((option) => {
          const disabledByRepairRule = saveCheckSettings.lnkResultRepairRules && option === 'ремонт' && isLnkRepairForbidden(row)
          const blockReason = getUnofficialLnkGoodResultReason(row, option, currentResult, method.code) ||
            (disabledByRepairRule ? getLnkRepairForbiddenReason(row) : null)
          return (
            <button
              key={option}
              type="button"
              onClick={() => {
                if (!blockReason) onReplaceResult(row, method.requestKey, option)
              }}
              disabled={Boolean(blockReason) || isResultCorrectionPending || isResultReplacementPending}
              title={blockReason ?? undefined}
              className={`rounded border px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                blockReason
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
          onClick={() => {
            if (!removalBlockReason) onClearResult(row, method.requestKey)
          }}
          disabled={!currentResult || Boolean(removalBlockReason) || isResultCorrectionPending || isResultReplacementPending}
          title={removalBlockReason || undefined}
          className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-800 transition-colors hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Удалить результат
        </button>
      </div>
      {officialityReason ? <p className="max-w-sm text-right text-xs leading-5 text-amber-700">{officialityReason}</p> : null}
      {removalBlockReason ? (
        <p className="max-w-sm text-right text-xs leading-5 text-amber-700">{removalBlockReason}</p>
      ) : null}
    </div>
  )
}
