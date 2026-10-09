import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useDispatcherActivityCheck } from '@/lib/use-dispatcher-activity-check'

beforeEach(() => { vi.useFakeTimers(); Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }) })
afterEach(() => { vi.useRealTimers() })
const tick = () => act(async () => { await vi.advanceTimersByTimeAsync(250) })
it('coalesces open/focus/visibility and never polls', async () => {
  const check = vi.fn(async () => {})
  const { rerender } = renderHook(({ open }) => useDispatcherActivityCheck({ enabled: true, workspaceOpen: open, check }), { initialProps: { open: false } })
  await tick(); expect(check).not.toHaveBeenCalled()
  rerender({ open: true }); window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange'))
  await tick(); expect(check).toHaveBeenCalledTimes(1)
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
  expect(check).toHaveBeenCalledTimes(1)
  rerender({ open: false }); rerender({ open: true }); await tick()
  expect(check).toHaveBeenCalledTimes(2)
})
it('skips hidden, disabled, unmounted and in-flight requests', async () => {
  let finish!: () => void
  const check = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
  const { rerender, unmount } = renderHook(({ enabled }) => useDispatcherActivityCheck({ enabled, workspaceOpen: false, check }), { initialProps: { enabled: true } })
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
  window.dispatchEvent(new Event('focus')); await tick(); expect(check).not.toHaveBeenCalled()
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  window.dispatchEvent(new Event('focus')); await tick(); expect(check).toHaveBeenCalledTimes(1)
  window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); await tick(); expect(check).toHaveBeenCalledTimes(1)
  await act(async () => { finish() }); rerender({ enabled: false })
  window.dispatchEvent(new Event('focus')); await tick(); expect(check).toHaveBeenCalledTimes(1)
  rerender({ enabled: true }); window.dispatchEvent(new Event('focus')); unmount(); await tick(); expect(check).toHaveBeenCalledTimes(1)
})
