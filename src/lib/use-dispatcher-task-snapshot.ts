import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { buildDispatcherTaskGroups } from '@/lib/dispatcher-view'
import { getJointChainConsistencyKey } from '@/lib/repeated-joint-tasks'
import {
  DISPATCHER_TASK_PAGE_QUERY_KEY,
  DISPATCHER_TASK_REFRESH_QUERY_KEY,
  DISPATCHER_TASK_SNAPSHOT_QUERY_KEY,
} from '@/lib/weld-query-utils'
import {
  getDispatcherTaskSnapshot,
  refreshDispatcherTaskSnapshot,
  type DispatcherTaskSnapshotResult,
} from '@/server/dispatcher-task-snapshot'
import { isSystemDispatcherWarningTask } from '@/lib/dispatcher-types'
import { invalidateWeldPageQueries } from '@/lib/weld-page-refresh'
import { getDispatcherTaskBatch } from '@/server/dispatcher-task-pages'
import { getBusinessDateIso } from '@/lib/business-date'

type UseDispatcherTaskSnapshotInput = {
  dismissedRepeatedJointTaskKeys: Set<string>
  enabled?: boolean
}

const EMPTY_DISPATCHER_TASKS: DispatcherTaskSnapshotResult['repeatedJointTasks'] = []

