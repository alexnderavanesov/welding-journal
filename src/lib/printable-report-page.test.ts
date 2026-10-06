import { expect, it } from 'vitest'
import { getPrintableReportPage } from './printable-report-page'
import type { PrintableReport } from './printable-report'

it('limits the combined visible rows across tables, preserving order, headings and row kinds', () => {
  const report: PrintableReport = { title: 'All', metrics: [{ label: 'Всего', value: '205' }], tables: [
    { title: 'A', columns: ['A'], rows: Array.from({ length: 75 }, (_, i) => [i]) },
    { title: 'B', columns: ['B'], rows: Array.from({ length: 130 }, (_, i) => [i + 75]), rowKinds: Array(130).fill('detail') },
  ] }
  const rows = []
  for (let page = 0; page < 3; page++) {
    const result = getPrintableReportPage(report, page)
    const visible = result.report.tables!.flatMap(t => t.rows)
    expect(visible.length).toBeLessThanOrEqual(100)
    expect(result.total).toBe(205)
    expect(result.report.metrics).toBe(report.metrics)
    expect(result.report.tables!.at(-1)!.rowKinds).toHaveLength(result.report.tables!.at(-1)!.rows.length)
    rows.push(...visible)
  }
  expect(rows).toEqual(Array.from({ length: 205 }, (_, i) => [i]))
  expect(report.tables![1].rows).toHaveLength(130)
  expect(getPrintableReportPage(report, 99).page).toBe(2)
  expect(getPrintableReportPage(report, -1).page).toBe(0)
})

it('keeps small and empty reports intact, including empty tables', () => {
  const report: PrintableReport = { title: 'Empty', tables: [{ title: 'A', columns: ['A'], rows: [] }] }
  expect(getPrintableReportPage(report, 2)).toMatchObject({ report, page: 0, total: 0, pageCount: 1 })
  expect(getPrintableReportPage(report, 0).report).toBe(report)
})

it('keeps the parent group visible when a statistics page starts with detail rows', () => {
  const report: PrintableReport = { title: 'Statistics', tables: [{ title: 'Projects', subtitle: 'Проект → материал',
    columns: ['Проект / материал'], rows: [['Проект А'], ...Array.from({ length: 101 }, (_, i) => [`М${i + 1}`])],
    rowKinds: ['group', ...Array<'detail'>(101).fill('detail')],
  }] }
  const second = getPrintableReportPage(report, 1)
  expect(second.report.tables![0].subtitle).toBe('Проект → материал Продолжение группы: Проект А.')
  expect(second.report.tables![0].rows).toEqual([['М100'], ['М101']])
  expect(report.tables![0].subtitle).toBe('Проект → материал')
  expect(report.tables![0].rows).toHaveLength(102)
})
