import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AgGridProvider, AgGridReact, type AgGridReactProps } from 'ag-grid-react'
import {
  ClientSideRowModelModule, ClientSideRowModelApiModule, RowAutoHeightModule,
  ColumnApiModule, RowApiModule, CellApiModule, ScrollApiModule, RenderApiModule,
  EventApiModule, CellStyleModule, RowStyleModule, LocaleModule, TooltipModule, CustomFilterModule,
  type ColDef, type GridApi, type SuppressMouseEventHandlingParams, type PostProcessPopupParams,
} from 'ag-grid-community'
import { ColumnMenuModule, MasterDetailModule, SetFilterModule } from 'ag-grid-enterprise'
import { gridHeaderKeyboard } from '@/lib/grid-header-keyboard'
import { positionGridPopup } from './grid-popup-position'
import { GRID_THEMES } from './grid-themes'
import { useProgramPageScroll } from './line-program-page-scroll'
import './read-only-grid.css'

const MODULES = [ClientSideRowModelModule, ClientSideRowModelApiModule, RowAutoHeightModule,
  ColumnApiModule, RowApiModule, CellApiModule, ScrollApiModule, RenderApiModule,
  EventApiModule, CellStyleModule, RowStyleModule, LocaleModule, TooltipModule, CustomFilterModule, MasterDetailModule, ColumnMenuModule, SetFilterModule]
const DEFAULT_COLUMN = {
  resizable: true, sortable: false, wrapHeaderText: true, autoHeaderHeight: true,
  cellRendererParams: { suppressMouseEventHandling: ({ event }: SuppressMouseEventHandlingParams) =>
    event.target instanceof Element && !!event.target.closest('button, a, input, select, textarea') },
  suppressKeyboardEvent: ({ event }) => event.target instanceof Element &&
    !!event.target.closest('button, a, input, select, textarea'),
} satisfies ColDef
const filterNumber = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 })
const filterLabel = ({ value }: { value: unknown }) => typeof value === 'number' ? filterNumber.format(value) : String(value ?? '')
const FILTER_COLUMN = { ...DEFAULT_COLUMN, sortable: true, filter: 'agSetColumnFilter',
  // Match labels and keys: floating-point tails must not produce several
  // indistinguishable choices. The underlying numbers and totals stay exact.
  keyCreator: filterLabel,
  filterParams: { buttons: ['reset', 'apply'], closeOnApply: true, refreshValuesOnOpen: true, valueFormatter: filterLabel },
  suppressHeaderMenuButton: true, cellDataType: false } satisfies ColDef
const LOCALE = { noRowsToShow: 'По текущему поиску и фильтрам ничего не найдено.', loadingOoo: 'Загрузка…',
  pinColumn: 'Закрепить столбец', pinLeft: 'Слева', pinRight: 'Справа', noPin: 'Не закреплять',
  autosizeThisColumn: 'Ширина по содержимому', autosizeAllColumns: 'Подобрать ширину всех',
  sortAscending: 'По возрастанию', sortDescending: 'По убыванию', sortUnSort: 'Сбросить сортировку',
  resetColumns: 'Сбросить столбцы', columnChooser: 'Выбрать столбцы', chooseColumns: 'Выбрать столбцы',
  columnFilter: 'Фильтр столбца', ariaLabelColumnMenu: 'Меню столбца',
  ariaMenuColumn: 'Alt + ↓ — меню столбца', ariaColumnSelectAll: 'Показать или скрыть все столбцы',
  ariaFilterColumnsInput: 'Поиск столбцов', ariaColumnPanelList: 'Список столбцов',
  ariaToggleVisibility: 'Пробел — изменить видимость', ariaVisible: 'видимый', ariaHidden: 'скрытый',
  ariaColumn: 'Столбец', ariaColumns: 'столбцов',
  selectAll: 'Выбрать все', selectAllSearchResults: 'Выбрать найденные', searchOoo: 'Поиск значений…',
  ariaSearchFilterValues: 'Поиск значений фильтра', ariaFilterList: 'Значения фильтра',
  blanks: '(Пусто)', applyFilter: 'Применить', resetFilter: 'Сбросить', cancelFilter: 'Отмена',
  noMatches: 'Нет совпадений', ariaLabelColumnFilter: 'Фильтр столбца', ariaClearInput: 'Очистить поиск' }

