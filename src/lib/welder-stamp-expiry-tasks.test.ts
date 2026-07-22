import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { normalizeDispatcherReminderDays } from '@/lib/dispatcher-settings'
import { buildWelderStampExpiryTasks } from '@/lib/welder-stamp-expiry-tasks'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'

describe('buildWelderStampExpiryTasks', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-01T10:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses separate reminder day thresholds for NAKS and DLS', () => {
    const tasks = buildWelderStampExpiryTasks([record()], {
      'welder-stamp-expiry': 14,
      'welder-dls-expiry': 30,
    })

    expect(tasks.map((task) => task.permitKind)).toEqual(['dls'])
    expect(tasks[0]?.daysLeft).toBe(20)
  })

  it('keeps reminder threshold minimum at 7 days', () => {
    expect(normalizeDispatcherReminderDays(1)).toBe(7)
    expect(normalizeDispatcherReminderDays('6')).toBe(7)
    expect(normalizeDispatcherReminderDays('14')).toBe(14)
  })

  it('labels NAKS expiry tasks with the permit number', () => {
    const tasks = buildWelderStampExpiryTasks([record()], {
      'welder-stamp-expiry': 30,
      'welder-dls-expiry': 30,
    })

    expect(tasks.find((task) => task.permitKind === 'naks')?.permitNumber).toBe('1')
  })

  it('does not create reminders for archived NAKS and DLS permits', () => {
    const archivedRecord = record()
    archivedRecord.naksPermits = archivedRecord.naksPermits.map((permit) => ({ ...permit, archived: true }))
    archivedRecord.dlsPermits = archivedRecord.dlsPermits.map((permit) => ({ ...permit, archived: true }))

    const tasks = buildWelderStampExpiryTasks([archivedRecord], {
      'welder-stamp-expiry': 30,
      'welder-dls-expiry': 30,
    })

    expect(tasks).toEqual([])
  })
})

function record(): WelderStampRecord {
  return {
    id: 1,
    naksStamp: 'A1',
    welderName: 'Петров Петр',
    internalStamp: '',
    weldType: 'РАД',
    materialGroups: 'M01',
    diameterFrom: '1',
    diameterTo: '1000',
    thicknessFrom: '1',
    thicknessTo: '1000',
    validFrom: '2026-01-01',
    validTo: '2026-07-20',
    naksPermits: [
      {
        id: 'naks-1',
        weldType: 'РАД',
        materialGroups: 'M01',
        diameterFrom: '1',
        diameterTo: '1000',
        thicknessFrom: '1',
        thicknessTo: '1000',
        validFrom: '2026-01-01',
        validTo: '2026-07-20',
        note: '',
      },
    ],
    dlsPermits: [
      {
        id: 'dls-1',
        number: 'ДЛС-1',
        weldType: 'РАД',
        materialGroups: 'M01',
        diameterFrom: '1',
        diameterTo: '1000',
        thicknessFrom: '1',
        thicknessTo: '1000',
        validFrom: '2026-01-01',
        validTo: '2026-07-21',
        note: '',
      },
    ],
    archived: false,
  }
}
