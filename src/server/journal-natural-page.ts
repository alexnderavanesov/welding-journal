import { sql, type SQL } from 'drizzle-orm'
import { indexedJointName } from '@/db/journal-order'
import { weldJoints } from '@/db/schema'

/** Merge the first N candidates from disjoint ordinary/long-name sets. The
 * global first N must belong to this union; the caller applies the original
 * complete ordering and OFFSET. Long names remain visible and writable.
 * Only IDs are materialized before the final page's card/metadata hydration. */
export function journalNaturalPageIds(where: SQL, order: SQL[], end: number): SQL {
  const eligible = indexedJointName(weldJoints.joint, weldJoints.line)
  const ordering = sql.join(order, sql`, `)
  return sql`(
    (select ${weldJoints.id} from ${weldJoints} where (${where}) and (${eligible}) order by ${ordering} limit ${end})
    union all
    (select ${weldJoints.id} from ${weldJoints} where (${where}) and not (${eligible}) order by ${ordering} limit ${end})
  )`
}

/** Sort only the columns needed for ordering before reading the wide cards.
 * LIMIT bounds the candidate set, never the available report. The outer query
 * repeats the complete order and applies the original page offset. */
export function journalOrderedPageIds(where: SQL, order: SQL[], end: number): SQL {
  return sql`(select ${weldJoints.id} from ${weldJoints} where ${where}
    order by ${sql.join(order, sql`, `)} limit ${end})`
}
