import { useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useGridFilterDisplay, type CustomFilterDisplayProps } from 'ag-grid-react'
import { useJournalFilter } from './welding-journal-grid-context'
import { buildWeldColumnFilterOptionsRequestFilters } from '@/lib/dispatcher-task-row-codes'
import { formatDisplayDate } from '@/lib/date-format'
import { splitReportQuickSearch } from '@/lib/report-quick-search'
import { buildWeldColumnValueFilter, groupWeldDateTimeFilterOptions, normalizeWeldColumnFilterChoiceValues, parseWeldColumnChoiceFilter } from '@/lib/weld-table-filtering'
import { DATE_TIME_WELD_FIELD_KEYS, FIELD_BY_KEY, type WeldFieldKey } from '@/lib/weld-fields'
import { journalFilterValueLabel } from '@/lib/welding-journal-grid-state'
import { GridDateFilterOptions, GridFilterValue, GridValueFilterPanel } from './grid-value-filter'
import { listWeldColumnFilterOptions } from '@/server/weld-read-api'

// Server filtering remains authoritative, including hidden navigation filters and
// historical date/assignment semantics. AG Grid must not filter just the loaded page.
export const JOURNAL_SERVER_FILTER = { component: JournalGridFilter, doesFilterPass: () => true }

function JournalGridFilter({ column, onModelChange }: CustomFilterDisplayProps) {
  const table = useJournalFilter()
  const fieldKey = column.getColId() as WeldFieldKey
  const [visible, setVisible] = useState(false)
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(150)
  const searchInput = useRef<HTMLInputElement>(null)
  const hidePopup = useRef<(() => void) | undefined>(undefined)
  useGridFilterDisplay({ afterGuiAttached: params => {
    hidePopup.current = params?.hidePopup
    setVisible(true)
    searchInput.current?.focus({ preventScroll: true })
  }, afterGuiDetached: () => setVisible(false) })
  const filter = table.columnFilters[fieldKey] ?? ''
  const choice = useMemo(() => parseWeldColumnChoiceFilter(filter), [filter])
  const selected = useMemo(() => choice?.kind === 'values' ? normalizeWeldColumnFilterChoiceValues(fieldKey, choice.values) : [], [choice, fieldKey])
  const selectedSet = useMemo(() => new Set(selected), [selected])
  const request = useMemo(() => splitReportQuickSearch(
    buildWeldColumnFilterOptionsRequestFilters(table.columnFilters, fieldKey),
  ), [table.columnFilters, fieldKey])
  const query = useQuery({
    queryKey: ['weld-column-filter-options', 'weldingJournal', fieldKey, request],
    enabled: visible,
    queryFn: ({ signal }) => listWeldColumnFilterOptions({ signal, data: {
      report: 'weldingJournal', fieldKey, search: request.search, columnFilters: request.columnFilters,
    } }),
    staleTime: 15_000, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false,
  })
  const availableOptions = useMemo(() => {
    const values = query.data ?? []
    const grouped = DATE_TIME_WELD_FIELD_KEYS.has(fieldKey)
      ? groupWeldDateTimeFilterOptions(values)
      : values.map(value => ({ ...value, values: [value.value] }))
    return grouped.map(value => {
      const displayLabel = journalFilterValueLabel(fieldKey, value.label)
      const dateLabel = FIELD_BY_KEY.get(fieldKey)?.kind === 'date' ? formatDisplayDate(value.label) : ''
      return { ...value, displayLabel, searchText: `${value.label} ${value.value} ${displayLabel} ${displayLabel.replace(',', '.')} ${dateLabel}`.toLocaleLowerCase('ru') }
    })
  }, [query.data, fieldKey])
  const options = useMemo(() => {
    const text = search.toLocaleLowerCase('ru')
    return availableOptions.filter(value => value.searchText.includes(text))
  }, [availableOptions, search])
  const apply = (value: string) => {
    const filters = { ...table.columnFilters }
    if (value) filters[fieldKey] = value
    else delete filters[fieldKey]
    onModelChange(value ? { value } : null)
    table.onColumnFiltersChange(filters)
  }
  const toggleValues = (values: string[]) => {
    const next = new Set(selected)
    const remove = values.every(value => next.has(value))
    for (const value of values) remove ? next.delete(value) : next.add(value)
    apply(buildWeldColumnValueFilter([...next]))
  }
  const dated = FIELD_BY_KEY.get(fieldKey)?.kind === 'date' || DATE_TIME_WELD_FIELD_KEYS.has(fieldKey)
  return <GridValueFilterPanel title={column.getColDef().headerName} search={search}
    onSearchChange={value => { setSearch(value); setLimit(150) }} inputRef={searchInput} onClose={() => hidePopup.current?.()}
    legacyFilter={filter && !choice ? filter : undefined} canSelectFound={options.length > 0}
    onSelectFound={() => apply(buildWeldColumnValueFilter(options.flatMap(option => option.values)))} onReset={() => apply('')}
    isFetching={query.isFetching} isError={query.isError} isLoading={query.isLoading} onRetry={() => { void query.refetch() }} empty={!options.length}>
    {dated ? <GridDateFilterOptions options={options} selectedValues={selectedSet} onToggleValues={toggleValues} search={search} />
      : options.slice(0, limit).map(option => <GridFilterValue key={option.value} option={option} selectedValues={selectedSet} onToggleValues={toggleValues} />)}
    {!dated && options.length > limit ? <button type="button" className="w-full p-2 text-sm text-sky-700" onClick={() => setLimit(value => value + 150)}>Ещё значения ({options.length - limit})</button> : null}
  </GridValueFilterPanel>
}
