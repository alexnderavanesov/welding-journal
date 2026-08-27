import type { ReactNode } from 'react'

import { RequestRowsSearch } from '@/components/request-rows-search'

type RequestRowsPanelProps = {
  title: string
  description: string
  viewToggle?: ReactNode
  action: ReactNode
  searchValue: string
  searchPlaceholder: string
  filteredCount: number
  availableCount: number
  statsLabel?: ReactNode
  isEmpty: boolean
  emptyMessage: ReactNode
  children: ReactNode
  onSearchChange: (value: string) => void
}

export function RequestRowsPanel({
  title,
  description,
  viewToggle,
  action,
  searchValue,
  searchPlaceholder,
  filteredCount,
  availableCount,
  statsLabel,
  isEmpty,
  emptyMessage,
  children,
  onSearchChange,
}: RequestRowsPanelProps) {
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-2">
      <RequestRowsSearch
        value={searchValue}
        label={title}
        description={description}
        viewToggle={viewToggle}
        placeholder={searchPlaceholder}
        filteredCount={filteredCount}
        availableCount={availableCount}
        statsLabel={statsLabel}
        action={action}
        onChange={onSearchChange}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-slate-200">
        {isEmpty ? <div className="px-4 py-6 text-sm text-slate-500">{emptyMessage}</div> : children}
      </div>
    </section>
  )
}
