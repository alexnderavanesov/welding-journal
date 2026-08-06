import { describe, expect, it } from 'vitest'

import { DEFAULT_DISPATCHER_REMINDER_SETTINGS, DEFAULT_DISPATCHER_SETTINGS, type DispatcherSettings } from '@/lib/dispatcher-settings'
import type { WeldRow } from '@/lib/dispatcher-types'
import { buildVisibleDispatcherTasks, getDispatcherTaskRowIds } from '@/lib/use-dispatcher-tasks'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'

describe('buildVisibleDispatcherTasks', () => {
  it('keeps dispatcher row tasks tied to their individual settings', () => {
    const enabledTasks = buildTasks({
      ...disabledSettings(),
      'line-percent': true,
    })

    expect(enabledTasks.repeatedJointTasks).toHaveLength(1)
    expect(enabledTasks.repeatedJointTasks[0]).toMatchObject({
      kind: 'line-consistency',
      fieldKey: 'weldControlPercent',
    })

    const disabledTasks = buildTasks({
      ...disabledSettings(),
      'line-percent': false,
    })

    expect(disabledTasks.repeatedJointTasks).toEqual([])
  })

  it('hides accepted dispatcher warning keys without changing the source rows', () => {
    const initialTasks = buildTasks({
      ...disabledSettings(),
      'line-percent': true,
    })
    const taskKey = initialTasks.repeatedJointTasks[0]?.key

    expect(taskKey).toBeTruthy()

    const hiddenTasks = buildTasks(
      {
        ...disabledSettings(),
        'line-percent': true,
      },
      { acceptedDispatcherWarningKeys: new Set([taskKey ?? '']) },
    )

    expect(hiddenTasks.repeatedJointTasks).toEqual([])
  })

  it('builds compact row id index for table highlighting', () => {
    const tasks = buildTasks({
      ...disabledSettings(),
      'line-percent': true,
    })

    const rowIds = getDispatcherTaskRowIds(tasks.repeatedJointTasks)

    expect(rowIds.size).toBeGreaterThan(0)
    expect([...rowIds].every((id) => Number.isFinite(id))).toBe(true)
  })

  it('can skip repeated row tasks when a page only needs reminder tasks', () => {
    const tasks = buildTasks(
      {
        ...disabledSettings(),
        'line-percent': true,
      },
      { includeRepeatedJointTasks: false },
    )

    expect(tasks.repeatedJointTasks).toEqual([])
  })

  it('controls PSTO line consistency with its own dispatcher setting', () => {
    const enabledTasks = buildTasks(
      {
        ...disabledSettings(),
        'line-psto-presence': true,
      },
      {
        rows: [
          row({ id: 1, line: 'LIN-1', joint: 'F1', weldControlPercent: '25', pstoRequired: 'да' }),
          row({ id: 2, line: 'LIN-1', joint: 'F2', weldControlPercent: '25', pstoRequired: '' }),
        ],
      },
    )

    expect(enabledTasks.repeatedJointTasks).toHaveLength(1)
    expect(enabledTasks.repeatedJointTasks[0]).toMatchObject({
      kind: 'line-consistency',
      fieldKey: 'pstoPresence',
    })

    const disabledTasks = buildTasks(
      {
        ...disabledSettings(),
        'line-psto-presence': false,
      },
      {
        rows: [
          row({ id: 1, line: 'LIN-1', joint: 'F1', weldControlPercent: '25', pstoRequired: 'да' }),
          row({ id: 2, line: 'LIN-1', joint: 'F2', weldControlPercent: '25', pstoRequired: '' }),
        ],
      },
    )

    expect(disabledTasks.repeatedJointTasks).toEqual([])
  })

  it('controls the complete stamp audit only with the dispatcher setting', () => {
    const rows = [
      row({
        id: 1,
        joint: 'F1',
        stamp1K: 'ABC1',
        weldingMethod: 'РАД',
      }),
    ]
    const welderStamps = [stampRecord('OTHER')]
    const dispatcherSettings = {
      ...disabledSettings(),
      'check-welder-stamp': true,
    }

    const enabled = buildTasks(dispatcherSettings, { rows, welderStamps })
    expect(enabled.repeatedJointTasks).toHaveLength(1)
    expect(enabled.repeatedJointTasks[0]).toMatchObject({ reason: 'проверить клеймо' })

    const disabled = buildTasks(
      {
        ...dispatcherSettings,
        'check-welder-stamp': false,
      },
      { rows, welderStamps },
    )
    expect(disabled.repeatedJointTasks).toEqual([])
  })

  it('keeps Latin and Cyrillic material group codes distinct in DZ-18', () => {
    const tasks = buildTasks(
      {
        ...disabledSettings(),
        'check-welder-stamp': true,
      },
      {
        rows: [
          row({
            id: 1,
            joint: 'F1',
            materialGroup: 'M01',
            stamp1K: 'ABC1',
            weldingMethod: 'РАД',
          }),
        ],
        welderStamps: [stampRecordWithPermit('ABC1', 'М01')],
      },
    )

    expect(tasks.repeatedJointTasks).toHaveLength(1)
    expect(tasks.repeatedJointTasks[0]).toMatchObject({
      reason: 'проверить клеймо',
      details: expect.stringContaining('группу материалов M01'),
    })
  })

  it('keeps exact stored material groups during server-side DZ-18 checks', () => {
    const tasks = buildTasks(
      {
        ...disabledSettings(),
        'check-welder-stamp': true,
      },
      {
        rows: [
          row({
            id: 1,
            joint: 'F1',
            materialGroup: 'М01',
            stamp1K: 'ABC1',
            weldingMethod: 'РАД',
          }),
        ],
        welderStamps: [stampRecordWithPermit('ABC1', 'М01')],
      },
    )

    expect(tasks.repeatedJointTasks).toEqual([])
  })

  it('does not create DZ-18 only because the stamp card was archived after the weld date', () => {
    const stamp = stampRecordWithPermit('ABC1', 'М01')
    stamp.archived = true
    stamp.archivedAt = '2026-08-01'

    const tasks = buildTasks(
      {
        ...disabledSettings(),
        'check-welder-stamp': true,
      },
      {
        rows: [
          row({
            id: 1,
            joint: 'F1',
            materialGroup: 'М01',
            stamp1K: 'ABC1',
            weldingMethod: 'РАД',
            d1: '57',
            t1: '3',
            weldDate: '2026-07-01',
          }),
        ],
        welderStamps: [stamp],
      },
    )

    expect(tasks.repeatedJointTasks).toEqual([])
  })

  it('keeps real permit errors visible after the stamp card is archived', () => {
    const stamp = stampRecordWithPermit('ABC1', 'М01')
    stamp.archived = true
    stamp.archivedAt = '2026-08-01'
    stamp.naksPermits = [
      {
        id: 'naks-limited',
        weldType: 'РАД',
        materialGroups: 'М01',
        diameterFrom: '1',
        diameterTo: '50',
        thicknessFrom: '1',
        thicknessTo: '5',
        validFrom: '2026-01-01',
        validTo: '2026-12-31',
        note: '',
      },
    ]

    const tasks = buildTasks(
      {
        ...disabledSettings(),
        'check-welder-stamp': true,
      },
      {
        rows: [
          row({
            id: 1,
            joint: 'F1',
            materialGroup: 'М01',
            stamp1K: 'ABC1',
            weldingMethod: 'РАД',
            d1: '57',
            t1: '3',
            weldDate: '2026-07-01',
          }),
        ],
        welderStamps: [stamp],
      },
    )

    expect(tasks.repeatedJointTasks).toEqual([
      expect.objectContaining({
        details: expect.stringContaining('не имеет допуска на диаметр 57'),
      }),
    ])
    expect(tasks.repeatedJointTasks[0]).not.toEqual(
      expect.objectContaining({
        details: expect.stringContaining('находится в архиве'),
      }),
    )
  })

  it('does not create DZ-18 when several DLS ranges of one stamp cover the joint together', () => {
    const stamp = stampRecordWithPermit('E0SM', 'M01')
    stamp.dlsPermits = [
      {
        id: 'dls-large',
        number: 'ДЛС-1',
        weldType: 'РАД',
        materialGroups: 'M01',
        diameterFrom: '28.5',
        diameterTo: '',
        thicknessFrom: '3',
        thicknessTo: '12',
        validFrom: '2026-06-12',
        validTo: '2026-09-12',
        note: '',
      },
      {
        id: 'dls-small',
        number: 'ДЛС-2',
        weldType: 'РАД',
        materialGroups: 'M01',
        diameterFrom: '18',
        diameterTo: '36',
        thicknessFrom: '3',
        thicknessTo: '6',
        validFrom: '2026-06-12',
        validTo: '2026-09-12',
        note: '',
      },
    ]

    const tasks = buildTasks(
      {
        ...disabledSettings(),
        'check-welder-stamp': true,
      },
      {
        rows: [
          row({
            id: 1,
            joint: 'F1A',
            materialGroup: 'M01',
            stamp1K: 'E0SM',
            weldingMethod: 'РАД',
            d1: '108',
            d2: '22',
            t1: '8',
            t2: '5',
            weldDate: '20.07.2026',
          }),
        ],
        welderStamps: [stamp],
      },
    )

    expect(tasks.repeatedJointTasks).toEqual([])
  })

  it('does not create DZ-18 when one stamp own RAD and RD ranges cover D and T separately', () => {
    const stamp = stampRecordWithPermit('AAAA', 'M01')
    stamp.naksPermits = [
      {
        id: 'naks-rad',
        weldType: 'РАД',
        materialGroups: 'M01',
        diameterFrom: '1',
        diameterTo: '50',
        thicknessFrom: '1',
        thicknessTo: '5',
        validFrom: '2026-01-01',
        validTo: '2026-12-31',
        note: '',
      },
      {
        id: 'naks-rd',
        weldType: 'РД',
        materialGroups: 'M01',
        diameterFrom: '50',
        diameterTo: '100',
        thicknessFrom: '5',
        thicknessTo: '10',
        validFrom: '2026-01-01',
        validTo: '2026-12-31',
        note: '',
      },
    ]
    stamp.dlsPermits = [
      broadDlsPermit('dls-rad', 'РАД', 'M01'),
      broadDlsPermit('dls-rd', 'РД', 'M01'),
    ]

    const tasks = buildTasks(
      {
        ...disabledSettings(),
        'check-welder-stamp': true,
      },
      {
        rows: [
          row({
            id: 1,
            joint: 'F1A',
            materialGroup: 'M01',
            stamp1K: 'AAAA',
            stamp1Z: 'AAAA',
            weldingMethod: 'РАД+РД',
            d1: '57',
            d2: '57',
            t1: '3',
            t2: '3',
            weldDate: '20.07.2026',
          }),
        ],
        welderStamps: [stamp],
      },
    )

    expect(tasks.repeatedJointTasks).toEqual([])
  })

  it('does not create DZ-18 for the larger base pipe of an angular connection', () => {
    const stamp = stampRecordWithPermit('AAAA', 'M01')
    stamp.naksPermits = [
      {
        id: 'naks-angular-branch',
        weldType: 'РАД',
        materialGroups: 'M01',
        diameterFrom: '20',
        diameterTo: '30',
        thicknessFrom: '2',
        thicknessTo: '4',
        validFrom: '2026-01-01',
        validTo: '2026-12-31',
        note: '',
      },
    ]

    const tasks = buildTasks(
      {
        ...disabledSettings(),
        'check-welder-stamp': true,
      },
      {
        rows: [
          row({
            id: 1,
            joint: 'F1A',
            connectionType: 'У17',
            materialGroup: 'M01',
            stamp1K: 'AAAA',
            weldingMethod: 'РАД',
            d1: '530',
            t1: '30',
            d2: '25',
            t2: '3',
            weldDate: '20.07.2026',
          }),
        ],
        welderStamps: [stamp],
      },
    )

    expect(tasks.repeatedJointTasks).toEqual([])
  })
})

