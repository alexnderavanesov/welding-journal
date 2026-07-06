import { parseJointChainName } from '@/lib/joint-chain'
import type { DispatcherTask, RepeatedJointTaskGroup, WeldRow } from '@/lib/dispatcher-types'
import { formatWelderStampCompactLabel } from '@/lib/welder-stamp-format'

export function groupRepeatedJointTasks(
  tasks: DispatcherTask[],
  getChainKey: (row: WeldRow) => string | null,
): RepeatedJointTaskGroup[] {
  const groups = new Map<string, RepeatedJointTaskGroup>()
  for (const task of tasks) {
    const key = getRepeatedJointTaskGroupKey(task, getChainKey)
    const group = groups.get(key)
    if (group) {
      group.tasks.push(task)
    } else {
      groups.set(key, { key, baseJoint: getRepeatedJointTaskBaseJoint(task), tasks: [task] })
    }
  }
  return [...groups.values()]
}

function getRepeatedJointTaskGroupKey(task: DispatcherTask, getChainKey: (row: WeldRow) => string | null) {
  if (task.kind === 'welder-stamp-expiry') return `welder-stamp-expiry:${task.naksStamp.trim().toLowerCase()}`
  if (task.kind === 'line-consistency') {
    return `line-consistency:${task.projectTitle.trim().toLowerCase()}:${task.subtitleCode.trim().toLowerCase()}:${task.line.trim().toLowerCase()}`
  }
  if (task.kind === 'percentage-line-control') {
    return `percentage-line-control:${task.projectTitle.trim().toLowerCase()}:${task.subtitleCode.trim().toLowerCase()}:${task.line.trim().toLowerCase()}:${task.stamp.trim().toLowerCase()}`
  }
  return getChainKey(task.row) ?? getRepeatedJointTaskBaseJoint(task)
}

function getRepeatedJointTaskBaseJoint(task: DispatcherTask) {
  if (task.kind === 'welder-stamp-expiry') return formatWelderStampCompactLabel(task)
  if (task.kind === 'line-consistency') return task.line
  if (task.kind === 'percentage-line-control') return `${task.line} · ${task.stamp}`
  if (task.kind === 'check' || task.kind === 'duplicate-check' || task.kind === 'rename') return task.baseJoint
  return parseJointChainName(task.sourceJoint).base || task.sourceJoint
}
