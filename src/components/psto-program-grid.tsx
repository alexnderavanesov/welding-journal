import { useEffect, useState } from 'react'
import type { AgGridReactProps } from 'ag-grid-react'
import type { ColDef, Column, GridApi } from 'ag-grid-community'
import { ReadOnlyGrid } from './read-only-grid'
import { GRID_THEMES } from './grid-themes'
import { PstoTableFilterContext, PSTO_TABLE_SERVER_FILTER } from './psto-table-grid-filter'
import { PSTO_PROGRAM_LABELS } from '@/lib/psto-line-assignment'

const THEME = GRID_THEMES.quartz.withParams({ headerBackgroundColor: '#eff6fc', borderColor: '#dbe7f2', wrapperBorderRadius: 8 })
const COLUMN = { sortable: false, filter: PSTO_TABLE_SERVER_FILTER, filterParams: { buttons: [] },
  cellDataType: false, suppressHeaderMenuButton: false } satisfies ColDef

function fillSpaceBeforePinnedColumns<T>(api: GridApi<T>, resizing: Column[] = []) {
  if (api.isDestroyed() || !api.getDisplayedRightColumns().length) return
  const columns = api.getDisplayedCenterColumns()
  const { left, right } = api.getHorizontalPixelRange()
  if (right - left - columns.reduce((sum, column) => sum + column.getActualWidth(), 0) < 1) return
  // Manual resizing disables AG's flex. Keep the width being dragged, and let
  // another column fill the viewport instead of leaving a spacer before Actions.
  // Native flex also shrinks it again when Actions grows or the window narrows.
  const available = columns.filter(column => !resizing.includes(column) && column.getActualWidth() < column.getMaxWidth())
  const column = available.find(column => (column.getFlex() ?? 0) > 0) ?? available.at(-1)
  if (column) api.applyColumnState({ state: [{ colId: column.getColId(), flex: column.getFlex() || 1 }] })
}

export function PstoProgramStatus({ value: label }: { value: string }) {
  return <span className={`rounded-md px-2 py-1 text-xs font-medium ${label === PSTO_PROGRAM_LABELS.assigned ? 'bg-sky-50 text-sky-700' : label === PSTO_PROGRAM_LABELS.mixed ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>{label}</span>
}

/** Server filters cover the complete selection; AG renders only the requested page. */
export function PstoProgramGrid<T>({ filters, onFilterChange, candidates, lines, ...props }: AgGridReactProps<T> & {
  label: string; filters: Record<string, string>; onFilterChange: (field: string, value: string) => void
  candidates?: boolean; lines?: boolean
}) {
  const [api, setApi] = useState<GridApi<T> | null>(null)
  useEffect(() => {
    if (!api || api.isDestroyed()) return
    const model = Object.fromEntries(Object.entries(filters).map(([key, value]) => [key, { value }]))
    if (JSON.stringify(api.getFilterModel()) !== JSON.stringify(model)) api.setFilterModel(model)
  }, [api, filters])
  return <PstoTableFilterContext.Provider value={{ candidates, lines, filters, change: onFilterChange }}>
    <ReadOnlyGrid<T> {...props} theme={THEME} columnFilters enableFilterHandlers defaultColDef={COLUMN}
      getMainMenuItems={({ column, api }) => [...(column?.isFilterAllowed() ? ['columnFilter' as const] : []), 'pinSubMenu', 'separator',
        { name: 'Скрыть столбец', action: () => { if (column) api.setColumnsVisible([column], false) } }, 'columnChooser', 'resetColumns']}
      onColumnResized={event => {
        // AG includes automatically flexed neighbours in `columns` as well.
        const resizing = event.source === 'uiColumnResized'
          ? (event.columns ?? []).filter(column => !event.flexColumns?.includes(column)) : []
        fillSpaceBeforePinnedColumns(event.api, resizing)
        props.onColumnResized?.(event)
      }}
      onDisplayedColumnsChanged={event => { fillSpaceBeforePinnedColumns(event.api); props.onDisplayedColumnsChanged?.(event) }}
      onGridSizeChanged={event => { fillSpaceBeforePinnedColumns(event.api); props.onGridSizeChanged?.(event) }}
      onGridReady={event => { setApi(event.api); props.onGridReady?.(event) }} />
  </PstoTableFilterContext.Provider>
}
