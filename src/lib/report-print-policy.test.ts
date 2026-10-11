import { expect, it } from 'vitest'
import { getReportPrintRestriction, getReportRowCount } from './report-print-policy'

it.each([0, 1, 999, 1000, 1001, 10000])('uses the complete table row count at %i rows', count => {
  const report = { title: 'Report', tables: [{ title: '', columns: ['A'], rows: Array.from({ length: count }, () => ['value']) }] }
  expect(getReportRowCount(report)).toBe(count)
  expect(Boolean(getReportPrintRestriction(report))).toBe(count > 1000)
})

it('counts group and total rows across tables but not headers, badges or source population', () => {
  const report = { title: 'Summary', metrics: [{ label: 'Стыков', value: '200000' }], tables: [
    { title: 'First', columns: ['A'], rows: Array.from({ length: 999 }, () => ['value']) },
    { title: 'Second', columns: ['A'], rows: [['Group'], ['Total']], rowKinds: ['group', 'total'] as Array<'group' | 'total'> },
  ] }
  expect(getReportRowCount(report)).toBe(1001)
  expect(getReportPrintRestriction(report)).toContain('1001 строк')
  expect(getReportPrintRestriction({ ...report, tables: [] })).toBe('')
})
