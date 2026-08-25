import { useEffect, useMemo, useState } from 'react'

type UsePagePaginationOptions<T> = {
  items: readonly T[]
  defaultPageSize?: number
  resetKeys?: readonly unknown[]
}

export function usePagePagination<T>({
  items,
  defaultPageSize = 50,
  resetKeys = [],
}: UsePagePaginationOptions<T>) {
  const [pageSize, setPageSizeState] = useState(defaultPageSize)
  const [page, setPage] = useState(1)
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const firstIndex = (safePage - 1) * pageSize
  const pageItems = useMemo(
    () => items.slice(firstIndex, firstIndex + pageSize),
    [firstIndex, items, pageSize],
  )

  useEffect(() => {
    setPage(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, resetKeys)

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount))
  }, [pageCount])

  return {
    page: safePage,
    pageCount,
    pageSize,
    pageItems,
    totalCount: items.length,
    firstItemNumber: items.length === 0 ? 0 : firstIndex + 1,
    lastItemNumber: Math.min(firstIndex + pageSize, items.length),
    goToPreviousPage: () => setPage((current) => Math.max(1, current - 1)),
    goToNextPage: () => setPage((current) => Math.min(pageCount, current + 1)),
    setPageSize: (nextPageSize: number) => {
      setPageSizeState(nextPageSize)
      setPage(1)
    },
  }
}
