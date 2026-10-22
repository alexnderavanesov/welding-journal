import { expect, it } from 'vitest'
import { journalCopyRanges } from './journal-copy-ranges'
import { journalRangeParts, type JournalVisualRange } from './journal-server-grid'
import type { WeldFieldKey } from './weld-fields'

const order: WeldFieldKey[] = ['joint', 'wdi', 'line']
it('merges columns on the same rows in displayed column order', () => {
  expect(journalCopyRanges([{ first: 0, last: 1, columns: ['wdi'] }, { first: 0, last: 1, columns: ['joint'] }], order))
    .toEqual([{ first: 0, last: 1, columns: ['joint', 'wdi'], includeHeader: true }])
})
it('deduplicates overlaps and preserves the first encountered row order', () => {
  expect(journalCopyRanges([{ first: 2, last: 3, columns: ['joint'] }, { first: 0, last: 4, columns: ['joint'] }], order))
    .toEqual([{ first: 2, last: 3, columns: ['joint'], includeHeader: true },
      { first: 0, last: 1, columns: ['joint'] }, { first: 4, last: 4, columns: ['joint'] }])
})
it('keeps distinct headers when rows have different selected columns', () => {
  const ranges: JournalVisualRange[] = [{ first: 0, last: 1, columns: ['joint'] }, { first: 1, last: 2, columns: ['wdi'] }]
  expect(journalCopyRanges(ranges, order)).toEqual(ranges.map(range => ({ ...range, includeHeader: true })))
})
it('keeps one header across store boundaries and a new header for the next range', () => {
  const ranges = journalCopyRanges([{ first: 0, last: 2, columns: ['joint'] }, { first: 3, last: 3, columns: ['wdi'] }], order)
  expect(journalRangeParts(ranges, 2, [{ route: ['A'], ordinal: 0, rowCount: 2 }])).toEqual([
    { route: [], start: 0, end: 1, columns: ['joint'], includeHeader: true },
    { route: ['A'], start: 0, end: 2, columns: ['joint'] },
    { route: [], start: 1, end: 2, columns: ['wdi'], includeHeader: true },
  ])
})
it('represents huge overlapping ranges by a few intervals without allocating per row', () => {
  expect(journalCopyRanges([{ first: 0, last: 199999, columns: ['joint'] }, { first: 100, last: 199998, columns: ['joint'] }], order))
    .toEqual([{ first: 0, last: 199999, columns: ['joint'], includeHeader: true }])
  expect(journalCopyRanges([], order)).toEqual([])
})
it('matches an independent per-row clipboard oracle on small overlapping selections', () => {
  // Enumerate small counterexamples only in this test. The production path
  // must remain independent of how many rows the intervals cover.
  for (let seed = 1; seed <= 120; seed++) {
    let random = seed
    const next = (limit: number) => { random = (random * 1664525 + 1013904223) >>> 0; return random % limit }
    const ranges: JournalVisualRange[] = Array.from({ length: 1 + next(5) }, () => {
      const first = next(6), last = first + next(7 - first)
      const columns = order.filter(() => next(3) !== 0)
      return { first, last, columns: columns.length ? columns : ['joint'] }
    })
    const rowColumns = new Map<number, Set<WeldFieldKey>>()
    for (const range of ranges) for (let row = range.first; row <= range.last; row++) {
      const columns = rowColumns.get(row) ?? new Set<WeldFieldKey>()
      range.columns.forEach(column => columns.add(column)); rowColumns.set(row, columns)
    }
    const merge = new Set([...rowColumns.values()].map(columns => [...columns].sort().join(','))).size === 1
    const expected = merge ? [{ header: order.filter(column => rowColumns.values().next().value!.has(column)), rows: [...rowColumns.keys()] }]
      : ranges.map(range => ({ header: range.columns, rows: Array.from({ length: range.last - range.first + 1 }, (_, i) => range.first + i) }))
    const actual: { header: WeldFieldKey[]; rows: number[] }[] = []
    for (const range of journalCopyRanges(ranges, order)) {
      if (range.includeHeader) actual.push({ header: range.columns, rows: [] })
      for (let row = range.first; row <= range.last; row++) actual.at(-1)!.rows.push(row)
    }
    expect(actual, `seed ${seed}`).toEqual(expected)
  }
})
