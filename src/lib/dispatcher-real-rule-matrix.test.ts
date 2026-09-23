import { describe, expect, it } from 'vitest'
import { buildVisibleDispatcherTasks } from '@/lib/dispatcher-task-builder'
import { buildDispatcherTaskCodeIndexRows } from '@/lib/dispatcher-task-row-codes'
import { DEFAULT_DISPATCHER_REMINDER_SETTINGS, DEFAULT_DISPATCHER_SETTINGS, DISPATCHER_SETTING_CODES, getDispatcherTaskCode } from '@/lib/dispatcher-settings'
import { createDispatcherRuleFixtures } from '@/test/dispatcher-rule-fixtures'

const fixtures = createDispatcherRuleFixtures()

describe('real dispatcher rule matrix', () => {
  it('covers every enabled setting with stored facts, not synthetic tasks', () => {
    expect(fixtures.map(({ settingId }) => settingId).sort()).toEqual(Object.keys(DISPATCHER_SETTING_CODES).sort())
  })
  it.each(fixtures)('$settingId generates the expected code and exact target rows', (fixture) => {
    const input = {
      ...fixture, acceptedDispatcherWarningKeys: new Set<string>(), dismissedRepeatedJointTaskKeys: new Set<string>(),
      dispatcherSettings: DEFAULT_DISPATCHER_SETTINGS, dispatcherReminderSettings: DEFAULT_DISPATCHER_REMINDER_SETTINGS,
      welderStampSuspensions: [],
    }
    const code = DISPATCHER_SETTING_CODES[fixture.settingId]
    const result = buildVisibleDispatcherTasks(input)
    const tasks = [...result.repeatedJointTasks, ...result.welderStampExpiryTasks].filter((task) => getDispatcherTaskCode(task) === code)
    expect(tasks, code).not.toHaveLength(0)
    expect(buildDispatcherTaskCodeIndexRows(tasks, fixture.rows).map(({ rowId }) => rowId).sort((a, b) => a - b)).toEqual(fixture.expectedRowIds)
    const disabled = buildVisibleDispatcherTasks({ ...input, dispatcherSettings: { ...DEFAULT_DISPATCHER_SETTINGS, [fixture.settingId]: false } })
    expect([...disabled.repeatedJointTasks, ...disabled.welderStampExpiryTasks].filter((task) => getDispatcherTaskCode(task) === code)).toEqual([])
  })
})
