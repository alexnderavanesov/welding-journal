import { isMandatoryDispatcherTask } from '@/lib/dispatcher-settings'
import { DISPATCHER_SETTING_CODES, getDispatcherTaskCode } from '@/lib/dispatcher-settings'
import {
  getDispatcherTasksForJointPicture,
  getDispatcherTasksForLinePicture,
} from '@/lib/dispatcher-task-row-codes'
import {
  type RepeatedJointTask,
  type WeldRow,
} from '@/lib/dispatcher-types'

const LINE_SCOPED_TASK_CODES = new Set([
  'СП-01',
  DISPATCHER_SETTING_CODES['percentage-new-welder'],
  DISPATCHER_SETTING_CODES['percentage-excess'],
  DISPATCHER_SETTING_CODES['percentage-rejected-rows'],
  DISPATCHER_SETTING_CODES['percentage-missing'],
  DISPATCHER_SETTING_CODES['percentage-full-control'],
  DISPATCHER_SETTING_CODES['line-control-presence'],
])

type BuildJointPictureTaskCollectionOptions = {
  row: WeldRow
  tasks: readonly RepeatedJointTask[]
  fallbackCodes?: string
}

export function buildJointPictureTaskCollection({
  row,
  tasks,
  fallbackCodes = '',
}: BuildJointPictureTaskCollectionOptions) {
  const jointTasks = getDispatcherTasksForJointPicture(tasks, row)
  const lineTasks = getDispatcherTasksForLinePicture(tasks, row)
  const hiddenTaskCodes = new Set(
    lineTasks.filter(isLineScopedTask).map(getDispatcherTaskCode),
  )
  const relatedTasks = jointTasks.sort(compareTasks)
  const relatedTaskCodes = new Set(relatedTasks.map(getDispatcherTaskCode))
  const codes = parseCodes(fallbackCodes).filter(
    (code) =>
      !LINE_SCOPED_TASK_CODES.has(code) &&
      !hiddenTaskCodes.has(code) &&
      !relatedTaskCodes.has(code),
  )
  const systemWarningCount = relatedTasks.filter(isMandatoryDispatcherTask).length +
    codes.filter((code) => code.startsWith('СП-')).length
  const dispatcherTaskCount = relatedTasks.length - relatedTasks.filter(isMandatoryDispatcherTask).length +
    codes.filter((code) => !code.startsWith('СП-')).length

  return {
    relatedTasks,
    codes,
    systemWarningCount,
    dispatcherTaskCount,
    totalCount: relatedTasks.length + codes.length,
  }
}

function compareTasks(left: RepeatedJointTask, right: RepeatedJointTask) {
  const systemWarningOrder = Number(isMandatoryDispatcherTask(right)) - Number(isMandatoryDispatcherTask(left))
  return (
    systemWarningOrder ||
    getDispatcherTaskCode(left).localeCompare(getDispatcherTaskCode(right), 'ru', { numeric: true }) ||
    left.key.localeCompare(right.key, 'ru')
  )
}

function parseCodes(value: string) {
  return [...new Set(value.split(/[,;]+/).map((code) => code.trim()).filter(Boolean))]
}

function isLineScopedTask(task: RepeatedJointTask) {
  return task.kind === 'line-consistency' || task.kind === 'percentage-line-control'
}
