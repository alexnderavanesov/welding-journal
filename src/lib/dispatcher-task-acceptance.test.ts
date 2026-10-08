import { describe, expect, it } from 'vitest'
import { canAcceptDispatcherTask } from '@/lib/dispatcher-task-acceptance'
import type { DispatcherTask, PercentageLineControlTask, WeldRow } from '@/lib/dispatcher-types'

const row = { id: 1, joint: 'F1' } as WeldRow

function makePercentageTask(issue: PercentageLineControlTask['issue']): PercentageLineControlTask {
  return {
    kind: 'percentage-line-control',
    key: `percentage:${issue}`,
    row,
    issue,
    projectTitle: 'Проект',
    subtitleCode: '400',
    line: 'Линия',
    stamp: 'ABC1',
    title: 'Проверка',
    details: 'Описание',
    requiredControls: 1,
    coveredControls: 0,
    assignedControls: 0,
    count: 1,
  }
}

describe('canAcceptDispatcherTask', () => {
  it.each(['new-welder', 'rejected-rows'] as const)(
    'allows the percentage-line action exposed by the interface: %s',
    (issue) => {
      expect(canAcceptDispatcherTask(makePercentageTask(issue))).toBe(true)
    },
  )

  it.each(['missing', 'excess', 'suspend-welder'] as const)('cannot accept a mandatory SP task: %s', issue => {
    expect(canAcceptDispatcherTask(makePercentageTask(issue))).toBe(false)
  })

  it('rejects all other dispatcher task kinds', () => {
    const task = {
      kind: 'check',
      key: 'check:1',
      row,
      sourceRow: row,
      sourceJoint: 'F1',
      targetJoint: 'F1',
      baseJoint: 'F1',
      suffix: 'R',
    } as DispatcherTask

    expect(canAcceptDispatcherTask(task)).toBe(false)
  })
})
