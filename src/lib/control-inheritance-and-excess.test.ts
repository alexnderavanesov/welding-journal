import { describe, expect, it } from 'vitest'
import type { WeldRow } from './dispatcher-types'
import { attachProgramRepairRequirements, buildProgramRepairTasks, getProgramRepairAssignmentIssues } from './line-program-repair-requirements'
import { buildRepeatedJointDraft } from './repeated-joint-draft'
import { calculateLineProgram } from './line-program-calculation'
import { getProgramRemovalHints } from './line-program-excess'
import { applyProgramPatch } from './line-program-workspace'

const row = (id: number, joint = `S${id}`, patch: Partial<WeldRow> = {}): WeldRow => ({ id, joint,
  projectTitle: 'P', subtitleCode: 'S', line: 'L', connectionType: 'С17', weldDate: '2026-11-01',
  stamp1K: 'A', hasVik: 'да', weldControlPercent: 50, pvkControlPercent: 50, ...patch })
const attach = (source: WeldRow, child: WeldRow) => attachProgramRepairRequirements([source, child], new Set())[1]

describe('4 November decision: exact inherited assignments and explicit additional control', () => {
  it.each(['да', 'дополнительный', 'отменен'])('protects inherited %s from an official parent, including without a result', assignment => {
    const child = attach(row(1, 'S1', { hasRk: assignment }), row(2, 'S1R1', { hasRk: assignment }))
    expect(getProgramRepairAssignmentIssues({ ...child, hasRk: null }, child)).toHaveLength(1)
    for (const different of ['да', 'дополнительный', 'отменен'].filter(value => value !== assignment)) {
      expect(getProgramRepairAssignmentIssues({ ...child, hasRk: different }, child)).toHaveLength(1)
    }
    expect(getProgramRepairAssignmentIssues(child, child)).toEqual([])
  })
  it('copies all three states and bases unchanged even when the additional method failed', () => {
    const source = row(1, 'S1', { hasRk: 'да', hasUzk: 'дополнительный', uzkControlBasis: 'Решение 1',
      hasPvk: 'отменен', pvkControlBasis: 'Решение 2', uzkResult: 'ремонт' })
    expect(buildRepeatedJointDraft(source, 'S1R1')).toMatchObject({ hasRk: 'да', hasUzk: 'дополнительный',
      uzkControlBasis: 'Решение 1', hasPvk: 'отменен', pvkControlBasis: 'Решение 2', uzkResult: null })
  })
  it('releases the inheritance when the parent becomes unofficial, without creating SP-08', () => {
    const source = row(1, 'S1', { hasRk: 'да', rkResult: 'ремонт', officiality: 'неофициальный' })
    const child = attach(source, row(2, 'S1R1', { hasRk: 'да' }))
    expect(getProgramRepairAssignmentIssues({ ...child, hasRk: null }, child)).toEqual([])
    expect(buildProgramRepairTasks([source, { ...child, hasRk: null }], new Set())).toEqual([])
  })
  it.each(['да', 'дополнительный', 'отменен'])('retains inherited %s when an official parent becomes obsolete', assignment => {
    const source = row(1, 'S1', { hasRk: assignment, revisionActuality: 'не актуален' })
    const child = attach(source, row(2, 'S1R1', { hasRk: assignment }))
    expect(getProgramRepairAssignmentIssues({ ...child, hasRk: null }, child)).toHaveLength(1)
    expect(buildProgramRepairTasks([source, { ...child, hasRk: null }], new Set())).toEqual([
      expect.objectContaining({ row: expect.objectContaining({ id: 2 }), systemWarningCode: 'СП-08', values: ['РК'] }),
    ])
    // Officiality, rather than actuality, is the explicit inheritance release.
    const unofficial = { ...source, officiality: 'неофициальный' }
    expect(buildProgramRepairTasks([unofficial, { ...child, hasRk: null }], new Set())).toEqual([])
  })
  it('reports a missing inherited cancellation and allows restoring it, preserving unrelated legacy edits', () => {
    const source = row(1, 'S1', { hasPvk: 'отменен', pvkControlBasis: 'Решение 2' })
    const child = attach(source, row(2, 'S1R1'))
    expect(buildProgramRepairTasks([source, child], new Set())).toHaveLength(1)
    expect(getProgramRepairAssignmentIssues(child, child)).toEqual([])
    expect(getProgramRepairAssignmentIssues({ ...child, hasPvk: 'отменен' }, child)).toEqual([])
    expect(getProgramRepairAssignmentIssues({ ...child, hasPvk: 'да' }, child)).toHaveLength(1)
  })
  it('forbids two ordinary yes assignments but accepts a yes/additional pair', () => {
    expect(() => applyProgramPatch(row(1, 'S1', { hasRk: 'да' }), { УЗК: 'да' })).toThrow(/Дополнительный/i)
    expect(applyProgramPatch(row(1, 'S1', { hasRk: 'да' }), { УЗК: 'дополнительный' }).hasUzk).toBe('дополнительный')
  })
  const scenarios = [
    { yes: 2, additional: 1, missing: 0, excess: 0 },
    { yes: 1, additional: 1, missing: 0, excess: 0 },
    { yes: 3, additional: 1, missing: 0, excess: 1 },
    { yes: 0, additional: 1, missing: 1, excess: 0 },
  ]
  it.each(['С17', 'У19', 'Т1'].flatMap(connectionType => scenarios.map(scenario => ({ ...scenario, connectionType }))))(
    '$connectionType quota two: $yes yes + $additional additional -> missing $missing, excess $excess', scenario => {
    const support = scenario.connectionType === 'Т1'
    const rows = [1, 2, 3, 4].map(id => {
      const assignment = id <= scenario.yes ? 'да' : id <= scenario.yes + scenario.additional ? 'дополнительный' : null
      return row(id, support ? `ОП-${id}` : undefined, {
        connectionType: scenario.connectionType, [support ? 'hasUzk' : 'hasRk']: assignment, hasPvk: assignment,
      })
    })
    const groups = calculateLineProgram(rows, 50, 50, undefined, new Set(), support)
    for (const kind of ['common', 'pvk'] as const) {
      expect(groups[0][kind]).toMatchObject({ required: 2, missing: scenario.missing })
      expect(groups[0][kind].excessRowIds).toHaveLength(scenario.excess)
    }
    const hints = getProgramRemovalHints(1, rows, groups, new Set())
    expect(hints.size).toBe(scenario.excess)
    expect([...hints.values()].reduce((total, methods) => total + methods.size, 0)).toBe(2 * scenario.excess)
  })
})
