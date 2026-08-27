import { useEffect, useRef, useState, type ReactNode } from 'react'

import { FilterStatText } from '@/components/filter-stat-text'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const SEARCH_COMMIT_DELAY_MS = 180

type RequestRowsSearchProps = {
  value: string
  label?: string
  description?: string
  viewToggle?: ReactNode
  placeholder: string
  filteredCount: number
  availableCount: number
  statsLabel?: ReactNode
  action?: ReactNode
  onChange: (value: string) => void
}

export function RequestRowsSearch({
  value,
  label,
  description,
  viewToggle,
  placeholder,
  filteredCount,
  availableCount,
  statsLabel,
  action,
  onChange,
}: RequestRowsSearchProps) {
  const [draft, setDraft] = useState(value)
  const onChangeRef = useRef(onChange)
  const lastEmittedValueRef = useRef(value)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

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
      onChangeRef.current(draft)
    }, SEARCH_COMMIT_DELAY_MS)
    return () => window.clearTimeout(timeoutId)
  }, [draft, value])

  const clearSearch = () => {
    lastEmittedValueRef.current = ''
    setDraft('')
    onChangeRef.current('')
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
      {label || description || viewToggle ? (
        <div className="mr-1 flex shrink-0 items-center gap-2">
          {label || description ? (
            <div>
              {label ? <h3 className="text-sm font-semibold text-slate-800">{label}</h3> : null}
              {description ? <p className="text-xs leading-4 text-slate-500">{description}</p> : null}
            </div>
          ) : null}
          {viewToggle}
        </div>
      ) : null}
      <Input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={placeholder}
        className="h-9 min-w-64 flex-1 bg-white"
      />
      <FilterStatText>
        {statsLabel ?? <>Найдено: {filteredCount} · Доступно: {availableCount}</>}
      </FilterStatText>
      {draft ? (
        <Button variant="outline" size="sm" onClick={clearSearch}>
          Очистить
        </Button>
      ) : null}
      {action ?? null}
    </div>
  )
}
