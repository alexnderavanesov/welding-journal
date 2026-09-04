import { describe, expect, it } from 'vitest'

import {
  getDispatcherTaskActionSpecs,
  getDispatcherTaskScopeLabel,
} from '@/lib/dispatcher-task-actions-model'
import type { LineConsistencyTask, PercentageLineControlTask, RepeatedJointCheckTask, WeldRow } from '@/lib/dispatcher-types'
import {
  LNK_RESULT_COMPLETENESS_REASON,
  PSTO_RESULT_COMPLETENESS_REASON,
} from '@/lib/dispatcher-check-reasons'

describe('dispatcher task action model', () => {
  it('opens the existing assignment workflow for percentage-line shortages', () => {
    const task = percentageTask('missing')

    expect(getDispatcherTaskActionSpecs(task)).toEqual([
      expect.objectContaining({ id: 'assign-percentage-controls', label: 'Назначить контроль' }),
      expect.objectContaining({ id: 'show-task', label: 'Показать стыки' }),
    ])
    expect(getDispatcherTaskScopeLabel(task)).toBe('Линия и клеймо')
  })

  it('routes LNK and PSTO completeness checks to their own reports', () => {
    expect(getDispatcherTaskActionSpecs(checkTask(LNK_RESULT_COMPLETENESS_REASON))[0]).toMatchObject({
      id: 'open-lnk',
      label: 'Исправить в ЛНК',
    })
    expect(getDispatcherTaskActionSpecs(checkTask(PSTO_RESULT_COMPLETENESS_REASON))[0]).toMatchObject({
      id: 'open-psto',
      label: 'Исправить в ПСТО',
    })
  })

  it('opens the line program for a PSTO line conflict', () => {
    const task: LineConsistencyTask = {
      kind: 'line-consistency',
      key: 'line-psto',
      row: row(),
      projectTitle: 'Проект',
      subtitleCode: 'Шифр',
      line: 'LIN-1',
      fieldKey: 'pstoPresence',
      fieldLabel: 'ПСТО',
      title: 'Проверить ПСТО линии',
      values: ['да', 'нет'],
      details: 'Значения различаются.',
    }

    expect(getDispatcherTaskActionSpecs(task).map((action) => action.id)).toEqual([
      'open-psto-program',
      'show-task',
    ])
    expect(getDispatcherTaskScopeLabel(task)).toBe('Вся линия')
  })
})

function percentageTask(issue: PercentageLineControlTask['issue']): PercentageLineControlTask {
  return {
    kind: 'percentage-line-control',
    key: `percentage:${issue}`,
    row: row(),
    issue,
    projectTitle: 'Проект',
    subtitleCode: 'Шифр',
    line: 'LIN-1',
    stamp: 'K1',
    title: 'Задача процентной линии',
    details: 'Описание',
    requiredControls: 2,
    coveredControls: 1,
    assignedControls: 1,
    count: 1,
  }
}

function checkTask(reason: string): RepeatedJointCheckTask {
  const current = row()
  return {
    kind: 'check',
    key: `check:${reason}`,
    row: current,
    sourceRow: current,
    sourceJoint: 'S1',
    targetJoint: 'S1',
    baseJoint: 'S1',
    suffix: 'R',
    reason,
  }
}

function row(): WeldRow {
  return {
    id: 1,
    projectTitle: 'Проект',
    subtitleCode: 'Шифр',
    line: 'LIN-1',
    joint: 'S1',
  }
}
