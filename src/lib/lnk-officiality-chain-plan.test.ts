import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import { buildLnkOfficialityChainPlan } from '@/lib/lnk-officiality-chain-plan'

describe('buildLnkOfficialityChainPlan', () => {
  it('reuses the existing continuation as the official same-name joint', () => {
    const plan = buildLnkOfficialityChainPlan([
      row({ id: 1, joint: 'S1', rkResult: 'ремонт' }),
      row({ id: 2, joint: 'S1R1', rkResult: 'вырез' }),
      row({ id: 3, joint: 'S1R1W1', finalStatus: 'годен' }),
    ], [2], 'unofficial')

    expect(plan.officialityChanges).toEqual([
      expect.objectContaining({ rowId: 2, joint: 'S1R1', nextOfficiality: 'unofficial' }),
    ])
    expect(plan.renames).toEqual([
      { rowId: 3, currentJoint: 'S1R1W1', targetJoint: 'S1R1' },
    ])
    expect(plan.earlyCoilDecisions).toEqual([])
  })

  it('replays every later result after the official same-name replacement', () => {
    const plan = buildLnkOfficialityChainPlan([
      row({ id: 1, joint: 'S1', rkResult: 'ремонт' }),
      row({ id: 2, joint: 'S1R1', rkResult: 'вырез' }),
      row({ id: 3, joint: 'S1R1W1', rkResult: 'ремонт' }),
      row({ id: 4, joint: 'S1R2W1', finalStatus: 'годен' }),
    ], [2], 'unofficial')

    expect(plan.renames).toEqual([
      { rowId: 3, currentJoint: 'S1R1W1', targetJoint: 'S1R1' },
      { rowId: 4, currentJoint: 'S1R2W1', targetJoint: 'S1R2' },
    ])
  })

  it('rebuilds the continuation after a rejected pre-heat-treatment control', () => {
    const plan = buildLnkOfficialityChainPlan([
      row({ id: 1, joint: 'S1', rkResult: 'ремонт' }),
      row({
        id: 2,
        joint: 'S1R1',
        pstoRequired: 'да',
        hasRk: 'да',
        preHeatTreatmentControls: [{
          id: 20,
          weldJointId: 2,
          method: 'РК',
          result: 'вырез',
        }],
      }),
      row({ id: 3, joint: 'S1R1W1', finalStatus: 'годен' }),
    ], [2], 'unofficial')

    expect(plan.renames).toEqual([
      { rowId: 3, currentJoint: 'S1R1W1', targetJoint: 'S1R1' },
    ])
  })

  it('rebuilds the continuation after a rejected duplicate control', () => {
    const plan = buildLnkOfficialityChainPlan([
      row({ id: 1, joint: 'S1', rkResult: 'ремонт' }),
      row({
        id: 2,
        joint: 'S1R1',
        duplicateControls: [{
          id: 30,
          weldJointId: 2,
          method: 'УЗК',
          result: 'вырез',
          controlDate: '2026-09-02',
          conclusion: 'ДУБ-30',
          conclusionDate: '2026-09-02',
        }],
      }),
      row({ id: 3, joint: 'S1R1W1', finalStatus: 'годен' }),
    ], [2], 'unofficial')

    expect(plan.renames).toEqual([
      { rowId: 3, currentJoint: 'S1R1W1', targetJoint: 'S1R1' },
    ])
  })

  it('ends the rebuilt chain on a good official replacement', () => {
    const plan = buildLnkOfficialityChainPlan([
      row({ id: 1, joint: 'S1', rkResult: 'ремонт' }),
      row({ id: 2, joint: 'S1R1', rkResult: 'вырез' }),
      row({ id: 3, joint: 'S1R1W1', finalStatus: 'годен' }),
    ], [2], 'unofficial')

    expect(plan.renames).toHaveLength(1)
    expect(plan.affectedRowIds).toEqual([2, 3])
  })

  it('resolves an official duplicate by keeping the existing good same-name joint', () => {
    const plan = buildLnkOfficialityChainPlan([
      row({ id: 1, joint: 'S1', rkResult: 'ремонт' }),
      row({ id: 2, joint: 'S1R1', rkResult: 'вырез' }),
      row({ id: 3, joint: 'S1R1', finalStatus: 'годен' }),
    ], [2], 'unofficial')

    expect(plan.officialityChanges).toEqual([
      expect.objectContaining({ rowId: 2, nextOfficiality: 'unofficial' }),
    ])
    expect(plan.renames).toEqual([])
    expect(plan.affectedRowIds).toEqual([2])
  })

  it('blocks a continuation after the replacement is already good', () => {
    expect(() => buildLnkOfficialityChainPlan([
      row({ id: 1, joint: 'S1', rkResult: 'ремонт' }),
      row({ id: 2, joint: 'S1R1', rkResult: 'вырез' }),
      row({ id: 3, joint: 'S1R1W1', finalStatus: 'годен' }),
      row({ id: 4, joint: 'S1R1W1R1', weldDate: '2026-09-04' }),
    ], [2], 'unofficial')).toThrow(/годен|продолж/)
  })

  it('blocks restoring an unofficial row when an official same-name replacement exists', () => {
    expect(() => buildLnkOfficialityChainPlan([
      row({ id: 1, joint: 'S1', rkResult: 'ремонт' }),
      row({ id: 2, joint: 'S1R1', officiality: 'неофициальный', rkResult: 'вырез' }),
      row({ id: 3, joint: 'S1R1', finalStatus: 'годен' }),
    ], [2], 'official')).toThrow(/несколько официальных/)
  })

  it('restores an unofficial row when no official same-name replacement exists', () => {
    const plan = buildLnkOfficialityChainPlan([
      row({ id: 1, joint: 'S1', officiality: 'неофициальный', rkResult: 'ремонт' }),
    ], [1], 'official')

    expect(plan.officialityChanges).toEqual([
      expect.objectContaining({ rowId: 1, nextOfficiality: 'official' }),
    ])
    expect(plan.renames).toEqual([])
  })

  it('blocks rebuilding a chain whose welding dates are out of order', () => {
    expect(() => buildLnkOfficialityChainPlan([
      row({ id: 1, joint: 'S1', weldDate: '2026-09-01', rkResult: 'ремонт' }),
      row({ id: 2, joint: 'S1R1', weldDate: '2026-09-03', rkResult: 'вырез' }),
      row({ id: 3, joint: 'S1R1W1', weldDate: '2026-09-02', finalStatus: 'годен' }),
    ], [2], 'unofficial')).toThrow(/Дата|дат|хронолог/)
  })

  it('blocks rebuilding through a pending continuation that already has a descendant', () => {
    expect(() => buildLnkOfficialityChainPlan([
      row({ id: 1, joint: 'S1', rkResult: 'ремонт' }),
      row({ id: 2, joint: 'S1R1', rkResult: 'вырез' }),
      row({ id: 3, joint: 'S1R1W1' }),
      row({ id: 4, joint: 'S1R1W1R1' }),
    ], [2], 'unofficial')).toThrow()
  })

  it('requires related changes in one chain to be made sequentially', () => {
    expect(() => buildLnkOfficialityChainPlan([
      row({ id: 1, joint: 'S1', rkResult: 'ремонт' }),
      row({ id: 2, joint: 'S1R1', rkResult: 'вырез' }),
    ], [1, 2], 'unofficial')).toThrow(/только один стык каждой цепочки/)
  })

  it('allows equal joint names to be rebuilt independently on different lines', () => {
    const plan = buildLnkOfficialityChainPlan([
      row({ id: 1, line: 'Line-A', joint: 'S1', rkResult: 'ремонт' }),
      row({ id: 2, line: 'Line-A', joint: 'S1R1', rkResult: 'вырез' }),
      row({ id: 3, line: 'Line-A', joint: 'S1R1W1', finalStatus: 'годен' }),
      row({ id: 4, line: 'Line-B', joint: 'S1', rkResult: 'ремонт' }),
      row({ id: 5, line: 'Line-B', joint: 'S1R1', rkResult: 'вырез' }),
      row({ id: 6, line: 'Line-B', joint: 'S1R1W1', finalStatus: 'годен' }),
    ], [2, 5], 'unofficial')

    expect(plan.renames).toEqual([
      { rowId: 3, currentJoint: 'S1R1W1', targetJoint: 'S1R1' },
      { rowId: 6, currentJoint: 'S1R1W1', targetJoint: 'S1R1' },
    ])
  })

  it('does not mix an existing rename repair with the officiality change', () => {
    expect(() => buildLnkOfficialityChainPlan([
      row({ id: 1, joint: 'S1', rkResult: 'ремонт' }),
      row({ id: 2, joint: 'S1W1', rkResult: 'вырез' }),
      row({ id: 3, joint: 'S1W1W1', finalStatus: 'годен' }),
    ], [2], 'unofficial')).toThrow(/уже требует отдельного переименования/)
  })

  it('blocks making the direct source of an existing coil unofficial', () => {
    const rows = cutoutCoilRows()

    expect(() => buildLnkOfficialityChainPlan(rows, [4], 'unofficial')).toThrow(
      /непосредственным основанием катушки/,
    )
  })

  it('keeps a downstream automatic coil through an explicit early-coil decision', () => {
    const plan = buildLnkOfficialityChainPlan(cutoutCoilRows(), [2], 'unofficial')

    expect(plan.renames).toEqual([
      { rowId: 3, currentJoint: 'S1W2', targetJoint: 'S1W1' },
      { rowId: 4, currentJoint: 'S1W3', targetJoint: 'S1W2' },
    ])
    expect(plan.earlyCoilDecisions).toEqual([
      {
        sourceRowId: 4,
        sourceJoint: 'S1W2',
        targetJoints: ['S1Y1', 'S1Y2'],
      },
    ])
  })

  it('blocks an incomplete coil in the affected chain', () => {
    const rows = cutoutCoilRows().filter((candidate) => candidate.joint !== 'S1Y2')

    expect(() => buildLnkOfficialityChainPlan(rows, [2], 'unofficial')).toThrow(/создана не полностью/)
  })

  it('treats joint and line letter case as one chain', () => {
    const plan = buildLnkOfficialityChainPlan([
      row({ id: 1, joint: 's1', line: 'Lin123', rkResult: 'ремонт' }),
      row({ id: 2, joint: 'S1R1', line: 'LIN123', rkResult: 'вырез' }),
      row({ id: 3, joint: 's1r1w1', line: 'lin123', finalStatus: 'годен' }),
    ], [2], 'unofficial')

    expect(plan.renames).toEqual([
      { rowId: 3, currentJoint: 's1r1w1', targetJoint: 'S1R1' },
    ])
  })
})

function cutoutCoilRows() {
  return [
    row({ id: 1, joint: 'S1', rkResult: 'вырез' }),
    row({ id: 2, joint: 'S1W1', rkResult: 'вырез' }),
    row({ id: 3, joint: 'S1W2', rkResult: 'вырез' }),
    row({ id: 4, joint: 'S1W3', rkResult: 'вырез' }),
    row({ id: 5, joint: 'S1Y1' }),
    row({ id: 6, joint: 'S1Y2' }),
  ]
}

function row(values: Partial<WeldRow>): WeldRow {
  return {
    id: values.id ?? 1,
    projectTitle: 'Проект',
    subtitleCode: 'Шифр',
    line: 'Линия',
    joint: values.joint ?? 'S1',
    weldDate: '2026-09-01',
    officiality: 'официальный',
    rowVersion: `version-${values.id ?? 1}`,
    ...values,
  } as WeldRow
}
