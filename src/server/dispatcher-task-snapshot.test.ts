import { describe, expect, it } from 'vitest'

import type { RepeatedJointTask, WeldRow } from '@/lib/dispatcher-types'
import { compactDispatcherTasksForTransport } from '@/server/dispatcher-task-index'
import { buildProgramRepairTasks } from '@/lib/line-program-repair-requirements'
import { isTConnectionType } from '@/lib/connection-type'

describe('dispatcher task snapshot transport', () => {
  it.each(['Т1', 'С'])('preserves the repair family for SP-08 navigation after persistence: %s', connectionType => {
    const rows: WeldRow[] = [
      { ...weldRow(), id: 1, joint: 'F1', officiality: 'действующий', connectionType, hasVik: 'да', vikResult: 'ремонт', hasPvk: 'да' },
      { ...weldRow(), id: 2, joint: 'F1R1', officiality: 'действующий', connectionType, hasVik: 'да', vikResult: 'годен', hasPvk: 'нет' },
    ]
    const task = compactDispatcherTasksForTransport(buildProgramRepairTasks(rows, new Set())).find(task => task.row.id === 2)!
    expect(task).toBeDefined()
    expect(task.row.connectionType).toBe(connectionType)
    expect(isTConnectionType(task.row.connectionType)).toBe(connectionType === 'Т1')
    expect(task.row.material1).toBeUndefined()
  })
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
      officiality: 'неофициальный',
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
    officiality: 'неофициальный',
    weldDate: '2026-07-01',
    material1: '09Г2С',
  }
}
