import { describe, expect, it } from 'vitest'

import type { RepeatedJointTask, WeldRow } from '@/lib/dispatcher-types'
import { compactDispatcherTasksForTransport } from '@/server/dispatcher-task-index'
import { buildProgramRepairTasks } from '@/lib/line-program-repair-requirements'
import { isTConnectionType } from '@/lib/connection-type'
import { getDispatcherTaskActionSpecs } from '@/lib/dispatcher-task-actions-model'
import { matchesDispatcherWorkspaceTask } from '@/lib/dispatcher-workspace-search'

describe('dispatcher task snapshot transport', () => {
  it.each(['missing', 'excess', 'new-welder', 'rejected-rows', 'suspend-welder'] as const)(
    'preserves percentage task actions, targets, quotas and search without copying joint history: %s', issue => {
      const row = { ...weldRow(), connectionType: 'Т1', weldControlPercent: 50, pvkControlPercent: 30,
        pstoRepeatCycles: [{ id: 2, weldJointId: 1, sequence: 2, pstoNote: 'history' }] }
      const task: RepeatedJointTask = { kind: 'percentage-line-control', key: `quota:${issue}`, issue,
        row, projectTitle: 'Проект', subtitleCode: '400', line: 'LIN-1', stamp: 'A1',
        demandKind: 'pvk', title: 'Проверить контроль', details: 'Клеймо A1', targetRowIds: [1, 7],
        suspensionFrom: '2026-06-15', requiredControls: 3, assignedControls: 1, coveredControls: 0, count: 2 }
      const [compact] = JSON.parse(JSON.stringify(compactDispatcherTasksForTransport([task]))) as RepeatedJointTask[]
      expect({ ...compact, row: undefined }).toEqual({ ...task, row: undefined })
      expect(compact.row).toMatchObject({ id: 1, projectTitle: 'Проект', subtitleCode: '400', line: 'LIN-1',
        joint: 'F1', connectionType: 'Т1', officiality: 'неофициальный', weldDate: '2026-07-01',
        weldControlPercent: 50, pvkControlPercent: 30 })
      expect(compact.row).not.toHaveProperty('pstoRepeatCycles')
      expect(compact.row).not.toHaveProperty('material1')
      expect(getDispatcherTaskActionSpecs(compact)).toEqual(getDispatcherTaskActionSpecs(task))
      expect(matchesDispatcherWorkspaceTask(compact, 'Проект LIN-1 A1', null)).toBe(true)
      expect(row.pstoRepeatCycles[0].pstoNote).toBe('history')
    },
  )
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
