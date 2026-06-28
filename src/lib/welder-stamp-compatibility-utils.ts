import {
  WELDER_STAMP_WELD_TYPE_OPTIONS as welderStampWeldTypeOptions,
} from '@/lib/report-config'
import type { WeldInput } from '@/lib/weld-fields'
import { splitWelderStampWeldTypes } from '@/lib/welder-stamp-format'
import { parseWelderStampNumber } from '@/lib/welder-stamp-number'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'

export function normalizeStampSelectValue(value: unknown) {
  return String(value ?? '').trim()
}

export function normalizeStampForCompare(value: unknown) {
  return normalizeStampSelectValue(value).toUpperCase()
}

export function parseOfficialStampWeldingMethods(value: unknown) {
  const selected = new Set(
    String(value ?? '')
      .toUpperCase()
      .split(/[+,;/]+/)
      .map((part) => part.trim())
      .filter(Boolean),
  )
  return welderStampWeldTypeOptions.filter((option) => selected.has(option))
}

export function getOfficialStampJointDiameters(record: WeldInput) {
  const diameters = [parseJointDiameterValue(record.d1), parseJointDiameterValue(record.d2)].filter(
    (value): value is number => value !== null,
  )
  return [...new Set(diameters)]
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

export function getWeldDateOrderValue(value: unknown) {
  const raw = String(value ?? '').trim()
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoMatch) return Number(`${isoMatch[1]}${isoMatch[2]}${isoMatch[3]}`)
  const displayMatch = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  if (displayMatch) return Number(`${displayMatch[3]}${displayMatch[2]}${displayMatch[1]}`)
  return 0
}

export function splitOfficialStampWeldTypes(record: WelderStampRecord) {
  return splitWelderStampWeldTypes(record.weldType)
}

function parseJointDiameterValue(value: unknown) {
  const raw = String(value ?? '').replace(',', '.').trim()
  if (!raw) return null
  const match = raw.match(/\d+(?:\.\d+)?/)
  if (!match) return null
  const parsed = Number(match[0])
  return Number.isFinite(parsed) ? parsed : null
}
