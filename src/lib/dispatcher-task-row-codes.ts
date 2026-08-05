import { getDispatcherTaskCode } from '@/lib/dispatcher-settings'
import type { DispatcherTask, WeldRow } from '@/lib/dispatcher-types'
import { ROW_ID_LIST_FILTER_KEY, buildRowIdListFilters, parseRowIdListFilter } from '@/lib/report-hidden-filters'
import { parseWeldColumnChoiceFilter } from '@/lib/weld-column-choice-filter'

export const DISPATCHER_TASKS_FIELD_KEY = 'dispatcherTasks' as const
export const DISPATCHER_TASKS_WITH_FILTER = '__with_dispatcher_tasks__'
export const DISPATCHER_TASKS_WITHOUT_FILTER = '__without_dispatcher_tasks__'

export type DispatcherTaskCodeRow = {
  rowId: number
  codes: string[]
}

export function buildDispatcherTaskCodesByRowId(tasks: DispatcherTask[], rows: WeldRow[]) {
  const codesByRowId = new Map<number, Set<string>>()

  for (const task of tasks) {
    if (task.kind === 'welder-stamp-expiry') continue
    const code = getDispatcherTaskCode(task)
    for (const rowId of getDispatcherTaskTargetRowIds(task, rows)) {
      const codes = codesByRowId.get(rowId) ?? new Set<string>()
      codes.add(code)
      codesByRowId.set(rowId, codes)
    }
  }

  return new Map(
    [...codesByRowId.entries()].map(([rowId, codes]) => [rowId, [...codes].sort(compareDispatcherTaskCodes)]),
  )
}

export function serializeDispatcherTaskCodesByRowId(codesByRowId: ReadonlyMap<number, readonly string[]>) {
  return [...codesByRowId.entries()]
    .sort(([left], [right]) => left - right)
    .map(([rowId, codes]) => ({ rowId, codes: [...codes] }))
}

export function deserializeDispatcherTaskCodesByRowId(rows: readonly DispatcherTaskCodeRow[]) {
  return new Map(rows.map((row) => [row.rowId, [...row.codes]]))
}

export function formatDispatcherTaskCodes(codes: readonly string[] | undefined) {
  return [...(codes ?? [])].sort(compareDispatcherTaskCodes).join(', ')
}

export function attachDispatcherTaskCodes<Row extends WeldRow>(
  rows: Row[],
  codesByRowId: ReadonlyMap<number, readonly string[]>,
) {
  return rows.map((row) => ({
    ...row,
    dispatcherTasks: formatDispatcherTaskCodes(codesByRowId.get(row.id)),
  }))
}

export function buildDispatcherTaskFilterOptions(codesByRowId: ReadonlyMap<number, readonly string[]>) {
  const counts = new Map<string, number>()
  for (const codes of codesByRowId.values()) {
    for (const code of codes) counts.set(code, (counts.get(code) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort(([left], [right]) => compareDispatcherTaskCodes(left, right))
    .map(([value, count]) => ({ value, count, label: value }))
}

export function buildDispatcherTaskServerFilters(
  columnFilters: Record<string, string>,
  codesByRowId: ReadonlyMap<number, readonly string[]>,
) {
  const taskFilterValue = String(columnFilters[DISPATCHER_TASKS_FIELD_KEY] ?? '').trim()
  if (!taskFilterValue) return columnFilters

  const filters = { ...columnFilters }
  delete filters[DISPATCHER_TASKS_FIELD_KEY]

  const matchingTaskRowIds = getMatchingDispatcherTaskRowIds(taskFilterValue, codesByRowId)
  const existingRowFilter = parseRowIdListFilter(String(filters[ROW_ID_LIST_FILTER_KEY] ?? ''))
  const combinedFilter = combineRowIdFilters(existingRowFilter, matchingTaskRowIds)
  Object.assign(filters, buildRowIdListFilters(combinedFilter.rowIds, combinedFilter.mode))
  return filters
}

export function getDispatcherTaskFilterMode(value: string | undefined) {
  if (value === DISPATCHER_TASKS_WITH_FILTER) return 'with'
  if (value === DISPATCHER_TASKS_WITHOUT_FILTER) return 'without'
  return value?.trim() ? 'codes' : 'all'
}

export function compareDispatcherTaskCodes(left: string, right: string) {
  return left.localeCompare(right, 'ru', { numeric: true })
}

function getDispatcherTaskTargetRowIds(task: Exclude<DispatcherTask, { kind: 'welder-stamp-expiry' }>, rows: WeldRow[]) {
  if (task.kind === 'line-consistency' || task.kind === 'percentage-line-control') {
    return rows
      .filter(
        (row) =>
          normalizeLinePart(row.projectTitle) === normalizeLinePart(task.projectTitle) &&
          normalizeLinePart(row.subtitleCode) === normalizeLinePart(task.subtitleCode) &&
          normalizeLinePart(row.line) === normalizeLinePart(task.line),
      )
      .map((row) => row.id)
  }

  return [task.row.id]
}

function normalizeLinePart(value: unknown) {
  return String(value ?? '').trim().toLowerCase()
}

function getMatchingDispatcherTaskRowIds(
  filterValue: string,
  codesByRowId: ReadonlyMap<number, readonly string[]>,
) {
  if (filterValue === DISPATCHER_TASKS_WITH_FILTER) {
    return { rowIds: [...codesByRowId.keys()], mode: 'include' as const }
  }
  if (filterValue === DISPATCHER_TASKS_WITHOUT_FILTER) {
    return { rowIds: [...codesByRowId.keys()], mode: 'exclude' as const }
  }

  const choiceFilter = parseWeldColumnChoiceFilter(filterValue)
  const selectedCodes = new Set(choiceFilter?.kind === 'values' ? choiceFilter.values : [filterValue])
  return {
    rowIds: [...codesByRowId.entries()]
      .filter(([, codes]) => codes.some((code) => selectedCodes.has(code)))
      .map(([rowId]) => rowId),
    mode: 'include' as const,
  }
}

function combineRowIdFilters(
  existingFilter: ReturnType<typeof parseRowIdListFilter>,
  taskFilter: { rowIds: number[]; mode: 'include' | 'exclude' },
) {
  if (!existingFilter) return taskFilter

  const existingIds = new Set(existingFilter.rowIds)
  const taskIds = new Set(taskFilter.rowIds)
  if (existingFilter.mode !== 'exclude' && taskFilter.mode === 'include') {
    return { rowIds: [...existingIds].filter((rowId) => taskIds.has(rowId)), mode: 'include' as const }
  }
  if (existingFilter.mode !== 'exclude' && taskFilter.mode === 'exclude') {
    return { rowIds: [...existingIds].filter((rowId) => !taskIds.has(rowId)), mode: 'include' as const }
  }
  if (existingFilter.mode === 'exclude' && taskFilter.mode === 'include') {
    return { rowIds: [...taskIds].filter((rowId) => !existingIds.has(rowId)), mode: 'include' as const }
  }
  return { rowIds: [...new Set([...existingIds, ...taskIds])], mode: 'exclude' as const }
}
