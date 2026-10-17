import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useJournalPageScroll } from './use-journal-page-scroll'

afterEach(() => { cleanup(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function gridScroll(reducedMotion: boolean) {
  let pageY = 0, frameId = 0
  const pending = new Map<number, FrameRequestCallback>()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { pending.set(++frameId, callback); return frameId })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => pending.delete(id))
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: reducedMotion } as MediaQueryList))
  vi.spyOn(performance, 'now').mockReturnValue(0)
  vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => pageY)
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800)
  vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(2000)
  const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation((options: ScrollToOptions | number) => { if (typeof options === 'object') pageY += options.top ?? 0 })
  const frame = document.createElement('div'), viewport = document.createElement('div')
  viewport.className = 'ag-grid-viewport'
  frame.append(viewport); document.body.append(frame)
  vi.spyOn(frame, 'getBoundingClientRect').mockImplementation(() => ({ top: 300 - pageY } as DOMRect))
  renderHook(() => useJournalPageScroll({ current: frame }, 100))
  const wheel = (target: Element, deltaY = 300) => {
    const event = new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true })
    act(() => target.dispatchEvent(event))
    return event
  }
  const flush = (time: number) => act(() => {
    const callbacks = [...pending.values()]; pending.clear()
    callbacks.forEach(callback => callback(time))
  })
  return { viewport, scrollBy, wheel, flush, pending, pageY: () => pageY }
}

describe('document grid sticky navigation handoff', () => {
  it.each([false, true])('cancels the queued handoff when the gesture reverses (reduced motion: %s)', reducedMotion => {
    const state = gridScroll(reducedMotion)
    expect(state.wheel(state.viewport).defaultPrevented).toBe(true)
    if (!reducedMotion) state.flush(80)
    const before = { page: state.pageY(), grid: state.viewport.scrollTop }
    expect(state.pending.size).toBe(1)
    expect(state.wheel(state.viewport, -10).defaultPrevented).toBe(false)
    expect(state.pending.size).toBe(0)
    state.flush(100)
    expect({ page: state.pageY(), grid: state.viewport.scrollTop }).toEqual(before)
  })

  for (const offset of [0, 100]) it(`stops page scrolling at the ${offset}px sticky boundary, then keeps the remaining gesture inside the grid`, () => {
    let pageY = 0, callback: FrameRequestCallback | undefined
    vi.stubGlobal('requestAnimationFrame', (next: FrameRequestCallback) => { callback = next; return 1 })
    vi.stubGlobal('cancelAnimationFrame', () => undefined)
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    vi.stubGlobal('matchMedia', () => ({ matches: true } as MediaQueryList))
    vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => pageY)
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800)
    vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(2000)
    vi.spyOn(window, 'scrollBy').mockImplementation((options: ScrollToOptions | number) => { if (typeof options === 'object') pageY += options.top ?? 0 })
    const frame = document.createElement('div'), viewport = document.createElement('div')
    viewport.className = 'ag-grid-viewport'; frame.append(viewport); document.body.append(frame)
    vi.spyOn(frame, 'getBoundingClientRect').mockImplementation(() => ({ top: 300 - pageY } as DOMRect))
    renderHook(() => useJournalPageScroll({ current: frame }, offset))
    const event = new WheelEvent('wheel', { deltaY: 300, deltaX: 40, bubbles: true, cancelable: true })
    act(() => viewport.dispatchEvent(event))
    expect(event.defaultPrevented).toBe(true)
    act(() => callback?.(0))
    expect(pageY).toBe(300 - offset)
    expect(frame.getBoundingClientRect().top).toBe(offset)
    expect(viewport.scrollTop).toBe(offset)
    expect(viewport.scrollLeft).toBe(40)
    const next = new WheelEvent('wheel', { deltaY: 50, bubbles: true, cancelable: true })
    act(() => viewport.dispatchEvent(next))
    expect(next.defaultPrevented).toBe(false)
    frame.remove()
  })
})
