import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type MouseEvent, type KeyboardEvent } from 'react'
import { AgGridProvider, AgGridReact, type AgGridReactProps } from 'ag-grid-react'
import {
  ClientSideRowModelModule, ClientSideRowModelApiModule, RowAutoHeightModule, ColumnApiModule, RowApiModule, CellApiModule, ScrollApiModule, RenderApiModule, EventApiModule,
  ColumnAutoSizeModule, CellStyleModule, RowStyleModule, TooltipModule, LocaleModule, GridStateModule,
  themeQuartz, themeAlpine, themeBalham,
  type ColDef, type GridApi, type GridState, type IRowNode, type ICellRendererParams, type SuppressMouseEventHandlingParams, type PostProcessPopupParams,
} from 'ag-grid-community'
import { ColumnMenuModule, SetFilterModule, MasterDetailModule, RowGroupingModule, ColumnsToolPanelModule } from 'ag-grid-enterprise'
import { Layers, X } from 'lucide-react'
import { useProgramDomOrder } from './line-program-dom-order'
import { useGridResultMotion } from './use-grid-result-motion'
import { useProgramPageScroll } from './line-program-page-scroll'
import { useProgramDetailMotion } from './line-program-detail-motion'
import { useProgramAppearance } from './line-program-appearance'
import { useProgramGridSession } from './line-program-grid-session'
import { programGridColumns, readProgramGridSettings, writeProgramGridSettings, type ProgramGridKind } from '@/lib/line-program-grid-state'
import { useStableEventCallback } from '@/lib/use-stable-event-callback'
import { isProgramRowClick } from '@/lib/line-program-workspace'
import { positionGridPopup } from './grid-popup-position'
import './line-program-grid.css'

const MODULES = [ClientSideRowModelModule, ClientSideRowModelApiModule, RowAutoHeightModule, ColumnApiModule, RowApiModule, CellApiModule, ScrollApiModule, RenderApiModule,
  EventApiModule, ColumnAutoSizeModule, CellStyleModule, RowStyleModule, TooltipModule, LocaleModule, GridStateModule,
  ColumnMenuModule, SetFilterModule, MasterDetailModule, RowGroupingModule, ColumnsToolPanelModule]
// Isolated program styling: changes here must never restyle the welding journal.
const THEME_PARAMS = { accentColor: '#0284c7', backgroundColor: '#fff', foregroundColor: '#475569',
  headerBackgroundColor: '#f7f9fc', headerTextColor: '#64748b', borderColor: '#e2e8f0',
  rowBorder: { color: '#edf2f7', width: 1 }, fontFamily: 'inherit', fontSize: 13,
  headerFontSize: 12, headerFontWeight: 600, cellHorizontalPadding: 12, wrapperBorderRadius: 0,
  rowHoverColor: 'transparent', wrapperBorder: false, spacing: 5, listItemHeight: 28 }
