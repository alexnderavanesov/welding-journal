import { describe, expect, it } from 'vitest'
import type { WeldRow } from '@/lib/dispatcher-types'
import {
  calculateLineProgram,
  calculateLineProgramBaseRequired,
  parseLineProgramPercent,
} from './line-program-calculation'

function row(id: number, overrides: Partial<WeldRow> = {}): WeldRow {
  return { id, joint: `F${id}`, connectionType: 'СШ', weldDate: '2026-09-01',
    officiality: 'действующий', revisionActuality: 'актуальная', hasVik: 'да', stamp1K: 'A', ...overrides }
}
function rows(count: number) { return Array.from({ length: count }, (_, i) => row(i + 1)) }

describe('line program: requirements with September 30 clarifications', () => {
  it.each([
    [0, 10, 0], [4, 0, 0], [4, 10, 1], [21, 10, 2], [24, 10, 2], [25, 10, 3],
    [25, 100, 25], [2500, 0.0999, 2], [2500, 0.1, 3], [2500, 0.1001, 3],
    [2500, 0.14, 4], [200_000, 0.001, 2],
  ])('rounds %i at %s%% to %i', (count, percent, expected) => {
    expect(calculateLineProgramBaseRequired(count, percent)).toBe(expected)
  })

  it('keeps missing requirements distinct from zero and accepts decimal commas', () => {
    for (const value of [null, undefined, '', ' ', true, -1, 100.1, 'abc']) expect(parseLineProgramPercent(value)).toBeNull()
    expect(parseLineProgramPercent('0')).toBe(0)
    expect(parseLineProgramPercent('0,5')).toBe(0.5)
  })

  it('excludes rejected repairs for both their own welders and their parent', () => {
    const input = rows(30)
    input[0] = row(1, { joint: 'F1', rkResult: 'ремонт' })
    input[1] = row(2, { joint: 'F1R1', stamp1K: 'B', pvkResult: 'ремонт' })
    input[2] = row(3, { joint: 'F1R2', stamp1K: 'B', vikResult: 'ремонт' })
    const result = calculateLineProgram(input, 10, 10)
    expect(result.find((s) => s.stamp === 'A')?.rejectedRowIds).toEqual([1])
    expect(result.find((s) => s.stamp === 'B')).toBeUndefined()
  })

  it('the fourth rejected primary RK/UZK record requires full control of the stamp', () => {
    const input = rows(30)
    for (let i = 0; i < 4; i++) input[i] = row(i + 1, { rkResult: 'ремонт' })
    const [result] = calculateLineProgram(input, 10, 10)
    expect(result.rejectedRowIds).toEqual([1, 2, 3, 4])
    expect(result.fullControlRequired).toBe(true)
    expect(result.common.required).toBe(30)
    expect(result.pvk.required).toBe(3)
  })

  it.each([0, 0.5, 1, 1.5, 30, 100])('applies distinct surcharge and zero/full limits for %s%%', (percent) => {
    const input = rows(100)
    input[0].rkResult = 'ремонт'
    const [result] = calculateLineProgram(input, percent, percent === 100 ? 1 : 0)
    const base = calculateLineProgramBaseRequired(100, percent)
    expect(result.common.required).toBe(percent === 0 ? 0 : Math.min(100, base + (percent === 1 ? 1 : 2)))
  })

  it('does not multiply rejection across methods, stages, duplicates or duplicate input records', () => {
    const rejected = row(1, { rkResult: 'ремонт', pvkResult: 'вырез',
      preHeatTreatmentControls: [{ id: 1, weldJointId: 1, method: 'ВИК', result: 'ремонт' }],
      duplicateControls: [{ id: 1, weldJointId: 1, method: 'УЗК', result: 'вырез', controlDate: '2026-09-02', conclusion: 'D', conclusionDate: '2026-09-02' }] })
    const [result] = calculateLineProgram([rejected, rejected, ...rows(20).slice(1)], 30, 10)
    expect(result.rejectedRowIds).toEqual([1])
    expect(result.common.required).toBe(8)
  })

  it('excludes T, unofficial, obsolete and unwelded records; TVMT does not add surcharge', () => {
    const [result] = calculateLineProgram([
      row(1, { tvmtResult: 'ремонт' }), row(2, { connectionType: 'Т', rkResult: 'ремонт' }),
      row(3, { officiality: 'неофициальный', rkResult: 'ремонт' }),
      row(4, { revisionActuality: 'не актуален', rkResult: 'ремонт' }),
      row(5, { weldDate: null, rkResult: 'ремонт' }),
    ], 10, 10)
    expect(result.rowIds).toEqual([1])
    expect(result.rejectedRowIds).toEqual([])
  })

  it('rejected PVK loses coverage without increasing common demand', () => {
    const input = rows(20)
    input[0] = row(1, { hasPvk: 'да', pvkResult: 'годен' })
    input[1] = row(2, { hasPvk: 'да', pvkResult: 'ремонт' })
    const [result] = calculateLineProgram(input, 30, 10)
    expect(result.common.required).toBe(6)
    expect(result.pvk.required).toBe(2)
    expect(result.pvk.coveredRowIds).toEqual([1])
    expect(result.pvk.missing).toBe(1)
  })

  it('replaces impossible unperformed PVK and restores coverage after correcting erroneous VIK', () => {
    const input = rows(20)
    input[0] = row(1, { hasPvk: 'да', pvkResult: 'годен' })
    input[1] = row(2, { hasPvk: 'да', vikResult: 'ремонт' })
    expect(calculateLineProgram(input, 30, 10)[0].pvk.missing).toBe(1)
    input[1].vikResult = 'годен'
    expect(calculateLineProgram(input, 30, 10)[0].pvk.missing).toBe(0)
  })

  it('counts our PVK before TO once and never substitutes a good duplicate', () => {
    const input = rows(20)
    input[0] = row(1, { hasPvk: 'да', vikResult: 'ремонт',
      preHeatTreatmentControls: [{ id: 1, weldJointId: 1, method: 'ПВК', result: 'годен' }] })
    input[1] = row(2, { duplicateControls: [{ id: 1, weldJointId: 2, method: 'ПВК', result: 'годен', controlDate: '2026-09-02', conclusion: 'D', conclusionDate: '2026-09-02' }] })
    const [result] = calculateLineProgram(input, 30, 10)
    expect(result.pvk.completedRowIds).toEqual([1])
    expect(result.pvk.missing).toBe(2)
  })

  it('preserves performed PVK after cancellation and suppresses impossible unmet demand', () => {
    const input = rows(5).map((r) => ({ ...r, hasPvk: 'да' }))
    input[4] = { ...input[4], hasPvk: 'отменен' }
    let result = calculateLineProgram(input, 100, 100)[0]
    expect(result.pvk.required).toBe(5)
    expect(result.pvk.coveredRowIds).toHaveLength(4)
    expect(result.pvk.missing).toBe(0)
    result = calculateLineProgram([...input, row(6)], 100, 100)[0]
    expect(result.pvk.missing).toBe(1)
    input[4].pvkResult = 'годен'
    expect(calculateLineProgram(input, 100, 100)[0].pvk.coveredRowIds).toHaveLength(5)
  })

  it('protects A+B and A+C assignments that are needed by B and C', () => {
    const result = calculateLineProgram([
      row(1, { stamp1Z: 'B', hasRk: 'да' }), row(2, { stamp1Z: 'C', hasRk: 'да' }),
      row(3, { hasRk: 'да' }),
    ], 10, 0)
    expect(result.find((r) => r.stamp === 'A')!.common.excessRowIds).toEqual([3])
    expect(result.find((r) => r.stamp === 'B')!.common.excessRowIds).toEqual([])
    expect(result.find((r) => r.stamp === 'C')!.common.excessRowIds).toEqual([])
  })

  it('flags two mandatory interchangeable methods even at 100%', () => {
    const [result] = calculateLineProgram([row(1, { hasRk: 'да', hasUzk: 'да' })], 100, 1)
    expect(result.common.duplicateAssignmentRowIds).toEqual([1])
    expect(result.common.coveredRowIds).toEqual([1])
  })

  it('ordinary angular PVK does not replace RK/UZK; only explicit layered assignment does', () => {
    const ordinary = row(1, { connectionType: 'УШ', hasPvk: 'да' })
    expect(calculateLineProgram([ordinary], 100, 1)[0].common.missing).toBe(1)
    expect(calculateLineProgram([{ ...ordinary, layeredControlAssigned: true }], 100, 1)[0].common.missing).toBe(0)
  })

  it('a necessary layered companion takes one PVK place and makes ordinary excess visible', () => {
    const input = rows(20)
    input[0].hasPvk = 'да'
    input[1].hasPvk = 'да'
    input[2] = row(3, { connectionType: 'УШ', hasPvk: 'да', layeredControlAssigned: true })
    const [result] = calculateLineProgram(input, 30, 10)
    expect(result.pvk.excessRowIds).toHaveLength(1)
    expect(result.pvk.excessRowIds).not.toContain(3)
    input[0] = { ...input[0], connectionType: 'УШ', layeredControlAssigned: true }
    input[1] = { ...input[1], connectionType: 'УШ', layeredControlAssigned: true }
    expect(calculateLineProgram(input, 30, 10)[0].pvk.excessRowIds).toEqual([])
  })

  it('protects necessary companions at PVK zero, then flags remaining ordinary PVK after removal', () => {
    const input = rows(20)
    input[0] = row(1, { connectionType: 'УШ', hasPvk: 'да', layeredControlAssigned: true })
    expect(calculateLineProgram(input, 10, 0)[0].pvk.excessRowIds).toEqual([])
    input[0].layeredControlAssigned = false
    expect(calculateLineProgram(input, 10, 0)[0].pvk.excessRowIds).toEqual([1])
  })

  it('cancellation of RK+UZK covers C only; additional performed control also covers one place', () => {
    const [result] = calculateLineProgram([
      row(1, { hasRk: 'отменен', hasUzk: 'отменен' }),
      row(2, { connectionType: 'УШ', hasRk: 'отменен', hasUzk: 'отменен' }),
      row(3, { hasRk: 'дополнительный', rkResult: 'годен' }),
    ], 100, 1)
    expect(result.common.coveredRowIds).toEqual([1, 3])
    expect(result.common.completedRowIds).toEqual([3])
  })
})
