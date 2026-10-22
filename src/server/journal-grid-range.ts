import { isJournalRevision } from '@/lib/journal-server-grid'
import { isJournalScalarField } from './journal-display-sql'
import { reportTextSql } from './report-filter-text-sql'
import { and, sql } from 'drizzle-orm'
import { requireDb } from '@/db'
import { weldJoints } from '@/db/schema'
import { FIELD_BY_KEY, type WeldFieldKey } from '@/lib/weld-fields'
import { journalClipboardValue, journalNumericValue } from '@/lib/welding-journal-grid-state'
import { journalGroup, type JournalGridRow, type JournalRangePart, type JournalRangeRequest } from '@/lib/journal-server-grid'
import { getWeldingJournalDisplayValue } from '@/lib/lnk-status'
import { mergeJournalRangeSpans } from '@/lib/journal-range-summary'
import { getReportOrderBy } from './weld-read'
import { assertJournalContextRevision, journalReadContext, journalRouteWhere, journalValueSql, readJournalLeafRows, readJournalPage, type JournalReadContext } from './journal-grid'
import { buildNumberArrayMatch } from './weld-request-utils'

function validate(input: JournalRangeRequest) {
  if (!input || !isJournalRevision(input.revision) || !Array.isArray(input.parts) || !Array.isArray(input.groupBy)
    || input.parts.some(part => !Array.isArray(part.route) || part.route.length > input.groupBy.length
      || part.route.some(key => typeof key !== 'string') || !Number.isSafeInteger(part.start) || !Number.isSafeInteger(part.end)
      || part.start < 0 || part.end <= part.start || !Array.isArray(part.columns) || part.columns.length === 0
      || part.columns.some(key => !FIELD_BY_KEY.has(key))
      || part.includeHeader !== undefined && typeof part.includeHeader !== 'boolean') || typeof input.anchor !== 'string') throw new Error('Некорректный диапазон ячеек.')
}
export function mergeJournalRangeParts(parts: JournalRangePart[]): JournalRangePart[] {
  const routes = new Map<string, JournalRangePart[]>()
  for (const part of parts) { const key = JSON.stringify(part.route); const list = routes.get(key) ?? []; list.push(part); routes.set(key, list) }
  const result: JournalRangePart[] = []
  for (const [route, list] of routes) {
    const spans = mergeJournalRangeSpans(list.flatMap(part => part.columns.map(fieldKey => ({ fieldKey, first: part.start, last: part.end - 1 }))))
    const rectangles = new Map<string, JournalRangePart>()
    for (const span of spans) {
      const key = `${span.first}:${span.last}`
      const rectangle: JournalRangePart = rectangles.get(key) ?? { route: JSON.parse(route), start: span.first, end: span.last + 1, columns: [] }
      rectangle.columns.push(span.fieldKey); rectangles.set(key, rectangle)
    }
    result.push(...rectangles.values())
  }
  return result
}
export function journalRangeValue(row: JournalGridRow, key: WeldFieldKey, anchor: string, groupBy: WeldFieldKey[] = []): unknown {
  const group = journalGroup(row)
  if (!group) return getWeldingJournalDisplayValue(row, key)
  if (key === anchor) return FIELD_BY_KEY.get(groupBy[group.route.length - 1])?.kind === 'number' ? journalNumericValue(group.key) ?? group.key : group.key || '(Пусто)'
  const values: Partial<Record<WeldFieldKey, unknown>> = { line: group.summary.lines, joint: group.summary.joints,
    wdi: group.summary.wdi, weldDate: group.summary.weldDate, projectTitle: group.summary.projectTitle,
    subtitleCode: group.summary.subtitleCode, finalStatus: group.summary.status }
  return values[key]
}
async function* pages(context: JournalReadContext, part: JournalRangePart, signal?: AbortSignal) {
  if (part.route.length === context.request.groupBy.length) {
    const where = journalRouteWhere(context, part.route)
    // Determine order once. Repeating ORDER BY + OFFSET for every chunk would
    // rescan the whole selection hundreds of times during a large copy.
    const keys = await requireDb().select({ id: weldJoints.id }).from(weldJoints).where(where)
      .orderBy(...getReportOrderBy('weldingJournal', context.request.sort ?? undefined, context.settings))
      .limit(part.end - part.start).offset(part.start)
    if (keys.length !== part.end - part.start) throw new Error('Диапазон больше текущей выборки. Обновите журнал.')
    for (let start = 0; start < keys.length; start += 1000) {
      signal?.throwIfAborted()
      await assertJournalContextRevision(context)
      const ids = keys.slice(start, start + 1000).map(row => row.id)
      const rows = part.columns.every(isJournalScalarField)
        ? await requireDb().select(Object.fromEntries(part.columns.map(key => [key, sql`${journalValueSql(key, context)}`])))
          .from(weldJoints).where(and(where, buildNumberArrayMatch(weldJoints.id, ids)))
          .orderBy(sql`array_position(${sql.param(ids)}::int[], ${weldJoints.id})`)
        : await readJournalLeafRows({ ...context, where }, ids)
      if (rows.length !== ids.length) throw new Error('Данные журнала изменились. Обновите таблицу и повторите действие.')
      yield rows as JournalGridRow[]
    }
    return
  }
  for (let start = part.start; start < part.end; start += 1000) {
    signal?.throwIfAborted()
    await assertJournalContextRevision(context)
    const request = { ...context.request, route: part.route, start, end: Math.min(start + 1000, part.end) }
    const result = await readJournalPage({ ...context, request, where: journalRouteWhere(context, part.route) })
    if (request.end > result.rowCount) throw new Error('Диапазон больше текущей выборки. Обновите журнал.')
    yield result.rows
  }
}
export async function summarizeJournalGridRange(input: JournalRangeRequest, signal?: AbortSignal) {
  validate(input)
  signal?.throwIfAborted()
  const context = await journalReadContext({ ...input, route: [], start: 0, end: 100 })
  let count = 0, numericCount = 0, sum = 0
  for (const part of mergeJournalRangeParts(input.parts)) {
    signal?.throwIfAborted()
    if (part.route.length === input.groupBy.length && part.columns.length > 0 && part.columns.every(isJournalScalarField)) {
      // Large numeric selections are aggregated by PostgreSQL: only three numbers
      // cross the boundary, not 200000 cards or cells. One scan per disjoint rectangle.
      const columns = part.columns.map((key, index) => ({ key, alias: sql.identifier(`v${index}`) }))
      const values = columns.map(({ key, alias }) => sql`${journalValueSql(key, context)} as ${alias}`)
      const countValues = columns.map(({ alias }) => sql`count(nullif(${reportTextSql(alias)}, ''))`)
      const numeric = columns.filter(({ key }) => FIELD_BY_KEY.get(key)?.kind === 'number')
      const numericCounts = numeric.map(({ alias }) => sql`count(${alias})`)
      const sumValues = numeric.map(({ alias }) => sql`coalesce(sum(${alias}::double precision), 0)`)
      const result = await requireDb().execute<{ count: string; sum: number; rows: number; numericCount: number }>(sql`
        select count(*)::int as rows, (${sql.join(countValues, sql` + `)})::text as count, (${sumValues.length ? sql.join(sumValues, sql` + `) : sql`0`}) as sum,
          (${numericCounts.length ? sql.join(numericCounts, sql` + `) : sql`0`}) as "numericCount" from (
          select ${sql.join(values, sql`, `)} from ${weldJoints} where ${journalRouteWhere(context, part.route)}
          order by ${sql.join(getReportOrderBy('weldingJournal', input.sort ?? undefined, context.settings), sql`, `)}
          limit ${part.end - part.start} offset ${part.start}
        ) selected_cells`)
      const row = result.rows[0];
      if (Number(row?.rows) !== part.end - part.start) throw new Error('Диапазон больше текущей выборки. Обновите журнал.')
      count += Number(row?.count ?? 0); numericCount += Number(row?.numericCount ?? 0); sum += Number(row?.sum ?? 0)
    } else {
      for await (const rows of pages(context, part, signal)) for (const row of rows) for (const key of part.columns) {
        const value = journalRangeValue(row, key, input.anchor, input.groupBy)
        if (value == null || String(value).trim() === '') continue
        count++
        const numeric = FIELD_BY_KEY.get(key)?.kind === 'number' || typeof value === 'number' ? journalNumericValue(value) : null
        if (numeric !== null) { numericCount++; sum += numeric }
      }
    }
  }
  signal?.throwIfAborted()
  await assertJournalContextRevision(context)
  return { count, numericCount, sum, average: numericCount ? sum / numericCount : null }
}
const escapeCell = (value: string) => /[\t\r\n"]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
export async function copyJournalGridRange(input: JournalRangeRequest, signal?: AbortSignal) {
  validate(input)
  signal?.throwIfAborted()
  const context = await journalReadContext({ ...input, route: [], start: 0, end: 100 })
  const chunks: string[] = []
  for (const [index, part] of input.parts.entries()) {
    if (index === 0 || part.includeHeader) chunks.push(part.columns.map(key => escapeCell(FIELD_BY_KEY.get(key)!.label)).join('\t'))
    for await (const rows of pages(context, part, signal)) {
      chunks.push(rows.map(row => part.columns.map(key => {
        const value = journalRangeValue(row, key, input.anchor, input.groupBy)
        const group = journalGroup(row)
        const text = group ? typeof value === 'number' ? String(value).replace('.', ',') : String(value ?? '') : journalClipboardValue(row, key, value)
        return escapeCell(text)
      }).join('\t')).join('\r\n'))
    }
  }
  signal?.throwIfAborted()
  await assertJournalContextRevision(context)
  return chunks.join('\r\n')
}
