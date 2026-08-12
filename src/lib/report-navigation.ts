import { parseJointChainName } from '@/lib/joint-chain'
import { makeExactColumnFilterValue } from '@/lib/report-ui-state'
import type { RepeatedJointTask } from '@/lib/dispatcher-types'
import type { WeldInput } from '@/lib/weld-fields'
import { buildJointChainFilter, isHiddenReportFilterKey } from '@/lib/report-hidden-filters'

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
