import { sql, type SQLWrapper } from 'drizzle-orm'

export function buildNormalizedControlAvailabilityWhere(
  column: SQLWrapper,
  values: readonly string[],
) {
  const normalizedValues = [...new Set(values.map((value) => value.trim().toLocaleLowerCase('ru-RU')))]
  if (normalizedValues.length === 0) return sql<boolean>`false`
  return sql<boolean>`lower(btrim(coalesce(${column}::text, ''))) in (${sql.join(
    normalizedValues.map((value) => sql`${value}`),
    sql`, `,
  )})`
}

export function buildNullableControlEnabledWhere(
  column: SQLWrapper,
  enabledValues: readonly string[],
) {
  return sql<boolean>`coalesce(${buildNormalizedControlAvailabilityWhere(column, enabledValues)}, false)`
}
