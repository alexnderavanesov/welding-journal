import { renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { GridApi } from 'ag-grid-community'
import { useJournalScrollPlaceholder } from './use-journal-scroll-placeholder'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.replaceChildren() })

function mount() {
  const pending = new Map<number, FrameRequestCallback>()
  let next = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { pending.set(++next, callback); return next })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => pending.delete(id))
  const frame = document.createElement('div'), viewport = document.createElement('div')
  viewport.className = 'ag-grid-viewport'; frame.append(viewport); document.body.append(frame)
  Object.defineProperty(viewport, 'clientWidth', { value: 800 })
  const listeners = new Map<string, (event?: unknown) => void>()
  const columns = [0, 1, 2, 3, 4].map(i => ({ getPinned: () => null, getActualWidth: (): number => 200, getLeft: () => i * 200, getColId: () => String(i) }))
  const api = {
    isDestroyed: () => false, getDisplayedLeftColumns: () => [], getDisplayedRightColumns: () => [],
    getAllDisplayedVirtualColumns: () => columns,
    addEventListener: (name: string, callback: (event?: unknown) => void) => listeners.set(name, callback),
    removeEventListener: (name: string) => listeners.delete(name),
  } as unknown as GridApi
  const hook = renderHook(() => useJournalScrollPlaceholder({ current: frame }, api, true, 36, 'alpine', true))
  const flush = () => { const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(callback => callback(0)) }
  const fire = (name: string, event?: unknown) => listeners.get(name)?.(event)
  const tile = () => viewport.style.getPropertyValue('--journal-gap-image')
  flush()
  return { ...hook, frame, viewport, columns, flush, fire, tile, pending, listeners }
}

it('keeps the decoded tile during horizontal or diagonal scrolling and updates it after the gesture', () => {
  const view = mount(), initial = view.tile()
  expect(initial).toContain('data:image/svg+xml')
  // A column event can queue paint just before the first scroll notification.
  view.fire('virtualColumnsChanged')
  view.fire('bodyScroll', { direction: 'horizontal' })
  for (const left of [20, 100, 150]) {
    view.viewport.scrollLeft = left
    view.fire('virtualColumnsChanged'); view.flush()
    expect(view.tile()).toBe(initial)
  }
  expect(view.pending.size).toBe(0)
  view.fire('bodyScroll', { direction: 'vertical' })
  view.fire('bodyScrollEnd', { direction: 'vertical' }); view.flush()
  expect(view.tile()).not.toBe(initial)
  view.unmount()
  expect(view.listeners.size).toBe(0)
  expect(view.tile()).toBe('')
})

it('waits for both scrolling and column dragging to finish and does no work for vertical scrolling alone', () => {
  const view = mount(), initial = view.tile()
  view.fire('bodyScroll', { direction: 'vertical' }); view.fire('bodyScrollEnd', { direction: 'vertical' })
  expect(view.pending.size).toBe(0)
  view.fire('bodyScroll', { direction: 'horizontal' })
  view.viewport.scrollLeft = 150
  view.fire('columnResized', { finished: false })
  view.fire('bodyScrollEnd', { direction: 'horizontal' }); view.flush()
  expect(view.tile()).toBe(initial)
  view.fire('columnResized', { finished: true }); view.flush()
  expect(view.tile()).not.toBe(initial)
  view.unmount()
})

it.each(['pointerup', 'pointercancel', 'blur'])('holds the tile before AG delivers its first resize event and releases on %s', endEvent => {
  const view = mount(), initial = view.tile()
  const handle = document.createElement('span')
  handle.className = 'ag-header-cell-resize'; view.frame.append(handle)
  handle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
  // AG updates column geometry before notifying public event listeners.
  view.columns[0].getActualWidth = () => 230
  view.fire('virtualColumnsChanged'); view.flush()
  expect(view.tile()).toBe(initial)
  window.dispatchEvent(new Event(endEvent)); view.flush()
  expect(view.tile()).not.toBe(initial)
  view.unmount()
  window.dispatchEvent(new Event(endEvent))
  expect(view.pending.size).toBe(0)
})
