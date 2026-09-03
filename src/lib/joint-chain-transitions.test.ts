import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import {
  buildJointCoilTransitions,
  getCoilParentBranchJoint,
  getJointBranchRows,
  getJointCoilRelations,
} from '@/lib/joint-chain-transitions'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from '@/lib/system-index-settings'

describe('joint coil transitions', () => {
  it('finds the immediate parent branch for regular and nested coils', () => {
    expect(getCoilParentBranchJoint('S1Y1')).toBe('S1')
    expect(getCoilParentBranchJoint('S1Y1R2')).toBe('S1')
    expect(getCoilParentBranchJoint('S1Y1Y2')).toBe('S1Y1')
    expect(getCoilParentBranchJoint('S1Y1Y2W1')).toBe('S1Y1')
    expect(getCoilParentBranchJoint('S1R2')).toBeNull()
  })

  it('treats an accepted early decision as a valid transition for its exact source', () => {
    const rows = [
      row(1, 'S1', { rkResult: 'ремонт' }),
      row(2, 'S1Y1'),
      row(3, 'S1Y2'),
    ]

    expect(buildJointCoilTransitions(rows)).toMatchObject([{
      parentBranchJoint: 'S1',
      sourceRowId: null,
      sourceJoint: 'S1',
      targetJoints: ['S1Y1', 'S1Y2'],
      targetRowIds: [2, 3],
      mode: null,
    }])
    expect(buildJointCoilTransitions(rows, {
      earlyCoilDecisionSourceRowIds: new Set([1]),
    })).toMatchObject([{
      parentBranchJoint: 'S1',
      sourceRowId: 1,
      sourceJoint: 'S1',
      targetJoints: ['S1Y1', 'S1Y2'],
      targetRowIds: [2, 3],
      mode: 'early-decision',
    }])
  })

  it('keeps nested coil transitions independent from their parent coil', () => {
    const rows = [
      row(1, 'S1', { rkResult: 'ремонт' }),
      row(2, 'S1Y1', { rkResult: 'ремонт' }),
      row(3, 'S1Y2'),
      row(4, 'S1Y1Y1'),
      row(5, 'S1Y1Y2'),
    ]
    const transitions = buildJointCoilTransitions(rows, {
      earlyCoilDecisionSourceRowIds: new Set([1, 2]),
    })

    expect(transitions.map((transition) => ({
      parent: transition.parentBranchJoint,
      source: transition.sourceJoint,
      targets: transition.targetJoints,
      mode: transition.mode,
    }))).toEqual([
      { parent: 'S1', source: 'S1', targets: ['S1Y1', 'S1Y2'], mode: 'early-decision' },
      { parent: 'S1Y1', source: 'S1Y1', targets: ['S1Y1Y1', 'S1Y1Y2'], mode: 'early-decision' },
    ])

    const relation = getJointCoilRelations(rows[3], rows, transitions)
    expect(relation.sourceRow?.joint).toBe('S1Y1')
    expect(relation.siblingRow?.joint).toBe('S1Y1Y2')
    expect(relation.parentBranchJoint).toBe('S1Y1')
  })

  it('returns only the selected Y branch and its R/W continuation', () => {
    const rows = [
      row(1, 'S1'),
      row(2, 'S1R1'),
      row(3, 'S1Y1'),
      row(4, 'S1Y1R1'),
      row(5, 'S1Y2'),
    ]

    expect(getJointBranchRows(rows, rows[3]).map((candidate) => candidate.joint)).toEqual([
      'S1Y1',
      'S1Y1R1',
    ])
  })

  it('uses configured suffixes for nested targets', () => {
    const settings = {
      ...DEFAULT_SYSTEM_INDEX_SETTINGS,
      coil: 'K',
    }
    const rows = [
      row(1, 'S1K1', { rkResult: 'ремонт' }),
      row(2, 'S1K1K1'),
      row(3, 'S1K1K2'),
    ]

    const transition = buildJointCoilTransitions(rows, {
      earlyCoilDecisionSourceRowIds: new Set([1]),
      systemIndexSettings: settings,
    }).find((candidate) => candidate.parentBranchJoint === 'S1K1')

    expect(transition).toMatchObject({
      parentBranchJoint: 'S1K1',
      targetJoints: ['S1K1K1', 'S1K1K2'],
      mode: 'early-decision',
    })
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
