import {
  FACTUAL_WELDER_STAMP_FIELD_KEYS as factualWelderStampFieldKeys,
  OFFICIAL_WELDER_STAMP_FIELD_KEYS as officialWelderStampFieldKeys,
} from '@/lib/report-config'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'
import type { StampSelectOption } from '@/lib/weld-form-utils'
import {
  formatWelderStampSuspensionBlockReason,
  getSuspensionOverlapForStamp,
} from '@/lib/welder-stamp-suspensions'
import type { WelderStampRecord, WelderStampSuspensionRecord } from '@/lib/welder-stamp-types'
import {
  formatOfficialStampDiameterList,
  getOfficialStampJointDiameters,
  getOfficialStampJointThicknesses,
  isPermitDiameterCompatible,
  isPermitThicknessCompatible,
  getWeldDateOrderValue,
  normalizeStampForCompare,
  normalizeStampSelectValue,
  parseOfficialStampMaterialGroup,
  parseOfficialStampWeldingMethods,
} from '@/lib/welder-stamp-compatibility-utils'
import { loadSaveCheckSettings, type SaveCheckSettings } from '@/lib/save-check-settings'
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
  allowedArchivedOfficialStamps: readonly string[] = [],
  suspensions: readonly WelderStampSuspensionRecord[] = [],
  options: { includeArchivedStamps?: boolean; saveCheckSettings?: SaveCheckSettings } = {},
): Partial<Record<WeldFieldKey, readonly StampSelectOption[]>> {
  const saveCheckSettings = options.saveCheckSettings ?? loadSaveCheckSettings()
  const activeRecords = records.filter((record) => !record.archived)
  const includeArchivedOptions = options.includeArchivedStamps || !saveCheckSettings.officialArchive
  const optionRecords = includeArchivedOptions ? records : activeRecords
  const allowedArchivedStampValues = getExistingArchivedOfficialStampValues(allowedArchivedOfficialStamps, records)
  const configuredArchivedStampValues = includeArchivedOptions
    ? uniqueStampValues(records.filter((record) => record.archived).map((record) => record.naksStamp))
    : []
  const allowedArchivedStampSet = new Set(allowedArchivedStampValues.map(normalizeStampForCompare))
  const configuredArchivedStampSet = new Set(configuredArchivedStampValues.map(normalizeStampForCompare))
  const officialOptions = uniqueStampValues([
    ...activeRecords.map((record) => record.naksStamp),
    ...allowedArchivedStampValues,
    ...configuredArchivedStampValues,
  ]).map((value) => {
    const comparableRecords = saveCheckSettings.officialArchive ? activeRecords : records
    const hasActiveRecord = comparableRecords.some(
      (record) => normalizeStampForCompare(record.naksStamp) === normalizeStampForCompare(value),
    )
    const normalizedValue = normalizeStampForCompare(value)
    const isAllowedArchivedOnly = !hasActiveRecord && allowedArchivedStampSet.has(normalizedValue)
    const isConfiguredArchivedOnly = !hasActiveRecord && configuredArchivedStampSet.has(normalizedValue)
    const suspension = saveCheckSettings.officialSuspension && draft ? getSuspensionOverlapForStamp(suspensions, value, draft.weldDate) : null
    const suspensionReason = suspension ? formatWelderStampSuspensionBlockReason(suspension) : ''
    const blockReason = suspensionReason
      ? { reason: suspensionReason, hard: true }
      : !isAllowedArchivedOnly && !isConfiguredArchivedOnly && draft
        ? getOfficialStampSelectBlockReason(value, draft, comparableRecords, saveCheckSettings)
        : null
    return {
      value,
      disabled: Boolean(blockReason?.hard),
      reason: blockReason?.reason,
    }
  })
  const factualOptions = uniqueStampValues(
    optionRecords.flatMap((record) => {
      const naksStamp = normalizeStampSelectValue(record.naksStamp)
      if (naksStamp) return [naksStamp]

      const internalStamp = normalizeStampSelectValue(record.internalStamp)
      return internalStamp ? [internalStamp] : []
    }),
  ).map((value) => ({ value }))

  return {
    ...Object.fromEntries(officialWelderStampFieldKeys.map((fieldKey) => [fieldKey, officialOptions])),
    ...Object.fromEntries(factualWelderStampFieldKeys.map((fieldKey) => [fieldKey, factualOptions])),
  }
}

export function getArchivedOfficialStampValuesForRecord(record: WeldInput | undefined, records: WelderStampRecord[]) {
  if (!record) return []

  const archivedStampSet = new Set(
    records
      .filter((stampRecord) => stampRecord.archived)
      .map((stampRecord) => normalizeStampForCompare(stampRecord.naksStamp))
      .filter(Boolean),
  )

  return uniqueStampValues(
    officialWelderStampFieldKeys
      .map((fieldKey) => record[fieldKey])
      .filter((value) => archivedStampSet.has(normalizeStampForCompare(value))),
  )
}

