import { Check, ChevronRight, Minus, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode, type RefObject } from 'react'
import { formatDisplayDate, parseDateLikeToIso } from '@/lib/date-format'
import { isModalDialogOpen } from '@/lib/modal-layer'
import { isContextActionMenuOpen } from '@/lib/context-action-menu-state'
import './welding-journal-grid.css'
import './grid-value-filter.css'

export type GridFilterOption = {
  value: string
  values: string[]
  label: string
  displayLabel?: string
  count: number
}

/** Presentation only: each registry keeps its own authoritative facet request and filter values. */
export function GridValueFilterPanel({
  title, search, onSearchChange, inputRef, onClose, legacyFilter,
  canSelectFound, onSelectFound, onReset, isFetching, isError, isLoading, onRetry, empty, children, footer,
}: {
  title?: string
  search: string
  onSearchChange: (value: string) => void
  inputRef: RefObject<HTMLInputElement | null>
  onClose: () => void
  legacyFilter?: string
  canSelectFound: boolean
  onSelectFound: () => void
  onReset: () => void
  isFetching: boolean
  isError: boolean
  isLoading: boolean
  onRetry: () => void
  empty: boolean
  children: ReactNode
  footer?: ReactNode
}) {
  const focusSearch = () => inputRef.current?.focus({ preventScroll: true })
  return <div className="journal-filter" role="dialog" aria-label={`Фильтр: ${title}`}
    onKeyDownCapture={event => {
      if (event.key === 'Escape' && !isModalDialogOpen() && !isContextActionMenuOpen()) {
        event.preventDefault(); event.stopPropagation(); onClose()
      }
    }}>
    <div className="journal-filter-heading"><strong>{title}</strong><button type="button" className="journal-icon-button" aria-label="Закрыть фильтр" onClick={onClose}><X size={15} /></button></div>
    {legacyFilter ? <p className="journal-filter-legacy">Сохранённый фильтр: <strong>{legacyFilter}</strong>. Выберите значения ниже, чтобы заменить его, или нажмите «Сбросить фильтр».</p> : null}
    <div className="border-b border-slate-100 px-3 pb-3">
      <div className="journal-search"><Search size={14} /><input ref={inputRef} aria-label="Найти значение фильтра" placeholder="Найти значение…" value={search}
        onChange={event => onSearchChange(event.target.value)} className="journal-input w-full" /></div>
      <div className="mt-2 flex justify-between gap-3 text-xs">
        <button type="button" disabled={!canSelectFound || isError} onClick={() => { onSelectFound(); focusSearch() }}>Выбрать найденные</button>
        <button type="button" onClick={() => { onReset(); onSearchChange(''); focusSearch() }}>Сбросить фильтр</button>
      </div>
    </div>
    <div className="journal-filter-values" aria-busy={isFetching}>
      {isError ? <div role="alert" className="p-4 text-sm text-rose-700">Не удалось загрузить значения. <button type="button" onClick={onRetry} className="underline">Повторить</button></div>
        : isLoading ? <p className="p-4 text-slate-500">Загрузка значений…</p>
        : empty ? <p className="p-4 text-slate-500">Значений не найдено</p>
        : children}
    </div>
    {footer}
  </div>
}

export function GridFilterValue({ option, selectedValues, onToggleValues, ariaLabel }: {
  option: GridFilterOption
  selectedValues: ReadonlySet<string>
  onToggleValues: (values: string[]) => void
  ariaLabel?: string
}) {
  const selectedCount = option.values.filter(value => selectedValues.has(value)).length
  const checked = option.values.length > 0 && selectedCount === option.values.length
  const partial = selectedCount > 0 && !checked
  return <label className={`journal-filter-option ${checked ? 'is-selected' : ''}`}>
    <input type="checkbox" aria-label={ariaLabel} checked={checked} ref={input => { if (input) input.indeterminate = partial }}
      // Pointer activation does not focus checkboxes in every browser. Keep
      // subsequent keyboard commands inside this filter after choosing a value.
      onClick={event => event.currentTarget.focus({ preventScroll: true })} onChange={() => onToggleValues(option.values)} />
    <span className="journal-filter-check" aria-hidden="true">{partial ? <Minus size={12} /> : <Check size={12} />}</span>
    <span className="min-w-0 flex-1 truncate" title={option.label}>{option.displayLabel || option.label || '(Пусто)'}</span>
    <span className="journal-count">{option.count}</span>
  </label>
}

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']

