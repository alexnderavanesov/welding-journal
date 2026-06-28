import { buildRepeatedJointDraft } from '@/lib/repeated-joint-draft'
import {
  validateManualJointNameForSave,
  validateManualJointNamesForImport,
  validateRequiredRootStampForSave,
  validateRequiredRootStampsForImport,
  validateWeldDatesForImport,
} from '@/lib/weld-validation'
import { normalizeWeldingMethodsForImport, validateWelderStampFieldsForImport } from '@/lib/welder-stamp-import'
import {
  validateOfficialStampCompatibilityForImport,
  validateOfficialStampCompatibilityForSave,
} from '@/lib/welder-stamp-compatibility'
import type {
  RepeatedJointCoilTask,
  RepeatedJointCreateTask,
  RepeatedJointRenameTask,
  WeldDraft,
  WeldRow,
} from '@/lib/dispatcher-types'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'
import type { StampSelectOptionLike } from '@/lib/weld-journal-mutation-types'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'

export function prepareWeldSaveValue({
  value,
  rows,
  welderStamps,
}: {
  value: WeldDraft
  rows: WeldRow[]
  welderStamps: WelderStampRecord[]
}) {
  const preparedValue = value
  validateRequiredRootStampForSave(preparedValue)
  validateManualJointNameForSave(preparedValue, rows)
  validateOfficialStampCompatibilityForSave(preparedValue, welderStamps)
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
  weldFormStampSelectOptions,
  welderStamps,
}: {
  records: WeldInput[]
  weldFormStampSelectOptions: Partial<Record<WeldFieldKey, readonly StampSelectOptionLike[]>>
  welderStamps: WelderStampRecord[]
}) {
  const preparedRecords = records
  validateRequiredRootStampsForImport(preparedRecords)
  validateManualJointNamesForImport(preparedRecords)
  validateWeldDatesForImport(preparedRecords)
  normalizeWeldingMethodsForImport(preparedRecords)
  validateWelderStampFieldsForImport(preparedRecords, weldFormStampSelectOptions)
  validateOfficialStampCompatibilityForImport(preparedRecords, welderStamps)
  return preparedRecords
}
