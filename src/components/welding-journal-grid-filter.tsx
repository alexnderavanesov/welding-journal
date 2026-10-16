import { useMemo, useRef, useState } from 'react'
import { Check, Search, X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useGridFilterDisplay, type CustomFilterDisplayProps } from 'ag-grid-react'
import { useJournalFilter } from './welding-journal-grid-context'
import { buildWeldColumnFilterOptionsRequestFilters } from '@/lib/dispatcher-task-row-codes'
import { splitReportQuickSearch } from '@/lib/report-quick-search'
import { buildWeldColumnValueFilter, groupWeldDateTimeFilterOptions, normalizeWeldColumnFilterChoiceValues, parseWeldColumnChoiceFilter } from '@/lib/weld-table-filtering'
import { DATE_TIME_WELD_FIELD_KEYS, FIELD_BY_KEY, type WeldFieldKey } from '@/lib/weld-fields'
import { journalFilterValueLabel } from '@/lib/welding-journal-grid-state'
import { DateFilterOptions } from './weld-table-field-header-rows'
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
      return { ...value, displayLabel, searchText: `${value.label} ${value.value} ${displayLabel} ${displayLabel.replace(',', '.')}`.toLocaleLowerCase('ru') }
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
  return <div className="journal-filter" role="dialog" aria-label={`Фильтр: ${column.getColDef().headerName}`}
    onKeyDownCapture={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); hidePopup.current?.() } }}>
    <div className="journal-filter-heading"><strong>{column.getColDef().headerName}</strong><button type="button" className="journal-icon-button" aria-label="Закрыть фильтр" onClick={() => hidePopup.current?.()}><X size={15} /></button></div>
    {filter && !choice ? <p className="journal-filter-legacy">Сохранённый фильтр: <strong>{filter}</strong>. Выберите значения ниже, чтобы заменить его, или нажмите «Сбросить фильтр».</p> : null}
    <div className="border-b border-slate-100 px-3 pb-3">
      <div className="journal-search"><Search size={14} /><input ref={searchInput} aria-label="Найти значение фильтра" placeholder="Найти значение…" value={search}
        onChange={event => { setSearch(event.target.value); setLimit(150) }} className="journal-input w-full" /></div>
      <div className="mt-2 flex justify-between gap-3 text-xs">
        <button type="button" disabled={!options.length || query.isError} onClick={() => { apply(buildWeldColumnValueFilter(options.flatMap(value => value.values))); searchInput.current?.focus({ preventScroll: true }) }}>Выбрать найденные</button>
        <button type="button" onClick={() => { apply(''); setSearch(''); searchInput.current?.focus({ preventScroll: true }) }}>Сбросить фильтр</button>
      </div>
    </div>
    <div className="journal-filter-values" aria-busy={query.isFetching}>
      {query.isError ? <div role="alert" className="p-4 text-sm text-rose-700">Не удалось загрузить значения. <button type="button" onClick={() => void query.refetch()} className="underline">Повторить</button></div>
        : query.isLoading ? <p className="p-4 text-slate-500">Загрузка значений…</p>
        : options.length === 0 ? <p className="p-4 text-slate-500">Значений не найдено</p>
        : (FIELD_BY_KEY.get(fieldKey)?.kind === 'date' || DATE_TIME_WELD_FIELD_KEYS.has(fieldKey)) ? <DateFilterOptions options={options} selectedValues={selected} onToggleValue={value => toggleValues([value])} onToggleValues={toggleValues} />
        : options.slice(0, limit).map(option => <label key={option.value} className={`journal-filter-option ${option.values.every(value => selectedSet.has(value)) ? 'is-selected' : ''}`}>
          <input type="checkbox" checked={option.values.every(value => selectedSet.has(value))}
            onChange={event => {
              const next = new Set(selected)
              for (const value of option.values) event.target.checked ? next.add(value) : next.delete(value)
              apply(buildWeldColumnValueFilter([...next]))
            }} />
          <span className="journal-filter-check" aria-hidden="true"><Check size={12} /></span>
          <span className="min-w-0 flex-1 truncate" title={option.label}>{option.displayLabel || '(Пусто)'}</span>
          <span className="journal-count">{option.count}</span>
        </label>)}
      {options.length > limit ? <button type="button" className="w-full p-2 text-sm text-sky-700" onClick={() => setLimit(value => value + 150)}>Ещё значения ({options.length - limit})</button> : null}
    </div>

  </div>
}
