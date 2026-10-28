import type { WeldRow } from './dispatcher-types'
import type { WeldFieldKey } from './weld-fields'
import type { WeldGroupSummary } from './weld-group-summary'
import type { WeldReportKind, WeldSort } from '@/server/weld-contracts'

export function journalReport(report?: WeldReportKind): WeldReportKind {
  if (report === undefined) return 'weldingJournal'
  if (report === 'weldingJournal' || report === 'lnk' || report === 'heatTreatment') return report
  throw new Error('Неизвестный вид отчёта.')
}

// Ordinary reads use the fact revision; task-dependent reads also pin the
// active/background dispatcher publication without changing stored data.
export type JournalRevision = number | string
export const isJournalRevision = (value: unknown): value is JournalRevision =>
  typeof value === 'number' ? Number.isSafeInteger(value) && value >= 0
    : typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)

export type JournalGridQuery = {
  report?: WeldReportKind
  columnFilters: Record<string, string>
  sort?: WeldSort | null
  groupBy: WeldFieldKey[]
}
export type JournalGridRequest = JournalGridQuery & {
  route: string[]
  start: number
  end: number
  revision?: JournalRevision
}
export type JournalGroup = {
  key: string
  route: string[]
  ordinal: number
  childCount: number
  recordCount: number
  summary: Omit<WeldGroupSummary, 'rows'>
}
export type JournalGridRow = WeldRow & { journalGroup?: JournalGroup }
export type JournalGridResult = { rows: JournalGridRow[]; rowCount: number; revision: JournalRevision }
export type JournalRouteLayout = { route: string[]; ordinal: number; rowCount: number }
export type JournalRangePart<Field extends string = WeldFieldKey> = { route: string[]; start: number; end: number; columns: Field[] }
export type JournalVisualRange<Field extends string = WeldFieldKey> = { first: number; last: number; columns: Field[] }
export type JournalRangeRequest = JournalGridQuery & { revision: JournalRevision; parts: JournalRangePart[]; anchor: string }
export function journalGroup(row: unknown): JournalGroup | undefined {
  return (row as JournalGridRow | undefined)?.journalGroup
}
export const journalRouteKey = (route: readonly string[]) => JSON.stringify(route)

/** Map visual row intervals to server stores, including only expanded children.
 * No visit to unloaded row nodes, and no array sized to the database. */
export function journalRangeParts<Field extends string>(
  ranges: JournalVisualRange<Field>[],
  rootCount: number,
  expanded: JournalRouteLayout[],
): JournalRangePart<Field>[] {
  const children = new Map<string, JournalRouteLayout[]>()
  for (const item of expanded) {
    if (!item.route.length) continue
    const key = journalRouteKey(item.route.slice(0, -1))
    const list = children.get(key) ?? []; list.push(item); children.set(key, list)
  }
  for (const list of children.values()) list.sort((a, b) => a.ordinal - b.ordinal)
  const segments: { route: string[]; start: number; length: number; visual: number }[] = []
  let visual = 0
  const visit = (route: string[], count: number) => {
    let start = 0
    for (const child of children.get(journalRouteKey(route)) ?? []) {
      if (child.ordinal < start || child.ordinal >= count || child.rowCount < 0) throw new Error('Дождитесь загрузки раскрытых групп.')
      const length = child.ordinal - start + 1
      segments.push({ route, start, length, visual }); visual += length
      visit(child.route, child.rowCount); start = child.ordinal + 1
    }
    if (start < count) { segments.push({ route, start, length: count - start, visual }); visual += count - start }
  }
  visit([], rootCount)
  if (ranges.some(range => range.first < 0 || range.last >= visual)) {
    throw new Error('Дождитесь загрузки раскрытых групп.')
  }
  const parts: JournalRangePart<Field>[] = []
  for (const range of ranges) {
    for (const segment of segments) {
      const first = Math.max(range.first, segment.visual)
      const last = Math.min(range.last, segment.visual + segment.length - 1)
      if (last < first) continue
      parts.push({ route: segment.route, start: segment.start + first - segment.visual,
        end: segment.start + last - segment.visual + 1, columns: range.columns })
    }
  }
  return parts
}
