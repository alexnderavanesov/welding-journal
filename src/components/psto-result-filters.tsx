import { ResultFilters } from '@/components/result-filters'

type PstoResultFiltersProps = {
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
  onClearFilters: () => void
}

export function PstoResultFilters({
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
  onClearFilters,
}: PstoResultFiltersProps) {
  return (
    <ResultFilters
      search={search}
      requestSearch={requestSearch}
      requestName={requestName}
      filteredRequestOptions={filteredRequestOptions}
      availableRequestOptionsCount={availableRequestOptionsCount}
      filteredRowsCount={filteredRowsCount}
      selectedRowsCount={selectedRowsCount}
      showClearFilters={Boolean(search || requestSearch)}
      onSearchChange={onSearchChange}
      onRequestSearchChange={onRequestSearchChange}
      onRequestChange={onRequestChange}
      onClearRequestSearch={() => onRequestSearchChange('')}
      onClearFilters={onClearFilters}
    />
  )
}