function optionDate(option: GridFilterOption) {
  // Use the already displayed business date for timestamps. Never derive a UTC
  // day from their raw value or turn a period into a different filter token.
  const text = (option.displayLabel || option.label || option.value).trim()
  const prefix = text.match(/^(?:-\s*)?(\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.(?:\d{4}|\d{2}))(?=$|[\s,T])/)
  return parseDateLikeToIso(prefix?.[1] ?? text)
}

function combineOptions(value: string, label: string, options: readonly GridFilterOption[]): GridFilterOption {
  return { value, label, values: [...new Set(options.flatMap(option => option.values))], count: options.reduce((sum, option) => sum + option.count, 0) }
}

function DateFilterBranch({ option, selectedValues, onToggleValues, search, ariaLabel, children }: {
  option: GridFilterOption
  selectedValues: ReadonlySet<string>
  onToggleValues: (values: string[]) => void
  search: string
  ariaLabel: string
  children: ReactNode
}) {
  const [expanded, setExpanded] = useState(Boolean(search))
  useEffect(() => { setExpanded(Boolean(search)) }, [search])
  return <div className="grid-filter-date-branch">
    <div className="grid-filter-date-heading">
      <button type="button" className="journal-icon-button" aria-label={`${expanded ? 'Свернуть' : 'Развернуть'} ${ariaLabel}`} aria-expanded={expanded}
        onClick={() => setExpanded(value => !value)}><ChevronRight size={14} /></button>
      <GridFilterValue option={option} selectedValues={selectedValues} onToggleValues={onToggleValues} ariaLabel={ariaLabel} />
    </div>
    {expanded ? <div className="grid-filter-date-children">{children}</div> : null}
  </div>
}

export function GridDateFilterOptions({ options, selectedValues, onToggleValues, search }: {
  options: readonly GridFilterOption[]
  selectedValues: ReadonlySet<string>
  onToggleValues: (values: string[]) => void
  search: string
}) {
  const { years, undated } = useMemo(() => {
    const dates = new Map<string, Map<string, Map<string, GridFilterOption[]>>>()
    const undated: GridFilterOption[] = []
    for (const option of options) {
      const date = optionDate(option)
      if (!date) { undated.push(option); continue }
      const [year, month] = date.split('-')
      const months = dates.get(year) ?? new Map<string, Map<string, GridFilterOption[]>>()
      const days = months.get(month) ?? new Map<string, GridFilterOption[]>()
      const dayOptions = days.get(date) ?? []
      dayOptions.push(option)
      days.set(date, dayOptions); months.set(month, days); dates.set(year, months)
    }
    const descending = ([left]: [string, unknown], [right]: [string, unknown]) => right.localeCompare(left)
    const years = [...dates.entries()].sort(descending).map(([year, months]) => {
      const groupedMonths = [...months.entries()].sort(descending).map(([month, days]) => {
        const groupedDays = [...days.entries()].sort(descending).map(([date, options]) => ({
          date, options, option: combineOptions(date, formatDisplayDate(date), options),
          // Pure date values need only one day checkbox. Preserve timestamps
          // and periods as independently selectable leaves beneath that day.
          hasDetails: options.some(option => !parseDateLikeToIso(option.displayLabel || option.label)),
        }))
        return { month, days: groupedDays, option: combineOptions(`${year}-${month}`, MONTHS[Number(month) - 1], groupedDays.map(day => day.option)) }
      })
      return { year, months: groupedMonths, option: combineOptions(year, year, groupedMonths.map(month => month.option)) }
    })
    return { years, undated }
  }, [options])
  const common = { selectedValues, onToggleValues, search }
  return <div className="grid-filter-dates">
    {undated.map(option => <GridFilterValue key={option.value} option={option} {...common} />)}
    {years.map(year => <DateFilterBranch key={year.year} option={year.option} ariaLabel={`Год ${year.year}`} {...common}>
      {year.months.map(month => <DateFilterBranch key={month.month} option={month.option} ariaLabel={`${month.option.label} ${year.year}`} {...common}>
        {month.days.map(day => day.hasDetails
          ? <DateFilterBranch key={day.date} option={day.option} ariaLabel={`День ${day.option.label}`} {...common}>
            {day.options.map(option => <GridFilterValue key={option.value} option={option} {...common} />)}
          </DateFilterBranch>
          : <GridFilterValue key={day.date} option={day.option} ariaLabel={`День ${day.option.label}`} {...common} />)}
      </DateFilterBranch>)}
    </DateFilterBranch>)}
  </div>
}