function getExistingArchivedOfficialStampValues(values: readonly string[], records: WelderStampRecord[]) {
  const archivedStampSet = new Set(
    records
      .filter((stampRecord) => stampRecord.archived)
      .map((stampRecord) => normalizeStampForCompare(stampRecord.naksStamp))
      .filter(Boolean),
  )

  return uniqueStampValues(values.filter((value) => archivedStampSet.has(normalizeStampForCompare(value))))
}

type SelectBlockReason = {
  reason: string
  hard: boolean
}

function getOfficialStampSelectBlockReason(stamp: string, draft: WeldInput, activeRecords: WelderStampRecord[], saveCheckSettings: SaveCheckSettings): SelectBlockReason | null {
  const stampRecords = activeRecords.filter(
    (record) => normalizeStampForCompare(record.naksStamp) === normalizeStampForCompare(stamp),
  )
  if (stampRecords.length === 0) return saveCheckSettings.officialRegistry ? hardReason('нет в активном реестре') : null

  const methods = parseOfficialStampWeldingMethods(draft.weldingMethod)
  const materialGroup = parseOfficialStampMaterialGroup(draft.materialGroup)
  const diameters = getOfficialStampJointDiameters(draft)
  const thicknesses = getOfficialStampJointThicknesses(draft)
  const weldDateValue = getWeldDateOrderValue(draft.weldDate)
  const requireDls = saveCheckSettings.officialDls
  if (methods.length === 0 && diameters.length === 0 && thicknesses.length === 0 && !materialGroup && !requireDls) return null

  if (!saveCheckSettings.officialWeldingMethod || methods.length === 0) {
    const permits = getNaksPermitCandidates(
      stampRecords,
      '',
      saveCheckSettings.officialMaterialGroup ? materialGroup : '',
      saveCheckSettings.officialNaksDate ? weldDateValue : 0,
    )
    if (saveCheckSettings.officialMaterialGroup && materialGroup && permits.length === 0) {
      return getNaksArchiveAwareReason(stampRecords, saveCheckSettings.officialNaksDate ? weldDateValue : 0, `не подходит по группе материалов ${materialGroup}`)
    }
    const rangeReason = getPermitRangeBlockReason(permits, diameters, thicknesses, saveCheckSettings)
    if (rangeReason) return rangeReason
    if (requireDls) {
      const dlsReason = getDlsSelectBlockReason(
        stampRecords,
        '',
        saveCheckSettings.officialMaterialGroup ? materialGroup : '',
        weldDateValue,
        saveCheckSettings.officialDiameter ? diameters : [],
        saveCheckSettings.officialThickness ? thicknesses : [],
      )
      if (dlsReason) return dlsReason
    }
    return null
  }

  if (saveCheckSettings.officialWeldingMethod && methods.length > 1) {
    const dlsMaterialGroup = saveCheckSettings.officialMaterialGroup ? materialGroup : ''
    const dlsDiameters = saveCheckSettings.officialDiameter ? diameters : []
    const dlsThicknesses = saveCheckSettings.officialThickness ? thicknesses : []
    const archivedDateReason = !weldDateValue
      ? getCombinedMethodArchivedDateReason(stampRecords, methods, saveCheckSettings.officialMaterialGroup ? materialGroup : '', diameters, thicknesses, requireDls, saveCheckSettings)
      : null
    if (archivedDateReason) return archivedDateReason

    const hasCompatibleMethod = methods.some((method) => {
      const materialGroupRecords = getNaksPermitCandidates(
        stampRecords,
        method,
        saveCheckSettings.officialMaterialGroup ? materialGroup : '',
        saveCheckSettings.officialNaksDate ? weldDateValue : 0,
      )
      return (
        materialGroupRecords.length > 0 &&
        !getPermitRangeBlockReason(materialGroupRecords, diameters, thicknesses, saveCheckSettings) &&
        (!requireDls || getDlsPermitCandidates(stampRecords, method, dlsMaterialGroup, weldDateValue, dlsDiameters, dlsThicknesses).length > 0)
      )
    })

    if (hasCompatibleMethod) return null
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
    const rangeReason = getPermitRangeBlockReason(saveCheckSettings.officialMaterialGroup ? materialGroupPermits : methodPermits, diameters, thicknesses, saveCheckSettings)
    if (rangeReason) return rangeReason
    if (requireDls) {
      const dlsReason = getDlsSelectBlockReason(
        stampRecords,
        saveCheckSettings.officialWeldingMethod ? method : '',
        saveCheckSettings.officialMaterialGroup ? materialGroup : '',
        weldDateValue,
        saveCheckSettings.officialDiameter ? diameters : [],
        saveCheckSettings.officialThickness ? thicknesses : [],
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
  diameters: number[],
  thicknesses: number[],
  requireDls: boolean,
  saveCheckSettings: SaveCheckSettings,
) {
  for (const method of methods) {
    const activeNaksCandidates = getNaksPermitCandidates(records, method, materialGroup, 0)
    const activeNaksFits = activeNaksCandidates.length > 0 && !getPermitRangeBlockReason(activeNaksCandidates, diameters, thicknesses, saveCheckSettings)
    if (!activeNaksFits && hasArchivedNaksCandidate(records, method, materialGroup, diameters, thicknesses, saveCheckSettings)) {
      return softReason('есть архивный НАКС: укажите дату сварки')
    }

    const dlsDiameters = saveCheckSettings.officialDiameter ? diameters : []
    const dlsThicknesses = saveCheckSettings.officialThickness ? thicknesses : []
    if (requireDls && activeNaksFits && getDlsPermitCandidates(records, method, materialGroup, 0, dlsDiameters, dlsThicknesses).length === 0) {
      if (hasArchivedDlsCandidate(records, method, materialGroup, dlsDiameters, dlsThicknesses)) {
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
  diameters: number[],
  thicknesses: number[],
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

  const diameterPermits = diameters.length > 0
    ? datePermits.filter((permit) => diameters.every((diameter) => isPermitDiameterCompatible(diameter, permit)))
    : datePermits
  if (diameters.length > 0 && diameterPermits.length === 0) return getDlsArchiveAwareReason(allDlsPermits, weldDateValue, `нет ДЛС на диаметр ${formatOfficialStampDiameterList(diameters)}`)

  const thicknessPermits = thicknesses.length > 0
    ? diameterPermits.filter((permit) => thicknesses.every((thickness) => isPermitThicknessCompatible(thickness, permit)))
    : diameterPermits
  if (thicknesses.length > 0 && thicknessPermits.length === 0) return getDlsArchiveAwareReason(allDlsPermits, weldDateValue, `нет ДЛС на толщину ${formatOfficialStampDiameterList(thicknesses)}`)

  return null
}

function getNaksPermitCandidates(records: WelderStampRecord[], method: string, materialGroup: string, weldDateValue: number) {
  return records
    .flatMap((record) => getWelderStampNaksPermitsForWeldDate(record, weldDateValue))
    .filter((permit) => !method || splitPermitValues(permit.weldType).includes(method))
    .filter((permit) => !materialGroup || splitPermitValues(permit.materialGroups).includes(materialGroup))
    .filter((permit) => !weldDateValue || isPermitDateCompatible(weldDateValue, permit))
}

function getDlsPermitCandidates(
  records: WelderStampRecord[],
  method: string,
  materialGroup: string,
  weldDateValue: number,
  diameters: number[],
  thicknesses: number[],
) {
  return records
    .flatMap((record) => getWelderStampDlsPermitsForWeldDate(record, weldDateValue))
    .filter((permit) => !method || splitPermitValues(permit.weldType).includes(method))
    .filter((permit) => !materialGroup || splitPermitValues(permit.materialGroups).includes(materialGroup))
    .filter((permit) => !weldDateValue || isPermitDateCompatible(weldDateValue, permit))
    .filter((permit) => diameters.every((diameter) => isPermitDiameterCompatible(diameter, permit)))
    .filter((permit) => thicknesses.every((thickness) => isPermitThicknessCompatible(thickness, permit)))
}

function getPermitRangeBlockReason(
  permits: Array<WelderStampNaksPermit | WelderStampDlsPermit>,
  diameters: number[],
  thicknesses: number[],
  saveCheckSettings: SaveCheckSettings,
) {
  if (saveCheckSettings.officialDiameter && diameters.length > 0 && !permits.some((permit) => diameters.every((diameter) => isPermitDiameterCompatible(diameter, permit)))) {
    return softReason(`не подходит по диаметру ${formatOfficialStampDiameterList(diameters)}`)
  }
  if (saveCheckSettings.officialThickness && thicknesses.length > 0 && !permits.some((permit) => thicknesses.every((thickness) => isPermitThicknessCompatible(thickness, permit)))) {
    return softReason(`не подходит по толщине ${formatOfficialStampDiameterList(thicknesses)}`)
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
  diameters: number[],
  thicknesses: number[],
  saveCheckSettings: SaveCheckSettings,
) {
  return records
    .flatMap((record) => getAllWelderStampNaksPermits(record))
    .filter((permit) => permit.archived)
    .filter((permit) => !method || splitPermitValues(permit.weldType).includes(method))
    .filter((permit) => !materialGroup || splitPermitValues(permit.materialGroups).includes(materialGroup))
    .some((permit) =>
      (!saveCheckSettings.officialDiameter || diameters.every((diameter) => isPermitDiameterCompatible(diameter, permit))) &&
      (!saveCheckSettings.officialThickness || thicknesses.every((thickness) => isPermitThicknessCompatible(thickness, permit))),
    )
}

function hasArchivedDlsCandidate(
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
