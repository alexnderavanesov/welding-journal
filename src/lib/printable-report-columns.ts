import type { PrintableReportTable } from './printable-report'

// A4 landscape, 9 mm margins, with a small allowance for table borders.
const PAGE_WIDTH = 1050
type Column = { label: string; source: number; values: Array<string | number>; width: number }
export type PrintColumnPart = { table: PrintableReportTable; widths: number[]; sources: number[]; part: number; parts: number }

/** Split only the print representation. Each original non-key column appears once. */
export function splitPrintColumns(table: PrintableReportTable): PrintColumnPart[] {
  const columns = table.columns.map((label, source): Column => {
    const values = table.rows.map(row => row[source] ?? '')
    return { label, source, values, width: columnWidth(label, values) }
  })
  const unchanged = () => [{ table, widths: columns.map(c => c.width), sources: columns.map(c => c.source), part: 0, parts: 1 }]
  if (columns.reduce((sum, column) => sum + column.width, 0) <= PAGE_WIDTH) return unchanged()
  const identity = table.printIdentity
  const keys: Column[] = identity ? identity.columns.map((label, i) => {
    const source = identity.indexes[i]
    const values = identity.rows.map(row => row[i] ?? '')
    return { label, source: source >= 0 ? source : -i - 1, values, width: Math.min(240, Math.ceil(columnWidth(label, values) * 1.25)) }
  }) : columns.filter((column, i) => i === 0 || ['Линия', 'Стык'].includes(column.label))
  const repeated = new Set(keys.filter(key => key.source >= 0).map(key => key.source))
  const remaining = columns.filter(column => !repeated.has(column.source))
  if (!remaining.length) return unchanged()
  const keyWidth = keys.reduce((sum, column) => sum + column.width, 0)
  const groups: Column[][] = []
  let group: Column[] = [], width = keyWidth
  for (const column of remaining) {
    if (group.length && width + column.width > PAGE_WIDTH) { groups.push(group); group = []; width = keyWidth }
    group.push(column); width += column.width
  }
  if (group.length) groups.push(group)
  return groups.map((group, part) => {
    const selected = [...keys, ...group]
    return { table: { ...table, columns: selected.map(c => c.label), rows: table.rows.map((_, row) => selected.map(c => c.values[row])) },
      widths: selected.map(c => c.width), sources: selected.map(c => c.source), part, parts: groups.length }
  })
}

function columnWidth(label: string, values: Array<string | number>) {
  let length = Math.min(40, label.length)
  for (const value of values) for (const line of String(value).split('\n')) length = Math.max(length, Math.min(40, line.length))
  return Math.max(96, Math.min(240, Math.ceil(length * 5.8 + 18)))
}
