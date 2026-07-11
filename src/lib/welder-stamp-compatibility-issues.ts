import { formatDisplayDate } from '@/lib/date-format'
import {
  OFFICIAL_WELDER_STAMP_FIELD_KEYS as officialWelderStampFieldKeys,
} from '@/lib/report-config'
import type { WeldInput } from '@/lib/weld-fields'
import { formatWelderStampFieldKeyLabel } from '@/lib/welder-stamp-format'
import type {
  OfficialStampCompatibilityIssue,
  OfficialStampCompatibilityOptions,
} from '@/lib/welder-stamp-compatibility-types'
import {
  formatOfficialStampDiameterList,
  getOfficialStampJointDiameters,
  getWeldDateOrderValue,
  isWelderStampDateCompatible,
  isWelderStampDiameterCompatible,
  normalizeStampForCompare,
  normalizeStampSelectValue,
  parseOfficialStampWeldingMethods,
  splitOfficialStampWeldTypes,
} from '@/lib/welder-stamp-compatibility-utils'
import {
  formatWelderStampSuspensionBlockReason,
  getSuspensionOverlapForStamp,
} from '@/lib/welder-stamp-suspensions'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'

export function getOfficialStampCompatibilityIssues(
  record: WeldInput,
  welderStampRecords: WelderStampRecord[],
  options: OfficialStampCompatibilityOptions = {},
) {
  const activeRecords = welderStampRecords.filter((stampRecord) => !stampRecord.archived)
  const archivedRecords = welderStampRecords.filter((stampRecord) => stampRecord.archived)
  const allowedArchivedOfficialStamps = new Set(
    (options.allowedArchivedOfficialStamps ?? []).map(normalizeStampForCompare).filter(Boolean),
  )
  const methods = parseOfficialStampWeldingMethods(record.weldingMethod)
  const diameters = getOfficialStampJointDiameters(record)
  const weldDateValue = getWeldDateOrderValue(record.weldDate)
  const issues: OfficialStampCompatibilityIssue[] = []

  for (const fieldKey of officialWelderStampFieldKeys) {
    const stamp = normalizeStampSelectValue(record[fieldKey])
    if (!stamp) continue

    const suspension = getSuspensionOverlapForStamp(options.suspensions ?? [], stamp, record.weldDate)
    if (suspension) {
      issues.push({
        fieldKey,
        stamp,
        method: '',
        reason: 'suspended',
        message: `Клеймо ${stamp} ${formatWelderStampSuspensionBlockReason(suspension)}, дата сварки ${formatDisplayDate(record.weldDate) || '-'}.`,
      })
      continue
    }

    const stampRecords = activeRecords.filter(
      (stampRecord) => normalizeStampForCompare(stampRecord.naksStamp) === normalizeStampForCompare(stamp),
    )
    if (stampRecords.length === 0) {
      const isArchivedStamp = archivedRecords.some(
        (stampRecord) => normalizeStampForCompare(stampRecord.naksStamp) === normalizeStampForCompare(stamp),
      )
      if (isArchivedStamp && (options.ignoreArchivedMissingRegistry || allowedArchivedOfficialStamps.has(normalizeStampForCompare(stamp)))) {
        continue
      }

      issues.push({
        fieldKey,
        stamp,
        method: '',
        reason: 'missing-registry',
        message: `Клеймо ${stamp} не найдено в активном реестре клейм.`,
      })
      continue
    }

    if (methods.length === 0) {
      issues.push({
        fieldKey,
        stamp,
        method: '',
        reason: 'missing-weld-type',
        message: `Для клейма ${stamp} нужно указать способ сварки.`,
      })
      continue
    }

    for (const method of methods) {
      const methodRecords = stampRecords.filter((stampRecord) => splitOfficialStampWeldTypes(stampRecord).includes(method))
      if (methodRecords.length === 0) {
        issues.push({
          fieldKey,
          stamp,
          method,
          reason: 'weld-type',
          message: `Клеймо ${stamp} (${method}) не имеет допуска на способ сварки ${method}.`,
        })
        continue
      }

      const dateRecords = weldDateValue
        ? methodRecords.filter((stampRecord) => isWelderStampDateCompatible(weldDateValue, stampRecord))
        : methodRecords
      if (dateRecords.length === 0) {
        issues.push({
          fieldKey,
          stamp,
          method,
          reason: 'date',
          message: `Клеймо ${stamp} (${method}) не соответствует сроку действия на дату сварки ${formatDisplayDate(record.weldDate) || '-'}.`,
        })
        continue
      }

      if (
        diameters.length > 0 &&
        !dateRecords.some((stampRecord) => diameters.every((diameter) => isWelderStampDiameterCompatible(diameter, stampRecord)))
      ) {
        issues.push({
          fieldKey,
          stamp,
          method,
          reason: 'diameter',
          message: `Клеймо ${stamp} (${method}) не имеет допуска на диаметр ${formatOfficialStampDiameterList(diameters)}.`,
        })
      }
    }
  }

  return issues
}

export function formatOfficialStampCompatibilityIssue(issue: OfficialStampCompatibilityIssue) {
  const fieldLabel = formatWelderStampFieldKeyLabel(issue.fieldKey)
  return `${fieldLabel}: ${issue.message}`
}
