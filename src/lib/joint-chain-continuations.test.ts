import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import { buildJointChainContinuations } from '@/lib/joint-chain-continuations'

describe('joint chain continuations', () => {
  it('records an existing repeated joint as the resolved decision for its rejected source', () => {
    const continuations = buildJointChainContinuations([
      row(1, 'S1', { rkResult: 'ремонт' }),
      row(2, 'S1R1'),
    ])

    expect(continuations).toMatchObject([{
      kind: 'repeated-joint',
      sourceRowId: 1,
      sourceJoint: 'S1',
      targetJoints: ['S1R1'],
      targetRowIds: [2],
    }])
  })

  it('records the official same-name row after a rejected unofficial result', () => {
    const continuations = buildJointChainContinuations([
      row(1, 'S1R1', { officiality: 'неофициальный', rkResult: 'ремонт' }),
      row(2, 'S1R1'),
    ])

    expect(continuations).toMatchObject([{
      kind: 'official-joint',
      sourceRowId: 1,
      targetJoints: ['S1R1'],
      targetRowIds: [2],
    }])
  })

  it('records a complete early coil and every earlier direct step independently', () => {
    const continuations = buildJointChainContinuations([
      row(1, 'S1', { rkResult: 'ремонт' }),
      row(2, 'S1R1', { rkResult: 'ремонт' }),
      row(3, 'S1Y1'),
      row(4, 'S1Y2'),
    ], {
      earlyCoilDecisionSourceRowIds: new Set([2]),
    })

    expect(continuations.map((continuation) => ({
      kind: continuation.kind,
      sourceRowId: continuation.sourceRowId,
      targets: continuation.targetJoints,
    }))).toEqual([
      { kind: 'repeated-joint', sourceRowId: 1, targets: ['S1R1'] },
      { kind: 'coil', sourceRowId: 2, targets: ['S1Y1', 'S1Y2'] },
    ])
  })

  it('does not call a partially deleted coil complete', () => {
    const continuations = buildJointChainContinuations([
      row(1, 'S1', { rkResult: 'ремонт' }),
      row(3, 'S1R1'),
      row(2, 'S1Y1'),
    ], {
      earlyCoilDecisionSourceRowIds: new Set([1]),
    })

    expect(continuations).toEqual([])
  })

  it('recognizes a complete automatic coil at the inferred failure limit', () => {
    const continuations = buildJointChainContinuations([
      row(1, 'S30W3', { rkResult: 'вырез' }),
      row(2, 'S30Y1'),
      row(3, 'S30Y2'),
    ])

    expect(continuations).toMatchObject([{
      kind: 'coil',
      sourceRowId: 1,
      targetJoints: ['S30Y1', 'S30Y2'],
    }])
  })

  it('does not match a same-name target from another line', () => {
    const continuations = buildJointChainContinuations([
      row(1, 'S1', { rkResult: 'ремонт' }),
      row(2, 'S1R1', { line: 'LIN-2' }),
    ])

    expect(continuations).toEqual([])
  })
})

function row(id: number, joint: string, values: Partial<WeldRow> = {}): WeldRow {
  return {
    id,
    projectTitle: 'Проект',
    subtitleCode: '400',
    line: 'LIN-1',
    joint,
    weldDate: '2026-09-01',
    officiality: 'официальный',
    ...values,
  } as WeldRow
}
