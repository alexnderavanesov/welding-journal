import {
  FACTUAL_WELDER_STAMP_FIELD_KEYS as factualWelderStampFieldKeys,
  OFFICIAL_WELDER_STAMP_FIELD_KEYS as officialWelderStampFieldKeys,
} from '@/lib/report-config'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'
import type { StampSelectOption } from '@/lib/weld-form-utils'
import { formatDisplayDate } from '@/lib/date-format'
import { splitWeldMaterialGroups } from '@/lib/weld-material-groups'
import { getDissimilarStampCompatibilityAssessment } from '@/lib/welder-stamp-compatibility-issues'
import {
  formatWelderStampSuspensionBlockReason,
  getSuspensionOverlapForStamp,
} from '@/lib/welder-stamp-suspensions'
import type { WelderStampRecord, WelderStampSuspensionRecord } from '@/lib/welder-stamp-types'
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
import { loadSaveCheckSettings, normalizeSaveCheckSettings, type SaveCheckSettings } from '@/lib/save-check-settings'
import {
  getAllWelderStampDlsPermits,
  getAllWelderStampNaksPermits,
  getWelderStampDlsPermitsForWeldDate,
  getWelderStampNaksPermitsForWeldDate,
  splitPermitValues,
} from '@/lib/welder-stamp-permits'
import type { WelderStampDlsPermit, WelderStampNaksPermit } from '@/lib/welder-stamp-types'

export function buildWeldFormStampSelectOptions(
  records: WelderStampRecord[],
  draft?: WeldInput,
  suspensions: readonly WelderStampSuspensionRecord[] = [],
  options: { saveCheckSettings?: SaveCheckSettings } = {},
): Partial<Record<WeldFieldKey, readonly StampSelectOption[]>> {
  const saveCheckSettings = normalizeSaveCheckSettings(options.saveCheckSettings ?? loadSaveCheckSettings())
  const selected = new Set(officialWelderStampFieldKeys.map(key => normalizeStampForCompare(draft?.[key])))
  const officialRecords = groupStampRecords(records, record => record.naksStamp)
  const officialOptions = uniqueStampValues(records.map(record => record.naksStamp)).flatMap(value => {
    const stampRecords = officialRecords.get(normalizeStampForCompare(value))!
    const suspension = draft ? getSuspensionOverlapForStamp(suspensions, value, draft.weldDate) : null
    const archiveReason = draft ? getWelderStampCardArchiveSelectReason(stampRecords, draft.weldDate) : null
    const availabilityReason = suspension
      ? hardReason(formatWelderStampSuspensionBlockReason(suspension)) : archiveReason
    // Keep a previously selected value visible with an explanation when the date
    // changes, but do not offer unavailable stamps for a new selection.
    if (availabilityReason?.hard && !selected.has(normalizeStampForCompare(value))) return []
    const blockReason = availabilityReason ?? (draft
      ? getOfficialStampSelectBlockReason(value, draft, stampRecords, saveCheckSettings) : null)
    return [{ value, ...archiveLabel(value, stampRecords), disabled: Boolean(blockReason?.hard), reason: blockReason?.reason }]
  })
  const factualValue = (record: WelderStampRecord) => normalizeStampSelectValue(record.naksStamp) || normalizeStampSelectValue(record.internalStamp)
  const factualRecords = groupStampRecords(records, factualValue)
  const factualOptions = uniqueStampValues(records.map(factualValue)).map(value => ({
    value, ...archiveLabel(value, factualRecords.get(normalizeStampForCompare(value))!),
  }))

  return {
    ...Object.fromEntries(officialWelderStampFieldKeys.map(fieldKey => [fieldKey, officialOptions])),
    ...Object.fromEntries(factualWelderStampFieldKeys.map(fieldKey => [fieldKey, factualOptions])),
  }
}

