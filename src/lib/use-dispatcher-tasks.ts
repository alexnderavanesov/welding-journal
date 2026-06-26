import { useEffect, useMemo, type Dispatch, type SetStateAction } from 'react'
import { buildDispatcherTaskGroups, getVisibleDispatcherTaskKeys } from '@/lib/dispatcher-view'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { ActiveReport } from '@/lib/home-state'
import {
  buildRepeatedJointTasks,
  getJointChainConsistencyKey,
} from '@/lib/repeated-joint-tasks'
import {
  buildWelderStampExpiryTasks,
} from '@/lib/welder-stamp-registry'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'

type UseDispatcherTasksInput = {
  activeReport: ActiveReport
  dismissedRepeatedJointTaskKeys: Set<string>
  rows: WeldRow[]
  setExpandedRepeatedJointTaskKeys: Dispatch<SetStateAction<Set<string>>>
  welderStamps: WelderStampRecord[]
}

export function useDispatcherTasks({
  activeReport,
  dismissedRepeatedJointTaskKeys,
  rows,
  setExpandedRepeatedJointTaskKeys,
  welderStamps,
}: UseDispatcherTasksInput) {
  const repeatedJointTasks = useMemo(
    () => buildRepeatedJointTasks(rows, welderStamps).filter((task) => !dismissedRepeatedJointTaskKeys.has(task.key)),
    [dismissedRepeatedJointTaskKeys, rows, welderStamps],
  )
  const welderStampExpiryTasks = useMemo(
    () => buildWelderStampExpiryTasks(welderStamps).filter((task) => !dismissedRepeatedJointTaskKeys.has(task.key)),
    [dismissedRepeatedJointTaskKeys, welderStamps],
  )
  const { repeatedJointTaskGroups, welderStampNotificationGroups } = useMemo(
    () =>
      buildDispatcherTaskGroups({
        repeatedJointTasks,
        welderStampExpiryTasks,
        getJointChainConsistencyKey,
      }),
    [repeatedJointTasks, welderStampExpiryTasks],
  )

  useEffect(() => {
    const visibleKeys = getVisibleDispatcherTaskKeys(activeReport, repeatedJointTasks, welderStampExpiryTasks)
    setExpandedRepeatedJointTaskKeys((current) => {
      const next = new Set([...current].filter((key) => visibleKeys.has(key)))
      return next.size === current.size ? current : next
    })
  }, [activeReport, repeatedJointTasks, setExpandedRepeatedJointTaskKeys, welderStampExpiryTasks])

  return {
    repeatedJointTaskGroups,
    repeatedJointTasks,
    welderStampExpiryTasks,
    welderStampNotificationGroups,
  }
}
