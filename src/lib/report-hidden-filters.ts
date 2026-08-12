import { DISPATCHER_TASK_FILTER_KEY } from '@/lib/dispatcher-task-row-codes'
import { normalizeJointName } from '@/lib/joint-name'
import {
  escapeRegExp,
  loadSystemIndexSettings,
  type SystemIndexSettings,
} from '@/lib/system-index-settings'

export const PERCENTAGE_LINE_STAMP_FILTER_KEY = '__percentageLineStamp'
export const ROW_ID_LIST_FILTER_KEY = '__rowIdList'
export const JOINT_CHAIN_FILTER_KEY = '__jointChain'

export type PercentageLineStampFilter = {
  projectTitle: string
  subtitleCode: string
  line: string
  stamp: string
}

export type RowIdListFilter = {
  rowIds: number[]
  mode?: 'include' | 'exclude'
}

export type JointChainFilter = {
  baseJoint: string
  suffixes: string[]
}

function trimRowText(value: unknown) {
  return String(value ?? '').trim()
}

export function buildPercentageLineStampFilters(filter: PercentageLineStampFilter) {
  return {
    projectTitle: trimRowText(filter.projectTitle),
    subtitleCode: trimRowText(filter.subtitleCode),
    line: trimRowText(filter.line),
    [PERCENTAGE_LINE_STAMP_FILTER_KEY]: JSON.stringify({
      projectTitle: trimRowText(filter.projectTitle),
      subtitleCode: trimRowText(filter.subtitleCode),
      line: trimRowText(filter.line),
      stamp: trimRowText(filter.stamp),
    } satisfies PercentageLineStampFilter),
  }
}

export function buildRowIdListFilters(rowIds: number[], mode: 'include' | 'exclude' = 'include') {
  const uniqueRowIds = Array.from(new Set(rowIds.filter(Number.isFinite)))
  return {
    [ROW_ID_LIST_FILTER_KEY]: JSON.stringify(
      mode === 'exclude'
        ? ({ rowIds: uniqueRowIds, mode } satisfies RowIdListFilter)
        : ({ rowIds: uniqueRowIds } satisfies RowIdListFilter),
    ),
  }
}

export function buildJointChainFilter(
  baseJoint: string,
  settings: SystemIndexSettings = loadSystemIndexSettings(),
) {
  return {
    [JOINT_CHAIN_FILTER_KEY]: JSON.stringify({
      baseJoint: normalizeJointName(baseJoint),
      suffixes: [settings.repair, settings.cutout, settings.coil],
    } satisfies JointChainFilter),
  }
}

export function parsePercentageLineStampFilter(value: string): PercentageLineStampFilter | null {
  try {
    const parsed = JSON.parse(value) as Partial<PercentageLineStampFilter>
    const filter = {
      projectTitle: trimRowText(parsed.projectTitle),
      subtitleCode: trimRowText(parsed.subtitleCode),
      line: trimRowText(parsed.line),
      stamp: trimRowText(parsed.stamp),
    }
    return filter.stamp ? filter : null
  } catch {
    return null
  }
}

export function parseRowIdListFilter(value: string): RowIdListFilter | null {
  try {
    const parsed = JSON.parse(value) as Partial<RowIdListFilter>
    const rowIds = Array.isArray(parsed.rowIds)
      ? parsed.rowIds.map((rowId) => Number(rowId)).filter(Number.isFinite)
      : []
    const mode = parsed.mode === 'exclude' ? 'exclude' : 'include'
    return { rowIds, mode }
  } catch {
    return null
  }
}

export function parseJointChainFilter(value: string): JointChainFilter | null {
  try {
    const parsed = JSON.parse(value) as Partial<JointChainFilter>
    const baseJoint = normalizeJointName(parsed.baseJoint)
    const suffixes = Array.isArray(parsed.suffixes)
      ? [...new Set(parsed.suffixes.map((suffix) => trimRowText(suffix).toUpperCase()).filter((suffix) => /^[A-Z]$/.test(suffix)))]
      : []
    return baseJoint && suffixes.length > 0 ? { baseJoint, suffixes } : null
  } catch {
    return null
  }
}

export function getJointChainFilterPattern(filter: JointChainFilter) {
  const suffixPattern = filter.suffixes.map(escapeRegExp).join('')
  return `^${escapeRegExp(normalizeJointName(filter.baseJoint))}(?:[${suffixPattern}]\\d+)*$`
}

export function matchesJointChainFilter(value: unknown, filter: JointChainFilter | null) {
  if (!filter) return false
  return new RegExp(getJointChainFilterPattern(filter), 'i').test(normalizeJointName(value))
}

export function isHiddenReportFilterKey(key: string) {
  return (
    key === DISPATCHER_TASK_FILTER_KEY ||
    key === PERCENTAGE_LINE_STAMP_FILTER_KEY ||
    key === ROW_ID_LIST_FILTER_KEY ||
    key === JOINT_CHAIN_FILTER_KEY
  )
}
