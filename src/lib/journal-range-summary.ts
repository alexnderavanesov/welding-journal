import { FIELD_BY_KEY, type WeldFieldKey } from './weld-fields'
import { journalNumericValue, type JournalRangeSummary } from './welding-journal-grid-state'

export const EMPTY_JOURNAL_RANGE_SUMMARY: JournalRangeSummary = { count: 0, numericCount: 0, sum: 0, average: null }
export type JournalRangeSpan<Field extends string = WeldFieldKey> = { fieldKey: Field; first: number; last: number }

// Merge overlapping row intervals per column. Memory depends on the number of
// ranges/columns, not a Set containing every selected cell (millions for Ctrl+A).
export function mergeJournalRangeSpans<Field extends string>(spans: JournalRangeSpan<Field>[]): JournalRangeSpan<Field>[] {
  const columns = new Map<Field, JournalRangeSpan<Field>[]>()
  for (const span of spans) {
    if (span.last < span.first) continue
    const values = columns.get(span.fieldKey) ?? []
    values.push({ ...span })
    columns.set(span.fieldKey, values)
  }
  const merged: JournalRangeSpan<Field>[] = []
  for (const spans of columns.values()) {
    spans.sort((a, b) => a.first - b.first)
    let current = spans[0]
    for (const span of spans.slice(1)) {
      if (span.first <= current.last + 1) current.last = Math.max(current.last, span.last)
      else { merged.push(current); current = span }
    }
    merged.push(current)
  }
  return merged
}

// A bounded chunk can be cancelled between tasks when the range, data or group
// order changes. Consumers only publish the final total, never a stale partial sum.
export function* journalRangeSummaryChunks<Field extends string>(
  spans: JournalRangeSpan<Field>[],
  valueAt: (rowIndex: number, fieldKey: Field) => unknown,
  isNumericField: (fieldKey: Field) => boolean = key => FIELD_BY_KEY.get(key as WeldFieldKey)?.kind === 'number',
): Generator<void, JournalRangeSummary> {
  let count = 0, numericCount = 0, sum = 0, processed = 0
  for (const span of mergeJournalRangeSpans(spans)) {
    const numeric = isNumericField(span.fieldKey)
    for (let index = span.first; index <= span.last; index++) {
      const value = valueAt(index, span.fieldKey)
      if (value != null && String(value).trim() !== '') {
        count++
        const number = numeric || typeof value === 'number' ? journalNumericValue(value) : null
        if (number !== null) { numericCount++; sum += number }
      }
      if (++processed % 512 === 0) yield
    }
  }
  return { count, numericCount, sum, average: numericCount ? sum / numericCount : null }
}
