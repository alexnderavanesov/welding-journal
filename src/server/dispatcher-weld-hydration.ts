import { getTableColumns, sql } from 'drizzle-orm'
import { weldJoints } from '@/db/schema'
import { buildNumberArrayMatch } from './weld-request-utils'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'

type Row = typeof weldJoints.$inferSelect
const columns = Object.entries(getTableColumns(weldJoints))
const selection = sql.join(columns.map(([key, column]) => sql`${column} as ${sql.identifier(key)}`), sql`, `)

/** Flat, single-table hot path: keep every column and its schema decoder, but
 * avoid Drizzle's per-cell nested-join/path discovery for millions of cells.
 * execute uses the same transaction and raw driver type parsers as select.
 * No custom date/number interpretation and no projection maintained by hand.
 */
export async function readDispatcherWeldBatch(
  db: Pick<SystemDocumentSequenceTransaction, 'execute'>,
  ids: number[],
): Promise<Row[]> {
  if (ids.length === 0) return []
  const result = await db.execute<Record<string, unknown>>(sql`
    select ${selection} from ${weldJoints}
    where ${buildNumberArrayMatch(weldJoints.id, ids)}
  `)
  for (const row of result.rows) {
    for (const [key, column] of columns) {
      const raw = row[key]
      if (raw !== null) row[key] = column.mapFromDriverValue(raw)
    }
  }
  return result.rows as Row[]
}
