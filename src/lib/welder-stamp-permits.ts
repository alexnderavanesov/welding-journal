import { getDateInputValidationReason, normalizeDateLikeForStorage } from '@/lib/date-format'
import { normalizeWelderStampMaterialGroups, normalizeWelderStampWeldType } from '@/lib/welder-stamp-format'
import { parseWelderStampNumber } from '@/lib/welder-stamp-number'
import type { WelderStampDlsPermit, WelderStampNaksPermit, WelderStampRecord } from '@/lib/welder-stamp-types'

export type WelderStampPermitKind = 'naks' | 'dls'

export function createWelderStampPermitId(prefix: WelderStampPermitKind = 'naks') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function createEmptyNaksPermit(): WelderStampNaksPermit {
  return {
    id: createWelderStampPermitId('naks'),
    weldType: '',
    materialGroups: '',
    diameterFrom: '',
    diameterTo: '',
    thicknessFrom: '',
    thicknessTo: '',
    validFrom: '',
    validTo: '',
    note: '',
    archived: false,
  }
}

export function createEmptyDlsPermit(): WelderStampDlsPermit {
  return {
    id: createWelderStampPermitId('dls'),
    number: '',
    weldType: '',
    materialGroups: '',
    diameterFrom: '',
    diameterTo: '',
    thicknessFrom: '',
    thicknessTo: '',
    validFrom: '',
    validTo: '',
    note: '',
    archived: false,
  }
}

export function normalizeNaksPermit(permit: Partial<WelderStampNaksPermit>): WelderStampNaksPermit {
  return {
    id: String(permit.id ?? '').trim() || createWelderStampPermitId('naks'),
    weldType: normalizeWelderStampWeldType(String(permit.weldType ?? '')),
    materialGroups: normalizeWelderStampMaterialGroups(String(permit.materialGroups ?? '')),
    diameterFrom: String(permit.diameterFrom ?? '').trim(),
    diameterTo: String(permit.diameterTo ?? '').trim(),
    thicknessFrom: String(permit.thicknessFrom ?? '').trim(),
    thicknessTo: String(permit.thicknessTo ?? '').trim(),
    validFrom: normalizeDateLikeForStorage(permit.validFrom ?? '') ?? '',
    validTo: normalizeDateLikeForStorage(permit.validTo ?? '') ?? '',
    note: String(permit.note ?? '').trim(),
    archived: Boolean(permit.archived),
  }
}

export function normalizeDlsPermit(permit: Partial<WelderStampDlsPermit>): WelderStampDlsPermit {
  return {
    id: String(permit.id ?? '').trim() || createWelderStampPermitId('dls'),
    number: String(permit.number ?? '').trim(),
    weldType: normalizeWelderStampWeldType(String(permit.weldType ?? '')),
    materialGroups: normalizeWelderStampMaterialGroups(String(permit.materialGroups ?? '')),
    diameterFrom: String(permit.diameterFrom ?? '').trim(),
    diameterTo: String(permit.diameterTo ?? '').trim(),
    thicknessFrom: String(permit.thicknessFrom ?? '').trim(),
    thicknessTo: String(permit.thicknessTo ?? '').trim(),
    validFrom: normalizeDateLikeForStorage(permit.validFrom ?? '') ?? '',
    validTo: normalizeDateLikeForStorage(permit.validTo ?? '') ?? '',
    note: String(permit.note ?? '').trim(),
    archived: Boolean(permit.archived),
  }
}

export function getAllWelderStampNaksPermits(record: WelderStampRecord): WelderStampNaksPermit[] {
  const normalizedPermits = (record.naksPermits ?? []).map(normalizeNaksPermit).filter(hasMeaningfulNaksPermit)
  if (normalizedPermits.length > 0) return normalizedPermits

  const legacyPermit = normalizeNaksPermit({
    weldType: record.weldType,
    materialGroups: record.materialGroups,
    diameterFrom: record.diameterFrom,
    diameterTo: record.diameterTo,
    thicknessFrom: record.thicknessFrom,
    thicknessTo: record.thicknessTo,
    validFrom: record.validFrom,
    validTo: record.validTo,
  })
  return hasMeaningfulNaksPermit(legacyPermit) ? [legacyPermit] : []
}

export function getWelderStampNaksPermits(record: WelderStampRecord): WelderStampNaksPermit[] {
  return getAllWelderStampNaksPermits(record).filter((permit) => !permit.archived)
}

export function getWelderStampNaksPermitsForWeldDate(record: WelderStampRecord, weldDateValue: number): WelderStampNaksPermit[] {
  return getAllWelderStampNaksPermits(record).filter((permit) => isPermitEffectiveForWeldDate(permit, weldDateValue))
}

export function getArchivedWelderStampNaksPermits(record: WelderStampRecord): WelderStampNaksPermit[] {
  return getAllWelderStampNaksPermits(record).filter((permit) => permit.archived)
}

