import type { WeldDraft } from '@/lib/dispatcher-types'
import { getDateInputValidationReason } from '@/lib/date-format'
import { hasReservedJointSystemPart, normalizeJointName, validateManualJointName } from '@/lib/joint-name'
import { getSystemIndexSummaryText } from '@/lib/system-index-settings'
import { LNK_METHODS } from '@/lib/lnk-report-config'
import {
  getCancelledLnkResultDisplay,
  getCancelledPstoResultDisplay,
  hasRealLnkResultValue,
  hasText,
} from '@/lib/report-value-utils'
import { FIELD_BY_KEY, type WeldFieldKey, type WeldInput } from '@/lib/weld-fields'
import { factualWelderStampFieldKeys } from '@/lib/weld-form-field-sets'
import type { StampSelectOption, StampSelectOptions } from '@/lib/weld-form-types'
import { getStampSelectValue, isAdditionalValue, isCancelledValue, isYesValue } from '@/lib/weld-form-value-utils'

export function getWeldFormSaveBlockReason(draft: WeldInput, initialValue: WeldDraft) {
  const dateReason = getWeldFormDateSaveBlockReason(draft)
  if (dateReason) return dateReason

  const reportHistoryReason = getControlAvailabilityReportHistoryReason(draft)
  if (reportHistoryReason) return reportHistoryReason

  const currentJoint = normalizeJointName(draft.joint)
  const initialJoint = normalizeJointName(initialValue.joint)
  if (initialValue.id && currentJoint === initialJoint) return null

  if (initialValue.id && hasReservedJointSystemPart(initialValue.joint)) {
    return `стык с системными индексами ${getSystemIndexSummaryText()} нельзя переименовывать вручную. Используйте подсказки диспетчера задач.`
  }

  return validateManualJointName(draft.joint)
}

function getControlAvailabilityReportHistoryReason(draft: WeldInput) {
  for (const method of LNK_METHODS) {
    if (isActiveControlAvailability(draft[method.enabledKey])) continue
    if (!hasRealLnkReportHistory(draft, method)) continue

    return `${method.code}: выберите «отменен» либо очистите/удалите результат НК в отчете ЛНК.`
  }

  if (
    !isActiveControlAvailability(draft.pstoRequired) &&
    hasRealPstoReportHistory(draft)
  ) {
    return 'ПСТО: выберите «отменен» либо очистите/удалите результат ПСТО.'
  }

  return null
}

export function getWeldFormAutoClearHint(draft: WeldInput, initialValue: WeldDraft) {
  const hints: string[] = []

  for (const method of LNK_METHODS) {
    if (!hasControlAvailabilityChanged(draft[method.enabledKey], initialValue[method.enabledKey])) continue
    if (isYesValue(draft[method.enabledKey])) continue
    if (!hasText(draft[method.requestKey])) continue
    if (hasRealLnkReportHistory(draft, method)) continue

    hints.push(`${method.code}: заявка на стык будет удалена`)
  }

  if (
    hasControlAvailabilityChanged(draft.pstoRequired, initialValue.pstoRequired) &&
    !isYesValue(draft.pstoRequired) &&
    (hasText(draft.pstoRequest) || hasText(draft.pstoDate)) &&
    !hasRealPstoReportHistory(draft)
  ) {
    hints.push(hasText(draft.pstoDate) ? 'ПСТО: заявка и дата на стык будут удалены' : 'ПСТО: заявка на стык будет удалена')
  }

  return hints.length ? hints.join('; ') : null
}

export function getWeldFormCancellationResultHint(draft: WeldInput, initialValue: WeldDraft) {
  const hints: string[] = []

  for (const method of LNK_METHODS) {
    if (!isCancelledValue(draft[method.enabledKey])) continue
    if (isCancelledValue(initialValue[method.enabledKey])) continue

    const result = getNormalizedResult(draft[method.resultKey])
    if (result === 'годен' || result === 'годен (отменен)' || result === 'да') {
      hints.push(`${method.code}: результат уже внесен, статус будет «годен (отменен)»`)
    } else if (result === 'ремонт' || result === 'вырез') {
      hints.push(`${method.code}: результат уже внесен (${result}), статус будет «отменен», заявка, дата и заключение будут аннулированы`)
    }
  }

  if (isCancelledValue(draft.pstoRequired)) {
    if (isCancelledValue(initialValue.pstoRequired)) return hints.length ? hints.join('; ') : null

    const pstoResult = getNormalizedResult(draft.pstoResult)
    if (pstoResult === 'проведено' || pstoResult === 'проведено (отменен)' || pstoResult === 'да') {
      hints.push('ПСТО: результат уже внесен, статус будет «проведено (отменен)»')
    }
  }

  return hints.length ? hints.join('; ') : null
}

