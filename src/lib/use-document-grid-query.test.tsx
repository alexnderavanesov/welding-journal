import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { GridApi } from 'ag-grid-community'
import { useDocumentGridQuery } from './use-document-grid-query'
import type { DocumentHistoryGridRequest, DocumentHistoryGridResult, DocumentHistoryGroupRow } from './document-history-grid'

type Row = { id: number; title: string }
const revision = 'a'.repeat(32)
const column = { getColId: () => 'title', isVisible: () => true }
const range = (last: number) => ({ startRow: { rowIndex: 0 }, endRow: { rowIndex: last }, columns: [column] })
const write = vi.fn().mockResolvedValue(undefined)
beforeEach(() => { vi.clearAllMocks(); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: write } }) })
afterEach(() => vi.unstubAllGlobals())
function setup(load: (request: DocumentHistoryGridRequest) => Promise<DocumentHistoryGridResult<Row>>, size = 250) {
  const api = { isDestroyed: () => false, getColumnState: () => [], getFocusedCell: () => null,
    getCellRanges: vi.fn(() => [range(size - 1)]), getAllDisplayedColumns: () => [column], forEachNode: () => undefined,
    getServerSideGroupLevelState: () => [{ route: [], rowCount: size, lastRowIndexKnown: true }], getDisplayedRowCount: () => size }
  const error = vi.fn(), select = vi.fn()
  const hook = renderHook(({ scope, selected }) => useDocumentGridQuery<Row>({ api: api as unknown as GridApi<Row | DocumentHistoryGroupRow>, scope,
    ready: true, total: size, selected, select, load, search: '', columns: [{ key: 'title', label: 'Документ' }], value: (_key, row) => row.title, error }),
  { initialProps: { scope: 'first', selected: [] as { id: number }[] } })
  act(() => hook.result.current.accept({ rows: [], total: size, rowCount: size, revision }))
  return { ...hook, api, error, select }
}
it('coalesces repeated group counts in flight and after success, but refreshes a changed selection, revision or scope', async () => {
  vi.useFakeTimers()
  const response = { rows: [], counts: { '[]': 1 }, total: 250, rowCount: 250, revision }
  let complete!: (value: DocumentHistoryGridResult<Row>) => void
  const load = vi.fn().mockImplementationOnce(() => new Promise(resolve => { complete = resolve })).mockResolvedValue(response)
  const hook = setup(load)
  const tick = () => act(async () => { await vi.advanceTimersByTimeAsync(80) })
  try {
    hook.rerender({ scope: 'first', selected: [{ id: 1 }] })
    await tick()
    act(() => hook.result.current.countSelection()); await tick()
    expect(load).toHaveBeenCalledTimes(1)
    await act(async () => complete(response))
    expect(hook.result.current.counts).toEqual(response.counts)
    act(() => hook.result.current.countSelection()); await tick()
    expect(load).toHaveBeenCalledTimes(1)
    hook.rerender({ scope: 'first', selected: [{ id: 2 }] }); await tick()
    expect(load).toHaveBeenCalledTimes(2)
    act(() => { hook.result.current.accept({ ...response, revision: 'b'.repeat(32) }); hook.result.current.countSelection() })
    await tick(); expect(load).toHaveBeenCalledTimes(3)
    hook.rerender({ scope: 'second', selected: [{ id: 2 }] })
    act(() => { hook.result.current.accept({ ...response, revision: 'b'.repeat(32) }); hook.result.current.countSelection() })
    await tick(); expect(load).toHaveBeenCalledTimes(4)
  } finally { hook.unmount(); vi.useRealTimers() }
})
it('retries a failed count instead of caching its rejection', async () => {
  vi.useFakeTimers()
  const load = vi.fn().mockRejectedValueOnce(new Error('Temporary read failure'))
    .mockResolvedValue({ rows: [], counts: { '[]': 1 }, total: 250, rowCount: 250, revision })
  const hook = setup(load)
  try {
    hook.rerender({ scope: 'first', selected: [{ id: 1 }] })
    await act(async () => { await vi.advanceTimersByTimeAsync(80) })
    expect(hook.error).toHaveBeenCalledWith('Temporary read failure')
    act(() => hook.result.current.countSelection())
    await act(async () => { await vi.advanceTimersByTimeAsync(80) })
    expect(load).toHaveBeenCalledTimes(2)
    expect(hook.result.current.counts).toEqual({ '[]': 1 })
  } finally { hook.unmount(); vi.useRealTimers() }
})

