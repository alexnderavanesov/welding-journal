import { describe, expect, it } from 'vitest'
import type { WeldRow } from './dispatcher-types'
import { calculateLineProgram } from './line-program-calculation'

// Independent acceptance examples from the agreed 30 September plan, sections 2–11.
const joint = (id: number, values: Partial<WeldRow> = {}): WeldRow => ({
  id, projectTitle: 'P', subtitleCode: 'S', line: 'L', joint: `F${id}`,
  connectionType: 'СШ', officiality: 'действующий', revisionActuality: 'актуальная',
  weldDate: '2026-09-01', stamp1K: 'A', hasVik: 'да', ...values,
})
const line = (count: number) => Array.from({ length: count }, (_, i) => joint(i + 1))
const calculation = (rows: WeldRow[], percent = 10, pvk = 10, stamp = 'A') =>
  calculateLineProgram(rows, percent, pvk).find(group => group.stamp === stamp)!

describe('agreed line program rules, 30 September 2026', () => {
  it.each(['F1R1', 'F1R2', 'F1W1', 'F1R1W1'])('excludes %s from quantity, credit, candidates and surcharge', name => {
    const rows = line(20)
    rows[0] = joint(1, { rkResult: 'ремонт' })
    rows.push(joint(100, { joint: name, hasRk: 'да', rkResult: 'ремонт', hasPvk: 'да', pvkResult: 'годен' }))
    const group = calculation(rows, 5, 5)
    expect(group.rowIds).toHaveLength(20)
    expect(group.rejectedRowIds).toEqual([1])
    expect(group.common).toMatchObject({ baseRequired: 1, additionalRequired: 2, coveredRowIds: [1], missing: 2 })
    expect(group.common.candidateRowIds).not.toContain(100)
    expect(group.pvk.coveredRowIds).toEqual([])
  })

  it('does not create a percentage group for a welder who only repaired another welder’s joint', () => {
    expect(calculateLineProgram([joint(1, { rkResult: 'ремонт' }), joint(2, { joint: 'F1R1', stamp1K: 'B', hasRk: 'да', rkResult: 'годен' })], 10, 0).map(group => group.stamp)).toEqual(['A'])
  })

  it.each(['vikResult', 'pvkResult'] as const)('%s does not create extra RK/UZK places', field => {
    const rows = line(20)
    rows[0] = joint(1, { [field]: 'ремонт', hasRk: 'да', hasPvk: 'да' })
    const group = calculation(rows, 5, 5)
    expect(group.rejectedRowIds).toEqual([])
    expect(group.common).toMatchObject({ baseRequired: 1, additionalRequired: 0, coveredRowIds: [], missing: 1 })
    expect(group.pvk.coveredRowIds).toEqual([])
  })

  it('retains rejected primary RK credit, but loses even good PVK credit', () => {
    const rows = line(10)
    rows[0] = joint(1, { rkResult: 'ремонт', hasPvk: 'да', pvkResult: 'годен' })
    const group = calculation(rows)
    expect(group.common).toMatchObject({ required: 3, coveredRowIds: [1], missing: 2 })
    expect(group.pvk).toMatchObject({ required: 1, coveredRowIds: [], missing: 1 })
  })

  it('keeps 1 → 3 → 5 credit without another replacement for the second rejected primary joint', () => {
    const rows = line(10)
    rows[0].rkResult = 'ремонт'
    rows[1].hasRk = 'да'
    rows[2].hasUzk = 'да'
    expect(calculation(rows).common).toMatchObject({ required: 3, missing: 0 })
    rows[1].rkResult = 'ремонт'
    expect(calculation(rows).common).toMatchObject({ required: 5, coveredRowIds: [1, 2, 3], missing: 2 })
    rows[3].hasRk = 'да'; rows[4].hasUzk = 'да'
    expect(calculation(rows).common.missing).toBe(0)
  })

  it('caps available assignments without losing the theoretical extra places', () => {
    const rows = [joint(1, { rkResult: 'ремонт' }), joint(2)]
    expect(calculation(rows).common).toMatchObject({ baseRequired: 1, additionalRequired: 2, required: 3, actionableRequired: 2, missing: 1 })
    rows[1].hasRk = 'да'
    expect(calculation(rows).common).toMatchObject({ required: 3, actionableRequired: 2, missing: 0 })
  })

  it('replaces six connections by seven only after both coil joints are welded', () => {
    const rows = line(6)
    rows[0].rkResult = 'ремонт'; rows[1].hasRk = 'да'; rows[2].hasUzk = 'да'
    rows.push(joint(7, { joint: 'F1Y1' }), joint(8, { joint: 'F1Y2', weldDate: null }))
    expect(calculation(rows).rowIds).toHaveLength(6)
    expect(calculation(rows).common.missing).toBe(0)
    rows[7].weldDate = '2026-09-02'
    const replaced = calculation(rows)
    expect(replaced.rowIds).toEqual([2, 3, 4, 5, 6, 7, 8])
    expect(replaced.rejectedRowIds).toEqual([1])
    expect(replaced.common).toMatchObject({ baseRequired: 1, additionalRequired: 2, coveredRowIds: [2, 3], missing: 1 })
    rows[6].hasRk = 'да'
    expect(calculation(rows).common.missing).toBe(0)
  })

  it('recalculates rounding and lost source credit separately at 24 → 25 connections', () => {
    const rows = line(24)
    rows[0].rkResult = 'ремонт'
    for (const index of [1, 2, 3]) rows[index].hasRk = 'да'
    expect(calculation(rows).common).toMatchObject({ required: 4, missing: 0 })
    rows.push(joint(25, { joint: 'F1Y1' }), joint(26, { joint: 'F1Y2' }))
    expect(calculation(rows).common).toMatchObject({ baseRequired: 3, additionalRequired: 2, required: 5, coveredRowIds: [2, 3, 4], missing: 2 })
  })

  it('does not return a replaced parent when a coil joint becomes unofficial', () => {
    const rows = [joint(1, { rkResult: 'ремонт' }), joint(2, { joint: 'F1Y1' }), joint(3, { joint: 'F1Y2', officiality: 'неофициальный' })]
    const group = calculation(rows)
    expect(group.rowIds).toEqual([2])
    expect(group.rejectedRowIds).toEqual([1])
    expect(group.common.coveredRowIds).toEqual([])
  })

  it('plans an unwelded pair at 100%, without counting the parent a third time', () => {
    const [group] = calculateLineProgram([joint(1), joint(2, { joint: 'F1Y1', weldDate: null }), joint(3, { joint: 'F1Y2', weldDate: null })], 100, 100)
    expect(group.rowIds).toEqual([2, 3])
    expect(group.common.required).toBe(2)
  })

  it('uses all three unique official stamps and protects assignments needed by any one of them', () => {
    const rows: WeldRow[] = line(10).map(row => ({ ...row, stamp1Z: 'B', stamp1O: 'C' }))
    rows[0].rkResult = 'ремонт'; rows[1].hasRk = 'да'; rows[2].hasUzk = 'да'
    for (const group of calculateLineProgram(rows, 10, 0)) {
      expect(group.common).toMatchObject({ required: 3, coveredRowIds: [1, 2, 3], missing: 0, excessRowIds: [] })
    }
    rows[0].stamp1O = null
    const third = calculation(rows, 10, 0, 'C')
    expect(third).toMatchObject({ rejectedRowIds: [], common: { required: 1, coveredRowIds: [2, 3], excessRowIds: [] } })
    expect(third.rowIds).toHaveLength(9)
  })

  it('deduplicates stamps, input IDs and event sources, independently of input order', () => {
    const rows = line(10)
    rows[0] = joint(1, { rkResult: 'ремонт', stamp1Z: 'A', stamp1O: 'A' })
    const expected = calculateLineProgram(rows, 10, 0)
    expect(calculateLineProgram([...rows].reverse().concat(rows[0]), 10, 0)).toEqual(expected)
    expect(expected).toHaveLength(1)
    expect(expected[0].common.additionalRequired).toBe(2)
  })

  it('never treats an orphan repair as a primary joint after deletion of its predecessors', () => {
    const rows = [joint(2, { joint: 'F1R2', hasRk: 'да', rkResult: 'ремонт' }), joint(3)]
    const group = calculation(rows)
    expect(group.rowIds).toEqual([3])
    expect(group.rejectedRowIds).toEqual([])
    expect(group.common.coveredRowIds).toEqual([])
  })
})
