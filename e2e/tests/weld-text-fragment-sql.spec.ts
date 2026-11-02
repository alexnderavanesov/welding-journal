import { expect, test } from '@playwright/test'
import { and, sql, type SQL, type SQLWrapper } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { Client } from 'pg'
import { weldJoints } from '../../src/db/schema'
import { DEFAULT_OTHER_SETTINGS } from '../../src/lib/other-settings'
import { buildReportQueryWhere } from '../../src/server/weld-read'
import { buildColumnTextContainsWhere } from '../../src/server/weld-server-shared'
import type { WeldReportKind } from '../../src/server/weld-contracts'
import { withE2eDatabase } from '../database'

const dialect = new PgDialect()
const settings = { ...DEFAULT_OTHER_SETTINGS, wdiCalculationMode: 'manual' as const }
// Independent old SQL, including its NULL-to-empty and LIKE escape semantics.
const original = (column: SQLWrapper, query: string) => sql`coalesce(${column}::text, '') ilike ${`%${query}%`}`
const execute = (client: Client, query: SQL) => {
  const compiled = dialect.sqlToQuery(query)
  return client.query(compiled.sql, compiled.params)
}

test('text fragments preserve SQL truth values, NOT and nullable AND/OR, including wildcard fallback', async () => {
  await withE2eDatabase(async client => {
    const values = [null, '', ' ', 'AbC', '  abc  ', 'xAbCy', 'other', 'АбВ', "O'Reilly", 'LINE-0017',
      'a%b', 'a_b', 'a\\b', '😀', '\u00a0AbC\u00a0', '100%']
    for (const fragment of ['a', 'Ab', 'abc', 'Аб', 'аб', "O'Re", 'LINE-0', '😀', ' ', '', '%', '_', '\\', '\\%', '\\_', '\\\\']) {
      const before = original(weldJoints.projectTitle, fragment)
      const after = buildColumnTextContainsWhere(weldJoints.projectTitle, fragment)
      // A CTE supplies nullable text to the real PgText column expression;
      // this truth-table test does not mutate application tables or settings.
      const result = await execute(client, sql`
        with "weld_joints" as (
          select n::integer as id, value as project_title
          from unnest(${sql.param(values)}::text[]) with ordinality input(value,n)
        ), comparisons as (
          select ${weldJoints.id} as id, flags.flag, ${before} as old_value, ${after} as new_value
          from ${weldJoints} cross join (values(true),(false),(null::boolean)) flags(flag)
        ) select id, flag, old_value, new_value,
          old_value is not distinct from new_value as same,
          (not old_value) is not distinct from (not new_value) as same_not,
          (old_value and flag) is not distinct from (new_value and flag) as same_and,
          (old_value or flag) is not distinct from (new_value or flag) as same_or
        from comparisons order by id, flag nulls last
      `)
      expect(result.rows, fragment).toHaveLength(values.length * 3)
      for (const row of result.rows) expect(row, `${JSON.stringify(fragment)}/${row.id}/${row.flag}`)
        .toMatchObject({ same: true, same_not: true, same_and: true, same_or: true })
      const matched = result.rows.filter(row => row.flag === true && row.new_value).map(row => row.id)
      // Explicit expectations prevent both predicates from sharing a mistaken
      // empty-value or ASCII case assumption. Cyrillic follows the DB locale.
      if (['Ab', 'abc'].includes(fragment)) expect(matched).toEqual([4, 5, 6, 15])
      if (fragment === "O'Re") expect(matched).toEqual([9])
      if (fragment === ' ') expect(matched).toEqual([3, 5])
      if (fragment === '\\%') expect(matched).toEqual([11, 16])
      if (fragment === '\\_') expect(matched).toEqual([12])
      if (fragment === '\\\\') expect(matched).toEqual([13])
      if (fragment === '' || fragment === '%') expect(matched).toEqual(values.map((_, index) => index + 1))
      if (fragment === '_') expect(matched).toEqual(values.slice(2).map((_, index) => index + 3))
      if (fragment === 'Ab') expect(result.rows.filter(row => row.id <= 2).every(row => row.new_value === false)).toBe(true)
    }
  })
})

