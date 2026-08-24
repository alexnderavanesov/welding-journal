import {
  getDispatcherSettingTaskTypeLabel,
  getDispatcherTaskCode,
  getDispatcherTaskSettingId,
} from '@/lib/dispatcher-settings'
import { compareDispatcherTaskCodes } from '@/lib/dispatcher-task-row-codes'
import type { DispatcherTask, RepeatedJointTaskGroup } from '@/lib/dispatcher-types'

export type DispatcherTaskCodeGroup = {
  code: string
  label: string
  tasks: DispatcherTask[]
  objectGroups: RepeatedJointTaskGroup[]
  metric: string | null
}

export function buildDispatcherTaskCodeGroups(
  groups: RepeatedJointTaskGroup[],
): DispatcherTaskCodeGroup[] {
  const codeGroups = new Map<string, DispatcherTaskCodeGroup>()

  for (const objectGroup of groups) {
    const tasksByCode = new Map<string, DispatcherTask[]>()
    for (const task of objectGroup.tasks) {
      const code = getDispatcherTaskCode(task)
      const tasks = tasksByCode.get(code) ?? []
      tasks.push(task)
      tasksByCode.set(code, tasks)
    }

    for (const [code, tasks] of tasksByCode) {
      const existing = codeGroups.get(code)
      const splitObjectGroup = {
        ...objectGroup,
        key: `${objectGroup.key}:${code}`,
        tasks,
      }
      if (existing) {
        existing.tasks.push(...tasks)
        existing.objectGroups.push(splitObjectGroup)
        continue
      }

      const firstTask = tasks[0]
      codeGroups.set(code, {
        code,
        label: getDispatcherSettingTaskTypeLabel(getDispatcherTaskSettingId(firstTask)),
        tasks: [...tasks],
        objectGroups: [splitObjectGroup],
        metric: null,
      })
    }
  }

  return [...codeGroups.values()]
    .map((group) => ({ ...group, metric: getDispatcherTaskCodeGroupMetric(group.tasks) }))
    .sort((left, right) => compareDispatcherTaskCodes(left.code, right.code))
}

function getDispatcherTaskCodeGroupMetric(tasks: DispatcherTask[]) {
  if (tasks.length < 2 || tasks.some((task) => task.kind !== 'percentage-line-control')) return null

  const percentageTasks = tasks.filter((task) => task.kind === 'percentage-line-control')
  const issue = percentageTasks[0]?.issue
  if (!issue || percentageTasks.some((task) => task.issue !== issue)) return null

  const total = percentageTasks.reduce((sum, task) => sum + task.count, 0)
  const label = issue === 'missing'
    ? 'осталось'
    : issue === 'excess'
    ? 'лишних'
    : issue === 'new-welder'
    ? 'стыков'
    : issue === 'suspend-welder'
    ? 'негодных'
    : 'проблем'
  return `${label} ${total}`
}
