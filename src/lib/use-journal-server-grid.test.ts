import { act, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { expect, it, vi } from 'vitest'
import type { GridApi, IServerSideDatasource, IServerSideGetRowsParams } from 'ag-grid-community'
import type { WeldRow } from './dispatcher-types'
import type { JournalServerSource } from './use-journal-server-query'
import type { JournalGridResult } from './journal-server-grid'
import { useJournalServerGrid } from './use-journal-server-grid'
import { countJournalGridSelection, selectJournalGridRows, summarizeJournalGridRange } from '@/server/journal-grid-api'

vi.mock('@/server/journal-grid-api', () => ({
  countJournalGridSelection: vi.fn(), copyJournalGridRange: vi.fn(),
  selectJournalGridRows: vi.fn(), summarizeJournalGridRange: vi.fn(),
}))
it('selects a complete local query synchronously without selection/count RPCs', async () => {
  vi.useFakeTimers()
  let datasource!: IServerSideDatasource<WeldRow>
  const group = { group: true, data: { id: -1, journalGroup: { key: 'A', route: ['A'], recordCount: 2, childCount: 2 } } }
  const rows = [{ id: 1 }, { id: 2 }] as WeldRow[]
  const api = { isDestroyed: () => false, setGridOption: (_key: string, value: IServerSideDatasource<WeldRow>) => { datasource = value },
    getRowNode: () => ({ parent: group }), clearCellSelection: vi.fn(), getRowGroupColumns: () => [{ getColId: () => 'line' }], getCellRanges: () => [],
    forEachNode: (visit: (node: unknown) => void) => { visit(group); rows.forEach(data => visit({ data, parent: group })) } } as unknown as GridApi<WeldRow>
  const source: JournalServerSource = { identity: 'local-selection', columnFilters: {}, sort: null, rowsChanged: vi.fn(),
    load: vi.fn().mockResolvedValue({ rows: [group.data], rowCount: 1, revision: 1 }) }
  vi.mocked(selectJournalGridRows).mockClear().mockImplementation(() => new Promise(() => {}))
  vi.mocked(countJournalGridSelection).mockClear().mockImplementation(() => new Promise(() => {}))
  const view = renderHook(() => {
    const [selected, onSelect] = useState(new Set<number>())
    return useJournalServerGrid({ api, source, selected, onSelect, anchor: 'line', ready: true, total: 2 })
  })
  try {
    await act(async () => datasource.getRows({ request: { rowGroupCols: [{ id: 'line' }], groupKeys: [], startRow: 0, endRow: 100 },
      success: vi.fn(), fail: vi.fn() } as unknown as IServerSideGetRowsParams<WeldRow>))
    act(() => view.result.current.selectionContext!.toggle(group.data as WeldRow))
    expect([...view.result.current.selectionContext!.ids]).toEqual([1, 2])
    expect(view.result.current.selectionContext!.counts['["A"]']).toBe(2)
    expect(view.result.current.selectionContext!.selectedTotal).toBe(2)
    await act(async () => vi.advanceTimersByTimeAsync(100))
    expect(view.result.current.selectionContext!.pending).toBe(false)
    act(() => view.result.current.selectionContext!.toggle(rows[0]))
    expect([...view.result.current.selectionContext!.ids]).toEqual([2])
    expect(view.result.current.selectionContext!.counts['["A"]']).toBe(1)
    act(() => view.result.current.selectionContext!.toggle(group.data as WeldRow))
    expect([...view.result.current.selectionContext!.ids].sort()).toEqual([1, 2])
    act(() => view.result.current.selectionContext!.toggle())
    expect(view.result.current.selectionContext!.ids.size).toBe(0)
    expect(selectJournalGridRows).not.toHaveBeenCalled()
    expect(countJournalGridSelection).not.toHaveBeenCalled()
  } finally { view.unmount(); vi.useRealTimers() }
})
it.each([false, true])('does not resend 200000 all-selected IDs for new stores; preserves outside-filter selection: %s', async outsideFilter => {
  vi.useFakeTimers()
  let datasource!: IServerSideDatasource<WeldRow>
  const group = { group: true, data: { id: -1, journalGroup: { key: 'A', route: ['A'], recordCount: 1000, childCount: 1000 } } }
  let extra = false
  const api = { isDestroyed: () => false, setGridOption: (_key: string, value: IServerSideDatasource<WeldRow>) => { datasource = value },
    getRowNode: () => ({ parent: group }), clearCellSelection: vi.fn(), getRowGroupColumns: () => [{ getColId: () => 'line' }], getCellRanges: () => [],
    forEachNode: (visit: (node: unknown) => void) => { visit(group); if (extra) visit({ group: true, data: { journalGroup: { route: ['B'], recordCount: 1000 } } }) } } as unknown as GridApi<WeldRow>
  const source: JournalServerSource = { identity: 'all-200000', columnFilters: {}, sort: null, rowsChanged: vi.fn(),
    load: vi.fn().mockResolvedValue({ rows: [group.data], rowCount: 200, revision: 1 }) }
  vi.mocked(selectJournalGridRows).mockClear().mockResolvedValue({ ids: Array.from({ length: 200000 }, (_, index) => index + 1), revision: 1 })
  vi.mocked(countJournalGridSelection).mockClear().mockImplementation(() => new Promise(() => {}))
  const view = renderHook(() => {
    const [selected, onSelect] = useState(new Set<number>(outsideFilter ? [999999] : []))
    return useJournalServerGrid({ api, source, selected, onSelect, anchor: 'line', ready: true, total: 200000 })
  })
  try {
    await act(async () => datasource.getRows({ request: { rowGroupCols: [{ id: 'line' }], groupKeys: [], startRow: 0, endRow: 100 },
      success: vi.fn(), fail: vi.fn() } as unknown as IServerSideGetRowsParams<WeldRow>))
    await act(async () => view.result.current.selectionContext!.toggle())
    await act(async () => vi.advanceTimersByTimeAsync(120))
    expect(view.result.current.selectionContext!.uniform).toBe(true)
    expect(view.result.current.selectionContext!.selectedTotal).toBe(200000)
    extra = true
    act(() => view.result.current.modelUpdated())
    await act(async () => vi.advanceTimersByTimeAsync(120))
    expect(countJournalGridSelection).not.toHaveBeenCalled()
    act(() => view.result.current.selectionContext!.toggle({ id: 1 } as WeldRow))
    expect(view.result.current.selectionContext!.uniform).toBeUndefined()
    expect(view.result.current.selectionContext!.selectedTotal).toBe(199999)
    expect(view.result.current.selectionContext!.counts['["A"]']).toBe(999)
    expect(view.result.current.selectionContext!.counts['["B"]']).toBe(1000)
    await act(async () => vi.advanceTimersByTimeAsync(120))
    expect(countJournalGridSelection).toHaveBeenCalledOnce()
    act(() => view.result.current.selectionContext!.toggle({ id: 1 } as WeldRow))
    await act(async () => view.result.current.selectionContext!.toggle())
    expect([...view.result.current.selectionContext!.ids]).toEqual(outsideFilter ? [999999] : [])
    expect(view.result.current.selectionContext!.uniform).toBe(false)
    expect(selectJournalGridRows).toHaveBeenCalledTimes(outsideFilter ? 2 : 1)
  } finally { view.unmount(); vi.useRealTimers() }
})
it.each(['unmount', 'regroup'] as const)('discards a late group selection after %s', async reason => {
  let datasource!: IServerSideDatasource<WeldRow>, finish!: (value: { ids: number[]; revision: number }) => void
  const onSelect = vi.fn(), onError = vi.fn()
  const api = { isDestroyed: () => false, setGridOption: (_key: string, value: IServerSideDatasource<WeldRow>) => { datasource = value },
    clearCellSelection: vi.fn(), getRowGroupColumns: () => [], forEachNode: () => {}, getCellRanges: () => [] } as unknown as GridApi<WeldRow>
  const source: JournalServerSource = { identity: 'selection', columnFilters: {}, sort: null, rowsChanged: vi.fn(),
    load: vi.fn().mockResolvedValue({ rows: [], rowCount: 2, revision: 1 }) }
  vi.mocked(selectJournalGridRows).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const view = renderHook(() => useJournalServerGrid({ api, source, selected: new Set(), anchor: 'line', ready: true, onSelect, onError }))
  await act(async () => datasource.getRows({ request: { rowGroupCols: [], groupKeys: [], startRow: 0, endRow: 100 },
    success: vi.fn(), fail: vi.fn() } as unknown as IServerSideGetRowsParams<WeldRow>))
  act(() => view.result.current.selectionContext!.toggle())
  if (reason === 'unmount') view.unmount()
  else act(() => view.result.current.resetLayout())
  await act(async () => finish({ ids: [1, 2], revision: 1 }))
  expect(onSelect).not.toHaveBeenCalled()
  expect(onError).not.toHaveBeenCalled()
  view.unmount()
})
it('loads an incomplete group once, reuses its exact membership for rapid toggles, and clears it on regrouping', async () => {
  let datasource!: IServerSideDatasource<WeldRow>
  const group = { group: true, data: { id: -1, journalGroup: { key: 'A', route: ['A'], recordCount: 2, childCount: 2 } } }
  const child = { group: true, parent: group, data: { id: -2, journalGroup: { key: 'B', route: ['A', 'B'], recordCount: 2, childCount: 2 } } }
  const api = { isDestroyed: () => false, setGridOption: (_key: string, value: IServerSideDatasource<WeldRow>) => { datasource = value },
    getRowNode: () => ({ parent: child }), clearCellSelection: vi.fn(), getRowGroupColumns: () => [{ getColId: () => 'line' }], getCellRanges: () => [],
    forEachNode: (visit: (node: unknown) => void) => { visit(group); visit(child); visit({ data: { id: 1 }, parent: child }) } } as unknown as GridApi<WeldRow>
  const source: JournalServerSource = { identity: 'incomplete', columnFilters: {}, sort: null, rowsChanged: vi.fn(),
    load: vi.fn().mockResolvedValue({ rows: [group.data], rowCount: 1, revision: 1 }) }
  vi.mocked(selectJournalGridRows).mockClear().mockResolvedValue({ ids: [1, 2], revision: 1 })
  const view = renderHook(() => {
    const [selected, onSelect] = useState(new Set<number>())
    return useJournalServerGrid({ api, source, selected, onSelect, anchor: 'line', ready: true, total: 2 })
  })
  try {
    await act(async () => datasource.getRows({ request: { rowGroupCols: [{ id: 'line' }], groupKeys: [], startRow: 0, endRow: 100 },
      success: vi.fn(), fail: vi.fn() } as unknown as IServerSideGetRowsParams<WeldRow>))
    await act(async () => view.result.current.selectionContext!.toggle(group.data as WeldRow))
    expect([...view.result.current.selectionContext!.ids]).toEqual([1, 2])
    expect(view.result.current.selectionContext!.counts['["A"]']).toBe(2)
    expect(view.result.current.selectionContext!.counts['["A","B"]']).toBe(2)
    expect(view.result.current.selectionContext!.selectedTotal).toBe(2)
    act(() => view.result.current.selectionContext!.toggle({ id: 1 } as WeldRow))
    expect(view.result.current.selectionContext!.selectedTotal).toBe(1)
    expect(view.result.current.selectionContext!.counts['["A"]']).toBe(1)
    expect(view.result.current.selectionContext!.counts['["A","B"]']).toBe(1)
    act(() => view.result.current.selectionContext!.toggle({ id: 1 } as WeldRow))
    expect(view.result.current.selectionContext!.selectedTotal).toBe(2)
    act(() => view.result.current.selectionContext!.toggle(group.data as WeldRow))
    expect(view.result.current.selectionContext!.ids.size).toBe(0)
    expect(view.result.current.selectionContext!.counts['["A","B"]'] ?? 0).toBe(0)
    act(() => view.result.current.selectionContext!.toggle(group.data as WeldRow))
    expect(view.result.current.selectionContext!.ids.size).toBe(2)
    expect(selectJournalGridRows).toHaveBeenCalledTimes(1)
    act(() => view.result.current.resetLayout())
    await act(async () => view.result.current.selectionContext!.toggle(group.data as WeldRow))
    expect(selectJournalGridRows).toHaveBeenCalledTimes(2)
  } finally { view.unmount() }
})
it('maps ranges past unloaded expanded groups using visual stores, and refuses unknown placeholders', async () => {
  vi.useFakeTimers()
  let datasource!: IServerSideDatasource<WeldRow>
  let cellIndex: number | null = null, firstCount = 1, firstKnown = false
  const stores = vi.fn(() => [
    { route: [], rowCount: 2, lastRowIndexKnown: true },
    { route: ['A'], rowCount: firstCount, lastRowIndexKnown: firstKnown },
    { route: ['B'], rowCount: 2, lastRowIndexKnown: true },
  ])
  const api = { isDestroyed: () => false, setGridOption: (_key: string, value: IServerSideDatasource<WeldRow>) => { datasource = value },
    clearCellSelection: vi.fn(), getRowGroupColumns: () => [{ getColId: () => 'line' }],
    getServerSideGroupLevelState: stores, getDisplayedRowCount: () => 4 + firstCount,
    forEachNode: (visit: (node: unknown) => void) => {
      for (const [ordinal, key, childCount] of [[0, 'A', 100], [1, 'B', 2]] as const) {
        visit({ group: true, expanded: true, data: { journalGroup: { route: [key], ordinal, childCount } } })
      }
    },
    getCellRanges: () => cellIndex === null ? [] : [{ startRow: { rowIndex: cellIndex }, endRow: { rowIndex: cellIndex },
      columns: [{ isVisible: () => true, getColId: () => 'wdi' }] }],
  } as unknown as GridApi<WeldRow>
  const source: JournalServerSource = { identity: 'range', columnFilters: {}, sort: null, rowsChanged: vi.fn(),
    load: vi.fn().mockResolvedValue({ rows: [], rowCount: 2, revision: 1 }) }
  const summarize = vi.mocked(summarizeJournalGridRange).mockResolvedValue({ count: 1, numericCount: 1, sum: 1, average: 1 })
  summarize.mockClear()
  const view = renderHook(() => useJournalServerGrid({ api, source, selected: new Set(), anchor: 'line', ready: true }))
  try {
    await act(async () => datasource.getRows({ request: { rowGroupCols: [{ id: 'line' }], groupKeys: [], startRow: 0, endRow: 100 },
      success: vi.fn(), fail: vi.fn() } as unknown as IServerSideGetRowsParams<WeldRow>))
    await act(async () => vi.advanceTimersByTimeAsync(200))
    expect(stores).not.toHaveBeenCalled() // No extra store pass without a cell range.
    cellIndex = 4
    act(() => view.result.current.updateRange())
    await act(async () => vi.advanceTimersByTimeAsync(200))
    expect(summarize).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({
      parts: [{ route: ['B'], start: 1, end: 2, columns: ['wdi'] }],
    }) }))
    cellIndex = 1
    act(() => view.result.current.updateRange())
    await act(async () => vi.advanceTimersByTimeAsync(200))
    expect(view.result.current.rangeState).toBe('Дождитесь загрузки раскрытых групп.')
    expect(summarize).toHaveBeenCalledTimes(1)
    firstCount = 100; firstKnown = true
    act(() => view.result.current.modelUpdated())
    await act(async () => vi.advanceTimersByTimeAsync(200))
    expect(summarize).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({
      parts: [{ route: ['A'], start: 0, end: 1, columns: ['wdi'] }],
    }) }))
    expect(view.result.current.rangeState).toBe('')
  } finally { view.unmount(); vi.useRealTimers() }
})

