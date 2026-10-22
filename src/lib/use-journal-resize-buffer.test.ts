import { renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { GridApi } from 'ag-grid-community'
import { useJournalResizeBuffer } from './use-journal-resize-buffer'

afterEach(() => vi.restoreAllMocks())
function mount(enabled = true) {
  const listeners = new Map<string, (event: unknown) => void>()
  let buffer: number | undefined = 8
  const set = vi.fn((_key, value) => { buffer = value })
  const api = { isDestroyed: () => false, getGridOption: () => buffer, setGridOption: set,
    addEventListener: (name: string, callback: (event: unknown) => void) => listeners.set(name, callback),
    removeEventListener: (name: string) => listeners.delete(name) } as unknown as GridApi
  const hook = renderHook(() => useJournalResizeBuffer(api, enabled))
  return { ...hook, set, buffer: () => buffer, listeners,
    resize: (finished: boolean, source = 'uiColumnResized') => listeners.get('columnResized')?.({ finished, source }) }
}
it('reduces only a user drag once and restores the original overscan on release', () => {
  const view = mount()
  view.resize(false, 'api'); expect(view.set).not.toHaveBeenCalled()
  view.resize(false); view.resize(false)
  expect(view.set.mock.calls).toEqual([['rowBuffer', 0]])
  view.resize(true)
  expect(view.buffer()).toBe(8)
  view.resize(false)
  view.listeners.get('dragStopped')?.({})
  expect(view.buffer()).toBe(8)
  view.unmount()
})
it('restores ordinary scrolling/navigation immediately and does not shrink again in that drag', () => {
  const view = mount()
  for (const type of ['wheel', 'keydown', 'blur']) {
    view.resize(false); expect(view.buffer()).toBe(0)
    window.dispatchEvent(new Event(type)); expect(view.buffer()).toBe(8)
    view.resize(false); expect(view.buffer()).toBe(8)
    view.resize(true)
  }
  view.resize(false); view.unmount()
  expect(view.buffer()).toBe(8)
  expect(view.listeners.size).toBe(0)
})
it('does not change the other reports', () => {
  const view = mount(false)
  expect(view.listeners.size).toBe(0)
  expect(view.set).not.toHaveBeenCalled()
  view.unmount()
})
