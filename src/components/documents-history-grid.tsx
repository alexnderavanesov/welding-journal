import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AgGridProvider, AgGridReact } from 'ag-grid-react'
import type { ColDef, GridApi, IRowNode, IServerSideDatasource, RowSelectionOptions, SelectionColumnDef, GetColumnMenuItemsParams, DefaultMenuItem, MenuItemDef } from 'ag-grid-community'
import { ChevronDown, ChevronUp, ChevronsDown, ChevronsUp } from 'lucide-react'
import { ContextActionMenu, type ContextActionMenuState } from './context-action-menu'
import { positionGridPopup } from './grid-popup-position'
import { DocumentsGridToolbar } from './documents-grid-toolbar'
import { DocumentGridCheckbox } from './document-grid-checkbox'
import { JournalColumnHeading } from './welding-journal-column-heading'
import { JournalGroupingControls } from './welding-journal-grouping-controls'
import { documentGridClipboardText } from '@/lib/document-grid-clipboard'
import { selectDocumentGridRowRange, type DocumentGridRowRangeState } from '@/lib/document-grid-row-range'
import { documentGridGroupSelection, mergeLoadedDocumentGridSelection, toggleLoadedDocumentGridSelection, type DocumentGridGroupSelection, type LoadedDocumentGridRow } from '@/lib/document-grid-selection'
import type { DocumentHistoryColumnDefinition, DocumentHistoryColumnKey } from '@/lib/document-history-columns'
import type { DocumentHistoryGridRequest, DocumentHistoryGridResult, DocumentHistoryGroupRow } from '@/lib/document-history-grid'
import { DOCUMENT_GRID_GROUP_FIELDS, documentGridRowHeight, normalizeDocumentGridColumns, readDocumentGridState, reconcileDocumentGridSelection, writeDocumentGridState, type DocumentGridAppearance, type DocumentGridState } from '@/lib/document-history-grid-state'
import { useJournalPageScroll } from '@/lib/use-journal-page-scroll'
import { isModalDialogOpen } from '@/lib/modal-layer'
import { isContextActionMenuOpen } from '@/lib/context-action-menu-state'
import { documentGridErrorMessage, readDocumentGridSession } from '@/lib/document-history-grid-session'
import { useDocumentGridFocus } from '@/lib/use-document-grid-focus'
import { useDocumentGridSession } from '@/lib/use-document-grid-session'
import { DOCUMENT_GRID_MODULES, DOCUMENT_GRID_LOCALE, DOCUMENT_GRID_THEMES } from './document-history-grid-config'
import { DOCUMENT_HISTORY_SERVER_FILTER, DocumentGridFilterContext, type DocumentGridFilterOption } from './document-history-grid-filter'
import { useGridResultMotion } from './use-grid-result-motion'
import './document-history-grid.css'
import './welding-journal-ui.css'

const CELL_SELECTION = { suppressMultiRanges: false }

type DocumentRow = { id: string | number }
type Position = { x: number; y: number; clientX: number; clientY: number; anchorElement?: Element; copyCells: () => void }
export type DocumentsHistoryGridProps<T extends DocumentRow> = {
  viewId: string
  columns: readonly DocumentHistoryColumnDefinition[]
  initialVisibleColumnKeys: readonly DocumentHistoryColumnKey[]
  getRowId?: (document: T) => string
  renderCell: (key: DocumentHistoryColumnKey, document: T) => ReactNode
  renderActions: (document: T) => ReactNode
  getCellValue?: (key: DocumentHistoryColumnKey, document: T) => string | number
  loadRows: (request: DocumentHistoryGridRequest) => Promise<DocumentHistoryGridResult<T>>
  loadFilterOptions: (field: DocumentHistoryColumnKey, search: string, gridSearch: string) => Promise<{ options: DocumentGridFilterOption[]; hasMore: boolean }>
  columnFilters: Record<string, string>
  onColumnFilterChange: (key: DocumentHistoryColumnKey, value: string) => void
  selectedDocuments: T[]
  onSelectionChange: (documents: T[]) => void
  onRowContextMenu: (document: T, position: Position) => void
  toolbarActions?: ReactNode
  sourceRevision?: string | number
  filterSourceRevision?: string | number
  onTotalChange?: (total: number) => void
  onSearchChange?: (search: string) => void
  onSelectionPendingChange?: (pending: boolean) => void
  selectionDisabled?: boolean
  highlightedDocumentId?: string | number | null
  highlightRow?: (document: T) => boolean
}
const SelectionHeaderContext = createContext({ checked: false, mixed: false, disabled: true, toggle: () => undefined as void })
function SelectionHeader() {
  const state = useContext(SelectionHeaderContext)
  return <DocumentGridCheckbox aria-label="Выбрать загруженные документы" title="Только загруженные документы, включая документы внутри групп" checked={state.checked} disabled={state.disabled}
    indeterminate={state.mixed} onChange={state.toggle} />
}
const GroupSelectionContext = createContext({ groups: new Map<string, DocumentGridGroupSelection>(), disabled: true, toggle: (_id: string) => undefined as void })
function GroupLabel({ data, node }: { data?: DocumentRow | DocumentHistoryGroupRow; node: { id?: string; key: string | null } }) {
  const selection = useContext(GroupSelectionContext)
  const label = isGroup(data) ? data.groupLabel : node.key
  const state = node.id ? selection.groups.get(node.id) : undefined
  const loaded = state?.loaded ?? 0, selected = state?.selected ?? 0
  return <span className="document-grid-group-label">
    <DocumentGridCheckbox className="document-grid-group-checkbox" aria-label={`Выбрать загруженные документы группы ${label ?? ''}`}
      title={loaded ? `Только загруженные документы группы: ${loaded}` : 'Раскройте группу, чтобы загрузить документы для выбора'}
      checked={loaded > 0 && selected === loaded} disabled={selection.disabled || !loaded}
      indeterminate={selected > 0 && selected < loaded}
      onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
      onChange={() => { if (node.id) selection.toggle(node.id) }} />
    <span>{label}</span>
  </span>
}
function isGroup<T extends DocumentRow>(row: T | DocumentHistoryGroupRow | undefined): row is DocumentHistoryGroupRow {
  return Boolean(row && '__group' in row && row.__group === true)
}

