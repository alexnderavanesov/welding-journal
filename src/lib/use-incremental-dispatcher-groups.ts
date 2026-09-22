import { useCallback, useEffect, useState } from 'react'

export const DISPATCHER_GROUP_BATCH_SIZE = 80
export const DISPATCHER_TASK_BATCH_SIZE = 40

export function getNextDispatcherGroupCount(
  current: number,
  total: number,
  batchSize = DISPATCHER_GROUP_BATCH_SIZE,
) {
  return Math.min(total, current + Math.max(1, batchSize))
}

export function useIncrementalDispatcherGroups<T>(
  groups: T[],
  batchSize = DISPATCHER_GROUP_BATCH_SIZE,
) {
  const initialVisibleCount = Math.min(groups.length, Math.max(1, batchSize))
  const [visibleCount, setVisibleCount] = useState(initialVisibleCount)

  useEffect(() => {
    setVisibleCount(initialVisibleCount)
  }, [groups, initialVisibleCount])

  const loadMore = useCallback(() => {
    setVisibleCount((current) => getNextDispatcherGroupCount(current, groups.length, batchSize))
  }, [batchSize, groups.length])

  const collapseList = useCallback(() => {
    setVisibleCount(initialVisibleCount)
  }, [initialVisibleCount])

  const hasMore = visibleCount < groups.length
  const canCollapse = visibleCount > initialVisibleCount

  return {
    visibleGroups: groups.slice(0, visibleCount),
    visibleCount,
    hasMore,
    canCollapse,
    loadMore,
    collapseList,
  }
}
