import { getDispatcherTaskCode, getDispatcherTaskTypeLabel } from '@/lib/dispatcher-settings'
import type { RepeatedJointTask } from '@/lib/dispatcher-types'
import { getRepeatedJointTaskDetails, getRepeatedJointTaskTitle } from '@/lib/dispatcher-text'

export function normalizeDispatcherWorkspaceSearch(value: string) {
  return value.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').trim()
}

export function matchesDispatcherWorkspaceTask(task: RepeatedJointTask, search: string, code: string | null) {
  if (code && getDispatcherTaskCode(task) !== code) return false
  const terms = normalizeDispatcherWorkspaceSearch(search).split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true
  const values = [
    getDispatcherTaskCode(task),
    getDispatcherTaskTypeLabel(task),
    getRepeatedJointTaskTitle(task).type,
    getRepeatedJointTaskDetails(task),
    task.row.projectTitle,
    task.row.subtitleCode,
    task.row.line,
    task.row.joint,
    task.key,
    'title' in task ? task.title : '',
    'details' in task ? task.details : '',
    'sourceJoint' in task ? task.sourceJoint : '',
    'targetJoint' in task ? task.targetJoint : '',
    'baseJoint' in task ? task.baseJoint : '',
  ].map((value) => String(value ?? ''))
  const text = normalizeDispatcherWorkspaceSearch(values.join(' '))
  return terms.every((term) => text.includes(term))
}