export function DocumentsHistoryGrid<T extends DocumentRow>(props: DocumentsHistoryGridProps<T>) {
  return <AgGridProvider modules={DOCUMENT_GRID_MODULES} licenseKey={import.meta.env.VITE_AG_GRID_LICENSE_KEY || undefined}>
    <DocumentGrid key={props.viewId} {...props} />
  </AgGridProvider>
}

function DocumentGrid<T extends DocumentRow>(props: DocumentsHistoryGridProps<T>) {
  type Row = T | DocumentHistoryGroupRow
  const current = useRef(props); current.current = props
  const [api, setApi] = useState<GridApi<Row> | null>(null)
  const apiRef = useRef<GridApi<Row> | null>(null)
  const rowRange = useRef<DocumentGridRowRangeState>({ anchorId: null, endId: null })
  const resetRowRange = useCallback(() => { rowRange.current = { anchorId: null, endId: null } }, [])
  const filterModel = useMemo(() => Object.fromEntries(props.columns.filter(column => props.columnFilters[column.key])
    .map(column => [column.key, { value: props.columnFilters[column.key] }])), [props.columns, props.columnFilters])
  const initialGridState = useRef({ filter: { filterModel } })
  const frame = useRef<HTMLDivElement>(null), popupColumn = useRef<string | null>(null)
  const [popupParent] = useState(() => typeof document === 'undefined' ? undefined : document.createElement('div'))
  useLayoutEffect(() => {
    if (!popupParent) return
    popupParent.className = 'document-grid-popup-layer'
    document.body.append(popupParent)
    return () => popupParent.remove()
  }, [popupParent])
  const [settings, setSettings] = useState<DocumentGridState>(() => readDocumentGridState(props.viewId, props.columns))
  const settingsRef = useRef(settings); settingsRef.current = settings
  const [initialSession] = useState(() => readDocumentGridSession(props.viewId))
  const positionScope = JSON.stringify([Object.entries(props.columnFilters).sort(([a], [b]) => a.localeCompare(b)),
    settings.columns.filter(column => column.rowGroup || column.sort).sort((a, b) => a.colId.localeCompare(b.colId)).map(column => [column.colId, Boolean(column.rowGroup), column.rowGroupIndex ?? null, column.sort ?? null, column.sortIndex ?? null]), props.highlightedDocumentId ?? null])
  const positionScopeRef = useRef(positionScope); positionScopeRef.current = positionScope
  const initialSearch = initialSession.scope === positionScope && props.highlightedDocumentId == null ? initialSession.search : ''
  const restoring = useRef(false), restoringSelection = useRef(false)
  const [settingsOpen, setSettingsOpen] = useState(false), [openColumnsRequest, setOpenColumnsRequest] = useState(0)
  const [groupMenu, setGroupMenu] = useState<ContextActionMenuState>(null)
  const [searchText, setSearchText] = useState(initialSearch), [search, setSearch] = useState(initialSearch)
  const [total, setTotal] = useState(0), [error, setError] = useState(''), [loading, setLoading] = useState(true)
  const [loadedRows, setLoadedRows] = useState<LoadedDocumentGridRow<T>[]>([])
  const [resolvedIdentity, setResolvedIdentity] = useState<string | null>(null)
  const [navigationHeight, setNavigationHeight] = useState(0)
  const requestGeneration = useRef(0), mounted = useRef(true)
  const inFlight = useRef({ generation: 0, count: 0 })
  const resultMotion = useGridResultMotion(frame)
  const pendingResultReveal = useRef<{ generation: number; scope: string } | null>(null)
  const searchRef = useRef(search); searchRef.current = search
  const identity = JSON.stringify([props.columnFilters, search, props.sourceRevision])
  useEffect(resetRowRange, [identity, positionScope, resetRowRange])
  const selectionPending = resolvedIdentity !== identity || Boolean(props.selectionDisabled)
  const selectionPendingRef = useRef(selectionPending); selectionPendingRef.current = selectionPending
  const identityRef = useRef(identity)
  const requestScopeRef = useRef(positionScope)
  if (identityRef.current !== identity || requestScopeRef.current !== positionScope) {
    identityRef.current = identity; requestScopeRef.current = positionScope; requestGeneration.current++
  }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; requestGeneration.current++ } }, [])
  useEffect(() => { const timer = setTimeout(() => setSearch(searchText.trim()), 250); return () => clearTimeout(timer) }, [searchText])
  useEffect(() => { props.onSearchChange?.(search) }, [search])
  useEffect(() => { current.current.onSelectionPendingChange?.(selectionPending) }, [selectionPending])
  useEffect(() => {
    const navigation = document.querySelector<HTMLElement>('[data-documents-navigation]')
    if (!navigation) return
    let previousHeight = 0
    const measure = () => {
      const nextHeight = Math.ceil(navigation.getBoundingClientRect().height)
      const frameTop = frame.current?.getBoundingClientRect().top
      if (previousHeight && frameTop != null && Math.abs(frameTop - previousHeight) <= 1 && previousHeight !== nextHeight) window.scrollBy({ top: previousHeight - nextHeight, behavior: 'instant' })
      previousHeight = nextHeight; setNavigationHeight(nextHeight)
    }
    measure()
    const observer = new ResizeObserver(measure); observer.observe(navigation)
    window.addEventListener('resize', measure)
    return () => { observer.disconnect(); window.removeEventListener('resize', measure) }
  }, [])
  useEffect(() => {
    const viewport = frame.current?.querySelector<HTMLElement>('.ag-grid-viewport')
    if (!viewport) return
    // At the bottom, a further downward wheel must not move the page header
    // underneath the sticky navigation. Upward movement at the top can still
    // return to the page heading using native scroll chaining.
    const direction = (event: WheelEvent) => { viewport.style.overscrollBehaviorY = event.deltaY < 0 && viewport.scrollTop <= 0 ? 'auto' : 'contain' }
    viewport.style.overscrollBehaviorY = 'contain'
    viewport.addEventListener('wheel', direction, { capture: true, passive: true })
    return () => { viewport.removeEventListener('wheel', direction, true) }
  }, [api])
  useJournalPageScroll(frame, navigationHeight)
  const focus = useDocumentGridFocus(api, frame)
  const requests = useRef(new Map<string, Promise<DocumentHistoryGridResult<T>>>())
  const fetchRows = useCallback((request: DocumentHistoryGridRequest) => {
    const generation = requestGeneration.current, key = JSON.stringify([generation, request.startRow, request.endRow, request.rowGroupCols, request.groupKeys, request.sortModel, request.search, request.selectedIds])
    const existing = requests.current.get(key)
    if (existing) return existing
    if (inFlight.current.generation !== generation) inFlight.current = { generation, count: 0 }
    inFlight.current.count++
    if (mounted.current) { setLoading(true); setError('') }
    const promise = current.current.loadRows(request).then(result => {
      if (!mounted.current || generation !== requestGeneration.current) throw new Error('Stale grid request')
      const previous = current.current.selectedDocuments
      const next = reconcileDocumentGridSelection(previous, result.matchingSelectedIds, result.rows.filter((row): row is T => !isGroup(row)), request.selectedIds)
      if (next.length !== previous.length || next.some((row, index) => row !== previous[index])) current.current.onSelectionChange(next)
      setResolvedIdentity(identityRef.current)
      setTotal(result.total); current.current.onTotalChange?.(result.total)
      return result
    }).catch(failure => {
      if (mounted.current && generation === requestGeneration.current) setError(documentGridErrorMessage(failure))
      throw failure
    }).finally(() => {
      requests.current.delete(key)
      if (!mounted.current || generation !== requestGeneration.current || inFlight.current.generation !== generation) return
      inFlight.current.count = Math.max(0, inFlight.current.count - 1)
      setLoading(inFlight.current.count > 0)
    })
    requests.current.set(key, promise)
    return promise
  }, [])
  const rowId = useCallback((row: Row) => isGroup(row) ? row.id : `document:${current.current.getRowId?.(row) ?? row.id}`, [])
  const loadPositionBlock = useCallback((route: string[], startRow: number) => {
    const columns = apiRef.current?.getColumnState() ?? settingsRef.current.columns
    return fetchRows({ startRow, endRow: startRow + 100, groupKeys: route,
      rowGroupCols: columns.filter(column => column.rowGroup).sort((a, b) => (a.rowGroupIndex ?? 0) - (b.rowGroupIndex ?? 0)).map(column => column.colId),
      sortModel: columns.filter(column => column.sort).sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0)).map(column => ({ colId: column.colId, sort: column.sort! })),
      search: searchRef.current, selectedIds: current.current.selectedDocuments.map(row => row.id),
    })
  }, [fetchRows])
  const position = useDocumentGridSession(api, frame, props.viewId, positionScope, search, initialSession, props.highlightedDocumentId != null, { load: loadPositionBlock, getRowId: rowId })
  const positionRef = useRef(position); positionRef.current = position

  const saveSettings = useCallback((next: DocumentGridState) => {
    settingsRef.current = next; setSettings(next); writeDocumentGridState(current.current.viewId, next)
  }, [])
  const captureColumns = useCallback(() => {
    const grid = apiRef.current
    if (!grid || grid.isDestroyed() || restoring.current) return
    const known = new Set(current.current.columns.map(column => column.key as string))
    const columns = grid.getColumnState().filter(column => known.has(column.colId))
    if (JSON.stringify(columns) !== JSON.stringify(settingsRef.current.columns)) saveSettings({ ...settingsRef.current, columns })
  }, [saveSettings])
  const getLoadedRows = useCallback(() => {
    const rows: T[] = [], grid = apiRef.current
    if (grid && !grid.isDestroyed()) grid.forEachNode(node => { if (node.data && !node.group && !isGroup(node.data)) rows.push(node.data) })
    return rows
  }, [])
  const selectRowRange = useCallback((id: string, metaKey: boolean) => {
    const grid = apiRef.current
    if (!mounted.current || !grid || grid.isDestroyed() || selectionPendingRef.current) return
    const nodes: IRowNode<Row>[] = []
    grid.forEachNode(node => nodes.push(node))
    const result = selectDocumentGridRowRange({ nodes, selected: current.current.selectedDocuments, state: rowRange.current, targetId: id, metaKey })
    rowRange.current = result.state
    current.current.onSelectionChange(result.selected.filter((row): row is T => !isGroup(row)))
  }, [])
  const selectionSyncFrame = useRef(0)
  useEffect(() => () => { cancelAnimationFrame(selectionSyncFrame.current); selectionSyncFrame.current = 0 }, [])
  const syncSelection = useCallback(() => {
    cancelAnimationFrame(selectionSyncFrame.current); selectionSyncFrame.current = 0
    const grid = apiRef.current
    if (!grid || grid.isDestroyed()) return
    const selected = new Set(current.current.selectedDocuments.map(row => String(row.id)))
    restoringSelection.current = true
    try {
      const select: IRowNode<Row>[] = [], deselect: IRowNode<Row>[] = [], loaded: LoadedDocumentGridRow<T>[] = []
      grid.forEachNode(node => {
        if (!node.data || node.group || isGroup(node.data)) return
        const groupIds: string[] = []
        for (let parent = node.parent; parent && parent.level >= 0; parent = parent.parent) if (parent.group && parent.id) groupIds.push(parent.id)
        loaded.push({ document: node.data, groupIds })
        const value = selected.has(String(node.data.id))
        if (node.isSelected() !== value) (value ? select : deselect).push(node)
      })
      if (select.length) grid.setNodesSelected({ nodes: select, newValue: true, source: 'api' })
      if (deselect.length) grid.setNodesSelected({ nodes: deselect, newValue: false, source: 'api' })
      setLoadedRows(previous => previous.length === loaded.length && previous.every((row, index) => row.document === loaded[index].document
        && row.groupIds.length === loaded[index].groupIds.length && row.groupIds.every((id, level) => id === loaded[index].groupIds[level])) ? previous : loaded)
    }
    finally { restoringSelection.current = false }
  }, [])
  const scheduleSelectionSync = useCallback(() => {
    // SSRM can publish several model changes for one block and complete two
    // blocks in the same frame. Traverse cached leaves/ancestors only once.
    if (!selectionSyncFrame.current) selectionSyncFrame.current = requestAnimationFrame(syncSelection)
  }, [syncSelection])
  useEffect(() => { syncSelection() }, [props.selectedDocuments, syncSelection])
  const toggleLoaded = useCallback(() => {
    if (selectionPendingRef.current) return
    resetRowRange()
    current.current.onSelectionChange(toggleLoadedDocumentGridSelection(current.current.selectedDocuments, getLoadedRows()))
  }, [getLoadedRows, resetRowRange])
  const toggleGroup = useCallback((id: string) => {
    const grid = apiRef.current
    if (selectionPendingRef.current || !grid || grid.isDestroyed()) return
    resetRowRange()
    const loaded: T[] = []
    grid.forEachNode(node => {
      if (!node.data || node.group || isGroup(node.data)) return
      for (let parent = node.parent; parent && parent.level >= 0; parent = parent.parent) {
        if (parent.id === id) { loaded.push(node.data); break }
      }
    })
    if (loaded.length) current.current.onSelectionChange(toggleLoadedDocumentGridSelection(current.current.selectedDocuments, loaded))
  }, [resetRowRange])
  const datasource = useMemo<IServerSideDatasource<Row>>(() => ({
    getRows: params => {
      const generation = requestGeneration.current, scope = positionScopeRef.current
      const reveal = pendingResultReveal.current
      const request: DocumentHistoryGridRequest = {
        startRow: params.request.startRow ?? 0, endRow: params.request.endRow ?? 100,
        rowGroupCols: params.request.rowGroupCols.map(column => column.id), groupKeys: params.request.groupKeys,
        sortModel: params.request.sortModel.map(item => ({ colId: item.colId, sort: item.sort })),
        search: searchRef.current, selectedIds: current.current.selectedDocuments.map(row => row.id),
      }
      void fetchRows(request).then(result => {
        if (!mounted.current || generation !== requestGeneration.current || scope !== positionScopeRef.current) { params.fail(); return }
        positionRef.current.rememberRows(request.groupKeys, request.startRow, result.rows)
        params.success({ rowData: result.rows, rowCount: result.rowCount })
        if (reveal && pendingResultReveal.current === reveal && !request.groupKeys.length
          && reveal.generation === generation && reveal.scope === scope) {
          pendingResultReveal.current = null
          // Publish data immediately; only the first ready root block of a new
          // filter/search/sort/group scope gets the short visual transition.
          resultMotion.reveal()
        }
        scheduleSelectionSync()
      }).catch(() => params.fail())
    },
  }), [fetchRows, scheduleSelectionSync, resultMotion.reveal])
  const firstIdentity = useRef(identity)
  const firstScope = useRef(positionScope)
  useEffect(() => {
    if (!api || api.isDestroyed() || firstIdentity.current === identity && firstScope.current === positionScope) return
    const reload = firstIdentity.current !== identity
    firstIdentity.current = identity
    firstScope.current = positionScope
    resultMotion.cancel()
    pendingResultReveal.current = { generation: requestGeneration.current, scope: positionScope }
    // Sorting/grouping already reloads SSRM through AG's native change event.
    // Filters/search/source changes keep their single existing reload path.
    if (!reload) return
    const applied = api.getFilterModel()
    const changed = Object.keys(applied).length !== Object.keys(filterModel).length
      || Object.entries(filterModel).some(([key, model]) => JSON.stringify(applied[key]) !== JSON.stringify(model))
    // Updating the model supplies AG's native filter indicator and one SSRM
    // reload. Keep the current popup/header alive for multiple choices.
    if (changed) api.setFilterModel(filterModel)
    else api.refreshServerSide({ purge: true })
  }, [api, identity, positionScope, filterModel, resultMotion.cancel])

  const defaultColDef = useMemo<ColDef<Row>>(() => ({ sortable: true, resizable: true, suppressHeaderMenuButton: true, suppressMovable: false, lockPinned: true, wrapHeaderText: true }), [])
  const columnDefs = useMemo<ColDef<Row>[]>(() => [
    ...props.columns.map(column => ({
      colId: column.key, headerName: column.label, initialWidth: Math.max(column.minWidth, column.key === 'title' ? 320 : 130), minWidth: column.key === 'title' ? 180 : column.key === 'rowCount' ? column.minWidth : 90, maxWidth: 1600,
      lockVisible: Boolean(column.required),
      initialHide: !column.required && !props.initialVisibleColumnKeys.includes(column.key), initialPinned: column.key === 'title' ? 'left' as const : undefined,
      enableRowGroup: DOCUMENT_GRID_GROUP_FIELDS.has(column.key), filter: DOCUMENT_HISTORY_SERVER_FILTER,
      headerComponentParams: { innerHeaderComponent: JournalColumnHeading },
      valueGetter: params => {
        if (!params.data) return ''
        if (isGroup(params.data)) return params.data.groupKey
        if (current.current.getCellValue) return current.current.getCellValue(column.key, params.data)
        const row = params.data as unknown as Record<string, unknown>
        const aliases: Partial<Record<DocumentHistoryColumnKey, string>> = { project: 'projects', subtitle: 'subtitleCodes', line: 'lines', method: 'methodCode' }
        const value = row[aliases[column.key] ?? column.key]
        return Array.isArray(value) ? value.join(', ') : value ?? ''
      },
      cellRenderer: (params: { data?: Row; node: { group: boolean; id?: string } }) => !params.data || params.node.group || isGroup(params.data) ? null
        : <div className={`document-grid-cell ${column.align === 'end' ? 'is-numeric' : ''}`} onDoubleClick={event => event.stopPropagation()}>
          {current.current.renderCell(column.key, params.data)}</div>,
      tooltipValueGetter: params => params.node?.group || isGroup(params.data) ? '' : String(params.value ?? ''),
    } satisfies ColDef<Row>)),
    { colId: '__actions', headerName: 'Действия', width: 205, minWidth: 205, maxWidth: 205, resizable: false, pinned: 'right', lockPinned: true, sortable: false, filter: false, suppressMovable: true,
      cellRenderer: (params: { data?: Row; node: { group: boolean } }) => !params.data || params.node.group || isGroup(params.data) ? null : <div className="document-grid-actions" onDoubleClick={event => event.stopPropagation()}>{current.current.renderActions(params.data)}</div> },
  ], [props.columns, props.initialVisibleColumnKeys])
  const selection = useMemo<RowSelectionOptions<Row>>(() => ({ mode: 'multiRow', headerCheckbox: false, enableClickSelection: false,
    isRowSelectable: node => Boolean(node.data && !node.group && !isGroup(node.data)), checkboxes: params => !params.node.group,
  }), [])
  const selectedSet = useMemo(() => new Set(props.selectedDocuments.map(row => String(row.id))), [props.selectedDocuments])
  const selectedLoaded = loadedRows.filter(row => selectedSet.has(String(row.document.id))).length
  const groupSelection = useMemo(() => ({ groups: documentGridGroupSelection(loadedRows, selectedSet), disabled: selectionPending, toggle: toggleGroup }), [loadedRows, selectedSet, selectionPending, toggleGroup])
  const groupings = settings.columns.filter(column => column.rowGroup).sort((a, b) => (a.rowGroupIndex ?? 0) - (b.rowGroupIndex ?? 0))
  const changeAppearance = (appearance: DocumentGridAppearance) => saveSettings({ ...settingsRef.current, appearance })
  const changeColumnVisible = (key: DocumentHistoryColumnKey, visible: boolean) => {
    const columns = api?.getColumnState().filter(column => props.columns.some(item => item.key === column.colId)) ?? settingsRef.current.columns
    const next = columns.some(column => column.colId === key) ? columns.map(column => column.colId === key ? { ...column, hide: !visible } : column) : [...columns, { colId: key, hide: !visible }]
    restoring.current = true
    saveSettings({ ...settingsRef.current, columns: next })
    api?.setColumnsVisible([key], visible)
    restoring.current = false
  }
  const resetColumns = () => {
    if (!api) return
    restoring.current = true
    api.resetColumnState()
    api.applyColumnState({ state: props.columns.map(column => ({ colId: column.key, hide: false, rowGroup: false, rowGroupIndex: null, sort: null, sortIndex: null, pinned: column.key === 'title' ? 'left' as const : null })) })
    restoring.current = false; captureColumns()
  }
  const clearFilters = () => { setSearchText(''); setSearch(''); for (const key of Object.keys(props.columnFilters)) props.onColumnFilterChange(key as DocumentHistoryColumnKey, '') }
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || isModalDialogOpen() || isContextActionMenuOpen() || settingsOpen) return
      const popup = popupParent?.querySelector('.ag-popup') ?? frame.current?.querySelector('.ag-popup')
      if (popup) { event.preventDefault(); event.stopImmediatePropagation(); apiRef.current?.hideColumnFilter(); apiRef.current?.hidePopupMenu(); if (popupColumn.current) apiRef.current?.setFocusedHeader(popupColumn.current); return }
      // Preserve the established order: first the top surface, then selection, then filters/search.
      if (!current.current.selectedDocuments.length && (searchText || search)) {
        event.preventDefault(); event.stopImmediatePropagation(); setSearchText(''); setSearch('')
      }
    }
    window.addEventListener('keydown', escape, true)
    return () => window.removeEventListener('keydown', escape, true)
  }, [settingsOpen, searchText, search, popupParent])
  const applyView = (id: string) => {
    const view = settings.views.find(view => view.id === id)
    if (!view || !api) return
    const keys = new Set([...Object.keys(props.columnFilters), ...Object.keys(view.filters)])
    for (const key of keys) {
      const value = view.filters[key] ?? ''
      // The parent also uses this callback to leave an explicit document link.
      if (props.highlightedDocumentId != null || value !== (props.columnFilters[key] ?? '')) props.onColumnFilterChange(key as DocumentHistoryColumnKey, value)
    }
    setSearchText(view.search); setSearch(view.search)
    // Native state has service fields that stored views omit. Reapplying an
    // equivalent sort/group state can rebuild SSRM and reset the viewport.
    const columns = normalizeDocumentGridColumns(api.getColumnState(), props.columns)
    if (JSON.stringify(columns) !== JSON.stringify(normalizeDocumentGridColumns(view.columns, props.columns))) {
      restoring.current = true; api.applyColumnState({ state: view.columns, applyOrder: true }); restoring.current = false
    }
    saveSettings({ ...settings, columns: view.columns, appearance: view.appearance }); setSettingsOpen(false)
  }
  const getColumnMenuItems = ({ column }: GetColumnMenuItemsParams<Row>): Array<DefaultMenuItem | MenuItemDef<Row>> => {
    const items: Array<DefaultMenuItem | MenuItemDef<Row>> = []
    if (column?.isSortable()) items.push('sortAscending', 'sortDescending', 'sortUnSort', 'separator')
    if (column && !column.getColId().startsWith('ag-Grid-SelectionColumn') && column.getColId() !== '__actions') items.push('pinSubMenu', 'separator', 'autoSizeThis')
    items.push('autoSizeAll')
    const definition = props.columns.find(item => item.key === column?.getColId())
    if (definition && !definition.required) items.push('separator', { name: 'Скрыть столбец', icon: '<span class="ag-icon ag-icon-eye-slash" aria-hidden="true"></span>', action: () => changeColumnVisible(definition.key, false) })
    if (column?.getColDef().enableRowGroup) items.push('separator', column.isRowGroupActive() ? 'rowUnGroup' : 'rowGroup')
    items.push('separator', { name: 'Выбрать столбцы', icon: '<span class="ag-icon ag-icon-columns" aria-hidden="true"></span>', action: () => setOpenColumnsRequest(value => value + 1) },
      { name: 'Сбросить столбцы', icon: '<span class="ag-icon ag-icon-cancel" aria-hidden="true"></span>', action: resetColumns })
    return items
  }
  const copyCells = useCallback(() => {
    if (!api || api.isDestroyed()) return
    const text = documentGridClipboardText(api, current.current.columns.map(column => column.key), (key, row) => {
      if (isGroup(row)) return ''
      return current.current.getCellValue?.(key as DocumentHistoryColumnKey, row) ?? String((row as Record<string, unknown>)[key] ?? '')
    })
    if (text) void navigator.clipboard.writeText(text).catch(() => setError('Не удалось скопировать ячейки. Разрешите доступ к буферу обмена и повторите.'))
  }, [api])
  const openGroupMenu = (node: IRowNode<Row>, anchor: Element, x: number, y: number) => {
    if (!api || api.isDestroyed() || !node.group || !isGroup(node.data)) return
    const focusGroup = (target: IRowNode<Row>) => {
      const column = api.getAllDisplayedColumns()[0]
      if (column && target.rowIndex != null) api.setFocusedCell(target.rowIndex, column)
      focus.remember()
    }
    const expand = (expanded: boolean, all = false) => {
      if (api.isDestroyed()) return
      let target = node
      if (all && !expanded) while (target.parent && target.parent.level >= 0) target = target.parent
    // A group command must neither
      // fetch groups outside the current cache.
      if (all) {
        const groups: IRowNode<Row>[] = []
        api.forEachNode(candidate => { if (candidate.group) groups.push(candidate) })
        groups.sort((left, right) => expanded ? left.level - right.level : right.level - left.level)
        groups.forEach(candidate => candidate.setExpanded(expanded, undefined, true))
      }
      else node.setExpanded(expanded, undefined, true)
      focusGroup(target)
    }
    focusGroup(node)
    setGroupMenu({ x, y, anchorElement: anchor, heading: `Группа: ${node.data.groupLabel}`,
      description: 'Группировка всего реестра. Общие команды раскрывают только загруженные группы.', items: [
        { id: 'group-collapse', label: 'Свернуть', icon: ChevronUp, disabled: !node.expanded, onSelect: () => expand(false) },
        { id: 'group-expand', label: 'Развернуть', icon: ChevronDown, disabled: Boolean(node.expanded), onSelect: () => expand(true) },
        { type: 'separator', id: 'group-all-separator' },
        { id: 'group-collapse-all', label: 'Свернуть все', icon: ChevronsUp, onSelect: () => expand(false, true) },
        { id: 'group-expand-all', label: 'Развернуть все', icon: ChevronsDown, onSelect: () => expand(true, true) },
      ] })
  }
  const openDocumentMenu = (node: IRowNode<Row>, anchor: Element, x: number, y: number) => {
    if (selectionPendingRef.current || !node.data || node.group || isGroup(node.data)) return
    if (node.rowIndex != null) api?.setFocusedCell(node.rowIndex, anchor.closest('.ag-cell')?.getAttribute('col-id') ?? 'title')
    focus.remember()
    current.current.onRowContextMenu(node.data, { x, y, clientX: x, clientY: y, anchorElement: anchor, copyCells })
  }
  const filterContext = useMemo(() => ({ viewId: props.viewId, search, columnFilters: props.columnFilters,
    sourceRevision: props.filterSourceRevision ?? props.sourceRevision,
    loadOptions: (field: DocumentHistoryColumnKey, value: string, registrySearch: string) => current.current.loadFilterOptions(field, value, registrySearch),
    change: (field: DocumentHistoryColumnKey, value: string) => current.current.onColumnFilterChange(field, value),
  }), [props.viewId, search, props.columnFilters, props.filterSourceRevision, props.sourceRevision])
  const selectionColumn = useMemo<SelectionColumnDef>(() => ({ pinned: 'left', lockPinned: true, width: 46, minWidth: 46, maxWidth: 46,
    resizable: false, suppressMovable: true, suppressHeaderMenuButton: true, headerComponent: SelectionHeader }), [])
  const groupRenderer = useMemo(() => ({ suppressCount: false, innerRenderer: GroupLabel }), [])
  const rowClassRules = useMemo(() => ({ 'document-grid-highlight': (params: { data?: Row }) => Boolean(params.data && !isGroup(params.data) && (current.current.highlightRow?.(params.data) || String(params.data.id) === String(current.current.highlightedDocumentId))) }), [])
  return <DocumentGridFilterContext.Provider value={filterContext}><GroupSelectionContext.Provider value={groupSelection}><SelectionHeaderContext.Provider value={{ checked: loadedRows.length > 0 && selectedLoaded === loadedRows.length, mixed: selectedLoaded > 0 && selectedLoaded < loadedRows.length, disabled: selectionPending || !loadedRows.length, toggle: toggleLoaded }}>
    <div data-document-history-grid={props.viewId} onContextMenuCapture={event => event.preventDefault()} className={`document-history-grid ${settings.appearance.wrapText ? 'document-grid-wrap' : ''} ${settings.appearance.stripes ? 'document-grid-stripes' : ''} ${settings.appearance.verticalLines ? 'document-grid-lines' : ''}`}>
      <DocumentsGridToolbar columns={props.columns}
        filteredColumnKeys={new Set(Object.keys(props.columnFilters).filter(key => Boolean(props.columnFilters[key])))}
        visibleColumnKeys={new Set(props.columns.filter(column => column.required || !(settings.columns.find(item => item.colId === column.key)?.hide ?? !props.initialVisibleColumnKeys.includes(column.key))).map(column => column.key))}
        onColumnVisibilityChange={changeColumnVisible}
        onShowAllColumns={() => { api?.setColumnsVisible(props.columns.map(column => column.key), true); captureColumns() }}
        appearance={settings.appearance} onAppearanceChange={changeAppearance} onResetColumns={resetColumns}
        savedViews={settings.views}
        onSaveView={name => {
          const title = name.trim()
          if (!title) return false
          const existing = settingsRef.current.views.find(view => view.name.toLocaleLowerCase('ru') === title.toLocaleLowerCase('ru'))
          const snapshot = { id: existing?.id ?? crypto.randomUUID(), name: title,
            columns: api?.getColumnState().filter(column => props.columns.some(item => item.key === column.colId)) ?? [],
            appearance: { ...settingsRef.current.appearance }, filters: { ...props.columnFilters }, search }
          saveSettings({ ...settingsRef.current, views: existing ? settingsRef.current.views.map(view => view.id === existing.id ? snapshot : view) : [...settingsRef.current.views, snapshot] })
          return true
        }}
        onApplyView={applyView} onDeleteView={id => saveSettings({ ...settingsRef.current, views: settingsRef.current.views.filter(item => item.id !== id) })}
        search={searchText} onSearchChange={setSearchText}
        groupingControls={<JournalGroupingControls scope="documents" groups={groupings.map(group => ({ id: group.colId, label: props.columns.find(column => column.key === group.colId)?.label ?? group.colId }))}
          onChange={ids => api?.setRowGroupColumns(ids)} />}
        actions={props.toolbarActions} actionsDisabled={selectionPending}
        hasFilters={Object.values(props.columnFilters).some(Boolean) || Boolean(search)} onClearFilters={clearFilters}
        settingsOpen={settingsOpen} onSettingsOpenChange={setSettingsOpen} openColumnsRequest={openColumnsRequest} />
      {error ? <div role="alert" className="document-grid-error">{error}<button type="button" onClick={() => api?.refreshServerSide({ purge: true })}>Повторить</button></div> : null}
      <div ref={frame} className={`document-grid-frame grid-result-motion journal-grid-frame journal-theme-${settings.appearance.theme}`} style={{ height: `calc(100dvh - ${navigationHeight + 72}px)` }}
      onClickCapture={event => {
        if (!(event.target instanceof Element) || !event.target.closest('.ag-selection-checkbox')) return
        const element = event.target.closest<HTMLElement>('.ag-row[row-index]')
        const node = element ? api?.getDisplayedRowAtIndex(Number(element.getAttribute('row-index'))) : undefined
        if (!node?.id || !node.data || node.group || isGroup(node.data)) return
        if (selectionPendingRef.current) { event.preventDefault(); event.stopPropagation(); return }
        if (event.shiftKey) {
          event.preventDefault(); event.stopPropagation()
          const id = node.id, meta = event.metaKey || event.ctrlKey
          // A cancelled checkbox click restores its old checked value after
          // propagation. Apply AG selection after that native rollback.
          setTimeout(() => selectRowRange(id, meta), 0)
        }
        else rowRange.current = { anchorId: node.id, endId: null }
      }} onContextMenu={event => {
        if (!(event.target instanceof Element)) return
        const group = event.target.closest<HTMLElement>('.ag-full-width-row.ag-row-group')
        const cell = event.target.closest<HTMLElement>('.ag-cell')
        const row = group ?? cell?.closest<HTMLElement>('[row-index]')
        const node = row ? api?.getDisplayedRowAtIndex(Number(row.getAttribute('row-index'))) : undefined
        if (!node) return
        if (group) openGroupMenu(node, group, event.clientX, event.clientY)
        else if (cell) openDocumentMenu(node, cell, event.clientX, event.clientY)
      }} onKeyDownCapture={event => {
        if (isModalDialogOpen() || isContextActionMenuOpen()) return
        if (!(event.target instanceof Element)) return
        if (event.target.closest('.ag-menu, .ag-popup')) {
          if (event.key === 'Escape') {
            event.preventDefault(); event.stopPropagation(); api?.hideColumnFilter(); api?.hidePopupMenu()
            if (popupColumn.current) api?.setFocusedHeader(popupColumn.current)
          }
          return
        }
        const group = event.target.closest<HTMLElement>('.ag-full-width-row.ag-row-group')
        const cell = event.target.closest<HTMLElement>('.ag-cell')
        const row = group ?? cell?.closest<HTMLElement>('[row-index]')
        const node = row ? api?.getDisplayedRowAtIndex(Number(row.getAttribute('row-index'))) : undefined
        const colId = cell?.getAttribute('col-id')
        const header = event.target.closest<HTMLElement>('.ag-header-cell')
        if (event.key === ' ' && cell && node?.id && !node.group && node.data && !isGroup(node.data)
          && !event.target.closest('button, a, input:not([type=checkbox]), textarea, [contenteditable=true]')) {
          if (selectionPendingRef.current) { event.preventDefault(); event.stopPropagation(); return }
          if (event.shiftKey) { event.preventDefault(); event.stopPropagation(); selectRowRange(node.id, event.metaKey || event.ctrlKey); return }
          rowRange.current = { anchorId: node.id, endId: null }
        }
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c'
          && !event.target.closest('input:not([type=checkbox]), textarea, [contenteditable=true]')
          && (cell || group || header)) {
          event.preventDefault(); event.stopPropagation(); copyCells(); return
        }
        if (header && (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10')) {
          const column = header.getAttribute('col-id')
          if (column) { event.preventDefault(); event.stopPropagation(); popupColumn.current = column; api?.showColumnMenu(column) }
          return
        }
        if (node && (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10')) {
          event.preventDefault(); event.stopPropagation()
          const anchor = group ?? cell!, rect = anchor.getBoundingClientRect()
          if (group) openGroupMenu(node, anchor, rect.left, rect.bottom)
          else openDocumentMenu(node, anchor, rect.left, rect.bottom)
          return
        }
        if (cell && colId === '__actions' && event.key === 'Tab') {
          const buttons = [...cell.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
          const index = buttons.indexOf(event.target as HTMLButtonElement) + (event.shiftKey ? -1 : 1)
          if (index >= 0 && index < buttons.length) { event.preventDefault(); event.stopPropagation(); buttons[index].focus({ preventScroll: true }); return }
        }
        if (group && event.target.matches('.document-grid-group-checkbox') && event.key === ' ') { event.stopPropagation(); return }
        if (['Enter', 'F2'].includes(event.key)) {
          const headerCheckbox = event.target.closest('.ag-header-cell')?.querySelector<HTMLInputElement>('input[type=checkbox]')
          if (headerCheckbox) { event.preventDefault(); event.stopPropagation(); if (!headerCheckbox.disabled) headerCheckbox.click(); return }
          if (group && node) {
            event.preventDefault(); event.stopPropagation()
            const checkbox = event.target.closest<HTMLInputElement>('.document-grid-group-checkbox')
            if (checkbox) { if (!checkbox.disabled) checkbox.click(); return }
            const column = api?.getAllDisplayedColumns()[0]
            if (column && node.rowIndex != null) api?.setFocusedCell(node.rowIndex, column)
            node.setExpanded(!node.expanded, event.nativeEvent, true); return
          }
          if (cell && colId && node?.data && !node.stub) {
            event.preventDefault(); event.stopPropagation()
            if (selectionPendingRef.current) return
            const control = (event.target.closest('button, input[type=checkbox]') ?? cell.querySelector(colId === 'title' ? '[data-document-title-button]:not(:disabled)' : 'button:not(:disabled), input[type=checkbox]:not(:disabled)')) as HTMLElement | null
            if (node.rowIndex != null) api?.setFocusedCell(node.rowIndex, colId)
            focus.remember()
            if (control && !control.matches(':disabled')) control.click()
            return
          }
        }
        if (cell && colId && node?.rowIndex != null && event.key.startsWith('Arrow')) api?.setFocusedCell(node.rowIndex, colId)
      }}>
        <AgGridReact<Row> rowModelType="serverSide" serverSideDatasource={datasource} columnDefs={columnDefs}
          initialState={initialGridState.current}
          theme={DOCUMENT_GRID_THEMES[settings.appearance.theme]} localeText={DOCUMENT_GRID_LOCALE}
          defaultColDef={defaultColDef}
          getRowId={params => rowId(params.data)}
          getChildCount={data => isGroup(data) ? data.childCount : 0}
          // Keep the mirrored scrollbar measurable while a restored group grows
          // from its root rows to its loaded children; hidden geometry clamps it.
          alwaysShowVerticalScroll
          cacheBlockSize={100} maxBlocksInCache={5} maxConcurrentDatasourceRequests={2} blockLoadDebounceMillis={80} purgeClosedRowNodes
          serverSideInitialRowCount={position.initialRowCount}
          serverSideSortAllLevels serverSideEnableClientSideSort={false} suppressAggFuncInHeader suppressGroupChangesColumnVisibility
          groupDisplayType="groupRows" groupDefaultExpanded={0}
          isServerSideGroupOpenByDefault={params => position.isGroupOpen(params.rowNode)}
          groupRowRendererParams={groupRenderer}
          rowSelection={selection} selectionColumnDef={selectionColumn}
          rowHeight={documentGridRowHeight(settings.appearance)}
          headerHeight={56} rowBuffer={6} suppressScrollOnNewData suppressDragLeaveHidesColumns maintainColumnOrder enableFilterHandlers preventDefaultOnContextMenu
          cellSelection={CELL_SELECTION} rowClassRules={rowClassRules} getRowClass={({ node }) => node.group ? `journal-group-tone-${node.level % 4}` : undefined}
          onGridReady={event => {
            apiRef.current = event.api
            restoring.current = true
            if (settingsRef.current.columns.length) event.api.applyColumnState({ state: settingsRef.current.columns, applyOrder: true })
            restoring.current = false; setApi(event.api); captureColumns()
          }}
          onModelUpdated={() => {
            scheduleSelectionSync(); position.restore()
          }}
          onFirstDataRendered={position.restore} onBodyScrollEnd={position.bodyScrollEnd} onGridPreDestroyed={position.capture}
          onRowGroupOpened={event => position.groupOpened(event.node)} onCellFocused={focus.remember}
          onSelectionChanged={event => {
            if (restoringSelection.current || event.source === 'rowDataChanged' || event.source.startsWith('api')) return
            if (selectionPendingRef.current) { syncSelection(); return }
            const selected = new Set((event.selectedNodes ?? []).flatMap(node => node.data && !node.group && !isGroup(node.data) ? [String(node.data.id)] : []))
            current.current.onSelectionChange(mergeLoadedDocumentGridSelection(current.current.selectedDocuments, getLoadedRows(), selected))
          }}
          onColumnMoved={event => { if (event.finished) captureColumns() }} onColumnResized={event => { if (event.finished) captureColumns() }}
          onColumnPinned={captureColumns} onColumnVisible={captureColumns} onColumnRowGroupChanged={captureColumns}
          onSortChanged={captureColumns}
          getColumnMenuItems={getColumnMenuItems}
          onColumnMenuVisibleChanged={event => { if (event.visible) popupColumn.current = event.column?.getColId() ?? null }}
          onFilterOpened={event => { popupColumn.current = event.column.getId() }}
          postProcessPopup={positionGridPopup}
          popupParent={popupParent}
        />
      </div>
      <ContextActionMenu menu={groupMenu} panelClassName="journal-context-menu" autoFocus onClose={() => { setGroupMenu(null); requestAnimationFrame(focus.restore) }} />
      <div className="document-grid-footer" aria-live="polite"><span>Найдено: {total}</span><span>Загружено: {loadedRows.length}</span><span>Выбрано: {props.selectedDocuments.length}</span>{loading ? <span>Загрузка…</span> : null}
        {props.selectedDocuments.length ? <button type="button" onClick={() => { resetRowRange(); props.onSelectionChange([]) }}>Снять выбор</button> : null}
      </div>
    </div>
  </SelectionHeaderContext.Provider></GroupSelectionContext.Provider></DocumentGridFilterContext.Provider>
}