it('coalesces model passes and reuses group routes without notifying an empty selection', async () => {
  vi.useFakeTimers()
  let datasource!: IServerSideDatasource<WeldRow>
  const visit = vi.fn(callback => callback({ group: true, expanded: false, data: { journalGroup: { route: ['L'], childCount: 10 } } }))
  const api = { isDestroyed: () => false, setGridOption: (_key: string, value: IServerSideDatasource<WeldRow>) => { datasource = value },
    clearCellSelection: vi.fn(), getRowGroupColumns: () => [{ getColId: () => 'line' }], forEachNode: visit, getCellRanges: () => [] } as unknown as GridApi<WeldRow>
  const source: JournalServerSource = { identity: 'A', columnFilters: {}, sort: null, rowsChanged: vi.fn(),
    load: vi.fn().mockResolvedValue({ rows: [], rowCount: 1, revision: 1 }) }
  vi.mocked(countJournalGridSelection).mockResolvedValue({ counts: { '["L"]': 1 }, total: 1 })
  const view = renderHook(({ selected }) => useJournalServerGrid({ api, source, selected, anchor: 'line', ready: true }),
    { initialProps: { selected: new Set<number>() } })
  try {
    await act(async () => datasource.getRows({ request: { rowGroupCols: [{ id: 'line' }], groupKeys: [], startRow: 0, endRow: 100 },
      success: vi.fn(), fail: vi.fn() } as unknown as IServerSideGetRowsParams<WeldRow>))
    await act(async () => vi.advanceTimersByTimeAsync(120))
    const emptySelection = view.result.current.selectionContext
    visit.mockClear()
    act(() => { for (let event = 0; event < 20; event++) view.result.current.modelUpdated() })
    await act(async () => vi.advanceTimersByTimeAsync(120))
    expect(visit).toHaveBeenCalledTimes(1)
    expect(view.result.current.selectionContext).toBe(emptySelection)
    view.rerender({ selected: new Set([1]) })
    await act(async () => vi.advanceTimersByTimeAsync(100))
    expect(visit).toHaveBeenCalledTimes(1)
    expect(countJournalGridSelection).toHaveBeenCalledWith({ signal: expect.any(AbortSignal), data: expect.objectContaining({ ids: [1], routes: [['L']] }) })
  } finally { view.unmount(); vi.useRealTimers() }
})
it('keeps the old store during filtering, releases aborted slots and commits only the newest prepared block', async () => {
  let datasource!: IServerSideDatasource<WeldRow>
  const order: string[] = []
  const replace=vi.fn(), apply=vi.fn(() => order.push('rows')), onError=vi.fn()
  const onReplaced = vi.fn(() => order.push('reveal'))
  const set=vi.fn((_key:string,value:IServerSideDatasource<WeldRow>)=>{datasource?.destroy?.();datasource=value})
  const api={isDestroyed:()=>false,setGridOption:set,clearCellSelection:vi.fn(),applyServerSideRowData:apply,flushAllAnimationFrames:vi.fn(() => order.push('cells')),
    getRowGroupColumns:()=>[],forEachNode:()=>{},getCellRanges:()=>[]} as unknown as GridApi<WeldRow>
  const requests:{signal:AbortSignal;resolve:(result:JournalGridResult)=>void}[]=[]
  const load:JournalServerSource['load']=(_request,signal)=>new Promise((resolve,reject)=>{
    requests.push({signal:signal!,resolve})
    signal!.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')))
  })
  const source=(identity:string):JournalServerSource=>({identity,columnFilters:{search:identity},sort:null,load,rowsChanged:vi.fn()})
  const {rerender,unmount}=renderHook(({identity})=>useJournalServerGrid({api,source:source(identity),selected:new Set(),
    anchor:'line',ready:true,onError,onReplace:replace,onReplaced}),{initialProps:{identity:'A'}})
  const first={request:{rowGroupCols:[],groupKeys:[],startRow:0,endRow:100},success:vi.fn(),fail:vi.fn()}
  act(()=>datasource.getRows(first as unknown as IServerSideGetRowsParams<WeldRow>))
  await act(async()=>rerender({identity:'B'}))
  expect(first.fail).toHaveBeenCalledTimes(1)
  expect(first.success).not.toHaveBeenCalled()
  expect(set).toHaveBeenCalledTimes(1)
  await act(async()=>rerender({identity:'C'}))
  expect(requests[1].signal.aborted).toBe(true)
  expect(set).toHaveBeenCalledTimes(1)
  const result={rows:[{id:3} as WeldRow],rowCount:1,revision:4}
  await act(async()=>requests[2].resolve(result))
  expect(set).toHaveBeenCalledTimes(2)
  expect(apply).toHaveBeenCalledWith({successParams:{rowData:result.rows,rowCount:1},startRow:0})
  expect(onError).not.toHaveBeenCalled()
  expect(order).toEqual(['rows', 'cells', 'reveal'])
  expect(onReplaced).toHaveBeenCalledTimes(1)
  unmount()
})

