import { sql, type SQL, type SQLWrapper } from 'drizzle-orm'

// This is an index eligibility condition, never an input limit. Very long
// legacy names keep their existing query path and cannot fail a future write
// because of an oversized B-tree key or numeric conversion in the index.
export function indexedJointName(joint: SQLWrapper, line: SQLWrapper): SQL {
  return sql`octet_length(coalesce(${joint}, '')) <= 256 and octet_length(coalesce(${line}, '')) <= 256`
}

/** Shared by the read query and its indexes. Keep blank placement, numeric
 * precision and both numeric segments identical in either direction. */
export function naturalJointOrder(column: SQLWrapper, direction: 'asc' | 'desc'): [SQL, ...SQL[]] {
  const value = sql<string>`coalesce(${column}::text, '')`
  const prefix = sql<string>`lower(substring(${value} from '^[^0-9]*'))`
  const firstNumber = sql<number>`(substring(${value} from '[0-9]+'))::numeric`
  const tail = sql<string>`regexp_replace(${value}, '^[^0-9]*[0-9]+', '')`
  const tailPrefix = sql<string>`lower(substring(${tail} from '^[^0-9]*'))`
  const secondNumber = sql<number>`(substring(${tail} from '[0-9]+'))::numeric`
  const ordered = (expression: SQL, nullsFirst = false) => direction === 'desc'
    ? sql`(${expression}) desc nulls last`
    : nullsFirst ? sql`(${expression}) asc nulls first` : sql`(${expression}) asc nulls last`
  return [
    sql`(case when ${column} is null or btrim(${column}::text) = '' then 1 else 0 end) asc`,
    ordered(prefix), ordered(firstNumber, true), ordered(tailPrefix), ordered(secondNumber, true), ordered(sql`lower(${value})`),
  ]
}
