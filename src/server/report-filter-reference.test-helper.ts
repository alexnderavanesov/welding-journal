import { getPstoDisplayValue } from '@/lib/lnk-status'
import { withPendingPstoResultStatus } from '@/lib/psto-field-updates'
import { withAutoVikForWeldDate } from '@/lib/weld-record-transforms'
// The former in-memory selection is retained only as a test reference.
// Runtime report queries use the shared SQL selection and bounded page reads.
import type { WeldJoint } from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import { FIELD_BY_KEY, type WeldFieldKey } from '@/lib/weld-fields'
import { filterWeldRowsByColumns, getWeldColumnFilterRowValues } from '@/lib/weld-table-filtering'
import { PSTO_CURRENT_SQL_FIELD_KEYS } from './psto-report-current-values'
import { buildServerReportRows, normalizeWeldPageRequest, sortColumnFilterOptions } from './weld-read'
import { WELD_PAGE_ALL_SIZE, type WeldColumnFilterOption, type WeldPageResult, type WeldReportKind, type WeldSort } from './weld-contracts'

export function buildWeldReportPageFromRows(
  sourceRows: WeldJoint[],
  request: ReturnType<typeof normalizeWeldPageRequest>,
  report: WeldReportKind,
): WeldPageResult {
  const reportRows = buildServerReportRows(sourceRows, report)
  const filterRows = report === 'heatTreatment'
    ? projectPstoReportDisplayValues(reportRows, Object.keys(request.columnFilters))
    : reportRows
  const matchedRows = filterWeldRowsByColumns(filterRows, request.columnFilters)
  const filteredIds = report === 'heatTreatment' ? new Set(matchedRows.map(row => row.id)) : null
  const filteredRows = sortReportRows(
    filteredIds ? reportRows.filter(row => filteredIds.has(row.id)) : matchedRows,
    request.sort,
    report,
  )
  const rows =
    request.pageSize === WELD_PAGE_ALL_SIZE
      ? filteredRows
      : filteredRows.slice((request.page - 1) * request.pageSize, request.page * request.pageSize)

  return {
    rows,
    total: filteredRows.length,
    page: request.page,
    pageSize: request.pageSize,
    hasMore: request.pageSize !== WELD_PAGE_ALL_SIZE && request.page * request.pageSize < filteredRows.length,
  }
}

export function buildWeldColumnFilterOptionsFromRows(rows: WeldRow[], fieldKey: WeldFieldKey): WeldColumnFilterOption[] {
  const counts = new Map<string, number>()
  for (const row of rows) {
    for (const value of getWeldColumnFilterRowValues(row, fieldKey)) {
      counts.set(value, (counts.get(value) ?? 0) + 1)
    }
  }

  return sortColumnFilterOptions(
    Array.from(counts.entries()).map(([value, count]) => ({
      value,
      count,
      label: value || '(пусто)',
    })),
  )
}

export function sortReportRows(rows: WeldRow[], sort?: WeldSort, report?: WeldReportKind) {
  if (!sort) return rows
  const field = FIELD_BY_KEY.get(sort.fieldKey)
  if (!field) return rows
  const direction = sort.direction === 'desc' ? -1 : 1
  const pstoValues = report === 'heatTreatment'
    ? new Map(projectPstoReportDisplayValues(rows, [sort.fieldKey]).map(row => [row.id, row[sort.fieldKey]]))
    : null
  return [...rows].sort((left, right) => {
    const leftValue = pstoValues ? pstoValues.get(left.id) : left[sort.fieldKey]
    const rightValue = pstoValues ? pstoValues.get(right.id) : right[sort.fieldKey]
    const leftEmpty = leftValue === null || leftValue === undefined || String(leftValue).trim() === ''
    const rightEmpty = rightValue === null || rightValue === undefined || String(rightValue).trim() === ''
    if (leftEmpty || rightEmpty) {
      if (leftEmpty && rightEmpty) return left.id - right.id
      return leftEmpty ? 1 : -1
    }
    const comparison = field.kind === 'number'
      ? (Number(leftValue) || 0) - (Number(rightValue) || 0)
      : String(leftValue).localeCompare(String(rightValue), 'ru', { numeric: true, sensitivity: 'base' })
    return comparison === 0 ? left.id - right.id : comparison * direction
  })
}

const DISPLAY_FIELD_KEYS = new Set<WeldFieldKey>([
  ...PSTO_CURRENT_SQL_FIELD_KEYS, 'pstoCycleSummary', 'controlBasisSummary',
])

/** Temporary filter/facet values only. Never hydrate report cards with this
 * projection: their primary fields are the source of cycle history and exports. */
export function projectPstoReportDisplayValues<Row extends WeldRow>(rows: Row[], fieldKeys: readonly string[]): Row[] {
  const keys = [...new Set(fieldKeys)].filter((key): key is WeldFieldKey => DISPLAY_FIELD_KEYS.has(key as WeldFieldKey))
  if (keys.length === 0) return rows
  return rows.map(row => {
    // The table prepares primary waiting labels before selecting the current
    // cycle. Repeat fields remain factual, including a sparse current repeat.
    const displayRow = { ...withPendingPstoResultStatus(withAutoVikForWeldDate(row)), finalStatus: undefined }
    // The UI recalculates finalStatus; a stored rejection is not a source fact.
    // getPstoDisplayValue already checks the actual main/duplicate/pre-TO
    // rejects, which cover every recalculated rejected final status.
    return {
      ...row,
      ...Object.fromEntries(keys.map(key => [key, getPstoDisplayValue(displayRow, key)])),
    }
  })
}
