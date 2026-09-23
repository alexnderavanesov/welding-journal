import { describe, expect, it } from 'vitest'

import { buildWeldingJournalWaitingRepairRows } from '@/lib/welding-journal-report-rows'
import { getExpectedRepeatedJointName } from '@/lib/repeated-joint-task-helpers'
import type { WeldInput } from '@/lib/weld-fields'

describe('welding journal waiting-repair output', () => {
  it('keeps a server-calculated same-name repair when the compact output omits its source row', () => {
    const rows = buildWeldingJournalWaitingRepairRows([{
      id: 2,
      projectTitle: 'Проект',
      subtitleCode: 'Шифр',
      line: 'Линия',
      joint: 'F1',
      officiality: 'официальный',
      weldDate: null,
      finalStatus: 'ожидает ремонт',
    }])

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      joint: 'F1',
      finalStatus: 'ожидает ремонт',
      previousJoint: 'F1 неофициальный',
    })
  })

  it('links a waiting repair to the rejected joint in the same exact line identity', () => {
    const rejected = {
      id: 1,
      projectTitle: 'A|B',
      subtitleCode: 'C',
      line: 'L',
      joint: 'F1',
      officiality: 'официальный',
      weldDate: '2026-07-01',
      hasRk: 'да',
      rkResult: 'ремонт',
    } satisfies WeldInput
    const unrelatedRejected = {
      ...rejected,
      id: 2,
      projectTitle: 'A',
      subtitleCode: 'B|C',
      joint: 'F1R1',
    } satisfies WeldInput
    const targetJoint = getExpectedRepeatedJointName(rejected, 'F1', 'ремонт')
    const target = {
      id: 3,
      projectTitle: rejected.projectTitle,
      subtitleCode: rejected.subtitleCode,
      line: rejected.line,
      joint: targetJoint,
      officiality: 'официальный',
      weldDate: null,
    } satisfies WeldInput

    const rows = buildWeldingJournalWaitingRepairRows([unrelatedRejected, rejected, target])

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 3, previousJoint: 'F1' })
  })
})
