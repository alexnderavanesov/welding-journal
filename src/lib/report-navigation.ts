import { parseJointChainName } from '@/lib/joint-chain'
import { makeExactColumnFilterValue } from '@/lib/report-ui-state'
import type { RepeatedJointTask } from '@/lib/dispatcher-types'
import type { WeldInput } from '@/lib/weld-fields'

export const PERCENTAGE_LINE_STAMP_FILTER_KEY = '__percentageLineStamp'

export type PercentageLineStampFilter = {
  projectTitle: string
  subtitleCode: string
  line: string
  stamp: string
}

function trimRowText(value: unknown) {
  return String(value ?? '').trim()
}

export function buildJointChainFilters(row: WeldInput, baseJoint: string) {
  return {
    projectTitle: trimRowText(row.projectTitle),
    subtitleCode: trimRowText(row.subtitleCode),
    line: trimRowText(row.line),
    joint: baseJoint,
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

export function buildLineFilters(row: WeldInput) {
  return {
    projectTitle: trimRowText(row.projectTitle),
    subtitleCode: trimRowText(row.subtitleCode),
    line: trimRowText(row.line),
  }
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

export function isHiddenReportFilterKey(key: string) {
  return key === PERCENTAGE_LINE_STAMP_FILTER_KEY
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