const THEMES = {
  quartz: themeQuartz.withParams(THEME_PARAMS),
  alpine: themeAlpine.withParams({ ...THEME_PARAMS, headerBackgroundColor: '#edf3f8', headerTextColor: '#475569', borderColor: '#d5dfe8' }),
  balham: themeBalham.withParams({ ...THEME_PARAMS, headerBackgroundColor: '#f5f5f2', headerTextColor: '#5d655e', borderColor: '#dfe3dc' }),
}
const LOCALE = {
  pinColumn: 'Закрепить столбец', pinLeft: 'Слева', pinRight: 'Справа', noPin: 'Не закреплять',
  autosizeThisColumn: 'Ширина по содержимому', autosizeAllColumns: 'Подобрать ширину всех', resetColumns: 'Сбросить столбцы',
  sortAscending: 'По возрастанию', sortDescending: 'По убыванию', sortUnSort: 'Сбросить сортировку',
  columnFilter: 'Фильтр', columnChooser: 'Выбрать столбцы', chooseColumns: 'Выбрать столбцы',
  ariaColumnSelectAll: 'Показать или скрыть все столбцы', ariaFilterColumnsInput: 'Поиск столбцов',
  ariaColumnPanelList: 'Список столбцов', ariaToggleVisibility: 'Пробел — изменить видимость',
  ariaVisible: 'видимый', ariaHidden: 'скрытый', ariaColumn: 'Столбец',
  groupBy: 'Группировать по «${variable}»', ungroupBy: 'Убрать группу «${variable}»', ungroupAll: 'Убрать группировки',
  group: 'Группа', groups: 'Группы', columns: 'Столбцы', expandAll: 'Развернуть все', collapseAll: 'Свернуть все',
  selectAll: 'Выбрать все', selectAllSearchResults: 'Выбрать найденные', searchOoo: 'Поиск значений…',
  ariaSearchFilterValues: 'Поиск значений фильтра', ariaFilterList: 'Значения фильтра', blanks: '(Пусто)', applyFilter: 'Применить', resetFilter: 'Сбросить', cancelFilter: 'Отмена',
  noMatches: 'Нет совпадений', ariaClearInput: 'Очистить поиск',

  noRowsToShow: 'В этой выборке нет записей', noMatchingRows: 'В отборе нет записей', loadingOoo: 'Загрузка…',
  ariaLabelColumnMenu: 'Меню столбца', ariaLabelColumnFilter: 'Фильтр столбца', ariaRowGroupExpanded: 'Развёрнуто', ariaRowGroupCollapsed: 'Свёрнуто',
}
const DEFAULT_COLUMN: ColDef = { resizable: true, sortable: true, filter: 'agSetColumnFilter', minWidth: 90,
  filterParams: { buttons: ['reset', 'apply'], closeOnApply: true, refreshValuesOnOpen: true }, enableRowGroup: true,
  suppressHeaderMenuButton: true, wrapHeaderText: true, autoHeaderHeight: true, cellDataType: false,
  // Native form controls own their focus. Grid mousedown focus can scroll a
  // clipped cell between pointerdown and click, losing a checkbox click.
  cellRendererParams: { suppressMouseEventHandling: ({ event }: SuppressMouseEventHandlingParams) => event.target instanceof Element && !!event.target.closest('input, select, textarea, button, details, summary, a') },
  suppressKeyboardEvent: ({ event }) => event.target instanceof Element && !!event.target.closest('input, select, textarea, button, summary') }

const UNGROUPED_COLUMN = { ...DEFAULT_COLUMN, enableRowGroup: false }
const GROUP_ROW = { suppressCount: true, innerRenderer: ({ node }: ICellRendererParams) =>
  <span className="program-group-label"><span>{node.rowGroupColumn?.getColDef().headerName}: <strong>{node.key || '(Пусто)'}</strong></span><span className="program-group-count">Линий: {node.allChildrenCount ?? 0}</span></span> }

const initiallyOpenGroup = ({ rowNode }: { rowNode: IRowNode }) => !!rowNode.group && rowNode.level === 0

function programPopup(params: PostProcessPopupParams) {
  params.ePopup.classList.add('program-grid-popup')
  if (params.type === 'columnFilter') params.ePopup.dataset.programFilterLabel = params.column?.getColDef().headerName ?? 'Фильтр'
  const search = params.ePopup.querySelector<HTMLInputElement>('.ag-column-select-header-filter-wrapper input')
  if (search) search.placeholder = 'Найти столбец…'
  positionGridPopup(params)
}

type RowEvent = MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>
type Props<T> = {
  kind: ProgramGridKind; sessionKey: string; label: string; rows: T[]; columns: ColDef<T>[]
  getId: (row: T) => string; contextLabel?: string; toolbar?: ReactNode
  virtual?: boolean; rowHeight?: number; detailRenderer?: (props: ICellRendererParams<T>) => ReactNode
  isExpanded?: (row: T) => boolean
  onRowClick?: (row: T) => void; onRowMenu?: (event: RowEvent, row: T) => void
  rowAttributes?: (row: T) => Record<string, string | undefined>
  getRowClass?: AgGridReactProps<T>['getRowClass']; onReady?: (api: GridApi<T>) => void
  onFilterRows?: (rows: T[]) => void; children?: ReactNode
}

/** Presentation adapter for the four program tables. All mutations remain in the existing workspace. */
export function ProgramGrid<T>(props: Props<T>) {
  return <AgGridProvider modules={MODULES} licenseKey={import.meta.env.VITE_AG_GRID_LICENSE_KEY || undefined}><Grid {...props} /></AgGridProvider>
}

