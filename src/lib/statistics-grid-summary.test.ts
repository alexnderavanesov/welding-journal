import { expect, it } from 'vitest'
import { buildLineSummary } from './line-summary'
import { buildWelderStatisticsSummary } from './welder-statistics-summary'
import { summarizeLineGridRows, summarizeWelderGridRows } from './statistics-grid-summary'

it('keeps the selected welder contribution, detail IDs and a weighted defect denominator', () => {
  const source = buildWelderStatisticsSummary([
    { id: 1, joint: 'F1', weldDate: '2026-07-01', wdi: '10', stamp1KFact: 'ROOT', stamp1ZFact: 'FILL', stamp1OFact: 'FILL', hasVik: 'да', vikResult: 'годен' },
    { id: 2, joint: 'S1', weldDate: '2026-07-01', wdi: '30', stamp1KFact: 'ROOT', stamp1ZFact: 'OTHER', stamp1OFact: 'OTHER', hasRk: 'да', rkResult: 'ремонт' },
  ], [], '2026-07-01', '2026-07-31', 'wdi')
  const root = source.rows.find(row => row.stamp === 'ROOT')!
  expect(summarizeWelderGridRows(source, [root])).toMatchObject({ totalWelders: 1, total: 16,
    good: 4, rejected: 12, fTotal: 4, sTotal: 12, defectPercent: 75, rows: [{ rowIds: [1, 2] }] })
  expect(summarizeWelderGridRows(source, [root]).rows[0]).toBe(root)
  expect(summarizeWelderGridRows(source, []).defectPercent).toBe(0)
  expect(summarizeWelderGridRows(source, []).total).toBe(0)
  expect(source.totalWelders).toBe(3)
})

it('line projection retains requested order and excludes hidden rows from totals and navigation', () => {
  const source = buildLineSummary([
    { id: 1, projectTitle: 'P', subtitleCode: 'S', line: 'L1', joint: 'F1', weldDate: '2026-07-01' },
    { id: 2, projectTitle: 'P', subtitleCode: 'S', line: 'L2', joint: 'F1' },
    { id: 3, projectTitle: 'P', subtitleCode: 'S', line: 'L2', joint: 'F2' },
  ], 'joints')
  const remaining = source.rows.find(row => row.line === 'L2')!
  expect(summarizeLineGridRows(source, [remaining])).toEqual({ rows: [remaining], total: 2, completed: 0, remaining: 2 })
  expect(summarizeLineGridRows(source, [])).toEqual({ rows: [], total: 0, completed: 0, remaining: 0 })
  expect(summarizeLineGridRows(source, source.rows)).toBe(source)
  expect(summarizeLineGridRows(source, [...source.rows].reverse()).rows[0]).toBe(source.rows[1])
})
