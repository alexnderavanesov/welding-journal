import { inArray, sql, type SQLWrapper } from 'drizzle-orm'

export function buildNullableControlEnabledWhere(
  column: SQLWrapper,
  enabledValues: readonly string[],
) {
  return sql<boolean>`coalesce(${inArray(column, [...enabledValues])}, false)`
}
