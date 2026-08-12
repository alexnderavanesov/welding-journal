import { buildRepeatedJointDraft } from '@/lib/repeated-joint-draft'
import {
  clearCancelledRejectedLnkGeneratedData,
  clearDisabledLnkRequests,
  restoreActiveLnkCancelledResults,
  withLnkFinalStatus,
} from '@/lib/lnk-field-updates'
import { assertNoLnkChronologyIssues } from '@/lib/lnk-chronology-checks'
import { assertNoLnkRepairRuleIssues } from '@/lib/lnk-result-rules'
import { assertNoPstoChronologyIssues } from '@/lib/psto-chronology-checks'
import {
  clearCancelledPstoRequestWithoutResult,
  restoreActivePstoCancelledResult,
  withPendingPstoResultStatus,
} from '@/lib/psto-field-updates'
import { withPendingLnkResults } from '@/lib/report-control-state'
import {
  normalizeLegacyControlAvailabilityForImport,
  normalizeLegacyControlAvailabilityForSave,
  validateManualJointNameForSave,
  validateManualJointNamesForImport,
  validateRequiredConnectionTypeForSave,
  validateRequiredMaterialGroupForSave,
  validateRequiredRootStampForSave,
  validateRequiredRootStampsForImport,
  validateRequiredWeldCoreFieldsForImport,
  validateRequiredWeldingMethodForSave,
  validateWeldDatesForImport,
} from '@/lib/weld-validation'
import { normalizeWeldingMethodsForImport, validateWelderStampFieldsForImport } from '@/lib/welder-stamp-import'
import { loadDataListSettings, normalizeDataListOption } from '@/lib/data-list-settings'
import {
  validateOfficialStampCompatibilityForImport,
  validateOfficialStampCompatibilityForSave,
} from '@/lib/welder-stamp-compatibility'
import { loadOtherSettings } from '@/lib/other-settings'
import { loadSaveCheckSettings } from '@/lib/save-check-settings'
import { applySystemWdi, getSystemWdiValidationError, isSystemWdiMode } from '@/lib/wdi'
import { parseDateLikeToIso } from '@/lib/date-format'
import type {
  RepeatedJointCoilTask,
  RepeatedJointCreateTask,
  RepeatedJointRenameTask,
  WeldDraft,
  WeldRow,
} from '@/lib/dispatcher-types'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'
import type { StampSelectOptionLike } from '@/lib/weld-journal-mutation-types'
import type { WelderStampRecord, WelderStampSuspensionRecord } from '@/lib/welder-stamp-types'

export function prepareWeldSaveValue({
  value,
  rows,
  welderStamps,
  welderStampSuspensions,
}: {
  value: WeldDraft
  rows: WeldRow[]
  welderStamps: WelderStampRecord[]
  welderStampSuspensions: WelderStampSuspensionRecord[]
}) {
  const otherSettings = loadOtherSettings()
  const saveCheckSettings = loadSaveCheckSettings()
  if (isSystemWdiMode(otherSettings)) applySystemWdi(value, otherSettings)

  const preparedValue = withLnkFinalStatus(
    withPendingPstoResultStatus(
      withPendingLnkResults(
        clearDisabledLnkRequests(
          restoreActiveLnkCancelledResults(
            restoreActivePstoCancelledResult(clearCancelledRejectedLnkGeneratedData(clearCancelledPstoRequestWithoutResult(value))),
          ),
        ),
      ),
    ),
  )
  normalizeLegacyControlAvailabilityForSave(preparedValue)
  validateRequiredRootStampForSave(preparedValue, saveCheckSettings)
  validateRequiredMaterialGroupForSave(preparedValue, saveCheckSettings)
  validateRequiredConnectionTypeForSave(preparedValue, saveCheckSettings)
  validateRequiredWeldingMethodForSave(preparedValue, saveCheckSettings)
  validateManualJointNameForSave(preparedValue, rows, saveCheckSettings)
  const previousRow = preparedValue.id ? rows.find((row) => row.id === preparedValue.id) : undefined
  validateOfficialStampCompatibilityForSave(preparedValue, welderStamps, {
    suspensions: welderStampSuspensions,
  })
  if (shouldCheckDocumentChronologyForSave(preparedValue, previousRow)) {
    assertNoLnkChronologyIssues([preparedValue], saveCheckSettings)
    assertNoPstoChronologyIssues([preparedValue], saveCheckSettings)
  }
  return preparedValue
}

export function buildRepeatedJointRows(task: RepeatedJointCreateTask | RepeatedJointCoilTask) {
  const targetJoints = task.kind === 'coil' ? task.targetJoints : [task.targetJoint]
  return targetJoints.map((targetJoint) => buildRepeatedJointDraft(task.row, targetJoint))
}

export function buildRenamedRepeatedJointRow(task: RepeatedJointRenameTask) {
  return { ...task.row, joint: task.targetJoint }
}

