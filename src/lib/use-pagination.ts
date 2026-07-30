import { useCallback, useEffect, useMemo, useState } from 'react'

export const ALL_PAGE_SIZE = -1
export const DEFAULT_PAGE_SIZE_OPTIONS = [100, 300, 500, 1000, ALL_PAGE_SIZE] as const

type UsePaginationOptions<T> = {
  items: readonly T[]
  defaultPageSize?: number
  resetKeys?: readonly unknown[]
}

export function usePagination<T>({ items, defaultPageSize = 100, resetKeys = [] }: UsePaginationOptions<T>) {
  const [pageSize, setPageSize] = useState(defaultPageSize)
  const [visibleCount, setVisibleCount] = useState(defaultPageSize)
  const effectivePageSize = pageSize === ALL_PAGE_SIZE ? Math.max(items.length, 1) : pageSize

  useEffect(() => {
    setVisibleCount(effectivePageSize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, resetKeys)

  useEffect(() => {
    setVisibleCount((current) => Math.min(Math.max(current, effectivePageSize), Math.max(items.length, effectivePageSize)))
  }, [effectivePageSize, items.length])

  const safeVisibleCount = Math.min(visibleCount, items.length)
  const pageItems = useMemo(() => items.slice(0, safeVisibleCount), [items, safeVisibleCount])
  const hasMore = safeVisibleCount < items.length
  const loadMore = useCallback(() => {
    setVisibleCount((current) => Math.min(current + effectivePageSize, items.length))
  }, [effectivePageSize, items.length])

  return {
    pageSize,
    pageItems,
    totalCount: items.length,
    firstItemNumber: items.length === 0 ? 0 : 1,
    lastItemNumber: safeVisibleCount,
    hasMore,
    loadMore,
    setPageSize: (nextPageSize: number) => {
      setPageSize(nextPageSize)
      setVisibleCount(nextPageSize === ALL_PAGE_SIZE ? items.length : nextPageSize)
    },
  }
}
