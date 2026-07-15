import { formatDisplayDate } from '@/lib/date-format'
import {
  OFFICIAL_WELDER_STAMP_FIELD_KEYS as officialWelderStampFieldKeys,
} from '@/lib/report-config'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'
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

type OfficialStampCompatibilityEntry = {
  fieldKey: WeldFieldKey
  stamp: string
  records: WelderStampRecord[]
}

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
  const entries: OfficialStampCompatibilityEntry[] = []

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

    entries.push({ fieldKey, stamp, records: stampRecords })
  }

  const uniqueOfficialStampCount = new Set(entries.map((entry) => normalizeStampForCompare(entry.stamp))).size
  const useTeamWeldingMethodCoverage = uniqueOfficialStampCount > 1 && methods.length > 1

  if (useTeamWeldingMethodCoverage) {
    issues.push(...getTeamWeldingMethodCompatibilityIssues(entries, methods, diameters, weldDateValue, record.weldDate))
    return issues
  }

  for (const entry of entries) {
    for (const method of methods) {
      const issue = getStampMethodCompatibilityIssue(entry, method, diameters, weldDateValue, record.weldDate)
      if (issue) issues.push(issue)
    }
  }

  return issues
}

export function formatOfficialStampCompatibilityIssue(issue: OfficialStampCompatibilityIssue) {
  if (issue.reason === 'team-weld-type') return issue.message

  const fieldLabel = formatWelderStampFieldKeyLabel(issue.fieldKey)
  return `${fieldLabel}: ${issue.message}`
}

function getTeamWeldingMethodCompatibilityIssues(
  entries: OfficialStampCompatibilityEntry[],
  methods: string[],
  diameters: number[],
  weldDateValue: number,
  weldDate: unknown,
) {
  const issues: OfficialStampCompatibilityIssue[] = []
  const compatibleMethodsByStamp = new Map<string, Set<string>>()

  for (const entry of entries) {
    const compatibleMethods = new Set<string>()

    for (const method of methods) {
      if (!getStampMethodCompatibilityIssue(entry, method, diameters, weldDateValue, weldDate)) {
        compatibleMethods.add(method)
      }
    }

    compatibleMethodsByStamp.set(normalizeStampForCompare(entry.stamp), compatibleMethods)
    if (compatibleMethods.size === 0) {
      issues.push(getBestTeamStampCompatibilityIssue(entry, methods, diameters, weldDateValue, weldDate))
    }
  }

  for (const method of methods) {
    const methodCovered = [...compatibleMethodsByStamp.values()].some((compatibleMethods) => compatibleMethods.has(method))
    if (!methodCovered) {
      const firstEntry = entries[0]
      issues.push({
        fieldKey: firstEntry.fieldKey,
        stamp: firstEntry.stamp,
        method,
        reason: 'team-weld-type',
        message: `Команда официальных клейм не покрывает способ сварки ${method}. Добавьте сварщика с допуском ${method} или измените способ сварки стыка.`,
      })
    }
  }

  return issues
}

function getBestTeamStampCompatibilityIssue(
  entry: OfficialStampCompatibilityEntry,
  methods: string[],
  diameters: number[],
  weldDateValue: number,
  weldDate: unknown,
) {
  const methodIssues = methods
    .map((method) => getStampMethodCompatibilityIssue(entry, method, diameters, weldDateValue, weldDate))
    .filter((issue): issue is OfficialStampCompatibilityIssue => Boolean(issue))
  const dateIssue = methodIssues.find((issue) => issue.reason === 'date')
  const diameterIssue = methodIssues.find((issue) => issue.reason === 'diameter')
  const weldTypeIssue = methodIssues.find((issue) => issue.reason === 'weld-type')

  return dateIssue ?? diameterIssue ?? weldTypeIssue ?? {
    fieldKey: entry.fieldKey,
    stamp: entry.stamp,
    method: '',
    reason: 'weld-type',
    message: `Клеймо ${entry.stamp} не имеет допуска ни на один из способов сварки стыка: ${methods.join(', ')}.`,
  }
}

function getStampMethodCompatibilityIssue(
  entry: OfficialStampCompatibilityEntry,
  method: string,
  diameters: number[],
  weldDateValue: number,
  weldDate: unknown,
): OfficialStampCompatibilityIssue | null {
  const methodRecords = entry.records.filter((stampRecord) => splitOfficialStampWeldTypes(stampRecord).includes(method))
  if (methodRecords.length === 0) {
    return {
      fieldKey: entry.fieldKey,
      stamp: entry.stamp,
      method,
      reason: 'weld-type',
      message: `Клеймо ${entry.stamp} (${method}) не имеет допуска на способ сварки ${method}.`,
    }
  }

  const dateRecords = weldDateValue
    ? methodRecords.filter((stampRecord) => isWelderStampDateCompatible(weldDateValue, stampRecord))
    : methodRecords
  if (dateRecords.length === 0) {
    return {
      fieldKey: entry.fieldKey,
      stamp: entry.stamp,
      method,
      reason: 'date',
      message: `Клеймо ${entry.stamp} (${method}) не соответствует сроку действия на дату сварки ${formatDisplayDate(weldDate) || '-'}.`,
    }
  }

  if (
    diameters.length > 0 &&
    !dateRecords.some((stampRecord) => diameters.every((diameter) => isWelderStampDiameterCompatible(diameter, stampRecord)))
  ) {
    return {
      fieldKey: entry.fieldKey,
      stamp: entry.stamp,
      method,
      reason: 'diameter',
      message: `Клеймо ${entry.stamp} (${method}) не имеет допуска на диаметр ${formatOfficialStampDiameterList(diameters)}.`,
    }
  }

  return null
}