export function prepareImportedWeldRecords({
  records,
  skipManualJointNameValidation = false,
  skipLnkRepairRuleValidation = false,
  allowedArchivedOfficialStamps = [],
  weldFormStampSelectOptions,
  welderStamps,
  welderStampSuspensions,
}: {
  records: WeldInput[]
  skipManualJointNameValidation?: boolean
  skipLnkRepairRuleValidation?: boolean
  allowedArchivedOfficialStamps?: readonly string[]
  weldFormStampSelectOptions: Partial<Record<WeldFieldKey, readonly StampSelectOptionLike[]>>
  welderStamps: WelderStampRecord[]
  welderStampSuspensions: WelderStampSuspensionRecord[]
}) {
  const saveCheckSettings = loadSaveCheckSettings()
  const preparedRecords = records
  normalizeSystemWdiForImport(preparedRecords)
  normalizeLegacyControlAvailabilityForImport(preparedRecords)
  validateRequiredRootStampsForImport(preparedRecords, saveCheckSettings)
  validateRequiredWeldCoreFieldsForImport(preparedRecords, saveCheckSettings)
  if (!skipManualJointNameValidation) validateManualJointNamesForImport(preparedRecords, saveCheckSettings)
  validateWeldDatesForImport(preparedRecords, saveCheckSettings)
  normalizeWeldingMethodsForImport(preparedRecords)
  normalizeConnectionTypesAndMaterialGroupsForImport(preparedRecords)
  normalizeTestTypesForImport(preparedRecords)
  validateWelderStampFieldsForImport(preparedRecords, weldFormStampSelectOptions, allowedArchivedOfficialStamps, saveCheckSettings)
  validateOfficialStampCompatibilityForImport(preparedRecords, welderStamps, {
    saveCheckSettings,
    suspensions: welderStampSuspensions,
  })
  if (!skipLnkRepairRuleValidation) assertNoLnkRepairRuleIssues(preparedRecords, saveCheckSettings)
  assertNoLnkChronologyIssues(preparedRecords, saveCheckSettings)
  assertNoPstoChronologyIssues(preparedRecords, saveCheckSettings)
  return preparedRecords
}

function normalizeSystemWdiForImport(records: WeldInput[]) {
  const otherSettings = loadOtherSettings()
  if (!isSystemWdiMode(otherSettings)) return

  records.forEach((record, index) => {
    const validationError = getSystemWdiValidationError(record, otherSettings)
    if (validationError) {
      throw new Error(`Импорт остановлен: ${getImportRowLabel(index)}. ${validationError}`)
    }
    applySystemWdi(record, otherSettings)
  })
}

function normalizeConnectionTypesAndMaterialGroupsForImport(records: WeldInput[]) {
  const settings = loadDataListSettings()
  records.forEach((record, index) => {
    const errors = [
      normalizeConfiguredDataListField(record, 'connectionType', 'Тип соединения', settings.connectionTypes),
      normalizeConfiguredDataListField(record, 'materialGroup', 'Группа материалов', settings.materialGroups),
    ].filter((message): message is string => Boolean(message))
    if (errors.length > 0) {
      throw new Error(`Импорт остановлен: ${getImportRowLabel(index)}. ${errors.join(' ')}`)
    }
  })
}

function normalizeConfiguredDataListField(
  record: WeldInput,
  fieldKey: 'connectionType' | 'materialGroup',
  fieldLabel: string,
  options: string[],
) {
  const rawValue = String(record[fieldKey] ?? '').trim()
  const value = normalizeDataListOption(rawValue)
  if (!value) {
    record[fieldKey] = null
    return null
  }
  if (options.length === 0) {
    return `Поле "${fieldLabel}" заполнено, но список в настройках пока пуст.`
  }
  if (!options.includes(value)) {
    return `Поле "${fieldLabel}" должно содержать одно значение из настроек: ${options.join(', ')}. Значение "${rawValue}" не подходит.`
  }
  record[fieldKey] = value
  return null
}

function normalizeTestTypesForImport(records: WeldInput[]) {
  const testTypeOptions = loadDataListSettings().testTypes

  records.forEach((record, index) => {
    const rawValue = String(record.testTypes ?? '').trim()
    if (!rawValue) {
      record.testTypes = null
      return
    }

    const values = rawValue
      .split(/[,;+]+/)
      .map((part) => normalizeDataListOption(part))
      .filter(Boolean)
    const uniqueValues = [...new Set(values)]
    const rowLabel = getImportRowLabel(index)
    if (testTypeOptions.length === 0) {
      throw new Error(`Импорт остановлен: ${rowLabel}. Поле "Вид испытаний" заполнено, но список в настройках пока пуст.`)
    }
    const unknownValues = uniqueValues.filter((value) => !testTypeOptions.includes(value))
    if (unknownValues.length > 0) {
      throw new Error(
        `Импорт остановлен: ${rowLabel}. Поле "Вид испытаний" может содержать только значения из настроек: ${testTypeOptions.join(', ')}. Не подходят: ${unknownValues.join(', ')}.`,
      )
    }
    record.testTypes = testTypeOptions.filter((option) => uniqueValues.includes(option)).join(', ')
  })
}

function getImportRowLabel(index: number) {
  return `строка ${index + 2}`
}

function shouldCheckDocumentChronologyForSave(value: WeldInput & { id?: number }, previousRow?: WeldRow) {
  if (!previousRow) return true
  return normalizeDateForChronology(value.weldDate) !== normalizeDateForChronology(previousRow.weldDate)
}

function normalizeDateForChronology(value: unknown) {
  return parseDateLikeToIso(value) ?? String(value ?? '').trim()
}
