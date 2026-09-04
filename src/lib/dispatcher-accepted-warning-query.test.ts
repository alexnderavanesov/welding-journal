import { describe, expect, it } from 'vitest'
import {
  clampDispatcherAcceptedWarningPage,
  getDispatcherAcceptedWarningCategoryLabel,
  getDispatcherAcceptedWarningPeriodStart,
  normalizeDispatcherAcceptedWarningsRequest,
} from '@/lib/dispatcher-accepted-warning-query'

describe('normalizeDispatcherAcceptedWarningsRequest', () => {
  it('uses bounded defaults for an empty request', () => {
    expect(normalizeDispatcherAcceptedWarningsRequest(undefined)).toEqual({
      search: '',
      category: 'all',
      period: 'all',
      sort: 'newest',
      page: 1,
      pageSize: 50,
    })
  })

  it('keeps supported filters and normalizes pagination', () => {
    expect(normalizeDispatcherAcceptedWarningsRequest({
      search: `  ${'a'.repeat(220)}  `,
      category: 'early-coil',
      period: '30d',
      sort: 'oldest',
      page: 3.9,
      pageSize: 100,
    })).toEqual({
      search: 'a'.repeat(200),
      category: 'early-coil',
      period: '30d',
      sort: 'oldest',
      page: 3,
      pageSize: 100,
    })
  })

  it('rejects unsupported values and page sizes', () => {
    expect(normalizeDispatcherAcceptedWarningsRequest({
      category: 'unknown' as never,
      period: 'year' as never,
      sort: 'random' as never,
      page: Number.POSITIVE_INFINITY,
      pageSize: 500,
    })).toEqual({
      search: '',
      category: 'all',
      period: 'all',
      sort: 'newest',
      page: 1,
      pageSize: 50,
    })
  })
})

describe('accepted warning display helpers', () => {
  it('clamps a stale or manipulated page to the available range', () => {
    expect(clampDispatcherAcceptedWarningPage(1_000_000, 52, 50)).toBe(2)
    expect(clampDispatcherAcceptedWarningPage(3, 0, 50)).toBe(1)
  })

  it('groups known and legacy kinds into readable categories', () => {
    expect(getDispatcherAcceptedWarningCategoryLabel('percentage-line-control')).toBe('Процентная линия')
    expect(getDispatcherAcceptedWarningCategoryLabel('early-coil')).toBe('Досрочная катушка')
    expect(getDispatcherAcceptedWarningCategoryLabel('legacy-kind')).toBe('Исключение')
  })

  it('builds a stable lower boundary for a selected period', () => {
    const now = Date.UTC(2026, 8, 4, 12)
    expect(getDispatcherAcceptedWarningPeriodStart('7d', now)?.toISOString()).toBe('2026-08-28T12:00:00.000Z')
    expect(getDispatcherAcceptedWarningPeriodStart('all', now)).toBeNull()
  })
})
