import { describe, expect, it } from 'vitest'

import type { RepeatedJointTask, WeldRow } from '@/lib/dispatcher-types'
import { compactDispatcherTasksForTransport } from '@/server/dispatcher-task-snapshot'

describe('dispatcher task snapshot transport', () => {
  it('keeps only navigation context in informational check tasks', () => {
    const row = weldRow()
    const [task] = compactDispatcherTasksForTransport([
      {
        kind: 'check',
        key: 'check:1',
        row,
        sourceRow: row,
        sourceJoint: 'F1',
        targetJoint: 'F1',
        baseJoint: 'F1',
        suffix: 'R',
        reason: 'проверить клеймо',
      },
    ])

    expect(task.row).toEqual({
      id: 1,
      projectTitle: 'Проект',
      subtitleCode: '400',
      line: 'LIN-1',
      joint: 'F1',
      status: 'ожидает НК',
      weldDate: '2026-07-01',
    })
    expect(task.row.material1).toBeUndefined()
  })

  it('keeps complete rows for tasks that can mutate journal data', () => {
    const row = weldRow()
    const [task] = compactDispatcherTasksForTransport([
      {
        kind: 'create',
        key: 'create:1',
        row,
        sourceJoint: 'F1',
        targetJoint: 'F1R1',
        result: 'ремонт',
        suffix: 'R',
        methodCode: 'РК',
      },
    ] as RepeatedJointTask[])

    expect(task.row).toBe(row)
    expect(task.row.material1).toBe('09Г2С')
  })
})

function weldRow(): WeldRow {
  return {
    id: 1,
    projectTitle: 'Проект',
    subtitleCode: '400',
    line: 'LIN-1',
    joint: 'F1',
    status: 'ожидает НК',
    weldDate: '2026-07-01',
    material1: '09Г2С',
  }
}