function groupStampRecords(records: WelderStampRecord[], value: (record: WelderStampRecord) => string) {
  const grouped = new Map<string, WelderStampRecord[]>()
  for (const record of records) {
    const key = normalizeStampForCompare(value(record))
    const entries = grouped.get(key) ?? []
    entries.push(record)
    grouped.set(key, entries)
  }
  return grouped
}

function archiveLabel(value: string, records: WelderStampRecord[]) {
  return records.every(record => record.archived) ? { label: `${value} (в архиве)` } : {}
}

type SelectBlockReason = {
  reason: string
  hard: boolean
}

function getWelderStampCardArchiveSelectReason(
  records: WelderStampRecord[],
  weldDate: unknown,
): SelectBlockReason | null {
  const compatibility = getWelderStampArchiveCompatibility(records, weldDate)
  if (compatibility === 'active' || compatibility === 'historical') return null
  if (compatibility === 'missing-weld-date') {
    return null
  }
  if (compatibility === 'unknown-archive-date') {
    return hardReason('клеймо в архиве, дата архивации не указана')
  }

  const archivedAt = getLatestWelderStampArchiveDate(records)
  return hardReason(`клеймо в архиве с ${formatDisplayDate(archivedAt)}`)
}

function getOfficialStampSelectBlockReason(stamp: string, draft: WeldInput, records: WelderStampRecord[], saveCheckSettings: SaveCheckSettings): SelectBlockReason | null {
  const stampRecords = records.filter(
    (record) => normalizeStampForCompare(record.naksStamp) === normalizeStampForCompare(stamp),
  )
  if (stampRecords.length === 0) return saveCheckSettings.officialRegistry ? hardReason('нет в реестре') : null

  const methods = parseOfficialStampWeldingMethods(draft.weldingMethod)
  if (splitWeldMaterialGroups(draft.materialGroup).length === 2) {
    const assessment = getDissimilarStampCompatibilityAssessment({ fieldKey: 'stamp1K', stamp, records: stampRecords }, methods, draft, saveCheckSettings)
    const reasons = assessment.compatibleMethods.size === 0
      ? [...assessment.methodIssues.values()].map(issue => issue.message)
      : assessment.rangeIssue ? [assessment.rangeIssue.message] : []
    if (reasons.length) return hardReason(reasons.join(' '))
    if (!getWeldDateOrderValue(draft.weldDate)) {
      for (const scope of getOfficialStampMaterialScopes(draft)) {
        const waiting = getCombinedMethodArchivedDateReason(stampRecords, [...assessment.compatibleMethods], scope.group, scope.dimensions, saveCheckSettings.officialDls, saveCheckSettings)
        if (waiting) return { ...waiting, reason: `${scope.label}. ${waiting.reason}` }
      }
    }
    return null
  }
  const materialGroup = parseOfficialStampMaterialGroup(draft.materialGroup)
  const dimensions = getOfficialStampJointDimensionRequirements(draft)
  const weldDateValue = getWeldDateOrderValue(draft.weldDate)
  const requireDls = saveCheckSettings.officialDls
  if (
    methods.length === 0 &&
    dimensions.diameters.length === 0 &&
    dimensions.thicknesses.length === 0 &&
    !weldDateValue &&
    !materialGroup &&
    !requireDls
  ) return null

  if (!saveCheckSettings.officialWeldingMethod || methods.length === 0) {
    const permits = getNaksPermitCandidates(
      stampRecords,
      '',
      saveCheckSettings.officialMaterialGroup ? materialGroup : '',
      saveCheckSettings.officialNaksDate ? weldDateValue : 0,
    )
    if (weldDateValue && permits.length === 0) {
      return getNaksArchiveAwareReason(stampRecords, weldDateValue, 'нет подходящего допуска НАКС на дату сварки')
    }
    if (saveCheckSettings.officialMaterialGroup && materialGroup && permits.length === 0) {
      return getNaksArchiveAwareReason(stampRecords, saveCheckSettings.officialNaksDate ? weldDateValue : 0, `не подходит по группе материалов ${materialGroup}`)
    }
    const rangeReason = getPermitRangeBlockReason(permits, dimensions, saveCheckSettings)
    if (rangeReason) return rangeReason
    if (requireDls) {
      const dlsReason = getDlsSelectBlockReason(
        stampRecords,
        '',
        saveCheckSettings.officialMaterialGroup ? materialGroup : '',
        weldDateValue,
        getCheckedOfficialStampDimensions(dimensions, saveCheckSettings),
      )
      if (dlsReason) return dlsReason
    }
    return null
  }

  if (saveCheckSettings.officialWeldingMethod && methods.length > 1) {
    const checkedMaterialGroup = saveCheckSettings.officialMaterialGroup ? materialGroup : ''
    const checkedWeldDateValue = saveCheckSettings.officialNaksDate ? weldDateValue : 0
    const archivedDateReason = !weldDateValue
      ? getCombinedMethodArchivedDateReason(
          stampRecords,
          methods,
          checkedMaterialGroup,
          dimensions,
          requireDls,
          saveCheckSettings,
        )
      : null
    if (archivedDateReason) return archivedDateReason

    const naksMethods = new Set(
      methods.filter((method) => getNaksPermitCandidates(stampRecords, method, checkedMaterialGroup, checkedWeldDateValue).length > 0),
    )
    const dlsMethods = requireDls
      ? new Set(methods.filter((method) => (
          getDlsPermitCandidates(
            stampRecords,
            method,
            checkedMaterialGroup,
            weldDateValue,
            emptyOfficialStampDimensions(),
          ).length > 0
        )))
      : new Set(methods)
    const compatibleMethods = methods.filter((method) => naksMethods.has(method) && dlsMethods.has(method))

    if (compatibleMethods.length > 0) {
      const combinedNaksPermits = getNaksPermitCandidatesForMethods(
        stampRecords,
        methods,
        checkedMaterialGroup,
        checkedWeldDateValue,
      )
      const rangeReason = getPermitRangeBlockReason(combinedNaksPermits, dimensions, saveCheckSettings)
      if (rangeReason) return rangeReason

      if (requireDls) {
        const dlsReason = getCombinedDlsSelectBlockReason(
          stampRecords,
          methods,
          checkedMaterialGroup,
          weldDateValue,
          getCheckedOfficialStampDimensions(dimensions, saveCheckSettings),
        )
        if (dlsReason) return dlsReason
      }

      return null
    }
  }

  for (const method of methods) {
    const methodPermits = getNaksPermitCandidates(stampRecords, method, '', saveCheckSettings.officialNaksDate ? weldDateValue : 0)
    if (methodPermits.length === 0) {
      return getNaksArchiveAwareReason(stampRecords, saveCheckSettings.officialNaksDate ? weldDateValue : 0, `не подходит по способу сварки ${method}`)
    }
    const materialGroupPermits = getNaksPermitCandidates(
      stampRecords,
      method,
      saveCheckSettings.officialMaterialGroup ? materialGroup : '',
      saveCheckSettings.officialNaksDate ? weldDateValue : 0,
    )
    if (saveCheckSettings.officialMaterialGroup && materialGroup && materialGroupPermits.length === 0) {
      return getNaksArchiveAwareReason(stampRecords, saveCheckSettings.officialNaksDate ? weldDateValue : 0, `не подходит по группе материалов ${materialGroup}`)
    }
    const rangeReason = getPermitRangeBlockReason(
      saveCheckSettings.officialMaterialGroup ? materialGroupPermits : methodPermits,
      dimensions,
      saveCheckSettings,
    )
    if (rangeReason) return rangeReason
    if (requireDls) {
      const dlsReason = getDlsSelectBlockReason(
        stampRecords,
        saveCheckSettings.officialWeldingMethod ? method : '',
        saveCheckSettings.officialMaterialGroup ? materialGroup : '',
        weldDateValue,
        getCheckedOfficialStampDimensions(dimensions, saveCheckSettings),
      )
      if (dlsReason) return dlsReason
    }
  }

  return null
}

