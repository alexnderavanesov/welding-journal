import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import { buildRepeatedJointTasks } from '@/lib/repeated-joint-tasks'

describe('buildRepeatedJointTasks', () => {
  it('creates one official same-name target task for multiple unofficial rejected source rows', () => {
    const rows = [
      row({ id: 1, joint: 'S2', status: 'неофициальный', rkResult: 'вырез' }),
      row({ id: 2, joint: 'S2', status: 'неофициальный', pvkResult: 'вырез' }),
      row({ id: 3, joint: 'S2', status: 'неофициальный', rkResult: 'вырез' }),
    ]

    const createTasks = buildRepeatedJointTasks(rows).filter((task) => task.kind === 'create')

    expect(createTasks).toHaveLength(1)
    expect(createTasks[0]).toEqual(expect.objectContaining({ sourceJoint: 'S2', targetJoint: 'S2' }))
  })

  it('keeps the next repeated joint create task when a premature coil needs integrity check', () => {
    const rows = [
      row({ id: 1, joint: 'S2', pvkResult: 'вырез' }),
      row({ id: 2, joint: 'S2W1', pvkResult: 'вырез' }),
      row({ id: 3, joint: 'S2W2', pvkResult: 'вырез' }),
      row({ id: 4, joint: 'S2Y1', pvkResult: '' }),
    ]

    const tasks = buildRepeatedJointTasks(rows)

    expect(tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'check', reason: 'проверить целостность катушки' }),
        expect.objectContaining({ kind: 'create', sourceJoint: 'S2W2', targetJoint: 'S2W3' }),
      ]),
    )
  })

  it('offers to rename an orphan good repeated joint back to its missing source joint', () => {
    const tasks = buildRepeatedJointTasks([row({ id: 1, joint: 'S2W1', finalStatus: 'годен' })])

    expect(tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'rename',
          currentJoint: 'S2W1',
          targetJoint: 'S2',
        }),
      ]),
    )
    expect(tasks.some((task) => task.kind === 'check' && task.reason === 'проверить целостность цепочки')).toBe(false)
  })
})

function row(values: Partial<WeldRow>): WeldRow {
  return {
    id: values.id ?? 1,
    projectTitle: values.projectTitle ?? 'ТКМ5',
    subtitleCode: values.subtitleCode ?? '-',
    line: values.line ?? '330-FG-05-001',
    joint: values.joint ?? 'S1',
    weldDate: values.weldDate ?? '2026-07-01',
    ...values,
  } as WeldRow
}
