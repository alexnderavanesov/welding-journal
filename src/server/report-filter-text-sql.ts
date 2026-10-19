import { or, sql, type SQLWrapper } from 'drizzle-orm'
import { parseWeldColumnChoiceFilter, normalizeWeldColumnChoiceValue } from '@/lib/weld-column-choice-filter'

// String.trim's whitespace set; btrim's default only removes ASCII spaces.
const JS_WHITESPACE = ' \t\n\r\v\f\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'
export const reportTextSql = (value: SQLWrapper) => sql<string>`btrim(coalesce(${value}::text, ''), ${JS_WHITESPACE})`
export const reportResultSql = (value: SQLWrapper) => sql<string>`regexp_replace(lower(${reportTextSql(value)}), ' · назначение отменено$', '')`

/** The former application matcher treats %, _ and backslashes literally.
 * Keep this separate from existing source-column ILIKE semantics. */
export function buildCalculatedFilterWhere(value: SQLWrapper, filter: string) {
  const normalized = sql`lower(${reportTextSql(value)})`
  const choice = parseWeldColumnChoiceFilter(filter)
  if (choice) {
    const values = [...new Set(choice.values.map(normalizeWeldColumnChoiceValue))]
    return or(...values.map(item => sql`${reportTextSql(value)} = ${item}`)) ?? sql`false`
  }
  const query = filter.trim().toLowerCase()
  if (query.startsWith('=')) return sql`${normalized} = ${query.slice(1).trim().replace(/^["']|["']$/g, '')}`
  return sql`position(${query} in ${normalized}) > 0`
}

export function cancelledLnkResultSql(value: SQLWrapper) {
  const result = reportResultSql(value)
  return sql<string>`case
    when ${result} in ('ремонт', 'вырез', 'не годен', 'негоден') then ${result} || ' · назначение отменено'
    when ${result} in ('годен', 'да', 'годен (отменен)') then 'годен · назначение отменено'
    else 'отменен' end`
}
