import { expect, it } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { buildRkExposureSchemeSql } from './report-rk-filter-sql'

it('keeps the executable SQL bounded as an uploaded exposure table grows', () => {
  const compile = (count: number) => new PgDialect().sqlToQuery(buildRkExposureSchemeSql({
    fileName: 'fixture', uploadedAt: '', entries: Array.from({ length: count }, (_, index) => ({
      diameter: index + 1, options: [{ label: `Scheme ${index}`, values: ['0', '120'], isDefault: true, note: '' }],
    })),
  }))
  const small = compile(3), large = compile(1000)
  // Configuration is data; generating a separate branch per diameter caused
  // expensive PostgreSQL compilation for every cold query on a large table.
  expect(large.sql.length).toBeLessThanOrEqual(small.sql.length + 100)
  expect(large.params.length).toBe(small.params.length)
})