function getCombinedMethodArchivedDateReason(
  records: WelderStampRecord[],
  methods: string[],
  materialGroup: string,
  dimensions: OfficialStampJointDimensionRequirements,
  requireDls: boolean,
  saveCheckSettings: SaveCheckSettings,
) {
  for (const method of methods) {
    const activeNaksCandidates = getNaksPermitCandidates(records, method, materialGroup, 0)
    const activeNaksFits = activeNaksCandidates.length > 0 &&
      !getPermitRangeBlockReason(activeNaksCandidates, dimensions, saveCheckSettings)
    if (!activeNaksFits && hasArchivedNaksCandidate(records, method, materialGroup, dimensions, saveCheckSettings)) {
      return softReason('есть архивный НАКС: укажите дату сварки')
    }

    const dlsDimensions = getCheckedOfficialStampDimensions(dimensions, saveCheckSettings)
    if (
      requireDls &&
      activeNaksFits &&
      getDlsPermitCandidates(records, method, materialGroup, 0, dlsDimensions).length === 0
    ) {
      if (hasArchivedDlsCandidate(records, method, materialGroup, dlsDimensions)) {
        return softReason('есть архивный ДЛС: укажите дату сварки')
      }
    }
  }

  return null
}

function getDlsSelectBlockReason(
  records: WelderStampRecord[],
  method: string,
  materialGroup: string,
  weldDateValue: number,
  dimensions: OfficialStampJointDimensionRequirements,
) {
  const allDlsPermits = records.flatMap((record) => getAllWelderStampDlsPermits(record))
  if (allDlsPermits.length === 0) return hardReason(method ? `нет ДЛС на способ сварки ${method}` : 'нет ДЛС')

  const dlsPermits = records.flatMap((record) => getWelderStampDlsPermitsForWeldDate(record, weldDateValue))
  if (dlsPermits.length === 0) {
    return softReason(weldDateValue ? 'архивный ДЛС не подходит по дате сварки' : 'есть архивный ДЛС: укажите дату сварки')
  }
  const methodPermits = method ? dlsPermits.filter((permit) => splitPermitValues(permit.weldType).includes(method)) : dlsPermits
  if (methodPermits.length === 0) return getDlsArchiveAwareReason(allDlsPermits, weldDateValue, method ? `нет ДЛС на способ сварки ${method}` : 'нет ДЛС')

  const materialGroupPermits = materialGroup
    ? methodPermits.filter((permit) => splitPermitValues(permit.materialGroups).includes(materialGroup))
    : methodPermits
  if (materialGroup && materialGroupPermits.length === 0) return getDlsArchiveAwareReason(allDlsPermits, weldDateValue, `нет ДЛС на группу материалов ${materialGroup}`)

  const datePermits = weldDateValue
    ? materialGroupPermits.filter((permit) => isPermitDateCompatible(weldDateValue, permit))
    : materialGroupPermits
  if (weldDateValue && datePermits.length === 0) return getDlsArchiveAwareReason(allDlsPermits, weldDateValue, 'нет ДЛС на дату сварки')

  const unsupportedDiameters = getUnsupportedJointDiameters(dimensions, datePermits)
  if (unsupportedDiameters.length > 0) {
    return getDlsArchiveAwareReason(
      allDlsPermits,
      weldDateValue,
      `нет ДЛС ${formatPermitDimensionMismatch('diameter', unsupportedDiameters, dimensions.diameterCoverage)}`,
    )
  }

  const unsupportedThicknesses = getUnsupportedJointThicknesses(dimensions, datePermits)
  if (unsupportedThicknesses.length > 0) {
    return getDlsArchiveAwareReason(
      allDlsPermits,
      weldDateValue,
      `нет ДЛС ${formatPermitDimensionMismatch('thickness', unsupportedThicknesses, dimensions.thicknessCoverage)}`,
    )
  }

  return null
}