function buildTasks(
  dispatcherSettings: DispatcherSettings,
  overrides: {
    acceptedDispatcherWarningKeys?: Set<string>
    dismissedRepeatedJointTaskKeys?: Set<string>
    includeRepeatedJointTasks?: boolean
    rows?: WeldRow[]
    welderStamps?: WelderStampRecord[]
  } = {},
) {
  return buildVisibleDispatcherTasks({
    acceptedDispatcherWarningKeys: overrides.acceptedDispatcherWarningKeys ?? new Set(),
    dismissedRepeatedJointTaskKeys: overrides.dismissedRepeatedJointTaskKeys ?? new Set(),
    dispatcherReminderSettings: DEFAULT_DISPATCHER_REMINDER_SETTINGS,
    dispatcherSettings,
    includeRepeatedJointTasks: overrides.includeRepeatedJointTasks,
    rows: overrides.rows ?? [
      row({ id: 1, line: 'LIN-1', joint: 'F1', weldControlPercent: '100' }),
      row({ id: 2, line: 'LIN-1', joint: 'F2', weldControlPercent: '10' }),
    ],
    welderStamps: overrides.welderStamps ?? [],
    welderStampSuspensions: [],
  })
}

function stampRecord(naksStamp: string): WelderStampRecord {
  return {
    id: 1,
    naksStamp,
    welderName: '',
    internalStamp: '',
    weldType: 'РАД',
    materialGroups: '',
    diameterFrom: '',
    diameterTo: '',
    thicknessFrom: '',
    thicknessTo: '',
    validFrom: '',
    validTo: '',
    naksPermits: [],
    dlsPermits: [],
    archived: false,
  }
}

