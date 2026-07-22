import { useEffect, useMemo, type Dispatch, type SetStateAction } from 'react'
import { buildDispatcherTaskGroups, getVisibleDispatcherTaskKeys } from '@/lib/dispatcher-view'
import {
  isDispatcherTaskEnabled,
  useDispatcherReminderSettings,
  useDispatcherSettings,
} from '@/lib/dispatcher-settings'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { ActiveReport } from '@/lib/home-state'
import {
  buildRepeatedJointTasks,
  getJointChainConsistencyKey,
} from '@/lib/repeated-joint-tasks'
import { buildWelderStampExpiryTasks } from '@/lib/welder-stamp-expiry-tasks'
import type { WelderStampRecord, WelderStampSuspensionRecord } from '@/lib/welder-stamp-types'

type UseDispatcherTasksInput = {
  acceptedDispatcherWarningKeys: Set<string>
  activeReport: ActiveReport
  dismissedRepeatedJointTaskKeys: Set<string>
  rows: WeldRow[]
  setExpandedRepeatedJointTaskKeys: Dispatch<SetStateAction<Set<string>>>
  welderStamps: WelderStampRecord[]
  welderStampSuspensions: WelderStampSuspensionRecord[]
}

export function useDispatcherTasks({
  acceptedDispatcherWarningKeys,
  activeReport,
  dismissedRepeatedJointTaskKeys,
  rows,
  setExpandedRepeatedJointTaskKeys,
  welderStamps,
  welderStampSuspensions,
}: UseDispatcherTasksInput) {
  const dispatcherSettings = useDispatcherSettings()
  const dispatcherReminderSettings = useDispatcherReminderSettings()
  const hiddenDispatcherTaskKeys = useMemo(
    () => new Set([...dismissedRepeatedJointTaskKeys, ...acceptedDispatcherWarningKeys]),
    [acceptedDispatcherWarningKeys, dismissedRepeatedJointTaskKeys],
  )

  const repeatedJointTasks = useMemo(
    () =>
      buildRepeatedJointTasks(rows, welderStamps, welderStampSuspensions).filter(
        (task) => !hiddenDispatcherTaskKeys.has(task.key) && isDispatcherTaskEnabled(task, dispatcherSettings),
      ),
    [dispatcherSettings, hiddenDispatcherTaskKeys, rows, welderStampSuspensions, welderStamps],
  )
  const welderStampExpiryTasks = useMemo(
    () =>
      buildWelderStampExpiryTasks(welderStamps, dispatcherReminderSettings).filter(
        (task) => !hiddenDispatcherTaskKeys.has(task.key) && isDispatcherTaskEnabled(task, dispatcherSettings),
      ),
    [dispatcherReminderSettings, dispatcherSettings, hiddenDispatcherTaskKeys, welderStamps],
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