function getCombinedDlsSelectBlockReason(
  records: WelderStampRecord[],
  methods: string[],
  materialGroup: string,
  weldDateValue: number,
  dimensions: OfficialStampJointDimensionRequirements,
) {
  const allDlsPermits = records.flatMap((record) => getAllWelderStampDlsPermits(record))
  if (allDlsPermits.length === 0) return hardReason(`нет ДЛС на способы сварки ${methods.join('+')}`)

  const permits = records
    .flatMap((record) => getWelderStampDlsPermitsForWeldDate(record, weldDateValue))
    .filter((permit) => methods.some((method) => splitPermitValues(permit.weldType).includes(method)))
    .filter((permit) => !materialGroup || splitPermitValues(permit.materialGroups).includes(materialGroup))
    .filter((permit) => !weldDateValue || isPermitDateCompatible(weldDateValue, permit))

  const unsupportedDiameters = getUnsupportedJointDiameters(dimensions, permits)
  if (unsupportedDiameters.length > 0) {
    return getDlsArchiveAwareReason(
      allDlsPermits,
      weldDateValue,
      `нет ДЛС ${formatPermitDimensionMismatch('diameter', unsupportedDiameters, dimensions.diameterCoverage)}`,
    )
  }
  const unsupportedThicknesses = getUnsupportedJointThicknesses(dimensions, permits)
  if (unsupportedThicknesses.length > 0) {
    return getDlsArchiveAwareReason(
      allDlsPermits,
      weldDateValue,
      `нет ДЛС ${formatPermitDimensionMismatch('thickness', unsupportedThicknesses, dimensions.thicknessCoverage)}`,
    )
  }

  return null
}

