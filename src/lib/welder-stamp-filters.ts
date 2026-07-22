import { formatWelderStampDate } from '@/lib/welder-stamp-format'
import { parseWelderStampNumber } from '@/lib/welder-stamp-number'
import { getWelderStampDlsPermits, getWelderStampNaksPermits } from '@/lib/welder-stamp-permits'
import type { WelderStampDlsPermit, WelderStampFilters, WelderStampNaksPermit, WelderStampRecord } from '@/lib/welder-stamp-types'

export function createEmptyWelderStampFilters(): WelderStampFilters {
  return {
    diameterFrom: '',
    diameterTo: '',
    thicknessFrom: '',
    thicknessTo: '',
    validFrom: '',
    validTo: '',
  }
}

export function filterWelderStampRecords(records: WelderStampRecord[], search: string, filters: WelderStampFilters) {
  const needle = search.trim().toLowerCase()
  const diameterFrom = filters.diameterFrom ? parseWelderStampNumber(filters.diameterFrom) : null
  const diameterTo = filters.diameterTo ? parseWelderStampNumber(filters.diameterTo) : null
  const thicknessFrom = filters.thicknessFrom ? parseWelderStampNumber(filters.thicknessFrom) : null
  const thicknessTo = filters.thicknessTo ? parseWelderStampNumber(filters.thicknessTo) : null

  return records.filter((record) =>
    matchesWelderStampTextSearch(record, needle) &&
    matchesWelderStampRangeFilter(record, 'diameter', diameterFrom, diameterTo) &&
    matchesWelderStampRangeFilter(record, 'thickness', thicknessFrom, thicknessTo) &&
    matchesWelderStampDateFilter(record, filters.validFrom, filters.validTo),
  )
}

function matchesWelderStampTextSearch(record: WelderStampRecord, needle: string) {
  if (!needle) return true

  return [
    record.naksStamp,
    record.welderName,
    record.internalStamp,
    record.weldType,
    record.materialGroups,
    record.diameterFrom,
    record.diameterTo,
    record.thicknessFrom,
    record.thicknessTo,
    formatWelderStampDate(record.validFrom),
    formatWelderStampDate(record.validTo),
    ...getAllWelderStampPermits(record).flatMap((permit) => [
      'number' in permit ? permit.number : '',
      permit.weldType,
      permit.materialGroups,
      permit.diameterFrom,
      permit.diameterTo,
      permit.thicknessFrom,
      permit.thicknessTo,
      formatWelderStampDate(permit.validFrom),
      formatWelderStampDate(permit.validTo),
      permit.note,
    ]),
  ]
    .join(' ')
    .toLowerCase()
    .includes(needle)
}

function matchesWelderStampRangeFilter(record: WelderStampRecord, range: 'diameter' | 'thickness', filterFrom: number | null, filterTo: number | null) {
  if (filterFrom === null && filterTo === null) return true

  return getAllWelderStampPermits(record).some((permit) => matchesPermitRange(permit, range, filterFrom, filterTo))
}

function matchesPermitRange(
  permit: WelderStampNaksPermit | WelderStampDlsPermit,
  range: 'diameter' | 'thickness',
  filterFrom: number | null,
  filterTo: number | null,
) {
  const fromValue = range === 'diameter' ? permit.diameterFrom : permit.thicknessFrom
  const toValue = range === 'diameter' ? permit.diameterTo : permit.thicknessTo
  const recordFrom = fromValue ? parseWelderStampNumber(fromValue) : null
  const recordTo = toValue ? parseWelderStampNumber(toValue) : null
  if (recordFrom === null) return false

  const effectiveRecordTo = recordTo ?? Number.POSITIVE_INFINITY
  const effectiveFilterFrom = filterFrom ?? Number.NEGATIVE_INFINITY
  const effectiveFilterTo = filterTo ?? Number.POSITIVE_INFINITY

  return recordFrom <= effectiveFilterTo && effectiveRecordTo >= effectiveFilterFrom
}

function matchesWelderStampDateFilter(record: WelderStampRecord, filterFrom: string, filterTo: string) {
  if (!filterFrom && !filterTo) return true

  const effectiveFilterFrom = filterFrom || '0000-01-01'
  const effectiveFilterTo = filterTo || '9999-12-31'

  return getAllWelderStampPermits(record).some((permit) => permit.validFrom <= effectiveFilterTo && permit.validTo >= effectiveFilterFrom)
}

export function hasWelderStampRangeFilters(filters: WelderStampFilters) {
  return Boolean(filters.diameterFrom || filters.diameterTo || filters.thicknessFrom || filters.thicknessTo || filters.validFrom || filters.validTo)
}

export function countWelderStampFilters(search: string, filters: WelderStampFilters) {
  return [search.trim(), filters.diameterFrom, filters.diameterTo, filters.thicknessFrom, filters.thicknessTo, filters.validFrom, filters.validTo].filter(Boolean).length
}

function getAllWelderStampPermits(record: WelderStampRecord) {
  return [...getWelderStampNaksPermits(record), ...getWelderStampDlsPermits(record)]
}
