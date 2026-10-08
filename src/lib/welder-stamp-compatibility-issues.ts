import { formatDisplayDate } from '@/lib/date-format'
import { splitWeldMaterialGroups } from '@/lib/weld-material-groups'
import { loadSaveCheckSettings, normalizeSaveCheckSettings } from '@/lib/save-check-settings'
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
  getOfficialStampJointDimensionRequirements,
  getOfficialStampMaterialScopes,
  getUnsupportedPermitDiameters,
  getUnsupportedPermitThicknesses,
  getWelderStampArchiveCompatibility,
  getWeldDateOrderValue,
  normalizeStampForCompare,
  normalizeStampSelectValue,
  parseOfficialStampMaterialGroup,
  parseOfficialStampWeldingMethods,
  type OfficialStampJointDimensionRequirements,
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
  const saveCheckSettings = normalizeSaveCheckSettings(options.saveCheckSettings ?? loadSaveCheckSettings())
  const methods = parseOfficialStampWeldingMethods(record.weldingMethod, options.weldingTypes)
  const materialGroup = parseOfficialStampMaterialGroup(record.materialGroup, options.materialGroups)
  const dimensions = getOfficialStampJointDimensionRequirements(record)
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

    // An unknown welding method is incomplete data (SP-03), not a known
    // qualification mismatch. Check the facts that are already available.
    entries.push({ fieldKey, stamp, records: stampRecords })
  }

  const uniqueEntries = getUniqueOfficialStampEntries(entries)
  const useCombinedMethodRanges = methods.length > 1
  const useTeamWeldingMethodCoverage = saveCheckSettings.officialWeldingMethod && uniqueEntries.length > 1 && useCombinedMethodRanges

  if (splitWeldMaterialGroups(record.materialGroup).length === 2) {
    const assessments = uniqueEntries.map(entry => ({ entry, assessment: getDissimilarStampCompatibilityAssessment(entry, methods, record, saveCheckSettings) }))
    for (const { assessment } of assessments) {
      if (useTeamWeldingMethodCoverage) {
        if (assessment.compatibleMethods.size === 0) issues.push(...assessment.methodIssues.values())
        else if (assessment.rangeIssue) issues.push(assessment.rangeIssue)
      } else {
        for (const method of methods.length ? methods : ['']) {
          const issue = assessment.methodIssues.get(method)
          if (issue) issues.push(issue)
        }
        if (assessment.rangeIssue) issues.push(assessment.rangeIssue)
      }
    }
    if (useTeamWeldingMethodCoverage) for (const method of methods) {
      if (assessments.some(({ assessment }) => assessment.compatibleMethods.has(method))) continue
      const firstEntry = uniqueEntries[0]
      issues.push({ fieldKey: firstEntry.fieldKey, stamp: firstEntry.stamp, method, reason: 'team-weld-type',
        message: `Команда официальных клейм не покрывает способ ${method} для обеих групп материалов ${materialGroup}. ${assessments.map(({ assessment }) => assessment.methodIssues.get(method)?.message).filter(Boolean).join(' ')}` })
    }
    return issues
  }

  if (useTeamWeldingMethodCoverage) {
    issues.push(
      ...getTeamWeldingMethodCompatibilityIssues(
        uniqueEntries,
        methods,
        materialGroup,
        dimensions,
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
        dimensions,
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
      const issue = getStampMethodCompatibilityIssue(
        entry,
        method,
        materialGroup,
        dimensions,
        weldDateValue,
        record.weldDate,
        requireDls,
        saveCheckSettings,
      )
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
  dimensions: OfficialStampJointDimensionRequirements,
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
      dimensions,
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

/** Shared by the picker, save/import validation and dispatcher. Each method
 * must cover BOTH materials before its permits may contribute to D/T coverage. */
export function getDissimilarStampCompatibilityAssessment(
  entry: OfficialStampCompatibilityEntry,
  methods: string[],
  record: WeldInput,
  saveCheckSettings: ReturnType<typeof loadSaveCheckSettings>,
): CombinedStampCompatibilityAssessment {
  const scopes = getOfficialStampMaterialScopes(record)
  const weldDateValue = getWeldDateOrderValue(record.weldDate)
  const compatibleMethods = new Set<string>()
  const methodIssues = new Map<string, OfficialStampCompatibilityIssue>()
  const describe = (issue: OfficialStampCompatibilityIssue, scope: typeof scopes[number]) => {
    let extra = ''
    if (issue.reason === 'material-group') {
      const otherMethods = [...new Set(getNaksPermitEntries(entry.records, weldDateValue)
        .filter(({ permit }) => splitPermitValues(permit.materialGroups).includes(scope.group))
        .flatMap(({ permit }) => splitPermitValues(permit.weldType)))].filter(method => method !== issue.method)
      if (otherMethods.length) extra = ` НАКС на ${scope.group} указан для других способов: ${otherMethods.join(', ')}; он не заменяет допуск ${issue.method}.`
    }
    return { ...issue, message: `${issue.message} ${scope.label}.${extra}` }
  }
  for (const method of methods.length ? methods : ['']) {
    const errors = scopes.flatMap(scope => {
      const issue = getStampMethodCompatibilityIssue(entry, method, scope.group, emptyOfficialStampDimensions(), weldDateValue, record.weldDate, saveCheckSettings.officialDls, saveCheckSettings)
      return issue ? [describe(issue, scope)] : []
    })
    if (errors.length) methodIssues.set(method, { ...errors[0], message: errors.map(issue => issue.message).join(' ') })
    else compatibleMethods.add(method)
  }
  const rangeIssues = compatibleMethods.size === 0 ? [] : scopes.flatMap(scope => {
    const issue = methods.length > 1
      ? getCombinedStampRangeIssue(entry, [...compatibleMethods], compatibleMethods, scope.group, scope.dimensions, weldDateValue, record.weldDate, saveCheckSettings.officialDls, saveCheckSettings)
      : getStampMethodCompatibilityIssue(entry, methods[0] ?? '', scope.group, scope.dimensions, weldDateValue, record.weldDate, saveCheckSettings.officialDls, saveCheckSettings)
    return issue ? [describe(issue, scope)] : []
  })
  return { compatibleMethods, methodIssues, rangeIssue: rangeIssues.length ? { ...rangeIssues[0], message: rangeIssues.map(issue => issue.message).join(' ') } : null }
}

function getCombinedStampCompatibilityAssessment(
  entry: OfficialStampCompatibilityEntry,
  methods: string[],
  materialGroup: string,
  dimensions: OfficialStampJointDimensionRequirements,
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
      emptyOfficialStampDimensions(),
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
          dimensions,
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
  dimensions: OfficialStampJointDimensionRequirements,
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
  const unsupportedNaksDiameters = getUnsupportedJointDiameters(dimensions, effectiveNaksPermits)

  if (
    saveCheckSettings.officialDiameter &&
    unsupportedNaksDiameters.length > 0
  ) {
    if (!weldDateValue && hasCombinedArchivedRangeCandidate(entry.records, 'naks', methods, materialGroup, dimensions, saveCheckSettings)) {
      return null
    }
    return {
      fieldKey: entry.fieldKey,
      stamp: entry.stamp,
      method: methodLabel,
      reason: 'diameter',
      message: `Клеймо ${entry.stamp} (${methodLabel}) не имеет допуска ${formatPermitDimensionMismatch('diameter', unsupportedNaksDiameters, dimensions.diameterCoverage)}.`,
    }
  }

  const unsupportedNaksThicknesses = getUnsupportedJointThicknesses(dimensions, effectiveNaksPermits)
  if (
    saveCheckSettings.officialThickness &&
    unsupportedNaksThicknesses.length > 0
  ) {
    if (!weldDateValue && hasCombinedArchivedRangeCandidate(entry.records, 'naks', methods, materialGroup, dimensions, saveCheckSettings)) {
      return null
    }
    return {
      fieldKey: entry.fieldKey,
      stamp: entry.stamp,
      method: methodLabel,
      reason: 'thickness',
      message: `Клеймо ${entry.stamp} (${methodLabel}) не имеет допуска НАКС ${formatPermitDimensionMismatch('thickness', unsupportedNaksThicknesses, dimensions.thicknessCoverage)}.`,
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
  const unsupportedDlsDiameters = getUnsupportedJointDiameters(dimensions, effectiveDlsPermits)

  if (
    saveCheckSettings.officialDiameter &&
    unsupportedDlsDiameters.length > 0
  ) {
    if (!weldDateValue && hasCombinedArchivedRangeCandidate(entry.records, 'dls', methods, materialGroup, dimensions, saveCheckSettings)) {
      return null
    }
    return {
      fieldKey: entry.fieldKey,
      stamp: entry.stamp,
      method: methodLabel,
      reason: 'dls',
      message: `Клеймо ${entry.stamp} (${methodLabel}) не имеет ДЛС ${formatPermitDimensionMismatch('diameter', unsupportedDlsDiameters, dimensions.diameterCoverage)}.`,
    }
  }

  const unsupportedDlsThicknesses = getUnsupportedJointThicknesses(dimensions, effectiveDlsPermits)
  if (
    saveCheckSettings.officialThickness &&
    unsupportedDlsThicknesses.length > 0
  ) {
    if (!weldDateValue && hasCombinedArchivedRangeCandidate(entry.records, 'dls', methods, materialGroup, dimensions, saveCheckSettings)) {
      return null
    }
    return {
      fieldKey: entry.fieldKey,
      stamp: entry.stamp,
      method: methodLabel,
      reason: 'dls',
      message: `Клеймо ${entry.stamp} (${methodLabel}) не имеет ДЛС ${formatPermitDimensionMismatch('thickness', unsupportedDlsThicknesses, dimensions.thicknessCoverage)}.`,
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
  dimensions: OfficialStampJointDimensionRequirements,
  saveCheckSettings: ReturnType<typeof loadSaveCheckSettings>,
) {
  const permits = records
    .flatMap((record) => permitKind === 'naks' ? getAllWelderStampNaksPermits(record) : getAllWelderStampDlsPermits(record))
    .filter((permit) => !saveCheckSettings.officialWeldingMethod || methods.some((method) => splitPermitValues(permit.weldType).includes(method)))
    .filter((permit) => !saveCheckSettings.officialMaterialGroup || !materialGroup || splitPermitValues(permit.materialGroups).includes(materialGroup))

  return (
    permits.some((permit) => permit.archived) &&
    (!saveCheckSettings.officialDiameter || areJointDiametersCompatible(dimensions, permits)) &&
    (!saveCheckSettings.officialThickness || areJointThicknessesCompatible(dimensions, permits))
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
  dimensions: OfficialStampJointDimensionRequirements,
  weldDateValue: number,
  weldDate: unknown,
  requireDls: boolean,
  saveCheckSettings: ReturnType<typeof loadSaveCheckSettings>,
): OfficialStampCompatibilityIssue | null {
  const naksPermits = getNaksPermitEntries(entry.records, weldDateValue)
  if (
    !weldDateValue &&
    hasArchivedNaksCandidateWaitingForWeldDate(entry.records, method, materialGroup, dimensions, saveCheckSettings)
  ) {
    return null
  }

  const methodPermits = saveCheckSettings.officialWeldingMethod && method
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
  const unsupportedNaksDiameters = getUnsupportedJointDiameters(dimensions, effectiveNaksPermits)
  if (
    saveCheckSettings.officialDiameter &&
    unsupportedNaksDiameters.length > 0
  ) {
    return {
      fieldKey: entry.fieldKey,
      stamp: entry.stamp,
      method,
      reason: 'diameter',
      message: `Клеймо ${entry.stamp} (${method}) не имеет допуска ${formatPermitDimensionMismatch('diameter', unsupportedNaksDiameters, dimensions.diameterCoverage)}.`,
    }
  }

  const unsupportedNaksThicknesses = getUnsupportedJointThicknesses(dimensions, effectiveNaksPermits)
  if (
    saveCheckSettings.officialThickness &&
    unsupportedNaksThicknesses.length > 0
  ) {
    return {
      fieldKey: entry.fieldKey,
      stamp: entry.stamp,
      method,
      reason: 'thickness',
      message: `Клеймо ${entry.stamp} (${method}) не имеет допуска НАКС ${formatPermitDimensionMismatch('thickness', unsupportedNaksThicknesses, dimensions.thicknessCoverage)}.`,
    }
  }

  if (requireDls) {
    const dlsPermits = getDlsPermitEntries(entry.records, weldDateValue)
    const dlsMethod = saveCheckSettings.officialWeldingMethod ? method : ''
    const dlsMaterialGroup = saveCheckSettings.officialMaterialGroup ? materialGroup : ''
    const dlsDimensions = getCheckedOfficialStampDimensions(dimensions, saveCheckSettings)
    if (
      !weldDateValue &&
      hasArchivedDlsCandidateWaitingForWeldDate(entry.records, dlsMethod, dlsMaterialGroup, dlsDimensions)
    ) {
      return null
    }

    const dlsBlockReason = getDlsBlockReason(
      dlsPermits,
      dlsMethod,
      dlsMaterialGroup,
      dlsDimensions,
      weldDateValue,
      weldDate,
    )
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
  dimensions: OfficialStampJointDimensionRequirements,
  saveCheckSettings: ReturnType<typeof loadSaveCheckSettings>,
) {
  const permits = records
    .flatMap((record) => getAllWelderStampNaksPermits(record))
    .filter((permit) => permit.archived)
    .filter((permit) => !saveCheckSettings.officialWeldingMethod || !method || splitPermitValues(permit.weldType).includes(method))
    .filter((permit) => !saveCheckSettings.officialMaterialGroup || !materialGroup || splitPermitValues(permit.materialGroups).includes(materialGroup))
  return (
    permits.length > 0 &&
    (!saveCheckSettings.officialDiameter || areJointDiametersCompatible(dimensions, permits)) &&
    (!saveCheckSettings.officialThickness || areJointThicknessesCompatible(dimensions, permits))
  )
}

function hasArchivedDlsCandidateWaitingForWeldDate(
  records: WelderStampRecord[],
  method: string,
  materialGroup: string,
  dimensions: OfficialStampJointDimensionRequirements,
) {
  const permits = records
    .flatMap((record) => getAllWelderStampDlsPermits(record))
    .filter((permit) => permit.archived)
    .filter((permit) => !method || splitPermitValues(permit.weldType).includes(method))
    .filter((permit) => !materialGroup || splitPermitValues(permit.materialGroups).includes(materialGroup))
  return permits.length > 0 &&
    areJointDiametersCompatible(dimensions, permits) &&
    areJointThicknessesCompatible(dimensions, permits)
}

function getDlsBlockReason(
  permits: Array<PermitEntry<WelderStampDlsPermit>>,
  method: string,
  materialGroup: string,
  dimensions: OfficialStampJointDimensionRequirements,
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
  const unsupportedDiameters = getUnsupportedJointDiameters(dimensions, effectivePermits)
  if (unsupportedDiameters.length > 0) {
    return `не имеет ДЛС ${formatPermitDimensionMismatch('diameter', unsupportedDiameters, dimensions.diameterCoverage)}`
  }

  const unsupportedThicknesses = getUnsupportedJointThicknesses(dimensions, effectivePermits)
  if (unsupportedThicknesses.length > 0) {
    return `не имеет ДЛС ${formatPermitDimensionMismatch('thickness', unsupportedThicknesses, dimensions.thicknessCoverage)}`
  }

  return ''
}

function getUnsupportedJointDiameters(
  dimensions: OfficialStampJointDimensionRequirements,
  permits: Array<WelderStampNaksPermit | WelderStampDlsPermit>,
) {
  return getUnsupportedPermitDiameters(
    dimensions.diameters,
    permits,
    dimensions.diameterCoverage,
  )
}

function getUnsupportedJointThicknesses(
  dimensions: OfficialStampJointDimensionRequirements,
  permits: Array<WelderStampNaksPermit | WelderStampDlsPermit>,
) {
  return getUnsupportedPermitThicknesses(
    dimensions.thicknesses,
    permits,
    dimensions.thicknessCoverage,
  )
}

function areJointDiametersCompatible(
  dimensions: OfficialStampJointDimensionRequirements,
  permits: Array<WelderStampNaksPermit | WelderStampDlsPermit>,
) {
  return arePermitDiametersCompatible(
    dimensions.diameters,
    permits,
    dimensions.diameterCoverage,
  )
}

function areJointThicknessesCompatible(
  dimensions: OfficialStampJointDimensionRequirements,
  permits: Array<WelderStampNaksPermit | WelderStampDlsPermit>,
) {
  return arePermitThicknessesCompatible(
    dimensions.thicknesses,
    permits,
    dimensions.thicknessCoverage,
  )
}

function getCheckedOfficialStampDimensions(
  dimensions: OfficialStampJointDimensionRequirements,
  saveCheckSettings: ReturnType<typeof loadSaveCheckSettings>,
): OfficialStampJointDimensionRequirements {
  return {
    ...dimensions,
    diameters: saveCheckSettings.officialDiameter ? dimensions.diameters : [],
    thicknesses: saveCheckSettings.officialThickness ? dimensions.thicknesses : [],
  }
}

function emptyOfficialStampDimensions(): OfficialStampJointDimensionRequirements {
  return {
    diameters: [],
    thicknesses: [],
    diameterCoverage: 'all',
    thicknessCoverage: 'all',
  }
}

function formatPermitDimensionMismatch(
  kind: 'diameter' | 'thickness',
  values: number[],
  coverage: OfficialStampJointDimensionRequirements['diameterCoverage'],
) {
  const formatted = formatOfficialStampDiameterList(values)
  if (coverage === 'any' && values.length > 1) {
    return kind === 'diameter'
      ? `ни на один из диаметров ${formatted}`
      : `ни на одну из толщин ${formatted}`
  }
  if (values.length > 1) {
    return kind === 'diameter' ? `на диаметры ${formatted}` : `на толщины ${formatted}`
  }
  return kind === 'diameter' ? `на диаметр ${formatted}` : `на толщину ${formatted}`
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
