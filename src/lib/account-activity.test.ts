import { afterEach, describe, expect, it, vi } from 'vitest'
import { ACCOUNT_ACTIVITY_REFRESH_MS, watchAccountActivity } from './account-activity'

let stop: (() => void) | undefined
afterEach(() => { stop?.(); stop = undefined; vi.useRealTimers(); vi.restoreAllMocks() })

describe('account activity refresh', () => {
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
