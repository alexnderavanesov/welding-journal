import { loadDataListSettings } from '@/lib/data-list-settings'
import type { WeldInput } from '@/lib/weld-fields'
import type { WelderStampNaksPermit } from '@/lib/welder-stamp-types'
import { splitWelderStampMaterialGroups, splitWelderStampWeldTypes } from '@/lib/welder-stamp-format'
import { parseWelderStampNumber } from '@/lib/welder-stamp-number'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'

export function normalizeStampSelectValue(value: unknown) {
  return String(value ?? '').trim()
}

export function normalizeStampForCompare(value: unknown) {
  return normalizeStampSelectValue(value).toUpperCase()
}

export function parseOfficialStampWeldingMethods(value: unknown, configuredOptions?: readonly string[]) {
  const weldingTypeOptions = configuredOptions ?? loadDataListSettings().weldingTypes
  const selected = new Set(
    String(value ?? '')
      .toUpperCase()
      .split(/[+,;/]+/)
      .map((part) => part.trim())
      .filter(Boolean),
  )
  return weldingTypeOptions.filter((option) => selected.has(option))
}

export function parseOfficialStampMaterialGroup(value: unknown, configuredOptions?: readonly string[]) {
  const raw = String(value ?? '').trim().toUpperCase()
  if (!raw) return ''
  const materialGroupOptions = configuredOptions ?? loadDataListSettings().materialGroups
  return materialGroupOptions.find((option) => option === raw) ?? raw
}

export function getOfficialStampJointDiameters(record: WeldInput) {
  return getOfficialStampJointDimensionRequirements(record).diameters
}

export function getOfficialStampJointThicknesses(record: WeldInput) {
  return getOfficialStampJointDimensionRequirements(record).thicknesses
}

export type OfficialStampDimensionCoverage = 'all' | 'any'

export type OfficialStampJointDimensionRequirements = {
  diameters: number[]
  thicknesses: number[]
  diameterCoverage: OfficialStampDimensionCoverage
  thicknessCoverage: OfficialStampDimensionCoverage
}

export function formatOfficialStampDiameterList(diameters: number[]) {
  if (diameters.length === 1) return String(diameters[0])
  return diameters.join(', ')
}

export function isWelderStampDateCompatible(weldDateValue: number, record: WelderStampRecord) {
  const validFrom = getWeldDateOrderValue(record.validFrom)
  const validTo = getWeldDateOrderValue(record.validTo)
  return (!validFrom || weldDateValue >= validFrom) && (!validTo || weldDateValue <= validTo)
}

export function isWelderStampDiameterCompatible(diameter: number, record: WelderStampRecord) {
  const from = parseWelderStampNumber(record.diameterFrom) ?? 0
  const to = parseWelderStampNumber(record.diameterTo)
  return diameter >= from && (to === null || diameter <= to)
}

export function isPermitDiameterCompatible(diameter: number, permit: Pick<WelderStampNaksPermit, 'diameterFrom' | 'diameterTo'>) {
  const from = parseWelderStampNumber(permit.diameterFrom) ?? 0
  const to = parseWelderStampNumber(permit.diameterTo)
  return diameter >= from && (to === null || diameter <= to)
}

export function isPermitThicknessCompatible(thickness: number, permit: Pick<WelderStampNaksPermit, 'thicknessFrom' | 'thicknessTo'>) {
  const from = parseWelderStampNumber(permit.thicknessFrom) ?? 0
  const to = parseWelderStampNumber(permit.thicknessTo)
  return thickness >= from && (to === null || thickness <= to)
}

export function arePermitDiametersCompatible(
  diameters: number[],
  permits: Array<Pick<WelderStampNaksPermit, 'diameterFrom' | 'diameterTo'>>,
  coverage: OfficialStampDimensionCoverage = 'all',
) {
  return getUnsupportedPermitDiameters(diameters, permits, coverage).length === 0
}

export function arePermitThicknessesCompatible(
  thicknesses: number[],
  permits: Array<Pick<WelderStampNaksPermit, 'thicknessFrom' | 'thicknessTo'>>,
  coverage: OfficialStampDimensionCoverage = 'all',
) {
  return getUnsupportedPermitThicknesses(thicknesses, permits, coverage).length === 0
}

export function getUnsupportedPermitDiameters(
  diameters: number[],
  permits: Array<Pick<WelderStampNaksPermit, 'diameterFrom' | 'diameterTo'>>,
  coverage: OfficialStampDimensionCoverage = 'all',
) {
  const unsupported = diameters.filter(
    (diameter) => !permits.some((permit) => isPermitDiameterCompatible(diameter, permit)),
  )
  return coverage === 'any' && unsupported.length < diameters.length ? [] : unsupported
}

