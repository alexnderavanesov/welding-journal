import { describe, expect, it } from 'vitest'

import { buildDispatcherTaskCodeGroups } from '@/lib/dispatcher-code-groups'
import type {
  LineConsistencyTask,
  PercentageLineControlTask,
  RepeatedJointCheckTask,
  RepeatedJointTaskGroup,
  WeldRow,
} from '@/lib/dispatcher-types'

describe('buildDispatcherTaskCodeGroups', () => {
  it('splits mixed object groups by code without losing tasks and sorts codes numerically', () => {
    const lineTask = createLineTask()
    const excessTask = createPercentageTask('excess', 5)
    const missingTask = createPercentageTask('missing', 2)
    const groups: RepeatedJointTaskGroup[] = [
      {
        key: 'mixed-object',
        baseJoint: '330-ATM-16-000 · ABC1',
        tasks: [lineTask, missingTask, excessTask],
      },
    ]

    const result = buildDispatcherTaskCodeGroups(groups)

    expect(result.map((group) => group.code)).toEqual(['ДЗ-02', 'ДЗ-04', 'ДЗ-27'])
    expect(result.flatMap((group) => group.tasks)).toHaveLength(3)
    expect(result.every((group) => group.objectGroups.length === 1)).toBe(true)
    expect(result[0].objectGroups[0].tasks).toEqual([excessTask])
    expect(result[1].objectGroups[0].tasks).toEqual([missingTask])
    expect(result[2].objectGroups[0].tasks).toEqual([lineTask])
  })

  it('aggregates the meaningful percentage-line count for repeated codes', () => {
    const firstTask = createPercentageTask('excess', 5)
    const secondTask = {
      ...createPercentageTask('excess', 2),
      key: 'percentage-line-control:excess:second',
    }
    const groups: RepeatedJointTaskGroup[] = [
      { key: 'first', baseJoint: 'Линия 1 · ABC1', tasks: [firstTask] },
      { key: 'second', baseJoint: 'Линия 2 · ABC1', tasks: [secondTask] },
    ]

    const [result] = buildDispatcherTaskCodeGroups(groups)

    expect(result.code).toBe('ДЗ-02')
    expect(result.label).toBe('Лишний контроль')
    expect(result.tasks).toHaveLength(2)
    expect(result.objectGroups).toHaveLength(2)
    expect(result.metric).toBe('лишних 7')
  })

  it('keeps mandatory system warnings before configurable dispatcher tasks', () => {
    const dispatcherTask = createLineTask()
    const systemWarning = createSystemWarningTask()
    const groups: RepeatedJointTaskGroup[] = [{
      key: 'mixed-warnings',
      baseJoint: 'F18',
      tasks: [dispatcherTask, systemWarning],
    }]

    expect(buildDispatcherTaskCodeGroups(groups).map((group) => group.code))
      .toEqual(['СП-01', 'ДЗ-27'])
  })
})

function createSystemWarningTask(): RepeatedJointCheckTask {
  const currentRow = createRow(18)
  return {
    kind: 'check',
    key: 'sp-01:18',
    row: currentRow,
    sourceRow: currentRow,
    sourceJoint: 'F18',
    targetJoint: 'F18',
    baseJoint: 'F18',
    suffix: 'R',
    reason: 'Нарушена последовательность контроля.',
    systemWarningCode: 'СП-01',
  }
}

function createLineTask(): LineConsistencyTask {
  return {
    kind: 'line-consistency',
    key: 'line-control-presence',
    row: createRow(18),
    line: '330-ATM-16-000',
    projectTitle: 'Проект 1',
    subtitleCode: 'Шифр 1',
    fieldKey: 'controlPresence',
    fieldLabel: 'Назначение контроля',
    title: 'Проверить назначение контроля линии',
    values: ['РК', 'УЗК'],
    details: 'Назначения контроля различаются.',
  }
}

function createPercentageTask(
  issue: PercentageLineControlTask['issue'],
  count: number,
): PercentageLineControlTask {
  return {
    kind: 'percentage-line-control',
    key: `percentage-line-control:${issue}`,
    row: createRow(issue === 'excess' ? 25 : 26),
    issue,
    projectTitle: 'Проект 1',
    subtitleCode: 'Шифр 1',
    line: '330-ATM-16-000',
    stamp: 'ABC1',
    title: issue === 'excess' ? 'Проверить лишний контроль' : 'Назначить контроль',
    details: 'Описание задачи',
    requiredControls: 4,
    coveredControls: 4,
    assignedControls: 9,
    count,
  }
}

function createRow(id: number): WeldRow {
  return {
    id,
    projectTitle: 'Проект 1',
    subtitleCode: 'Шифр 1',
    line: '330-ATM-16-000',
    joint: `F${id}`,
    weldControlPercent: '10',
  }
}
