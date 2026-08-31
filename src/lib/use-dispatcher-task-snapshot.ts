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
  const query = useQuery({
    queryKey: DISPATCHER_TASK_SNAPSHOT_QUERY_KEY,
    enabled,
    queryFn: async () => getDispatcherTaskSnapshot({ data: {} }),
    staleTime: 15_000,
  })
  const duplicateKeys = useMemo(() => new Set(query.data?.duplicateKeys ?? []), [query.data?.duplicateKeys])
  const allRepeatedJointTasks = useMemo(
    () => query.data?.repeatedJointTasks ?? [],
    [query.data?.repeatedJointTasks],
  )
  const repeatedJointTasks = useMemo(
    () => filterDismissedDispatcherTasks(allRepeatedJointTasks, dismissedRepeatedJointTaskKeys),
    [allRepeatedJointTasks, dismissedRepeatedJointTaskKeys],
  )
  const welderStampExpiryTasks = useMemo(
    () => filterDismissedDispatcherTasks(query.data?.welderStampExpiryTasks, dismissedRepeatedJointTaskKeys),
    [dismissedRepeatedJointTaskKeys, query.data?.welderStampExpiryTasks],
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

  return {
    ...query,
    allRepeatedJointTasks,
    duplicateKeys,
    repeatedJointTaskGroups,
    repeatedJointTasks,
    taskFilterOptions: query.data?.taskFilterOptions ?? [],
    welderStampExpiryTasks,
    welderStampNotificationGroups,
  }
}

export function filterDismissedDispatcherTasks<Task extends { key: string }>(
  tasks: readonly Task[] | undefined,
  dismissedTaskKeys: ReadonlySet<string>,
) {
  return (tasks ?? []).filter((task) => !dismissedTaskKeys.has(task.key))
}
