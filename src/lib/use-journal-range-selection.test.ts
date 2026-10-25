import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { GridApi, IServerSideDatasource, IServerSideGetRowsParams } from 'ag-grid-community'
import type { WeldRow } from './dispatcher-types'
import type { JournalServerSource } from './use-journal-server-query'
import { useJournalServerGrid } from './use-journal-server-grid'
import { countJournalGridSelection, selectJournalGridRange } from '@/server/journal-grid-api'

vi.mock('@/server/journal-grid-api', () => ({ countJournalGridSelection: vi.fn(), copyJournalGridRange: vi.fn(),
  selectJournalGridRange: vi.fn(), selectJournalGridRows: vi.fn(), summarizeJournalGridRange: vi.fn() }))
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks()
  vi.mocked(countJournalGridSelection).mockResolvedValue({ total: 0, counts: {}, snapshot: 'empty', complete: true })
})
afterEach(() => vi.useRealTimers())

async function setup() {
  let datasource!: IServerSideDatasource<WeldRow>, finish!: (result: { ids: number[]; revision: number }) => void
  const state = { first: 1, last: 2, known: true }
  const api = { isDestroyed: () => false,
    setGridOption: (_key: string, value: IServerSideDatasource<WeldRow>) => { datasource = value },
    clearCellSelection: vi.fn(), getRowGroupColumns: () => [], forEachNode: () => {},
    getCellRanges: () => [{ startRow: { rowIndex: state.first }, endRow: { rowIndex: state.last },
      columns: [{ isVisible: () => true, getColId: () => 'ag-Grid-SelectionColumn' }] }],
    getServerSideGroupLevelState: () => [{ route: [], rowCount: 200000, lastRowIndexKnown: state.known }],
    getDisplayedRowCount: () => 200000,
  } as unknown as GridApi<WeldRow>
  const source: JournalServerSource = { identity: 'range-A', columnFilters: {}, sort: null, rowsChanged: vi.fn(),
    load: vi.fn().mockResolvedValue({ rows: [], rowCount: 200000, revision: 1 }) }
  const onSelect = vi.fn(), onError = vi.fn()
  vi.mocked(selectJournalGridRange).mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const props = { api, source, selected: new Set([99]), anchor: 'line', ready: true, onSelect, onError }
  const view = renderHook(options => useJournalServerGrid(options), { initialProps: props })
  await act(async () => datasource.getRows({ request: { rowGroupCols: [], groupKeys: [], startRow: 0, endRow: 100 },
    success: vi.fn(), fail: vi.fn() } as unknown as IServerSideGetRowsParams<WeldRow>))
  return { view, props, state, onSelect, onError, finish: (ids = [2, 3]) => finish({ ids, revision: 1 }) }
}
it('adds range IDs once, preserves outside checks and coalesces rapid presses into one request', async () => {
  const { view, onSelect, onError, finish } = await setup()
  try {
    act(() => { view.result.current.selectRange(); view.result.current.selectRange() })
    expect(selectJournalGridRange).toHaveBeenCalledOnce()
    expect(vi.mocked(selectJournalGridRange).mock.calls[0][0].data.parts).toEqual([{ route: [], start: 1, end: 3, columns: ['id'] }])
    expect(view.result.current.selectionContext?.pending).toBe(true)
    await act(async () => finish([2, 3, 2]))
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(new Set([99, 2, 3]))
    expect(onError).not.toHaveBeenCalled()
    expect(view.result.current.selectionContext?.pending).toBe(false)
  } finally { view.unmount() }
})
it.each(['range', 'selection', 'query', 'regroup', 'unmount', 'not-ready'] as const)('does not apply a late selection after %s changes', async reason => {
  const { view, props, state, onSelect, onError, finish } = await setup()
  try {
    act(() => view.result.current.selectRange())
    if (reason === 'range') state.last++
    if (reason === 'selection') view.rerender({ ...props, selected: new Set() })
    if (reason === 'query') view.rerender({ ...props, source: { ...props.source, identity: 'range-B', load: () => new Promise(() => {}) } })
    if (reason === 'regroup') act(() => view.result.current.resetLayout())
    if (reason === 'unmount') view.unmount()
    if (reason === 'not-ready') view.rerender({ ...props, ready: false })
    await act(async () => finish())
    expect(onSelect).not.toHaveBeenCalled()
    if (['query', 'regroup', 'unmount'].includes(reason)) expect(onError).not.toHaveBeenCalled()
    else expect(onError).toHaveBeenCalledOnce()
  } finally { view.unmount() }
})
it('leaves the existing selection and counters intact when the workflow rejects its limit', async () => {
  const { view, onSelect, finish } = await setup()
  onSelect.mockReturnValue(false)
  try {
    act(() => view.result.current.selectRange())
    await act(async () => finish(Array.from({ length: 5001 }, (_, index) => index + 1)))
    expect(onSelect).toHaveBeenCalledOnce()
    expect(view.result.current.selectionContext?.ids).toEqual(new Set([99]))
    expect(view.result.current.selectionContext?.uniform).not.toBe(true)
  } finally { view.unmount() }
})
it('unchecks a fully selected area while preserving checks outside it', async () => {
  const { view, props, onSelect, finish } = await setup()
  try {
    view.rerender({ ...props, selected: new Set([99, 2, 3]) })
    act(() => view.result.current.selectRange())
    await act(async () => finish([2, 3, 2]))
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(new Set([99]))
  } finally { view.unmount() }
})
it('refuses unfinished group layouts and permits retry after a server error', async () => {
  const { view, state, onSelect, onError, finish } = await setup()
  try {
    state.known = false
    act(() => view.result.current.selectRange())
    expect(selectJournalGridRange).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith('Дождитесь загрузки раскрытых групп.')
    state.known = true
    vi.mocked(selectJournalGridRange).mockRejectedValueOnce(new Error('stale revision'))
    await act(async () => view.result.current.selectRange())
    expect(view.result.current.selectionContext?.pending).toBe(false)
    expect(onSelect).not.toHaveBeenCalled()
    act(() => view.result.current.selectRange())
    await act(async () => finish())
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(new Set([99, 2, 3]))
  } finally { view.unmount() }
})
