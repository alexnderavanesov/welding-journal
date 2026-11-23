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
import { useAccess } from '@/lib/security-context'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

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
  const { can } = useAccess()
  const saveCheckSettings = useSaveCheckSettings()
  const processSettings = useControlProcessSettings()
  const systemIndexSettings = useSystemIndexSettings()
  const removalBlockReason = !can('lnk.delete')
    ? 'Нет права удаления в ЛНК. Обратитесь к администратору.'
    : getLnkResultRemovalBlockReason(row, method.requestKey, saveCheckSettings)
  const officialityReason = getUnofficialLnkGoodResultReason(row, 'годен', currentResult, method.code)
  return (
    <div className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 lg:grid-cols-2">
      <div className="min-w-0 space-y-2">
        <WorkflowResultOptionPicker
          label="Результат выбранного стыка"
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
        {officialityReason ? <p className="text-xs leading-5 text-amber-700">{officialityReason}</p> : null}
        <p className="text-xs leading-5 text-slate-500">Выберите новый результат и нажмите «Сохранить изменения» в этом блоке.</p>
      </div>
      <div className="min-w-0 space-y-2 border-t border-slate-200 pt-4 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            if (!removalBlockReason) onClearResult(row, method.requestKey)
          }}
          disabled={pendingResult === null || !currentResult || Boolean(removalBlockReason) || isResultReplacementPending}
          title={removalBlockReason || 'Подготовить удаление; оно будет применено только после сохранения и подтверждения.'}
          className="gap-2 border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
        >
          <Trash2 className="h-3.5 w-3.5" />
          {pendingResult === null ? 'Будет удалён' : 'Удалить результат'}
        </Button>
        <p className={`text-xs leading-5 ${removalBlockReason ? 'text-amber-700' : 'text-slate-500'}`}>
          {removalBlockReason || 'После сохранения и подтверждения у этой позиции очистятся результат, дата контроля и заключение.'}
        </p>
      </div>
    </div>
  )
}
