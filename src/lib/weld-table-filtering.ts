import type { WeldRow } from '@/lib/dispatcher-types'
import { OFFICIAL_WELDER_STAMP_FIELD_KEYS } from '@/lib/report-common-config'
import {
  PERCENTAGE_LINE_STAMP_FILTER_KEY,
  ROW_ID_LIST_FILTER_KEY,
  parsePercentageLineStampFilter,
  parseRowIdListFilter,
} from '@/lib/report-hidden-filters'
import {
  normalizeWeldColumnChoiceValue,
  parseWeldColumnChoiceFilter,
} from '@/lib/weld-column-choice-filter'

export { buildWeldColumnValueFilter, parseWeldColumnChoiceFilter } from '@/lib/weld-column-choice-filter'

export function hasColumnFilters(columnFilters: Record<string, string>) {
  return Object.values(columnFilters).some((value) => value.trim())
}

export function filterWeldRowsByColumns<Row extends WeldRow>(rows: Row[], columnFilters: Record<string, string>) {
  const matchers = buildWeldColumnFilterMatchers(columnFilters)
  if (matchers.length === 0) return rows
  return rows.filter((row) => matchers.every((matches) => matches(row)))
}

type WeldColumnFilterMatcher = (row: WeldRow) => boolean

function buildWeldColumnFilterMatchers(columnFilters: Record<string, string>): WeldColumnFilterMatcher[] {
  return Object.entries(columnFilters).flatMap(([key, value]) => {
    const query = value.trim().toLowerCase()
    if (!query) return []

    if (key === PERCENTAGE_LINE_STAMP_FILTER_KEY) {
      const filter = parsePercentageLineStampFilter(value)
      return [(row: WeldRow) => matchesPercentageLineStampFilter(row, filter)]
    }

    if (key === ROW_ID_LIST_FILTER_KEY) {
      const filter = parseRowIdListFilter(value)
      const rowIds = new Set(filter?.rowIds ?? [])
      return [(row: WeldRow) => rowIds.has(row.id)]
    }

    const choiceFilter = parseWeldColumnChoiceFilter(value)
    if (choiceFilter) {
      const normalizedValues = new Set(choiceFilter.values.map(normalizeWeldColumnChoiceValue))
      return [(row: WeldRow) => normalizedValues.has(normalizeWeldColumnChoiceValue(getWeldColumnFilterCellText(row[key as keyof typeof row])))]
    }

    if (query.startsWith('=')) {
      const expectedValue = query.slice(1).trim().replace(/^["']|["']$/g, '')
      return [(row: WeldRow) => getNormalizedWeldColumnFilterCellText(row[key as keyof typeof row]) === expectedValue]
    }

    return [(row: WeldRow) => getNormalizedWeldColumnFilterCellText(row[key as keyof typeof row]).includes(query)]
  })
}

function getNormalizedWeldColumnFilterCellText(value: unknown) {
  return getWeldColumnFilterCellText(value).trim().toLowerCase()
}

export function getWeldColumnFilterCellText(value: unknown) {
  return value === true ? 'да' : value === false || value == null ? '' : String(value)
}

function matchesPercentageLineStampFilter(row: WeldRow, filter: ReturnType<typeof parsePercentageLineStampFilter>) {
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
