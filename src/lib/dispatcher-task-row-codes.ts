import { getDispatcherTaskCode } from '@/lib/dispatcher-settings'
import type { DispatcherTask, RepeatedJointTask, WeldRow } from '@/lib/dispatcher-types'
import { encodeIdentityKey } from '@/lib/identity-key'
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

export type DispatcherTaskCodeRow = {
  rowId: number
  code: string
}

export function buildMergedDispatcherTaskCodes(
  activeTaskRows: DispatcherTaskCodeRow[],
  backgroundTaskRows: DispatcherTaskCodeRow[],
) {
  const activeByRowId = buildDispatcherCodesByRowId(activeTaskRows)
  const allByRowId = buildDispatcherCodesByRowId([...activeTaskRows, ...backgroundTaskRows])
  return { activeByRowId, allByRowId }
}

export function buildDispatcherTaskIndexRows(tasks: DispatcherTask[], rows: WeldRow[]): DispatcherTaskIndexRow[] {
  return buildDispatcherTaskIndexRowsWithMode(tasks, rows, false)
}

/** Persisted row filters only consume task codes, never individual task keys. */
export function buildDispatcherTaskCodeIndexRows(tasks: DispatcherTask[], rows: WeldRow[]): DispatcherTaskIndexRow[] {
  return buildDispatcherTaskIndexRowsWithMode(tasks, rows, true)
}

function buildDispatcherTaskIndexRowsWithMode(
  tasks: DispatcherTask[],
  rows: WeldRow[],
  dedupeByCode: boolean,
): DispatcherTaskIndexRow[] {
  const entries = new Map<string, DispatcherTaskIndexRow>()
  const targetRows = buildDispatcherTaskTargetRows(rows)

  for (const task of tasks) {
    if (task.kind === 'welder-stamp-expiry') continue
    const code = getDispatcherTaskCode(task)
    for (const rowId of getDispatcherTaskTargetRowIds(task, targetRows)) {
      const taskKey = dedupeByCode ? `code:${code}` : task.key
      const entry = { rowId, taskKey, code }
      entries.set(`${rowId}\u0000${taskKey}`, entry)
    }
  }

  return [...entries.values()].sort(
    (left, right) =>
      left.rowId - right.rowId ||
      compareDispatcherTaskCodes(left.code, right.code) ||
      left.taskKey.localeCompare(right.taskKey, 'ru'),
  )
}

export function isDispatcherTaskRelatedToRow(task: RepeatedJointTask, row: WeldRow) {
  if (task.kind === 'line-consistency' || task.kind === 'percentage-line-control') {
    return hasSameLineIdentity(task, row)
  }
  if (task.kind === 'rename') {
    return task.sourceRow.id === row.id || task.changes.some((change) => change.rowId === row.id)
  }
  if (task.kind === 'delete' || task.kind === 'check') {
    return task.row.id === row.id || task.sourceRow.id === row.id
  }
  if (task.kind === 'duplicate-check') {
    return hasSameJointIdentity(task.row, row)
  }
  return task.row.id === row.id
}

export function getDispatcherTasksForRow(tasks: readonly RepeatedJointTask[], row: WeldRow) {
  return tasks.filter((task) => isDispatcherTaskRelatedToRow(task, row))
}

export function isDispatcherTaskDirectlyRelatedToJoint(task: RepeatedJointTask, row: WeldRow) {
  if (task.kind === 'line-consistency' || task.kind === 'percentage-line-control') return false
  return isDispatcherTaskRelatedToRow(task, row)
}

export function getDispatcherTasksForJointPicture(tasks: readonly RepeatedJointTask[], row: WeldRow) {
  return tasks.filter((task) => isDispatcherTaskDirectlyRelatedToJoint(task, row))
}

export function isDispatcherTaskRelatedToLine(task: RepeatedJointTask, row: WeldRow) {
  if (task.kind === 'line-consistency' || task.kind === 'percentage-line-control') {
    return hasSameLineIdentity(task, row)
  }
  return hasSameLineIdentity(task.row, row)
}

