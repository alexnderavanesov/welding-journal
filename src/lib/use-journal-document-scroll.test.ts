import { renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { GridApi } from 'ag-grid-community'
import { useJournalDocumentScroll } from './use-journal-document-scroll'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.replaceChildren() })
function mount(pageTop = 0, nativeMotion = false) {
  vi.stubGlobal('CSS', { supports: () => nativeMotion })
  let resized!: ResizeObserverCallback
  vi.stubGlobal('ResizeObserver', class { constructor(callback: ResizeObserverCallback) { resized = callback } observe() {} disconnect() {} })
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('scrollY', pageTop)
  const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  scroll.mockClear()
  document.body.innerHTML = '<div id="track"><div id="stage"><div id="frame"><div class="ag-grid-viewport"><div class="ag-grid-scrollable-area"><div class="ag-grid-scrolling-rows"><div class="ag-grid-scrolling-container"></div></div></div></div></div></div></div>'
  const track = document.querySelector<HTMLDivElement>('#track')!
  vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({ top: 200 - pageTop } as DOMRect)
  const viewport = document.querySelector<HTMLElement>('.ag-grid-viewport')!
  let extent = 5000
  Object.defineProperties(viewport, { scrollHeight: { configurable: true, get: () => extent }, clientHeight: { configurable: true, get: () => 500 } })
  let modelUpdated!: () => void
  const api = { isDestroyed: () => false, getRowGroupColumns: () => [], addEventListener: (_name: string, callback: () => void) => { modelUpdated = callback }, removeEventListener: vi.fn() } as unknown as GridApi
  const hook = renderHook(() => useJournalDocumentScroll({ current: track }, { current: document.querySelector<HTMLDivElement>('#stage') },
    { current: document.querySelector<HTMLDivElement>('#frame') }, api, true))
  return { ...hook, track, viewport, scroll, modelUpdated: () => modelUpdated(), extent: (next: number) => { extent = next },
    resized: (target: Element, width: number, height: number) => resized([{ target, contentRect: { width, height } } as ResizeObserverEntry], {} as ResizeObserver) }
}

it('ignores width-only column drags but still synchronises changed heights and window sizes', () => {
  const view = mount()
  const raf = vi.mocked(requestAnimationFrame)
  view.resized(view.viewport, 1000, 500)
  raf.mock.calls.at(-1)![0](0)
  raf.mockClear()
  view.resized(view.viewport, 1180, 500)
  view.resized(view.viewport, 1050, 500)
  expect(raf).not.toHaveBeenCalled()
  view.resized(view.viewport, 1050, 480)
  expect(raf).toHaveBeenCalledOnce()
  raf.mock.calls.at(-1)![0](0)
  raf.mockClear()
  window.dispatchEvent(new Event('resize'))
  expect(raf).toHaveBeenCalledOnce()
  view.unmount()
})

it('keeps a grid navigation move when a model/layout frame is already pending', () => {
  const view = mount()
  view.modelUpdated()
  view.viewport.scrollTop = 1000
  view.viewport.dispatchEvent(new Event('scroll'))
  expect(view.scroll).toHaveBeenCalledWith({ top: 1200, behavior: 'instant' })
  view.unmount()
})
it('does not interpret a model-induced scroll clamp as navigation', () => {
  const view = mount(1200)
  expect(view.viewport.scrollTop).toBe(1000)
  view.extent(700)
  view.viewport.scrollTop = 200
  view.viewport.dispatchEvent(new Event('scroll'))
  expect(view.scroll).not.toHaveBeenCalled()
  view.unmount()
})
it('updates rows in the document scroll event without another frame or layout measurement', () => {
  const view = mount(1200)
  const geometry = vi.mocked(view.track.getBoundingClientRect)
  geometry.mockClear()
  const extent = vi.spyOn(view.viewport, 'scrollHeight', 'get')
  const height = vi.spyOn(view.viewport, 'clientHeight', 'get')
  vi.stubGlobal('scrollY', 1280)
  window.dispatchEvent(new Event('scroll'))
  expect(view.viewport.scrollTop).toBe(1080)
  expect(geometry).not.toHaveBeenCalled()
  view.viewport.dispatchEvent(new Event('scroll'))
  expect(extent).not.toHaveBeenCalled()
  expect(height).not.toHaveBeenCalled()
  expect(view.scroll).not.toHaveBeenCalled()
  view.unmount()
})

it('maps native document motion directly and cancels only the inner scroll offset', () => {
  const view = mount(1200, true)
  const body = document.querySelector<HTMLElement>('.ag-grid-scrolling-rows')!
  const rows = document.querySelector<HTMLElement>('.ag-grid-scrolling-container')!
  expect(body.hasAttribute('data-journal-native-scroll')).toBe(true)
  expect(body.style.getPropertyValue('animation-range')).toBe('200px 4700px')
  expect(body.style.getPropertyValue('--journal-scroll-distance')).toBe('4500px')
  expect(rows.style.translate).toBe('0 1000px')
  vi.stubGlobal('scrollY', 1280)
  window.dispatchEvent(new Event('scroll'))
  expect(rows.style.translate).toBe('0 1080px')
  // Keyboard navigation is still owned by the native grid, then the document.
  view.viewport.scrollTop = 1400
  view.viewport.dispatchEvent(new Event('scroll'))
  expect(rows.style.translate).toBe('0 1400px')
  expect(view.scroll).toHaveBeenCalledWith({ top: 1600, behavior: 'instant' })
  view.unmount()
  expect(body.hasAttribute('data-journal-native-scroll')).toBe(false)
  expect(body.style.getPropertyValue('animation-range')).toBe('')
  expect(rows.style.translate).toBe('')
})

it('leaves unsupported browsers on the existing scroll path without transforms', () => {
  const view = mount(1200)
  expect(document.querySelector('[data-journal-native-scroll]')).toBeNull()
  expect(document.querySelector<HTMLElement>('.ag-grid-scrolling-container')!.style.translate).toBe('')
  expect(view.viewport.scrollTop).toBe(1000)
  view.unmount()
})
