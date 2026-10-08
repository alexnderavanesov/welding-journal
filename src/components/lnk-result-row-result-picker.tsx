import { WorkflowResultOptionPicker } from '@/components/workflow-result-option-picker'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getLnkResultRestrictionReason } from '@/lib/lnk-result-policy'
import { LNK_RESULT_OPTIONS } from '@/lib/report-config'
import { useControlProcessSettings } from '@/lib/control-process-settings'
import { useSystemIndexSettings } from '@/lib/system-index-settings'
import { getSystemRuleSettingsHref } from '@/lib/system-rule-catalog'

type LnkResultRowResultPickerProps = {
  row: WeldRow
  rowResult: string
  compact?: boolean
  methodCode: string
  layeredControlSelected?: boolean
  onSetRowResult: (rowId: number, result: string) => void
}

export function LnkResultRowResultPicker({
  row,
  rowResult,
  compact = false,
  methodCode,
  layeredControlSelected = false,
  onSetRowResult,
}: LnkResultRowResultPickerProps) {
  const settings = useControlProcessSettings()
  const systemIndexSettings = useSystemIndexSettings()
  return (
    <WorkflowResultOptionPicker
      value={rowResult}
      options={LNK_RESULT_OPTIONS}
      compact={compact}
      reserveHelpSpace={compact}
      restrictionHelpHref={getSystemRuleSettingsHref('СП-07')}
      getDisabledReason={(option) => getLnkResultRestrictionReason(row, methodCode, option, {
        systemIndexSettings,
        pvkGoodOnly: settings.pvkGoodOnly,
        layeredControlSelected,
      })}
      onChange={(option) => onSetRowResult(row.id, option)}
    />
  )
}
