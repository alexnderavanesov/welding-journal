import { sql } from 'drizzle-orm'
import { requireDb } from '@/db'
import { weldJoints } from '@/db/schema'
import { requirePermission } from './access-context'
import { assertSecurityScope } from './security-functions'
import { writeJournalCells } from './journal-cell-write'
import { JOURNAL_INLINE_FIELDS, validateJournalClipboard, type JournalCellEdit } from '@/lib/journal-inline-edit'
import { WORKFLOW_SELECTION_LIMIT } from '@/lib/workflow-selection-limit'
import { isJournalRevision, type JournalRangeRequest } from '@/lib/journal-server-grid'
import { journalReadContext, journalRouteWhere, assertJournalContextRevision } from './journal-grid'
import { getReportOrderBy } from './weld-read'
import { assertReadableQuery } from './access-payload'

export async function saveJournalCellEdits(input: { edits: JournalCellEdit[] }) {
  await requirePermission('welding.edit')
  await assertSecurityScope('edit')
  return writeJournalCells(input?.edits)
}

export async function pasteJournalCells(input: { range: JournalRangeRequest; values: string[][] }) {
  const identity = await requirePermission('welding.edit')
  await assertSecurityScope('edit')
  validateJournalClipboard(input?.values)
  const range = input?.range, part = range?.parts?.[0]
  if (!range || range.report !== 'weldingJournal' || !isJournalRevision(range.revision) || !Array.isArray(range.parts) || range.parts.length !== 1 ||
    !Array.isArray(range.groupBy) || !part || !Array.isArray(part.route) || part.route.length !== range.groupBy.length || part.route.some(key => typeof key !== 'string') ||
    !Number.isSafeInteger(part.start) || !Number.isSafeInteger(part.end) || part.start < 0 || part.end <= part.start || part.end - part.start > WORKFLOW_SELECTION_LIMIT ||
    !Array.isArray(part.columns) || !part.columns.length || new Set(part.columns).size !== part.columns.length || part.columns.some(field => !JOURNAL_INLINE_FIELDS.has(field))) {
    throw new Error('Выделите один диапазон редактируемых ячеек стыков без заголовков групп. Ничего не сохранено.')
  }
  const fill = input.values.length === 1 && input.values[0].length === 1
  if (!fill && (input.values.length !== part.end - part.start || input.values[0].length !== part.columns.length)) {
    throw new Error('Размер вставляемых данных не совпадает с выделенным диапазоном. Ничего не сохранено.')
  }
  // Selecting a write range must obey the same field visibility as reading it.
  // This edit RPC does not pass through the read-query middleware policy.
  assertReadableQuery(identity, range)
  const context = await journalReadContext({ ...range, route: part.route, start: 0, end: 100 })
  const rows = await requireDb().select({ id: weldJoints.id, version: sql<string>`${weldJoints}.xmin::text` }).from(weldJoints)
    .where(journalRouteWhere(context, part.route))
    .orderBy(...getReportOrderBy('weldingJournal', context.request.sort ?? undefined, context.settings))
    .limit(part.end - part.start).offset(part.start)
  if (rows.length !== part.end - part.start) throw new Error('Состав диапазона изменился. Обновите журнал; ничего не сохранено.')
  await assertJournalContextRevision(context)
  const edits = rows.map((row, index) => ({ ...row, values: Object.fromEntries(part.columns.map((field, column) =>
    [field, fill ? input.values[0][0] : input.values[index][column]])) }))
  return writeJournalCells(edits)
}
