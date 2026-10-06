import { describe, expect, it } from 'vitest'
import { buildLineProgramReport } from './line-program-report'
import { buildLineProgramDisplay } from './line-program-display'
import { calculateLineProgram } from './line-program-calculation'
import { summarizeLineProgram } from './line-program-overview'
import { buildPrintableReportHtml } from './printable-report'
import type { WeldRow } from './dispatcher-types'
import type { LineProgramRecord } from './line-program'

const line: LineProgramRecord = { id: 1, projectTitle: 'P', subtitleCode: 'S', line: '<L1>', category: 'II', groupName: 'A', weldControlPercent: 30, pvkControlPercent: 0, version: '1', configurationIssue: null }
const rows: WeldRow[] = [{ id: 1, line: line.line, joint: 'F1', weldDate: '2026-09-01', connectionType: 'С17', stamp1K: 'A', stamp2K: 'B', hasRk: 'да' }]
const data = () => [{ line, overview: summarizeLineProgram(rows, line), stamps: buildLineProgramDisplay(rows, calculateLineProgram(rows, 30, 0), 30, 0).stampRows }]
describe('program printed summaries', () => {
  it.each(['lines', 'stamps'] as const)('retains physical-history warning in the %s report even with zero assignment debt', mode => {
    const item = data()[0]
    item.overview.integrityIssues = 1
    const report = buildLineProgramReport([item], mode, '')
    expect(report.tables?.[0].rows.every(row => String(row.at(-1)).includes('СП-04'))).toBe(true)
  })
  it('does not count a shared joint twice or merge different line quotas', () => {
    const report = buildLineProgramReport(data(), 'stamps', 'Все страницы')
    expect(report.metrics?.find(item => item.label === 'Физических стыков')?.value).toBe('1')
    expect(report.tables?.[0].rows).toHaveLength(2)
    expect(report.tables?.[0].rows.map(row => row[3])).toEqual(['A', 'B'])
    expect(report.tables?.[0].subtitle).toContain('не складываются')
  })
  it('shows the capped quota and retains configuration failures', () => {
    const report = buildLineProgramReport(data(), 'lines', 'Поиск')
    expect(report.tables?.[0].rows[0][5]).toBe('2 / 2')
    const html = buildPrintableReportHtml(report)
    expect(html).toContain('&lt;L1&gt;'); expect(html).not.toContain('<L1>')
    const item = data()[0]; item.line = { ...line, configurationIssue: 'СП-02' }
    expect(buildLineProgramReport([item], 'lines', '').tables?.[0].rows[0].at(-1)).toBe('СП-02')
  })
  it('handles an empty filter without printing unrelated lines', () => {
    const report = buildLineProgramReport([], 'stamps', 'Нет совпадений')
    expect(report.tables).toEqual([]); expect(report.metrics?.[1].value).toBe('0')
  })
})