function getNaksPermitCandidates(records: WelderStampRecord[], method: string, materialGroup: string, weldDateValue: number) {
  return records
    .flatMap((record) => getWelderStampNaksPermitsForWeldDate(record, weldDateValue))
    .filter((permit) => !method || splitPermitValues(permit.weldType).includes(method))
    .filter((permit) => !materialGroup || splitPermitValues(permit.materialGroups).includes(materialGroup))
    .filter((permit) => !weldDateValue || isPermitDateCompatible(weldDateValue, permit))
}

function getNaksPermitCandidatesForMethods(
  records: WelderStampRecord[],
  methods: string[],
  materialGroup: string,
  weldDateValue: number,
) {
  return records
    .flatMap((record) => getWelderStampNaksPermitsForWeldDate(record, weldDateValue))
    .filter((permit) => methods.some((method) => splitPermitValues(permit.weldType).includes(method)))
    .filter((permit) => !materialGroup || splitPermitValues(permit.materialGroups).includes(materialGroup))
    .filter((permit) => !weldDateValue || isPermitDateCompatible(weldDateValue, permit))
}

function getDlsPermitCandidates(
  records: WelderStampRecord[],
  method: string,
  materialGroup: string,
  weldDateValue: number,
  dimensions: OfficialStampJointDimensionRequirements,
) {
  const permits = records
    .flatMap((record) => getWelderStampDlsPermitsForWeldDate(record, weldDateValue))
    .filter((permit) => !method || splitPermitValues(permit.weldType).includes(method))
    .filter((permit) => !materialGroup || splitPermitValues(permit.materialGroups).includes(materialGroup))
    .filter((permit) => !weldDateValue || isPermitDateCompatible(weldDateValue, permit))
  return areJointDiametersCompatible(dimensions, permits) &&
    areJointThicknessesCompatible(dimensions, permits)
    ? permits
    : []
}

