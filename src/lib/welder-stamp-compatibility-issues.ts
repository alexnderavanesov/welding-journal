import { formatDisplayDate } from '@/lib/date-format'
import { loadSaveCheckSettings } from '@/lib/save-check-settings'
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
  getOfficialStampJointThicknesses,
  getWeldDateOrderValue,
  isPermitDiameterCompatible,
  isPermitThicknessCompatible,
  normalizeStampForCompare,
  normalizeStampSelectValue,
  parseOfficialStampMaterialGroup,
  parseOfficialStampWeldingMethods,
} from '@/lib/welder-stamp-compatibility-utils'
import {
  getAllWelderStampDlsPermits,
  getAllWelderStampNaksPermits,
  getWelderStampDlsPermitsForWeldDate,
  getWelderStampNaksPermitsForWeldDate,
  splitPermitValues,
} from '@/lib/welder-stamp-permits'
import {
  formatWelderStampSuspensionBlockReason,
  getSuspensionOverlapForStamp,
} from '@/lib/welder-stamp-suspensions'
import type { WelderStampDlsPermit, WelderStampNaksPermit, WelderStampRecord } from '@/lib/welder-stamp-types'

type OfficialStampCompatibilityEntry = {
  fieldKey: WeldFieldKey
  stamp: string
  records: WelderStampRecord[]
}

type PermitEntry<TPermit extends WelderStampNaksPermit | WelderStampDlsPermit> = {
  permit: TPermit
}

