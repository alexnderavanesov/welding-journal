import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { buildDispatcherTaskGroups } from '@/lib/dispatcher-view'
import { getJointChainConsistencyKey } from '@/lib/repeated-joint-tasks'
import {
  DISPATCHER_TASK_PAGE_QUERY_KEY,
  DISPATCHER_TASK_REFRESH_QUERY_KEY,
  DISPATCHER_TASK_SNAPSHOT_QUERY_KEY,
} from '@/lib/weld-query-utils'
import {
  getDispatcherTaskSnapshot,
  getDispatcherTaskVersion,
  refreshDispatcherTaskSnapshot,
  type DispatcherTaskSnapshotResult,
} from '@/server/dispatcher-task-snapshot'
import { isSystemDispatcherWarningTask, type DispatcherTask } from '@/lib/dispatcher-types'
import { isMandatoryDispatcherTask } from '@/lib/dispatcher-settings'
import { invalidateWeldPageQueries } from '@/lib/weld-page-refresh'
import { getDispatcherTaskBatch } from '@/server/dispatcher-task-pages'
import { getBusinessDateIso } from '@/lib/business-date'
import { DISPATCHER_TASK_CALCULATION_VERSION } from '@/lib/dispatcher-task-index-payload'
import { useDispatcherActivityCheck } from '@/lib/use-dispatcher-activity-check'
import { decodeDispatcherSnapshot, dispatcherSnapshotRequest } from '@/lib/dispatcher-snapshot-transport'

type UseDispatcherTaskSnapshotInput = {
  dismissedRepeatedJointTaskKeys: Set<string>
  enabled?: boolean
  workspaceOpen?: boolean
  activityEnabled?: boolean
}

const EMPTY_DISPATCHER_TASKS: DispatcherTaskSnapshotResult['repeatedJointTasks'] = []
const CONCURRENT_REFRESH_ERROR = new Error('Данные продолжают изменяться. Показан предыдущий расчёт; повторите загрузку диспетчера после завершения изменений.')
const pendingRefreshes = new WeakMap<QueryClient, Promise<DispatcherTaskSnapshotResult>>()

// Revisions still have separate cache keys, but must not create simultaneous
// long-running HTTP requests that occupy every browser connection after saves.
function requestSharedRefresh(client: QueryClient) {
  const existing = pendingRefreshes.get(client)
  if (existing) return existing
  const pending = refreshDispatcherTaskSnapshot({ data: dispatcherSnapshotRequest() }).then(decodeDispatcherSnapshot).finally(() => {
    if (pendingRefreshes.get(client) === pending) pendingRefreshes.delete(client)
  })
  pendingRefreshes.set(client, pending)
  return pending
}

async function refreshAfterKnownRevision(client: QueryClient, revision = -1) {
  const result = await requestSharedRefresh(client)
  // A caller joined a refresh just before another save completed. At most one
  // sequential catch-up; older results still cannot replace a newer snapshot.
  return result.sourceRevision < revision ? requestSharedRefresh(client) : result
}

