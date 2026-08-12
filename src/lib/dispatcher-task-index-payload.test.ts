import { describe, expect, it } from 'vitest'

import {
  DISPATCHER_TASK_CALCULATION_VERSION,
  isDispatcherTaskIndexPayloadCurrent,
  parseDispatcherTaskIndexPayload,
  serializeDispatcherTaskIndexPayload,
} from '@/lib/dispatcher-task-index-payload'
import type { RepeatedJointTask } from '@/lib/dispatcher-types'

describe('dispatcher task index payload', () => {
  it('marks the legacy array cache as stale while preserving its tasks', () => {
    const legacyTasks = [{ kind: 'check', key: 'legacy' }] as RepeatedJointTask[]

    expect(isDispatcherTaskIndexPayloadCurrent(JSON.stringify(legacyTasks))).toBe(false)
    expect(parseDispatcherTaskIndexPayload(JSON.stringify(legacyTasks))).toEqual({
      version: 0,
      tasks: legacyTasks,
    })
  })

  it('round-trips the current calculation version and tasks', () => {
    const tasks = [{ kind: 'check', key: 'current' }] as RepeatedJointTask[]
    const serialized = serializeDispatcherTaskIndexPayload(tasks)

    expect(isDispatcherTaskIndexPayloadCurrent(serialized)).toBe(true)
    expect(parseDispatcherTaskIndexPayload(serialized)).toEqual({
      version: DISPATCHER_TASK_CALCULATION_VERSION,
      tasks,
    })
  })

  it('marks the previous calculation version as stale after dispatcher rules change', () => {
    expect(isDispatcherTaskIndexPayloadCurrent(JSON.stringify({
      version: DISPATCHER_TASK_CALCULATION_VERSION - 1,
      tasks: [],
    }))).toBe(false)
  })
})
