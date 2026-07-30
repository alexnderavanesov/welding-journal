import { describe, expect, it } from 'vitest'

import { DEFAULT_DISPATCHER_REMINDER_SETTINGS, DEFAULT_DISPATCHER_SETTINGS, type DispatcherSettings } from '@/lib/dispatcher-settings'
import type { WeldRow } from '@/lib/dispatcher-types'
import { buildVisibleDispatcherTasks, getDispatcherTaskRowIds } from '@/lib/use-dispatcher-tasks'

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
})

function buildTasks(
  dispatcherSettings: DispatcherSettings,
  overrides: {
    acceptedDispatcherWarningKeys?: Set<string>
    dismissedRepeatedJointTaskKeys?: Set<string>
    includeRepeatedJointTasks?: boolean
    rows?: WeldRow[]
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
    welderStamps: [],
    welderStampSuspensions: [],
  })
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
