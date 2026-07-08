import type { WeldRow } from '@/lib/dispatcher-types'
import { OFFICIAL_WELDER_STAMP_FIELD_KEYS } from '@/lib/report-common-config'
import {
  PERCENTAGE_LINE_STAMP_FILTER_KEY,
  ROW_ID_LIST_FILTER_KEY,
  parsePercentageLineStampFilter,
  parseRowIdListFilter,
} from '@/lib/report-navigation'

export function hasColumnFilters(columnFilters: Record<string, string>) {
  return Object.values(columnFilters).some((value) => value.trim())
}

export function filterWeldRowsByColumns<Row extends WeldRow>(rows: Row[], columnFilters: Record<string, string>) {
  return rows.filter((row) =>
    Object.entries(columnFilters).every(([key, value]) => matchesWeldColumnFilter(row, key, value)),
  )
}

function matchesWeldColumnFilter(row: WeldRow, key: string, value: string) {
  const query = value.trim().toLowerCase()
  if (!query) return true

  if (key === PERCENTAGE_LINE_STAMP_FILTER_KEY) {
    return matchesPercentageLineStampFilter(row, value)
  }

  if (key === ROW_ID_LIST_FILTER_KEY) {
    return matchesRowIdListFilter(row, value)
  }

  const cellValue = row[key as keyof typeof row]
  const normalized = cellValue === true ? 'да' : cellValue === false || cellValue == null ? '' : String(cellValue)
  const normalizedText = normalized.trim().toLowerCase()
  if (query.startsWith('=')) {
    return normalizedText === query.slice(1).trim().replace(/^["']|["']$/g, '')
  }
  return normalizedText.includes(query)
}

function matchesRowIdListFilter(row: WeldRow, value: string) {
  const filter = parseRowIdListFilter(value)
  if (!filter) return false
  return filter.rowIds.includes(row.id)
}

function matchesPercentageLineStampFilter(row: WeldRow, value: string) {
  const filter = parsePercentageLineStampFilter(value)
  if (!filter) return false

  const sameLine =
    normalizeFilterValue(row.projectTitle) === normalizeFilterValue(filter.projectTitle) &&
    normalizeFilterValue(row.subtitleCode) === normalizeFilterValue(filter.subtitleCode) &&
    normalizeFilterValue(row.line) === normalizeFilterValue(filter.line)
  if (!sameLine) return false

  const targetStamp = normalizeFilterValue(filter.stamp)
  return OFFICIAL_WELDER_STAMP_FIELD_KEYS.some((fieldKey) => normalizeFilterValue(row[fieldKey]) === targetStamp)
}

function normalizeFilterValue(value: unknown) {
  return String(value ?? '').trim().toLowerCase()
}
