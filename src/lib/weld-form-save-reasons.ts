import type { WeldDraft } from '@/lib/dispatcher-types'
import { getDateInputValidationReason, parseDateLikeToIso } from '@/lib/date-format'
import {
  hasReservedJointSystemPart,
  normalizeJointName,
  validateJointNameStructure,
  validateManualJointName,
} from '@/lib/joint-name'
import { findFirstLnkRepairRuleIssue } from '@/lib/lnk-result-rules'
import {
  DEFAULT_SAVE_CHECK_SETTINGS,
  formatSaveCheckBlockReason,
  type SaveCheckSettingId,
  type SaveCheckSettings,
} from '@/lib/save-check-settings'
import {
  getSystemIndexSummaryText,
  loadSystemIndexSettings,
  type SystemIndexSettings,
} from '@/lib/system-index-settings'
import { LNK_METHODS } from '@/lib/lnk-report-config'
import {
  findFirstNewLnkChronologySaveBlockReason,
  type LnkChronologyIssueKind,
} from '@/lib/lnk-chronology-checks'
import { findFirstNewPstoChronologySaveBlockReason } from '@/lib/psto-chronology-checks'
import { hasPstoExecutionHistory } from '@/lib/psto-cycle'
import {
  getCancelledLnkResultDisplay,
  getCancelledPstoResultDisplay,
  hasRealLnkResultValue,
  hasText,
} from '@/lib/report-value-utils'
import { FIELD_BY_KEY, type WeldFieldKey, type WeldInput } from '@/lib/weld-fields'
import { factualWelderStampFieldKeys, isWeldFormFieldHidden } from '@/lib/weld-form-field-sets'
import {
  getRequiredConnectionTypeMessage,
  getRequiredMaterialGroupMessage,
  getRequiredWeldingMethodMessage,
} from '@/lib/weld-validation'
import type { StampSelectOption, StampSelectOptions } from '@/lib/weld-form-types'
import { getStampSelectValue, isAdditionalValue, isCancelledValue, isYesValue } from '@/lib/weld-form-value-utils'
import { shouldValidateOfficialStampCompatibilityForSave } from '@/lib/welder-stamp-compatibility-validation'

export function getWeldFormSaveBlockReason(
  draft: WeldInput,
  initialValue: WeldDraft,
  saveCheckSettings: SaveCheckSettings = DEFAULT_SAVE_CHECK_SETTINGS,
  options: {
    allowSystemJointName?: boolean
    allowPrimaryLnkStageDebt?: boolean
    systemIndexSettings?: SystemIndexSettings
  } = {},
) {
  const dateReason = getWeldFormDateSaveBlockReason(draft, saveCheckSettings)
  if (dateReason) return dateReason

  if (saveCheckSettings.requiredMaterialGroupWithWeldDate) {
    const materialGroupReason = getRequiredMaterialGroupMessage(draft)
    if (materialGroupReason) {
      return formatSaveCheckBlockReason('requiredMaterialGroupWithWeldDate', materialGroupReason)
    }
  }

  if (saveCheckSettings.requiredConnectionTypeWithWeldDate) {
    const connectionTypeReason = getRequiredConnectionTypeMessage(draft)
    if (connectionTypeReason) {
      return formatSaveCheckBlockReason('requiredConnectionTypeWithWeldDate', connectionTypeReason)
    }
  }

  if (saveCheckSettings.requiredWeldingMethodWithWeldDate) {
    const weldingMethodReason = getRequiredWeldingMethodMessage(draft)
    if (weldingMethodReason) {
      return formatSaveCheckBlockReason('requiredWeldingMethodWithWeldDate', weldingMethodReason)
    }
  }

  const reportHistoryReason = saveCheckSettings.controlHistoryProtection
    ? getNewControlAvailabilityReportHistoryReason(draft, initialValue)
    : null
  if (reportHistoryReason) return formatSaveCheckBlockReason('controlHistoryProtection', reportHistoryReason)

  if (shouldCheckDocumentChronologyForForm(draft, initialValue)) {
    const documentChronologyReason =
      findFirstNewLnkChronologySaveBlockReason(
        [draft],
        [initialValue],
        saveCheckSettings,
        options.allowPrimaryLnkStageDebt
          ? { ignoredKinds: PRIMARY_LNK_STAGE_DEBT_ISSUE_KINDS }
          : undefined,
      ) ||
      findFirstNewPstoChronologySaveBlockReason([draft], [initialValue], saveCheckSettings)
    if (documentChronologyReason) return documentChronologyReason
  }

  if (saveCheckSettings.lnkResultRepairRules) {
    const repairReason = findFirstLnkRepairRuleIssue([draft], saveCheckSettings, options.systemIndexSettings)
    if (repairReason) return formatSaveCheckBlockReason('lnkResultRepairRules', repairReason)
  }

  const currentJoint = normalizeJointName(draft.joint)
  const initialJoint = normalizeJointName(initialValue.joint)
  const systemIndexSettings = options.systemIndexSettings ?? loadSystemIndexSettings()
  const jointStructureReason = saveCheckSettings.manualJointName
    ? validateJointNameStructure(draft.joint, systemIndexSettings)
    : null
  if (jointStructureReason) return formatSaveCheckBlockReason('manualJointName', jointStructureReason)
  if (initialValue.id && currentJoint === initialJoint) return null

  if (
    !options.allowSystemJointName &&
    saveCheckSettings.systemJointRenameProtection &&
    initialValue.id &&
    hasReservedJointSystemPart(initialValue.joint, systemIndexSettings)
  ) {
    return formatSaveCheckBlockReason('systemJointRenameProtection', `стык с системными индексами ${getSystemIndexSummaryText(systemIndexSettings)} нельзя переименовывать вручную. Используйте подсказки диспетчера задач.`)
  }

  const manualJointNameReason = saveCheckSettings.manualJointName && !options.allowSystemJointName
    ? validateManualJointName(draft.joint, systemIndexSettings)
    : null
  return manualJointNameReason ? formatSaveCheckBlockReason('manualJointName', manualJointNameReason) : null
}

