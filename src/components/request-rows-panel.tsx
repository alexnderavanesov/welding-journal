import type { ReactNode } from 'react'

import { RequestRowsSearch } from '@/components/request-rows-search'

type RequestRowsPanelProps = {
  title: string
  description: string
  action: ReactNode
  searchValue: string
  searchPlaceholder: string
  filteredCount: number
  availableCount: number
  isEmpty: boolean
  emptyMessage: ReactNode
  children: ReactNode
  onSearchChange: (value: string) => void
}

export function RequestRowsPanel({
  title,
  description,
  action,
  searchValue,
  searchPlaceholder,
  filteredCount,
  availableCount,
  isEmpty,
  emptyMessage,
  children,
  onSearchChange,
}: RequestRowsPanelProps) {
  return (
    <section className="flex min-h-0 flex-col space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
          <p className="text-xs leading-5 text-slate-500">{description}</p>
        </div>
        {action}
      </div>

      <RequestRowsSearch
        value={searchValue}
        placeholder={searchPlaceholder}
        filteredCount={filteredCount}
        availableCount={availableCount}
        onChange={onSearchChange}
      />

      <div className="min-h-0 overflow-auto rounded-md border border-slate-200">
        {isEmpty ? <div className="px-4 py-6 text-sm text-slate-500">{emptyMessage}</div> : children}
      </div>
    </section>
  )
}