export function getAllWelderStampDlsPermits(record: WelderStampRecord): WelderStampDlsPermit[] {
  return (record.dlsPermits ?? []).map(normalizeDlsPermit).filter(hasMeaningfulDlsPermit)
}

export function getWelderStampDlsPermits(record: WelderStampRecord): WelderStampDlsPermit[] {
  return getAllWelderStampDlsPermits(record).filter((permit) => !permit.archived)
}

export function getWelderStampDlsPermitsForWeldDate(record: WelderStampRecord, weldDateValue: number): WelderStampDlsPermit[] {
  return getAllWelderStampDlsPermits(record).filter((permit) => isPermitEffectiveForWeldDate(permit, weldDateValue))
}

export function getArchivedWelderStampDlsPermits(record: WelderStampRecord): WelderStampDlsPermit[] {
  return getAllWelderStampDlsPermits(record).filter((permit) => permit.archived)
}

export function withWelderStampPermitSummary(record: WelderStampRecord): WelderStampRecord {
  const naksPermits = getWelderStampNaksPermits(record)
  const dlsPermits = getWelderStampDlsPermits(record)
  const firstPermit = naksPermits[0] ?? createEmptyNaksPermit()
  return {
    ...record,
    weldType: joinUnique(naksPermits.map((permit) => permit.weldType)),
    materialGroups: joinUnique(naksPermits.map((permit) => permit.materialGroups)),
    diameterFrom: getMinimumBoundary(naksPermits.map((permit) => permit.diameterFrom)) || firstPermit.diameterFrom,
    diameterTo: getMaximumBoundary(naksPermits.map((permit) => permit.diameterTo)) || firstPermit.diameterTo,
    thicknessFrom: getMinimumBoundary(naksPermits.map((permit) => permit.thicknessFrom)) || firstPermit.thicknessFrom,
    thicknessTo: getMaximumBoundary(naksPermits.map((permit) => permit.thicknessTo)) || firstPermit.thicknessTo,
    validFrom: getMinimumDate(naksPermits.map((permit) => permit.validFrom)) || firstPermit.validFrom,
    validTo: getMaximumDate(naksPermits.map((permit) => permit.validTo)) || firstPermit.validTo,
    naksPermits: getAllWelderStampNaksPermits(record),
    dlsPermits: getAllWelderStampDlsPermits(record),
  }
}

export function validateNaksPermit(permit: WelderStampNaksPermit, index: number) {
  return validatePermitBase(permit, `НАКС ${index + 1}`, true)
}

export function validateDlsPermit(permit: WelderStampDlsPermit, index: number, naksPermits: readonly WelderStampNaksPermit[]) {
  const prefix = `ДЛС ${index + 1}`
  if (!permit.number) return `${prefix}: укажите номер ДЛС`
  const baseError = validatePermitBase(permit, prefix, true)
  if (baseError) return baseError
  return getDlsOutOfNaksBoundsReason(permit, naksPermits, prefix)
}

function validatePermitBase(
  permit: Pick<
    WelderStampNaksPermit,
    'weldType' | 'materialGroups' | 'diameterFrom' | 'diameterTo' | 'thicknessFrom' | 'thicknessTo' | 'validFrom' | 'validTo'
  >,
  prefix: string,
  requireMaterialGroup: boolean,
) {
  if (!permit.weldType) return `${prefix}: укажите способ сварки`
  if (requireMaterialGroup && !permit.materialGroups) return `${prefix}: укажите группу материалов`
  if (!permit.diameterFrom) return `${prefix}: укажите диаметр от`
  if (!permit.thicknessFrom) return `${prefix}: укажите толщину от`
  if (!permit.validFrom) return `${prefix}: укажите срок действия от`
  if (!permit.validTo) return `${prefix}: укажите срок действия до`

  const diameterError = validateRange(permit.diameterFrom, permit.diameterTo, `${prefix}: диапазон диаметра`)
  if (diameterError) return diameterError
  const thicknessError = validateRange(permit.thicknessFrom, permit.thicknessTo, `${prefix}: диапазон толщины`)
  if (thicknessError) return thicknessError

  const validFromReason = permit.validFrom ? getDateInputValidationReason(permit.validFrom, `${prefix}: срок действия от`) : ''
  if (validFromReason) return validFromReason
  const validToReason = permit.validTo ? getDateInputValidationReason(permit.validTo, `${prefix}: срок действия до`) : ''
  if (validToReason) return validToReason
  if (permit.validFrom && permit.validTo && permit.validFrom > permit.validTo) {
    return `${prefix}: срок действия заполнен некорректно, дата «от» позже даты «до»`
  }

  return ''
}

