import type { ReactNode } from 'react'

import { ResultFilters } from '@/components/result-filters'
import type { RequestDocumentIdentity } from '@/lib/request-document-identity'

type PstoResultFiltersProps = {
  search: string
  requestKey: string
  requestOptions: RequestDocumentIdentity[]
  filteredRowsCount: number
  selectedRowsCount: number
  leading?: ReactNode
  action?: ReactNode
  onSearchChange: (value: string) => void
  onRequestChange: (request: RequestDocumentIdentity | null) => void
  onClearFilters: () => void
}

export function PstoResultFilters({
  search,
  requestKey,
  requestOptions,
  filteredRowsCount,
  selectedRowsCount,
  leading,
  action,
  onSearchChange,
  onRequestChange,
  onClearFilters,
}: PstoResultFiltersProps) {
  return (
    <ResultFilters
      search={search}
      requestKey={requestKey}
      requestOptions={requestOptions}
      filteredRowsCount={filteredRowsCount}
      selectedRowsCount={selectedRowsCount}
      leading={leading}
      action={action}
      searchClassName="h-9 min-w-0 flex-[1.1] bg-white"
      compactToolbar
      showClearFilters={Boolean(search)}
      onSearchChange={onSearchChange}
      onRequestChange={onRequestChange}
      onClearFilters={onClearFilters}
    />
  )
}
