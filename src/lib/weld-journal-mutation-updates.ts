import { buildRepeatedJointDraft } from '@/lib/repeated-joint-draft'
import {
  clearCancelledRejectedLnkGeneratedData,
  clearDisabledLnkRequests,
  restoreActiveLnkCancelledResults,
  withLnkFinalStatus,
} from '@/lib/lnk-field-updates'
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
import { applySystemWdi, getSystemWdiValidationError, isSystemWdiMode } from '@/lib/wdi'
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
  validateRequiredRootStampForSave(preparedValue)
  validateManualJointNameForSave(preparedValue, rows)
  validateOfficialStampCompatibilityForSave(preparedValue, welderStamps, {
    allowedArchivedOfficialStamps: getArchivedOfficialStampValuesForRecord(
      preparedValue.id ? rows.find((row) => row.id === preparedValue.id) : undefined,
      welderStamps,
    ),
    ignoreArchivedMissingRegistry: otherSettings.includeArchivedWelderStampsInForm,
    suspensions: welderStampSuspensions,
  })
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
  weldFormStampSelectOptions,
  welderStamps,
  welderStampSuspensions,
}: {
  records: WeldInput[]
  skipManualJointNameValidation?: boolean
  weldFormStampSelectOptions: Partial<Record<WeldFieldKey, readonly StampSelectOptionLike[]>>
  welderStamps: WelderStampRecord[]
  welderStampSuspensions: WelderStampSuspensionRecord[]
}) {
  const preparedRecords = records
  normalizeSystemWdiForImport(preparedRecords)
  normalizeLegacyControlAvailabilityForImport(preparedRecords)
  validateRequiredRootStampsForImport(preparedRecords)
  if (!skipManualJointNameValidation) validateManualJointNamesForImport(preparedRecords)
  validateWeldDatesForImport(preparedRecords)
  normalizeWeldingMethodsForImport(preparedRecords)
  normalizeConnectionTypesForImport(preparedRecords)
  validateWelderStampFieldsForImport(preparedRecords, weldFormStampSelectOptions)
  validateOfficialStampCompatibilityForImport(preparedRecords, welderStamps, { suspensions: welderStampSuspensions })
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

function getImportRowLabel(index: number) {
  return `строка ${index + 2}`
}
