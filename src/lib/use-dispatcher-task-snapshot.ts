import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { buildDispatcherTaskGroups } from '@/lib/dispatcher-view'
import { getJointChainConsistencyKey } from '@/lib/repeated-joint-tasks'
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
  const dismissedKeys = useMemo(
    () => [...dismissedRepeatedJointTaskKeys].sort(),
    [dismissedRepeatedJointTaskKeys],
  )

  const query = useQuery({
    queryKey: [...DISPATCHER_TASK_SNAPSHOT_QUERY_KEY, dismissedKeys],
    enabled,
    queryFn: async () =>
      getDispatcherTaskSnapshot({
        data: {
          dismissedRepeatedJointTaskKeys: dismissedKeys,
        },
      }),
    staleTime: 15_000,
  })
  const duplicateKeys = useMemo(() => new Set(query.data?.duplicateKeys ?? []), [query.data?.duplicateKeys])
  const repeatedJointTasks = query.data?.repeatedJointTasks ?? []
  const welderStampExpiryTasks = query.data?.welderStampExpiryTasks ?? []
  const { repeatedJointTaskGroups, welderStampNotificationGroups } = useMemo(
    () =>
      buildDispatcherTaskGroups({
        repeatedJointTasks,
        welderStampExpiryTasks,
        getJointChainConsistencyKey,
      }),
    [repeatedJointTasks, welderStampExpiryTasks],
  )

  return {
    ...query,
    duplicateKeys,
    repeatedJointTaskGroups,
    repeatedJointTasks,
    taskFilterOptions: query.data?.taskFilterOptions ?? [],
    welderStampExpiryTasks,
    welderStampNotificationGroups,
  }
}
