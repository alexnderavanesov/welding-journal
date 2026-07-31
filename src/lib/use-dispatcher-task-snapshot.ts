import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { buildDispatcherTaskGroups } from '@/lib/dispatcher-view'
import { useDispatcherReminderSettings, useDispatcherSettings } from '@/lib/dispatcher-settings'
import { getJointChainConsistencyKey } from '@/lib/repeated-joint-tasks'
import { useSaveCheckSettings } from '@/lib/save-check-settings'
import { DISPATCHER_TASK_SNAPSHOT_QUERY_KEY } from '@/lib/weld-query-utils'
import { getDispatcherTaskSnapshot } from '@/server/dispatcher-task-snapshot'

type UseDispatcherTaskSnapshotInput = {
  dismissedRepeatedJointTaskKeys: Set<string>
  enabled?: boolean
}

export function useDispatcherTaskSnapshot({
  dismissedRepeatedJointTaskKeys,
  enabled = true,
}: UseDispatcherTaskSnapshotInput) {
  const dispatcherSettings = useDispatcherSettings()
  const dispatcherReminderSettings = useDispatcherReminderSettings()
  const saveCheckSettings = useSaveCheckSettings()
  const dismissedKeys = useMemo(
    () => [...dismissedRepeatedJointTaskKeys].sort(),
    [dismissedRepeatedJointTaskKeys],
  )

  const query = useQuery({
    queryKey: [
      ...DISPATCHER_TASK_SNAPSHOT_QUERY_KEY,
      dismissedKeys,
      dispatcherSettings,
      dispatcherReminderSettings,
      saveCheckSettings,
    ],
    enabled,
    queryFn: async () =>
      getDispatcherTaskSnapshot({
        data: {
          dismissedRepeatedJointTaskKeys: dismissedKeys,
          dispatcherSettings,
          dispatcherReminderSettings,
          saveCheckSettings,
        },
      }),
  })
  const dispatcherTaskRowIds = useMemo(() => new Set(query.data?.rowIds ?? []), [query.data?.rowIds])
  const duplicateKeys = useMemo(() => new Set(query.data?.duplicateKeys ?? []), [query.data?.duplicateKeys])
  const repeatedJointTasks = query.data?.repeatedJointTasks ?? []
  const { repeatedJointTaskGroups } = useMemo(
    () =>
      buildDispatcherTaskGroups({
        repeatedJointTasks,
        welderStampExpiryTasks: [],
        getJointChainConsistencyKey,
      }),
    [repeatedJointTasks],
  )

  return {
    ...query,
    duplicateKeys,
    dispatcherTaskRowIds,
    repeatedJointTaskGroups,
    repeatedJointTasks,
  }
}
