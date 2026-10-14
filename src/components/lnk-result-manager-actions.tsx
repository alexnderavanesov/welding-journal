import { WorkflowResultOptionPicker } from '@/components/workflow-result-option-picker'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getLnkResultRemovalBlockReason } from '@/lib/lnk-chronology-checks'
import { getLnkResultRestrictionReasons } from '@/lib/lnk-result-policy'
import { useControlProcessSettings } from '@/lib/control-process-settings'
import { useSystemIndexSettings } from '@/lib/system-index-settings'
import { getSystemRuleSettingsHref } from '@/lib/system-rule-catalog'
import { LNK_METHODS, LNK_RESULT_OPTIONS } from '@/lib/report-config'
import { useSaveCheckSettings } from '@/lib/save-check-settings'
import type { WeldFieldKey } from '@/lib/weld-fields'
import { getUnofficialLnkGoodResultReason } from '@/lib/unofficial-lnk-result-guard'

type LnkResultMethod = (typeof LNK_METHODS)[number]

type LnkResultManagerActionsProps = {
  row: WeldRow
  method: LnkResultMethod
  currentResult: string
  pendingResult: string | null
  isResultReplacementPending: boolean
  onReplaceResult: (row: WeldRow, methodKey: WeldFieldKey, result: string) => void
  onClearResult: (row: WeldRow, methodKey: WeldFieldKey) => void
}

export function LnkResultManagerActions({
  row,
  method,
  currentResult,
  pendingResult,
  isResultReplacementPending,
  onReplaceResult,
  onClearResult,
}: LnkResultManagerActionsProps) {
  const saveCheckSettings = useSaveCheckSettings()
  const processSettings = useControlProcessSettings()
  const systemIndexSettings = useSystemIndexSettings()
  const removalBlockReason = getLnkResultRemovalBlockReason(row, method.requestKey, saveCheckSettings)
  const officialityReason = getUnofficialLnkGoodResultReason(row, 'годен', currentResult, method.code)
  return (
    <div className="flex content-start flex-col items-end gap-1.5">
      <div className="flex flex-wrap justify-end gap-1.5">
        <WorkflowResultOptionPicker
          label="Изменить на:"
          compact
          value={pendingResult || currentResult}
          options={LNK_RESULT_OPTIONS}
          restrictionHelpHref={getSystemRuleSettingsHref('СП-07')}
          getDisabledReason={(option) => [
            ...getLnkResultRestrictionReasons(row, method.code, option, {
              systemIndexSettings,
              pvkGoodOnly: processSettings.pvkGoodOnly,
            }),
            getUnofficialLnkGoodResultReason(row, option, currentResult, method.code),
            isResultReplacementPending ? 'Дождитесь сохранения изменений.' : undefined,
          ].filter(Boolean).join('\n') || undefined}
          onChange={(option) => onReplaceResult(row, method.requestKey, option)}
        />
        <button
          type="button"
          onClick={() => {
            if (!removalBlockReason) onClearResult(row, method.requestKey)
          }}
          disabled={pendingResult === null || !currentResult || Boolean(removalBlockReason) || isResultReplacementPending}
          title={removalBlockReason || 'Подготовить удаление; оно будет применено только после сохранения и подтверждения.'}
          className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-800 transition-colors hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pendingResult === null ? 'Будет удалён' : 'Удалить результат'}
        </button>
      </div>
      {officialityReason && !removalBlockReason ? <p className="max-w-sm text-right text-xs leading-5 text-amber-700">{officialityReason}</p> : null}
      {removalBlockReason ? (
        <p className="max-w-sm text-right text-xs leading-5 text-amber-700">{removalBlockReason}</p>
      ) : null}
    </div>
  )
}
