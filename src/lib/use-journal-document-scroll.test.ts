import { renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { GridApi } from 'ag-grid-community'
import { useJournalDocumentScroll } from './use-journal-document-scroll'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.replaceChildren() })
function mount(pageTop = 0, nativeMotion = false, trailingSpace?: number, withBottomCover = false) {
  vi.stubGlobal('CSS', { supports: () => nativeMotion })
  let resized!: ResizeObserverCallback
  vi.stubGlobal('ResizeObserver', class { constructor(callback: ResizeObserverCallback) { resized = callback } observe() {} disconnect() {} })
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('scrollY', pageTop)
  const documentHeight = vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(10000)
  const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  scroll.mockClear()
  document.body.innerHTML = '<div id="track"><div id="stage"><div id="frame"><div class="ag-grid-viewport"><div class="ag-grid-scrollable-area"><div class="ag-grid-scrolling-rows"><div class="ag-grid-scrolling-container"></div></div></div></div></div><div class="journal-footer"></div></div></div>'
  Object.defineProperty(document.querySelector('.journal-footer'), 'offsetHeight', { get: () => 30 })
  const bottomCover = withBottomCover ? document.body.appendChild(document.createElement('div')) : undefined
  const track = document.querySelector<HTMLDivElement>('#track')!
  vi.spyOn(track, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 200 - window.scrollY, 1000, parseFloat(track.style.height) || 500))
  if (trailingSpace !== undefined) {
    const boundary = document.createElement('div')
    boundary.setAttribute('data-scroll-top-boundary', '')
    track.replaceWith(boundary); boundary.append(track)
    vi.spyOn(boundary, 'getBoundingClientRect').mockImplementation(() =>
      new DOMRect(0, -window.scrollY, 1000, 200 + (parseFloat(track.style.height) || 500) + trailingSpace))
  }
  const viewport = document.querySelector<HTMLElement>('.ag-grid-viewport')!
  const area = document.querySelector<HTMLElement>('.ag-grid-scrollable-area')!
  let extent = 5000
  Object.defineProperties(viewport, { scrollHeight: { configurable: true, get: () => extent }, clientHeight: { configurable: true, get: () => 500 } })
  Object.defineProperty(area, 'clientHeight', { configurable: true, get: () => extent })
  let modelUpdated!: () => void
  const api = { isDestroyed: () => false, getRowGroupColumns: () => [], addEventListener: (_name: string, callback: () => void) => { modelUpdated = callback }, removeEventListener: vi.fn() } as unknown as GridApi
  const hook = renderHook(() => useJournalDocumentScroll({ current: track }, { current: document.querySelector<HTMLDivElement>('#stage') },
    { current: document.querySelector<HTMLDivElement>('#frame') }, api, true, 0, undefined, bottomCover))
  return { ...hook, track, viewport, scroll, documentHeight, bottomCover, modelUpdated: () => modelUpdated(), extent: (next: number) => { extent = next },
    resized: (target: Element, width: number, height: number) => resized([{ target, contentRect: { width, height } } as ResizeObserverEntry], {} as ResizeObserver) }
}

it.each([12, 20, 21])('reserves the actual %i px of trailing page padding and borders', trailingSpace => {
  const view = mount(0, false, trailingSpace)
  expect(document.querySelector<HTMLElement>('#stage')!.style.height).toBe(`${window.innerHeight - 200 - trailingSpace}px`)
  view.unmount()
})

it('anchors the footer to the report width and releases it in a viewport too short for the heading', () => {
  const view = mount(0, false, 20)
  const stage = document.querySelector<HTMLElement>('#stage')!
  expect(stage.hasAttribute('data-journal-docked-footer')).toBe(true)
  expect(stage.style.getPropertyValue('--journal-footer-height')).toBe('30px')
  expect(stage.style.getPropertyValue('--journal-footer-bottom')).toBe('20px')
  vi.mocked(view.track.getBoundingClientRect).mockImplementation(() => new DOMRect(64, 200 - window.scrollY, 800, parseFloat(view.track.style.height) || 500))
  view.resized(view.track, 800, 500)
  vi.mocked(requestAnimationFrame).mock.calls.at(-1)![0](0)
  expect(stage.style.getPropertyValue('--journal-footer-left')).toBe('64px')
  expect(stage.style.getPropertyValue('--journal-footer-width')).toBe('800px')
  vi.stubGlobal('innerHeight', 300)
  window.dispatchEvent(new Event('resize'))
  vi.mocked(requestAnimationFrame).mock.calls.at(-1)![0](0)
  expect(stage.hasAttribute('data-journal-docked-footer')).toBe(false)
  view.unmount()
  expect(stage.style.getPropertyValue('--journal-footer-height')).toBe('')
})

