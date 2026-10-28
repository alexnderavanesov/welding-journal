import { expect, it } from 'vitest'
import { buildPrintableReportHtml, type PrintableReport } from './printable-report'

const parse = (report: PrintableReport, printLayout = true) => new DOMParser().parseFromString(
  buildPrintableReportHtml(report, { embedded: true, compactPrint: true, printLayout }), 'text/html')
const cells = (row: Element) => [...row.querySelectorAll('td')].flatMap(cell =>
  cell.colSpan > 1 ? Array(cell.colSpan).fill('') : [cell.textContent])

it('prints every selected value once across readable parts, repeating line and joint for each row', () => {
  const columns = Array.from({ length: 111 }, (_, i) => i === 4 ? 'Линия' : i === 7 ? 'Стык' : `Поле ${i}`)
  const rows = Array.from({ length: 3 }, (_, r) => columns.map((_, c) => c === 4 ? `LINE-${r}` : c === 7 ? `F${r}` : `${r}:${c}`))
  const report = { title: 'Журнал', generatedAt: '2026-10-28T06:00:00Z', tables: [{ title: '', columns, rows,
    printIdentity: { columns: ['Линия', 'Стык'], indexes: [4, 7], rows: rows.map(row => [row[4], row[7]]) } }] }
  const before = JSON.stringify(report)
  const tables = [...parse(report).querySelectorAll('table')]
  expect(tables.length).toBeGreaterThan(1)
  const seen = new Map<string, number>()
  for (const table of tables) {
    const headers = [...table.querySelectorAll('thead th')].map(cell => cell.textContent!)
    expect(headers.slice(0, 2)).toEqual(['Линия', 'Стык'])
    expect(headers.length).toBeLessThanOrEqual(10)
    for (const label of headers) seen.set(label, (seen.get(label) ?? 0) + 1)
    expect([...table.querySelectorAll('tbody tr')].map(cells)).toEqual(rows.map(row => headers.map(label => row[columns.indexOf(label)])))
  }
  for (const label of columns) expect(seen.get(label)).toBe(['Линия', 'Стык'].includes(label) ? tables.length : 1)
  expect(JSON.stringify(report)).toBe(before)
  expect(parse(report, false).querySelectorAll('table')).toHaveLength(1)
})

it('adds omitted identity fields only to split printing, preserving escaping, zero and empty data', () => {
  const columns = Array.from({ length: 15 }, (_, i) => `Поле ${i}`)
  const values = columns.map((_, i) => i === 0 ? 0 : i === 1 ? '<script>no()</script>\nстрока' : '')
  const report = { title: 'Отбор', tables: [{ title: '', columns, rows: [values],
    printIdentity: { columns: ['Линия', 'Стык'], indexes: [-1, -1], rows: [['Линия <А>', 'F9']] } }] }
  const doc = parse(report)
  expect(doc.querySelectorAll('table').length).toBeGreaterThan(1)
  expect(doc.querySelector('script')).toBeNull()
  for (const table of doc.querySelectorAll('table')) {
    const headers = [...table.querySelectorAll('thead th')].map(cell => cell.textContent!)
    expect(cells(table.querySelector('tbody tr')!)).toEqual(['Линия <А>', 'F9', ...headers.slice(2).map(label => String(values[columns.indexOf(label)]))])
  }
  const preview = parse(report, false)
  expect(preview.querySelectorAll('thead th')).toHaveLength(15)
  expect(preview.body.textContent).not.toContain('Линия <А>')
})

it('keeps the identifying first column and group/detail/total rows in split statistical tables', () => {
  const columns = ['Проект', ...Array.from({ length: 20 }, (_, i) => `Показатель ${i}`)]
  const rows = ['Итого', 'Проект А', 'Материал М01'].map(label => [label, ...Array.from({ length: 20 }, (_, i) => i)])
  const report: PrintableReport = { title: 'Статистика', tables: [{ title: 'Динамика', columns, rows, rowKinds: ['total', 'group', 'detail'] }] }
  const tables = [...parse(report).querySelectorAll('table')]
  expect(tables.length).toBeGreaterThan(1)
  for (const table of tables) {
    expect(table.querySelector('thead th')?.textContent).toBe('Проект')
    expect([...table.querySelectorAll('tbody tr')].map(row => row.className)).toEqual(['table-row-total', 'table-row-group', 'table-row-detail'])
    expect([...table.querySelectorAll('tbody tr')].map(row => cells(row)[0])).toEqual(['Итого', 'Проект А', 'Материал М01'])
  }
})
