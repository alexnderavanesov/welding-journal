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
      chainContinuations: [],
      tasks: legacyTasks,
      totalTaskCount: 1,
      totalPageCount: 1,
      tasksTruncated: false,
      taskFilterOptions: null,
    })
  })

  it('round-trips the current calculation version, tasks, and resolved chain continuations', () => {
    const tasks = [{ kind: 'check', key: 'current' }] as RepeatedJointTask[]
    const chainContinuations = [{
      kind: 'repeated-joint' as const,
      sourceRowId: 1,
      sourceJoint: 'S1',
      targetJoints: ['S1R1'],
      targetRowIds: [2],
      projectTitle: 'Проект',
      subtitleCode: '400',
      line: 'LIN-1',
    }]
    const serialized = serializeDispatcherTaskIndexPayload(tasks, chainContinuations)

    expect(isDispatcherTaskIndexPayloadCurrent(serialized)).toBe(true)
    expect(parseDispatcherTaskIndexPayload(serialized)).toEqual({
      version: DISPATCHER_TASK_CALCULATION_VERSION,
      chainContinuations,
      tasks,
      totalTaskCount: 1,
      totalPageCount: 1,
      tasksTruncated: false,
      taskFilterOptions: null,
    })
  })

  it('stores exact row counts for task filter options', () => {
    const serialized = serializeDispatcherTaskIndexPayload([], [], {
      taskFilterOptions: [
        { value: 'ДЗ-18', count: 42 },
        { value: 'СП-01', count: 7 },
      ],
    })

    expect(parseDispatcherTaskIndexPayload(serialized).taskFilterOptions).toEqual([
      { value: 'ДЗ-18', count: 42 },
      { value: 'СП-01', count: 7 },
    ])
  })

  it('preserves the exact task count when the transport snapshot is bounded', () => {
    const tasks = [{ kind: 'check', key: 'current' }] as RepeatedJointTask[]
    const serialized = serializeDispatcherTaskIndexPayload(tasks, [], {
      totalTaskCount: 25_000,
      tasksTruncated: true,
    })

    expect(parseDispatcherTaskIndexPayload(serialized)).toMatchObject({
      tasks,
      totalTaskCount: 25_000,
      tasksTruncated: true,
    })
  })

  it('marks the previous calculation version as stale after dispatcher rules change', () => {
    expect(isDispatcherTaskIndexPayloadCurrent(JSON.stringify({
      version: DISPATCHER_TASK_CALCULATION_VERSION - 1,
      tasks: [],
    }))).toBe(false)
  })
})
