import { describe, expect, it } from 'vitest'
import { buildLineProgramDisplay } from './line-program-display'
import { calculateLineProgram } from './line-program-calculation'
import { summarizeLineProgram } from './line-program-overview'
import type { WeldRow } from './dispatcher-types'

const row = (id: number, extra: Partial<WeldRow> = {}): WeldRow => ({ id, connectionType: 'С17', weldDate: '2026-09-01', stamp1K: 'A', ...extra })
describe('line display: physical joints versus stamp quota places', () => {
  it('explains incomplete work from actual states, never treating a waiting label as a request', () => {
    const rows = [
      row(1, { weldDate: null, hasVik: 'да', vikResult: 'ожидает НК', vikRequest: 'V-PLAN' }),
      row(2, { hasVik: 'да', vikResult: 'ожидает НК' }),
      row(3, { hasVik: 'да', vikRequest: 'V-1', vikResult: 'ожидает заявку', stamp1Z: 'B' }),
      row(4, { hasVik: 'да', vikResult: 'годен' }),
      row(5, { hasVik: 'да', vikResult: 'ремонт' }),
      row(6, { hasRk: null, rkResult: 'ремонт' }),
      row(7, { officiality: 'неофициальный', hasVik: 'да' }),
      row(8),
    ]
    const display = buildLineProgramDisplay(rows, calculateLineProgram(rows, 10, 10), 10, 10)
    expect(display.summary).toMatchObject({ count: 7, journalRows: 8, good: 1, rejected: 1, errors: 1,
      incompleteStages: { welding: 1, request: 2, control: 1, other: 0 } })
    expect(display.stampRows.find(group => group.stamp === 'B')).toMatchObject({ count: 1, incompleteStages: { welding: 0, request: 0, control: 1, other: 0 } })
    expect(Object.values(display.summary.incompleteStages).reduce((sum, count) => sum + count, 0)).toBe(display.summary.count - display.summary.good - display.summary.rejected - display.summary.errors)
  })
  it('explains 3 assigned PVK joints covering only 2 of 3 places (DEMO-L07)', () => {
    const rows = [row(1, { stamp1Z: 'B' }), row(2, { hasPvk: 'да' }), row(3, { hasPvk: 'да' }), row(4), row(5, { hasPvk: 'да' })]
    const groups = calculateLineProgram(rows, 100, 30)
    const display = buildLineProgramDisplay(rows, groups, 100, 30)
    expect(display.summary).toMatchObject({ count: 5, common: { required: 5 }, pvk: { assigned: 3, required: 3, covered: 2, missing: 1 } })
    expect(display.stampRows.map(g => [g.stamp, g.count, g.common.required, g.pvk.required, g.pvk.assigned])).toEqual([['A', 5, 5, 2, 3], ['B', 1, 1, 1, 0]])
    const line = { id: 1, projectTitle: '', subtitleCode: '', line: 'L', category: 'II', groupName: 'A', version: '1', configurationIssue: null, weldControlPercent: 100, pvkControlPercent: 30 }
    expect(summarizeLineProgram(rows, line).pvk).toMatchObject({ required: display.summary.pvk.required, covered: display.summary.pvk.covered, missing: display.summary.pvk.missing })
  })
  it('deduplicates physical assignments but preserves each percentage quota, including layered replacement', () => {
    const rows = [row(1, { stamp1Z: 'B', connectionType: 'У19', layeredControlAssigned: true, hasVik: 'да', hasPvk: 'да', vikResult: 'годен', pvkResult: 'годен' })]
    const { summary, stampRows } = buildLineProgramDisplay(rows, calculateLineProgram(rows, 30, 10), 30, 10)
    expect(summary).toMatchObject({ count: 1, good: 1, common: { assigned: 1, covered: 2, required: 2 }, pvk: { assigned: 1, covered: 2, required: 2 } })
    expect(stampRows).toHaveLength(2)
  })
  it('projects full/full stamps without multiplying quotas or hiding unstamped/unwelded joints', () => {
    const rows = [row(1, { stamp1Z: 'B', hasRk: 'да', hasPvk: 'да' }), row(2, { stamp1K: null, weldDate: null })]
    const groups = calculateLineProgram(rows, 100, 100)
    expect(groups).toHaveLength(1)
    const display = buildLineProgramDisplay([...rows, rows[0]], groups, 100, 100)
    expect(display.summary).toMatchObject({ count: 2, common: { required: 2, covered: 1 }, pvk: { required: 2, covered: 1 } })
    expect(display.stampRows.map(g => [g.stamp, g.common.required, g.pvk.required])).toEqual([['A', 1, 1], ['B', 1, 1]])
  })
  it('shows planned assignments and all stamp groups without inflating percentage quotas', () => {
    const rows = [row(1), row(2, { weldDate: null, stamp1K: 'B', hasRk: 'да' }), row(3, { weldDate: null, stamp1K: null, hasPvk: 'да' }), row(4, { stamp1K: null, hasRk: 'да' }), row(5, { officiality: 'неофициальный', stamp1K: null }), row(6, { connectionType: 'Т', stamp1K: null })]
    const display = buildLineProgramDisplay(rows, calculateLineProgram(rows, 30, 10), 30, 10)
    expect(display.summary).toMatchObject({ count: 4, common: { required: 1, assigned: 2, covered: 0 }, pvk: { required: 1, assigned: 1 } })
    expect(display.stampRows.map(g => [g.stamp, g.count, g.waitingWeld, g.common.assigned, g.common.required])).toEqual([['A', 1, 0, 0, 1], ['B', 1, 1, 1, 0]])
    expect(display.unassigned).toMatchObject({ count: 2, waitingWeld: 1, common: { assigned: 1, required: 0 }, pvk: { assigned: 1, required: 0 } })
    expect(summarizeLineProgram(rows, { id: 1, projectTitle: '', subtitleCode: '', line: 'L', category: 'II', groupName: 'A', version: '1', configurationIssue: null, weldControlPercent: 30, pvkControlPercent: 10 }).stamps).toBe(2)
  })
  it('handles a 200,000-joint full line with 2,000 stamps without row-by-stamp scanning or requests', () => {
    const rows = Array.from({ length: 200_000 }, (_, index) => row(index + 1, { stamp1K: `K${index % 2_000}` }))
    const groups = calculateLineProgram(rows, 100, 100)
    const display = buildLineProgramDisplay(rows, groups, 100, 100)
    expect(display.stampRows).toHaveLength(2_000)
    expect(display.summary).toMatchObject({ count: 200_000, common: { required: 200_000 }, pvk: { required: 200_000 } })
    expect(display.stampRows.every(g => g.count === 100 && g.common.required === 100)).toBe(true)
  }, 30_000)
})
