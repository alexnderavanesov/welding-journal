import { expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { buildWeldColumnValueFilter } from '@/lib/weld-column-choice-filter'
import { buildCalculatedFilterWhere } from './report-filter-text-sql'

it('does not duplicate a calculated value for every checked filter choice', () => {
  const value = sql`(select 'calculated-value'::text)`
  const compile = (choices: string[]) => new PgDialect().sqlToQuery(
    buildCalculatedFilterWhere(value, buildWeldColumnValueFilter(choices)),
  )
  const small = compile(['A']), large = compile(Array.from({ length: 200 }, (_, i) => `Option ${i}`))
  expect(large.sql.length).toBeLessThanOrEqual(small.sql.length + 100)
  expect(large.sql.match(/calculated-value/g)).toHaveLength(1)
})