export function getDispatcherTasksForLinePicture(tasks: readonly RepeatedJointTask[], row: WeldRow) {
  return tasks.filter((task) => isDispatcherTaskRelatedToLine(task, row))
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

export function buildWeldColumnFilterOptionsRequestFilters(
  columnFilters: Record<string, string>,
  fieldKey: string,
) {
  const filtersWithoutCurrent = { ...columnFilters }
  delete filtersWithoutCurrent[fieldKey]
  return buildDispatcherTaskServerFilters(filtersWithoutCurrent)
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
  const systemWarningOrder = Number(!left.startsWith('СП-')) - Number(!right.startsWith('СП-'))
  return systemWarningOrder || left.localeCompare(right, 'ru', { numeric: true })
}

function buildDispatcherCodesByRowId(taskRows: DispatcherTaskCodeRow[]) {
  const result = new Map<number, string>()
  const sets = new Map<number, Set<string>>()
  for (const taskRow of taskRows) {
    const codes = sets.get(taskRow.rowId) ?? new Set<string>()
    codes.add(taskRow.code)
    sets.set(taskRow.rowId, codes)
  }
  for (const [rowId, codes] of sets) result.set(rowId, formatDispatcherTaskCodes([...codes]))
  return result
}

type DispatcherTaskTargetRows = {
  byLine: ReadonlyMap<string, number[]>
  byJoint: ReadonlyMap<string, number[]>
}

function buildDispatcherTaskTargetRows(rows: WeldRow[]): DispatcherTaskTargetRows {
  const byLine = new Map<string, number[]>()
  const byJoint = new Map<string, number[]>()
  for (const row of rows) {
    const lineKey = getLineIdentityKey(row)
    const lineRowIds = byLine.get(lineKey)
    if (lineRowIds) lineRowIds.push(row.id)
    else byLine.set(lineKey, [row.id])

    const jointKey = getJointIdentityKey(row)
    const jointRowIds = byJoint.get(jointKey)
    if (jointRowIds) jointRowIds.push(row.id)
    else byJoint.set(jointKey, [row.id])
  }
  return { byLine, byJoint }
}

function getDispatcherTaskTargetRowIds(
  task: Exclude<DispatcherTask, { kind: 'welder-stamp-expiry' }>,
  rows: DispatcherTaskTargetRows,
) {
  if (task.kind === 'line-consistency' || task.kind === 'percentage-line-control') {
    return rows.byLine.get(getLineIdentityKey(task)) ?? []
  }
  if (task.kind === 'rename') return task.changes.map((change) => change.rowId)
  if (task.kind === 'duplicate-check') {
    return rows.byJoint.get(getJointIdentityKey(task.row)) ?? []
  }

  return [task.row.id]
}

function hasSameLineIdentity(
  task: Pick<WeldRow, 'projectTitle' | 'subtitleCode' | 'line'>,
  row: WeldRow,
) {
  return (
    normalizeLinePart(row.projectTitle) === normalizeLinePart(task.projectTitle) &&
    normalizeLinePart(row.subtitleCode) === normalizeLinePart(task.subtitleCode) &&
    normalizeLinePart(row.line) === normalizeLinePart(task.line)
  )
}

function hasSameJointIdentity(left: WeldRow, right: WeldRow) {
  return (
    normalizeLinePart(left.projectTitle) === normalizeLinePart(right.projectTitle) &&
    normalizeLinePart(left.subtitleCode) === normalizeLinePart(right.subtitleCode) &&
    normalizeLinePart(left.line) === normalizeLinePart(right.line) &&
    normalizeLinePart(left.joint) === normalizeLinePart(right.joint)
  )
}

function getLineIdentityKey(value: Pick<WeldRow, 'projectTitle' | 'subtitleCode' | 'line'>) {
  return encodeIdentityKey([
    normalizeLinePart(value.projectTitle),
    normalizeLinePart(value.subtitleCode),
    normalizeLinePart(value.line),
  ])
}

function getJointIdentityKey(value: Pick<WeldRow, 'projectTitle' | 'subtitleCode' | 'line' | 'joint'>) {
  return encodeIdentityKey([
    normalizeLinePart(value.projectTitle),
    normalizeLinePart(value.subtitleCode),
    normalizeLinePart(value.line),
    normalizeLinePart(value.joint),
  ])
}

function normalizeLinePart(value: unknown) {
  return String(value ?? '').trim().toLowerCase()
}
