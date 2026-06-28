import type { WeldDraft } from '@/lib/dispatcher-types'
import { hasReservedJointSystemPart, normalizeJointName, validateManualJointName } from '@/lib/joint-name'
import { FIELD_BY_KEY, type WeldFieldKey, type WeldInput } from '@/lib/weld-fields'
import { factualWelderStampFieldKeys } from '@/lib/weld-form-field-sets'
import type { StampSelectOption, StampSelectOptions } from '@/lib/weld-form-types'
import { getStampSelectValue } from '@/lib/weld-form-value-utils'

export function getWeldFormSaveBlockReason(draft: WeldInput, initialValue: WeldDraft) {
  if (isFutureWeldDate(draft.weldDate)) {
    return 'дата сварки не может быть позже сегодняшней.'
  }

  const currentJoint = normalizeJointName(draft.joint)
  const initialJoint = normalizeJointName(initialValue.joint)
  if (initialValue.id && currentJoint === initialJoint) return null

  if (initialValue.id && hasReservedJointSystemPart(initialValue.joint)) {
    return 'стык с системными индексами R/W/Y нельзя переименовывать вручную. Используйте подсказки диспетчера задач.'
  }

  return validateManualJointName(draft.joint)
}

export function getWeldStampSaveBlockReason(
  draft: WeldInput,
  stampSelectOptions: StampSelectOptions | undefined,
) {
  if (!stampSelectOptions) return null

  for (const [fieldKey, options] of Object.entries(stampSelectOptions) as Array<[WeldFieldKey, readonly StampSelectOption[]]>) {
    if (factualWelderStampFieldKeys.has(fieldKey)) continue

    const value = getStampSelectValue(draft[fieldKey])
    if (!value) continue

    const selectedOption = options.find((option) => option.value.trim() === value)
    if (!selectedOption) {
      return `${FIELD_BY_KEY.get(fieldKey)?.label ?? 'поле клейма'} должно быть выбрано из активного реестра клейм.`
    }
    if (selectedOption.disabled) {
      const reason = selectedOption.reason ? `: ${selectedOption.reason}` : ''
      return `${FIELD_BY_KEY.get(fieldKey)?.label ?? 'поле клейма'} не подходит по реестру клейм${reason}.`
    }
  }

  return null
}

function isFutureWeldDate(value: unknown) {
  const date = String(value ?? '').trim()
  if (!date) return false
  return date > getTodayIsoDate()
}

function getTodayIsoDate() {
  const date = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
