import { describe, expect, it } from 'vitest'
import type { WeldRow } from './dispatcher-types'
import { buildRepeatedJointTasks } from './repeated-joint-tasks'
import { buildLnkOfficialityChainPlan } from './lnk-officiality-chain-plan'
import { getLnkResultRestrictionReasons } from './lnk-result-policy'

const row = (id: number, joint: string, values: Partial<WeldRow> = {}): WeldRow => ({
  id, projectTitle: 'COUNTER', subtitleCode: 'CHECK', line: 'L1', joint,
  category: 'II', groupName: 'Б(а)', weldControlPercent: 10, pvkControlPercent: 0,
  connectionType: 'С17', d1: 108, d2: 108, weldDate: '2026-09-01',
  officiality: null, rowVersion: String(id), ...values,
})

describe('unofficial attempts do not consume the official repair limit', () => {
  it.each([false, true])('validates each eligible source independently of display deduplication (reverse=%s)', reverse => {
    const rows = [row(1, 'S1', { officiality: 'неофициальный', rkResult: 'ремонт' }),
      row(2, 'S1', { officiality: 'неофициальный', rkResult: 'вырез', weldDate: '2026-09-02' }),
      row(3, 'S1', { officiality: 'неофициальный', pstoRequired: 'да', hasRk: 'да', preHeatTreatmentLnkEnabled: true,
        preHeatTreatmentControls: [{ id: 31, weldJointId: 3, method: 'РК', result: 'ремонт' }] as WeldRow['preHeatTreatmentControls'] })]
    if (reverse) rows.reverse()
    expect(buildRepeatedJointTasks(rows).filter(task => task.kind === 'create')).toHaveLength(1)
    for (const source of rows) {
      const tasks = buildRepeatedJointTasks(rows, [], [], { creationSourceRowId: source.id })
      expect(tasks.filter(task => task.kind === 'create')).toEqual([
        expect.objectContaining({ row: source, targetJoint: 'S1' }),
      ])
    }
  })

  it('retains other rows in chain validation when checking one source', () => {
    const source = row(1, 'S1', { officiality: 'неофициальный', rkResult: 'ремонт' })
    // A duplicate official continuation elsewhere in this physical chain is a
    // real integrity blocker; filtering the input down to the source is unsafe.
    const rows = [source, row(2, 'S1R1'), row(3, 'S1R1')]
    const tasks = buildRepeatedJointTasks(rows, [], [], { creationSourceRowId: source.id })
    expect(tasks.some(task => task.kind === 'duplicate-check')).toBe(true)
    expect(tasks.filter(task => task.kind === 'create' || task.kind === 'coil')).toEqual([])
  })

  it.each([0, 1])('allows the next repair after %i official repairs despite many unofficial attempts', completed => {
    const currentJoint = completed ? 'S1R1' : 'S1'
    const current = row(100, currentJoint, { rkResult: 'ремонт' })
    const rows = [
      ...(completed ? [row(1, 'S1', { rkResult: 'ремонт' })] : []),
      ...Array.from({ length: 12 }, (_, index) => row(index + 10, currentJoint, { officiality: 'неофициальный', rkResult: 'ремонт' })),
      current,
    ]
    expect(getLnkResultRestrictionReasons(current, 'РК', 'ремонт')).toEqual([])
    const tasks = buildRepeatedJointTasks(rows)
    expect(tasks.filter(task => task.kind === 'create')).toEqual([
      expect.objectContaining({ sourceJoint: currentJoint, targetJoint: `S1R${completed + 1}` }),
    ])
    expect(tasks.filter(task => task.kind === 'coil' || task.kind === 'check' && task.systemWarningCode === 'СП-07')).toEqual([])
  })

  it('retains the actual two-repair limit while unofficial R2 repeats keep the same name', () => {
    const rows = [row(1, 'S1', { rkResult: 'ремонт' }), row(2, 'S1R1', { rkResult: 'ремонт' }),
      row(3, 'S1R2', { officiality: 'неофициальный', rkResult: 'ремонт' }), row(4, 'S1R2')]
    expect(getLnkResultRestrictionReasons(rows[2], 'РК', 'ремонт')).toEqual([])
    expect(getLnkResultRestrictionReasons(rows[3], 'РК', 'ремонт')).toEqual([expect.stringContaining('Третий ремонт')])
    expect(buildRepeatedJointTasks(rows).filter(task => task.kind === 'create' || task.kind === 'coil')).toEqual([])
  })

  it.each([1, 2])('rebuilds the remaining counter when rejected step %i becomes unofficial, and restores it back', sourceId => {
    const initial = [row(1, 'S1', { rkResult: 'ремонт' }), row(2, 'S1R1', { rkResult: 'ремонт' }), row(3, 'S1R2')]
    const plan = buildLnkOfficialityChainPlan(initial, [sourceId], 'unofficial')
    const changed = initial.map(value => ({ ...value,
      joint: plan.renames.find(change => change.rowId === value.id)?.targetJoint ?? value.joint,
      officiality: value.id === sourceId ? 'неофициальный' : value.officiality,
    }))
    expect(changed[2].joint).toBe('S1R1')
    expect(getLnkResultRestrictionReasons(changed[2], 'РК', 'ремонт')).toEqual([])
    const restored = buildLnkOfficialityChainPlan(changed, [sourceId], 'official')
    expect(restored.renames).toContainEqual({ rowId: 3, currentJoint: 'S1R1', targetJoint: 'S1R2' })
    expect(getLnkResultRestrictionReasons({ ...changed[2], joint: 'S1R2' }, 'РК', 'ремонт')).toEqual([expect.stringContaining('Третий ремонт')])
  })
})
