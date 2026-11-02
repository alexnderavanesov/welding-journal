import { describe, expect, it } from 'vitest'
import { sql, type SQL, type SQLWrapper } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { weldJoints } from '@/db/schema'
import { DEFAULT_OTHER_SETTINGS } from '@/lib/other-settings'
import { buildWeldColumnValueFilter } from '@/lib/weld-column-choice-filter'
import { buildReportQueryWhere } from './weld-read'
import { buildColumnChoiceWhere, buildColumnTextContainsWhere, buildColumnTextEqualsWhere, buildWhere } from './weld-server-shared'

const dialect = new PgDialect()
const compile = (value: SQL) => {
  const { sql, params } = dialect.sqlToQuery(value)
  return { sql, params }
}
// Frozen pre-change predicate: this oracle must not call the new helper.
const original = (column: SQLWrapper, query: string) => sql`coalesce(${column}::text, '') ilike ${`%${query}%`}`
const settings = { ...DEFAULT_OTHER_SETTINGS, wdiCalculationMode: 'manual' as const }

describe('physical text fragment predicate', () => {
  it('exposes the four common text columns without changing the literal parameter or nullable boolean contract', () => {
    for (const column of [weldJoints.projectTitle, weldJoints.subtitleCode, weldJoints.line, weldJoints.joint]) {
      for (const fragment of ['a', 'Ab', 'LINE-0', 'Проект', "O'Reilly", '😀', ' a ']) {
        const value = compile(buildColumnTextContainsWhere(column, fragment))
        expect(value.sql).toContain(`"weld_joints"."${column.name}" is not null`)
        expect(value.sql).toContain(`"weld_joints"."${column.name}"::text ilike $1`)
        expect(value.sql).not.toContain('coalesce(')
        expect(value.sql).not.toMatch(/\blower\(|\btrim\(|\bescape\b|\bcollate\b/i)
        expect(value.params).toEqual([`%${fragment}%`])
      }
    }
  })

  it('keeps the exact old predicate for empty input and every LIKE metacharacter, including escaped literals', () => {
    for (const fragment of ['', '%', '_', '\\', 'a%b', 'a_b', 'a\\b', '\\%', '\\_', '\\\\']) {
      expect(compile(buildColumnTextContainsWhere(weldJoints.projectTitle, fragment)))
        .toEqual(compile(original(weldJoints.projectTitle, fragment)))
    }
  })

  it('does not infer a physical text column from a numeric/date/boolean cast or a computed SQL value', () => {
    const columns: SQLWrapper[] = [weldJoints.wdi, weldJoints.weldDate, weldJoints.preHeatTreatmentLnkExempt,
      sql`${weldJoints.projectTitle}`, sql`case when ${weldJoints.line} is null then 'missing' else ${weldJoints.line} end`]
    for (const column of columns) expect(compile(buildColumnTextContainsWhere(column, '17')))
      .toEqual(compile(original(column, '17')))
  })

  it('uses the same safe path in the actual journal, LNK and PSTO source-filter loops', () => {
    for (const report of ['weldingJournal', 'lnk', 'heatTreatment'] as const) {
      const value = compile(buildReportQueryWhere(report, {
        columnFilters: { projectTitle: ' Project ', line: 'LINE-0' },
      }, settings))
      for (const column of ['project_title', 'line']) {
        expect(value.sql).toContain(`"weld_joints"."${column}" is not null`)
        expect(value.sql).not.toContain(`coalesce("weld_joints"."${column}"::text, '') ilike`)
      }
      expect(value.params).toContain('%Project%')
      expect(value.params).toContain('%LINE-0%')
      const wildcard = compile(buildReportQueryWhere(report, { columnFilters: { projectTitle: '%' } }, settings))
      expect(wildcard.sql).toContain(`coalesce("weld_joints"."project_title"::text, '') ilike`)
      expect(wildcard.params).toContain('%%%')
    }
  })

  it('leaves exact choices and ignored whitespace in their existing branches', () => {
    expect(compile(buildWhere({ columnFilters: { projectTitle: buildWeldColumnValueFilter(['Alpha', '']) } })!))
      .toEqual(compile(buildColumnChoiceWhere(weldJoints.projectTitle, ['Alpha', ''])))
    expect(compile(buildWhere({ columnFilters: { projectTitle: "= ' Alpha '" } })!))
      .toEqual(compile(buildColumnTextEqualsWhere(weldJoints.projectTitle, ' Alpha ')))
    expect(compile(buildWhere({ columnFilters: { projectTitle: ' \t\n' } })!)).toEqual({ sql: 'true', params: [] })
  })
})
