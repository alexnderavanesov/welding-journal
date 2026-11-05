import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useGridFilterDisplay, type CustomFilterDisplayProps } from 'ag-grid-react'
import type { ColumnFilter } from 'ag-grid-community'
import type { ConnectionRule } from '@/lib/connection-rules'
import { GridFilterValue, GridValueFilterPanel, type GridFilterOption } from './grid-value-filter'

type RuleFilterModel = { values: string[] }

export const CONNECTION_RULE_FILTER: ColumnFilter<ConnectionRule, string, unknown, RuleFilterModel> = {
  component: ConnectionRuleFilter,
  doesFilterPass: ({ node, model, handlerParams }) => model.values.includes(String(handlerParams.getValue(node) ?? '')),
}

function ConnectionRuleFilter({ api, column, model, onModelChange, getValue, doesRowPassOtherFilter }: CustomFilterDisplayProps<ConnectionRule, unknown, RuleFilterModel>) {
  const [search, setSearch] = useState('')
  const [revision, refresh] = useReducer(value => value + 1, 0)
  const input = useRef<HTMLInputElement>(null)
  const hidePopup = useRef<(() => void) | undefined>(undefined)
  useEffect(() => {
    api.addEventListener('filterChanged', refresh)
    return () => { if (!api.isDestroyed()) api.removeEventListener('filterChanged', refresh) }
  }, [api])
  useGridFilterDisplay({ afterGuiAttached: params => {
    hidePopup.current = params?.hidePopup
    refresh()
    input.current?.focus({ preventScroll: true })
  } })
  const options = useMemo(() => {
    const values = new Map<string, GridFilterOption>()
    const query = search.trim().toLocaleLowerCase('ru')
    api.forEachLeafNode(node => {
      if (!doesRowPassOtherFilter(node)) return
      const value = String(getValue(node) ?? '')
      if (!value.toLocaleLowerCase('ru').includes(query)) return
      const option = values.get(value) ?? { value, values: [value], label: value, count: 0 }
      option.count++
      values.set(value, option)
    })
    return [...values.values()].sort((left, right) => left.label.localeCompare(right.label, 'ru'))
  }, [api, getValue, doesRowPassOtherFilter, search, revision])
  const selected = new Set(model?.values ?? [])
  const apply = (values: string[]) => onModelChange(values.length ? { values } : null)
  return <GridValueFilterPanel title={column.getColDef().headerName} search={search} onSearchChange={setSearch} inputRef={input}
    onClose={() => { hidePopup.current?.(); api.setFocusedHeader(column) }}
    canSelectFound={options.length > 0} onSelectFound={() => apply(options.map(option => option.value))} onReset={() => apply([])}
    isFetching={false} isError={false} isLoading={false} onRetry={refresh} empty={!options.length}>
    {options.map(option => <GridFilterValue key={option.value} option={option} selectedValues={selected}
      onToggleValues={values => { const next = new Set(selected); for (const value of values) next.has(value) ? next.delete(value) : next.add(value); apply([...next]) }} />)}
  </GridValueFilterPanel>
}
