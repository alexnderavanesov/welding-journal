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
  arePermitDiametersCompatible,
  arePermitThicknessesCompatible,
  formatOfficialStampDiameterList,
  getLatestWelderStampArchiveDate,
  getOfficialStampJointDiameters,
  getOfficialStampJointThicknesses,
  getUnsupportedPermitDiameters,
  getUnsupportedPermitThicknesses,
  getWelderStampArchiveCompatibility,
  getWeldDateOrderValue,
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
  const methods = parseOfficialStampWeldingMethods(record.weldingMethod, options.weldingTypes)
  const materialGroup = parseOfficialStampMaterialGroup(record.materialGroup, options.materialGroups)
  const diameters = getOfficialStampJointDiameters(record)
  const thicknesses = getOfficialStampJointThicknesses(record)
  const weldDateValue = getWeldDateOrderValue(record.weldDate)
  const requireDls = saveCheckSettings.officialDls
  const issues: OfficialStampCompatibilityIssue[] = []
  const entries: OfficialStampCompatibilityEntry[] = []
  const checkedOfficialStamps = new Set<string>()

  for (const fieldKey of officialWelderStampFieldKeys) {
    const stamp = normalizeStampSelectValue(record[fieldKey])
    if (!stamp) continue
    const normalizedStamp = normalizeStampForCompare(stamp)
    if (checkedOfficialStamps.has(normalizedStamp)) continue
    checkedOfficialStamps.add(normalizedStamp)

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

    const stampRecords = welderStampRecords.filter(
      (stampRecord) => normalizeStampForCompare(stampRecord.naksStamp) === normalizedStamp,
    )
    if (stampRecords.length === 0) {
      if (!saveCheckSettings.officialRegistry) continue

      issues.push({
        fieldKey,
        stamp,
        method: '',
        reason: 'missing-registry',
        message: `Клеймо ${stamp} не найдено в активном реестре клейм.`,
      })
      continue
    }

    const archiveIssue = saveCheckSettings.officialArchive
      ? getWelderStampCardArchiveIssue(fieldKey, stamp, stampRecords, record.weldDate, options.archiveValidationMode ?? 'save')
      : null
    if (archiveIssue) issues.push(archiveIssue)

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

  const uniqueEntries = getUniqueOfficialStampEntries(entries)
  const useCombinedMethodRanges = methods.length > 1
  const useTeamWeldingMethodCoverage = saveCheckSettings.officialWeldingMethod && uniqueEntries.length > 1 && useCombinedMethodRanges

  if (useTeamWeldingMethodCoverage) {
    issues.push(
      ...getTeamWeldingMethodCompatibilityIssues(
        uniqueEntries,
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

  if (useCombinedMethodRanges) {
    for (const entry of uniqueEntries) {
      const assessment = getCombinedStampCompatibilityAssessment(
        entry,
        methods,
        materialGroup,
        diameters,
        thicknesses,
        weldDateValue,
        record.weldDate,
        requireDls,
        saveCheckSettings,
      )
      const missingMethod = methods.find((method) => !assessment.compatibleMethods.has(method))
      const issue = missingMethod ? assessment.methodIssues.get(missingMethod) : assessment.rangeIssue
      if (issue) issues.push(issue)
    }
    return issues
  }

  const methodsToCheck = methods.length > 0 ? methods : ['']
  for (const entry of uniqueEntries) {
    for (const method of methodsToCheck) {
      const issue = getStampMethodCompatibilityIssue(entry, method, materialGroup, diameters, thicknesses, weldDateValue, record.weldDate, requireDls, saveCheckSettings)
      if (issue) issues.push(issue)
    }
  }

  return issues
}

function getWelderStampCardArchiveIssue(
  fieldKey: WeldFieldKey,
  stamp: string,
  records: WelderStampRecord[],
  weldDate: unknown,
  mode: 'save' | 'audit',
): OfficialStampCompatibilityIssue | null {
  const compatibility = getWelderStampArchiveCompatibility(records, weldDate)
  if (compatibility === 'active' || compatibility === 'historical') return null
  if (mode === 'audit' && (compatibility === 'missing-weld-date' || compatibility === 'unknown-archive-date')) {
    return null
  }

  const archivedAt = getLatestWelderStampArchiveDate(records)
  const message =
    compatibility === 'missing-weld-date'
      ? `Клеймо ${stamp} находится в архиве. Укажите дату сварки, чтобы проверить, выполнялся ли стык до архивации.`
      : compatibility === 'unknown-archive-date'
        ? `Клеймо ${stamp} находится в архиве, дата архивации не указана.`
        : `Клеймо ${stamp} находится в архиве с ${formatDisplayDate(archivedAt)} и не может использоваться для сварки после этой даты.`

  return {
    fieldKey,
    stamp,
    method: '',
    reason: 'archived',
    message,
  }
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
    const assessment = getCombinedStampCompatibilityAssessment(
      entry,
      methods,
      materialGroup,
      diameters,
      thicknesses,
      weldDateValue,
      weldDate,
      requireDls,
      saveCheckSettings,
    )

    compatibleMethodsByStamp.set(normalizeStampForCompare(entry.stamp), assessment.compatibleMethods)
    if (assessment.compatibleMethods.size === 0) {
      issues.push(getBestCombinedMethodIssue(assessment, entry, methods))
    } else if (assessment.rangeIssue) {
      issues.push(assessment.rangeIssue)
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

type CombinedStampCompatibilityAssessment = {
  compatibleMethods: Set<string>
  methodIssues: Map<string, OfficialStampCompatibilityIssue>
  rangeIssue: OfficialStampCompatibilityIssue | null
}

function getCombinedStampCompatibilityAssessment(
  entry: OfficialStampCompatibilityEntry,
  methods: string[],
  materialGroup: string,
  diameters: number[],
  thicknesses: number[],
  weldDateValue: number,
  weldDate: unknown,
  requireDls: boolean,
  saveCheckSettings: ReturnType<typeof loadSaveCheckSettings>,
) : CombinedStampCompatibilityAssessment {
  const compatibleMethods = new Set<string>()
  const methodIssues = new Map<string, OfficialStampCompatibilityIssue>()

  for (const method of methods) {
    const issue = getStampMethodCompatibilityIssue(
      entry,
      method,
      materialGroup,
      [],
      [],
      weldDateValue,
      weldDate,
      requireDls,
      saveCheckSettings,
    )
    if (issue) methodIssues.set(method, issue)
    else compatibleMethods.add(method)
  }

  return {
    compatibleMethods,
    methodIssues,
    rangeIssue: compatibleMethods.size > 0
      ? getCombinedStampRangeIssue(
          entry,
          methods,
          compatibleMethods,
          materialGroup,
          diameters,
          thicknesses,
          weldDateValue,
          weldDate,
          requireDls,
          saveCheckSettings,
        )
      : null,
  }
}

function getBestCombinedMethodIssue(
  assessment: CombinedStampCompatibilityAssessment,
  entry: OfficialStampCompatibilityEntry,
  methods: string[],
) {
  const methodIssues = [...assessment.methodIssues.values()]
  const materialGroupIssue = methodIssues.find((issue) => issue.reason === 'material-group')
  const dateIssue = methodIssues.find((issue) => issue.reason === 'date')
  const dlsIssue = methodIssues.find((issue) => issue.reason === 'dls')
  const weldTypeIssue = methodIssues.find((issue) => issue.reason === 'weld-type')

  return materialGroupIssue ?? dateIssue ?? dlsIssue ?? weldTypeIssue ?? {
    fieldKey: entry.fieldKey,
    stamp: entry.stamp,
    method: '',
    reason: 'weld-type',
    message: `Клеймо ${entry.stamp} не имеет допуска ни на один из способов сварки стыка: ${methods.join(', ')}.`,
  }
}

function getCombinedStampRangeIssue(
  entry: OfficialStampCompatibilityEntry,
  methods: string[],
  compatibleMethods: Set<string>,
  materialGroup: string,
  diameters: number[],
  thicknesses: number[],
  weldDateValue: number,
  weldDate: unknown,
  requireDls: boolean,
  saveCheckSettings: ReturnType<typeof loadSaveCheckSettings>,
): OfficialStampCompatibilityIssue | null {
  const methodLabel = [...compatibleMethods].join('+') || methods.join('+')
  const naksPermits = getCombinedPermitEntries(
    getNaksPermitEntries(entry.records, weldDateValue),
    methods,
    materialGroup,
    weldDateValue,
    saveCheckSettings.officialWeldingMethod,
    saveCheckSettings.officialMaterialGroup,
    saveCheckSettings.officialNaksDate,
  )
  const effectiveNaksPermits = naksPermits.map(({ permit }) => permit)
  const unsupportedNaksDiameters = getUnsupportedPermitDiameters(diameters, effectiveNaksPermits)

  if (
    saveCheckSettings.officialDiameter &&
    unsupportedNaksDiameters.length > 0
  ) {
    if (!weldDateValue && hasCombinedArchivedRangeCandidate(entry.records, 'naks', methods, materialGroup, diameters, thicknesses, saveCheckSettings)) {
      return null
    }
    return {
      fieldKey: entry.fieldKey,
      stamp: entry.stamp,
      method: methodLabel,
      reason: 'diameter',
      message: `Клеймо ${entry.stamp} (${methodLabel}) не имеет допуска на диаметр ${formatOfficialStampDiameterList(unsupportedNaksDiameters)}.`,
    }
  }

  const unsupportedNaksThicknesses = getUnsupportedPermitThicknesses(thicknesses, effectiveNaksPermits)
  if (
    saveCheckSettings.officialThickness &&
    unsupportedNaksThicknesses.length > 0
  ) {
    if (!weldDateValue && hasCombinedArchivedRangeCandidate(entry.records, 'naks', methods, materialGroup, diameters, thicknesses, saveCheckSettings)) {
      return null
    }
    return {
      fieldKey: entry.fieldKey,
      stamp: entry.stamp,
      method: methodLabel,
      reason: 'thickness',
      message: `Клеймо ${entry.stamp} (${methodLabel}) не имеет допуска НАКС на толщину ${formatOfficialStampDiameterList(unsupportedNaksThicknesses)}.`,
    }
  }

  if (!requireDls) return null

  const dlsPermits = getCombinedPermitEntries(
    getDlsPermitEntries(entry.records, weldDateValue),
    methods,
    materialGroup,
    weldDateValue,
    saveCheckSettings.officialWeldingMethod,
    saveCheckSettings.officialMaterialGroup,
    true,
  )
  const effectiveDlsPermits = dlsPermits.map(({ permit }) => permit)
  const unsupportedDlsDiameters = getUnsupportedPermitDiameters(diameters, effectiveDlsPermits)

  if (
    saveCheckSettings.officialDiameter &&
    unsupportedDlsDiameters.length > 0
  ) {
    if (!weldDateValue && hasCombinedArchivedRangeCandidate(entry.records, 'dls', methods, materialGroup, diameters, thicknesses, saveCheckSettings)) {
      return null
    }
    return {
      fieldKey: entry.fieldKey,
      stamp: entry.stamp,
      method: methodLabel,
      reason: 'dls',
      message: `Клеймо ${entry.stamp} (${methodLabel}) не имеет ДЛС на диаметр ${formatOfficialStampDiameterList(unsupportedDlsDiameters)}.`,
    }
  }

  const unsupportedDlsThicknesses = getUnsupportedPermitThicknesses(thicknesses, effectiveDlsPermits)
  if (
    saveCheckSettings.officialThickness &&
    unsupportedDlsThicknesses.length > 0
  ) {
    if (!weldDateValue && hasCombinedArchivedRangeCandidate(entry.records, 'dls', methods, materialGroup, diameters, thicknesses, saveCheckSettings)) {
      return null
    }
    return {
      fieldKey: entry.fieldKey,
      stamp: entry.stamp,
      method: methodLabel,
      reason: 'dls',
      message: `Клеймо ${entry.stamp} (${methodLabel}) не имеет ДЛС на толщину ${formatOfficialStampDiameterList(unsupportedDlsThicknesses)}.`,
    }
  }

  return null
}

function getCombinedPermitEntries<TPermit extends WelderStampNaksPermit | WelderStampDlsPermit>(
  entries: Array<PermitEntry<TPermit>>,
  methods: string[],
  materialGroup: string,
  weldDateValue: number,
  checkMethod: boolean,
  checkMaterialGroup: boolean,
  checkDate: boolean,
) {
  return entries
    .filter(({ permit }) => !checkMethod || methods.some((method) => splitPermitValues(permit.weldType).includes(method)))
    .filter(({ permit }) => !checkMaterialGroup || !materialGroup || splitPermitValues(permit.materialGroups).includes(materialGroup))
    .filter(({ permit }) => !checkDate || !weldDateValue || isPermitDateCompatible(weldDateValue, permit))
}

function hasCombinedArchivedRangeCandidate(
  records: WelderStampRecord[],
  permitKind: 'naks' | 'dls',
  methods: string[],
  materialGroup: string,
  diameters: number[],
  thicknesses: number[],
  saveCheckSettings: ReturnType<typeof loadSaveCheckSettings>,
) {
  const permits = records
    .flatMap((record) => permitKind === 'naks' ? getAllWelderStampNaksPermits(record) : getAllWelderStampDlsPermits(record))
    .filter((permit) => !saveCheckSettings.officialWeldingMethod || methods.some((method) => splitPermitValues(permit.weldType).includes(method)))
    .filter((permit) => !saveCheckSettings.officialMaterialGroup || !materialGroup || splitPermitValues(permit.materialGroups).includes(materialGroup))

  return (
    permits.some((permit) => permit.archived) &&
    (!saveCheckSettings.officialDiameter || arePermitDiametersCompatible(diameters, permits)) &&
    (!saveCheckSettings.officialThickness || arePermitThicknessesCompatible(thicknesses, permits))
  )
}

function getUniqueOfficialStampEntries(entries: OfficialStampCompatibilityEntry[]) {
  const uniqueEntries = new Map<string, OfficialStampCompatibilityEntry>()
  for (const entry of entries) {
    const key = normalizeStampForCompare(entry.stamp)
    if (!uniqueEntries.has(key)) uniqueEntries.set(key, entry)
  }
  return [...uniqueEntries.values()]
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

  const effectiveNaksPermits = datePermits.map(({ permit }) => permit)
  const unsupportedNaksDiameters = getUnsupportedPermitDiameters(diameters, effectiveNaksPermits)
  if (
    saveCheckSettings.officialDiameter &&
    unsupportedNaksDiameters.length > 0
  ) {
    return {
      fieldKey: entry.fieldKey,
      stamp: entry.stamp,
      method,
      reason: 'diameter',
      message: `Клеймо ${entry.stamp} (${method}) не имеет допуска на диаметр ${formatOfficialStampDiameterList(unsupportedNaksDiameters)}.`,
    }
  }

  const unsupportedNaksThicknesses = getUnsupportedPermitThicknesses(thicknesses, effectiveNaksPermits)
  if (
    saveCheckSettings.officialThickness &&
    unsupportedNaksThicknesses.length > 0
  ) {
    return {
      fieldKey: entry.fieldKey,
      stamp: entry.stamp,
      method,
      reason: 'thickness',
      message: `Клеймо ${entry.stamp} (${method}) не имеет допуска НАКС на толщину ${formatOfficialStampDiameterList(unsupportedNaksThicknesses)}.`,
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
  const permits = records
    .flatMap((record) => getAllWelderStampNaksPermits(record))
    .filter((permit) => permit.archived)
    .filter((permit) => !saveCheckSettings.officialWeldingMethod || !method || splitPermitValues(permit.weldType).includes(method))
    .filter((permit) => !saveCheckSettings.officialMaterialGroup || !materialGroup || splitPermitValues(permit.materialGroups).includes(materialGroup))
  return (
    permits.length > 0 &&
    (!saveCheckSettings.officialDiameter || arePermitDiametersCompatible(diameters, permits)) &&
    (!saveCheckSettings.officialThickness || arePermitThicknessesCompatible(thicknesses, permits))
  )
}

function hasArchivedDlsCandidateWaitingForWeldDate(
  records: WelderStampRecord[],
  method: string,
  materialGroup: string,
  diameters: number[],
  thicknesses: number[],
) {
  const permits = records
    .flatMap((record) => getAllWelderStampDlsPermits(record))
    .filter((permit) => permit.archived)
    .filter((permit) => !method || splitPermitValues(permit.weldType).includes(method))
    .filter((permit) => !materialGroup || splitPermitValues(permit.materialGroups).includes(materialGroup))
  return permits.length > 0 && arePermitDiametersCompatible(diameters, permits) && arePermitThicknessesCompatible(thicknesses, permits)
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

  const effectivePermits = datePermits.map(({ permit }) => permit)
  const unsupportedDiameters = getUnsupportedPermitDiameters(diameters, effectivePermits)
  if (unsupportedDiameters.length > 0) {
    return `не имеет ДЛС на диаметр ${formatOfficialStampDiameterList(unsupportedDiameters)}`
  }

  const unsupportedThicknesses = getUnsupportedPermitThicknesses(thicknesses, effectivePermits)
  if (unsupportedThicknesses.length > 0) {
    return `не имеет ДЛС на толщину ${formatOfficialStampDiameterList(unsupportedThicknesses)}`
  }

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
