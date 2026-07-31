import { describe, expect, it } from 'vitest'

import { DEFAULT_DISPATCHER_REMINDER_SETTINGS, DEFAULT_DISPATCHER_SETTINGS, type DispatcherSettings } from '@/lib/dispatcher-settings'
import type { WeldRow } from '@/lib/dispatcher-types'
import { DEFAULT_SAVE_CHECK_SETTINGS, type SaveCheckSettings } from '@/lib/save-check-settings'
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

  it('uses the same enabled stamp checks as the weld form', () => {
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

    const disabled = buildTasks(dispatcherSettings, {
      rows,
      saveCheckSettings: {
        ...DEFAULT_SAVE_CHECK_SETTINGS,
        officialRegistry: false,
      },
      welderStamps,
    })
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
        saveCheckSettings: {
          ...DEFAULT_SAVE_CHECK_SETTINGS,
          officialArchive: false,
          officialNaksDate: false,
          officialSuspension: false,
          officialDiameter: false,
          officialThickness: false,
          officialDls: false,
        },
        welderStamps: [stampRecordWithPermit('ABC1', 'М01')],
      },
    )

    expect(tasks.repeatedJointTasks).toHaveLength(1)
    expect(tasks.repeatedJointTasks[0]).toMatchObject({
      reason: 'проверить клеймо',
    })
    expect(tasks.repeatedJointTasks[0]?.details).toContain('группу материалов M01')
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
        saveCheckSettings: {
          ...DEFAULT_SAVE_CHECK_SETTINGS,
          officialArchive: false,
          officialNaksDate: false,
          officialSuspension: false,
          officialDiameter: false,
          officialThickness: false,
          officialDls: false,
        },
        welderStamps: [stampRecordWithPermit('ABC1', 'М01')],
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
    saveCheckSettings?: SaveCheckSettings
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
    saveCheckSettings: overrides.saveCheckSettings ?? DEFAULT_SAVE_CHECK_SETTINGS,
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
