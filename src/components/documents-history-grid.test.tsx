import { StrictMode, useEffect, useState, type ComponentType } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ColDef, ColumnState, FilterModel, IRowNode, IServerSideDatasource, IServerSideGetRowsParams, SelectionChangedEvent } from 'ag-grid-community'
import { DocumentsHistoryGrid, type DocumentsHistoryGridProps } from './documents-history-grid'
import type { DocumentHistoryGridResult, DocumentHistoryGroupRow } from '@/lib/document-history-grid'
import { DOCUMENT_GRID_DEFAULT_APPEARANCE, normalizeDocumentGridColumns, writeDocumentGridState } from '@/lib/document-history-grid-state'

const grid = vi.hoisted(() => ({ props: null as unknown as { serverSideDatasource: IServerSideDatasource; onGridReady: (event: { api: unknown }) => void; alwaysShowVerticalScroll: boolean; defaultColDef: unknown; initialState: { filter: { filterModel: FilterModel } }; columnDefs: ColDef[]; onModelUpdated: () => void; onSortChanged: (event: { source: string }) => void; onRowGroupOpened: (event: { node: IRowNode<Row | DocumentHistoryGroupRow> }) => void; onSelectionChanged: (event: SelectionChangedEvent<Row | DocumentHistoryGroupRow>) => void; groupRowRendererParams: { innerRenderer: ComponentType<{ data?: Row | DocumentHistoryGroupRow; node: IRowNode<Row | DocumentHistoryGroupRow> }> } },
  groups: [] as IRowNode<Row | DocumentHistoryGroupRow>[],
  rows: [] as IRowNode<Row | DocumentHistoryGroupRow>[],
  api: { isDestroyed: () => false, forEachNode: vi.fn(), setNodesSelected: vi.fn(), getColumnState: vi.fn<() => ColumnState[]>(() => []), applyColumnState: vi.fn(), setColumnsVisible: vi.fn(), refreshServerSide: vi.fn(), getFilterModel: vi.fn<() => FilterModel>(() => ({})), setFilterModel: vi.fn(), refreshHeader: vi.fn(), hidePopupMenu: vi.fn(), hideColumnFilter: vi.fn(), getFirstDisplayedRowIndex: () => 0, getDisplayedRowAtIndex: vi.fn(), getAllDisplayedColumns: vi.fn(() => ['title']), getColumn: vi.fn(), getRowNode: vi.fn(), getFocusedCell: vi.fn(), ensureIndexVisible: vi.fn(), ensureColumnVisible: vi.fn(), setFocusedCell: vi.fn() },
}))
vi.mock('./document-history-grid-config', () => ({ DOCUMENT_GRID_MODULES: [], DOCUMENT_GRID_LOCALE: {}, DOCUMENT_GRID_THEMES: { quartz: {}, alpine: {}, balham: {} } }))
vi.mock('./document-history-grid-filter', async () => {
  const { createContext } = await import('react')
  return { DOCUMENT_HISTORY_SERVER_FILTER: {}, DocumentGridFilterContext: createContext(null) }
})
vi.mock('@/lib/use-journal-page-scroll', () => ({ useJournalPageScroll: () => undefined }))
vi.mock('ag-grid-react', () => ({
  AgGridProvider: ({ children }: { children: React.ReactNode }) => children,
  AgGridReact: (props: typeof grid.props) => {
    grid.props = props
    useEffect(() => { props.onGridReady({ api: grid.api }) }, [])
    const GroupLabel = props.groupRowRendererParams.innerRenderer
    return <div data-testid="grid">{grid.groups.map(node => <div key={node.id} className="ag-full-width-row ag-row-group" row-index={node.rowIndex}><GroupLabel data={node.data} node={node} /></div>)}
      {grid.rows.map(node => <div key={node.id} className="ag-row" row-index={node.rowIndex}>
        {props.columnDefs.filter(column => !column.initialHide).map(column => {
          const Cell = column.cellRenderer as ComponentType<{ data: Row | DocumentHistoryGroupRow | undefined; node: IRowNode<Row | DocumentHistoryGroupRow> }>
          return <div key={column.colId} className="ag-cell" col-id={column.colId} role="gridcell" tabIndex={-1}><Cell data={node.data} node={node} /></div>
        })}
      </div>)}
    </div>
  },
}))

