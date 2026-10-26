import { StrictMode, useRef } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useGridResultMotion } from './use-grid-result-motion'

const originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate')
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers()
  if (originalAnimate) Object.defineProperty(HTMLElement.prototype, 'animate', originalAnimate)
  else Reflect.deleteProperty(HTMLElement.prototype, 'animate')
})

function setup() {
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 16))
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id))
  const listeners = new Set<() => void>()
  const media = { matches: false, addEventListener: (_: string, fn: () => void) => listeners.add(fn), removeEventListener: (_: string, fn: () => void) => listeners.delete(fn) }
  vi.stubGlobal('matchMedia', () => media)
  const animations: { cancel: ReturnType<typeof vi.fn>; onfinish: (() => void) | null }[] = []
  const animate = vi.fn(() => { const animation = { cancel: vi.fn(), onfinish: null }; animations.push(animation); return animation as unknown as Animation })
  vi.stubGlobal('Animation', class {})
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate })
  let motion!: ReturnType<typeof useGridResultMotion>
  function Harness({ hidden = false, ready = true }: { hidden?: boolean; ready?: boolean }) {
    const frame = useRef<HTMLDivElement>(null)
    motion = useGridResultMotion(frame, { ready })
    return <div ref={frame} hidden={hidden} aria-busy={!ready}><header>Header</header><div className="ag-grid-scrolling-container"><button>Result</button></div></div>
  }
  const view = render(<StrictMode><Harness /></StrictMode>)
  return { view, Harness, motion, animate, animations, media, listeners }
}

it('coalesces rapid results and cancels old animations through forty replacements without touching focus or data', async () => {
  const { view, motion, animate, animations } = setup()
  const button = view.getByRole('button'); button.focus()
  for (let i = 0; i < 40; i++) {
    act(() => { motion.reveal(); motion.reveal(); motion.reveal() })
    await act(() => vi.advanceTimersByTimeAsync(16))
    expect(animate).toHaveBeenCalledTimes(i + 1)
    expect(document.activeElement).toBe(button)
    expect(view.getByRole('button')).toBe(button)
  }
  expect(animations.slice(0, -1).every(animation => animation.cancel.mock.calls.length === 1)).toBe(true)
  expect(animate).toHaveBeenLastCalledWith([{ opacity: .84 }, { opacity: 1 }], { duration: 150, easing: 'ease-out' })
  act(() => motion.cancel())
  expect(animations.at(-1)!.cancel).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})

it('waits for the committed ready state without polling and can cancel a pending reveal', async () => {
  const { view, Harness, motion, animate } = setup()
  view.rerender(<StrictMode><Harness ready={false} /></StrictMode>)
  act(() => motion.reveal())
  await act(() => vi.advanceTimersByTimeAsync(100))
  expect(animate).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
  view.rerender(<StrictMode><Harness ready /></StrictMode>)
  await act(() => vi.advanceTimersByTimeAsync(16))
  expect(animate).toHaveBeenCalledOnce()
  expect((animate.mock.instances[0] as unknown as HTMLElement).closest('[aria-busy]')).toHaveAttribute('aria-busy', 'false')
  view.rerender(<StrictMode><Harness ready={false} /></StrictMode>)
  act(() => { motion.reveal(); motion.cancel() })
  view.rerender(<StrictMode><Harness ready /></StrictMode>)
  await act(() => vi.advanceTimersByTimeAsync(100))
  expect(animate).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})

it('cancels on unmount and live reduced-motion changes, and skips hidden cached workspaces', async () => {
  const { view, Harness, motion, animate, animations, media, listeners } = setup()
  act(() => motion.reveal())
  await act(() => vi.advanceTimersByTimeAsync(16))
  act(() => { media.matches = true; listeners.forEach(listener => listener()) })
  expect(animations[0].cancel).toHaveBeenCalledOnce()
  act(() => motion.reveal())
  await act(() => vi.advanceTimersByTimeAsync(16))
  expect(animate).toHaveBeenCalledOnce()
  media.matches = false
  view.rerender(<StrictMode><Harness hidden /></StrictMode>)
  act(() => motion.reveal())
  await act(() => vi.advanceTimersByTimeAsync(16))
  expect(animate).toHaveBeenCalledOnce()
  act(() => motion.reveal())
  view.unmount()
  await act(() => vi.advanceTimersByTimeAsync(16))
  expect(animate).toHaveBeenCalledOnce()
  expect(listeners.size).toBe(0)
  expect(vi.getTimerCount()).toBe(0)
})
