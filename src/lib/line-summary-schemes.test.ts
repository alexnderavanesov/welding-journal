import { expect, it } from 'vitest'
import { buildLineSummary, lineSchemePercent, summarizeLineCoverage } from './line-summary'
import { buildStatisticsServerResult } from './statistics-server-summary'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from './system-index-settings'

it('includes support continuations in total/completion/remainder without adding repair operations', () => {
  const rows = [
    { id: 1, joint: 'F1', connectionType: 'С17', weldDate: '2026-11-01', wdi: 10 },
    { id: 2, joint: 'S1', connectionType: 'С17', wdi: 5 },
    { id: 3, joint: 'ОП1', connectionType: 'Т1', weldDate: '2026-11-01' },
    { id: 4, joint: 'ОП1R1', connectionType: 'Т1' },
    { id: 5, joint: 'ОП2', connectionType: 'Т1', weldDate: '2026-11-01' },
  ].map(row => ({ ...row, projectTitle: 'P', subtitleCode: 'S', line: 'L' }))
  const result = buildStatisticsServerResult({ rows, welderStamps: [], systemIndexSettings: DEFAULT_SYSTEM_INDEX_SETTINGS, request: { tab: 'lineSummary', unit: 'joints' } })
  expect(result.lineSummary).toMatchObject({ total: 4, completed: 2, remaining: 2 })
  expect(result.lineSummary.rows[0]).toMatchObject({ rowIds: [1, 2, 4, 5],
    composition: { f: { total: 1, completed: 1 }, s: { total: 1, completed: 0 }, op: { total: 2, completed: 1 } } })
  const wdi = buildLineSummary(rows, 'wdi')
  expect(wdi).toMatchObject({ total: 15, completed: 10, remaining: 5 })
  expect(wdi.rows[0].composition).toEqual(result.lineSummary.rows[0].composition)
  expect(summarizeLineCoverage(wdi.rows).total).toBe(4)
  expect(buildLineSummary(rows.filter(row => row.connectionType === 'Т1'), 'wdi').rows).toHaveLength(1)
})

it('deduplicates split lines, weights physical coverage, and filters lines with no PDF into the denominator', () => {
  const summary = buildLineSummary([
    { id: 1, joint: 'F1', line: 'A', category: 'I', weldDate: '2026-11-01' },
    { id: 2, joint: 'S1', line: 'A', category: 'II' },
    { id: 3, joint: 'ОП1', line: 'B', connectionType: 'Т1' },
    { id: 4, joint: 'F1', line: 'C', weldDate: '2026-11-01' },
  ], 'joints')
  for (const row of summary.rows) row.scheme = row.line === 'A' ? { hasPdf: true, total: 10, placed: 2 }
    : row.line === 'C' ? { hasPdf: true, total: 1, placed: 1 } : { hasPdf: false, total: 4, placed: 0 }
  expect(summarizeLineCoverage(summary.rows)).toMatchObject({ lines: 3, pdfLines: 2, total: 15, placed: 3, completedLines: 1 })
  expect(summary.rows.map(lineSchemePercent)).toEqual([20, 20, 0, 100])
  expect(summarizeLineCoverage(summary.rows.filter(row => row.line === 'A'))).toMatchObject({ lines: 1, pdfLines: 1, total: 10, placed: 2 })
  expect(summarizeLineCoverage(summary.rows.filter(row => row.line === 'B'))).toMatchObject({ lines: 1, pdfLines: 0, total: 4, placed: 0 })
  expect(summarizeLineCoverage([])).toMatchObject({ lines: 0, pdfLines: 0, total: 0, placed: 0 })
  summary.rows[0].scheme = { hasPdf: true, total: 0, placed: 0 }
  expect(lineSchemePercent(summary.rows[0])).toBeNull()
})
