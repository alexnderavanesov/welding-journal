import { ResultFilters } from '@/components/result-filters'

type LnkResultFiltersProps = {
  search: string
  requestSearch: string
  requestName: string
  filteredRequestOptions: string[]
  availableRequestOptionsCount: number
  filteredRowsCount: number
  selectedRowsCount: number
  onSearchChange: (value: string) => void
  onRequestSearchChange: (value: string) => void
  onRequestChange: (requestName: string) => void
  onClearRequestSearch: () => void
  onClearSearch: () => void
}

export function LnkResultFilters({
  search,
  requestSearch,
  requestName,
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
      requestName={requestName}
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
