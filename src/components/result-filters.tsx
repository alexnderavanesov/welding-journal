import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'

export type ResultFiltersProps = {
  search: string
  requestSearch: string
  requestName: string
  filteredRequestOptions: string[]
  availableRequestOptionsCount: number
  filteredRowsCount: number
  selectedRowsCount: number
  searchClassName?: string
  showClearFilters: boolean
  onSearchChange: (value: string) => void
  onRequestSearchChange: (value: string) => void
  onRequestChange: (requestName: string) => void
  onClearRequestSearch: () => void
  onClearFilters: () => void
}

export function ResultFilters({
  search,
  requestSearch,
  requestName,
  filteredRequestOptions,
  availableRequestOptionsCount,
  filteredRowsCount,
  selectedRowsCount,
  searchClassName = 'h-9 min-w-56 flex-[0.8] bg-white',
  showClearFilters,
  onSearchChange,
  onRequestSearchChange,
  onRequestChange,
  onClearRequestSearch,
  onClearFilters,
}: ResultFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
      <Input
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder="Проект, шифр, линия, спул или стык"
        className={searchClassName}
      />
      <Input
        value={requestSearch}
        onChange={(event) => onRequestSearchChange(event.target.value)}
        placeholder="Поиск заявки"
        className="h-9 min-w-44 flex-[0.45] bg-white"
      />
      <Select value={requestName} onChange={(event) => onRequestChange(event.target.value)} className="h-9 min-w-48 flex-[0.5] bg-white">
        <option value="">Все заявки</option>
        {filteredRequestOptions.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </Select>
      {requestSearch ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onClearRequestSearch}
          className="h-9 px-2"
          aria-label="Очистить поиск заявки"
        >
          <X className="h-4 w-4" />
        </Button>
      ) : null}
      <span className="whitespace-nowrap px-2 text-xs text-slate-500">
        Заявок: {filteredRequestOptions.length}/{availableRequestOptionsCount}
      </span>
      <span className="whitespace-nowrap px-2 text-xs text-slate-500">
        Найдено: {filteredRowsCount} · Выбрано: {selectedRowsCount}
      </span>
      {showClearFilters ? (
        <Button variant="outline" size="sm" onClick={onClearFilters}>
          Очистить
        </Button>
      ) : null}
    </div>
  )
}