export function getOfficialStampCompatibilityIssues(
  record: WeldInput,
  welderStampRecords: WelderStampRecord[],
  options: OfficialStampCompatibilityOptions = {},
) {
  const saveCheckSettings = options.saveCheckSettings ?? loadSaveCheckSettings()
  const activeRecords = saveCheckSettings.officialArchive ? welderStampRecords.filter((stampRecord) => !stampRecord.archived) : welderStampRecords
  const archivedRecords = welderStampRecords.filter((stampRecord) => stampRecord.archived)
  const allowedArchivedOfficialStamps = new Set(
    (options.allowedArchivedOfficialStamps ?? []).map(normalizeStampForCompare).filter(Boolean),
  )
  const methods = parseOfficialStampWeldingMethods(record.weldingMethod)
  const materialGroup = parseOfficialStampMaterialGroup(record.materialGroup)
  const diameters = getOfficialStampJointDiameters(record)
  const thicknesses = getOfficialStampJointThicknesses(record)
  const weldDateValue = getWeldDateOrderValue(record.weldDate)
  const requireDls = saveCheckSettings.officialDls
  const issues: OfficialStampCompatibilityIssue[] = []
  const entries: OfficialStampCompatibilityEntry[] = []

  for (const fieldKey of officialWelderStampFieldKeys) {
    const stamp = normalizeStampSelectValue(record[fieldKey])
    if (!stamp) continue

    const suspension = saveCheckSettings.officialSuspension ? getSuspensionOverlapForStamp(options.suspensions ?? [], stamp, record.weldDate) : null
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
      if (
        !saveCheckSettings.officialRegistry ||
        (isArchivedStamp && (options.ignoreArchivedMissingRegistry || allowedArchivedOfficialStamps.has(normalizeStampForCompare(stamp))))
      ) {
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

    if (saveCheckSettings.officialWeldingMethod && methods.length === 0) {
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
  const useTeamWeldingMethodCoverage = saveCheckSettings.officialWeldingMethod && uniqueOfficialStampCount > 1 && methods.length > 1

  if (useTeamWeldingMethodCoverage) {
    issues.push(
      ...getTeamWeldingMethodCompatibilityIssues(
        entries,
        methods,
        materialGroup,
        diameters,
        thicknesses,
        weldDateValue,
        record.weldDate,
        requireDls,
        saveCheckSettings,
      ),
    )
    return issues
  }

  const methodsToCheck = methods.length > 0 ? methods : ['']
  for (const entry of entries) {
    for (const method of methodsToCheck) {
      const issue = getStampMethodCompatibilityIssue(entry, method, materialGroup, diameters, thicknesses, weldDateValue, record.weldDate, requireDls, saveCheckSettings)
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
  materialGroup: string,
  diameters: number[],
  thicknesses: number[],
  weldDateValue: number,
  weldDate: unknown,
  requireDls: boolean,
  saveCheckSettings: ReturnType<typeof loadSaveCheckSettings>,
) {
  const issues: OfficialStampCompatibilityIssue[] = []
  const compatibleMethodsByStamp = new Map<string, Set<string>>()

  for (const entry of entries) {
    const compatibleMethods = new Set<string>()

    for (const method of methods) {
      if (!getStampMethodCompatibilityIssue(entry, method, materialGroup, diameters, thicknesses, weldDateValue, weldDate, requireDls, saveCheckSettings)) {
        compatibleMethods.add(method)
      }
    }

    compatibleMethodsByStamp.set(normalizeStampForCompare(entry.stamp), compatibleMethods)
    if (compatibleMethods.size === 0) {
      issues.push(getBestTeamStampCompatibilityIssue(entry, methods, materialGroup, diameters, thicknesses, weldDateValue, weldDate, requireDls, saveCheckSettings))
    }
  }

  if (saveCheckSettings.officialWeldingMethod) for (const method of methods) {
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
  materialGroup: string,
  diameters: number[],
  thicknesses: number[],
  weldDateValue: number,
  weldDate: unknown,
  requireDls: boolean,
  saveCheckSettings: ReturnType<typeof loadSaveCheckSettings>,
) {
  const methodIssues = methods
    .map((method) => getStampMethodCompatibilityIssue(entry, method, materialGroup, diameters, thicknesses, weldDateValue, weldDate, requireDls, saveCheckSettings))
    .filter((issue): issue is OfficialStampCompatibilityIssue => Boolean(issue))
  const materialGroupIssue = methodIssues.find((issue) => issue.reason === 'material-group')
  const dateIssue = methodIssues.find((issue) => issue.reason === 'date')
  const diameterIssue = methodIssues.find((issue) => issue.reason === 'diameter')
  const thicknessIssue = methodIssues.find((issue) => issue.reason === 'thickness')
  const dlsIssue = methodIssues.find((issue) => issue.reason === 'dls')
  const weldTypeIssue = methodIssues.find((issue) => issue.reason === 'weld-type')

  return materialGroupIssue ?? dateIssue ?? diameterIssue ?? thicknessIssue ?? dlsIssue ?? weldTypeIssue ?? {
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
  materialGroup: string,
  diameters: number[],
  thicknesses: number[],
  weldDateValue: number,
  weldDate: unknown,
  requireDls: boolean,
  saveCheckSettings: ReturnType<typeof loadSaveCheckSettings>,
): OfficialStampCompatibilityIssue | null {
  const naksPermits = getNaksPermitEntries(entry.records, weldDateValue)
  if (
    !weldDateValue &&
    hasArchivedNaksCandidateWaitingForWeldDate(entry.records, method, materialGroup, diameters, thicknesses, saveCheckSettings)
  ) {
    return null
  }

  const methodPermits = saveCheckSettings.officialWeldingMethod
    ? naksPermits.filter(({ permit }) => splitPermitValues(permit.weldType).includes(method))
    : naksPermits
  if (saveCheckSettings.officialWeldingMethod && methodPermits.length === 0) {
    return {
      fieldKey: entry.fieldKey,
      stamp: entry.stamp,
      method,
      reason: 'weld-type',
      message: `Клеймо ${entry.stamp} (${method}) не имеет допуска на способ сварки ${method}.`,
    }
  }

  const materialGroupPermits = materialGroup
    ? methodPermits.filter(({ permit }) => splitPermitValues(permit.materialGroups).includes(materialGroup))
    : methodPermits
  if (saveCheckSettings.officialMaterialGroup && materialGroup && materialGroupPermits.length === 0) {
    return {
      fieldKey: entry.fieldKey,
      stamp: entry.stamp,
      method,
      reason: 'material-group',
      message: `Клеймо ${entry.stamp} (${method}) не имеет допуска на группу материалов ${materialGroup}.`,
    }
  }

  const effectiveMaterialGroupPermits = saveCheckSettings.officialMaterialGroup ? materialGroupPermits : methodPermits
  const datePermits = saveCheckSettings.officialNaksDate && weldDateValue
    ? effectiveMaterialGroupPermits.filter(({ permit }) => isPermitDateCompatible(weldDateValue, permit))
    : effectiveMaterialGroupPermits
  if (saveCheckSettings.officialNaksDate && datePermits.length === 0) {
    return {
      fieldKey: entry.fieldKey,
      stamp: entry.stamp,
      method,
      reason: 'date',
      message: `Клеймо ${entry.stamp} (${method}) не соответствует сроку действия на дату сварки ${formatDisplayDate(weldDate) || '-'}.`,
    }
  }

  const diameterPermits = saveCheckSettings.officialDiameter && diameters.length > 0
    ? datePermits.filter(({ permit }) => diameters.every((diameter) => isPermitDiameterCompatible(diameter, permit)))
    : datePermits
  if (saveCheckSettings.officialDiameter && diameters.length > 0 && diameterPermits.length === 0) {
    return {
      fieldKey: entry.fieldKey,
      stamp: entry.stamp,
      method,
      reason: 'diameter',
      message: `Клеймо ${entry.stamp} (${method}) не имеет допуска на диаметр ${formatOfficialStampDiameterList(diameters)}.`,
    }
  }

  const thicknessPermits = saveCheckSettings.officialThickness && thicknesses.length > 0
    ? diameterPermits.filter(({ permit }) => thicknesses.every((thickness) => isPermitThicknessCompatible(thickness, permit)))
    : diameterPermits
  if (saveCheckSettings.officialThickness && thicknesses.length > 0 && thicknessPermits.length === 0) {
    return {
      fieldKey: entry.fieldKey,
      stamp: entry.stamp,
      method,
      reason: 'thickness',
      message: `Клеймо ${entry.stamp} (${method}) не имеет допуска НАКС на толщину ${formatOfficialStampDiameterList(thicknesses)}.`,
    }
  }

  if (requireDls) {
    const dlsPermits = getDlsPermitEntries(entry.records, weldDateValue)
    const dlsMethod = saveCheckSettings.officialWeldingMethod ? method : ''
    const dlsMaterialGroup = saveCheckSettings.officialMaterialGroup ? materialGroup : ''
    const dlsDiameters = saveCheckSettings.officialDiameter ? diameters : []
    const dlsThicknesses = saveCheckSettings.officialThickness ? thicknesses : []
    if (
      !weldDateValue &&
      hasArchivedDlsCandidateWaitingForWeldDate(entry.records, dlsMethod, dlsMaterialGroup, dlsDiameters, dlsThicknesses)
    ) {
      return null
    }

    const dlsBlockReason = getDlsBlockReason(dlsPermits, dlsMethod, dlsMaterialGroup, dlsDiameters, dlsThicknesses, weldDateValue, weldDate)
    if (dlsBlockReason) {
      return {
        fieldKey: entry.fieldKey,
        stamp: entry.stamp,
        method,
        reason: 'dls',
        message: `Клеймо ${entry.stamp} (${method}) ${dlsBlockReason}.`,
      }
    }
  }

  return null
}

function hasArchivedNaksCandidateWaitingForWeldDate(
  records: WelderStampRecord[],
  method: string,
  materialGroup: string,
  diameters: number[],
  thicknesses: number[],
  saveCheckSettings: ReturnType<typeof loadSaveCheckSettings>,
) {
  return records
    .flatMap((record) => getAllWelderStampNaksPermits(record))
    .filter((permit) => permit.archived)
    .filter((permit) => !saveCheckSettings.officialWeldingMethod || !method || splitPermitValues(permit.weldType).includes(method))
    .filter((permit) => !saveCheckSettings.officialMaterialGroup || !materialGroup || splitPermitValues(permit.materialGroups).includes(materialGroup))
    .some((permit) =>
      (!saveCheckSettings.officialDiameter || diameters.every((diameter) => isPermitDiameterCompatible(diameter, permit))) &&
      (!saveCheckSettings.officialThickness || thicknesses.every((thickness) => isPermitThicknessCompatible(thickness, permit))),
    )
}

function hasArchivedDlsCandidateWaitingForWeldDate(
  records: WelderStampRecord[],
  method: string,
  materialGroup: string,
  diameters: number[],
  thicknesses: number[],
) {
  return records
    .flatMap((record) => getAllWelderStampDlsPermits(record))
    .filter((permit) => permit.archived)
    .filter((permit) => !method || splitPermitValues(permit.weldType).includes(method))
    .filter((permit) => !materialGroup || splitPermitValues(permit.materialGroups).includes(materialGroup))
    .some((permit) =>
      diameters.every((diameter) => isPermitDiameterCompatible(diameter, permit)) &&
      thicknesses.every((thickness) => isPermitThicknessCompatible(thickness, permit)),
    )
}

function getDlsBlockReason(
  permits: Array<PermitEntry<WelderStampDlsPermit>>,
  method: string,
  materialGroup: string,
  diameters: number[],
  thicknesses: number[],
  weldDateValue: number,
  weldDate: unknown,
) {
  const methodPermits = method ? permits.filter(({ permit }) => splitPermitValues(permit.weldType).includes(method)) : permits
  if (methodPermits.length === 0) return method ? `не имеет ДЛС на способ сварки ${method}` : 'не имеет ДЛС'

  const materialGroupPermits = materialGroup
    ? methodPermits.filter(({ permit }) => splitPermitValues(permit.materialGroups).includes(materialGroup))
    : methodPermits
  if (materialGroup && materialGroupPermits.length === 0) return `не имеет ДЛС на группу материалов ${materialGroup}`

  const datePermits = weldDateValue
    ? materialGroupPermits.filter(({ permit }) => isPermitDateCompatible(weldDateValue, permit))
    : materialGroupPermits
  if (weldDateValue && datePermits.length === 0) return `не имеет ДЛС на дату сварки ${formatDisplayDate(weldDate) || '-'}`

  const diameterPermits = diameters.length > 0
    ? datePermits.filter(({ permit }) => diameters.every((diameter) => isPermitDiameterCompatible(diameter, permit)))
    : datePermits
  if (diameters.length > 0 && diameterPermits.length === 0) return `не имеет ДЛС на диаметр ${formatOfficialStampDiameterList(diameters)}`

  const thicknessPermits = thicknesses.length > 0
    ? diameterPermits.filter(({ permit }) => thicknesses.every((thickness) => isPermitThicknessCompatible(thickness, permit)))
    : diameterPermits
  if (thicknesses.length > 0 && thicknessPermits.length === 0) return `не имеет ДЛС на толщину ${formatOfficialStampDiameterList(thicknesses)}`

  return ''
}

function getNaksPermitEntries(records: WelderStampRecord[], weldDateValue: number): Array<PermitEntry<WelderStampNaksPermit>> {
  return records.flatMap((record) => getWelderStampNaksPermitsForWeldDate(record, weldDateValue).map((permit) => ({ permit })))
}

function getDlsPermitEntries(records: WelderStampRecord[], weldDateValue: number): Array<PermitEntry<WelderStampDlsPermit>> {
  return records.flatMap((record) => getWelderStampDlsPermitsForWeldDate(record, weldDateValue).map((permit) => ({ permit })))
}

function isPermitDateCompatible(weldDateValue: number, permit: Pick<WelderStampNaksPermit, 'validFrom' | 'validTo'>) {
  const validFrom = getWeldDateOrderValue(permit.validFrom)
  const validTo = getWeldDateOrderValue(permit.validTo)
  return (!validFrom || weldDateValue >= validFrom) && (!validTo || weldDateValue <= validTo)
}
