import type { JournalVisualRange } from './journal-server-grid'
import type { WeldFieldKey } from './weld-fields'

/** Match AG clipboard semantics: merge ranges only when every selected row has
 * the same selected columns; otherwise export each range with its own header.
 * Work on interval boundaries, never enumerate the potentially 200000 rows. */
export function journalCopyRanges(ranges: JournalVisualRange[], columnOrder: WeldFieldKey[]): JournalVisualRange[] {
  const events = new Map<number, Map<WeldFieldKey, number>>()
  for (const range of ranges) for (const [point, delta] of [[range.first, 1], [range.last + 1, -1]]) {
    const changes = events.get(point) ?? new Map<WeldFieldKey, number>()
    for (const column of new Set(range.columns)) changes.set(column, (changes.get(column) ?? 0) + delta)
    events.set(point, changes)
  }
  const active = new Map<WeldFieldKey, number>()
  let signature: string | undefined
  const points = [...events.keys()].sort((a, b) => a - b)
  for (const point of points) {
    for (const [column, delta] of events.get(point)!) {
      const count = (active.get(column) ?? 0) + delta
      if (count) active.set(column, count); else active.delete(column)
    }
    if (!active.size) continue
    const next = [...active.keys()].sort().join(',')
    if (signature !== undefined && signature !== next) return ranges.map(range => ({ ...range, includeHeader: true }))
    signature = next
  }
  const selected = new Set(ranges.flatMap(range => range.columns))
  const columns = columnOrder.filter(column => selected.has(column))
  // Preserve AG's first-encounter row order, including a later range above the
  // first one. Removing covered intervals prevents duplicate cells at overlaps.
  let covered: { first: number; last: number }[] = []
  const result: JournalVisualRange[] = []
  for (const range of ranges) {
    let first = range.first
    for (const interval of covered) {
      if (interval.last < first) continue
      if (interval.first > range.last) break
      if (interval.first > first) result.push({ first, last: interval.first - 1, columns })
      first = Math.max(first, interval.last + 1)
    }
    if (first <= range.last) result.push({ first, last: range.last, columns })
    const merged: typeof covered = []
    for (const interval of [...covered, { first: range.first, last: range.last }].sort((a, b) => a.first - b.first)) {
      const previous = merged.at(-1)
      if (previous && interval.first <= previous.last + 1) previous.last = Math.max(previous.last, interval.last)
      else merged.push({ ...interval })
    }
    covered = merged
  }
  if (result.length) result[0].includeHeader = true
  return result
}
