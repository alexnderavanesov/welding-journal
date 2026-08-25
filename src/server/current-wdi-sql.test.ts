import { sql } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_OTHER_SETTINGS,
  DEFAULT_WDI_CALCULATION_RULES,
  type OtherSettings,
} from '@/lib/other-settings'
import { buildCurrentWdiSqlExpression } from '@/server/current-wdi-sql'

const columns = {
  connectionType: sql.raw('"source"."connection_type"'),
  d1: sql.raw('"source"."d1"'),
  d2: sql.raw('"source"."d2"'),
  t1: sql.raw('"source"."t1"'),
  t2: sql.raw('"source"."t2"'),
  wdi: sql.raw('"source"."wdi"'),
}

describe('current WDI SQL expression', () => {
  it('uses the stored value only in manual mode', () => {
    const compiled = compile(DEFAULT_OTHER_SETTINGS)

    expect(compiled.sql.trim()).toBe('select "source"."wdi" as "value"')
    expect(compiled.params).toEqual([])
  })

  it('uses current branch and regular diameter rules in formula mode', () => {
    const compiled = compile({
      ...DEFAULT_OTHER_SETTINGS,
      wdiCalculationMode: 'formula',
      wdiCalculationRules: DEFAULT_WDI_CALCULATION_RULES,
    })

    expect(compiled.sql).toContain("like 'У%'")
    expect(compiled.sql).toContain('least(')
    expect(compiled.sql).toContain('greatest(')
    expect(compiled.sql).toContain('/ 25.4')
    expect(compiled.sql).not.toContain('"source"."wdi"')
  })

  it('looks up the current table cell by diameter and thickness boundaries', () => {
    const compiled = compile({
      ...DEFAULT_OTHER_SETTINGS,
      wdiCalculationMode: 'table',
      wdiTable: {
        fileName: 'WDI.xlsx',
        uploadedAt: '2026-08-25T00:00:00.000Z',
        diameters: [25, 50],
        thicknesses: [2, 4],
        values: [[1, 2], [3, null]],
      },
    })

    expect(compiled.sql).toContain('with ordinality')
    expect(compiled.sql).toContain('"diameter_boundary"."position" desc')
    expect(compiled.sql).toContain('"thickness_boundary"."position" desc')
    expect(compiled.params).toEqual(expect.arrayContaining([25, 50, 2, 4, 1, 3]))
    expect(compiled.sql).not.toContain('"source"."wdi"')
  })
})

function compile(settings: OtherSettings) {
  return new PgDialect().sqlToQuery(sql`
    select ${buildCurrentWdiSqlExpression(settings, columns)} as "value"
  `)
}
