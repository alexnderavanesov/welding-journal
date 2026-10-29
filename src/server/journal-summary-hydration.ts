import { Column, SQL, sql } from 'drizzle-orm'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'

/** This narrow, known left-join shape needs only one nullability check per
 * joined row. Keep schema decoders, while avoiding generic nested path/join
 * discovery for each cell of a large group. No facts are cached here.
 */
export async function readJournalSummaryProjection<T>(
  db: Pick<SystemDocumentSequenceTransaction, 'execute'>,
  projection: Record<string, Record<string, Column | SQL>>,
  source: SQL,
): Promise<T[]> {
  const groups = Object.entries(projection).map(([name, fields]) => ({ name,
    fields: Object.entries(fields).map(([key, column]) => ({ key, column, alias: `${name}_${key}`,
      decode: column instanceof Column && column.mapFromDriverValue !== Column.prototype.mapFromDriverValue
        ? (value: unknown) => column.mapFromDriverValue(value) : undefined })),
  }))
  const selected = sql.join(groups.flatMap(group => group.fields.map(field => sql`${field.column} as ${sql.identifier(field.alias)}`)), sql`, `)
  const result = await db.execute<Record<string, unknown>>(sql`select ${selected} ${source}`)
  return result.rows.map(raw => {
    const row: Record<string, unknown> = {}
    for (const group of groups) {
      const values: Record<string, unknown> = {}
      let present = false
      for (const field of group.fields) {
        const value = raw[field.alias]
        if (value !== null) present = true
        values[field.key] = value !== null && field.decode ? field.decode(value) : value
      }
      row[group.name] = present ? values : null
    }
    return row as T
  })
}