function Grid<T>(props: Props<T>) {
  const { kind, sessionKey, label, rows, columns, virtual = false } = props
  const { appearance } = useProgramAppearance()
  const [api, setApi] = useState<GridApi<T> | null>(null)
  const [settings, setSettings] = useState(() => readProgramGridSettings(kind))
  const [groups, setGroups] = useState<{ id: string; label: string }[]>([])
  const session = useProgramGridSession()
  const initialState = useRef<GridState | undefined>((() => {
    const state = session?.get(`grid:${sessionKey}`) as GridState | undefined
    return state && kind !== 'lines' ? { ...state, rowGroup: undefined, rowGroupExpansion: undefined } : state
  })())
  const root = useRef<HTMLDivElement>(null)
  const resultMotion = useGridResultMotion(root, { opacity: .9 })
  const rendered = useRef(false)
  const previousRowIds = useRef<string[] | null>(null)
  const [popupParent] = useState(() => typeof document === 'undefined' ? undefined : document.createElement('div'))
  useLayoutEffect(() => {
    if (!popupParent) return
    // One scoped layer also covers native submenus and the column chooser;
    // they must remain above the assignment dialog, not just above grid cells.
    popupParent.className = 'program-grid-popup-layer'
    document.body.append(popupParent)
    return () => popupParent.remove()
  }, [popupParent])
  const restoring = useRef(false), currentSettings = useRef(settings)
  currentSettings.current = settings
  const current = useRef(props); current.current = props
  const detailMotion = useProgramDetailMotion(current)
  const decorations = useRef(new WeakMap<HTMLElement, { attributes: string[]; classes: string[] }>())
  // React context updates editors without recreating native rows. Refresh only
  // our attributes/classes too; otherwise selection and saved-status titles go stale.
  const decorate = useCallback((element: HTMLElement, node: IRowNode<T>, grid: GridApi<T>) => {
    if (!node.data || node.group || node.detail || node.rowIndex == null) return
    const attributes = current.current.rowAttributes?.(node.data) ?? {}
    const value = current.current.getRowClass?.({ data: node.data, node, rowIndex: node.rowIndex, api: grid, context: undefined })
    const classes = (Array.isArray(value) ? value : (value ?? '').split(' ')).filter(Boolean)
    const previous = decorations.current.get(element)
    for (const name of previous?.attributes ?? []) if (attributes[name] == null) element.removeAttribute(name)
    for (const [name, value] of Object.entries(attributes)) if (value != null) element.setAttribute(name, value)
    for (const name of previous?.classes ?? []) if (!classes.includes(name)) element.classList.remove(name)
    element.classList.add(...classes)
    decorations.current.set(element, { attributes: Object.keys(attributes), classes })
  }, [])
  useLayoutEffect(() => {
    if (!api || api.isDestroyed()) return
    for (const element of root.current?.querySelectorAll<HTMLElement>('.ag-row[row-id]') ?? []) {
      if (element.closest('[data-program-grid]') !== root.current) continue
      const node = api.getRowNode(element.getAttribute('row-id')!)
      if (node) decorate(element, node, api)
    }
  }, [api, props.rowAttributes, props.getRowClass, rows, decorate])
  useProgramPageScroll(root, api, kind === 'joints')
  useProgramDomOrder(root)
  const save = useCallback((grid: GridApi<T>) => {
    if (restoring.current || grid.isDestroyed()) return
    const next = { ...currentSettings.current, columns: programGridColumns(grid.getColumnState()) }
    if (JSON.stringify(next) !== JSON.stringify(currentSettings.current)) {
      currentSettings.current = next; setSettings(next); writeProgramGridSettings(kind, next)
    }
  }, [kind])
  useEffect(() => {
    const synchronize = (event: Event) => {
      if (event instanceof CustomEvent && event.detail !== kind) return
      const next = readProgramGridSettings(kind)
      if (JSON.stringify(next) === JSON.stringify(currentSettings.current)) return
      currentSettings.current = next; setSettings(next)
      if (api && !api.isDestroyed()) {
        restoring.current = true
        api.applyColumnState({ state: next.columns, applyOrder: true })
        restoring.current = false
      }
    }
    window.addEventListener('program-grid-settings', synchronize); window.addEventListener('storage', synchronize)
    return () => { window.removeEventListener('program-grid-settings', synchronize); window.removeEventListener('storage', synchronize) }
  }, [kind, api])
  const synchronizeExpansion = useStableEventCallback((grid: GridApi<T>) => {
    detailMotion.synchronize(grid)
  })
  useEffect(() => { if (api) synchronizeExpansion(api) }, [api, rows, props.isExpanded, synchronizeExpansion])
  const rowMenu = (event: RowEvent) => {
    if (event.type === 'contextmenu') event.preventDefault()
    if (event.type === 'keydown' && !('key' in event && (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey))) return
    // Leave native header/toolbar keyboard events to their own controls, including
    // nested grids. Capture is needed only for a business row's context menu.
    if (event.target instanceof Element && event.target.closest('.ag-header, .ag-menu, .program-grid-toolbar')) {
      if (event.type === 'contextmenu') event.stopPropagation()
      return
    }
    const element = event.target instanceof Element ? event.target.closest<HTMLElement>('.ag-row[row-id]') : null
    if (!element || !root.current?.contains(element) || element.closest('[data-program-grid]') !== root.current) return
    const row = api?.getRowNode(element.getAttribute('row-id') ?? '')?.data
    if (row) props.onRowMenu?.(event, row)
  }
  const densityOffset = appearance.density === 'compact' ? -8 : appearance.density === 'spacious' ? 12 : 0
  const rowHeight = props.rowHeight ?? ((kind === 'assignments' ? 72 : kind === 'stamps' ? 88 : kind === 'lines' ? 76 : 44) + densityOffset)
  const getRowHeight = useCallback(({ node }: { node: IRowNode<T> }) => node.group ? 36 : undefined, [])
  const columnMenu = useCallback<NonNullable<AgGridReactProps<T>['getColumnMenuItems']>>(params => {
    if (kind !== 'lines' || !params.api.getRowGroupColumns().length || params.source !== 'columnMenu') return params.defaultItems
    const toggleGroups = (expanded: boolean) => params.api.forEachNode(node => {
      // Only groups, never every master/detail line and its server data.
      if (node.group) node.setExpanded(expanded)
    })
    return [...params.defaultItems.filter(item => item !== 'expandAll' && item !== 'contractAll'), 'separator',
      { name: 'Развернуть все', action: () => toggleGroups(true) },
      { name: 'Свернуть все', action: () => toggleGroups(false) }]
  }, [kind])
  const rowId = useCallback(({ data }: { data: T }) => current.current.getId(data), [])
  // Stable callbacks prevent AG Grid from reprocessing all rows on each disclosure/draft update.
  const rowClasses = useCallback<NonNullable<Props<T>['getRowClass']>>(params => params.node.detail ? undefined : current.current.getRowClass?.(params), [])
  const updateModel = (grid: GridApi<T>) => {
    if (!current.current.onFilterRows) return
    const filtered: T[] = []
    grid.forEachNodeAfterFilterAndSort(node => { if (node.data && !node.group && !node.detail) filtered.push(node.data) })
    current.current.onFilterRows(filtered)
  }
  const updateRows = (grid: GridApi<T>) => {
    const ids = current.current.rows.map(row => current.current.getId(row))
    const previous = previousRowIds.current
    previousRowIds.current = ids
    // External status tabs replace rowData, while selection/draft edits keep
    // the same identities. Do not fade on every edit or cached disclosure.
    if (rendered.current && previous && (previous.length !== ids.length || ids.some((id, index) => previous[index] !== id))) resultMotion.reveal()
    updateModel(grid)
  }
  return <div ref={root} data-program-grid={kind} data-program-grid-context={props.contextLabel ?? label}
    data-program-density={appearance.density} data-program-theme={appearance.theme} data-program-vertical-borders={appearance.verticalBorders}
    className={`program-ag-grid grid-result-motion ${kind === 'joints' ? 'program-ag-grid-windowed' : virtual ? 'program-ag-grid-virtual' : 'program-ag-grid-page'}`}
    onContextMenu={rowMenu} onKeyDownCapture={rowMenu}
    onKeyDown={event => {
      if ((event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) && event.target instanceof Element && event.target.closest('.ag-header, .ag-menu, .program-grid-toolbar')) event.stopPropagation()
    }}>
    {props.toolbar || props.children ? <div className="program-grid-toolbar">{props.toolbar}{props.children}</div> : null}
    {groups.length ? <div className="program-grid-groups" aria-label="Группировка таблицы"><Layers size={14} />{groups.map(group => <button key={group.id} type="button" aria-label={`Убрать группировку ${group.label}`} onClick={() => api?.removeRowGroupColumns([group.id])}>{group.label}<X size={12} /></button>)}</div> : null}
    <div className="program-grid-frame">
      <AgGridReact<T> theme={THEMES[appearance.theme]} localeText={LOCALE} rowData={rows} columnDefs={columns} defaultColDef={kind === 'lines' ? DEFAULT_COLUMN : UNGROUPED_COLUMN}
        groupDisplayType="groupRows" groupRowRendererParams={GROUP_ROW} isGroupOpenByDefault={initiallyOpenGroup}
        initialState={initialState.current} getRowId={rowId} domLayout={virtual || kind === 'joints' ? 'normal' : 'autoHeight'}
        rowHeight={rowHeight} getRowHeight={kind === 'lines' ? getRowHeight : undefined} headerHeight={36} rowBuffer={5} animateRows={false} suppressScrollOnNewData ensureDomOrder={false} suppressRowTransform
        suppressRowHoverHighlight suppressColumnMoveAnimation suppressDragLeaveHidesColumns
        suppressGroupRowsSticky={kind === 'joints'}
        masterDetail={!!props.detailRenderer} detailCellRenderer={props.detailRenderer ? detailMotion.renderer : undefined} detailRowAutoHeight
        keepDetailRows keepDetailRowsCount={100} getRowClass={rowClasses}
        suppressCellFocus={false} suppressFocusAfterRefresh postProcessPopup={programPopup} getColumnMenuItems={columnMenu}
        popupParent={popupParent}
        onGridReady={({ api: grid }) => {
          restoring.current = true
          grid.setGridAriaProperty('label', label)
          // A cached detail may recreate AG's instance while retaining this
          // React component and its initialState ref. Read the latest session
          // snapshot here so reopening cannot replace a live filter with the
          // snapshot from its very first mount.
          const saved = session?.get(`grid:${sessionKey}`) as GridState | undefined
          if (saved) grid.setState(kind === 'lines' ? saved : { ...saved, rowGroup: undefined, rowGroupExpansion: undefined })
          if (currentSettings.current.columns.length) grid.applyColumnState({ state: currentSettings.current.columns, applyOrder: true })
          restoring.current = false; setGroups(grid.getRowGroupColumns().map(column => ({ id: column.getColId(), label: column.getColDef().headerName ?? column.getColId() }))); setApi(grid); synchronizeExpansion(grid); current.current.onReady?.(grid)
        }}
        onColumnRowGroupChanged={({ api: grid }) => {
          setGroups(grid.getRowGroupColumns().map(column => ({ id: column.getColId(), label: column.getColDef().headerName ?? column.getColId() })))
          if (rendered.current && !restoring.current) resultMotion.reveal()
        }}
        onRowGroupOpened={({ node }) => { if (node.group && rendered.current) resultMotion.reveal() }}
        onStateUpdated={({ state }) => session?.set(`grid:${sessionKey}`, state)}
        onGridPreDestroyed={({ api: grid }) => session?.set(`grid:${sessionKey}`, grid.getState())}
        onColumnResized={event => { if (event.finished) save(event.api) }}
        onColumnMoved={event => { if (event.finished) save(event.api) }}
        onFirstDataRendered={({ api: grid }) => { synchronizeExpansion(grid); updateRows(grid); rendered.current = true }}
        onRowDataUpdated={({ api: grid }) => { if (!grid.isDestroyed()) updateRows(grid) }}
        onFilterChanged={({ api: grid }) => { updateModel(grid); if (rendered.current && !restoring.current) resultMotion.reveal() }}
        onSortChanged={({ api: grid }) => { updateModel(grid); if (rendered.current && !restoring.current) resultMotion.reveal() }}
        onRowClicked={({ data, node, event }) => { if (data && !node.group && !node.detail && event && isProgramRowClick(event.target)) current.current.onRowClick?.(data) }}
        processRowPostCreate={({ node, eRow, api: grid }) => decorate(eRow, node, grid)}
      />
    </div>
    {detailMotion.portals}
  </div>
}
