import { useCallback, useEffect, useRef, useState } from 'react'
import type { RepeatedJointTaskGroup } from '@/lib/dispatcher-types'

export const DISPATCHER_GROUP_BATCH_SIZE = 80

export function getNextDispatcherGroupCount(current: number, total: number) {
  return Math.min(total, current + DISPATCHER_GROUP_BATCH_SIZE)
}

export function useIncrementalDispatcherGroups(groups: RepeatedJointTaskGroup[]) {
  const [visibleCount, setVisibleCount] = useState(() => Math.min(groups.length, DISPATCHER_GROUP_BATCH_SIZE))
  const loadMoreRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setVisibleCount(Math.min(groups.length, DISPATCHER_GROUP_BATCH_SIZE))
  }, [groups])

  const loadMore = useCallback(() => {
    setVisibleCount((current) => getNextDispatcherGroupCount(current, groups.length))
  }, [groups.length])

  const hasMore = visibleCount < groups.length

  useEffect(() => {
    const target = loadMoreRef.current
    if (!target || !hasMore || typeof IntersectionObserver === 'undefined') return undefined

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore()
      },
      { rootMargin: '240px' },
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [hasMore, loadMore])

  return {
    visibleGroups: groups.slice(0, visibleCount),
    visibleCount,
    hasMore,
    loadMore,
    loadMoreRef,
  }
}
