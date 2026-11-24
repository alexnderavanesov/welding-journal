import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useGridFilterDisplay, type CustomFilterDisplayProps } from 'ag-grid-react'
import { Table2 } from 'lucide-react'
import { useJournalFilter } from './welding-journal-grid-context'
import { closureValueLabel, compareClosureWorkTypes, readClosureColumnFilters, withClosureColumnFilters, type WorkClosureFilter } from '@/lib/work-closures'
import { closureColumns, type ClosureDimension } from '@/lib/work-closure-columns'
import { readWorkClosureFacet } from '@/server/work-closures-api'
import { GridFilterValue, GridValueFilterPanel } from './grid-value-filter'
import { Button } from './ui/button'

const specialOptions = {
  workType: { flag: 'noWorks', label: 'Без записей о закрытии' },
  rateCode: { flag: 'rateAssigned', label: 'Любой заполненный код' },
  actNumber: undefined,
} as const

export function WorkClosureColumnFilter({ dimension, onModelChange }: CustomFilterDisplayProps & { dimension: ClosureDimension }) {
  const table = useJournalFilter()
  const { key, label } = closureColumns[dimension]
  const current = readClosureColumnFilters(table.columnFilters)
  const [draft, setDraft] = useState(current)
  const [visible, setVisible] = useState(false)
  const [search, setSearch] = useState(''), [limit, setLimit] = useState(100)
  const input = useRef<HTMLInputElement>(null), close = useRef<(() => void) | undefined>(undefined)
  const facets = useQuery({ queryKey: ['work-closure-facet', dimension, table.columnFilters], enabled: visible,
    staleTime: 0, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false,
    queryFn: ({ signal }) => readWorkClosureFacet({ signal, data: { columnFilters: table.columnFilters, dimension } }) })
  useGridFilterDisplay({ afterGuiAttached: params => {
    close.current = params?.hidePopup
    setDraft(current); setSearch(''); setLimit(100)
    setVisible(true)
    input.current?.focus({ preventScroll: true })
  }, afterGuiDetached: () => setVisible(false) })
  const selected = new Set(draft[dimension] ?? [])
  const options = facets.data?.options ?? []
  const available = new Set(options.map(option => option.value))
  const missing = [...selected].filter(value => !available.has(value)).map(value => ({ value, count: 0 }))
  const choices = [...options, ...missing]
  if (dimension === 'workType' && missing.length) choices.sort((a, b) => compareClosureWorkTypes(a.value, b.value))
  const query = search.trim().toLocaleLowerCase('ru')
  const matchesSearch = (label: string) => label.toLocaleLowerCase('ru').includes(query)
  const special = specialOptions[dimension]
  const showSpecial = special && matchesSearch(special.label)
  const found = choices.map(option => {
    const label = closureValueLabel(dimension, option.value)
    return { ...option, label: option.value === special?.label ? '«' + label + '»' : label, values: [option.value] }
  }).filter(option => matchesSearch(option.label))
  const selectValues = (values: string[]) => {
    const next = { ...draft, [dimension]: values }
    delete next.noWorks
    if (dimension === 'rateCode') delete next.rateAssigned
    setDraft(next)
  }
  const selectSpecial = (checked: boolean) => {
    if (dimension === 'workType') setDraft(checked ? { noWorks: true } : {})
    if (dimension === 'rateCode') {
      const next = { ...draft, rateAssigned: checked }
      delete next.rateCode
      delete next.noWorks
      setDraft(next)
    }
  }
  const apply = (next: WorkClosureFilter) => {
    const filters = withClosureColumnFilters(table.columnFilters, next)
    if (!table.deferModelChanges) onModelChange(filters[key] ? { value: filters[key] } : null)
    table.onColumnFiltersChange(filters); close.current?.()
  }
  const reset = () => {
    const next = { ...draft }; delete next[dimension]
    if (dimension === 'workType') delete next.noWorks
    if (dimension === 'rateCode') delete next.rateAssigned
    setDraft(next); apply(next)
  }
  return <GridValueFilterPanel title={label} search={search} onSearchChange={value => { setSearch(value); setLimit(100) }}
    inputRef={input} onClose={() => close.current?.()} canSelectFound={!facets.isPending && (!!showSpecial || found.length > 0)}
    onSelectFound={() => found.length ? selectValues([...new Set([...selected, ...found.map(option => option.value)])]) : selectSpecial(true)}
    onReset={reset} isError={facets.isError} isFetching={facets.isFetching} isLoading={facets.isPending} onRetry={() => void facets.refetch()} empty={!showSpecial && !found.length}
    footer={<div className="flex justify-between gap-2 border-t border-slate-100 p-3"><Button size="sm" variant="outline" disabled={draft.noWorks}
        onClick={() => { table.onClosureSummary?.(dimension, draft); close.current?.() }}><Table2 size={14} />Сводка</Button>
      <Button size="sm" onClick={() => apply(draft)}>Применить</Button>
    </div>}>
    {showSpecial && <GridFilterValue option={{ value: special.flag, values: [special.flag], label: special.label, count: facets.data?.specialCount ?? 0 }}
      ariaLabel={special.label} selectedValues={new Set(draft[special.flag] ? [special.flag] : [])}
      onToggleValues={() => selectSpecial(!draft[special.flag])} />}
    {found.slice(0, limit).map(option => <GridFilterValue key={option.value} option={option} ariaLabel={option.label} selectedValues={selected}
      onToggleValues={() => {
        const next = new Set(selected)
        if (next.has(option.value)) next.delete(option.value); else next.add(option.value)
        selectValues([...next])
      }} />)}
    {found.length > limit && <Button size="sm" variant="ghost" onClick={() => setLimit(limit + 100)}>Показать ещё</Button>}
  </GridValueFilterPanel>
}
