import { describe, expect, it } from 'vitest'
import type { WeldRow } from './dispatcher-types'
import { calculateLineProgram } from './line-program-calculation'
import { getProgramRemovalHints } from './line-program-excess'
import { applyProgramPatch } from './line-program-workspace'
import { calculateSupportRequired } from './support-program-calculation'

const op = (id: number, extra: Partial<WeldRow> = {}): WeldRow => ({ id, joint: `ОП-${id}`, connectionType: 'Т1',
  projectTitle: 'P', subtitleCode: 'S', line: 'L', weldDate: '2026-11-01', stamp1K: 'A', ...extra })
const calculate = (rows: WeldRow[], percent = 100) => calculateLineProgram(rows, percent, percent, undefined, new Set(), true)
const removeSuggested = (rows: WeldRow[], percent = 100) => {
  const groups = calculate(rows, percent), hints = getProgramRemovalHints(1, rows, groups, new Set())
  return { groups, hints, next: rows.map(row => applyProgramPatch(row, Object.fromEntries([...hints.get(row.id)?.keys() ?? []].map(method => [method, ''])))) }
}

describe('support assignments use independent physical quotas and jointly safe removals', () => {
  it('rounds small fractional percentages upward without rejecting 0.5%', () => {
    expect(calculateSupportRequired(1, 0.5)).toBe(1)
    expect(calculateSupportRequired(201, 0.5)).toBe(2)
    expect(calculateSupportRequired(1000, 0.7)).toBe(7)
  })
  it('limits reachable demand only for the cancelled method and keeps replacements as candidates', () => {
    const rows = [op(1, { hasUzk: 'да' }), op(2, { hasUzk: 'да' }), op(3, { hasUzk: 'отменен' })]
    const [full] = calculate(rows)
    expect(full.common).toMatchObject({ required: 3, actionableRequired: 2, missing: 0, coveredRowIds: [1, 2], cancelledRowIds: [3] })
    expect(full.pvk).toMatchObject({ required: 3, actionableRequired: 3, missing: 3 })
    const [replacement] = calculate([...rows, ...Array.from({ length: 7 }, (_, i) => op(i + 4))], 30)
    expect(replacement.common).toMatchObject({ required: 3, actionableRequired: 3, missing: 1, candidateRowIds: [4, 5, 6, 7, 8, 9, 10] })
  })
  it('counts an R chain once and protects the inherited repair assignment', () => {
    const rows = [op(1, { hasUzk: 'да', vikResult: 'ремонт' }), op(2, { joint: 'ОП-1R1', hasUzk: 'да', stamp1K: 'B' })]
    const { groups, hints, next } = removeSuggested(rows)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ stamp: 'A', rowIds: [1], contextRowIds: [1, 2], common: { required: 1, coveredRowIds: [1] } })
    expect([...hints.keys()]).toEqual([1])
    expect(calculate(next)[0].common).toMatchObject({ missing: 0, coveredRowIds: [1] })
  })
  it('keeps all inherited member assignments despite a completed physical credit', () => {
    const rows = [op(1, { hasUzk: 'да', uzkResult: 'годен', vikResult: 'ремонт' }),
      op(2, { joint: 'ОП-1R1', hasUzk: 'да', vikResult: 'ремонт' }), op(3, { joint: 'ОП-1R2', hasUzk: 'да' })]
    const { hints, next } = removeSuggested(rows)
    expect([...hints.keys()].sort()).toEqual([])
    expect(calculate(next)[0].common).toMatchObject({ coveredRowIds: [1], completedRowIds: [1], missing: 0 })
  })
  it('keeps mandatory repair control out of optional excess and removals', () => {
    const rows = [op(1, { hasUzk: 'да', uzkResult: 'ремонт' }), op(2, { joint: 'ОП-1R1', hasUzk: 'да' })]
    const { hints, groups } = removeSuggested(rows)
    expect(hints.size).toBe(0)
    expect(groups[0].common.excessAssignments).toEqual([])
    expect(groups[0].common).toMatchObject({ required: 1, coveredRowIds: [1], completedRowIds: [1] })
  })
  it('one request is removable; additional accepts only the selected excess and does not fabricate a fact', () => {
    const rows = Array.from({ length: 4 }, (_, i) => op(i + 1, { hasUzk: 'да', uzkRequest: 'A1', uzkRequestDate: '2026-11-02' }))
    const { hints, next } = removeSuggested(rows, 75)
    expect([...hints.keys()]).toEqual([4])
    expect(calculate(next, 75)[0].common.missing).toBe(0)
    const withAdditional = rows.map(row => row.id === 4 ? { ...row, hasUzk: 'дополнительный' } : row)
    expect(calculate(withAdditional, 75)[0].common).toMatchObject({ coveredRowIds: [1, 2, 3, 4], additionalRowIds: [4], completedRowIds: [], excessAssignments: [] })
    expect(calculate([...withAdditional, op(5, { hasUzk: 'да' }), op(6, { hasUzk: 'да' })], 50)[0].common.excessAssignments).toHaveLength(2)
  })
})