it('keeps the displayed store on a failed replacement and can replace it on retry', async () => {
  const set = vi.fn(), apply = vi.fn(), onError = vi.fn()
  const api = { isDestroyed: () => false, setGridOption: set, clearCellSelection: vi.fn(), applyServerSideRowData: apply, flushAllAnimationFrames: vi.fn(),
    getRowGroupColumns: () => [], forEachNode: () => {}, getCellRanges: () => [] } as unknown as GridApi<WeldRow>
  const loaded = { rows: [{ id: 2 } as WeldRow], rowCount: 1, revision: 2 }
  const load = vi.fn().mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValue(loaded)
  const { rerender, unmount } = renderHook(({ identity }) => useJournalServerGrid({ api,
    source: { identity, columnFilters: {}, sort: null, load, rowsChanged: vi.fn() },
    selected: new Set(), anchor: 'line', ready: false, onError,
  }), { initialProps: { identity: 'A' } })
  await act(async () => rerender({ identity: 'B' }))
  // Query failures have their own retryable UI, not a sticky action message.
  expect(onError).not.toHaveBeenCalled()
  expect(set).toHaveBeenCalledTimes(1)
  expect(apply).not.toHaveBeenCalled()
  await act(async () => rerender({ identity: 'retry' }))
  expect(set).toHaveBeenCalledTimes(2)
  expect(apply).toHaveBeenCalledWith({ successParams: { rowData: loaded.rows, rowCount: 1 }, startRow: 0 })
  unmount()
})

