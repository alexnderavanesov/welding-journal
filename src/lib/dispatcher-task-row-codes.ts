import { getDispatcherTaskCode } from '@/lib/dispatcher-settings'
import type { DispatcherTask, WeldRow } from '@/lib/dispatcher-types'
import { parseWeldColumnChoiceFilter } from '@/lib/weld-column-choice-filter'

export const DISPATCHER_TASKS_FIELD_KEY = 'dispatcherTasks' as const
export const DISPATCHER_TASK_FILTER_KEY = '__dispatcherTaskFilter' as const
export const DISPATCHER_TASKS_WITH_FILTER = '__with_dispatcher_tasks__'
export const DISPATCHER_TASKS_WITHOUT_FILTER = '__without_dispatcher_tasks__'

export type DispatcherTaskIndexRow = {
  rowId: number
  taskKey: string
  code: string
}

export function buildDispatcherTaskIndexRows(tasks: DispatcherTask[], rows: WeldRow[]): DispatcherTaskIndexRow[] {
  const entries = new Map<string, DispatcherTaskIndexRow>()

  for (const task of tasks) {
    if (task.kind === 'welder-stamp-expiry') continue
    const code = getDispatcherTaskCode(task)
    for (const rowId of getDispatcherTaskTargetRowIds(task, rows)) {
      const entry = { rowId, taskKey: task.key, code }
      entries.set(`${rowId}\u0000${task.key}`, entry)
    }
  }

  return [...entries.values()].sort(
    (left, right) =>
      left.rowId - right.rowId ||
      compareDispatcherTaskCodes(left.code, right.code) ||
      left.taskKey.localeCompare(right.taskKey, 'ru'),
  )
}

export function formatDispatcherTaskCodes(codes: readonly string[] | undefined) {
  return [...(codes ?? [])].sort(compareDispatcherTaskCodes).join(', ')
}

export function buildDispatcherTaskServerFilters(
  columnFilters: Record<string, string>,
) {
  const taskFilterValue = String(columnFilters[DISPATCHER_TASKS_FIELD_KEY] ?? '').trim()
  const filters = { ...columnFilters }
  delete filters[DISPATCHER_TASKS_FIELD_KEY]
  if (!taskFilterValue) return filters

  const choiceFilter = parseWeldColumnChoiceFilter(taskFilterValue)
  const codes = choiceFilter?.kind === 'values'
    ? choiceFilter.values
    : taskFilterValue &&
        taskFilterValue !== DISPATCHER_TASKS_WITH_FILTER &&
        taskFilterValue !== DISPATCHER_TASKS_WITHOUT_FILTER
      ? [taskFilterValue]
      : []
  filters[DISPATCHER_TASK_FILTER_KEY] = JSON.stringify({
    mode: getDispatcherTaskFilterMode(taskFilterValue),
    codes,
  })
  return filters
}

export type DispatcherTaskServerFilter = {
  mode: 'all' | 'with' | 'without' | 'codes'
  codes: string[]
}

export function parseDispatcherTaskServerFilter(value: string | undefined): DispatcherTaskServerFilter | null {
  if (!value?.trim()) return null
  try {
    const parsed = JSON.parse(value) as Partial<DispatcherTaskServerFilter>
    const mode = parsed.mode === 'with' || parsed.mode === 'without' || parsed.mode === 'codes'
      ? parsed.mode
      : 'all'
    return {
      mode,
      codes: [...new Set((Array.isArray(parsed.codes) ? parsed.codes : []).map(String).map((code) => code.trim()).filter(Boolean))],
    }
  } catch {
    return null
  }
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