/** Local presentation only. Screens own source data and export; the optional
 * displayed-row callback includes the whole filtered set, not just the viewport. */
export function ReadOnlyGrid<T>({ label, pageScroll = false, expandedIds, columnFilters = false, onDisplayedRowsChange, ...props }: AgGridReactProps<T> & {
  label: string
  pageScroll?: boolean
  expandedIds?: ReadonlySet<string>
  columnFilters?: boolean
  onDisplayedRowsChange?: (rows: T[]) => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const [api, setApi] = useState<GridApi<T> | null>(null)
  const [popupParent] = useState(() => typeof document === 'undefined' ? undefined : document.createElement('div'))
  const popupColumn = useRef<string | null>(null)
  const defaultColDef = useMemo(() => ({ ...(columnFilters ? FILTER_COLUMN : DEFAULT_COLUMN), ...props.defaultColDef }), [columnFilters, props.defaultColDef])
  useLayoutEffect(() => {
    if (!popupParent || !columnFilters) return
    popupParent.className = 'read-only-grid-popup-layer'
    document.body.append(popupParent)
    return () => popupParent.remove()
  }, [popupParent, columnFilters])
  useEffect(() => {
    if (!popupParent || !api) return
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !popupColumn.current || api.isDestroyed()) return
      event.preventDefault(); event.stopPropagation()
      api.hideColumnFilter(); api.hidePopupMenu(); api.setFocusedHeader(popupColumn.current)
    }
    popupParent.addEventListener('keydown', escape, true)
    return () => popupParent.removeEventListener('keydown', escape, true)
  }, [api, popupParent])
  const postProcessPopup = (params: PostProcessPopupParams) => {
    popupColumn.current = params.column?.getColId() ?? null
    params.ePopup.classList.add('read-only-grid-popup')
    if (typeof params.column?.getColDef().filter === 'string') params.ePopup.dataset.filterLabel = params.column?.getColDef().headerName ?? 'Фильтр'
    else delete params.ePopup.dataset.filterLabel
    positionGridPopup(params)
  }
  useProgramPageScroll(root, api, pageScroll, '[data-statistics-toolbar]')
  useEffect(() => {
    if (!api || api.isDestroyed() || !expandedIds) return
    api.forEachNode(node => {
      if (node.master && node.id) node.setExpanded(expandedIds.has(node.id))
    })
  }, [api, expandedIds, props.rowData])
  return <div ref={root} className={`read-only-grid ${pageScroll ? 'read-only-grid-page' : 'read-only-grid-dialog'}`}
    onKeyDownCapture={event => { if (api) gridHeaderKeyboard(event, api) }}>
    <div className="program-grid-frame">
      <AgGridProvider modules={MODULES} licenseKey={import.meta.env.VITE_AG_GRID_LICENSE_KEY || undefined}>
        <AgGridReact<T>
          theme={GRID_THEMES.quartz} localeText={LOCALE}
          rowBuffer={5} rowHeight={36} headerHeight={38} animateRows={false}
          suppressScrollOnNewData suppressRowTransform suppressColumnMoveAnimation
          suppressDragLeaveHidesColumns enableCellTextSelection ensureDomOrder
          detailRowAutoHeight suppressFocusAfterRefresh
          popupParent={columnFilters ? popupParent : undefined} postProcessPopup={postProcessPopup}
          {...props}
          defaultColDef={defaultColDef}
          onModelUpdated={event => {
            if (onDisplayedRowsChange) {
              const rows: T[] = []
              event.api.forEachNodeAfterFilterAndSort(node => { if (node.data && !node.detail) rows.push(node.data) })
              onDisplayedRowsChange(rows)
            }
            props.onModelUpdated?.(event)
          }}
          onGridReady={event => {
            event.api.setGridAriaProperty('label', label)
            setApi(event.api)
            props.onGridReady?.(event)
          }}
        />
      </AgGridProvider>
    </div>
  </div>
}