it('does not cancel copying when the same range summary event arrives later', async () => {
  let complete!: (value: DocumentHistoryGridResult<Row>) => void
  const load = vi.fn(() => new Promise<DocumentHistoryGridResult<Row>>(resolve => { complete = resolve }))
  const { result } = setup(load, 2)
  let operation: Promise<void> | undefined
  act(() => { operation = result.current.copy() })
  act(() => result.current.updateRange())
  await act(async () => { complete({ rows: [], cells: [['A'], ['B']], rowCount: 2, total: 2, revision }); await operation })
  expect(write).toHaveBeenCalledExactlyOnceWith('A\nB')
})
it.each(['scope', 'range', 'unmount'].flatMap(reason => ['writeText', 'ClipboardItem'].map(clipboard => ({ reason, clipboard }))))(
  'does not publish a late $clipboard response after $reason changes', async ({ reason, clipboard }) => {
  if (clipboard === 'ClipboardItem') {
    class DeferredItem { constructor(public values: Record<string, Promise<Blob>>) {} }
    vi.stubGlobal('ClipboardItem', DeferredItem)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      write: async (items: DeferredItem[]) => { await items[0].values['text/plain']; await write() },
    } })
  }
  let complete!: (value: DocumentHistoryGridResult<Row>) => void
  const load = vi.fn(() => new Promise<DocumentHistoryGridResult<Row>>(resolve => { complete = resolve }))
  const { result, rerender, unmount, api } = setup(load, 2)
  let operation: Promise<void> | undefined
  act(() => { operation = result.current.copy() })
  if (reason === 'scope') rerender({ scope: 'second', selected: [] })
  else if (reason === 'range') { api.getCellRanges.mockReturnValue([range(0)]); act(() => result.current.updateRange()) }
  else unmount()
  await act(async () => { complete({ rows: [], cells: [['A'], ['B']], rowCount: 2, total: 2, revision }); await operation })
  expect(write).not.toHaveBeenCalled()
})
it('copies bounded batches and never publishes a partial result when a later batch fails', async () => {
  const load = vi.fn().mockResolvedValueOnce({ rows: [], cells: Array.from({ length: 500 }, (_, id) => [String(id)]), rowCount: 750, total: 750, revision })
    .mockRejectedValueOnce(new Error('Registry changed'))
  const { result, error } = setup(load, 750)
  await act(async () => result.current.copy())
  expect(load).toHaveBeenCalledTimes(2)
  expect(load.mock.calls[1][0]).toMatchObject({ startRow: 500, endRow: 750, revision })
  expect(write).not.toHaveBeenCalled()
  expect(error).toHaveBeenCalledWith('Registry changed')
})
it('selects full IDs without requesting cards and preserves choices outside the filter', async () => {
  const load = vi.fn().mockResolvedValue({ rows: [], ids: [1, 2, 3], total: 3, rowCount: 3, revision })
  const { result, rerender, select } = setup(load, 3)
  rerender({ scope: 'first', selected: [{ id: 900 }] })
  await act(async () => result.current.toggle())
  expect(load).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ idsOnly: true, revision }))
  expect(select).toHaveBeenCalledWith([{ id: 900 }, { id: 1 }, { id: 2 }, { id: 3 }])
})
it('updates visible descendant checkboxes together with a full selection and its removal', async () => {
  const load = vi.fn().mockResolvedValue({ rows: [], ids: [1, 2, 3], total: 3, rowCount: 3, revision })
  const { result, api, rerender } = setup(load, 3)
  const groupKey = JSON.stringify(['value', 'A'])
  const group = { group: true, level: 0, parent: null, data: {
    __group: true, id: 'group-a', groupKey, groupLabel: 'A', childCount: 2, ordinal: 0,
  } }
  api.forEachNode = vi.fn(callback => callback(group)) as unknown as typeof api.forEachNode
  await act(async () => result.current.toggle())
  expect(result.current.counts).toEqual({ '[]': 3, [JSON.stringify([groupKey])]: 2 })
  rerender({ scope: 'first', selected: [{ id: 1 }, { id: 2 }, { id: 3 }] })
  await act(async () => result.current.toggle())
  expect(result.current.counts).toEqual({ '[]': 0, [JSON.stringify([groupKey])]: 0 })
  expect(load).toHaveBeenCalledTimes(1)
})

