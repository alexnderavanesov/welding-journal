import { describe, expect, it } from 'vitest'

import { DEFAULT_DISPATCHER_SETTINGS, isDispatcherTaskEnabled } from '@/lib/dispatcher-settings'
import type { DispatcherTask, WeldRow } from '@/lib/dispatcher-types'

const row = { id: 1, joint: 'F1' } as WeldRow

describe('dispatcher settings', () => {
  it('filters a disabled percentage line task without disabling other percentage issues', () => {
    const settings = { ...DEFAULT_DISPATCHER_SETTINGS, 'percentage-excess': false }
    const excessTask = makePercentageTask('excess', 'Проверить лишний контроль процентной линии')
    const missingTask = makePercentageTask('missing', 'Назначить РК/УЗК по процентной линии')

    expect(isDispatcherTaskEnabled(excessTask, settings)).toBe(false)
    expect(isDispatcherTaskEnabled(missingTask, settings)).toBe(true)
  })

  it('filters welder stamp expiry reminders separately from dispatcher tasks', () => {
    const settings = { ...DEFAULT_DISPATCHER_SETTINGS, 'welder-stamp-expiry': false }
    const task = makeExpiryTask('naks')

    expect(isDispatcherTaskEnabled(task, settings)).toBe(false)
  })

  it('filters DLS expiry reminders separately from NAKS expiry reminders', () => {
    const settings = { ...DEFAULT_DISPATCHER_SETTINGS, 'welder-dls-expiry': false }
    const naksTask = makeExpiryTask('naks')
    const dlsTask = makeExpiryTask('dls')

    expect(isDispatcherTaskEnabled(naksTask, settings)).toBe(true)
    expect(isDispatcherTaskEnabled(dlsTask, settings)).toBe(false)
  })

  it('filters official-from-unofficial create tasks separately from repeated joint create tasks', () => {
    const settings = { ...DEFAULT_DISPATCHER_SETTINGS, 'repeated-create-official-from-unofficial': false }
    const unofficialCreateTask = makeCreateTask('неофициальный')
    const regularCreateTask = makeCreateTask('')

    expect(isDispatcherTaskEnabled(unofficialCreateTask, settings)).toBe(false)
    expect(isDispatcherTaskEnabled(regularCreateTask, settings)).toBe(true)
  })
})

function makePercentageTask(issue: 'missing' | 'excess', title: string): DispatcherTask {
  return {
    kind: 'percentage-line-control',
    key: `percentage-line-control:${issue}:line:a1`,
    row,
    issue,
    projectTitle: '',
    subtitleCode: '',
    line: 'L1',
    stamp: 'A1',
    title,
    details: '',
    requiredControls: 1,
    coveredControls: 0,
    assignedControls: 0,
    count: 1,
  }
}

function makeCreateTask(status: string): DispatcherTask {
  return {
    kind: 'create',
    key: `create:${status || 'regular'}`,
    row: { ...row, status },
    sourceJoint: 'F1',
    targetJoint: 'F1R1',
    result: 'ремонт',
    suffix: 'R',
    methodCode: 'РК',
  } as DispatcherTask
}

function makeExpiryTask(permitKind: 'naks' | 'dls'): DispatcherTask {
  return {
    kind: 'welder-stamp-expiry',
    key: `welder-stamp-expiry:${permitKind}:1:A1:permit:2026-07-10`,
    stamp: {
      id: 1,
      naksStamp: 'A1',
      internalStamp: '',
      welderName: '',
      weldType: '',
      materialGroups: '',
      diameterFrom: '',
      diameterTo: '',
      thicknessFrom: '',
      thicknessTo: '',
      validFrom: '',
      validTo: '2026-07-10',
      naksPermits: [],
      dlsPermits: [],
      archived: false,
    },
    permitKind,
    permitNumber: permitKind === 'dls' ? 'ДЛС-1' : undefined,
    naksStamp: 'A1',
    validTo: '2026-07-10',
    daysLeft: 0,
    expired: false,
  } as DispatcherTask
}
