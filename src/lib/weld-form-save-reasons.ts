import type { WeldDraft } from '@/lib/dispatcher-types'
import { getDateInputValidationReason, getTodayIsoDate, parseDateLikeToIso } from '@/lib/date-format'
import { hasReservedJointSystemPart, normalizeJointName, validateManualJointName } from '@/lib/joint-name'
import { formatJointDiameterLabel } from '@/lib/joint-display'
import { isLnkRepairForbiddenByDiameter } from '@/lib/lnk-result-rules'
import {
  DEFAULT_SAVE_CHECK_SETTINGS,
  formatSaveCheckBlockReason,
  type SaveCheckSettingId,
  type SaveCheckSettings,
} from '@/lib/save-check-settings'
import { getSystemIndexSummaryText } from '@/lib/system-index-settings'
import { LNK_METHODS } from '@/lib/lnk-report-config'
import { findFirstLnkChronologySaveBlockReason } from '@/lib/lnk-chronology-checks'
import { findFirstPstoChronologySaveBlockReason } from '@/lib/psto-chronology-checks'
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

export function getWeldFormSaveBlockReason(
  draft: WeldInput,
  initialValue: WeldDraft,
  saveCheckSettings: SaveCheckSettings = DEFAULT_SAVE_CHECK_SETTINGS,
) {
  const dateReason = getWeldFormDateSaveBlockReason(draft, saveCheckSettings)
  if (dateReason) return dateReason

  const reportHistoryReason = saveCheckSettings.controlHistoryProtection ? getControlAvailabilityReportHistoryReason(draft) : null
  if (reportHistoryReason) return formatSaveCheckBlockReason('controlHistoryProtection', reportHistoryReason)

  if (shouldCheckDocumentChronologyForForm(draft, initialValue)) {
    const documentChronologyReason =
      findFirstLnkChronologySaveBlockReason([draft], saveCheckSettings) ||
      findFirstPstoChronologySaveBlockReason([draft], saveCheckSettings)
    if (documentChronologyReason) return documentChronologyReason
  }

  if (shouldCheckLnkRepairDiameterForForm(draft, initialValue, saveCheckSettings)) {
    const repairDiameterReason = getWeldFormRepairDiameterSaveBlockReason(draft)
    if (repairDiameterReason) return formatSaveCheckBlockReason('lnkResultRepairRules', repairDiameterReason)
  }

  const currentJoint = normalizeJointName(draft.joint)
  const initialJoint = normalizeJointName(initialValue.joint)
  if (initialValue.id && currentJoint === initialJoint) return null

  if (saveCheckSettings.systemJointRenameProtection && initialValue.id && hasReservedJointSystemPart(initialValue.joint)) {
    return formatSaveCheckBlockReason('systemJointRenameProtection', `стык с системными индексами ${getSystemIndexSummaryText()} нельзя переименовывать вручную. Используйте подсказки диспетчера задач.`)
  }

  const manualJointNameReason = saveCheckSettings.manualJointName ? validateManualJointName(draft.joint) : null
  return manualJointNameReason ? formatSaveCheckBlockReason('manualJointName', manualJointNameReason) : null
}

function shouldCheckDocumentChronologyForForm(draft: WeldInput, initialValue: WeldDraft) {
  if (!initialValue.id) return true
  return normalizeDateForComparison(draft.weldDate) !== normalizeDateForComparison(initialValue.weldDate)
}

function shouldCheckLnkRepairDiameterForForm(
  draft: WeldInput,
  initialValue: WeldDraft,
  saveCheckSettings: SaveCheckSettings,
) {
  if (!saveCheckSettings.lnkResultRepairRules) return false
  if (!initialValue.id) return true

  return normalizeDiameterForComparison(draft.d1) !== normalizeDiameterForComparison(initialValue.d1) ||
    normalizeDiameterForComparison(draft.d2) !== normalizeDiameterForComparison(initialValue.d2)
}

function normalizeDiameterForComparison(value: unknown) {
  return String(value ?? '').trim().replace(',', '.')
}

