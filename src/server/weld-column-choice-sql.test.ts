import { expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { buildColumnChoiceWhere } from './weld-server-shared'

it('normalizes the source column once for a large checkbox selection', () => {
  const choices = Array.from({ length: 1001 }, (_, index) => `Стык-${index}`)
  const query = new PgDialect().sqlToQuery(buildColumnChoiceWhere(sql`source_value`, choices))
  expect(query.sql.match(/source_value/g)).toHaveLength(1)
  expect(query.params).toEqual(choices)
  // Retain PostgreSQL's lower/trim semantics for each choice; JavaScript
  // lowercasing is not a substitute for the database's active locale.
  expect(query.sql.match(/lower\(trim\(/g)).toHaveLength(choices.length + 1)
})

it('keeps empty selection false and deduplicates trimmed choices without dropping the empty value', () => {
  const dialect = new PgDialect()
  expect(dialect.sqlToQuery(buildColumnChoiceWhere(sql`source_value`, [])).sql).toBe('false')
  expect(dialect.sqlToQuery(buildColumnChoiceWhere(sql`source_value`, [' A ', 'A', '', ' '])).params).toEqual(['A', ''])
})
