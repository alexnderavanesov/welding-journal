import { createContext, useContext, useRef, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useGridFilterDisplay, type CustomFilterDisplayProps } from 'ag-grid-react'
import { buildWeldColumnValueFilter, parseWeldColumnChoiceFilter } from '@/lib/weld-column-choice-filter'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { listPstoExceptionFilterOptions } from '@/server/psto-chain-exceptions'
import { listPstoLineFilterOptions } from '@/server/psto-line-assignment'
import { GridFilterValue, GridValueFilterPanel } from './grid-value-filter'

export const PstoTableFilterContext = createContext<{ candidates?: boolean; lines?: boolean; filters: Record<string, string>; change: (field: string, value: string) => void } | null>(null)
export const PSTO_TABLE_SERVER_FILTER = { component: PstoTableGridFilter, doesFilterPass: () => true }

function PstoTableGridFilter({ column, api, onModelChange }: CustomFilterDisplayProps) {
  const context = useContext(PstoTableFilterContext)!, field = column.getColId()
  const [visible, setVisible] = useState(false), [search, setSearch] = useState('')
  const match = useDebouncedValue(search.trim(), 200)
  const input = useRef<HTMLInputElement>(null), close = useRef<(() => void) | undefined>(undefined)
  useGridFilterDisplay({ afterGuiAttached: params => { close.current = params?.hidePopup; setVisible(true); input.current?.focus({ preventScroll: true }) }, afterGuiDetached: () => setVisible(false) })
  const filters = Object.fromEntries(Object.entries(context.filters).filter(([key]) => key !== field))
  const request = { candidates: context.candidates === true, lines: context.lines === true, filters, field, match }
  const query = useInfiniteQuery({ queryKey: ['psto-chain-exceptions', 'filter', request], enabled: visible,
    initialPageParam: 0, queryFn: ({ pageParam, signal }) => context.lines ? listPstoLineFilterOptions({ signal, data: { ...request, offset: pageParam } }) : listPstoExceptionFilterOptions({ signal, data: { ...request, offset: pageParam } }),
    getNextPageParam: last => last.next, staleTime: 15_000, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false })
  const value = context.filters[field] ?? '', parsed = parseWeldColumnChoiceFilter(value)
  const selected = new Set(parsed?.values ?? [])
  const options = query.data?.pages.flatMap(page => page.options) ?? []
  const waiting = search.trim() !== match || query.isFetching
  const apply = (next: string) => { onModelChange(next ? { value: next } : null); context.change(field, next) }
  return <GridValueFilterPanel title={column.getColDef().headerName} search={search} onSearchChange={setSearch} inputRef={input}
    onClose={() => { close.current?.(); api.setFocusedHeader(column) }} legacyFilter={value && !parsed ? value : undefined}
    canSelectFound={!waiting && options.length > 0} onSelectFound={() => apply(match)} onReset={() => apply('')}
    isFetching={waiting} isLoading={query.isLoading || search.trim() !== match} isError={query.isError} onRetry={() => { void query.refetch() }} empty={!options.length}
    footer={<p className="journal-filter-legacy">Отбор действует по всей таблице. «Выбрать найденные» включает все совпадения.</p>}>
    <fieldset disabled={waiting} className="m-0 min-w-0 border-0 p-0">{options.map(option => <GridFilterValue key={option.value} option={{ ...option, values: [option.value] }} selectedValues={selected}
      onToggleValues={values => { const next = new Set(selected); for (const key of values) next.has(key) ? next.delete(key) : next.add(key); apply(buildWeldColumnValueFilter([...next])) }} />)}</fieldset>
    {query.hasNextPage && <button type="button" className="w-full p-2 text-sm text-sky-700" disabled={waiting} onClick={() => { void query.fetchNextPage() }}>Ещё значения</button>}
  </GridValueFilterPanel>
}
