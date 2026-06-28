import { formatWelderStampDate } from '@/lib/welder-stamp-format'
import { parseWelderStampNumber } from '@/lib/welder-stamp-number'
import type { WelderStampFilters, WelderStampRecord } from '@/lib/welder-stamp-types'

export function createEmptyWelderStampFilters(): WelderStampFilters {
  return {
    diameterFrom: '',
    diameterTo: '',
    validFrom: '',
    validTo: '',
  }
}

export function filterWelderStampRecords(records: WelderStampRecord[], search: string, filters: WelderStampFilters) {
  const needle = search.trim().toLowerCase()
  const diameterFrom = filters.diameterFrom ? parseWelderStampNumber(filters.diameterFrom) : null
  const diameterTo = filters.diameterTo ? parseWelderStampNumber(filters.diameterTo) : null

  return records.filter((record) =>
    matchesWelderStampTextSearch(record, needle) &&
    matchesWelderStampDiameterFilter(record, diameterFrom, diameterTo) &&
    matchesWelderStampDateFilter(record, filters.validFrom, filters.validTo),
  )
}

function matchesWelderStampTextSearch(record: WelderStampRecord, needle: string) {
  if (!needle) return true

  return [
    record.naksStamp,
    record.internalStamp,
    record.weldType,
    record.diameterFrom,
    record.diameterTo,
    formatWelderStampDate(record.validFrom),
    formatWelderStampDate(record.validTo),
  ]
    .join(' ')
    .toLowerCase()
    .includes(needle)
}

function matchesWelderStampDiameterFilter(record: WelderStampRecord, filterFrom: number | null, filterTo: number | null) {
  if (filterFrom === null && filterTo === null) return true

  const recordFrom = record.diameterFrom ? parseWelderStampNumber(record.diameterFrom) : null
  const recordTo = record.diameterTo ? parseWelderStampNumber(record.diameterTo) : null
  if (recordFrom === null) return false

  const effectiveRecordTo = recordTo ?? Number.POSITIVE_INFINITY
  const effectiveFilterFrom = filterFrom ?? Number.NEGATIVE_INFINITY
  const effectiveFilterTo = filterTo ?? Number.POSITIVE_INFINITY

  return recordFrom <= effectiveFilterTo && effectiveRecordTo >= effectiveFilterFrom
}

function matchesWelderStampDateFilter(record: WelderStampRecord, filterFrom: string, filterTo: string) {
  if (!filterFrom && !filterTo) return true
  if (!record.validFrom || !record.validTo) return false

  const effectiveFilterFrom = filterFrom || '0000-01-01'
  const effectiveFilterTo = filterTo || '9999-12-31'

  return record.validFrom <= effectiveFilterTo && record.validTo >= effectiveFilterFrom
}

export function hasWelderStampRangeFilters(filters: WelderStampFilters) {
  return Boolean(filters.diameterFrom || filters.diameterTo || filters.validFrom || filters.validTo)
}

export function countWelderStampFilters(search: string, filters: WelderStampFilters) {
  return [search.trim(), filters.diameterFrom, filters.diameterTo, filters.validFrom, filters.validTo].filter(Boolean).length
}
