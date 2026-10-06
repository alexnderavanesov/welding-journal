import { describe, it, expect } from 'vitest'
import { calculateProgramCardImpact, getProgramImpactInput } from './line-program-card-impact'
import { attachProgramRepairRequirements } from './line-program-repair-requirements'
import { programApprovalKey } from './program-control-approval'

const line = { id: 1, projectTitle: 'P', subtitleCode: 'S', line: 'L', category: 'II', groupName: 'A', weldControlPercent: 10, pvkControlPercent: 0, configurationIssue: null, version: '1' }
const rows = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, projectTitle: 'P', subtitleCode: 'S', line: 'L', joint: `F${i + 1}`, connectionType: 'С', stamp1K: 'A', weldDate: '2026-09-01' }))
describe('weld card line impact', () => {
  it('shows closing missing work and an additional assignment displacing yes without saving anything', () => {
    expect(calculateProgramCardImpact(rows, { ...rows[0], hasRk: 'да' }, line)).toEqual({ before: { missing: 1, excess: 0 }, after: { missing: 0, excess: 0 } })
    const controlled = rows.map(row => row.id === 1 ? { ...row, hasRk: 'да' } : row)
    expect(calculateProgramCardImpact(controlled, { ...rows[1], hasRk: 'дополнительный' }, line)).toEqual({ before: { missing: 0, excess: 0 }, after: { missing: 0, excess: 1 } })
    expect(rows[0]).not.toHaveProperty('hasRk')
  })
  it('excludes supplied factual history/results and rejects a moved line', () => {
    expect(getProgramImpactInput({ ...rows[0], rkResult: 'годен', rkConclusion: 'not editable' })).not.toHaveProperty('rkResult')
    expect(() => calculateProgramCardImpact(rows, { ...rows[0], line: 'other' }, line)).toThrow(/перенесён/)
  })
  it('recalculates inherited repair protection when the source pair changes in the draft', () => {
    const source = { ...rows[0], hasRk: 'да', hasUzk: 'да', rkResult: 'ремонт' }
    const repair = { ...rows[0], id: 11, joint: 'F1R1', hasRk: 'да', hasUzk: 'да' }
    const approved = new Set([programApprovalKey(source, 'common', true)])
    const contextual = attachProgramRepairRequirements([source, ...rows.slice(1), repair], approved)
    const impact = calculateProgramCardImpact(contextual, { ...source, hasUzk: '' }, line, approved)
    expect(impact.before.excess).toBe(0)
    expect(impact.after.excess).toBe(1)
  })
})
