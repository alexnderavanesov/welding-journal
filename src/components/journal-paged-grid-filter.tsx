import { useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { useGridFilterDisplay, type CustomFilterDisplayProps } from 'ag-grid-react'
import { useJournalFilter } from './welding-journal-grid-context'
import { GridFilterValue, GridValueFilterPanel } from './grid-value-filter'
import { buildWeldColumnFilterOptionsRequestFilters } from '@/lib/dispatcher-task-row-codes'
import { splitReportQuickSearch } from '@/lib/report-quick-search'
import { journalFilterSearchText } from '@/lib/journal-filter-options'
import { buildWeldColumnValueFilter, normalizeWeldColumnFilterChoiceValues, parseWeldColumnChoiceFilter } from '@/lib/weld-table-filtering'
import { journalFilterValueLabel } from '@/lib/welding-journal-grid-state'
import type { WeldFieldKey } from '@/lib/weld-fields'
import { readJournalFilterPage, selectJournalFilterValues } from '@/server/journal-grid-api'

export function JournalPagedGridFilter({ column, onModelChange }: CustomFilterDisplayProps) {
  const table = useJournalFilter(), client = useQueryClient()
  const fieldKey = column.getColId() as WeldFieldKey
  const [visible, setVisible] = useState(false), [search, setSearch] = useState(''), [match, setMatch] = useState('')
  const [limit, setLimit] = useState(150)
  const [more, setMore] = useState(false), [selecting, setSelecting] = useState(false), [selectionError, setSelectionError] = useState(false)
  const input = useRef<HTMLInputElement>(null), hide = useRef<(() => void) | undefined>(undefined)
  const selectRequest = useRef<AbortController | null>(null)
  useGridFilterDisplay({ afterGuiAttached: params => { hide.current = params?.hidePopup; setVisible(true); input.current?.focus({ preventScroll: true }) },
    afterGuiDetached: () => {
      // AG retains filter components after closing their popup. Unmount-only
      // cleanup would let a late Select Found response change a closed filter.
      setVisible(false); selectRequest.current?.abort(); selectRequest.current = null; setSelecting(false)
    } })
  const filter = table.columnFilters[fieldKey] ?? ''
  const choice = useMemo(() => parseWeldColumnChoiceFilter(filter), [filter])
  const selected = useMemo(() => new Set(choice?.kind === 'values' ? normalizeWeldColumnFilterChoiceValues(fieldKey, choice.values) : []), [choice, fieldKey])
  const request = useMemo(() => ({ fieldKey, ...splitReportQuickSearch(buildWeldColumnFilterOptionsRequestFilters(table.columnFilters, fieldKey)) }), [table.columnFilters, fieldKey])
  const key = ['weld-column-filter-options', 'weldingJournal', fieldKey, request, 'paged'] as const
  const settings = { staleTime: 15_000, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false } as const
  const first = useQuery({ ...settings, queryKey: [...key, 'first'], enabled: visible,
    queryFn: ({ signal }) => readJournalFilterPage({ signal, data: request }) })
  const small = first.data !== undefined && first.data.next === undefined
  useEffect(() => {
    if (small) { setMatch(search); return }
    const timer = setTimeout(() => setMatch(search), 60)
    return () => clearTimeout(timer)
  }, [search, small])
  const remote = !small && (match !== '' || more)
  const pages = useInfiniteQuery({ ...settings, queryKey: [...key, 'matches', match, first.data?.revision],
    enabled: visible && Boolean(first.data) && !small,
    initialData: match === '' && first.data ? { pages: [first.data], pageParams: [0] } : undefined,
    initialPageParam: 0,
    queryFn: ({ signal, pageParam }) => match === '' && pageParam === 0 && first.data ? first.data
      : readJournalFilterPage({ signal, data: { ...request, match, start: pageParam, revision: first.data?.revision } }),
    getNextPageParam: last => last.next,
  })
  const options = useMemo(() => {
    const values = remote ? pages.data?.pages.flatMap(page => page.options) ?? [] : first.data?.options ?? []
    const text = search.toLocaleLowerCase('ru')
    return (small ? values.filter(value => journalFilterSearchText(fieldKey, value).includes(text)) : values)
      .map(value => ({ ...value, values: [value.value], displayLabel: journalFilterValueLabel(fieldKey, value.label) }))
  }, [remote, pages.data, first.data, small, search, fieldKey])
  const displayed = small ? options.slice(0, limit) : options
  const total = small ? options.length : remote ? pages.data?.pages[0]?.total ?? 0 : first.data?.total ?? 0
  const waiting = !small && search !== match
  const stateKey = JSON.stringify([request, filter, search])
  const current = useRef({ stateKey, table, onModelChange }); current.current = { stateKey, table, onModelChange }
  useEffect(() => {
    selectRequest.current?.abort(); selectRequest.current = null; setSelecting(false); setSelectionError(false)
  }, [stateKey])
  useEffect(() => () => selectRequest.current?.abort(), [])
  const apply = (value: string) => {
    const latest = current.current, filters = { ...latest.table.columnFilters }
    if (value) filters[fieldKey] = value; else delete filters[fieldKey]
    if (!latest.table.deferModelChanges) latest.onModelChange(value ? { value } : null)
    latest.table.onColumnFiltersChange(filters)
  }
  const selectFound = async () => {
    if (waiting || selecting) return
    if (options.length === total) { apply(buildWeldColumnValueFilter(options.map(option => option.value))); return }
    const controller = new AbortController(); selectRequest.current = controller
    setSelecting(true); setSelectionError(false)
    try {
      const result = await selectJournalFilterValues({ signal: controller.signal, data: { ...request, match, revision: first.data?.revision } })
      if (!controller.signal.aborted && current.current.stateKey === stateKey) apply(buildWeldColumnValueFilter(result.values))
    } catch { if (!controller.signal.aborted) setSelectionError(true) }
    finally { if (selectRequest.current === controller) { selectRequest.current = null; setSelecting(false) } }
  }
  const retry = () => { setSelectionError(false); client.removeQueries({ queryKey: [...key, 'matches'] }); void first.refetch() }
  return <GridValueFilterPanel title={column.getColDef().headerName} search={search} inputRef={input} onClose={() => hide.current?.()}
    onSearchChange={value => { setSearch(value); setMore(false); setLimit(150) }} legacyFilter={filter && !choice ? filter : undefined}
    canSelectFound={total > 0 && !waiting && !selecting} onSelectFound={() => { void selectFound() }} onReset={() => apply('')}
    isFetching={first.isFetching || remote && pages.isFetching || waiting || selecting}
    isLoading={first.isLoading || remote && pages.isLoading || waiting} isError={first.isError || remote && pages.isError || selectionError}
    onRetry={retry} empty={!options.length}>
    {displayed.map(option => <GridFilterValue key={option.value} option={option} selectedValues={selected} onToggleValues={values => {
      selectRequest.current?.abort(); setSelecting(false)
      const next = new Set(selected)
      for (const value of values) next.has(value) ? next.delete(value) : next.add(value)
      apply(buildWeldColumnValueFilter([...next]))
    }} />)}
    {total > displayed.length ? <button type="button" className="w-full p-2 text-sm text-sky-700" disabled={pages.isFetching}
      onClick={() => { if (small) setLimit(value => value + 150); else { setMore(true); void pages.fetchNextPage() } }}>Ещё значения ({total - displayed.length})</button> : null}
  </GridValueFilterPanel>
}