export function useDispatcherTaskSnapshot({
  dismissedRepeatedJointTaskKeys,
  enabled = true,
}: UseDispatcherTaskSnapshotInput) {
  const queryClient = useQueryClient()
  const [additionalTasks, setAdditionalTasks] = useState<{
    revision: number
    tasks: DispatcherTaskSnapshotResult['repeatedJointTasks']
  }>({ revision: -1, tasks: [] })
  const [isTaskBatchLoading, setIsTaskBatchLoading] = useState(false)
  const [taskBatchError, setTaskBatchError] = useState<Error | null>(null)
  const batchInFlight = useRef(false)
  const query = useQuery({
    queryKey: DISPATCHER_TASK_SNAPSHOT_QUERY_KEY,
    enabled,
    queryFn: async () => getDispatcherTaskSnapshot({ data: {} }),
    staleTime: 15_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const refreshQuery = useQuery({
    queryKey: getRefreshQueryKey(query.data),
    enabled: enabled && Boolean(query.data && !query.data.isFresh),
    queryFn: async () => refreshDispatcherTaskSnapshot({ data: {} }),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  useEffect(() => {
    const refreshed = refreshQuery.data
    if (!refreshed) return
    queryClient.setQueryData<DispatcherTaskSnapshotResult>(
      DISPATCHER_TASK_SNAPSHOT_QUERY_KEY,
      (current) => !current || refreshed.sourceRevision >= current.sourceRevision ? refreshed : current,
    )
    if (!refreshed.isFresh) return
    void invalidateWeldPageQueries(queryClient)
  }, [queryClient, refreshQuery.data])
  const computedRevision = query.data?.computedRevision ?? -1
  const latestRevision = useRef(computedRevision)
  latestRevision.current = computedRevision
  useEffect(() => { setTaskBatchError(null) }, [computedRevision])
  const duplicateKeys = useMemo(() => new Set(query.data?.duplicateKeys ?? []), [query.data?.duplicateKeys])
  const allRepeatedJointTasks = useMemo(
    () => [
      ...(query.data?.repeatedJointTasks ?? EMPTY_DISPATCHER_TASKS),
      ...(additionalTasks.revision === computedRevision ? additionalTasks.tasks : EMPTY_DISPATCHER_TASKS),
    ],
    [additionalTasks, computedRevision, query.data?.repeatedJointTasks],
  )
  const repeatedJointTasks = useMemo(
    () => filterDismissedDispatcherTasks(allRepeatedJointTasks, dismissedRepeatedJointTaskKeys),
    [allRepeatedJointTasks, dismissedRepeatedJointTaskKeys],
  )
  const adviceRepeatedJointTasks = useMemo(
    () => [...new Map(allRepeatedJointTasks.map((task) => [task.key, task])).values()],
    [allRepeatedJointTasks],
  )
  const hasMoreTasks = allRepeatedJointTasks.length < (query.data?.repeatedJointTaskCount ?? 0)
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
  const loadMoreTasks = async () => {
    if (batchInFlight.current || !enabled || !query.data?.isFresh || !hasMoreTasks) return
    const revision = query.data.computedRevision
    const offset = allRepeatedJointTasks.length
    batchInFlight.current = true
    setIsTaskBatchLoading(true)
    setTaskBatchError(null)
    try {
      const tasks = await queryClient.fetchQuery({
        queryKey: [...DISPATCHER_TASK_PAGE_QUERY_KEY, revision, 'batch', offset],
        queryFn: () => getDispatcherTaskBatch({ data: { offset, limit: 200, computedRevision: revision } }),
        staleTime: Number.POSITIVE_INFINITY,
        retry: false,
      })
      if (latestRevision.current !== revision) return
      if (tasks.length === 0) throw new Error('Не удалось загрузить следующую порцию задач диспетчера.')
      setAdditionalTasks((current) => ({
        revision,
        tasks: [...(current.revision === revision ? current.tasks : []), ...tasks],
      }))
    } catch (error) {
      if (latestRevision.current === revision) {
        setTaskBatchError(error instanceof Error ? error : new Error('Не удалось загрузить задачи диспетчера.'))
      }
    } finally {
      batchInFlight.current = false
      setIsTaskBatchLoading(false)
    }
  }
  const retryTaskBatch = async () => {
    // Refresh the revision first; retrying an old batch after another user's
    // mutation would leave a mixed-version list on screen.
    try {
      const revision = await refreshTasks()
      if (revision === undefined) return
      setTaskBatchError(null)
      if (revision === computedRevision) await loadMoreTasks()
    } catch {
      // The query error is exposed below; an explicit retry remains available.
    }
  }

  const refreshTasks = async () => {
    const latest = await query.refetch({ throwOnError: true })
    if (!latest.data) return undefined
    if (latest.data.isFresh) return latest.data.computedRevision
    // A failed refresh for the same revision does not restart on a plain GET.
    // Explicit retry must retry that refresh too, coalescing with any in-flight one.
    const refreshed = await queryClient.fetchQuery({
      queryKey: getRefreshQueryKey(latest.data),
      queryFn: () => refreshDispatcherTaskSnapshot({ data: {} }),
      staleTime: 0,
      retry: false,
    })
    queryClient.setQueryData<DispatcherTaskSnapshotResult>(
      DISPATCHER_TASK_SNAPSHOT_QUERY_KEY,
      (current) => !current || refreshed.sourceRevision >= current.sourceRevision ? refreshed : current,
    )
    return refreshed.isFresh ? refreshed.computedRevision : undefined
  }
  const snapshotError = query.error ?? (!query.data?.isFresh ? refreshQuery.error : null)

  return {
    ...query,
    error: snapshotError,
    refreshTasks,
    allRepeatedJointTasks,
    adviceRepeatedJointTasks,
    hasMoreTasks,
    loadMoreTasks,
    isTaskBatchLoading,
    taskBatchError: snapshotError ?? taskBatchError,
    retryTaskBatch,
    duplicateKeys,
    repeatedJointTaskGroups,
    repeatedJointTasks,
    taskFilterOptions: query.data?.taskFilterOptions ?? [],
    repeatedJointTaskCount: query.data?.repeatedJointTaskCount ?? allRepeatedJointTasks.length,
    repeatedJointTasksTruncated: query.data?.repeatedJointTasksTruncated ?? false,
    isRefreshing: refreshQuery.isFetching,
    welderStampExpiryTasks,
    welderStampNotificationGroups,
  }
}

function getRefreshQueryKey(snapshot: DispatcherTaskSnapshotResult | undefined) {
  return [
    ...DISPATCHER_TASK_REFRESH_QUERY_KEY,
    snapshot?.sourceRevision ?? -1,
    snapshot?.computedAt ?? '',
    getBusinessDateIso(),
  ]
}

export function filterDismissedDispatcherTasks<Task extends { key: string; kind?: string; systemWarningCode?: string }>(
  tasks: readonly Task[] | undefined,
  dismissedTaskKeys: ReadonlySet<string>,
) {
  return (tasks ?? []).filter((task) =>
    isSystemDispatcherWarningTask(task) || !dismissedTaskKeys.has(task.key),
  )
}
