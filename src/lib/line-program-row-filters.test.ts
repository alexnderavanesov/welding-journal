import { describe, expect, it } from 'vitest'
import type { WeldRow } from './dispatcher-types'
import { countProgramRows, programRowStatus } from './line-program-row-filters'
import { calculateLineProgram } from './line-program-calculation'
import { createProgramRowSelector } from './line-program-selection'

const row = (id: number, values: Partial<WeldRow> = {}): WeldRow => ({ id, joint: `F${id}`, connectionType: 'С17',
  weldDate: '2026-09-01', stamp1K: 'A', hasVik: 'да', vikResult: 'годен', ...values })

describe('compact program: saved record status filters', () => {
  it('separates good, pending, rejected, errors and excluded history without treating quota credit as good', () => {
    const rows = [row(1), row(2, { hasRk: 'да' }), row(3, { hasRk: 'да', rkResult: 'ремонт' }),
      row(4, { hasRk: null, rkResult: 'годен' }), row(5, { officiality: 'неофициальный' }),
      row(6, { revisionActuality: 'не актуален' }), row(7, { weldDate: null }), row(8, { joint: 'F1R1' })]
    expect(countProgramRows(rows)).toEqual({ all: 8, good: 2, incomplete: 2, rejected: 1, error: 1 })
    const select = createProgramRowSelector(rows, calculateLineProgram(rows, 30, 10), 1, new Set())
    expect(select({ slice: 'all', status: 'good' }).map(r => r.id)).toEqual([1, 8])
    expect(select({ slice: 'all', status: 'incomplete' }).map(r => r.id)).toEqual([2, 7])
    expect(select({ slice: 'all', status: 'rejected' }).map(r => r.id)).toEqual([3])
    expect(select({ slice: 'all', status: 'error' }).map(r => r.id)).toEqual([4])
    expect(select({ slice: 'all' })).toHaveLength(8)
    expect(select({ slice: 'all', search: 'f5' }).map(r => r.id)).toEqual([5])
    expect(select({ slice: 'all', status: 'good', search: 'F1R' }).map(r => r.id)).toEqual([8])
  })
  it('does not label an assigned method, failed pre-TO control or incomplete PSTO as good', () => {
    expect(programRowStatus(row(1, { hasPvk: 'да' }))).toBe('incomplete')
    expect(programRowStatus(row(2, { pstoRequired: 'да', preHeatTreatmentLnkEnabled: true, preHeatTreatmentControls: [
      { id: 1, weldJointId: 2, method: 'ВИК', result: 'ремонт' },
    ] }))).toBe('rejected')
    expect(programRowStatus(row(3, { pstoRequired: 'да' }))).toBe('incomplete')
  })
  it('keeps missing bounded by the existing demand and reuses filtered arrays', () => {
    const rows = [row(1, { hasRk: 'отменен', hasUzk: 'отменен' }), row(2)]
    const select = createProgramRowSelector(rows, calculateLineProgram(rows, 30, 0), 1, new Set())
    expect(select({ slice: 'missing' })).toEqual([])
    const scope = { slice: 'all' as const, stamp: 'a', status: 'good' as const, search: 'F2' }
    expect(select(scope)).toBe(select(scope))
    expect(select(scope).map(r => r.id)).toEqual([2])
    expect(select({ ...scope, search: 'none' })).toEqual([])
    expect(select(scope).map(r => r.id)).toEqual([2])
  })
  it('counts 200000 rows in one pass without depending on expanded groups', () => {
    const rows = Array.from({ length: 200_000 }, (_, i) => row(i + 1, { hasRk: i % 2 ? 'да' : null }))
    expect(countProgramRows(rows)).toEqual({ all: 200_000, good: 100_000, incomplete: 100_000, rejected: 0, error: 0 })
  })
})
