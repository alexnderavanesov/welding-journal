import type { WeldRow } from '@/lib/dispatcher-types'
import { OFFICIAL_WELDER_STAMP_FIELD_KEYS } from '@/lib/report-common-config'
import {
  PERCENTAGE_LINE_STAMP_FILTER_KEY,
  ROW_ID_LIST_FILTER_KEY,
  parsePercentageLineStampFilter,
  parseRowIdListFilter,
} from '@/lib/report-navigation'

const COLUMN_CHOICE_FILTER_PREFIX = '__column_choice_filter__:'

type ColumnChoiceFilter =
  {
    kind: 'values'
    values: string[]
  }

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

  const choiceFilter = parseWeldColumnChoiceFilter(value)
  if (choiceFilter) {
    return matchesWeldColumnChoiceFilter(row, key, choiceFilter)
  }

  const cellValue = row[key as keyof typeof row]
  const normalized = getWeldColumnFilterCellText(cellValue)
  const normalizedText = normalized.trim().toLowerCase()
  if (query.startsWith('=')) {
    return normalizedText === query.slice(1).trim().replace(/^["']|["']$/g, '')
  }
  return normalizedText.includes(query)
}

export function buildWeldColumnValueFilter(values: string[]) {
  const normalizedValues = Array.from(new Set(values.map(normalizeChoiceValue)))
  if (normalizedValues.length === 0) return ''
  return encodeWeldColumnChoiceFilter({ kind: 'values', values: normalizedValues })
}

export function getWeldColumnFilterCellText(value: unknown) {
  return value === true ? 'да' : value === false || value == null ? '' : String(value)
}

export function parseWeldColumnChoiceFilter(value: string): ColumnChoiceFilter | null {
  if (!value.startsWith(COLUMN_CHOICE_FILTER_PREFIX)) return null
  try {
    const parsed = JSON.parse(decodeURIComponent(value.slice(COLUMN_CHOICE_FILTER_PREFIX.length))) as Partial<ColumnChoiceFilter>
    if (parsed.kind === 'values' && Array.isArray(parsed.values)) {
      return {
        kind: 'values',
        values: parsed.values.map(normalizeChoiceValue),
      }
    }
  } catch {
    return null
  }
  return null
}

function encodeWeldColumnChoiceFilter(filter: ColumnChoiceFilter) {
  return `${COLUMN_CHOICE_FILTER_PREFIX}${encodeURIComponent(JSON.stringify(filter))}`
}

function matchesWeldColumnChoiceFilter(row: WeldRow, key: string, filter: ColumnChoiceFilter) {
  const cellText = getWeldColumnFilterCellText(row[key as keyof typeof row])
  const normalizedCellText = normalizeChoiceValue(cellText)
  return filter.values.some((value) => normalizeChoiceValue(value) === normalizedCellText)
}

function normalizeChoiceValue(value: unknown) {
  return String(value ?? '').trim()
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
