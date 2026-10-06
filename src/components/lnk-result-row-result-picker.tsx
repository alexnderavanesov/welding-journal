import { WorkflowResultOptionPicker } from '@/components/workflow-result-option-picker'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getLnkRepairForbiddenReason, isLnkRepairForbidden } from '@/lib/lnk-result-rules'
import { LNK_RESULT_OPTIONS } from '@/lib/report-config'
import type { SaveCheckSettings } from '@/lib/save-check-settings'
import { useControlProcessSettings } from '@/lib/control-process-settings'

type LnkResultRowResultPickerProps = {
  row: WeldRow
  rowResult: string
  saveCheckSettings: SaveCheckSettings
  compact?: boolean
  methodCode?: string
  layeredControlSelected?: boolean
  onSetRowResult: (rowId: number, result: string) => void
}

export function LnkResultRowResultPicker({
  row,
  rowResult,
  saveCheckSettings,
  compact = false,
  methodCode,
  layeredControlSelected = false,
  onSetRowResult,
}: LnkResultRowResultPickerProps) {
  const settings = useControlProcessSettings()
  return (
    <WorkflowResultOptionPicker
      value={rowResult}
      options={LNK_RESULT_OPTIONS}
      compact={compact}
      getDisabledReason={(option) => (
        ['ремонт', 'вырез'].includes(option) && (((row.layeredControlAssigned || layeredControlSelected) && methodCode !== 'ТВМТ') || (methodCode === 'ПВК' && settings.pvkGoodOnly))
          ? row.layeredControlAssigned || layeredControlSelected ? 'Выбран послойный контроль' : 'Включено «ПВК — только годен»'
          : saveCheckSettings.lnkResultRepairRules && option === 'ремонт' && isLnkRepairForbidden(row)
          ? getLnkRepairForbiddenReason(row)
          : undefined
      )}
      onChange={(option) => onSetRowResult(row.id, option)}
    />
  )
}