function getWeldFormRepairDiameterSaveBlockReason(row: WeldInput) {
  if (!isLnkRepairForbiddenByDiameter(row)) return null

  const repairMethods = LNK_METHODS.filter(
    (method) => getNormalizedResult(row[method.resultKey]) === 'ремонт',
  )
  if (repairMethods.length === 0) return null

  const methodCodes = repairMethods.map((method) => method.code).join(', ')
  const diameterText = formatJointDiameterLabel(row)
  return `результат ${methodCodes} - «ремонт» нельзя сохранить при минимальном диаметре ${diameterText} мм. Для диаметра меньше 89 мм выберите «вырез» или исправьте D1/D2.`
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
    (hasText(draft.pstoRequest) || hasText(draft.pstoRequestDate) || hasText(draft.pstoDate)) &&
    !hasRealPstoReportHistory(draft)
  ) {
    hints.push(
      hasText(draft.pstoRequestDate) || hasText(draft.pstoDate)
        ? 'ПСТО: заявка и даты на стык будут удалены'
        : 'ПСТО: заявка на стык будет удалена',
    )
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
      return formatSaveCheckBlockReason('officialRegistry', `${FIELD_BY_KEY.get(fieldKey)?.label ?? 'поле клейма'} должно быть выбрано из активного реестра клейм.`)
    }
    if (selectedOption.disabled) {
      const reason = selectedOption.reason ? `: ${selectedOption.reason}` : ''
      return formatSaveCheckBlockReason(getStampSelectOptionSaveCheckSettingId(reason), `${FIELD_BY_KEY.get(fieldKey)?.label ?? 'поле клейма'} не подходит по реестру клейм${reason}.`)
    }
  }

  return null
}

function getWeldFormDateSaveBlockReason(draft: WeldInput, saveCheckSettings: SaveCheckSettings) {
  if (!saveCheckSettings.dateFormat && !saveCheckSettings.weldDateNotFuture) return ''

  for (const fieldKey of dateFieldKeys) {
    const field = FIELD_BY_KEY.get(fieldKey)
    if (saveCheckSettings.dateFormat) {
      const reason = getDateInputValidationReason(draft[fieldKey], field?.label ?? 'Дата', {
        disallowFuture: fieldKey === 'weldDate' && saveCheckSettings.weldDateNotFuture,
      })
      if (reason) return formatSaveCheckBlockReason(getDateReasonSaveCheckSettingId(fieldKey, reason), lowerFirst(reason))
      continue
    }

    if (fieldKey === 'weldDate' && saveCheckSettings.weldDateNotFuture && isFutureDateLike(draft[fieldKey])) {
      return formatSaveCheckBlockReason('weldDateNotFuture', 'дата сварки не может быть позже сегодняшней.')
    }
  }
  return ''
}

function getDateReasonSaveCheckSettingId(fieldKey: WeldFieldKey, reason: string): SaveCheckSettingId {
  if (fieldKey === 'weldDate' && reason.toLowerCase().includes('позже сегодняшней')) return 'weldDateNotFuture'
  return 'dateFormat'
}

function getStampSelectOptionSaveCheckSettingId(reason: string): SaveCheckSettingId {
  if (reason.includes('отстран')) return 'officialSuspension'
  if (reason.includes('способ')) return 'officialWeldingMethod'
  if (reason.includes('групп')) return 'officialMaterialGroup'
  if (reason.includes('дат')) return 'officialNaksDate'
  if (reason.includes('диаметр')) return 'officialDiameter'
  if (reason.includes('толщин')) return 'officialThickness'
  if (reason.includes('ДЛС')) return 'officialDls'
  return 'officialRegistry'
}

function isFutureDateLike(value: unknown) {
  const isoDate = parseDateLikeToIso(value)
  return Boolean(isoDate && isoDate > getTodayIsoDate())
}

function normalizeDateForComparison(value: unknown) {
  return parseDateLikeToIso(value) ?? String(value ?? '').trim()
}

function lowerFirst(value: string) {
  return value ? `${value.charAt(0).toLowerCase()}${value.slice(1)}` : value
}

const dateFieldKeys = [...FIELD_BY_KEY.entries()]
  .filter(([, field]) => field.kind === 'date')
  .map(([fieldKey]) => fieldKey as WeldFieldKey)