type Row = { id: number; version?: number; rowCount?: number }
const props = (overrides: Partial<DocumentsHistoryGridProps<Row>> = {}): DocumentsHistoryGridProps<Row> => ({
  viewId: 'generated:test', columns: [{ key: 'title', label: 'Документ', minWidth: 200, required: true }], initialVisibleColumnKeys: ['title'],
  renderCell: () => null, renderActions: () => null, loadRows: vi.fn().mockResolvedValue({ rows: [], rowCount: 0, total: 0 }),
  loadFilterOptions: vi.fn().mockResolvedValue({ options: [], hasMore: false }), columnFilters: {}, onColumnFilterChange: vi.fn(),
  selectedDocuments: [{ id: 1 }], onSelectionChange: vi.fn(), onRowContextMenu: vi.fn(), toolbarActions: <button>Изменить выбранные</button>, ...overrides,
})
const pending = <T,>() => { let resolve!: (value: T) => void, reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function request(startRow = 0, requestOverrides: Partial<IServerSideGetRowsParams['request']> = {}) {
  const success = vi.fn(), fail = vi.fn()
  act(() => grid.props.serverSideDatasource.getRows({ request: { startRow, endRow: startRow + 100, rowGroupCols: [], groupKeys: [], sortModel: [], ...requestOverrides }, success, fail } as unknown as IServerSideGetRowsParams))
  return { success, fail }
}
afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks(); vi.unstubAllGlobals(); grid.groups = []; grid.rows = []; grid.api.forEachNode.mockReset(); grid.api.getDisplayedRowAtIndex.mockReset(); grid.api.getRowNode.mockReset(); grid.api.getColumn.mockReset(); grid.api.getFocusedCell.mockReset(); grid.api.getColumnState.mockReturnValue([]); grid.api.getFilterModel.mockReturnValue({}) })

describe('document grid count and saved views', () => {
  async function registryView(countColumn: 'visible' | 'hidden' | 'missing' = 'visible', overrides: Partial<DocumentsHistoryGridProps<Row>> = {}) {
    const node = { id: 'document:1', rowIndex: 0, expanded: false, data: { id: 1, rowCount: 123456 },
      isSelected: () => true, setExpanded: vi.fn() } as unknown as IRowNode<Row | DocumentHistoryGroupRow>
    vi.mocked(node.setExpanded).mockImplementation(expanded => {
      node.expanded = expanded
      grid.props.onRowGroupOpened({ node })
    })
    grid.rows = [node]
    grid.api.forEachNode.mockImplementation(callback => callback(node))
    grid.api.getRowNode.mockImplementation(id => id === node.id ? node : undefined)
    grid.api.getDisplayedRowAtIndex.mockImplementation(index => index === node.rowIndex ? node : undefined)
    grid.api.getColumn.mockImplementation(key => key === 'rowCount' && countColumn === 'missing' ? null : { isVisible: () => key !== 'rowCount' || countColumn === 'visible' })
    const preview = vi.fn(), menu = vi.fn(), selection = vi.fn()
    const initial = props({
      columns: [{ key: 'title', label: 'Документ', minWidth: 200, required: true },
        ...(countColumn === 'missing' ? [] : [{ key: 'rowCount' as const, label: 'Стыков', minWidth: 110, align: 'end' as const }])],
      initialVisibleColumnKeys: countColumn === 'visible' ? ['title', 'rowCount'] : ['title'],
      loadRows: vi.fn().mockResolvedValue({ rows: [node.data], rowCount: 1, total: 1, matchingSelectedIds: [1] }),
      selectedDocuments: [node.data as Row], onSelectionChange: selection, onRowContextMenu: menu,
      renderCell: (key, row) => key === 'title' ? <button data-document-title-button onClick={preview}>Документ № 1</button> : row.rowCount,
      ...overrides,
    })
    const view = render(<DocumentsHistoryGrid {...initial} />)
    await act(async () => { request() })
    return { ...view, node, initial, preview, menu, selection, title: view.container.querySelector<HTMLElement>('[col-id="title"]')! }
  }

  it('keeps a plain count cell and opens the title preview with Enter/F2 without expanding rows', async () => {
    const view = await registryView()
    const count = view.container.querySelector<HTMLElement>('[col-id="rowCount"]')!
    expect(count).toHaveTextContent('123456')
    expect(within(count).queryByRole('button')).not.toBeInTheDocument()
    expect(grid.props).not.toHaveProperty('masterDetail')
    expect(grid.props).not.toHaveProperty('detailCellRenderer')
    for (const key of ['Enter', 'F2']) {
      fireEvent.keyDown(view.title, { key })
      fireEvent.keyDown(count, { key })
    }
    expect(view.preview).toHaveBeenCalledTimes(2)
    expect(view.node.setExpanded).not.toHaveBeenCalled()
    expect(view.initial.loadRows).toHaveBeenCalledTimes(1)
    expect(view.selection).not.toHaveBeenCalled()
  })

  it.each(['hidden', 'missing'] as const)('keeps document context actions with a %s count column', async state => {
    const view = await registryView(state)
    fireEvent.contextMenu(view.title, { clientX: 100, clientY: 200 })
    expect(view.menu).toHaveBeenCalledExactlyOnceWith(view.node.data, expect.objectContaining({ clientX: 100, clientY: 200, copyCells: expect.any(Function) }))
    expect(view.menu.mock.calls[0][1]).not.toHaveProperty('toggleComposition')
    expect(view.node.setExpanded).not.toHaveBeenCalled()
    expect(view.preview).not.toHaveBeenCalled()
    expect(view.selection).not.toHaveBeenCalled()
  })

  it('applies appearance-only saved views without rebuilding equivalent native columns or repeating filters', async () => {
    const live: ColumnState[] = [
      { colId: 'ag-Grid-SelectionColumn', width: 46, pinned: 'left' },
      { colId: 'title', width: 320, pinned: 'left', hide: false, sort: null, sortIndex: null, rowGroup: false, rowGroupIndex: null, pivot: false, pivotIndex: null, aggFunc: null, flex: null },
      { colId: 'rowCount', width: 130, pinned: null, hide: false, sort: null, rowGroup: false, pivot: false, aggFunc: null, flex: null },
      { colId: '__actions', width: 205, pinned: 'right' },
    ]
    const saved = [{ colId: 'title', width: 320, pinned: 'left' as const }, { colId: 'rowCount', width: 130 }]
    writeDocumentGridState('generated:test', { columns: [], appearance: DOCUMENT_GRID_DEFAULT_APPEARANCE,
      views: [{ id: 'compact', name: 'Компактный вид', columns: saved, appearance: { ...DOCUMENT_GRID_DEFAULT_APPEARANCE, density: 'compact', wrapText: false, stripes: false }, filters: { title: 'Документ', stage: '' }, search: '' }] })
    grid.api.getColumnState.mockReturnValue(live)
    const filters = vi.fn(), view = await registryView('visible', { columnFilters: { title: 'Документ' }, onColumnFilterChange: filters })
    grid.api.applyColumnState.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Настроить вид' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Мои виды' }))
    fireEvent.click(screen.getByRole('button', { name: /Компактный вид Фильтров/ }))
    expect(grid.api.applyColumnState).not.toHaveBeenCalled()
    expect(filters).not.toHaveBeenCalled()
    expect(view.container.querySelector('.document-history-grid')).not.toHaveClass('document-grid-wrap', 'document-grid-stripes')
    expect(grid.api.refreshServerSide).not.toHaveBeenCalled()
    expect(grid.api.setFilterModel).not.toHaveBeenCalled()
    expect(view.initial.loadRows).toHaveBeenCalledTimes(1)
    expect(view.selection).not.toHaveBeenCalled()
  })
})

