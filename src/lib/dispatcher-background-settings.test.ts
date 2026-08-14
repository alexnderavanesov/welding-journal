import { describe, expect, it } from 'vitest'
import {
  buildDisabledDispatcherSettings,
  DISPATCHER_BACKGROUND_REFRESH_ENABLED,
  getEnabledDispatcherTaskCodes,
  shouldRefreshDispatcherBackgroundIndex,
} from '@/lib/dispatcher-background-settings'
import { DEFAULT_DISPATCHER_SETTINGS } from '@/lib/dispatcher-settings'

describe('dispatcher background settings', () => {
  it('keeps Netlify background refresh paused', () => {
    expect(DISPATCHER_BACKGROUND_REFRESH_ENABLED).toBe(false)
  })

  it('calculates only disabled row checks and never turns reminders into row tasks', () => {
    const current = {
      ...DEFAULT_DISPATCHER_SETTINGS,
      'check-welder-stamp': false,
      'check-joint-core-data': false,
      'line-percent': false,
      'welder-stamp-expiry': false,
      'welder-dls-expiry': false,
    }
    const background = buildDisabledDispatcherSettings(current)

    expect(background['check-welder-stamp']).toBe(true)
    expect(background['check-joint-core-data']).toBe(true)
    expect(background['line-percent']).toBe(true)
    expect(background['percentage-new-welder']).toBe(false)
    expect(background['welder-stamp-expiry']).toBe(false)
    expect(background['welder-dls-expiry']).toBe(false)
  })

  it('refreshes once per Moscow business date unless the user forces a refresh', () => {
    const computedAt = new Date('2026-08-10T21:30:00.000Z') // 11 August in Moscow

    expect(shouldRefreshDispatcherBackgroundIndex(computedAt, {
      computedSourceRevision: 5,
      now: new Date('2026-08-11T20:59:00.000Z'),
      sourceRevision: 5,
    })).toBe(false)
    expect(shouldRefreshDispatcherBackgroundIndex(computedAt, {
      computedSourceRevision: 5,
      now: new Date('2026-08-11T21:01:00.000Z'),
      sourceRevision: 5,
    })).toBe(true)
    expect(shouldRefreshDispatcherBackgroundIndex(computedAt, {
      computedSourceRevision: 5,
      force: true,
      now: new Date('2026-08-11T20:59:00.000Z'),
      sourceRevision: 5,
    })).toBe(true)
    expect(shouldRefreshDispatcherBackgroundIndex(null)).toBe(true)
  })

  it('refreshes when the dispatcher source revision changed during the same business date', () => {
    const computedAt = new Date('2026-08-10T21:30:00.000Z') // 11 August in Moscow

    expect(shouldRefreshDispatcherBackgroundIndex(computedAt, {
      computedSourceRevision: 5,
      now: new Date('2026-08-11T20:59:00.000Z'),
      sourceRevision: 6,
    })).toBe(true)
  })

  it('lists codes that must no longer remain in the background index', () => {
    const current = {
      ...DEFAULT_DISPATCHER_SETTINGS,
      'check-welder-stamp': false,
      'check-joint-core-data': false,
    }

    const codes = getEnabledDispatcherTaskCodes(current)
    expect(codes).not.toContain('ДЗ-18')
    expect(codes).not.toContain('ДЗ-31')
    expect(codes).toContain('ДЗ-20')
  })
})