it('keeps the detached bottom cover aligned on resize and releases it with the footer', () => {
  const view = mount(0, false, 22, true)
  const cover = view.bottomCover!
  expect(cover.parentElement).toBe(document.body)
  expect(cover.hasAttribute('data-journal-docked-footer')).toBe(true)
  expect(cover.style.getPropertyValue('--journal-footer-bottom')).toBe('22px')
  vi.mocked(view.track.getBoundingClientRect).mockImplementation(() => new DOMRect(64, 200, 800, parseFloat(view.track.style.height)))
  view.resized(view.track, 800, 500)
  vi.mocked(requestAnimationFrame).mock.calls.at(-1)![0](0)
  expect(cover.style.getPropertyValue('--journal-footer-left')).toBe('64px')
  expect(cover.style.getPropertyValue('--journal-footer-width')).toBe('800px')
  vi.stubGlobal('innerHeight', 300)
  window.dispatchEvent(new Event('resize'))
  vi.mocked(requestAnimationFrame).mock.calls.at(-1)![0](0)
  expect(cover.hasAttribute('data-journal-docked-footer')).toBe(false)
  view.unmount()
  expect(cover.style.getPropertyValue('--journal-footer-bottom')).toBe('')
})

it('uses the reduced content height after grouping, excluding the previous translated row overflow', () => {
  const view = mount(1200, true)
  view.extent(500)
  // WebKit can still include the old compensating row translation in the
  // viewport's scrollHeight when the newly grouped content already fits.
  vi.spyOn(view.viewport, 'scrollHeight', 'get').mockReturnValue(6000)
  view.modelUpdated()
  vi.mocked(requestAnimationFrame).mock.calls.at(-1)![0](0)
  expect(view.track.style.height).toBe(document.querySelector<HTMLElement>('#stage')!.style.height)
  expect(view.viewport.scrollTop).toBe(0)
  expect(document.querySelector<HTMLElement>('.ag-grid-scrolling-container')!.style.translate).toBe('0 0px')
  view.unmount()
})

it('does not resize the table during elastic overscroll above the document', () => {
  const view = mount()
  const stage = document.querySelector<HTMLElement>('#stage')!
  const height = stage.style.height
  const raf = vi.mocked(requestAnimationFrame)
  raf.mockClear()
  for (const y of [-12, -70, -35, -2, 0]) {
    vi.stubGlobal('scrollY', y)
    window.dispatchEvent(new Event('scroll'))
    const scheduled = raf.mock.calls.at(-1)
    if (scheduled) scheduled[0](0)
    expect(stage.style.height).toBe(height)
    expect(view.viewport.scrollTop).toBe(0)
    expect(view.scroll).not.toHaveBeenCalled()
  }
  expect(raf).not.toHaveBeenCalled()
  view.unmount()
})

it('resizes during the heading scroll event so the footer does not lag a frame', () => {
  const view = mount()
  const stage = document.querySelector<HTMLElement>('#stage')!
  const height = parseFloat(stage.style.height)
  const raf = vi.mocked(requestAnimationFrame)
  raf.mockClear()
  for (const y of [20, 80, 40, 0]) {
    vi.stubGlobal('scrollY', y)
    window.dispatchEvent(new Event('scroll'))
    expect(stage.style.height).toBe(`${height + y}px`)
  }
  expect(raf).not.toHaveBeenCalled()
  view.unmount()
})

it('does not grow a short table or create scroll room from a bottom bounce', () => {
  const view = mount()
  view.extent(500)
  view.documentHeight.mockReturnValue(window.innerHeight)
  view.modelUpdated()
  const raf = vi.mocked(requestAnimationFrame)
  raf.mock.calls.at(-1)![0](0)
  raf.mockClear()
  const stage = document.querySelector<HTMLElement>('#stage')!
  const height = stage.style.height, trackHeight = view.track.style.height
  for (const y of [10, 70, 30, 2, 0]) {
    vi.stubGlobal('scrollY', y)
    window.dispatchEvent(new Event('scroll'))
    const scheduled = raf.mock.calls.at(-1)
    if (scheduled) scheduled[0](0)
    expect(stage.style.height).toBe(height)
    expect(view.track.style.height).toBe(trackHeight)
    expect(view.viewport.scrollTop).toBe(0)
    expect(view.scroll).not.toHaveBeenCalled()
  }
  expect(raf).not.toHaveBeenCalled()
  view.unmount()
})

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
  const view = mount(1200, true)
  expect(view.viewport.scrollTop).toBe(1000)
  view.extent(700)
  vi.spyOn(view.viewport, 'scrollHeight', 'get').mockReturnValue(5000)
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
  const layout = vi.spyOn(document.querySelector<HTMLElement>('.ag-grid-scrollable-area')!, 'clientHeight', 'get')
  const height = vi.spyOn(view.viewport, 'clientHeight', 'get')
  view.documentHeight.mockClear()
  vi.stubGlobal('scrollY', 1280)
  window.dispatchEvent(new Event('scroll'))
  expect(view.viewport.scrollTop).toBe(1080)
  expect(geometry).not.toHaveBeenCalled()
  view.viewport.dispatchEvent(new Event('scroll'))
  expect(extent).not.toHaveBeenCalled()
  expect(layout).not.toHaveBeenCalled()
  expect(height).not.toHaveBeenCalled()
  expect(view.documentHeight).not.toHaveBeenCalled()
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
