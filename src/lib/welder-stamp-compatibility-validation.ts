import type { WeldInput } from '@/lib/weld-fields'
import {
  formatOfficialStampCompatibilityIssue,
  getOfficialStampCompatibilityIssues,
} from '@/lib/welder-stamp-compatibility-issues'
import type { OfficialStampCompatibilityOptions } from '@/lib/welder-stamp-compatibility-types'
import { normalizeStampSelectValue } from '@/lib/welder-stamp-compatibility-utils'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'

export function getOfficialStampCompatibilitySaveBlockReason(
  record: WeldInput,
  welderStampRecords: WelderStampRecord[],
  options: OfficialStampCompatibilityOptions = {},
) {
  const issue = getOfficialStampCompatibilityIssues(record, welderStampRecords, options)[0]
  return issue ? formatOfficialStampCompatibilityIssue(issue) : null
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
) {
  records.forEach((record, index) => {
    const issue = getOfficialStampCompatibilityIssues(record, welderStampRecords)[0]
    if (!issue) return

    const rowLabel = normalizeStampSelectValue(record.joint) || `строка ${index + 1}`
    throw new Error(`Импорт остановлен: ${rowLabel}. ${formatOfficialStampCompatibilityIssue(issue)}`)
  })
}
