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

  it('preserves the automatic coil limit when earlier repeated rows are missing', () => {
    const rows = [
      row(1, 'S30', { rkResult: 'вырез' }),
      row(4, 'S30W3', { rkResult: 'вырез' }),
    ]

    expect(buildJointCoilTransitions(rows)).toMatchObject([{
      parentBranchJoint: 'S30',
      sourceRowId: 4,
      sourceJoint: 'S30W3',
      targetJoints: ['S30Y1', 'S30Y2'],
      targetRowIds: [null, null],
      mode: 'limit',
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

  it('keeps equal joint names on different lines in separate coil transitions', () => {
    const rows = [
      row(1, 'S1', { line: 'LIN-A', rkResult: 'ремонт' }),
      row(2, 'S1Y1', { line: 'LIN-A' }),
      row(3, 'S1Y2', { line: 'LIN-A' }),
      row(4, 'S1', { line: 'LIN-B', rkResult: 'ремонт' }),
      row(5, 'S1Y1', { line: 'LIN-B' }),
      row(6, 'S1Y2', { line: 'LIN-B' }),
    ]
    const transitions = buildJointCoilTransitions(rows, {
      earlyCoilDecisionSourceRowIds: new Set([1]),
    })

    expect(transitions).toHaveLength(2)
    expect(transitions).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceRowId: 1, targetRowIds: [2, 3], mode: 'early-decision' }),
      expect.objectContaining({ sourceRowId: null, targetRowIds: [5, 6], mode: null }),
    ]))

    const lineBRelation = getJointCoilRelations(rows[4], rows, transitions)
    expect(lineBRelation.currentBranchRoot?.id).toBe(5)
    expect(lineBRelation.siblingRow?.id).toBe(6)
    expect(lineBRelation.sourceRow).toBeNull()
  })

  it('treats joint and line letter case as the same identity', () => {
    const rows = [
      row(1, 's1', { line: 'Lin123', rkResult: 'ремонт' }),
      row(2, 'S1Y1', { line: 'LIN123' }),
      row(3, 's1y2', { line: 'lin123' }),
    ]
    const transitions = buildJointCoilTransitions(rows, {
      earlyCoilDecisionSourceRowIds: new Set([1]),
    })

    expect(transitions).toHaveLength(1)
    expect(transitions[0]).toMatchObject({
      sourceRowId: 1,
      targetRowIds: [2, 3],
      mode: 'early-decision',
    })
    expect(getJointCoilRelations(rows[1], rows, transitions)).toMatchObject({
      sourceRow: { id: 1 },
      siblingRow: { id: 3 },
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