test('real report builders preserve fragment IDs and counts, combinations and each report membership', async () => {
  await withE2eDatabase(async client => {
    expect((await client.query('select current_database() as name')).rows[0].name).toBe('welding_tracker_e2e')
    await client.query('begin')
    try {
      // Only this transaction sees these 17 rows. ROLLBACK removes all facts;
      // the global E2E seed and report caches are never changed or cleared.
      const fixtures = [
        { project: null, line: 'LINE-0017' }, { project: '', line: 'LINE-0017' }, { project: '   ', line: 'LINE-0017' },
        { project: 'Alpha', line: 'LINE-0017' }, { project: 'alpha Annex', line: 'LINE-0018' }, { project: 'ALPHA', line: 'OTHER' },
        { project: 'Beta', line: 'LINE-0017' }, { project: 'Alpha', line: null }, { project: 'Alpha', line: '' },
        { project: 'Alpha', line: 'LINE-0017', welded: false },
        { project: 'Alpha', line: 'LINE-0017', lnk: false, psto: false },
        { project: "O'Reilly", line: 'LINE-0017' }, { project: 'Проект', line: 'LINE-0017' },
        { project: 'literal%_\\', line: 'LINE-0017' }, { project: 'Alpha', line: '  LINE-0017  ' },
        { project: 'Alpha', line: 'LINE-0017', psto: false }, { project: 'Alpha', line: 'LINE-0017', lnk: false },
      ].map((row, index) => ({ welded: true, lnk: true, psto: true, ...row, ordinal: index + 1 }))
      const inserted = await client.query(`insert into weld_joints(project_title,line,joint,weld_date,has_vik,psto_required)
        select project,line,'E2E-TEXT-FRAGMENT-'||ordinal,
          case when welded then date '2026-11-01' end,
          case when lnk then 'да' end,case when psto then 'да' end
        from jsonb_to_recordset($1::jsonb) as input(project text,line text,ordinal integer,welded boolean,lnk boolean,psto boolean)
        returning id,joint`, [JSON.stringify(fixtures)])
      const idsByOrdinal = new Map<number, number>(inserted.rows.map(row => [Number(String(row.joint).replace('E2E-TEXT-FRAGMENT-', '')), Number(row.id)]))
      expect(idsByOrdinal.size).toBe(fixtures.length)
      const scope = sql`${weldJoints.id} = any(${sql.param([...idsByOrdinal.values()])}::integer[])`
      const cases: Array<{ name: string; filters: Record<string, string>; ordinals: number[] }> = [
        { name: 'project case and outer whitespace', filters: { projectTitle: ' AlPhA ' }, ordinals: [4, 5, 6, 8, 9, 10, 11, 15, 16, 17] },
        { name: 'project AND line', filters: { projectTitle: ' AlPhA ', line: 'LINE-0017' }, ordinals: [4, 10, 11, 15, 16, 17] },
        { name: 'line with nullable project', filters: { line: 'LINE-0017' }, ordinals: [1, 2, 3, 4, 7, 10, 11, 12, 13, 14, 15, 16, 17] },
        { name: 'quote remains bound literal', filters: { projectTitle: " O'Re " }, ordinals: [12] },
        { name: 'Cyrillic literal', filters: { projectTitle: 'Про' }, ordinals: [13] },
        { name: 'percent still includes NULL', filters: { projectTitle: '%' }, ordinals: fixtures.map(row => row.ordinal) },
        { name: 'ignored whitespace', filters: { projectTitle: ' \t' }, ordinals: fixtures.map(row => row.ordinal) },
        { name: 'no match', filters: { projectTitle: 'no-such-project' }, ordinals: [] },
      ]
      for (const report of ['weldingJournal', 'lnk', 'heatTreatment'] as WeldReportKind[]) {
        // Independent report membership: row 10 is unwelded, row 11 has
        // neither stage, and rows 16/17 belong to only one specialty report.
        const absent = report === 'weldingJournal' ? [] : report === 'lnk' ? [10, 11, 17] : [10, 11, 16]
        for (const item of cases) {
          const expected = item.ordinals.filter(ordinal => !absent.includes(ordinal)).map(ordinal => idsByOrdinal.get(ordinal)!).sort((a, b) => a - b)
          const oldFilters = Object.entries(item.filters).flatMap(([key, value]) => value.trim()
            ? [original(key === 'projectTitle' ? weldJoints.projectTitle : weldJoints.line, value.trim())] : [])
          const before = and(buildReportQueryWhere(report, { columnFilters: {} }, settings), ...oldFilters)!
          const after = buildReportQueryWhere(report, { columnFilters: item.filters }, settings)
          for (const [variant, where] of [['original', before], ['production', after]] as const) {
            const rows = await execute(client, sql`select ${weldJoints.id} as id from ${weldJoints}
              where ${and(scope, where)} order by ${weldJoints.id}`)
            expect(rows.rows.map(row => row.id), `${report}/${item.name}/${variant} IDs`).toEqual(expected)
            const count = await execute(client, sql`select count(*)::integer as total from ${weldJoints} where ${and(scope, where)}`)
            expect(count.rows[0].total, `${report}/${item.name}/${variant} count`).toBe(expected.length)
          }
        }
      }
    } finally {
      await client.query('rollback')
    }
  })
})