it('reuses a selection snapshot across new routes, retries expired tokens and never recounts a complete snapshot', async () => {
  vi.useFakeTimers()
  let datasource!: IServerSideDatasource<WeldRow>
  let routes = ['A']
  const api = { isDestroyed: () => false, setGridOption: (_key: string, value: IServerSideDatasource<WeldRow>) => { datasource = value },
    clearCellSelection: vi.fn(), getRowGroupColumns: () => [{ getColId: () => 'line' }], getCellRanges: () => [],
    forEachNode: (visit: (value: unknown) => void) => routes.forEach(key => visit({ group: true, data: { journalGroup: { route: [key], childCount: 1 } } })),
  } as unknown as GridApi<WeldRow>
  const source: JournalServerSource = { identity: 'counts', columnFilters: {}, sort: null, rowsChanged: vi.fn(), load: vi.fn().mockResolvedValue({ rows: [], rowCount: 10, revision: 1 }) }
  const count = vi.mocked(countJournalGridSelection).mockReset()
  count.mockResolvedValueOnce({ total: 2, counts: { '["A"]': 1 }, snapshot: 'token', complete: false })
    .mockResolvedValueOnce({ total: 0, counts: {}, expired: true })
    .mockResolvedValueOnce({ total: 2, counts: { '["A"]': 1, '["B"]': 1 }, snapshot: 'new', complete: true })
  const selected = new Set([10, 20])
  const view = renderHook(() => useJournalServerGrid({ api, source, selected, anchor: 'line', ready: true }))
  try {
    await act(async () => datasource.getRows({ request: { rowGroupCols: [{ id: 'line' }], groupKeys: [], startRow: 0, endRow: 100 }, success: vi.fn(), fail: vi.fn() } as unknown as IServerSideGetRowsParams<WeldRow>))
    await act(async () => vi.advanceTimersByTimeAsync(200))
    expect(count).toHaveBeenCalledTimes(1)
    routes = ['A', 'B']; act(() => view.result.current.modelUpdated())
    await act(async () => vi.advanceTimersByTimeAsync(300))
    expect(count).toHaveBeenCalledTimes(3)
    expect(count.mock.calls[1][0].data).toMatchObject({ snapshot: 'token', routes: [['B']] })
    expect(count.mock.calls[1][0].data).not.toHaveProperty('ids')
    expect(count.mock.calls[2][0].data).toMatchObject({ ids: [10, 20] })
    routes = ['A', 'B', 'empty']; act(() => view.result.current.modelUpdated())
    await act(async () => vi.advanceTimersByTimeAsync(200))
    expect(count).toHaveBeenCalledTimes(3)
    expect(view.result.current.selectionContext).toMatchObject({ selectedTotal: 2, pending: false, counts: { '["B"]': 1 } })
  } finally { view.unmount(); vi.useRealTimers() }
})

