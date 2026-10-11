import { createHash } from 'node:crypto'
import { getTableColumns, sql } from 'drizzle-orm'
import { weldJoints } from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'
import { buildNumberArrayMatch } from './weld-request-utils'

const columns = Object.entries(getTableColumns(weldJoints))
// Match the existing JS key sort exactly, independent of locale/collation.
columns.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)

export function decodeRebuildWeldFact(facts: Record<string, unknown>) {
  const populated: Array<[string, unknown]> = [], revision: Array<[string, unknown]> = []
  for (const [key, column] of columns) {
    const raw = facts[column.name]
    // Use the schema's own decoder: date-only strings, timestamps, numeric
    // precision, booleans, zero and empty strings retain ordinary SELECT meaning.
    const value = raw == null ? null : column.mapFromDriverValue(raw)
    if (key !== 'dispatcherTasks') revision.push([key, value])
    if (value != null) populated.push([key, value])
  }
  return { row: Object.fromEntries(populated) as WeldRow,
    revision: createHash('sha256').update(JSON.stringify(Object.fromEntries(revision))).digest('base64url') }
}

/** Same bounded IDs and every fact, without 147 driver slots and a second wide
 * mapped object per mostly-empty weld. Nulls still participate in freshness. */
export async function loadRebuildWeldFacts(tx: SystemDocumentSequenceTransaction, ids: number[]) {
  if (!ids.length) return []
  if (ids.length > 5000) throw new Error('Слишком большой пакет фактов пересборки.')
  const records = await tx.select({ facts: sql<Record<string, unknown>>`jsonb_strip_nulls(to_jsonb(${weldJoints}))` })
    .from(weldJoints).where(buildNumberArrayMatch(weldJoints.id, ids))
  // A query without ORDER BY can change physical order after another packet or
  // a different query plan. Freshness hashes must reflect facts, not that order.
  return records.map(({ facts }) => decodeRebuildWeldFact(facts)).sort((a, b) => a.row.id - b.row.id)
}
