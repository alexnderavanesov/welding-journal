import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { X } from 'lucide-react'

import { FilterStatText } from '@/components/filter-stat-text'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import type { RequestDocumentIdentity } from '@/lib/request-document-identity'

const SEARCH_COMMIT_DELAY_MS = 180

export type ResultFiltersProps = {
  search: string
  requestSearch: string
  requestKey: string
  filteredRequestOptions: RequestDocumentIdentity[]
  availableRequestOptionsCount: number
  filteredRowsCount: number
  selectedRowsCount: number
  leading?: ReactNode
  action?: ReactNode
  compactToolbar?: boolean
  searchClassName?: string
  showClearFilters: boolean
  onSearchChange: (value: string) => void
  onRequestSearchChange: (value: string) => void
  onRequestChange: (request: RequestDocumentIdentity | null) => void
  onClearRequestSearch: () => void
  onClearFilters: () => void
}

export function ResultFilters({
  search,
  requestSearch,
  requestKey,
  filteredRequestOptions,
  availableRequestOptionsCount,
  filteredRowsCount,
  selectedRowsCount,
  leading,
  action,
  compactToolbar = false,
  searchClassName = 'h-9 min-w-56 flex-[0.8] bg-white',
  showClearFilters,
  onSearchChange,
  onRequestSearchChange,
  onRequestChange,
  onClearRequestSearch,
  onClearFilters,
}: ResultFiltersProps) {
  return (
    <div className={`flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-2 ${
      compactToolbar ? 'xl:flex-nowrap' : ''
    }`}>
      {leading ?? null}
      <BufferedFilterInput
        value={search}
        onValueChange={onSearchChange}
        placeholder="Проект, шифр, линия, спул или стык"
        className={searchClassName}
      />
      <BufferedFilterInput
        value={requestSearch}
        onValueChange={onRequestSearchChange}
        placeholder="Поиск заявки"
        className={compactToolbar ? 'h-9 min-w-0 flex-[0.55] bg-white' : 'h-9 min-w-44 flex-[0.45] bg-white'}
      />
      <Select
        value={requestKey}
        onChange={(event) => {
          const key = event.target.value
          onRequestChange(filteredRequestOptions.find((option) => option.key === key) ?? null)
        }}
        className={compactToolbar ? 'h-9 min-w-40 flex-[0.5] bg-white' : 'h-9 min-w-48 flex-[0.5] bg-white'}
      >
        <option value="">Все заявки</option>
        {filteredRequestOptions.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </Select>
      {compactToolbar ? (
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClearRequestSearch}
            className={`h-9 px-2 ${requestSearch ? '' : 'invisible'}`}
            disabled={!requestSearch}
            tabIndex={requestSearch ? 0 : -1}
            aria-hidden={!requestSearch}
            aria-label="Очистить поиск заявки"
          >
            <X className="h-4 w-4" />
          </Button>
        </span>
      ) : requestSearch ? (
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
      <span className={`flex shrink-0 items-center gap-3 ${compactToolbar ? 'text-[11px]' : ''}`}>
        <FilterStatText>
          Заявок: {filteredRequestOptions.length}/{availableRequestOptionsCount}
        </FilterStatText>
        <FilterStatText>
          Найдено: {filteredRowsCount} · Выбрано: {selectedRowsCount}
        </FilterStatText>
      </span>
      {compactToolbar ? (
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClearFilters}
            className={`h-9 px-2 ${showClearFilters ? '' : 'invisible'}`}
            disabled={!showClearFilters}
            tabIndex={showClearFilters ? 0 : -1}
            aria-hidden={!showClearFilters}
            aria-label="Очистить поиск стыков"
          >
            <X className="h-4 w-4" />
          </Button>
        </span>
      ) : showClearFilters ? (
        <Button variant="outline" size="sm" onClick={onClearFilters}>
          Очистить
        </Button>
      ) : null}
      {action ? <span className="ml-auto shrink-0">{action}</span> : null}
    </div>
  )
}

function BufferedFilterInput({
  value,
  onValueChange,
  ...inputProps
}: Omit<ComponentProps<typeof Input>, 'onChange' | 'value'> & {
  value: string
  onValueChange: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)
  const onValueChangeRef = useRef(onValueChange)
  const lastEmittedValueRef = useRef(value)

  useEffect(() => {
    onValueChangeRef.current = onValueChange
  }, [onValueChange])

  useEffect(() => {
    if (value === lastEmittedValueRef.current) return
    lastEmittedValueRef.current = value
    setDraft(value)
  }, [value])

  useEffect(() => {
    if (draft === value || draft === lastEmittedValueRef.current) return
    const timeoutId = window.setTimeout(() => {
      if (draft === lastEmittedValueRef.current) return
      lastEmittedValueRef.current = draft
      onValueChangeRef.current(draft)
    }, SEARCH_COMMIT_DELAY_MS)
    return () => window.clearTimeout(timeoutId)
  }, [draft, value])

  return (
    <Input
      {...inputProps}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
    />
  )
}