it('reserves clipboard access in the user gesture before waiting for unloaded document cells', async () => {
  let complete!: (value: DocumentHistoryGridResult<Row>) => void
  const load = vi.fn(() => new Promise<DocumentHistoryGridResult<Row>>(resolve => { complete = resolve }))
  class DeferredItem { constructor(public values: Record<string, Promise<Blob>>) {} }
  vi.stubGlobal('ClipboardItem', DeferredItem)
  const writeItems = vi.fn(async (items: DeferredItem[]) => { await items[0].values['text/plain'] })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write: writeItems, writeText: write } })
  const { result } = setup(load, 2)
  let operation: Promise<void> | undefined
  act(() => { operation = result.current.copy() })
  const reservedBeforeResponse = writeItems.mock.calls.length
  await act(async () => { complete({ rows: [], cells: [['A'], ['B']], rowCount: 2, total: 2, revision }); await operation })
  expect(reservedBeforeResponse).toBe(1)
  expect(write).not.toHaveBeenCalled()
  expect(await writeItems.mock.calls[0][0][0].values['text/plain']).toBeInstanceOf(Blob)
})

it('allows a new full selection after changing scope while an old selection request is pending', async () => {
  const responses: Array<(value: DocumentHistoryGridResult<Row>) => void> = []
  const load = vi.fn(() => new Promise<DocumentHistoryGridResult<Row>>(resolve => responses.push(resolve)))
  const { result, rerender, select } = setup(load, 2)
  let first: Promise<void> | undefined, second: Promise<void> | undefined
  act(() => { first = result.current.toggle() })
  rerender({ scope: 'second', selected: [] })
  act(() => { result.current.accept({ rows: [], rowCount: 2, total: 2, revision }); second = result.current.toggle() })
  const requestsBeforeFirstCompleted = load.mock.calls.length
  await act(async () => { responses[0]({ rows: [], ids: [1, 2], rowCount: 2, total: 2, revision }); await first })
  expect(select).not.toHaveBeenCalled()
  await act(async () => result.current.toggle())
  expect(load).toHaveBeenCalledTimes(2)
  if (responses[1]) await act(async () => { responses[1]({ rows: [], ids: [3, 4], rowCount: 2, total: 2, revision }); await second })
  expect(requestsBeforeFirstCompleted).toBe(2)
  expect(select).toHaveBeenCalledExactlyOnceWith([{ id: 3 }, { id: 4 }])
})

it('stops further document batches when clipboard permission is denied before cells arrive', async () => {
  let complete!: (value: DocumentHistoryGridResult<Row>) => void
  const load = vi.fn(() => new Promise<DocumentHistoryGridResult<Row>>(resolve => { complete = resolve }))
  class DeferredItem { constructor(public values: Record<string, Promise<Blob>>) {} }
  vi.stubGlobal('ClipboardItem', DeferredItem)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    write: vi.fn().mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError')),
  } })
  const { result, error } = setup(load, 750)
  await act(async () => result.current.copy())
  expect(error).toHaveBeenCalledExactlyOnceWith('Permission denied')
  expect(result.current.copying).toBe(false)
  await act(async () => complete({ rows: [], cells: Array.from({ length: 500 }, () => ['A']), rowCount: 750, total: 750, revision }))
  expect(load).toHaveBeenCalledTimes(1)
})
