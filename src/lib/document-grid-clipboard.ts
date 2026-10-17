import type { GridApi } from 'ag-grid-community'
import { isDocumentHistoryGroupRow } from './document-history-grid'

const NON_DATA_COLUMNS = new Set(['__actions', '__selection', 'ag-Grid-SelectionColumn'])

function tsvValue(value: string | number) {
  const text = String(value ?? '')
  return /[\t\r\n"]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/** Copy only cached leaf rows. A distant range must never load or walk its missing rows. */
export function documentGridClipboardText<T>(
  api: GridApi<T>,
  allowedColumns: readonly string[] | ReadonlySet<string>,
  getValue: (key: string, row: T) => string | number,
): string {
  if (api.isDestroyed()) return ''
  const allowed = new Set(allowedColumns)
  const cellRanges = api.getCellRanges?.() ?? []
  const focused = cellRanges.length ? null : api.getFocusedCell()
  const ranges = cellRanges.length ? cellRanges : focused ? [{ startRow: focused, endRow: focused, columns: [focused.column] }] : []
  if (!ranges.length) return ''
  const loaded = new Map<number, T>()
  api.forEachNode(node => {
    if (node.rowIndex == null || node.rowIndex < 0 || node.rowPinned || node.group || node.footer || node.stub || !node.data || isDocumentHistoryGroupRow(node.data)) return
    loaded.set(node.rowIndex, node.data)
  })
  const rows = [...loaded.entries()].sort(([left], [right]) => left - right)
  const copied = new Map<number, Set<string>>()
  const blocks: string[] = []
  for (const range of ranges) {
    if (range.startRow?.rowPinned || range.endRow?.rowPinned) continue
    const columns = [...new Set(range.columns.map(column => column.getColId()))].filter(key => allowed.has(key) && !NON_DATA_COLUMNS.has(key))
    if (!columns.length) continue
    const first = range.startRow?.rowIndex ?? 0, last = range.endRow?.rowIndex ?? Infinity
    const start = Math.min(first, last), end = Math.max(first, last)
    const lines: string[] = []
    for (const [index, row] of rows) {
      if (index < start || index > end) continue
      const previous = copied.get(index) ?? new Set<string>()
      let hasNewCell = false
      const values = columns.map(key => {
        // Keep the second rectangle's column positions without repeating an
        // overlapping cell's content. Entirely repeated rows/ranges are omitted.
        if (previous.has(key)) return ''
        previous.add(key); hasNewCell = true
        return tsvValue(getValue(key, row))
      })
      copied.set(index, previous)
      if (hasNewCell) lines.push(values.join('\t'))
    }
    if (lines.length) blocks.push(lines.join('\n'))
  }
  return blocks.join('\n\n')
}
