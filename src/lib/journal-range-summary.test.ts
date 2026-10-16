import { describe, expect, it, vi } from 'vitest'
import { journalRangeSummaryChunks, mergeJournalRangeSpans, type JournalRangeSpan } from './journal-range-summary'

describe('journal range totals', () => {
  it('merges reversed/overlapping selections without retaining a key per selected cell', () => {
    expect(mergeJournalRangeSpans([
      { fieldKey: 'd1', first: 5, last: 10 }, { fieldKey: 'd1', first: 0, last: 7 },
      { fieldKey: 'joint', first: 0, last: 4 }, { fieldKey: 'd1', first: 11, last: 12 },
      { fieldKey: 'd1', first: 15, last: 16 }, { fieldKey: 'd1', first: 8, last: 7 },
    ])).toEqual([
      { fieldKey: 'd1', first: 0, last: 12 }, { fieldKey: 'd1', first: 15, last: 16 },
      { fieldKey: 'joint', first: 0, last: 4 },
    ])
  })
  it('counts overlapping cells once and only sums numeric fields, preserving zero and blanks', () => {
    const spans: JournalRangeSpan[] = [
      { fieldKey: 'd1', first: 0, last: 3 }, { fieldKey: 'd1', first: 1, last: 3 },
      { fieldKey: 'joint', first: 0, last: 0 }, { fieldKey: 't1', first: 0, last: 0 },
    ]
    const read = vi.fn((index: number, field: string) => field === 'd1' ? ['215.000', '0', '', null][index] : field === 'joint' ? '00123' : '1,5')
    expect(journalRangeSummaryChunks(spans, read).next()).toEqual({ done: true, value: { count: 4, numericCount: 3, sum: 216.5, average: 216.5 / 3 } })
    expect(read).toHaveBeenCalledTimes(6)
  })
  it('bounds each chunk and reads 200000 rows exactly once even when ranges overlap', () => {
    let reads = 0, previous = 0, chunks = 0
    const calculation = journalRangeSummaryChunks([
      { fieldKey: 'd1', first: 0, last: 199999 }, { fieldKey: 'd1', first: 100, last: 199999 },
    ], () => { reads++; return 2 })
    let result = calculation.next()
    while (!result.done) {
      expect(reads - previous).toBeLessThanOrEqual(512)
      previous = reads; chunks++; result = calculation.next()
    }
    expect(chunks).toBeGreaterThan(300)
    expect(reads).toBe(200000)
    expect(result.value).toEqual({ count: 200000, numericCount: 200000, sum: 400000, average: 2 })
  })
  it('does not read the rest of a large range after cancellation', () => {
    let reads = 0
    const calculation = journalRangeSummaryChunks([{ fieldKey: 'd1', first: 0, last: 199999 }], () => ++reads)
    calculation.next()
    expect(reads).toBe(512)
    calculation.return({ count: 0, numericCount: 0, sum: 0, average: null })
    calculation.next()
    expect(reads).toBe(512)
  })
})