it('does not publish an old count while a replacement selection waits for its debounce', async () => {
  vi.useFakeTimers()
  let datasource!: IServerSideDatasource<WeldRow>, finish!: (value: {total:number;counts:Record<string,number>}) => void
  const api = { isDestroyed: () => false, setGridOption: (_key: string, value: IServerSideDatasource<WeldRow>) => { datasource = value },
    clearCellSelection: vi.fn(), getRowGroupColumns: () => [], getCellRanges: () => [], forEachNode: () => {},
  } as unknown as GridApi<WeldRow>
  const source: JournalServerSource = { identity: 'stale-count', columnFilters: {}, sort: null, rowsChanged: vi.fn(), load: vi.fn().mockResolvedValue({ rows: [], rowCount: 3, revision: 1 }) }
  const count = vi.mocked(countJournalGridSelection).mockReset().mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    .mockResolvedValue({ total: 2, counts: {}, complete: true })
  const view = renderHook(({ selected }) => useJournalServerGrid({ api, source, selected, anchor: 'line', ready: true }), { initialProps: { selected: new Set([1]) } })
  try {
    await act(async () => datasource.getRows({ request: { rowGroupCols: [], groupKeys: [], startRow: 0, endRow: 100 }, success: vi.fn(), fail: vi.fn() } as unknown as IServerSideGetRowsParams<WeldRow>))
    await act(async () => vi.advanceTimersByTimeAsync(120))
    view.rerender({ selected: new Set([2, 3]) })
    await act(async () => finish({ total: 1, counts: {} }))
    expect(view.result.current.selectionContext!.selectedTotal).toBe(0)
    await act(async () => vi.advanceTimersByTimeAsync(200))
    expect(count.mock.calls[0][0].signal?.aborted).toBe(true)
    expect(view.result.current.selectionContext!.selectedTotal).toBe(2)
  } finally { view.unmount(); vi.useRealTimers() }
})