const PRIMARY_LNK_STAGE_DEBT_ISSUE_KINDS = new Set<LnkChronologyIssueKind>([
  'post-before-psto-cycle',
])

function shouldCheckDocumentChronologyForForm(draft: WeldInput, initialValue: WeldDraft) {
  if (!initialValue.id) return true

  const chronologyDateFields: WeldFieldKey[] = [
    'weldDate',
    'pstoRequestDate',
    'pstoDate',
    'tvmtRequestDate',
    'tvmtConclusionDate',
    ...LNK_METHODS.flatMap((method) => [method.requestDateKey, method.conclusionDateKey]),
  ]
  const chronologyValueFields: WeldFieldKey[] = [
    'pstoRequired',
    'pstoRequest',
    'pstoResult',
    'tvmtRequest',
    'tvmtResult',
    'tvmtConclusion',
    ...LNK_METHODS.flatMap((method) => [
      method.enabledKey,
      method.requestKey,
      method.resultKey,
      method.conclusionKey,
    ]),
  ]
  return chronologyDateFields.some(
    (fieldKey) => normalizeDateForComparison(draft[fieldKey]) !== normalizeDateForComparison(initialValue[fieldKey]),
  ) || chronologyValueFields.some(
    (fieldKey) => String(draft[fieldKey] ?? '').trim() !== String(initialValue[fieldKey] ?? '').trim(),
  )
}

export type ControlAvailabilityReportHistoryIssue = {
  code: string
  fieldKeys: WeldFieldKey[]
  message: string
  report: 'lnk' | 'psto'
}

export function getControlAvailabilityReportHistoryIssues(draft: WeldInput): ControlAvailabilityReportHistoryIssue[] {
  const issues: ControlAvailabilityReportHistoryIssue[] = []
  for (const method of LNK_METHODS) {
    if (isActiveControlAvailability(draft[method.enabledKey])) continue
    if (!hasRealLnkReportHistory(draft, method)) continue

    issues.push({
      code: method.code,
      fieldKeys: [
        method.enabledKey,
        method.resultKey,
        method.conclusionDateKey,
        method.conclusionKey,
      ],
      message: `${method.code}: выберите «отменен» либо очистите/удалите результат НК в отчете ЛНК.`,
      report: 'lnk',
    })
  }

  if (
    !isActiveControlAvailability(draft.pstoRequired) &&
    hasRealPstoReportHistory(draft) &&
    !hasPstoExecutionHistory(draft)
  ) {
    issues.push({
      code: 'ПСТО',
      fieldKeys: [
        'pstoRequired',
        'pstoResult',
        'heatTreatmentDiagram',
        'pstoNote',
        'tvmtRequest',
        'tvmtRequestDate',
        'tvmtResult',
        'tvmtConclusionDate',
        'tvmtConclusion',
      ],
      message: 'ПСТО: выберите «отменен» либо очистите/удалите результат ПСТО.',
      report: 'psto',
    })
  }

  return issues
}

