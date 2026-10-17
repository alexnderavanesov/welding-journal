import type { CellRange, Column, GridApi, IRowNode } from 'ag-grid-community'
import { describe, expect, it, vi } from 'vitest'
import { documentGridClipboardText } from './document-grid-clipboard'

type Row = { id: number; title: string; date: string; wdi: number; __group?: true }
const column = (key: string) => ({ getColId: () => key }) as Column
const row = (index: number, overrides: Partial<IRowNode<Row>> = {}) => ({
  rowIndex: index, data: { id: index + 1, title: `DOC-${index + 1}`, date: '16.10.2026', wdi: 12.5 }, ...overrides,
}) as IRowNode<Row>
const range = (start: number, end: number, keys: string[]) => ({
  startRow: { rowIndex: start, rowPinned: null }, endRow: { rowIndex: end, rowPinned: null }, columns: keys.map(column), startColumn: column(keys[0]),
}) satisfies CellRange

function grid(nodes: IRowNode<Row>[], ranges: CellRange[] = [], focused?: { rowIndex: number; column: Column; rowPinned: null }) {
  const accessMissingRow = vi.fn(() => { throw new Error('Clipboard must never request a row outside the cache') })
  const count = vi.fn(() => 200_000)
  const forEachNode = vi.fn((callback: (node: IRowNode<Row>) => void) => nodes.forEach(callback))
  const api = {
    isDestroyed: () => false, forEachNode, getCellRanges: () => ranges, getFocusedCell: () => focused ?? null,
    getDisplayedRowCount: count, getDisplayedRowAtIndex: accessMissingRow,
  } as unknown as GridApi<Row>
  return { api, forEachNode, accessMissingRow, count }
}

describe('document grid clipboard', () => {
  it('copies a 200000-row range from only 100 cached leaf rows without probing missing rows or groups', () => {
    const cached = Array.from({ length: 100 }, (_, index) => row(199_900 + index))
    const { api, forEachNode, accessMissingRow, count } = grid([
      row(0, { group: true }), row(1, { stub: true, data: undefined }), row(2, { footer: true }),
      row(3, { rowIndex: null }), row(4, { data: { id: 5, title: 'Group', date: '', wdi: 0, __group: true } }), row(5, { footer: true }), ...cached,
    ], [range(0, 199_999, ['title', '__actions', 'ag-Grid-SelectionColumn'])])
    const getValue = vi.fn((_key: string, record: Row) => record.title)
    const text = documentGridClipboardText(api, ['title', '__actions', 'ag-Grid-SelectionColumn'], getValue)
    expect(text.split('\n')).toHaveLength(100)
    expect(text.split('\n')[0]).toBe('DOC-199901')
    expect(text.split('\n').at(-1)).toBe('DOC-200000')
    expect(getValue).toHaveBeenCalledTimes(100)
    expect(forEachNode).toHaveBeenCalledOnce()
    expect(accessMissingRow).not.toHaveBeenCalled()
    expect(count).not.toHaveBeenCalled()
  })

  it('preserves range column order, sorts reversed row ranges, and escapes display dates, numbers, tabs, quotes and newlines', () => {
    const nodes = [row(8), row(7, { data: { id: 8, title: 'Документ\t"А"\nстрока 2', date: '16.10.2026', wdi: 12.5 } })]
    const { api } = grid(nodes, [range(8, 7, ['date', 'title', 'wdi'])])
    const text = documentGridClipboardText(api, new Set(['title', 'date', 'wdi']), (key, record) => record[key as 'title' | 'date' | 'wdi'])
    expect(text).toBe('16.10.2026\t"Документ\t""А""\nстрока 2"\t12.5\n16.10.2026\tDOC-9\t12.5')
  })

  it('deduplicates overlapping cells without shifting the later range columns', () => {
    const { api } = grid([row(2), row(1)], [range(1, 1, ['title', 'date']), range(1, 2, ['date', 'wdi']), range(1, 1, ['title'])])
    const getValue = vi.fn((key: string, record: Row) => record[key as 'title' | 'date' | 'wdi'])
    expect(documentGridClipboardText(api, ['title', 'date', 'wdi'], getValue)).toBe('DOC-2\t16.10.2026\n\n\t12.5\n16.10.2026\t12.5')
    expect(getValue).toHaveBeenCalledTimes(5)
  })

  it('uses a focused cached cell only when there is no range and never falls back from an unloaded or action cell', () => {
    const getValue = vi.fn((_key: string, record: Row) => record.title)
    expect(documentGridClipboardText(grid([row(100)], [], { rowIndex: 100, column: column('title'), rowPinned: null }).api, ['title'], getValue)).toBe('DOC-101')
    expect(documentGridClipboardText(grid([row(100)], [], { rowIndex: 50, column: column('title'), rowPinned: null }).api, ['title'], getValue)).toBe('')
    expect(documentGridClipboardText(grid([row(100)], [range(50, 50, ['title'])], { rowIndex: 100, column: column('title'), rowPinned: null }).api, ['title'], getValue)).toBe('')
    expect(documentGridClipboardText(grid([row(100)], [], { rowIndex: 100, column: column('__actions'), rowPinned: null }).api, ['__actions'], getValue)).toBe('')
    expect(getValue).toHaveBeenCalledOnce()
  })
})
