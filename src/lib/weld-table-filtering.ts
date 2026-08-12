import type { WeldRow } from '@/lib/dispatcher-types'
import { OFFICIAL_WELDER_STAMP_FIELD_KEYS } from '@/lib/report-common-config'
import {
  DISPATCHER_TASKS_FIELD_KEY,
  DISPATCHER_TASKS_WITH_FILTER,
  DISPATCHER_TASKS_WITHOUT_FILTER,
} from '@/lib/dispatcher-task-row-codes'
import {
  PERCENTAGE_LINE_STAMP_FILTER_KEY,
  ROW_ID_LIST_FILTER_KEY,
  JOINT_CHAIN_FILTER_KEY,
  matchesJointChainFilter,
  parseJointChainFilter,
  parsePercentageLineStampFilter,
  parseRowIdListFilter,
} from '@/lib/report-hidden-filters'
import {
  normalizeWeldColumnChoiceValue,
  parseWeldColumnChoiceFilter,
} from '@/lib/weld-column-choice-filter'
import { formatFinalStatusDisplay } from '@/lib/weld-status'

export { buildWeldColumnValueFilter, parseWeldColumnChoiceFilter } from '@/lib/weld-column-choice-filter'

export function sortWeldDateTimeFilterOptions<T extends { value: string; label: string }>(
  options: readonly T[],
) {
  return [...options].sort((left, right) => {
    if (left.value === '') return -1
    if (right.value === '') return 1

    const leftTimestamp = Date.parse(left.value)
    const rightTimestamp = Date.parse(right.value)
    if (Number.isFinite(leftTimestamp) && Number.isFinite(rightTimestamp)) {
      return rightTimestamp - leftTimestamp
    }

    return right.label.localeCompare(left.label, 'ru', {
      numeric: true,
      sensitivity: 'base',
    })
  })
}

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
      return [(row: WeldRow) => (filter?.mode === 'exclude' ? !rowIds.has(row.id) : rowIds.has(row.id))]
    }

    if (key === JOINT_CHAIN_FILTER_KEY) {
      const filter = parseJointChainFilter(value)
      return [(row: WeldRow) => matchesJointChainFilter(row.joint, filter)]
    }

    if (key === DISPATCHER_TASKS_FIELD_KEY) {
      const choiceFilter = parseWeldColumnChoiceFilter(value)
      return [(row: WeldRow) => {
        const rowCodes = getDispatcherTaskCodesFromRow(row)
        if (query === DISPATCHER_TASKS_WITH_FILTER) return rowCodes.length > 0
        if (query === DISPATCHER_TASKS_WITHOUT_FILTER) return rowCodes.length === 0
        if (choiceFilter?.kind === 'values') {
          const selectedCodes = new Set(choiceFilter.values.map(normalizeWeldColumnChoiceValue))
          return rowCodes.some((code) => selectedCodes.has(normalizeWeldColumnChoiceValue(code)))
        }
        return rowCodes.some((code) => code.toLowerCase().includes(query))
      }]
    }

    const choiceFilter = parseWeldColumnChoiceFilter(value)
    if (choiceFilter) {
      const normalizedValues = new Set(choiceFilter.values.map(normalizeWeldColumnChoiceValue))
      return [(row: WeldRow) => normalizedValues.has(normalizeWeldColumnChoiceValue(getWeldColumnFilterRowText(row, key)))]
    }

    if (query.startsWith('=')) {
      const expectedValue = query.slice(1).trim().replace(/^["']|["']$/g, '')
      return [(row: WeldRow) => getWeldColumnFilterRowText(row, key).trim().toLowerCase() === expectedValue]
    }

    return [(row: WeldRow) => getWeldColumnFilterRowText(row, key).trim().toLowerCase().includes(query)]
  })
}

export function getWeldColumnFilterCellText(value: unknown) {
  return value === true ? 'да' : value === false || value == null ? '' : String(value)
}

export function getWeldColumnFilterRowText(row: WeldRow, fieldKey: string) {
  const value = row[fieldKey as keyof WeldRow]
  return fieldKey === 'finalStatus'
    ? formatFinalStatusDisplay(row, value)
    : getWeldColumnFilterCellText(value)
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

function getDispatcherTaskCodesFromRow(row: WeldRow) {
  return String(row.dispatcherTasks ?? '')
    .split(',')
    .map((code) => code.trim())
    .filter(Boolean)
}
