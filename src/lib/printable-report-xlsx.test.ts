import { expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { buildPrintableReportXlsx } from './printable-report-xlsx'
import type { PrintableReport } from './printable-report'

it('exports all tables, chart data and styled badges with typed numbers and intact identifiers', () => {
  const report: PrintableReport = {
    title: 'Статистика <проекта>', subtitle: 'За весь период', meta: [{ label: 'Единица', value: 'WDI' }],
    metrics: [
      { label: 'Сварено', value: '1 234,5', tone: 'blue', detail: 'В выбранном периоде' },
      { label: 'Годность', value: '99,5%', tone: 'green' },
      { label: 'Нет результата', value: '—', tone: 'rose' },
      { label: 'Остаток', value: '0', tone: 'amber' },
    ],
    charts: [{ title: 'Динамика', valueLabel: 'WDI', items: [{ label: '001', value: 15.25, detail: '2 сварщика' }] }],
    tables: [{ title: 'Группы', columns: ['Код', 'WDI', 'Доля', 'На сварщика'], numericColumns: [1, 2, 3], rows: [
      ['001', '1\u00a0234,5', '99,5%', '1,2 WDI'], ['=SUM(A1)', 0, '—', '—'], ['Итого', 1234.5, '100%', '1,2 WDI'],
    ], rowKinds: ['group', 'detail', 'total'] }],
  }
  const snapshot = structuredClone(report)
  const bytes = buildPrintableReportXlsx(report)
  const book = XLSX.read(bytes, { type: 'array', cellStyles: true, cellNF: true })
  expect(book.SheetNames).toEqual(['Сводка', 'Динамика', 'Группы'])
  const summary = book.Sheets['Сводка']
  expect(summary.A6.v).toBe(1234.5)
  expect(summary.A6.t).toBe('n')
  expect(summary.A6.s.fgColor.rgb).toBe('F1F9FD')
  expect(summary.E6.v).toBe(0.995)
  expect(summary.E6.z).toBe('0.0%')
  expect(summary.I6.v).toBe('—')
  expect(summary.A10.v).toBe(0)
  const chart = XLSX.utils.sheet_to_json(book.Sheets['Динамика'], { header: 1 }) as unknown[][]
  expect(chart.at(-1)).toEqual(['001', 15.25, '2 сварщика'])
  const table = XLSX.utils.sheet_to_json(book.Sheets['Группы'], { header: 1 }) as unknown[][]
  expect(table.slice(-3)).toEqual([['001', 1234.5, 0.995, 1.2], ['=SUM(A1)', 0, '—', '—'], ['Итого', 1234.5, 1, 1.2]])
  const formulaLike = Object.values(book.Sheets['Группы']).find(cell => cell?.v === '=SUM(A1)')
  expect(formulaLike).toMatchObject({ t: 's' })
  expect(formulaLike).not.toHaveProperty('f')
  expect(report).toEqual(snapshot)
  const xml = new TextDecoder().decode(bytes)
  expect(xml).toContain('fitToWidth="1"')
  expect(xml).toContain('_xlnm.Print_Titles')
  expect(xml).toContain('FFE8EEF4')
  expect(xml).toContain('FFEEF7FB')
})

it('makes long, duplicate and invalid sheet names unique and keeps all rows beyond the print limit', () => {
  const title = "'Очень длинное имя таблицы / : [] повторяется'"
  const bytes = buildPrintableReportXlsx({ title: 'Все строки', tables: [
    { title, columns: ['Код'], rows: Array.from({ length: 1001 }, (_, i) => [`${i}`.padStart(5, '0')]) },
    { title, columns: ['Код'], rows: [['последняя']] },
  ] })
  const book = XLSX.read(bytes, { type: 'array' })
  expect(new Set(book.SheetNames).size).toBe(3)
  for (const name of book.SheetNames) {
    expect(name.length).toBeLessThanOrEqual(31)
    expect(name).not.toMatch(/[:\\/?*\[\]]|^'|'$/)
  }
  const rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[1]], { header: 1 }) as unknown[][]
  expect(rows.at(-1)).toEqual(['01000'])
  expect(rows.filter(row => /^\d{5}$/.test(String(row[0])))).toHaveLength(1001)
})

it('keeps empty reports useful and missing values distinct from zero', () => {
  const book = XLSX.read(buildPrintableReportXlsx({ title: 'Пустой', emptyMessage: 'Нет линий.' }), { type: 'array' })
  expect(book.SheetNames).toEqual(['Сводка'])
  expect(XLSX.utils.sheet_to_json(book.Sheets['Сводка'], { header: 1 })).toContainEqual(['Нет линий.'])
})