export function getUnsupportedPermitThicknesses(
  thicknesses: number[],
  permits: Array<Pick<WelderStampNaksPermit, 'thicknessFrom' | 'thicknessTo'>>,
  coverage: OfficialStampDimensionCoverage = 'all',
) {
  const unsupported = thicknesses.filter(
    (thickness) => !permits.some((permit) => isPermitThicknessCompatible(thickness, permit)),
  )
  return coverage === 'any' && unsupported.length < thicknesses.length ? [] : unsupported
}

export function getWeldDateOrderValue(value: unknown) {
  const raw = String(value ?? '').trim()
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoMatch) return Number(`${isoMatch[1]}${isoMatch[2]}${isoMatch[3]}`)
  const displayMatch = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  if (displayMatch) return Number(`${displayMatch[3]}${displayMatch[2]}${displayMatch[1]}`)
  return 0
}

export type WelderStampArchiveCompatibility =
  | 'active'
  | 'historical'
  | 'missing-weld-date'
  | 'unknown-archive-date'
  | 'after-archive'

export function getWelderStampArchiveCompatibility(
  records: readonly WelderStampRecord[],
  weldDate: unknown,
): WelderStampArchiveCompatibility {
  if (records.some((record) => !record.archived)) return 'active'
  if (records.length === 0) return 'active'

  const weldDateValue = getWeldDateOrderValue(weldDate)
  if (!weldDateValue) return 'missing-weld-date'

  const archiveDateValues = records
    .map((record) => getWeldDateOrderValue(record.archivedAt))
    .filter((value) => value > 0)
  if (archiveDateValues.length === 0) return 'unknown-archive-date'

  return archiveDateValues.some((archiveDateValue) => weldDateValue <= archiveDateValue)
    ? 'historical'
    : 'after-archive'
}

export function getLatestWelderStampArchiveDate(records: readonly WelderStampRecord[]) {
  return records
    .map((record) => String(record.archivedAt ?? '').trim())
    .filter(Boolean)
    .sort()
    .at(-1) ?? ''
}

export function splitOfficialStampWeldTypes(record: WelderStampRecord) {
  return splitWelderStampWeldTypes(record.weldType)
}

export function splitOfficialStampMaterialGroups(record: WelderStampRecord) {
  return splitWelderStampMaterialGroups(record.materialGroups)
}

function parseJointDiameterValue(value: unknown) {
  const raw = String(value ?? '').replace(',', '.').trim()
  if (!raw) return null
  const match = raw.match(/\d+(?:\.\d+)?/)
  if (!match) return null
  const parsed = Number(match[0])
  return Number.isFinite(parsed) ? parsed : null
}

export function getOfficialStampJointDimensionRequirements(
  record: WeldInput,
): OfficialStampJointDimensionRequirements {
  const diameters = [
    parseJointDiameterValue(record.d1),
    parseJointDiameterValue(record.d2),
  ] as const
  const thicknesses = [
    parseJointDiameterValue(record.t1),
    parseJointDiameterValue(record.t2),
  ] as const

  if (isAngularConnectionType(record.connectionType)) {
    const [d1, d2] = diameters
    if (d1 !== null && d2 !== null && d1 === d2) {
      const availableThicknesses = toUniqueNumbers(thicknesses)
      return {
        diameters: [d1],
        thicknesses: availableThicknesses.length > 0 ? [Math.min(...availableThicknesses)] : [],
        diameterCoverage: 'all',
        thicknessCoverage: 'all',
      }
    }

    const smallerMaterialIndex = getSmallerDiameterMaterialIndex(diameters)
    if (smallerMaterialIndex !== null) {
      return {
        diameters: toUniqueNumbers([diameters[smallerMaterialIndex]]),
        thicknesses: toUniqueNumbers([thicknesses[smallerMaterialIndex]]),
        diameterCoverage: 'all',
        thicknessCoverage: 'all',
      }
    }

    return {
      diameters: toUniqueNumbers(diameters),
      thicknesses: toUniqueNumbers(thicknesses),
      diameterCoverage: 'all',
      thicknessCoverage: 'all',
    }
  }

  return {
    diameters: toUniqueNumbers(diameters),
    thicknesses: toUniqueNumbers(thicknesses),
    diameterCoverage: 'any',
    thicknessCoverage: 'any',
  }
}

function isAngularConnectionType(value: unknown) {
  return String(value ?? '').trim().toUpperCase().startsWith('У')
}

function getSmallerDiameterMaterialIndex(diameters: readonly [number | null, number | null]): 0 | 1 | null {
  const [d1, d2] = diameters
  if (d1 !== null && d2 !== null) {
    if (d1 === d2) return null
    return d1 < d2 ? 0 : 1
  }
  if (d1 !== null) return 0
  if (d2 !== null) return 1
  return null
}

function toUniqueNumbers(values: readonly (number | null)[]) {
  return [...new Set(values.filter((value): value is number => value !== null))]
}