export function useDispatcherTaskSnapshot({
  dismissedRepeatedJointTaskKeys,
  enabled = true,
  workspaceOpen = false,
  activityEnabled = enabled,
}: UseDispatcherTaskSnapshotInput) {
  const queryClient = useQueryClient()
  const [additionalTasks, setAdditionalTasks] = useState<{
    revision: number
    tasks: DispatcherTaskSnapshotResult['repeatedJointTasks']
  }>({ revision: -1, tasks: [] })
  const [isTaskBatchLoading, setIsTaskBatchLoading] = useState(false)
  const [taskBatchError, setTaskBatchError] = useState<Error | null>(null)
  const batchInFlight = useRef(false)
  const activityEnabledRef = useRef(enabled && activityEnabled)
  activityEnabledRef.current = enabled && activityEnabled
  useEffect(() => {
    activityEnabledRef.current = enabled && activityEnabled
    return () => { activityEnabledRef.current = false }
  }, [enabled, activityEnabled])
  const [activityError, setActivityError] = useState<Error | null>(null)
  const [automaticRefreshPaused, setAutomaticRefreshPaused] = useState(false)
  const unpublishedRefreshes = useRef(0)
  const knownCalculationVersion = useRef(DISPATCHER_TASK_CALCULATION_VERSION)
  const query = useQuery({
    queryKey: DISPATCHER_TASK_SNAPSHOT_QUERY_KEY,
    enabled,
    queryFn: async () => {
      const snapshot = await decodeDispatcherSnapshot(await getDispatcherTaskSnapshot({ data: dispatcherSnapshotRequest() }))
      // A real GET (opening, own-save invalidation or explicit retry) starts a
      // new refresh opportunity. Publishing a POST result below does not.
      unpublishedRefreshes.current = 0
      setAutomaticRefreshPaused(false)
      const current = queryClient.getQueryData<DispatcherTaskSnapshotResult>(DISPATCHER_TASK_SNAPSHOT_QUERY_KEY)
      // An own-save POST may publish while this GET is in flight. A GET may
      // invalidate freshness at midnight, but must never roll back its data.
      return current && compareDispatcherCalculation(snapshot, current) < 0 ? current : snapshot
    },
    staleTime: 15_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const refreshQuery = useQuery({
    queryKey: getRefreshQueryKey(query.data),
    enabled: enabled && !automaticRefreshPaused && Boolean(query.data && !query.data.isFresh),
    queryFn: () => refreshAfterKnownRevision(queryClient, query.data?.sourceRevision),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  useEffect(() => {
    const refreshed = refreshQuery.data
    if (!refreshed) return
    const currentSnapshot = queryClient.getQueryData<DispatcherTaskSnapshotResult>(DISPATCHER_TASK_SNAPSHOT_QUERY_KEY)
    if (!canPublishDispatcherSnapshot(refreshed, currentSnapshot)) return
    if (!refreshed.isFresh) {
      unpublishedRefreshes.current++
      // Keep the existing one retry for a newer revision, but never loop while
      // writers keep invalidating calculations. Same-key stale results cannot
      // retry automatically either, so expose an explicit retry in that case.
      setAutomaticRefreshPaused(unpublishedRefreshes.current >= 2 ||
        (refreshed.sourceRevision === currentSnapshot?.sourceRevision && refreshed.computedAt === currentSnapshot.computedAt))
    } else {
      unpublishedRefreshes.current = 0
      setAutomaticRefreshPaused(false)
    }
    queryClient.setQueryData<DispatcherTaskSnapshotResult>(
      DISPATCHER_TASK_SNAPSHOT_QUERY_KEY,
      (current) => canPublishDispatcherSnapshot(refreshed, current) ? refreshed : current,
    )
    if (!refreshed.isFresh) return
    void invalidateWeldPageQueries(queryClient)
  }, [queryClient, refreshQuery.data])
  const computedRevision = query.data?.computedRevision ?? -1
  const latestRevision = useRef(computedRevision)
  latestRevision.current = computedRevision
  useEffect(() => { setTaskBatchError(null); setActivityError(null) }, [computedRevision])
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
    setActivityError(null)
    const latest = await query.refetch({ throwOnError: true, cancelRefetch: false })
    if (!latest.data) return undefined
    if (latest.data.isFresh) return latest.data.computedRevision
    // A failed refresh for the same revision does not restart on a plain GET.
    // Explicit retry must retry that refresh too, coalescing with any in-flight one.
    const refreshed = await queryClient.fetchQuery({
      queryKey: getRefreshQueryKey(latest.data),
      queryFn: () => refreshAfterKnownRevision(queryClient, latest.data?.sourceRevision),
      staleTime: 0,
      retry: false,
    })
    queryClient.setQueryData<DispatcherTaskSnapshotResult>(
      DISPATCHER_TASK_SNAPSHOT_QUERY_KEY,
      (current) => canPublishDispatcherSnapshot(refreshed, current) ? refreshed : current,
    )
    return refreshed.isFresh ? refreshed.computedRevision : undefined
  }
  useDispatcherActivityCheck({ enabled: enabled && activityEnabled, workspaceOpen, check: async () => {
    if (queryClient.isFetching({ queryKey: DISPATCHER_TASK_SNAPSHOT_QUERY_KEY }) || queryClient.isFetching({ queryKey: DISPATCHER_TASK_REFRESH_QUERY_KEY })) return
    try {
      const version = await queryClient.fetchQuery({ queryKey: ['dispatcher-task-version'], queryFn: () => getDispatcherTaskVersion(), staleTime: 0, retry: false })
      if (!activityEnabledRef.current || document.visibilityState === 'hidden') return
      const current = queryClient.getQueryData<DispatcherTaskSnapshotResult>(DISPATCHER_TASK_SNAPSHOT_QUERY_KEY)
      // An own-save refresh may have finished while the probe was in flight.
      if (current && version.sourceRevision < current.sourceRevision && version.sourceRevision >= 0) return
      const changed = !current || !current.isFresh || version.sourceRevision !== current.sourceRevision ||
        version.computedRevision !== current.computedRevision || version.computedAt !== current.computedAt ||
        version.businessDate !== version.computedForBusinessDate || version.calculationVersion !== knownCalculationVersion.current
      setActivityError(null)
      if (!changed) return
      const revision = await refreshTasks()
      if (revision !== undefined) {
        knownCalculationVersion.current = version.calculationVersion
        // Also refresh active report pages when another client already published
        // the new snapshot (no POST refresh effect runs in that case).
        if (version.sourceRevision === version.computedRevision && version.sourceRevision !== current?.computedRevision) void invalidateWeldPageQueries(queryClient)
      }
    } catch (cause) {
      if (activityEnabledRef.current) setActivityError(cause instanceof Error ? cause : new Error('Не удалось проверить актуальность диспетчера.'))
    }
  } })
  const snapshotError = query.error ?? (!query.data?.isFresh ? refreshQuery.error : null) ?? activityError ??
    (automaticRefreshPaused && !query.data?.isFresh ? CONCURRENT_REFRESH_ERROR : null)

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

function canPublishDispatcherSnapshot(next: DispatcherTaskSnapshotResult, current: DispatcherTaskSnapshotResult | undefined) {
  if (!current) return true
  const order = compareDispatcherCalculation(next, current)
  if (order !== 0) return order > 0
  return next.isFresh || !current.isFresh
}

function compareDispatcherCalculation(next: DispatcherTaskSnapshotResult, current: DispatcherTaskSnapshotResult) {
  return next.sourceRevision - current.sourceRevision || next.computedRevision - current.computedRevision ||
    (Date.parse(next.computedAt) || 0) - (Date.parse(current.computedAt) || 0)
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
    isSystemDispatcherWarningTask(task) ||
    (task.kind != null && isMandatoryDispatcherTask(task as unknown as DispatcherTask)) ||
    !dismissedTaskKeys.has(task.key),
  )
}
