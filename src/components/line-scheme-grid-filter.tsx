import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useGridFilterDisplay, type CustomFilterDisplayProps } from 'ag-grid-react'
import { GridFilterValue, GridValueFilterPanel } from './grid-value-filter'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { getLineSchemeFilterOptions } from '@/server/line-schemes-api'
import type { SchemeFilterField, SchemeFilters } from '@/lib/line-schemes'

export const SchemeFilterContext = createContext<{
  filters: SchemeFilters; sourceRevision: number
  change: (field: SchemeFilterField, values: string[]) => void
} | null>(null)
export const SCHEME_SERVER_FILTER = { component: SchemeGridFilter, doesFilterPass: () => true }

function SchemeGridFilter({ column, api, model, onModelChange }: CustomFilterDisplayProps) {
  const context = useContext(SchemeFilterContext)!, field = column.getColId() as SchemeFilterField
  const [visible, setVisible] = useState(false), [search, setSearch] = useState('')
  const input = useRef<HTMLInputElement>(null), hide = useRef<(() => void) | undefined>(undefined)
  const match = useDebouncedValue(search.trim(), 250), selected = context.filters[field] ?? []
  const value = selected.length ? selected : null
  useEffect(() => { if (JSON.stringify(model) !== JSON.stringify(value)) onModelChange(value) }, [model, value, onModelChange])
  useGridFilterDisplay({ afterGuiAttached: params => {
    hide.current = params?.hidePopup; setVisible(true); input.current?.focus({ preventScroll: true })
  }, afterGuiDetached: () => setVisible(false) })
  const filters = Object.fromEntries(Object.entries(context.filters).filter(([key]) => key !== field))
  const query = useQuery({
    queryKey: ['line-scheme-filter-options', field, filters, match, context.sourceRevision],
    queryFn: ({ signal }) => getLineSchemeFilterOptions({ data: { field, filters, valueSearch: match }, signal }),
    enabled: visible, staleTime: 15_000, gcTime: 120_000, retry: false, refetchOnWindowFocus: false,
  })
  const pending = search.trim() !== match || query.isFetching
  const selectedSet = new Set(selected), options = query.data?.options ?? []
  const apply = (values: string[]) => context.change(field, values)
  return <GridValueFilterPanel title={column.getColDef().headerName} search={search} onSearchChange={setSearch}
    inputRef={input} onClose={() => { hide.current?.(); api.setFocusedHeader(column) }}
    canSelectFound={!pending && options.length > 0} onSelectFound={() => { if (!pending) apply(options.map(option => option.value)) }}
    onReset={() => apply([])} isFetching={pending} isError={query.isError} isLoading={query.isLoading}
    onRetry={() => void query.refetch()} empty={!options.length}
    footer={query.data?.hasMore ? <p className="journal-filter-legacy">Показаны первые 100 значений — уточните поиск.</p> : undefined}>
    <fieldset disabled={pending} aria-busy={pending} className={pending ? 'opacity-50' : undefined}>
      {options.map(option => <GridFilterValue key={option.value} option={{ ...option, values: [option.value] }} selectedValues={selectedSet}
        onToggleValues={() => { if (!pending) apply(selectedSet.has(option.value) ? selected.filter(item => item !== option.value) : [...selected, option.value]) }} />)}
    </fieldset>
  </GridValueFilterPanel>
}
