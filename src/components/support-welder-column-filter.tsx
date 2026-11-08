import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useGridFilterDisplay, type CustomFilterDisplayProps } from 'ag-grid-react'
import type { ColumnFilter } from 'ag-grid-community'
import type { SupportWelderStatisticsRow } from '@/lib/support-statistics'
import { GridFilterValue, GridValueFilterPanel, type GridFilterOption } from './grid-value-filter'

type Model = { values: string[] }
export const SUPPORT_WELDER_FILTER: ColumnFilter<SupportWelderStatisticsRow, string, unknown, Model> = {
  component: SupportWelderColumnFilter,
  doesFilterPass: ({ node, model, handlerParams }) => model.values.includes(String(handlerParams.getValue(node) ?? '')),
}

function SupportWelderColumnFilter({ api, column, model, onModelChange, getValue, doesRowPassOtherFilter }: CustomFilterDisplayProps<SupportWelderStatisticsRow, unknown, Model>) {
  const [search, setSearch] = useState('')
  const [revision, refresh] = useReducer(value => value + 1, 0)
  const input = useRef<HTMLInputElement>(null)
  const hidePopup = useRef<(() => void) | undefined>(undefined)
  useEffect(() => {
    // Refresh counts after another filter or a new period/project response.
    api.addEventListener('modelUpdated', refresh)
    return () => { if (!api.isDestroyed()) api.removeEventListener('modelUpdated', refresh) }
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
    return [...values.values()].sort((a, b) => a.label.localeCompare(b.label, 'ru', { numeric: true }))
  }, [api, getValue, doesRowPassOtherFilter, search, revision])
  const selected = new Set(model?.values ?? [])
  const apply = (values: string[]) => onModelChange(values.length ? { values } : null)
  return <GridValueFilterPanel title={column.getColDef().headerName} search={search} onSearchChange={setSearch} inputRef={input}
    onClose={() => { hidePopup.current?.(); api.setFocusedHeader(column) }}
    canSelectFound={options.length > 0} onSelectFound={() => apply(options.map(option => option.value))} onReset={() => apply([])}
    isFetching={false} isError={false} isLoading={false} onRetry={refresh} empty={!options.length}>
    {options.map(option => <GridFilterValue key={option.value} option={option} selectedValues={selected} ariaLabel={option.label}
      onToggleValues={values => { const next = new Set(selected); for (const value of values) next.has(value) ? next.delete(value) : next.add(value); apply([...next]) }} />)}
  </GridValueFilterPanel>
}
