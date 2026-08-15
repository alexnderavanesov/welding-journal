import { describe, expect, it } from 'vitest'
import { shouldRefetchQueryOnWindowFocus, shouldRetryQuery } from '@/router'
import { shouldRefreshWeldPageOnActivation } from '@/lib/query-refresh-policy'

describe('query refresh policy', () => {
  it('does not refetch fresh data after a short window switch', () => {
    const now = Date.parse('2026-08-13T12:00:00.000Z')
    expect(shouldRefetchQueryOnWindowFocus(now - 60_000, 0, now)).toBe(false)
  })

  it('refreshes data after returning to a window with an old snapshot', () => {
    const now = Date.parse('2026-08-13T12:00:00.000Z')
    expect(shouldRefetchQueryOnWindowFocus(now - 11 * 60_000, 0, now)).toBe(true)
  })

  it('does not retry a recent failed query on every window focus', () => {
    const now = Date.parse('2026-08-13T12:00:00.000Z')
    expect(shouldRefetchQueryOnWindowFocus(0, now - 60_000, now)).toBe(false)
  })

  it('allows only one retry for a failed read request', () => {
    expect(shouldRetryQuery(0)).toBe(true)
    expect(shouldRetryQuery(1)).toBe(false)
    expect(shouldRetryQuery(2)).toBe(false)
  })

  it('refreshes a paged report on activation when it is old or explicitly marked', () => {
    const now = Date.parse('2026-08-13T12:00:00.000Z')
    expect(shouldRefreshWeldPageOnActivation(now - 30_000, false, now)).toBe(false)
    expect(shouldRefreshWeldPageOnActivation(now - 61_000, false, now)).toBe(true)
    expect(shouldRefreshWeldPageOnActivation(now - 1_000, true, now)).toBe(true)
  })
})