function getPermitRangeBlockReason(
  permits: Array<WelderStampNaksPermit | WelderStampDlsPermit>,
  dimensions: OfficialStampJointDimensionRequirements,
  saveCheckSettings: SaveCheckSettings,
) {
  const unsupportedDiameters = getUnsupportedJointDiameters(dimensions, permits)
  if (saveCheckSettings.officialDiameter && unsupportedDiameters.length > 0) {
    return softReason(formatSelectDimensionMismatch('diameter', unsupportedDiameters, dimensions.diameterCoverage))
  }
  const unsupportedThicknesses = getUnsupportedJointThicknesses(dimensions, permits)
  if (saveCheckSettings.officialThickness && unsupportedThicknesses.length > 0) {
    return softReason(formatSelectDimensionMismatch('thickness', unsupportedThicknesses, dimensions.thicknessCoverage))
  }
  return null
}

function getNaksArchiveAwareReason(records: WelderStampRecord[], weldDateValue: number, fallbackReason: string) {
  const allPermits = records.flatMap((record) => getAllWelderStampNaksPermits(record))
  if (allPermits.length === 0) return hardReason(fallbackReason)
  return softReason(allPermits.some((permit) => permit.archived)
    ? weldDateValue
      ? 'архивный НАКС не подходит по дате сварки'
      : 'есть архивный НАКС: укажите дату сварки'
    : fallbackReason)
}

function hasArchivedNaksCandidate(
  records: WelderStampRecord[],
  method: string,
  materialGroup: string,
  dimensions: OfficialStampJointDimensionRequirements,
  saveCheckSettings: SaveCheckSettings,
) {
  const permits = records
    .flatMap((record) => getAllWelderStampNaksPermits(record))
    .filter((permit) => permit.archived)
    .filter((permit) => !method || splitPermitValues(permit.weldType).includes(method))
    .filter((permit) => !materialGroup || splitPermitValues(permit.materialGroups).includes(materialGroup))
  return (
    permits.length > 0 &&
    (!saveCheckSettings.officialDiameter || areJointDiametersCompatible(dimensions, permits)) &&
    (!saveCheckSettings.officialThickness || areJointThicknessesCompatible(dimensions, permits))
  )
}

function hasArchivedDlsCandidate(
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
  saveCheckSettings: SaveCheckSettings,
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

function formatSelectDimensionMismatch(
  kind: 'diameter' | 'thickness',
  values: number[],
  coverage: OfficialStampJointDimensionRequirements['diameterCoverage'],
) {
  const formatted = formatOfficialStampDiameterList(values)
  if (coverage === 'any' && values.length > 1) {
    return kind === 'diameter'
      ? `не подходит ни по одному из диаметров ${formatted}`
      : `не подходит ни по одной из толщин ${formatted}`
  }
  return kind === 'diameter'
    ? `не подходит по диаметру ${formatted}`
    : `не подходит по толщине ${formatted}`
}

function getDlsArchiveAwareReason(allPermits: WelderStampDlsPermit[], weldDateValue: number, fallbackReason: string) {
  if (allPermits.length === 0) return hardReason(fallbackReason)
  return softReason(allPermits.some((permit) => permit.archived)
    ? weldDateValue
      ? 'архивный ДЛС не подходит по дате сварки'
      : 'есть архивный ДЛС: укажите дату сварки'
    : fallbackReason)
}

function hardReason(reason: string): SelectBlockReason {
  return { reason, hard: true }
}

function softReason(reason: string): SelectBlockReason {
  return { reason, hard: false }
}

function isPermitDateCompatible(weldDateValue: number, permit: Pick<WelderStampNaksPermit, 'validFrom' | 'validTo'>) {
  const validFrom = getWeldDateOrderValue(permit.validFrom)
  const validTo = getWeldDateOrderValue(permit.validTo)
  return (!validFrom || weldDateValue >= validFrom) && (!validTo || weldDateValue <= validTo)
}

function uniqueStampValues(values: readonly unknown[]) {
  return [...new Set(values.map(normalizeStampSelectValue).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right, 'ru', { numeric: true, sensitivity: 'base' }),
  )
}
