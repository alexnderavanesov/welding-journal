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
  validateRequiredRootStampForSave,
  validateRequiredRootStampsForImport,
  validateWeldDatesForImport,
} from '@/lib/weld-validation'
import { normalizeWeldingMethodsForImport, validateWelderStampFieldsForImport } from '@/lib/welder-stamp-import'
import { loadDataListSettings, normalizeDataListOption } from '@/lib/data-list-settings'
import {
  getArchivedOfficialStampValuesForRecord,
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
  validateManualJointNameForSave(preparedValue, rows, saveCheckSettings)
  const previousRow = preparedValue.id ? rows.find((row) => row.id === preparedValue.id) : undefined
  validateOfficialStampCompatibilityForSave(preparedValue, welderStamps, {
    allowedArchivedOfficialStamps: getArchivedOfficialStampValuesForRecord(
      previousRow,
      welderStamps,
    ),
    ignoreArchivedMissingRegistry: otherSettings.includeArchivedWelderStampsInForm,
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
  if (!skipManualJointNameValidation) validateManualJointNamesForImport(preparedRecords, saveCheckSettings)
  validateWeldDatesForImport(preparedRecords, saveCheckSettings)
  normalizeWeldingMethodsForImport(preparedRecords)
  normalizeConnectionTypesForImport(preparedRecords)
  normalizeMaterialGroupsForImport(preparedRecords)
  validateWelderStampFieldsForImport(preparedRecords, weldFormStampSelectOptions, allowedArchivedOfficialStamps, saveCheckSettings)
  validateOfficialStampCompatibilityForImport(preparedRecords, welderStamps, {
    allowedArchivedOfficialStamps,
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

function normalizeConnectionTypesForImport(records: WeldInput[]) {
  const connectionTypeOptions = loadDataListSettings().connectionTypes

  records.forEach((record, index) => {
    const rawValue = String(record.connectionType ?? '').trim()
    const value = normalizeDataListOption(rawValue)
    if (!value) {
      record.connectionType = null
      return
    }

    const rowLabel = getImportRowLabel(index)
    if (connectionTypeOptions.length === 0) {
      throw new Error(`Импорт остановлен: ${rowLabel}. Поле "Тип соединения" заполнено, но список в настройках пока пуст.`)
    }
    if (!connectionTypeOptions.includes(value)) {
      throw new Error(
        `Импорт остановлен: ${rowLabel}. Поле "Тип соединения" должно содержать одно значение из настроек: ${connectionTypeOptions.join(', ')}. Значение "${rawValue}" не подходит.`,
      )
    }
    record.connectionType = value
  })
}

function normalizeMaterialGroupsForImport(records: WeldInput[]) {
  const materialGroupOptions = loadDataListSettings().materialGroups

  records.forEach((record, index) => {
    const rawValue = String(record.materialGroup ?? '').trim()
    const value = normalizeDataListOption(rawValue)
    if (!value) {
      record.materialGroup = null
      return
    }

    const rowLabel = getImportRowLabel(index)
    if (materialGroupOptions.length === 0) {
      throw new Error(`Импорт остановлен: ${rowLabel}. Поле "Группа материалов" заполнено, но список в настройках пока пуст.`)
    }
    if (!materialGroupOptions.includes(value)) {
      throw new Error(
        `Импорт остановлен: ${rowLabel}. Поле "Группа материалов" должно содержать одно значение из настроек: ${materialGroupOptions.join(', ')}. Значение "${rawValue}" не подходит.`,
      )
    }
    record.materialGroup = value
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
