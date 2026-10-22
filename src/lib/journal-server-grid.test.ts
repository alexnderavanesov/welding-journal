import { describe, expect, it } from 'vitest'
import { journalRangeParts } from './journal-server-grid'

describe('journal visual ranges across server stores', () => {
  it('refuses a range while its expanded store layout is incomplete', () => {
    expect(() => journalRangeParts([{ first: 0, last: 10, columns: ['wdi'] }], 2, []))
      .toThrow('Дождитесь загрузки')
  })
  it('includes unloaded leaf rows without enumerating the dataset', () => {
    expect(journalRangeParts([{ first: 0, last: 199999, columns: ['wdi'] }], 200000, []))
      .toEqual([{ route: [], start: 0, end: 200000, columns: ['wdi'] }])
  })
  it('counts group cells and expanded children as distinct displayed rows', () => {
    expect(journalRangeParts([{ first: 1, last: 7, columns: ['wdi'] }], 3, [
      { route: ['B'], ordinal: 1, rowCount: 2 },
      { route: ['B', 'X'], ordinal: 0, rowCount: 3 },
    ])).toEqual([
      { route: [], start: 1, end: 2, columns: ['wdi'] },
      { route: ['B'], start: 0, end: 1, columns: ['wdi'] },
      { route: ['B', 'X'], start: 0, end: 3, columns: ['wdi'] },
      { route: ['B'], start: 1, end: 2, columns: ['wdi'] },
      { route: [], start: 2, end: 3, columns: ['wdi'] },
    ])
  })
  it('does not add hidden descendants of a collapsed group', () => {
    expect(journalRangeParts([{ first: 0, last: 1, columns: ['joint'] }], 2,
      [{ route: ['A', 'hidden'], ordinal: 0, rowCount: 500 }])).toHaveLength(1)
  })
})
