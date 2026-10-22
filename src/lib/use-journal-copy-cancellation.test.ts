import { act, renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { GridApi, IServerSideDatasource, IServerSideGetRowsParams } from 'ag-grid-community'
import type { WeldRow } from './dispatcher-types'
import type { JournalServerSource } from './use-journal-server-query'
import { useJournalServerGrid } from './use-journal-server-grid'
import { copyJournalGridRange } from '@/server/journal-grid-api'

vi.mock('@/server/journal-grid-api', () => ({
  countJournalGridSelection: vi.fn(), copyJournalGridRange: vi.fn(),
  selectJournalGridRows: vi.fn(), summarizeJournalGridRange: vi.fn(),
}))

it.each(['unmount', 'query', 'regroup'].flatMap(reason => ['writeText', 'ClipboardItem'].map(clipboard => ({ reason, clipboard }))))(
  'cancels an unfinished $clipboard copy on $reason without writing stale data or reporting a late error', async ({ reason, clipboard }) => {
  let datasource!: IServerSideDatasource<WeldRow>, finish!: (value: string) => void
  const onError = vi.fn(), writeText = vi.fn().mockResolvedValue(undefined)
  const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  const itemDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'ClipboardItem')
  class DeferredClipboardItem {
    constructor(readonly data: Record<string, Promise<Blob>>) {}
  }
  // Safari requires starting write() during the gesture, before the server
  // response. Rejection of the deferred item must prevent the actual write.
  Object.defineProperty(globalThis, 'ClipboardItem', { configurable: true, value: DeferredClipboardItem })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard === 'writeText' ? { writeText } : {
    write: async (items: DeferredClipboardItem[]) => { await items[0].data['text/plain']; await writeText() },
  } })
  const api = {
    isDestroyed: () => false,
    setGridOption: (_key: string, value: IServerSideDatasource<WeldRow>) => { datasource = value },
    clearCellSelection: vi.fn(), getRowGroupColumns: () => [], forEachNode: () => {},
    getAllDisplayedColumns: () => [{ getColId: () => 'joint' }],
    getCellRanges: () => [{ startRow: { rowIndex: 0 }, endRow: { rowIndex: 1 }, columns: [{ isVisible: () => true, getColId: () => 'joint' }] }],
    getServerSideGroupLevelState: () => [{ route: [], rowCount: 2, lastRowIndexKnown: true }],
    getDisplayedRowCount: () => 2,
  } as unknown as GridApi<WeldRow>
  const source: JournalServerSource = { identity: 'copy-A', columnFilters: {}, sort: null, rowsChanged: vi.fn(),
    load: vi.fn().mockResolvedValue({ rows: [], rowCount: 2, revision: 1 }) }
  vi.mocked(copyJournalGridRange).mockClear().mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const view = renderHook(({ source }) => useJournalServerGrid({ api, source, selected: new Set(), anchor: 'line', ready: true, onError }), { initialProps: { source } })
  try {
    await act(async () => datasource.getRows({ request: { rowGroupCols: [], groupKeys: [], startRow: 0, endRow: 100 }, success: vi.fn(), fail: vi.fn() } as unknown as IServerSideGetRowsParams<WeldRow>))
    act(() => view.result.current.copy())
    const signal = vi.mocked(copyJournalGridRange).mock.calls[0][0].signal
    expect(signal?.aborted).toBe(false)
    if (reason === 'unmount') view.unmount()
    else if (reason === 'query') {
      // The new source may still be loading; cancellation must not wait for it.
      view.rerender({ source: { ...source, identity: 'copy-B', load: () => new Promise(() => {}) } })
    } else act(() => view.result.current.resetLayout())
    expect(signal?.aborted).toBe(true)
    await act(async () => finish('Стык\r\nA\r\nB')) // A response can race with abort.
    expect(writeText).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  } finally {
    view.unmount()
    if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor)
    else Reflect.deleteProperty(navigator, 'clipboard')
    if (itemDescriptor) Object.defineProperty(globalThis, 'ClipboardItem', itemDescriptor)
    else Reflect.deleteProperty(globalThis, 'ClipboardItem')
  }
})

it('stops the server copy when clipboard permission is refused before the response', async () => {
  let datasource!: IServerSideDatasource<WeldRow>
  const onError = vi.fn()
  const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  const itemDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'ClipboardItem')
  class DeferredClipboardItem {
    constructor(data: Record<string, Promise<Blob>>) { void data['text/plain'].catch(() => {}) }
  }
  Object.defineProperty(globalThis, 'ClipboardItem', { configurable: true, value: DeferredClipboardItem })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    write: vi.fn().mockRejectedValue(new DOMException('Clipboard permission denied', 'NotAllowedError')),
  } })
  const api = {
    isDestroyed: () => false,
    setGridOption: (_key: string, value: IServerSideDatasource<WeldRow>) => { datasource = value },
    clearCellSelection: vi.fn(), getRowGroupColumns: () => [], forEachNode: () => {},
    getAllDisplayedColumns: () => [{ getColId: () => 'joint' }],
    getCellRanges: () => [{ startRow: { rowIndex: 0 }, endRow: { rowIndex: 199999 }, columns: [{ isVisible: () => true, getColId: () => 'joint' }] }],
    getServerSideGroupLevelState: () => [{ route: [], rowCount: 200000, lastRowIndexKnown: true }],
    getDisplayedRowCount: () => 200000,
  } as unknown as GridApi<WeldRow>
  const source: JournalServerSource = { identity: 'denied', columnFilters: {}, sort: null, rowsChanged: vi.fn(),
    load: vi.fn().mockResolvedValue({ rows: [], rowCount: 200000, revision: 1 }) }
  vi.mocked(copyJournalGridRange).mockClear().mockImplementationOnce(({ signal }) => new Promise((_resolve, reject) => {
    signal!.addEventListener('abort', () => reject(signal!.reason), { once: true })
  }))
  const view = renderHook(() => useJournalServerGrid({ api, source, selected: new Set(), anchor: 'line', ready: true, onError }))
  try {
    await act(async () => datasource.getRows({ request: { rowGroupCols: [], groupKeys: [], startRow: 0, endRow: 100 }, success: vi.fn(), fail: vi.fn() } as unknown as IServerSideGetRowsParams<WeldRow>))
    await act(async () => view.result.current.copy())
    expect(onError).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('Clipboard permission denied'))
    expect(vi.mocked(copyJournalGridRange).mock.calls[0][0].signal?.aborted).toBe(true)
    expect(view.result.current.rangeState).not.toBe('Копируем…')
  } finally {
    view.unmount()
    if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor)
    else Reflect.deleteProperty(navigator, 'clipboard')
    if (itemDescriptor) Object.defineProperty(globalThis, 'ClipboardItem', itemDescriptor)
    else Reflect.deleteProperty(globalThis, 'ClipboardItem')
  }
})