function stampRecordWithPermit(naksStamp: string, materialGroups: string): WelderStampRecord {
  return {
    ...stampRecord(naksStamp),
    materialGroups,
    naksPermits: [
      {
        id: 'naks-1',
        weldType: 'РАД',
        materialGroups,
        diameterFrom: '',
        diameterTo: '',
        thicknessFrom: '',
        thicknessTo: '',
        validFrom: '',
        validTo: '',
        note: '',
      },
    ],
    dlsPermits: [broadDlsPermit('dls-1', 'РАД', materialGroups)],
  }
}

function broadDlsPermit(id: string, weldType: string, materialGroups: string) {
  return {
    id,
    number: id.toUpperCase(),
    weldType,
    materialGroups,
    diameterFrom: '',
    diameterTo: '',
    thicknessFrom: '',
    thicknessTo: '',
    validFrom: '',
    validTo: '',
    note: '',
  }
}

function disabledSettings(): DispatcherSettings {
  return Object.fromEntries(Object.keys(DEFAULT_DISPATCHER_SETTINGS).map((key) => [key, false])) as DispatcherSettings
}

function row(values: Partial<WeldRow>): WeldRow {
  return {
    id: values.id ?? 1,
    projectTitle: 'Проект',
    subtitleCode: '400',
    line: 'LIN-1',
    joint: 'F1',
    ...values,
  } as WeldRow
}