function getNewControlAvailabilityReportHistoryReason(draft: WeldInput, initialValue: WeldDraft) {
  const previousIssueCodes = new Set(
    getControlAvailabilityReportHistoryIssues(initialValue).map((issue) => issue.code),
  )
  return getControlAvailabilityReportHistoryIssues(draft)
    .find((issue) => !previousIssueCodes.has(issue.code))?.message ?? null
}

export function getWeldFormAutoClearHint(draft: WeldInput, initialValue: WeldDraft) {
  const hints: string[] = []

  for (const method of LNK_METHODS) {
    if (!hasControlAvailabilityChanged(draft[method.enabledKey], initialValue[method.enabledKey])) continue
    if (isYesValue(draft[method.enabledKey])) continue
    if (!hasText(draft[method.requestKey])) continue
    if (hasRealLnkReportHistory(draft, method)) continue

    const requestName = String(draft[method.requestKey] ?? '').trim()
    hints.push(
      `${method.code}: фактического результата еще нет, поэтому позиция этого стыка будет исключена из заявки «${requestName}». Другие виды НК и остальные стыки заявки не изменятся`,
    )
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
  const result = getNormalizedResult(row[method.resultKey])
  return result === 'годен (отменен)' || hasRealLnkResultValue(result) || hasAnyText(row, [method.conclusionDateKey, method.conclusionKey])
}

function hasRealPstoReportHistory(row: WeldInput) {
  const repeatCycles = (row as WeldInput & { pstoRepeatCycles?: unknown[] }).pstoRepeatCycles ?? []
  return (
    isRealPstoResult(row.pstoResult) ||
    hasAnyText(row, [
      'heatTreatmentDiagram',
      'pstoNote',
      'tvmtRequest',
      'tvmtRequestDate',
      'tvmtResult',
      'tvmtConclusionDate',
      'tvmtConclusion',
    ]) ||
    repeatCycles.length > 0
  )
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
  config: {
    initialValue?: WeldDraft
    saveCheckSettings?: SaveCheckSettings
  } = {},
) {
  if (!stampSelectOptions) return null
  if (config.initialValue && !shouldValidateOfficialStampCompatibilityForSave(draft, config.initialValue)) {
    return null
  }

  for (const [fieldKey, fieldOptions] of Object.entries(stampSelectOptions) as Array<[WeldFieldKey, readonly StampSelectOption[]]>) {
    if (factualWelderStampFieldKeys.has(fieldKey)) continue

    const value = getStampSelectValue(draft[fieldKey])
    if (!value) continue

    const selectedOption = fieldOptions.find((option) => option.value.trim() === value)
    if (!selectedOption) {
      if (config.saveCheckSettings?.officialRegistry === false) continue
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
  for (const fieldKey of dateFieldKeys) {
    const field = FIELD_BY_KEY.get(fieldKey)
    const reason = getDateInputValidationReason(draft[fieldKey], field?.label ?? 'Дата', {
      disallowFuture: fieldKey === 'weldDate' && saveCheckSettings.weldDateNotFuture,
    })
    if (reason) return formatSaveCheckBlockReason(getDateReasonSaveCheckSettingId(fieldKey, reason), lowerFirst(reason))
  }
  return ''
}

function getDateReasonSaveCheckSettingId(fieldKey: WeldFieldKey, reason: string): SaveCheckSettingId {
  if (fieldKey === 'weldDate' && reason.toLowerCase().includes('позже сегодняшней')) return 'weldDateNotFuture'
  return 'dateFormat'
}

function getStampSelectOptionSaveCheckSettingId(reason: string): SaveCheckSettingId {
  const normalizedReason = reason.toLocaleLowerCase('ru-RU')
  if (normalizedReason.includes('клеймо в архив')) return 'officialArchive'
  if (normalizedReason.includes('длс')) return 'officialDls'
  if (normalizedReason.includes('отстран')) return 'officialSuspension'
  if (normalizedReason.includes('способ')) return 'officialWeldingMethod'
  if (normalizedReason.includes('групп')) return 'officialMaterialGroup'
  if (normalizedReason.includes('дат')) return 'officialNaksDate'
  if (normalizedReason.includes('диаметр')) return 'officialDiameter'
  if (normalizedReason.includes('толщин')) return 'officialThickness'
  return 'officialRegistry'
}

function normalizeDateForComparison(value: unknown) {
  return parseDateLikeToIso(value) ?? String(value ?? '').trim()
}

function lowerFirst(value: string) {
  return value ? `${value.charAt(0).toLowerCase()}${value.slice(1)}` : value
}

const dateFieldKeys = [...FIELD_BY_KEY.entries()]
  .filter(([, field]) => field.kind === 'date' && !isWeldFormFieldHidden(field))
  .map(([fieldKey]) => fieldKey as WeldFieldKey)
