import { parseJointChainName } from '@/lib/joint-chain'
import { makeExactColumnFilterValue } from '@/lib/report-ui-state'
import type { RepeatedJointTask } from '@/lib/dispatcher-types'
import type { WeldInput } from '@/lib/weld-fields'
import { buildJointChainFilter, isHiddenReportFilterKey } from '@/lib/report-hidden-filters'
import {
  buildWeldColumnValueFilter,
  parseWeldColumnChoiceFilter,
} from '@/lib/weld-column-choice-filter'

export {
  PERCENTAGE_LINE_STAMP_FILTER_KEY,
  ROW_ID_LIST_FILTER_KEY,
  JOINT_CHAIN_FILTER_KEY,
  buildJointChainFilter,
  buildPercentageLineStampFilters,
  buildRowIdListFilters,
  isHiddenReportFilterKey,
  parsePercentageLineStampFilter,
  parseRowIdListFilter,
  parseJointChainFilter,
  type PercentageLineStampFilter,
  type RowIdListFilter,
  type JointChainFilter,
} from '@/lib/report-hidden-filters'

function trimRowText(value: unknown) {
  return String(value ?? '').trim()
}

export function buildJointChainFilters(row: WeldInput, baseJoint: string) {
  return {
    projectTitle: trimRowText(row.projectTitle),
    subtitleCode: trimRowText(row.subtitleCode),
    line: trimRowText(row.line),
    joint: baseJoint,
    ...buildJointChainFilter(baseJoint),
  }
}

export function buildExactJointFilters(row: WeldInput) {
  return {
    projectTitle: trimRowText(row.projectTitle),
    subtitleCode: trimRowText(row.subtitleCode),
    line: trimRowText(row.line),
    joint: makeExactColumnFilterValue(row.joint),
  }
}

const WELD_IDENTITY_FILTER_KEYS = ['projectTitle', 'subtitleCode', 'line', 'joint'] as const

export function followUpdatedWeldRowFilters(
  filters: Record<string, string>,
  previousRow: WeldInput,
  nextRow: WeldInput,
) {
  let nextFilters = filters

  for (const fieldKey of WELD_IDENTITY_FILTER_KEYS) {
    const filterValue = filters[fieldKey]
    if (!filterValue) continue

    const previousValue = trimRowText(previousRow[fieldKey])
    const nextValue = trimRowText(nextRow[fieldKey])
    if (normalizeFilterText(previousValue) === normalizeFilterText(nextValue)) continue

    const followedValue = followIdentityFilterValue(filterValue, previousValue, nextValue)
    if (followedValue === filterValue) continue
    if (nextFilters === filters) nextFilters = { ...filters }
    nextFilters[fieldKey] = followedValue
  }

  return nextFilters
}

export function buildLineFilters(row: WeldInput) {
  return {
    projectTitle: trimRowText(row.projectTitle),
    subtitleCode: trimRowText(row.subtitleCode),
    line: trimRowText(row.line),
  }
}

export function omitHiddenReportFilters(filters: Record<string, string>) {
  return Object.fromEntries(Object.entries(filters).filter(([key]) => !isHiddenReportFilterKey(key)))
}

export function getJointBaseFromRow(row: WeldInput) {
  const joint = trimRowText(row.joint)
  return parseJointChainName(joint).base || joint
}

export function getRepeatedJointTaskBaseJoint(task: RepeatedJointTask) {
  if (task.kind === 'line-consistency') return task.line
  if (task.kind === 'percentage-line-control') return task.line
  if (task.kind === 'check' || task.kind === 'duplicate-check' || task.kind === 'rename') {
    return task.baseJoint
  }
  return parseJointChainName(task.sourceJoint).base || task.sourceJoint
}

export function getRepeatedJointTaskActionText(task: RepeatedJointTask) {
  if (task.kind === 'line-consistency') return task.title.toLowerCase()
  if (task.kind === 'percentage-line-control') return task.title.toLowerCase()
  if (task.kind === 'check') return `проверьте ${task.targetJoint}`
  if (task.kind === 'duplicate-check') return `проверьте возможные дубли: ${task.count}`
  if (task.kind === 'rename') return `проверьте переименование ${task.currentJoint} → ${task.targetJoint}`
  return 'проверьте перед созданием'
}

function followIdentityFilterValue(filterValue: string, previousValue: string, nextValue: string) {
  const choiceFilter = parseWeldColumnChoiceFilter(filterValue)
  if (choiceFilter) {
    const previousNormalized = normalizeFilterText(previousValue)
    const nextNormalized = normalizeFilterText(nextValue)
    const hasPreviousValue = choiceFilter.values.some(
      (value) => normalizeFilterText(value) === previousNormalized,
    )
    const hasNextValue = choiceFilter.values.some(
      (value) => normalizeFilterText(value) === nextNormalized,
    )
    if (!hasPreviousValue || hasNextValue) return filterValue

    const values = choiceFilter.values.length === 1
      ? [nextValue]
      : [...choiceFilter.values, nextValue]
    return buildWeldColumnValueFilter(values)
  }

  const trimmedFilter = filterValue.trim()
  if (trimmedFilter.startsWith('=')) {
    const expectedValue = trimmedFilter.slice(1).trim().replace(/^["']|["']$/g, '')
    return normalizeFilterText(expectedValue) === normalizeFilterText(previousValue)
      ? makeExactColumnFilterValue(nextValue)
      : filterValue
  }

  if (normalizeFilterText(trimmedFilter) !== normalizeFilterText(previousValue)) return filterValue
  return nextValue || makeExactColumnFilterValue(nextValue)
}

function normalizeFilterText(value: unknown) {
  return trimRowText(value).toLocaleLowerCase('ru-RU')
}
