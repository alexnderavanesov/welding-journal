import { useEffect, useMemo, type Dispatch, type SetStateAction } from 'react'
import { buildDispatcherTaskGroups, getVisibleDispatcherTaskKeys } from '@/lib/dispatcher-view'
import {
  useDispatcherReminderSettings,
  useDispatcherSettings,
} from '@/lib/dispatcher-settings'
import {
  buildVisibleDispatcherTasks,
  getDispatcherTaskRowIds,
} from '@/lib/dispatcher-task-builder'
import { getJointChainConsistencyKey } from '@/lib/repeated-joint-tasks'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { ActiveReport } from '@/lib/home-state'
import type { WelderStampRecord, WelderStampSuspensionRecord } from '@/lib/welder-stamp-types'

export { buildVisibleDispatcherTasks, getDispatcherTaskRowIds } from '@/lib/dispatcher-task-builder'

type UseDispatcherTasksInput = {
  acceptedDispatcherWarningKeys: Set<string>
  activeReport: ActiveReport
  dismissedRepeatedJointTaskKeys: Set<string>
  includeRepeatedJointTasks?: boolean
  includeWelderStampExpiryTasks?: boolean
  rows: WeldRow[]
  setExpandedRepeatedJointTaskKeys: Dispatch<SetStateAction<Set<string>>>
  welderStamps: WelderStampRecord[]
  welderStampSuspensions: WelderStampSuspensionRecord[]
}

export function useDispatcherTasks({
  acceptedDispatcherWarningKeys,
  activeReport,
  dismissedRepeatedJointTaskKeys,
  includeRepeatedJointTasks,
  includeWelderStampExpiryTasks,
  rows,
  setExpandedRepeatedJointTaskKeys,
  welderStamps,
  welderStampSuspensions,
}: UseDispatcherTasksInput) {
  const dispatcherSettings = useDispatcherSettings()
  const dispatcherReminderSettings = useDispatcherReminderSettings()

  const visibleDispatcherTasks = useMemo(
    () =>
      buildVisibleDispatcherTasks({
        acceptedDispatcherWarningKeys,
        dismissedRepeatedJointTaskKeys,
        dispatcherReminderSettings,
        dispatcherSettings,
        includeRepeatedJointTasks,
        includeWelderStampExpiryTasks,
        rows,
        welderStamps,
        welderStampSuspensions,
      }),
    [
      acceptedDispatcherWarningKeys,
      dismissedRepeatedJointTaskKeys,
      dispatcherReminderSettings,
      dispatcherSettings,
      includeRepeatedJointTasks,
      includeWelderStampExpiryTasks,
      rows,
      welderStampSuspensions,
      welderStamps,
    ],
  )
  const { repeatedJointTasks, welderStampExpiryTasks } = visibleDispatcherTasks
  const dispatcherTaskRowIds = useMemo(() => getDispatcherTaskRowIds(repeatedJointTasks), [repeatedJointTasks])
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
    dispatcherTaskRowIds,
    welderStampExpiryTasks,
    welderStampNotificationGroups,
  }
}
