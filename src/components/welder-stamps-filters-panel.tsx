import { useState } from 'react'
import { ChevronDown, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { countWelderStampFilters, createEmptyWelderStampFilters } from '@/lib/welder-stamp-filters'
import type { WelderStampFilters } from '@/lib/welder-stamp-types'

type WelderStampsFiltersPanelProps = {
  search: string
  filters: WelderStampFilters
  onSearchChange: (value: string) => void
  onFiltersChange: (value: WelderStampFilters) => void
}

export function WelderStampsFiltersPanel({
  search,
  filters,
  onSearchChange,
  onFiltersChange,
}: WelderStampsFiltersPanelProps) {
  const [isOpen, setIsOpen] = useState(false)
  const activeFilterCount = countWelderStampFilters(search, filters)
  const hasAnyFilters = activeFilterCount > 0

  function updateFilter(field: keyof WelderStampFilters, value: string) {
    onFiltersChange({ ...filters, [field]: value })
  }

  return (
    <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-left transition-colors hover:bg-slate-100"
      >
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-800">Фильтры и поиск</span>
          {hasAnyFilters ? (
            <span className="rounded border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800">
              Активно: {activeFilterCount}
            </span>
          ) : (
            <span className="text-xs font-medium text-slate-500">Не применены</span>
          )}
        </span>
        <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen ? (
        <div className="grid items-end gap-3 bg-white p-4 xl:grid-cols-[minmax(280px,1.4fr)_minmax(110px,0.55fr)_minmax(110px,0.55fr)_minmax(150px,0.7fr)_minmax(150px,0.7fr)_auto]">
          <label className="space-y-1.5 text-sm font-medium text-slate-700">
            <span>Поиск</span>
            <Input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Клеймо НАКС, внутреннее клеймо, тип сварки или диаметр"
              className="h-10"
            />
          </label>
          <label className="space-y-1.5 text-sm font-medium text-slate-700">
            <span>Диаметр от</span>
            <Input
              type="number"
              min="0"
              inputMode="decimal"
              value={filters.diameterFrom}
              onChange={(event) => updateFilter('diameterFrom', event.target.value)}
              placeholder="от"
              className="h-10"
            />
          </label>
          <label className="space-y-1.5 text-sm font-medium text-slate-700">
            <span>Диаметр до</span>
            <Input
              type="number"
              min="0"
              inputMode="decimal"
              value={filters.diameterTo}
              onChange={(event) => updateFilter('diameterTo', event.target.value)}
              placeholder="до"
              className="h-10"
            />
          </label>
          <label className="space-y-1.5 text-sm font-medium text-slate-700">
            <span>Срок от</span>
            <Input type="date" value={filters.validFrom} onChange={(event) => updateFilter('validFrom', event.target.value)} className="h-10" />
          </label>
          <label className="space-y-1.5 text-sm font-medium text-slate-700">
            <span>Срок до</span>
            <Input type="date" value={filters.validTo} onChange={(event) => updateFilter('validTo', event.target.value)} className="h-10" />
          </label>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onSearchChange('')
              onFiltersChange(createEmptyWelderStampFilters())
            }}
            disabled={!hasAnyFilters}
            className="h-10 whitespace-nowrap"
          >
            <X className="mr-2 h-4 w-4" />
            Сбросить
          </Button>
        </div>
      ) : null}
    </div>
  )
}
