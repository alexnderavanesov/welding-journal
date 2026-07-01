import { describe, expect, it } from 'vitest'
import type { WeldRow } from '@/lib/dispatcher-types'
import { buildJointChainConsistencyCheckTasks } from '@/lib/repeated-joint-consistency-tasks'

const deps = {
  getPrimaryRejectedLnkResult: () => null,
  getOfficialRejectedJointChainRows: () => [],
}

describe('repeated joint chain consistency tasks', () => {
  it('creates a task when a repeated joint exists without its base joint', () => {
    const tasks = buildJointChainConsistencyCheckTasks([row({ id: 1, joint: 'S63W1' })], deps)

    expect(tasks).toEqual([
      expect.objectContaining({
        kind: 'check',
        sourceJoint: 'S63W1',
        reason: 'проверить целостность цепочки',
      }),
    ])
    expect(tasks[0].details).toContain('S63')
  })

  it('creates a task when an intermediate repeated joint was removed', () => {
    const tasks = buildJointChainConsistencyCheckTasks(
      [
        row({ id: 1, joint: 'F44' }),
        row({ id: 2, joint: 'F44W1R1' }),
        row({ id: 3, joint: 'F44W2R1' }),
      ],
      deps,
    )

    expect(tasks).toEqual([
      expect.objectContaining({
        sourceJoint: 'F44W1R1',
        reason: 'проверить целостность цепочки',
      }),
    ])
    expect(tasks[0].details).toContain('F44W1')
  })

  it('does not create an integrity task when the previous chain step exists', () => {
    const tasks = buildJointChainConsistencyCheckTasks(
      [
        row({ id: 1, joint: 'F44' }),
        row({ id: 2, joint: 'F44W1' }),
        row({ id: 3, joint: 'F44W1R1' }),
      ],
      deps,
    )

    expect(tasks.filter((task) => task.reason === 'проверить целостность цепочки')).toHaveLength(0)
  })
})

function row(values: Partial<WeldRow>): WeldRow {
  return {
    id: values.id ?? 1,
    projectTitle: values.projectTitle ?? 'ТКМ5',
    subtitleCode: values.subtitleCode ?? '-',
    line: values.line ?? '330-FG-05-001',
    joint: values.joint ?? `S${values.id ?? 1}`,
    ...values,
  } as WeldRow
}
