import { afterEach, describe, expect, it, vi } from 'vitest'
import { ACCOUNT_ACTIVITY_REFRESH_MS, watchAccountActivity } from './account-activity'

let stop: (() => void) | undefined
afterEach(() => { stop?.(); stop = undefined; vi.useRealTimers(); vi.restoreAllMocks() })

describe('account activity refresh', () => {
  const drain = async () => { await Promise.resolve(); await Promise.resolve() }
  const pendingRefresh = () => {
    const resolve: (() => void)[] = []
    return { resolve, refresh: vi.fn(() => new Promise<void>(done => resolve.push(done))) }
  }

  it('shares a pending focus/visibility check, without caching a completed response or wrapping explicit refresh', async () => {
    vi.useFakeTimers(); vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    const { refresh, resolve } = pendingRefresh()
    stop = watchAccountActivity(refresh)
    resolve[0](); await drain()
    document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus'))
    expect(refresh).toHaveBeenCalledTimes(2)
    // Manual refresh (sign-in, permission change, expired access) remains an
    // independent callback. Only the activity watcher shares its own request.
    void refresh(); expect(refresh).toHaveBeenCalledTimes(3)
    resolve[1](); resolve[2](); await drain()
    window.dispatchEvent(new Event('focus'))
    expect(refresh).toHaveBeenCalledTimes(4)
    resolve[3](); await drain()
  })

  it('starts a fresh check after a hidden interval and does not let an older completion clear the newer pending check', async () => {
    vi.useFakeTimers(); const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    const { refresh, resolve } = pendingRefresh()
    stop = watchAccountActivity(refresh)
    visibility.mockReturnValue('hidden'); document.dispatchEvent(new Event('visibilitychange'))
    visibility.mockReturnValue('visible'); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus'))
    expect(refresh).toHaveBeenCalledTimes(2)
    resolve[0](); await drain(); window.dispatchEvent(new Event('focus'))
    expect(refresh).toHaveBeenCalledTimes(2)
    resolve[1](); await drain()
  })

  it('allows another attempt after one second if the previous request hangs, then coalesces only the new pending check', async () => {
    vi.useFakeTimers(); vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    const { refresh, resolve } = pendingRefresh()
    stop = watchAccountActivity(refresh)
    window.dispatchEvent(new Event('focus')); expect(refresh).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1001)
    window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange'))
    expect(refresh).toHaveBeenCalledTimes(2)
    for (const done of resolve) done(); await drain()
  })

  it('does not keep an idle tab online and refreshes immediately on returning activity, with bounded requests', () => {
    vi.useFakeTimers()
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    const refresh = vi.fn(async () => {})
    stop = watchAccountActivity(refresh)
    expect(refresh).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(4 * ACCOUNT_ACTIVITY_REFRESH_MS)
    expect(refresh).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new Event('keydown'))
    expect(refresh).toHaveBeenCalledTimes(2)
    for (let i = 0; i < 100; i++) window.dispatchEvent(new Event('wheel'))
    expect(refresh).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(30_000)
    window.dispatchEvent(new Event('pointerdown'))
    vi.advanceTimersByTime(30_000)
    expect(refresh).toHaveBeenCalledTimes(3)
    stop(); stop = undefined
    window.dispatchEvent(new Event('focus'))
    vi.advanceTimersByTime(2 * ACCOUNT_ACTIVITY_REFRESH_MS)
    expect(refresh).toHaveBeenCalledTimes(3)
  })

  it('does not send activity from hidden tabs and refreshes on visibility/focus restoration', () => {
    vi.useFakeTimers()
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    const refresh = vi.fn(async () => {})
    stop = watchAccountActivity(refresh)
    visibility.mockReturnValue('hidden')
    vi.advanceTimersByTime(ACCOUNT_ACTIVITY_REFRESH_MS)
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('keydown'))
    document.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(ACCOUNT_ACTIVITY_REFRESH_MS)
    expect(refresh).toHaveBeenCalledTimes(1)
    visibility.mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(refresh).toHaveBeenCalledTimes(2)
  })
})
