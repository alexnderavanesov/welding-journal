import { useCallback, useRef, useState, type KeyboardEvent, type UIEvent } from 'react'
import { Filter, Search, X } from 'lucide-react'
import {
  STAMP_CHECK_GENERAL_RULES,
  STAMP_CHECK_REFERENCE_SCENARIOS,
  STAMP_CHECK_REGISTRY_RULES,
  type StampCheckReferenceRule,
} from '@/lib/welder-stamp-check-reference'
import type { GridFilterOption } from './grid-value-filter'
import { StampCheckReferenceFilter } from './stamp-check-reference-filter'

const EXAMPLE_HEADERS = ['Тип соединения', 'Материал 1 / 2', 'Сварщики и способ', 'Первая деталь', 'Вторая деталь', 'Что проверяется по допуску']
const RULE_HEADERS = ['Что проверяется', 'Действующее правило']

function ReferenceTable({ title, headers, rows, examples = false }: {
  title: string
  headers: readonly string[]
  rows: readonly (readonly string[])[]
  examples?: boolean
}) {
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Record<number, string[]>>({})
  const [active, setActive] = useState<{ column: number; anchor: HTMLButtonElement } | null>(null)
  const head = useRef<HTMLTableSectionElement>(null)
  const body = useRef<HTMLTableSectionElement>(null)
  const query = search.trim().toLocaleLowerCase('ru')
  const matches = (row: readonly string[], except?: number) => row.some(cell => cell.toLocaleLowerCase('ru').includes(query))
    && headers.every((_, column) => column === except || !filters[column]?.length || filters[column].includes(row[column]))
  const filtered = rows.filter(row => matches(row))
  const hasFilters = Boolean(search || Object.values(filters).some(values => values.length))
  const reset = () => { setSearch(''); setFilters({}) }
  const close = useCallback((restoreFocus = true) => {
    setActive(null)
    if (restoreFocus) active?.anchor.focus({ preventScroll: true })
  }, [active])
  const options = new Map<string, GridFilterOption>()
  if (active) {
    // Facets consider the other columns, so choosing one value never hides its
    // alternatives in the same column. Keep selected zero-count values removable.
    for (const value of filters[active.column] ?? []) options.set(value, { value, values: [value], label: value, count: 0 })
    for (const row of rows) {
      if (!matches(row, active.column)) continue
      const value = row[active.column]
      const option = options.get(value) ?? { value, values: [value], label: value, count: 0 }
      option.count++
      options.set(value, option)
    }
  }
  const syncScroll = (event: UIEvent<HTMLElement>, other: HTMLElement | null) => {
    if (other && Math.abs(other.scrollLeft - event.currentTarget.scrollLeft) > 1) other.scrollLeft = event.currentTarget.scrollLeft
  }
  const scrollWithArrows = (event: KeyboardEvent<HTMLElement>) => {
    // WebKit does not consistently scroll a focused region with arrows.
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    if (event.currentTarget.scrollWidth <= event.currentTarget.clientWidth) return
    event.preventDefault()
    event.currentTarget.scrollBy({ left: event.key === 'ArrowRight' ? 80 : -80 })
  }
  const rowClass = examples
    ? 'grid min-w-[1050px] grid-cols-[12%_13%_16%_11%_11%_37%]'
    : 'grid grid-cols-[35%_65%] sm:grid-cols-[25%_75%]'

  return <div className="min-w-0 space-y-3">
    <div className="flex flex-wrap items-center gap-3">
      <label className="relative min-w-0 flex-1 basis-64 sm:max-w-sm">
        <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input type="search" aria-label={`Поиск: ${title}`} placeholder="Поиск по таблице…" value={search} onChange={event => setSearch(event.target.value)}
          className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100" />
      </label>
      <span role="status" className="text-xs tabular-nums text-slate-500">Показано {filtered.length} из {rows.length}</span>
      {hasFilters && <button type="button" onClick={reset} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-sky-700 hover:bg-sky-50 focus-visible:outline-sky-500">
        <X size={14} aria-hidden="true" />Сбросить фильтры
      </button>}
    </div>
    <div role="region" aria-label={examples ? 'Табличные примеры проверки клейм' : title}>
      <table role="table" className="block w-full rounded-lg border border-slate-200 bg-white text-left text-sm leading-6">
        <caption className="sr-only">{title}</caption>
        {/* Separate horizontal scrollers let the header stick to the page,
            without creating an inner vertical viewport. Keep native table roles. */}
        <thead role="rowgroup" ref={head} onScroll={event => syncScroll(event, body.current)}
          className="sticky top-14 z-20 block overflow-x-auto rounded-t-lg border-b border-slate-200 bg-slate-50 text-slate-700 shadow-sm [scrollbar-width:thin]">
          <tr role="row" className={rowClass}>
            {headers.map((label, column) => <th key={label} role="columnheader" scope="col" className="min-w-0 px-3 py-3 font-semibold sm:px-4">
              <div className="flex h-full items-center justify-between gap-1">
                <span className="min-w-0 break-words">{label}</span>
                <button type="button" aria-label={`Фильтр: ${label}`} title={`Фильтр: ${label}`} aria-haspopup="dialog" aria-expanded={active?.column === column}
                  onClick={event => active?.column === column ? close() : setActive({ column, anchor: event.currentTarget })}
                  className={`relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${filters[column]?.length ? 'bg-sky-100 text-sky-700' : 'text-slate-400 hover:bg-slate-200/60 hover:text-slate-700'}`}>
                  <Filter size={15} aria-hidden="true" />
                  {Boolean(filters[column]?.length) && <><span aria-hidden="true" className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-sky-600" /><span className="sr-only">Фильтр применён</span></>}
                </button>
              </div>
            </th>)}
          </tr>
        </thead>
        <tbody role="rowgroup" ref={body} tabIndex={examples ? 0 : undefined} aria-label={examples ? 'Строки примеров — горизонтальная прокрутка' : undefined}
          onScroll={event => syncScroll(event, head.current)} onKeyDown={scrollWithArrows}
          className="block overflow-x-auto rounded-b-lg outline-none focus-visible:ring-2 focus-visible:ring-sky-400 [scrollbar-width:thin]">
          {filtered.map((row, index) => <tr key={index} role="row" className={`${rowClass} border-b border-slate-200 last:border-b-0 hover:bg-slate-50/60`}>
            {row.map((value, column) => column === 0
              ? <th key={column} role="rowheader" scope="row" className="min-w-0 break-words px-3 py-4 font-medium text-slate-900 sm:px-4">{value}</th>
              : <td key={column} role="cell" className={`min-w-0 break-words px-3 py-4 text-slate-700 sm:px-4 ${examples && (column === 3 || column === 4) ? 'tabular-nums' : ''}`}>{value}</td>)}
          </tr>)}
          {!filtered.length && <tr role="row" className={rowClass}><td role="cell" colSpan={headers.length} className="col-span-full px-4 py-10 text-slate-500">
            Ничего не найдено. Измените поиск или <button type="button" className="text-sky-700 underline underline-offset-2" onClick={reset}>сбросьте фильтры</button>.
          </td></tr>}
        </tbody>
      </table>
    </div>
    {active && <StampCheckReferenceFilter key={active.column} title={headers[active.column]} anchor={active.anchor}
      options={[...options.values()].sort((a, b) => a.label.localeCompare(b.label, 'ru', { numeric: true }))}
      selected={new Set(filters[active.column] ?? [])} onChange={values => setFilters(current => ({ ...current, [active.column]: values }))} onClose={close} />}
  </div>
}

function RuleTable({ title, rules }: { title: string; rules: readonly StampCheckReferenceRule[] }) {
  return <section className="min-w-0 space-y-3">
    <h3 className="text-base font-semibold text-slate-900">{title}</h3>
    <ReferenceTable title={title} headers={RULE_HEADERS} rows={rules} />
  </section>
}

export function WelderStampCheckReferenceTable() {
  return (
    <div className="min-w-0 space-y-6">
      <section className="min-w-0 space-y-3">
        <h3 className="text-base font-semibold text-slate-900">Размеры, материалы и сварщики</h3>
        <p className="max-w-5xl text-sm leading-6 text-slate-600">А и Б — разные сварщики. Размеры записаны как диаметр × толщина, мм. Одинаковая группа материалов указана один раз, разные — в порядке первой и второй детали. М01/М05 и способы сварки приведены для примера: правила применяются и к другим значениям справочника. Каждый пример дополняется общими проверками ниже.</p>
        <p className="text-xs leading-5 text-slate-500">Фильтр в заголовке столбца позволяет найти и выбрать значения. На узком экране прокручивайте таблицу по горизонтали. По вертикали прокручивается вся страница, шапка таблицы остаётся сверху.</p>
        <ReferenceTable title="Проверка клейм по типу соединения, материалам, сварщикам и размерам деталей" headers={EXAMPLE_HEADERS} rows={STAMP_CHECK_REFERENCE_SCENARIOS} examples />
      </section>
      <RuleTable title="Общие проверки клейм" rules={STAMP_CHECK_GENERAL_RULES} />
      <RuleTable title="Заполнение справочника клейм" rules={STAMP_CHECK_REGISTRY_RULES} />
    </div>
  )
}
