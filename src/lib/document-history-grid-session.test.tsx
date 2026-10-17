import { act, cleanup, fireEvent, renderHook } from '@testing-library/react'
import type { GridApi, IRowNode } from 'ag-grid-community'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { documentGridErrorMessage, EMPTY_DOCUMENT_GRID_SESSION, readDocumentGridSession, writeDocumentGridSession } from './document-history-grid-session'
import { useDocumentGridSession } from './use-document-grid-session'


function visibleFrame(id: string, index: number) {
  const frame = document.createElement('div'), viewport = document.createElement('div'), row = document.createElement('div')
  viewport.className = 'ag-grid-viewport'; row.className = 'ag-row'; row.setAttribute('row-id', id); row.setAttribute('row-index', String(index))
  viewport.getBoundingClientRect = () => ({ top: 0, bottom: 1000, height: 1000 }) as DOMRect
  row.getBoundingClientRect = () => ({ top: 0, bottom: 56, height: 56 }) as DOMRect
  viewport.append(row); frame.append(viewport)
  return { frame, viewport }
}

afterEach(() => { cleanup(); sessionStorage.clear(); vi.unstubAllGlobals() })
describe('document grid session', () => {
  it('keeps view sessions separate, tolerates invalid storage and preserves every explicit restored path', () => {
    writeDocumentGridSession('one', { ...EMPTY_DOCUMENT_GRID_SESSION, scope: 'scope', firstRow: 140, top: 7840, left: 120, search: 'Q', expandedPaths: Array.from({ length: 250 }, (_, index) => [String(index)]) })
    expect(readDocumentGridSession('one')).toMatchObject({ firstRow: 140, top: 7840, left: 120, search: 'Q' })
    expect(readDocumentGridSession('one').expandedPaths).toHaveLength(250)
    expect(readDocumentGridSession('one').expandedPaths[249]).toEqual(['249'])
    expect(readDocumentGridSession('two').firstRow).toBe(0)
    sessionStorage.setItem('welding-journal:documents:grid-session:v1:one', '{bad')
    expect(readDocumentGridSession('one')).toEqual(EMPTY_DOCUMENT_GRID_SESSION)
  })
  it('suppresses SQL diagnostics but preserves useful operator errors', () => {
    expect(documentGridErrorMessage(new Error('Failed query: select password from private_table'))).not.toContain('private_table')
    expect(documentGridErrorMessage(new Error('Срок ожидания истёк. Повторите попытку.'))).toBe('Срок ожидания истёк. Повторите попытку.')
  })
  it('waits for grouped child totals and restores only the target block rather than accepting a temporary root clamp', () => {
    let scheduled: FrameRequestCallback | undefined
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { scheduled = callback; return 1 })
    vi.stubGlobal('cancelAnimationFrame', () => undefined)
    const flush = () => act(() => { const callback = scheduled; scheduled = undefined; callback?.(0) })
    const { frame } = visibleFrame('document:247', 112)
    let total = 4, targetLoaded = false
    const ensureIndexVisible = vi.fn()
    const api = {
      isDestroyed: () => false, ensureIndexVisible, getRowNode: () => targetLoaded ? { rowIndex: 112 } : undefined,
      getDisplayedRowCount: () => total, getFirstDisplayedRowIndex: () => 112,
      getServerSideGroupLevelState: () => [{ route: [], rowCount: 4, lastRowIndexKnown: true }, { route: ['A'], rowCount: total === 4 ? 1 : 124, lastRowIndexKnown: total !== 4 }],
      getDisplayedRowAtIndex: (index: number) => index < 4 ? { id: `group-${index}`, data: {}, stub: false }
        : targetLoaded ? { id: 'document:247', data: { id: 247 }, stub: false } : { stub: true },
    } as unknown as GridApi
    const initial = { ...EMPTY_DOCUMENT_GRID_SESSION, scope: 'scope', firstRow: 112, top: 6272, left: 90, rowId: 'document:247', expandedPaths: [['A']] }
    const { result } = renderHook(() => useDocumentGridSession(api, { current: frame }, 'view', 'scope', '', initial, false))
    act(() => result.current.restore()); flush()
    expect(ensureIndexVisible).toHaveBeenLastCalledWith(3, 'top')
    expect(readDocumentGridSession('view').rowId).toBeNull()
    total = 128
    act(() => result.current.restore()); flush()
    expect(ensureIndexVisible).toHaveBeenLastCalledWith(112, 'top')
    expect(readDocumentGridSession('view').rowId).toBeNull()
    targetLoaded = true
    act(() => result.current.restore()); flush()
    act(() => result.current.bodyScrollEnd())
    expect(readDocumentGridSession('view')).toMatchObject({ rowId: 'document:247', firstRow: 112, left: 90, top: 6272 })
    expect(ensureIndexVisible.mock.calls.map(call => call[0])).toEqual([3, 112, 112])
    expect(result.current.isGroupOpen({ group: true, key: 'A', level: 0, parent: null } as IRowNode)).toBe(true)
    expect(result.current.isGroupOpen({ group: true, key: 'B', level: 0, parent: null } as IRowNode)).toBe(false)
    expect(result.current.isGroupOpen({ group: false, level: 1, parent: { group: true, key: 'A', level: 0, parent: null } } as IRowNode)).toBe(false)
  })
  it('accepts a smaller confirmed registry after the old anchor was deleted and then captures the new position', () => {
    let scheduled: FrameRequestCallback | undefined
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { scheduled = callback; return 1 })
    vi.stubGlobal('cancelAnimationFrame', () => undefined)
    const api = { isDestroyed: () => false, ensureIndexVisible: vi.fn(), getRowNode: () => undefined,
      getDisplayedRowCount: () => 80, getFirstDisplayedRowIndex: () => 79,
      getDisplayedRowAtIndex: () => ({ id: 'document:80', data: { id: 80 }, stub: false }),
      getServerSideGroupLevelState: () => [{ route: [], rowCount: 80, lastRowIndexKnown: true }],
    } as unknown as GridApi
    const initial = { ...EMPTY_DOCUMENT_GRID_SESSION, scope: 'scope', firstRow: 200, rowId: 'document:201' }
    const { frame } = visibleFrame('document:80', 79)
    const { result } = renderHook(() => useDocumentGridSession(api, { current: frame }, 'view', 'scope', '', initial, false))
    act(() => result.current.restore()); act(() => scheduled?.(0))
    expect(readDocumentGridSession('view')).toMatchObject({ firstRow: 79, rowId: 'document:80' })
    expect(api.ensureIndexVisible).toHaveBeenCalledTimes(1)
    act(() => result.current.restore())
    expect(api.ensureIndexVisible).toHaveBeenCalledTimes(1)
  })
  it('restores a distant root ancestor and distant child directly, without fetching prefix blocks', async () => {
    let scheduled: FrameRequestCallback | undefined
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { scheduled = callback; return 1 })
    vi.stubGlobal('cancelAnimationFrame', () => undefined)
    const flush = async () => act(async () => { const callback = scheduled; scheduled = undefined; callback?.(0) })
    const { frame } = visibleFrame('document:110', 360)
    type Data = { id: string }
    const nodes = new Map<string, IRowNode<Data>>()
    const load = vi.fn(async (route: string[], start: number) => ({ rowCount: route.length ? 126 : 250,
      rows: Array.from({ length: route.length ? 26 : 50 }, (_, offset) => ({ id: `${route.length ? 'document' : 'group'}:${start + offset}` })),
    }))
    const ensureIndexVisible = vi.fn()
    const api = { isDestroyed: () => false, getRowNode: (id: string) => nodes.get(id), ensureIndexVisible,
      getDisplayedRowCount: () => 376, getFirstDisplayedRowIndex: () => 360,
      getDisplayedRowAtIndex: (index: number) => [...nodes.values()].find(node => node.rowIndex === index),
      getServerSideGroupLevelState: () => [{ route: [], rowCount: 250, lastRowIndexKnown: true }, { route: ['A'], rowCount: 126, lastRowIndexKnown: true }],
      applyServerSideRowData: vi.fn(({ route, startRow, successParams }: { route: string[]; startRow: number; successParams: { rowData: Data[] } }) => {
        successParams.rowData.forEach((data, index) => {
          const rowIndex = route.length ? 250 + startRow + index : startRow + index
          const node = { id: data.id, data, rowIndex, rowTop: rowIndex * 56, group: !route.length, level: route.length, key: route.length ? null : 'A', parent: route.length ? nodes.get('group:249') : null, expanded: false, setExpanded: vi.fn(() => { node.expanded = true }) } as unknown as IRowNode<Data>
          nodes.set(data.id, node)
        })
      }),
    } as unknown as GridApi<Data>
    const breadcrumbs = [{ id: 'group:249', route: [], index: 249 }, { id: 'document:110', route: ['A'], index: 110 }]
    const initial = { ...EMPTY_DOCUMENT_GRID_SESSION, scope: 'scope', firstRow: 360, rowId: 'document:110', top: 20170, offset: 10, left: 90, expandedPaths: [['A']], breadcrumbs }
    const { result } = renderHook(() => useDocumentGridSession(api, { current: frame }, 'view', 'scope', '', initial, false, { load, getRowId: row => row.id }))
    act(() => result.current.restore()); await flush(); await flush()
    expect(load.mock.calls).toEqual([[[], 200], [['A'], 100]])
    expect(nodes.get('group:249')?.setExpanded).toHaveBeenCalledWith(true, undefined, true)
    expect(ensureIndexVisible).not.toHaveBeenCalled()
    act(() => result.current.bodyScrollEnd())
    expect(readDocumentGridSession('view')).toMatchObject({ firstRow: 360, rowId: 'document:110', top: 20170, left: 90, breadcrumbs })
  })
  it('captures the actually visible row instead of the render buffer and preserves it after DOM teardown', () => {
    const { frame, viewport } = visibleFrame('document:238', 237)
    const buffer = document.createElement('div'); buffer.className = 'ag-row'; buffer.setAttribute('row-id', 'document:232'); buffer.setAttribute('row-index', '231')
    buffer.getBoundingClientRect = () => ({ top: -336, bottom: -280, height: 56 }) as DOMRect
    viewport.prepend(buffer); viewport.scrollTop = 237 * 56 + 17; viewport.scrollLeft = 70
    const api = { isDestroyed: () => false, getFirstDisplayedRowIndex: () => 231, getDisplayedRowCount: () => 250,
      getDisplayedRowAtIndex: (index: number) => ({ id: `document:${index + 1}`, rowIndex: index, rowTop: index * 56, data: { id: index + 1 }, level: 0, parent: null }),
    } as unknown as GridApi
    const reference = { current: frame as HTMLDivElement | null }
    const { result } = renderHook(() => useDocumentGridSession(api, reference, 'view', 'scope', '', EMPTY_DOCUMENT_GRID_SESSION, false))
    act(() => result.current.capture())
    expect(readDocumentGridSession('view')).toMatchObject({ firstRow: 237, rowId: 'document:238', top: 13289, offset: 17, left: 70 })
    reference.current = null
    act(() => result.current.capture())
    expect(readDocumentGridSession('view')).toMatchObject({ firstRow: 237, rowId: 'document:238', top: 13289, offset: 17, left: 70 })
  })
  it('does not apply a delayed restoration block after its grouping or sort scope changes', async () => {
    let scheduled: FrameRequestCallback | undefined, resolve!: (value: { rows: { id: string }[]; rowCount: number }) => void
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { scheduled = callback; return 1 }); vi.stubGlobal('cancelAnimationFrame', () => undefined)
    const load = vi.fn(() => new Promise<{ rows: { id: string }[]; rowCount: number }>(yes => { resolve = yes }))
    const api = { isDestroyed: () => false, getRowNode: () => undefined, applyServerSideRowData: vi.fn(), getFirstDisplayedRowIndex: () => 0, getDisplayedRowAtIndex: () => undefined } as unknown as GridApi<{ id: string }>
    const initial = { ...EMPTY_DOCUMENT_GRID_SESSION, scope: 'old-sort', rowId: 'group:249', breadcrumbs: [{ id: 'group:249', route: [], index: 249 }] }
    const { result, rerender } = renderHook(({ scope }) => useDocumentGridSession(api, { current: null }, 'view', scope, '', initial, false, { load, getRowId: row => row.id }), { initialProps: { scope: 'old-sort' } })
    act(() => result.current.restore()); await act(async () => scheduled?.(0))
    rerender({ scope: 'new-sort' })
    await act(async () => resolve({ rows: [{ id: 'group:249' }], rowCount: 250 }))
    expect(api.applyServerSideRowData).not.toHaveBeenCalled()
  })
  it('keeps the anchor through a late native block and scrollbar adjustment, then completes on settled scrolling', async () => {
    let scheduled: FrameRequestCallback | undefined, loading = true
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { scheduled = callback; return 1 }); vi.stubGlobal('cancelAnimationFrame', () => undefined)
    const flush = () => act(() => { const callback = scheduled; scheduled = undefined; callback?.(0) })
    const { frame, viewport } = visibleFrame('document:227', 115)
    const node = { id: 'document:227', rowIndex: 115, rowTop: 6440, data: { id: 227 }, level: 0, parent: null }
    const api = { isDestroyed: () => false, getRowNode: () => node, getDisplayedRowAtIndex: () => node, getDisplayedRowCount: () => 128,
      getCacheBlockState: () => ({ child0: { pageStatus: loading ? 'loading' : 'loaded' } }),
      getServerSideGroupLevelState: () => [{ route: [], rowCount: 128, lastRowIndexKnown: true }], ensureIndexVisible: vi.fn(() => { viewport.scrollTop = 6384 }),
    } as unknown as GridApi
    const initial = { ...EMPTY_DOCUMENT_GRID_SESSION, scope: 'scope', firstRow: 115, rowId: node.id, top: 6465, offset: 25 }
    const { result } = renderHook(() => useDocumentGridSession(api, { current: frame }, 'view', 'scope', '', initial, false))
    act(() => result.current.restore()); flush()
    act(() => result.current.bodyScrollEnd())
    expect(readDocumentGridSession('view').rowId).toBeNull()
    viewport.scrollTop = 5778
    act(() => result.current.bodyScrollEnd())
    expect(readDocumentGridSession('view').rowId).toBeNull()
    loading = false
    act(() => result.current.restore()); flush()
    expect(viewport.scrollTop).toBe(6465)
    expect(api.ensureIndexVisible).not.toHaveBeenCalled()
    expect(readDocumentGridSession('view').rowId).toBeNull()
    act(() => result.current.bodyScrollEnd())
    expect(readDocumentGridSession('view')).toMatchObject({ rowId: node.id, top: 6465, firstRow: 115 })
  })
  it('finishes after the last store settles even when no additional scroll event is needed', () => {
    let scheduled: FrameRequestCallback | undefined, loading = true
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { scheduled = callback; return 1 }); vi.stubGlobal('cancelAnimationFrame', () => undefined)
    const flush = () => act(() => { const callback = scheduled; scheduled = undefined; callback?.(0) })
    const { frame, viewport } = visibleFrame('document:115', 115); viewport.scrollTop = 6440
    const node = { id: 'document:115', rowIndex: 115, rowTop: 6440, data: { id: 115 }, level: 0, parent: null }
    const api = { isDestroyed: () => false, getRowNode: () => node, getDisplayedRowAtIndex: () => node, getDisplayedRowCount: () => 200,
      getCacheBlockState: () => ({ next: { pageStatus: loading ? 'loading' : 'needsLoading' } }), getRenderedNodes: () => [node], isAnimationFrameQueueEmpty: () => true,
      getServerSideGroupLevelState: () => [{ route: [], rowCount: 200, lastRowIndexKnown: true }], ensureIndexVisible: vi.fn(),
    } as unknown as GridApi
    const initial = { ...EMPTY_DOCUMENT_GRID_SESSION, scope: 'scope', firstRow: 115, rowId: node.id, top: 6440, offset: 0 }
    const { result } = renderHook(() => useDocumentGridSession(api, { current: frame }, 'view', 'scope', '', initial, false))
    act(() => result.current.restore()); flush(); act(() => result.current.bodyScrollEnd())
    expect(readDocumentGridSession('view').rowId).toBeNull()
    loading = false
    act(() => result.current.restore()); flush()
    expect(readDocumentGridSession('view')).toMatchObject({ rowId: node.id, top: 6440 })
    viewport.scrollTop = 6450; act(() => result.current.capture())
    expect(readDocumentGridSession('view').top).toBe(6450)
  })
  it.each(['wheel', 'touch', 'keyboard'])('lets an explicit %s gesture cancel a restoration whose block is still loading', async input => {
    let scheduled: FrameRequestCallback | undefined, resolve!: (value: { rows: { id: string }[]; rowCount: number }) => void
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { scheduled = callback; return 1 }); vi.stubGlobal('cancelAnimationFrame', () => undefined)
    const load = vi.fn(() => new Promise<{ rows: { id: string }[]; rowCount: number }>(yes => { resolve = yes }))
    const api = { isDestroyed: () => false, getRowNode: () => undefined, applyServerSideRowData: vi.fn(), getDisplayedRowCount: () => 250, getDisplayedRowAtIndex: () => undefined } as unknown as GridApi<{ id: string }>
    const initial = { ...EMPTY_DOCUMENT_GRID_SESSION, scope: 'scope', rowId: 'group:249', breadcrumbs: [{ id: 'group:249', route: [], index: 249 }] }
    const frame = document.createElement('div')
    const { result } = renderHook(() => useDocumentGridSession(api, { current: frame }, 'view', 'scope', '', initial, false, { load, getRowId: row => row.id }))
    act(() => result.current.restore()); await act(async () => scheduled?.(0))
    expect(load).toHaveBeenCalledWith([], 200)
    if (input === 'wheel') fireEvent.wheel(frame, { deltaY: -120 })
    else if (input === 'touch') fireEvent.touchStart(frame)
    else fireEvent.keyDown(frame, { key: 'PageDown' })
    await act(async () => resolve({ rows: [{ id: 'group:249' }], rowCount: 250 }))
    expect(api.applyServerSideRowData).not.toHaveBeenCalled()
  })
  it('explicit document navigation opens its only path and does not overwrite the ordinary registry viewport', () => {
    const api = { isDestroyed: () => false } as GridApi
    writeDocumentGridSession('view', { ...EMPTY_DOCUMENT_GRID_SESSION, scope: 'ordinary', firstRow: 250 })
    const { result } = renderHook(() => useDocumentGridSession(api, { current: null }, 'view', 'navigation', '', readDocumentGridSession('view'), true))
    expect(result.current.initialRowCount).toBe(100)
    expect(result.current.isGroupOpen({ group: true, key: 'A', level: 0, parent: null } as IRowNode)).toBe(true)
    act(() => result.current.capture())
    expect(readDocumentGridSession('view').firstRow).toBe(250)
  })
})