function getDlsOutOfNaksBoundsReason(permit: WelderStampDlsPermit, naksPermits: readonly WelderStampNaksPermit[], prefix: string) {
  const dlsMethods = splitPermitValues(permit.weldType)
  const dlsGroups = splitPermitValues(permit.materialGroups)
  const naksCandidates = naksPermits.filter((candidate) => isDateRangeInside(permit, candidate))

  for (const method of dlsMethods) {
    for (const group of dlsGroups.length > 0 ? dlsGroups : ['']) {
      const isCovered = naksCandidates.some((candidate) => {
        const candidateMethods = splitPermitValues(candidate.weldType)
        const candidateGroups = splitPermitValues(candidate.materialGroups)
        return (
          candidateMethods.includes(method) &&
          (!group || candidateGroups.includes(group)) &&
          isRangeInside(permit.diameterFrom, permit.diameterTo, candidate.diameterFrom, candidate.diameterTo) &&
          isRangeInside(permit.thicknessFrom, permit.thicknessTo, candidate.thicknessFrom, candidate.thicknessTo)
        )
      })

      if (!isCovered) {
        return `${prefix}: допуск ДЛС ${method}${group ? `, ${group}` : ''} выходит за границы НАКС`
      }
    }
  }

  return ''
}

function validateRange(fromValue: string, toValue: string, label: string) {
  const from = parseWelderStampNumber(fromValue)
  const to = toValue ? parseWelderStampNumber(toValue) : null
  if (from === null) return `${label}: значение «от» должно быть числом`
  if (to === null && toValue) return `${label}: значение «до» должно быть числом`
  if (to !== null && from > to) return `${label}: значение «от» больше значения «до»`
  return ''
}

function isRangeInside(fromValue: string, toValue: string, parentFromValue: string, parentToValue: string) {
  const from = parseWelderStampNumber(fromValue)
  const to = parseWelderStampNumber(toValue) ?? from
  const parentFrom = parseWelderStampNumber(parentFromValue) ?? 0
  const parentTo = parseWelderStampNumber(parentToValue)
  if (from === null || to === null) return false
  return from >= parentFrom && (parentTo === null || to <= parentTo)
}

function isDateRangeInside(permit: Pick<WelderStampDlsPermit, 'validFrom' | 'validTo'>, parent: Pick<WelderStampNaksPermit, 'validFrom' | 'validTo'>) {
  return (!parent.validFrom || permit.validFrom >= parent.validFrom) && (!parent.validTo || permit.validTo <= parent.validTo)
}

function isPermitEffectiveForWeldDate(permit: WelderStampNaksPermit | WelderStampDlsPermit, weldDateValue: number) {
  if (!permit.archived) return true
  if (!weldDateValue) return false
  const validFrom = getDateOrderValue(permit.validFrom)
  const validTo = getDateOrderValue(permit.validTo)
  return (!validFrom || weldDateValue >= validFrom) && (!validTo || weldDateValue <= validTo)
}

function getDateOrderValue(value: unknown) {
  const raw = String(value ?? '').trim()
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoMatch) return Number(`${isoMatch[1]}${isoMatch[2]}${isoMatch[3]}`)
  const displayMatch = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  if (displayMatch) return Number(`${displayMatch[3]}${displayMatch[2]}${displayMatch[1]}`)
  return 0
}

export function splitPermitValues(value: string) {
  return String(value ?? '')
    .split(/[+,;/]+/)
    .map((part) => part.trim().toUpperCase())
    .filter(Boolean)
}

function hasMeaningfulNaksPermit(permit: WelderStampNaksPermit) {
  return Boolean(
    permit.weldType ||
      permit.materialGroups ||
      permit.diameterFrom ||
      permit.diameterTo ||
      permit.thicknessFrom ||
      permit.thicknessTo ||
      permit.validFrom ||
      permit.validTo ||
      permit.note,
  )
}

function hasMeaningfulDlsPermit(permit: WelderStampDlsPermit) {
  return Boolean(permit.number || hasMeaningfulNaksPermit(permit))
}

function joinUnique(values: string[]) {
  return [...new Set(values.flatMap(splitPermitValues))].join(', ')
}

function getMinimumBoundary(values: string[]) {
  const parsed = values.map(parseWelderStampNumber).filter((value): value is number => value !== null)
  return parsed.length > 0 ? String(Math.min(...parsed)) : ''
}

function getMaximumBoundary(values: string[]) {
  const parsed = values.map(parseWelderStampNumber).filter((value): value is number => value !== null)
  return parsed.length > 0 ? String(Math.max(...parsed)) : ''
}

function getMinimumDate(values: string[]) {
  const prepared = values.filter(Boolean).sort()
  return prepared[0] ?? ''
}

function getMaximumDate(values: string[]) {
  const prepared = values.filter(Boolean).sort()
  return prepared.at(-1) ?? ''
}