describe('document grid server lifecycle', () => {
  it.each([
    ['width', (columns: ColumnState[]) => columns.map(column => column.colId === 'line' ? { ...column, width: 240 } : column)],
    ['visibility', (columns: ColumnState[]) => columns.map(column => column.colId === 'line' ? { ...column, hide: true } : column)],
    ['pinning', (columns: ColumnState[]) => columns.map(column => column.colId === 'line' ? { ...column, pinned: 'right' as const } : column)],
    ['sorting', (columns: ColumnState[]) => columns.map(column => column.colId === 'line' ? { ...column, sort: 'desc' as const, sortIndex: 0 } : column)],
    ['grouping', (columns: ColumnState[]) => columns.map(column => column.colId === 'line' ? { ...column, rowGroup: true, rowGroupIndex: 0 } : column)],
    ['order', (columns: ColumnState[]) => [...columns].reverse()],
  ])('still applies a saved view that changes column %s', (_name, change) => {
    const current: ColumnState[] = [{ colId: 'title', width: 320, pinned: 'left' }, { colId: 'line', width: 130 }]
    const saved = change(current), initial = props({ columns: [
      { key: 'title', label: 'Документ', minWidth: 200, required: true }, { key: 'line', label: 'Линия', minWidth: 130 },
    ], initialVisibleColumnKeys: ['title', 'line'] })
    grid.api.getColumnState.mockReturnValue(current)
    writeDocumentGridState(initial.viewId, { columns: [], appearance: DOCUMENT_GRID_DEFAULT_APPEARANCE,
      views: [{ id: 'changed', name: 'Изменённый вид', columns: saved, appearance: DOCUMENT_GRID_DEFAULT_APPEARANCE, filters: {}, search: '' }] })
    render(<DocumentsHistoryGrid {...initial} />)
    fireEvent.click(screen.getByRole('button', { name: 'Настроить вид' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Мои виды' }))
    fireEvent.click(screen.getByRole('button', { name: /Изменённый вид Фильтров/ }))
    expect(grid.api.applyColumnState).toHaveBeenCalledExactlyOnceWith({ state: normalizeDocumentGridColumns(saved, initial.columns), applyOrder: true })
  })

  it('applies changed and cleared saved-view filters and registry search without repeating an unchanged filter', async () => {
    const filters = vi.fn(), initial = props({ columnFilters: { title: 'same', stage: 'old' }, onColumnFilterChange: filters })
    writeDocumentGridState(initial.viewId, { columns: [], appearance: DOCUMENT_GRID_DEFAULT_APPEARANCE,
      views: [{ id: 'changed', name: 'Другой отбор', columns: [], appearance: DOCUMENT_GRID_DEFAULT_APPEARANCE, filters: { title: 'same', line: 'new' }, search: 'сохранённый поиск' }] })
    render(<DocumentsHistoryGrid {...initial} />)
    fireEvent.click(screen.getByRole('button', { name: 'Настроить вид' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Мои виды' }))
    fireEvent.click(screen.getByRole('button', { name: /Другой отбор Фильтров/ }))
    expect(filters.mock.calls).toEqual([['stage', ''], ['line', 'new']])
    await act(async () => { request() })
    expect(initial.loadRows).toHaveBeenCalledWith(expect.objectContaining({ search: 'сохранённый поиск' }))
  })

  it('retains the parent callback that leaves an explicit document navigation slice when applying an equivalent saved filter', () => {
    const filters = vi.fn(), initial = props({ highlightedDocumentId: 1, columnFilters: { title: 'same' }, onColumnFilterChange: filters })
    writeDocumentGridState(initial.viewId, { columns: [], appearance: DOCUMENT_GRID_DEFAULT_APPEARANCE,
      views: [{ id: 'navigation', name: 'Весь вид', columns: [], appearance: DOCUMENT_GRID_DEFAULT_APPEARANCE, filters: { title: 'same' }, search: '' }] })
    render(<DocumentsHistoryGrid {...initial} />)
    fireEvent.click(screen.getByRole('button', { name: 'Настроить вид' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Мои виды' }))
    fireEvent.click(screen.getByRole('button', { name: /Весь вид Фильтров/ }))
    expect(filters).toHaveBeenCalledExactlyOnceWith('title', 'same')
    expect(grid.api.applyColumnState).not.toHaveBeenCalled()
  })

  it('remains live after StrictMode cleanup/replay and does not reload for unstable callback identities', async () => {
    const result = pending<DocumentHistoryGridResult<Row>>(), loadRows = vi.fn(() => result.promise)
    const initial = props({ loadRows }), view = render(<StrictMode><DocumentsHistoryGrid {...initial} /></StrictMode>)
    expect(grid.props.alwaysShowVerticalScroll).toBe(true)
    const datasource = grid.props.serverSideDatasource, response = request()
    await act(async () => result.resolve({ rows: [{ id: 1 }], rowCount: 1, total: 1, matchingSelectedIds: [1] }))
    expect(response.success).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Изменить выбранные' })).toBeEnabled()
    view.rerender(<StrictMode><DocumentsHistoryGrid {...initial} loadRows={() => loadRows()} renderActions={() => <span>Latest</span>} /></StrictMode>)
    expect(grid.props.serverSideDatasource).toBe(datasource)
    expect(grid.api.refreshServerSide).not.toHaveBeenCalled()
  })
  it('restores native filter state on mount and uses one reload path for filter changes, reset and source refresh', () => {
    const initial = props({ columnFilters: { title: 'saved', stage: 'external-only' } })
    const view = render(<DocumentsHistoryGrid {...initial} />)
    expect(grid.props.initialState.filter.filterModel).toEqual({ title: { value: 'saved' } })
    expect(grid.api.setFilterModel).not.toHaveBeenCalled()
    expect(grid.api.refreshServerSide).not.toHaveBeenCalled()
    grid.api.getFilterModel.mockReturnValue({ title: { value: 'saved' } })
    const changed = { ...initial, columnFilters: { title: 'changed', stage: 'external-only' } }
    view.rerender(<DocumentsHistoryGrid {...changed} />)
    expect(grid.api.setFilterModel).toHaveBeenCalledExactlyOnceWith({ title: { value: 'changed' } })
    expect(grid.api.refreshServerSide).not.toHaveBeenCalled()
    grid.api.getFilterModel.mockReturnValue({ title: { value: 'changed' } })
    view.rerender(<DocumentsHistoryGrid {...changed} sourceRevision={1} />)
    expect(grid.api.refreshServerSide).toHaveBeenCalledExactlyOnceWith({ purge: true })
    view.rerender(<DocumentsHistoryGrid {...changed} sourceRevision={1} columnFilters={{}} />)
    expect(grid.api.setFilterModel).toHaveBeenLastCalledWith({})
    expect(grid.api.refreshServerSide).toHaveBeenCalledTimes(1)
    expect(grid.api.refreshHeader).not.toHaveBeenCalled()
    expect(document.querySelector('.document-grid-filter-chips')).toBeNull()
  })
  it('never exposes encoded group keys as tooltips, while retaining document text', () => {
    render(<DocumentsHistoryGrid {...props()} />)
    const tooltip = grid.props.columnDefs.find(column => column.colId === 'title')!.tooltipValueGetter!
    const group = { __group: true, id: 'group', groupKey: '["value","Основной"]', groupLabel: 'Основной' }
    expect(tooltip({ data: group, node: { group: true }, value: group.groupKey } as never)).toBe('')
    expect(tooltip({ data: group, value: group.groupKey } as never)).toBe('')
    expect(tooltip({ data: { id: 1 }, node: { group: false }, value: 'Название документа' } as never)).toBe('Название документа')
  })
  it('disables old-scope actions until matching selection is known, ignores late previous-scope replies and keeps errors retryable', async () => {
    const old = pending<DocumentHistoryGridResult<Row>>(), fresh = pending<DocumentHistoryGridResult<Row>>()
    const loadRows = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
    const selection = vi.fn(), initial = props({ loadRows, onSelectionChange: selection })
    const view = render(<DocumentsHistoryGrid {...initial} />), first = request()
    view.rerender(<DocumentsHistoryGrid {...initial} columnFilters={{ title: 'new scope' }} />)
    expect(grid.api.refreshHeader).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Изменить выбранные' })).toBeDisabled()
    const second = request()
    await act(async () => old.resolve({ rows: [{ id: 1 }], rowCount: 1, total: 1, matchingSelectedIds: [1] }))
    expect(first.success).not.toHaveBeenCalled(); expect(first.fail).toHaveBeenCalledTimes(1)
    expect(selection).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Изменить выбранные' })).toBeDisabled()
    await act(async () => fresh.reject(new Error('local read unavailable')))
    expect(second.fail).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alert')).toHaveTextContent('local read unavailable')
    expect(screen.getByRole('button', { name: 'Изменить выбранные' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeEnabled()
  })
  it('does not disable established actions or erase later selections while another block is loading', async () => {
    const first = pending<DocumentHistoryGridResult<Row>>(), second = pending<DocumentHistoryGridResult<Row>>()
    const loadRows = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise), selection = vi.fn()
    const initial = props({ loadRows, onSelectionChange: selection }), view = render(<DocumentsHistoryGrid {...initial} />)
    request()
    await act(async () => first.resolve({ rows: [], rowCount: 200, total: 200, matchingSelectedIds: [1] }))
    request()
    view.rerender(<DocumentsHistoryGrid {...initial} selectedDocuments={[{ id: 1 }, { id: 2 }]} />)
    expect(screen.getByRole('button', { name: 'Изменить выбранные' })).toBeEnabled()
    await act(async () => second.resolve({ rows: [{ id: 1, version: 2 }], rowCount: 200, total: 200, matchingSelectedIds: [1] }))
    expect(selection).toHaveBeenLastCalledWith([{ id: 1, version: 2 }, { id: 2 }])
  })
  it('keeps column defaults stable and preserves an explicit visibility change across appearance updates', () => {
    render(<DocumentsHistoryGrid {...props({ columns: [{ key: 'title', label: 'Документ', minWidth: 200, required: true }, { key: 'stage', label: 'Этап', minWidth: 100 }], initialVisibleColumnKeys: ['title', 'stage'] })} />)
    const defaults = grid.props.defaultColDef
    expect(grid.props.columnDefs.find(column => column.colId === 'stage')).toMatchObject({ initialHide: false })
    expect(grid.props.columnDefs.find(column => column.colId === 'stage')).not.toHaveProperty('hide')
    fireEvent.click(screen.getByRole('button', { name: 'Настроить вид' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Этап' }))
    expect(grid.api.setColumnsVisible).toHaveBeenLastCalledWith(['stage'], false)
    expect(screen.getByRole('checkbox', { name: 'Этап' })).not.toBeChecked()
    fireEvent.click(screen.getByRole('tab', { name: 'Оформление' }))
    fireEvent.click(screen.getByRole('combobox', { name: 'Плотность строк документов' }))
    fireEvent.click(screen.getByRole('option', { name: /Компактно/ }))
    fireEvent.click(screen.getByRole('tab', { name: 'Столбцы' }))
    expect(grid.props.defaultColDef).toBe(defaults)
    expect(screen.getByRole('checkbox', { name: 'Этап' })).not.toBeChecked()
  })
  it('updates only changed cached selections in at most two batches and ignores groups', () => {
    const nodes = [
      { data: { id: 1 }, isSelected: () => true },
      { data: { id: 2 }, isSelected: () => false },
      { data: { id: 3 }, isSelected: () => true },
      { group: true, data: { id: 4 }, isSelected: () => false },
      { stub: true, data: undefined, isSelected: () => false },
    ]
    grid.api.forEachNode.mockImplementation(callback => nodes.forEach(callback))
    const initial = props({ selectedDocuments: [{ id: 1 }, { id: 2 }] })
    const view = render(<DocumentsHistoryGrid {...initial} />)
    expect(grid.api.setNodesSelected).toHaveBeenCalledTimes(2)
    expect(grid.api.setNodesSelected).toHaveBeenCalledWith({ nodes: [nodes[1]], newValue: true, source: 'api' })
    expect(grid.api.setNodesSelected).toHaveBeenCalledWith({ nodes: [nodes[2]], newValue: false, source: 'api' })
    nodes[1].isSelected = () => true; nodes[2].isSelected = () => false
    grid.api.setNodesSelected.mockClear()
    view.rerender(<DocumentsHistoryGrid {...initial} selectedDocuments={[{ id: 1 }, { id: 2 }]} />)
    expect(grid.api.setNodesSelected).not.toHaveBeenCalled()
    expect(grid.api.refreshServerSide).not.toHaveBeenCalled()
  })
  it('selects and shortens a keyboard/mouse range without loading rows', async () => {
    const data = [{ id: 1 }, { id: 2 }, { id: 3 }]
    const nodes = data.map((row, index) => ({ id: `document:${row.id}`, data: row, rowIndex: index,
      isSelected: () => row.id === 1 }))
    grid.api.forEachNode.mockImplementation(callback => nodes.forEach(callback))
    grid.api.getDisplayedRowAtIndex.mockImplementation(index => nodes.find(node => node.rowIndex === index))
    const onSelectionChange = vi.fn(), loadRows = vi.fn().mockResolvedValue({ rows: data, rowCount: 3, total: 3, matchingSelectedIds: [1] })
    const initial = props({ selectedDocuments: [data[0]], onSelectionChange, loadRows })
    const view = render(<DocumentsHistoryGrid {...initial} />)
    await act(async () => { request() })
    const controls = nodes.map(node => {
      const row = document.createElement('div'), cell = document.createElement('div'), wrapper = document.createElement('div'), checkbox = document.createElement('input')
      row.className = 'ag-row'; row.setAttribute('row-index', String(node.rowIndex))
      cell.className = 'ag-cell'; cell.setAttribute('col-id', 'ag-Grid-SelectionColumn')
      wrapper.className = 'ag-selection-checkbox'; checkbox.type = 'checkbox'
      wrapper.append(checkbox); cell.append(wrapper); row.append(cell); view.container.querySelector('.document-grid-frame')!.append(row)
      return { cell, checkbox }
    })
    onSelectionChange.mockClear()
    fireEvent.click(controls[0].checkbox)
    fireEvent.click(controls[2].checkbox, { shiftKey: true })
    await waitFor(() => expect(onSelectionChange).toHaveBeenLastCalledWith(data))
    view.rerender(<DocumentsHistoryGrid {...initial} selectedDocuments={data} />)
    fireEvent.keyDown(controls[1].cell, { key: ' ', shiftKey: true })
    expect(onSelectionChange).toHaveBeenLastCalledWith(data.slice(0, 2))
    expect(loadRows).toHaveBeenCalledTimes(1)
  })
  it('closes an AG column-filter popup on Escape before clearing selection or filters', () => {
    const selection = vi.fn(), change = vi.fn()
    const view = render(<DocumentsHistoryGrid {...props({ onSelectionChange: selection, onColumnFilterChange: change })} />)
    const popup = document.createElement('div'), input = document.createElement('input')
    popup.className = 'ag-popup'; popup.append(input); view.container.querySelector('.document-grid-frame')!.append(popup)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(grid.api.hideColumnFilter).toHaveBeenCalledTimes(1)
    expect(grid.api.hidePopupMenu).toHaveBeenCalledTimes(1)
    expect(selection).not.toHaveBeenCalled(); expect(change).not.toHaveBeenCalled()
  })
  it('coalesces identical pending blocks while keeping distinct selections isolated', async () => {
    const first = pending<DocumentHistoryGridResult<Row>>(), second = pending<DocumentHistoryGridResult<Row>>()
    const loadRows = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const initial = props({ loadRows }), view = render(<DocumentsHistoryGrid {...initial} />)
    const a = request(), b = request()
    expect(loadRows).toHaveBeenCalledTimes(1)
    view.rerender(<DocumentsHistoryGrid {...initial} selectedDocuments={[{ id: 1 }, { id: 2 }]} />)
    const c = request()
    expect(loadRows).toHaveBeenCalledTimes(2)
    await act(async () => first.resolve({ rows: [], rowCount: 0, total: 0, matchingSelectedIds: [1] }))
    await act(async () => second.resolve({ rows: [], rowCount: 0, total: 0, matchingSelectedIds: [1, 2] }))
    expect(a.success).toHaveBeenCalledTimes(1); expect(b.success).toHaveBeenCalledTimes(1); expect(c.success).toHaveBeenCalledTimes(1)
  })
  it('keeps the loading indicator until both concurrent blocks settle', async () => {
    const first = pending<DocumentHistoryGridResult<Row>>(), second = pending<DocumentHistoryGridResult<Row>>()
    const loadRows = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    render(<DocumentsHistoryGrid {...props({ loadRows })} />)
    request(); request(100)
    await act(async () => first.resolve({ rows: [], rowCount: 200, total: 200 }))
    expect(screen.getByText('Загрузка…')).toBeInTheDocument()
    await act(async () => second.resolve({ rows: [], rowCount: 200, total: 200 }))
    expect(screen.queryByText('Загрузка…')).not.toBeInTheDocument()
  })
  it('publishes a native range selection once, preserves evicted selections and ignores API restoration', async () => {
    const nodes = [1, 2, 3].map(id => ({ data: { id }, isSelected: () => false } as IRowNode<Row | DocumentHistoryGroupRow>))
    grid.api.forEachNode.mockImplementation(callback => nodes.forEach(callback))
    const selection = vi.fn(), loadRows = vi.fn().mockResolvedValue({ rows: [], rowCount: 3, total: 3 })
    render(<DocumentsHistoryGrid {...props({ loadRows, selectedDocuments: [{ id: 900 }, { id: 1 }], onSelectionChange: selection })} />)
    request(); await act(async () => undefined)
    act(() => grid.props.onSelectionChanged({ source: 'checkboxSelected', selectedNodes: [nodes[1], nodes[2]] } as SelectionChangedEvent<Row | DocumentHistoryGroupRow>))
    expect(selection).toHaveBeenCalledTimes(1)
    expect(selection).toHaveBeenCalledWith([{ id: 900 }, { id: 2 }, { id: 3 }])
    act(() => grid.props.onSelectionChanged({ source: 'api', selectedNodes: [] } as unknown as SelectionChangedEvent<Row | DocumentHistoryGroupRow>))
    expect(selection).toHaveBeenCalledTimes(1)
    expect(loadRows).toHaveBeenCalledTimes(1)
  })
  it('selects only loaded descendants of nested groups without fetching, keeps outside IDs and separates checkbox keys from expansion', async () => {
    const group = (id: string, parent: IRowNode<Row | DocumentHistoryGroupRow> | null, rowIndex: number) => ({
      id, group: true, level: parent ? parent.level + 1 : 0, rowIndex, key: id, parent,
      data: { id, __group: true, groupKey: id, groupLabel: id, childCount: 500 }, isSelected: () => false, setExpanded: vi.fn(),
    } as unknown as IRowNode<Row | DocumentHistoryGroupRow>)
    const top = group('Верхняя', null, 0), nested = group('Вложенная', top, 1), empty = group('Не загружена', null, 2)
    const leaf = (id: number, parent: IRowNode<Row | DocumentHistoryGroupRow>) => ({ data: { id }, parent, isSelected: () => false } as IRowNode<Row | DocumentHistoryGroupRow>)
    const first = leaf(1, top), second = leaf(2, nested)
    let nodes = [top, nested, empty, first, second]
    grid.groups = [top, nested, empty]
    grid.api.forEachNode.mockImplementation(callback => nodes.forEach(callback))
    grid.api.getDisplayedRowAtIndex.mockImplementation(index => grid.groups[index])
    const selection = vi.fn(), loadRows = vi.fn().mockResolvedValue({ rows: [], rowCount: 3, total: 500 })
    function SelectionView() {
      const [selected, setSelected] = useState<Row[]>([{ id: 900 }, { id: 1 }])
      return <DocumentsHistoryGrid {...props({ loadRows, selectedDocuments: selected, onSelectionChange: rows => { selection(rows); setSelected(rows) } })} />
    }
    const view = render(<SelectionView />)
    request(); await act(async () => undefined)
    const topBox = screen.getByRole('checkbox', { name: 'Выбрать загруженные документы группы Верхняя' })
    const nestedBox = screen.getByRole('checkbox', { name: 'Выбрать загруженные документы группы Вложенная' })
    expect(topBox).toBePartiallyChecked(); expect(nestedBox).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: /группы Не загружена/ })).toBeDisabled()
    fireEvent.keyDown(topBox, { key: 'F2' })
    expect(selection).toHaveBeenLastCalledWith([{ id: 900 }, { id: 1 }, { id: 2 }])
    expect(topBox).toBeChecked(); expect(nestedBox).toBeChecked()
    expect(selection).toHaveBeenCalledTimes(1)
    expect(top.setExpanded).not.toHaveBeenCalled()
    fireEvent.keyDown(nestedBox, { key: 'Enter' })
    expect(selection).toHaveBeenLastCalledWith([{ id: 900 }, { id: 1 }])
    expect(topBox).toBePartiallyChecked(); expect(nestedBox).not.toBeChecked()
    expect(nested.setExpanded).not.toHaveBeenCalled()
    expect(selection).toHaveBeenCalledTimes(2)
    fireEvent.keyDown(topBox.closest('.ag-row-group')!, { key: 'Enter' })
    expect(top.setExpanded).toHaveBeenCalledWith(true, expect.anything(), true)
    fireEvent.click(topBox)
    expect(topBox).toBeChecked()
    expect(selection).toHaveBeenCalledTimes(3)
    // A collapsed/evicted store contributes no cached leaves but cannot erase selection.
    nodes = [top, nested, empty]
    act(() => grid.props.onModelUpdated())
    expect(topBox).toBeDisabled()
    expect(screen.getByText('Выбрано: 3')).toBeInTheDocument()
    // Loading new descendants does not inherit the earlier group selection.
    nodes = [top, nested, empty, first, second, leaf(3, nested)]
    act(() => grid.props.onModelUpdated())
    expect(topBox).toBePartiallyChecked()
    expect(screen.getByText('Выбрано: 3')).toBeInTheDocument()
    expect(loadRows).toHaveBeenCalledTimes(1)
    expect(grid.api.refreshServerSide).not.toHaveBeenCalled()
    view.unmount()
  })
  it('reveals only the successful current user sort, cancels superseded animation and respects reduced motion', async () => {
    const loadRows = vi.fn().mockResolvedValue({ rows: [], rowCount: 300, total: 300 })
    const view = render(<DocumentsHistoryGrid {...props({ loadRows })} />)
    const rows = document.createElement('div'), cancel = vi.fn(), animate = vi.fn(() => ({ cancel }))
    rows.className = 'ag-grid-scrolling-container'; rows.animate = animate as unknown as typeof rows.animate
    view.container.querySelector('.document-grid-frame')!.append(rows)
    const settle = async () => { await act(async () => undefined); await act(async () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))) }
    request(); await settle()
    expect(animate).not.toHaveBeenCalled()
    grid.api.getColumnState.mockReturnValue([{ colId: 'title', sort: 'asc', sortIndex: 0 }])
    act(() => grid.props.onSortChanged({ source: 'uiColumnSorted' }))
    const sorted = request(0, { sortModel: [{ colId: 'title', sort: 'asc' }] })
    await settle()
    expect(sorted.success).toHaveBeenCalledTimes(1)
    expect(animate).toHaveBeenCalledExactlyOnceWith([{ opacity: .72 }, { opacity: 1 }], { duration: 140, easing: 'ease-out' })
    request(100, { sortModel: [{ colId: 'title', sort: 'asc' }] })
    request(0, { sortModel: [{ colId: 'title', sort: 'asc' }], groupKeys: ['loaded group'] })
    await settle()
    expect(animate).toHaveBeenCalledTimes(1)
    grid.api.getColumnState.mockReturnValue([{ colId: 'title', sort: 'desc', sortIndex: 0 }])
    act(() => grid.props.onSortChanged({ source: 'columnMenu' }))
    expect(cancel).toHaveBeenCalledTimes(1)
    const old = pending<DocumentHistoryGridResult<Row>>()
    loadRows.mockReturnValueOnce(old.promise)
    request(0, { sortModel: [{ colId: 'title', sort: 'desc' }] })
    grid.api.getColumnState.mockReturnValue([{ colId: 'title', sort: 'asc', sortIndex: 0 }])
    act(() => grid.props.onSortChanged({ source: 'uiColumnSorted' }))
    await act(async () => old.resolve({ rows: [], rowCount: 300, total: 300 }))
    await settle()
    expect(animate).toHaveBeenCalledTimes(1)
    request(0, { sortModel: [{ colId: 'title', sort: 'asc' }] }); await settle()
    expect(animate).toHaveBeenCalledTimes(2)
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
    grid.api.getColumnState.mockReturnValue([{ colId: 'title', sort: 'desc', sortIndex: 0 }])
    act(() => grid.props.onSortChanged({ source: 'uiColumnSorted' }))
    request(0, { sortModel: [{ colId: 'title', sort: 'desc' }] }); await settle()
    expect(animate).toHaveBeenCalledTimes(2)
    expect(loadRows).toHaveBeenCalledTimes(7)
    view.unmount()
  })
})