export function getWeldFormReactivationResultHint(draft: WeldInput, initialValue: WeldDraft) {
  const hints: string[] = []

  for (const method of LNK_METHODS) {
    if (!isYesValue(draft[method.enabledKey]) || isYesValue(initialValue[method.enabledKey])) continue

    const currentDisplay = isCancelledValue(initialValue[method.enabledKey])
      ? getCancelledLnkResultDisplay(draft[method.resultKey])
      : getNormalizedResult(draft[method.resultKey])
    const nextDisplay = getActiveLnkResultAfterSave(draft, method)
    if (!currentDisplay || !nextDisplay || currentDisplay === nextDisplay) continue

    hints.push(`${method.code}: сейчас «${currentDisplay}», после сохранения будет «${nextDisplay}»`)
  }

  if (isYesValue(draft.pstoRequired) && !isYesValue(initialValue.pstoRequired)) {
    const currentDisplay = isCancelledValue(initialValue.pstoRequired)
      ? getCancelledPstoResultDisplay(draft.pstoResult)
      : getNormalizedResult(draft.pstoResult)
    const nextDisplay = getActivePstoResultAfterSave(draft)
    if (currentDisplay && nextDisplay && currentDisplay !== nextDisplay) {
      hints.push(`ПСТО: сейчас «${currentDisplay}», после сохранения будет «${nextDisplay}»`)
    }
  }

  return hints.length ? hints.join('; ') : null
}

function isActiveControlAvailability(value: unknown) {
  return isYesValue(value) || isCancelledValue(value)
}

function hasControlAvailabilityChanged(currentValue: unknown, initialValue: unknown) {
  return normalizeControlAvailabilityForHint(currentValue) !== normalizeControlAvailabilityForHint(initialValue)
}

function normalizeControlAvailabilityForHint(value: unknown) {
  if (isCancelledValue(value)) return 'отменен'
  if (isAdditionalValue(value)) return 'дополнительный'
  if (isYesValue(value)) return 'да'
  return ''
}


function hasAnyText(row: WeldInput, fieldKeys: readonly WeldFieldKey[]) {
  return fieldKeys.some((fieldKey) => hasText(row[fieldKey]))
}

function hasRealLnkReportHistory(row: WeldInput, method: (typeof LNK_METHODS)[number]) {
  return hasRealLnkResultValue(row[method.resultKey]) || hasAnyText(row, [method.conclusionDateKey, method.conclusionKey])
}

function hasRealPstoReportHistory(row: WeldInput) {
  return isRealPstoResult(row.pstoResult) || hasAnyText(row, ['heatTreatmentDiagram', 'pstoNote', 'pstoBoq', 'pstoKs3'])
}

function isRealPstoResult(value: unknown) {
  const result = String(value ?? '').trim().toLowerCase()
  return result === 'проведено' || result === 'проведено (отменен)' || result === 'да'
}

function getNormalizedResult(value: unknown) {
  return String(value ?? '').trim().toLowerCase()
}

function getActiveLnkResultAfterSave(row: WeldInput, method: (typeof LNK_METHODS)[number]) {
  const result = getNormalizedResult(row[method.resultKey])
  if (result === 'годен (отменен)') return 'годен'
  if (result === 'отменен' || !result) return hasText(row[method.requestKey]) ? 'ожидает НК' : 'ожидает заявку'
  return result
}

function getActivePstoResultAfterSave(row: WeldInput) {
  const result = getNormalizedResult(row.pstoResult)
  if (result === 'проведено (отменен)') return 'проведено'
  if (result === 'отменен' || !result) return hasText(row.pstoRequest) ? 'ожидает' : 'ожидает заявку'
  return result
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

function getWeldFormDateSaveBlockReason(draft: WeldInput) {
  for (const fieldKey of dateFieldKeys) {
    const field = FIELD_BY_KEY.get(fieldKey)
    const reason = getDateInputValidationReason(draft[fieldKey], field?.label ?? 'Дата', {
      disallowFuture: fieldKey === 'weldDate',
    })
    if (reason) return lowerFirst(reason)
  }
  return ''
}

function lowerFirst(value: string) {
  return value ? `${value.charAt(0).toLowerCase()}${value.slice(1)}` : value
}

const dateFieldKeys = [...FIELD_BY_KEY.entries()]
  .filter(([, field]) => field.kind === 'date')
  .map(([fieldKey]) => fieldKey as WeldFieldKey)
