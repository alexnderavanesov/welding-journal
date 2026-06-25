import { groupRepeatedJointTasks } from '@/lib/dispatcher-groups'
import type { RepeatedJointTask, RepeatedJointTaskGroup, WeldRow, WelderStampExpiryTask } from '@/lib/dispatcher-types'

type DispatcherTaskGroupsInput = {
  repeatedJointTasks: RepeatedJointTask[]
  welderStampExpiryTasks: WelderStampExpiryTask[]
  getJointChainConsistencyKey: (row: WeldRow) => string | null
}

export function buildDispatcherTaskGroups({
  repeatedJointTasks,
  welderStampExpiryTasks,
  getJointChainConsistencyKey,
}: DispatcherTaskGroupsInput): {
  repeatedJointTaskGroups: RepeatedJointTaskGroup[]
  welderStampNotificationGroups: RepeatedJointTaskGroup[]
} {
  return {
    repeatedJointTaskGroups: groupRepeatedJointTasks(repeatedJointTasks, getJointChainConsistencyKey),
    welderStampNotificationGroups: groupRepeatedJointTasks(welderStampExpiryTasks, getJointChainConsistencyKey),
  }
}

export function getVisibleDispatcherTaskKeys(
  activeReport: string,
  repeatedJointTasks: RepeatedJointTask[],
  welderStampExpiryTasks: WelderStampExpiryTask[],
) {
  const visibleTasks = activeReport === 'welderStamps' ? welderStampExpiryTasks : repeatedJointTasks
  return new Set(visibleTasks.map((task) => task.key))
}
