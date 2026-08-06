import { ResultFilters } from '@/components/result-filters'
import type { RequestDocumentIdentity } from '@/lib/request-document-identity'

type LnkResultFiltersProps = {
  search: string
  requestSearch: string
  requestKey: string
  filteredRequestOptions: RequestDocumentIdentity[]
  availableRequestOptionsCount: number
  filteredRowsCount: number
  selectedRowsCount: number
  onSearchChange: (value: string) => void
  onRequestSearchChange: (value: string) => void
  onRequestChange: (request: RequestDocumentIdentity | null) => void
  onClearRequestSearch: () => void
  onClearSearch: () => void
}

export function LnkResultFilters({
  search,
  requestSearch,
  requestKey,
  filteredRequestOptions,
  availableRequestOptionsCount,
  filteredRowsCount,
  selectedRowsCount,
  onSearchChange,
  onRequestSearchChange,
  onRequestChange,
  onClearRequestSearch,
  onClearSearch,
}: LnkResultFiltersProps) {
  return (
    <ResultFilters
      search={search}
      requestSearch={requestSearch}
      requestKey={requestKey}
      filteredRequestOptions={filteredRequestOptions}
      availableRequestOptionsCount={availableRequestOptionsCount}
      filteredRowsCount={filteredRowsCount}
      selectedRowsCount={selectedRowsCount}
      searchClassName="h-9 min-w-56 flex-[0.85] bg-white"
      showClearFilters={Boolean(search)}
      onSearchChange={onSearchChange}
      onRequestSearchChange={onRequestSearchChange}
      onRequestChange={onRequestChange}
      onClearRequestSearch={onClearRequestSearch}
      onClearFilters={onClearSearch}
    />
  )
}
