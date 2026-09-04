import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'
import {
  formatOfficialStampCompatibilityIssue,
  getOfficialStampCompatibilityIssues,
} from '@/lib/welder-stamp-compatibility-issues'
import type {
  OfficialStampCompatibilityIssue,
  OfficialStampCompatibilityOptions,
} from '@/lib/welder-stamp-compatibility-types'
import { normalizeStampSelectValue } from '@/lib/welder-stamp-compatibility-utils'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'
import { formatSaveCheckBlockReason, type SaveCheckSettingId } from '@/lib/save-check-settings'

export const OFFICIAL_STAMP_VALIDATION_FIELD_KEYS = [
  'weldDate',
  'weldingMethod',
  'connectionType',
  'materialGroup',
  'd1',
  'd2',
  't1',
  't2',
  'stamp1K',
  'stamp1Z',
  'stamp1O',
  'stamp2K',
  'stamp2Z',
  'stamp2O',
] as const satisfies readonly WeldFieldKey[]

type OfficialStampValidationRecord = Partial<Record<WeldFieldKey, unknown>>

export function shouldValidateOfficialStampCompatibilityForSave(
  record: OfficialStampValidationRecord,
  previous?: OfficialStampValidationRecord,
) {
  if (!previous) return true
  return OFFICIAL_STAMP_VALIDATION_FIELD_KEYS.some(
    (fieldKey) => normalizeComparable(record[fieldKey]) !== normalizeComparable(previous[fieldKey]),
  )
}

export function getOfficialStampCompatibilitySaveBlockReason(
  record: WeldInput,
  welderStampRecords: WelderStampRecord[],
  options: OfficialStampCompatibilityOptions = {},
) {
  const issue = getOfficialStampCompatibilityIssues(record, welderStampRecords, options)[0]
  return issue ? formatSaveCheckBlockReason(getOfficialStampIssueSaveCheckSettingId(issue.reason), formatOfficialStampCompatibilityIssue(issue)) : null
}

function getOfficialStampIssueSaveCheckSettingId(
  reason: OfficialStampCompatibilityIssue['reason'],
): SaveCheckSettingId {
  switch (reason) {
    case 'missing-registry': return 'officialRegistry'
    case 'archived': return 'officialArchive'
    case 'suspended': return 'officialSuspension'
    case 'missing-weld-type':
    case 'weld-type':
    case 'team-weld-type':
      return 'officialWeldingMethod'
    case 'material-group': return 'officialMaterialGroup'
    case 'date': return 'officialNaksDate'
    case 'diameter': return 'officialDiameter'
    case 'thickness': return 'officialThickness'
    case 'dls': return 'officialDls'
  }
}

export function validateOfficialStampCompatibilityForSave(
  record: WeldInput,
  welderStampRecords: WelderStampRecord[],
  options: OfficialStampCompatibilityOptions = {},
) {
  const reason = getOfficialStampCompatibilitySaveBlockReason(record, welderStampRecords, options)
  if (reason) throw new Error(`Сохранение невозможно: ${reason}`)
}

export function validateOfficialStampCompatibilityForImport(
  records: WeldInput[],
  welderStampRecords: WelderStampRecord[],
  options: OfficialStampCompatibilityOptions = {},
) {
  records.forEach((record, index) => {
    const issues = getOfficialStampCompatibilityIssues(record, welderStampRecords, options)
    if (issues.length === 0) return

    const rowLabel = normalizeStampSelectValue(record.joint) || `строка ${index + 1}`
    throw new Error(
      `Импорт остановлен: ${rowLabel}. ${[...new Set(issues.map((issue) =>
        formatSaveCheckBlockReason(
          getOfficialStampIssueSaveCheckSettingId(issue.reason),
          formatOfficialStampCompatibilityIssue(issue),
        ),
      ))].join(' ')}`,
    )
  })
}

function normalizeComparable(value: unknown) {
  return value === null || value === undefined ? '' : String(value).trim()
}
