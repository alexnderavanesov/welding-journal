import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useGridFilterDisplay, type CustomFilterDisplayProps } from 'ag-grid-react'
import type { DocumentHistoryColumnKey } from '@/lib/document-history-columns'
import { buildWeldColumnValueFilter, parseWeldColumnChoiceFilter } from '@/lib/weld-table-filtering'
import { GridDateFilterOptions, GridFilterValue, GridValueFilterPanel } from './grid-value-filter'

export type DocumentGridFilterOption = { value: string; label: string; count: number }
export type DocumentGridFilterContextValue = {
  viewId: string; search: string; columnFilters: Record<string, string>; sourceRevision?: string | number
  loadOptions: (field: DocumentHistoryColumnKey, search: string, gridSearch: string) => Promise<{ options: DocumentGridFilterOption[]; hasMore: boolean }>
  change: (field: DocumentHistoryColumnKey, value: string) => void
}
export const DocumentGridFilterContext = createContext<DocumentGridFilterContextValue | null>(null)
export const DOCUMENT_HISTORY_SERVER_FILTER = { component: DocumentHistoryGridFilter, doesFilterPass: () => true }

function DocumentHistoryGridFilter({ column }: CustomFilterDisplayProps) {
  const context = useContext(DocumentGridFilterContext)!
  const field = column.getColId() as DocumentHistoryColumnKey
  const [visible, setVisible] = useState(false), [search, setSearch] = useState(''), [debouncedSearch, setDebouncedSearch] = useState('')
  const input = useRef<HTMLInputElement>(null), close = useRef<(() => void) | undefined>(undefined)
  useEffect(() => { const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250); return () => clearTimeout(timer) }, [search])
  useGridFilterDisplay({ afterGuiAttached: params => { close.current = params?.hidePopup; setVisible(true); input.current?.focus({ preventScroll: true }) }, afterGuiDetached: () => setVisible(false) })
  const value = context.columnFilters[field] ?? ''
  const parsed = useMemo(() => parseWeldColumnChoiceFilter(value), [value])
  const selected = useMemo(() => parsed?.kind === 'values' ? parsed.values : [], [parsed])
  const selectedSet = useMemo(() => new Set(selected), [selected])
  const query = useQuery({
    queryKey: ['document-grid-filter-options', context.viewId, field, Object.fromEntries(Object.entries(context.columnFilters).filter(([key]) => key !== field)), context.search, debouncedSearch, context.sourceRevision],
    queryFn: () => context.loadOptions(field, debouncedSearch, context.search), enabled: visible,
    staleTime: 60_000, gcTime: 120_000, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false,
  })
  const options = useMemo(() => {
    const map = new Map((query.data?.options ?? []).map(option => [option.value, option]))
    for (const key of selected) if (!map.has(key) && (!debouncedSearch || key.toLocaleLowerCase('ru').includes(debouncedSearch.toLocaleLowerCase('ru')))) map.set(key, { value: key, label: key || '(пусто)', count: 0 })
    return [...map.values()].map(option => ({ ...option, values: [option.value] }))
  }, [query.data, value, debouncedSearch])
  const apply = (values: string[]) => context.change(field, values.length ? buildWeldColumnValueFilter(values) : '')
  const toggle = (values: string[]) => {
    const next = new Set(selected), remove = values.every(key => next.has(key))
    for (const key of values) remove ? next.delete(key) : next.add(key)
    apply([...next])
  }
  const dated = ['date', 'period', 'updatedAt'].includes(field)
  return <GridValueFilterPanel title={column.getColDef().headerName} search={search} onSearchChange={setSearch}
    inputRef={input} onClose={() => close.current?.()} legacyFilter={value && !parsed ? value : undefined}
    canSelectFound={options.length > 0} onSelectFound={() => apply(options.map(option => option.value))}
    onReset={() => apply([])} isFetching={query.isFetching} isError={query.isError} isLoading={query.isLoading}
    onRetry={() => { void query.refetch() }} empty={!options.length}
    footer={query.data?.hasMore ? <p className="journal-filter-legacy">{dated
      ? 'Показана часть значений. Выбор года, месяца или дня включает только значения из этого списка. Уточните поиск.'
      : 'Показана часть значений. Уточните поиск; сохранённый отбор действует по всему реестру.'}</p> : undefined}>
    {dated ? <GridDateFilterOptions options={options} selectedValues={selectedSet} onToggleValues={toggle} search={debouncedSearch} />
      : options.map(option => <GridFilterValue key={option.value} option={option} selectedValues={selectedSet} onToggleValues={toggle} />)}
  </GridValueFilterPanel>
}
