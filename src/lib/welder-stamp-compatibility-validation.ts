import type { WeldInput } from '@/lib/weld-fields'
import {
  formatOfficialStampCompatibilityIssue,
  getOfficialStampCompatibilityIssues,
} from '@/lib/welder-stamp-compatibility-issues'
import type { OfficialStampCompatibilityOptions } from '@/lib/welder-stamp-compatibility-types'
import { normalizeStampSelectValue } from '@/lib/welder-stamp-compatibility-utils'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'
import { formatSaveCheckBlockReason, type SaveCheckSettingId } from '@/lib/save-check-settings'

export function getOfficialStampCompatibilitySaveBlockReason(
  record: WeldInput,
  welderStampRecords: WelderStampRecord[],
  options: OfficialStampCompatibilityOptions = {},
) {
  const issue = getOfficialStampCompatibilityIssues(record, welderStampRecords, options)[0]
  return issue ? formatSaveCheckBlockReason(getOfficialStampIssueSaveCheckSettingId(issue.reason), formatOfficialStampCompatibilityIssue(issue)) : null
}

function getOfficialStampIssueSaveCheckSettingId(reason: string): SaveCheckSettingId {
  if (reason === 'missing-registry') return 'officialRegistry'
  if (reason === 'archived') return 'officialArchive'
  if (reason === 'suspended') return 'officialSuspension'
  if (reason === 'missing-weld-type' || reason === 'weld-type' || reason === 'team-weld-type') return 'officialWeldingMethod'
  if (reason === 'material-group') return 'officialMaterialGroup'
  if (reason === 'date') return 'officialNaksDate'
  if (reason === 'diameter') return 'officialDiameter'
  if (reason === 'thickness') return 'officialThickness'
  return 'officialDls'
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
    const issue = getOfficialStampCompatibilityIssues(record, welderStampRecords, options)[0]
    if (!issue) return

    const rowLabel = normalizeStampSelectValue(record.joint) || `строка ${index + 1}`
    throw new Error(`Импорт остановлен: ${rowLabel}. ${formatOfficialStampCompatibilityIssue(issue)}`)
  })
}
