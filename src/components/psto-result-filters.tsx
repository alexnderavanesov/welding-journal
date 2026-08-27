import type { ReactNode } from 'react'

import { ResultFilters } from '@/components/result-filters'
import type { RequestDocumentIdentity } from '@/lib/request-document-identity'

type PstoResultFiltersProps = {
  search: string
  requestSearch: string
  requestKey: string
  filteredRequestOptions: RequestDocumentIdentity[]
  availableRequestOptionsCount: number
  filteredRowsCount: number
  selectedRowsCount: number
  leading?: ReactNode
  action?: ReactNode
  onSearchChange: (value: string) => void
  onRequestSearchChange: (value: string) => void
  onRequestChange: (request: RequestDocumentIdentity | null) => void
  onClearFilters: () => void
}

export function PstoResultFilters({
  search,
  requestSearch,
  requestKey,
  filteredRequestOptions,
  availableRequestOptionsCount,
  filteredRowsCount,
  selectedRowsCount,
  leading,
  action,
  onSearchChange,
  onRequestSearchChange,
  onRequestChange,
  onClearFilters,
}: PstoResultFiltersProps) {
  return (
    <ResultFilters
      search={search}
      requestSearch={requestSearch}
      requestKey={requestKey}
      filteredRequestOptions={filteredRequestOptions}
      availableRequestOptionsCount={availableRequestOptionsCount}
      filteredRowsCount={filteredRowsCount}
      selectedRowsCount={selectedRowsCount}
      leading={leading}
      action={action}
      searchClassName="h-9 min-w-0 flex-[1.1] bg-white"
      compactToolbar
      showClearFilters={Boolean(search || requestSearch)}
      onSearchChange={onSearchChange}
      onRequestSearchChange={onRequestSearchChange}
      onRequestChange={onRequestChange}
      onClearRequestSearch={() => onRequestSearchChange('')}
      onClearFilters={onClearFilters}
    />
  )
}
