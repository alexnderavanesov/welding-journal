import { useEffect, useRef } from 'react'

import { ALL_PAGE_SIZE, DEFAULT_PAGE_SIZE_OPTIONS } from '@/lib/use-pagination'

type PaginationBarProps = {
  totalCount: number
  firstItemNumber: number
  lastItemNumber: number
  pageSize: number
  hasMore: boolean
  label?: string
  allWarningThreshold?: number
  onLoadMore: () => void
  onPageSizeChange: (pageSize: number) => void
}

export function PaginationBar({
  totalCount,
  firstItemNumber,
  lastItemNumber,
  pageSize,
  hasMore,
  label = 'строк',
  allWarningThreshold = 5000,
  onLoadMore,
  onPageSizeChange,
}: PaginationBarProps) {
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !hasMore) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMore()
      },
      { root: null, rootMargin: '320px 0px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, onLoadMore])

  const handlePageSizeChange = (nextPageSize: number) => {
    if (nextPageSize === ALL_PAGE_SIZE && totalCount > allWarningThreshold) {
      const confirmed = window.confirm(
        `Показать все ${totalCount.toLocaleString('ru-RU')} ${label}? Это может замедлить таблицу на большом проекте.`,
      )
      if (!confirmed) return
    }
    onPageSizeChange(nextPageSize)
  }

  return (
    <div ref={sentinelRef} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/90 px-3 py-2 text-xs text-slate-600">
      <div className="flex items-center gap-2">
        <span className="font-medium text-slate-800">
          {firstItemNumber}-{lastItemNumber}
        </span>
        <span>из {totalCount} {label}</span>
        {hasMore ? <span className="text-slate-400">дальше подгрузится при скролле</span> : <span className="text-emerald-600">показано все</span>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2">
          <span className="text-slate-500">На странице</span>
          <select
            value={pageSize}
            onChange={(event) => handlePageSizeChange(Number(event.target.value))}
            className="h-8 min-w-20 rounded-md border border-slate-200 bg-white pl-3 pr-8 text-xs font-medium text-slate-700 outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
          >
            {DEFAULT_PAGE_SIZE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option === ALL_PAGE_SIZE ? 'все' : option}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  )
}
