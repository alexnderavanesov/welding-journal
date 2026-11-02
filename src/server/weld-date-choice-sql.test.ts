import { describe, expect, it } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { weldJoints } from '@/db/schema'
import { DEFAULT_OTHER_SETTINGS } from '@/lib/other-settings'
import { buildWeldColumnValueFilter } from '@/lib/weld-column-choice-filter'
import { buildColumnChoiceWhere, buildColumnTextEqualsWhere, buildWhere } from './weld-server-shared'
import { buildReportQueryWhere } from './weld-read'

const dialect = new PgDialect()
const compile = (where: SQL) => {
  const { sql, params } = dialect.sqlToQuery(where)
  return { sql, params }
}
const columnWhere = (filter: string) => compile(buildWhere({ columnFilters: { weldDate: filter } })!)

describe('physical weld-date choice', () => {
  it('uses native dates in all three reports and retains every text choice for non-ISO sessions', () => {
    const values = ['2024-02-29', '0001-01-01', '0099-12-31', '9999-12-31', '']
    for (const report of ['weldingJournal', 'lnk', 'heatTreatment'] as const) {
      const result = compile(buildReportQueryWhere(report, {
        columnFilters: { weldDate: buildWeldColumnValueFilter(values) },
      }, { ...DEFAULT_OTHER_SETTINGS, wdiCalculationMode: 'manual' }))
      expect(result.sql).toContain('lower(trim(coalesce("weld_joints"."weld_date"::text, \'\'))) = any(array[')
      expect(result.sql).toContain('"weld_joints"."weld_date" = any(')
      expect(result.sql).toContain('"weld_joints"."weld_date" is not null and')
      expect(result.sql).toContain('::date[])')
      expect(result.sql).toContain('or "weld_joints"."weld_date" is null')
      expect(result.sql).toContain("case when split_part(current_setting('DateStyle'), ',', 1) = 'ISO' then true else")
      expect(result.params).toContainEqual(values.slice(0, -1))
      for (const value of values) expect(result.params).toContain(value)
    }
  })

  it('keeps null-only and legacy quoted exact semantics, including their original parameter text', () => {
    const empty = columnWhere(buildWeldColumnValueFilter(['']))
    expect(empty.sql).toContain('"weld_joints"."weld_date" is null')
    expect(empty.sql).toContain('lower(trim(coalesce("weld_joints"."weld_date"::text, \'\')))')
    expect(empty.sql).not.toContain('::date[]')
    expect(empty.params).toEqual([''])
    const legacy = columnWhere(" = ' 2026-10-03 ' ")
    expect(legacy.sql).toContain('= lower(trim($2))')
    expect(legacy.params).toEqual([['2026-10-03'], ' 2026-10-03 '])
    expect(columnWhere("= ''").params).toEqual([''])
    expect(columnWhere("= ''").sql).toContain('"weld_joints"."weld_date" is null')
  })

  it('falls back for the complete mixed choice when any value is invalid, noncanonical, BC or outside four-digit AD', () => {
    for (const invalid of ['1900-02-29', '2026-02-29', '2026-13-01', '2026-04-31', '2026-00-01', '2026-01-00',
      '0000-01-01', '10000-01-01', '0001-01-01 BC', 'infinity', '-infinity', '10/03/2026', '3.10.2026', 'not-a-date']) {
      const values = ['2026-10-03', '', invalid]
      expect(columnWhere(buildWeldColumnValueFilter(values))).toEqual(compile(buildColumnChoiceWhere(weldJoints.weldDate, values)))
      expect(columnWhere(`=${invalid}`)).toEqual(compile(buildColumnTextEqualsWhere(weldJoints.weldDate, invalid)))
    }
    // A leap century is valid; merely rejecting every century February 29
    // would lose the measured index path for an otherwise canonical value.
    expect(columnWhere(buildWeldColumnValueFilter(['2000-02-29'])).params).toContainEqual(['2000-02-29'])
  })

  it('preserves choice JS trimming versus legacy PostgreSQL trimming and leaves literal fragments/wildcards unchanged', () => {
    expect(columnWhere(buildWeldColumnValueFilter(['\u00a02026-10-03\ufeff'])).params).toEqual([['2026-10-03'], '2026-10-03'])
    const unicode = '\u00a02026-10-03\u00a0'
    expect(columnWhere(`='${unicode}'`)).toEqual(compile(buildColumnTextEqualsWhere(weldJoints.weldDate, unicode)))
    for (const fragment of ['2026-10', '%', '_', '\\', '__column_choice_filter__:broken']) {
      expect(columnWhere(fragment)).toEqual({
        sql: 'coalesce("weld_joints"."weld_date"::text, \'\') ilike $1', params: [`%${fragment}%`],
      })
    }
    expect(columnWhere('')).toEqual({ sql: 'true', params: [] })
    const emptyList = '__column_choice_filter__:' + encodeURIComponent(JSON.stringify({ kind: 'values', values: [] }))
    expect(columnWhere(emptyList)).toEqual({ sql: 'false', params: [] })
  })

  it('does not apply a physical weld-date restriction to a different stored date or a current-cycle PSTO date', () => {
    const filter = buildWeldColumnValueFilter(['2026-10-03'])
    expect(compile(buildWhere({ columnFilters: { pstoDate: filter } })!))
      .toEqual(compile(buildColumnChoiceWhere(weldJoints.pstoDate, ['2026-10-03'])))
    const currentCycle = compile(buildReportQueryWhere('heatTreatment', { columnFilters: { pstoDate: filter } }, DEFAULT_OTHER_SETTINGS))
    expect(currentCycle.sql).not.toContain('"weld_joints"."weld_date" = any(')
    expect(currentCycle.sql).not.toContain('::date[])')
  })
})
