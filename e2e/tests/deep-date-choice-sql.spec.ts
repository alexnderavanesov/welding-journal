import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import pg, { type Client } from 'pg'
import { and, or, sql, type SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { weldJoints } from '../../src/db/schema'
import { DEFAULT_OTHER_SETTINGS } from '../../src/lib/other-settings'
import { buildWeldColumnValueFilter, parseWeldColumnChoiceFilter } from '../../src/lib/weld-column-choice-filter'
import { buildReportQueryWhere, getReportOrderBy } from '../../src/server/weld-read'
import { buildColumnChoiceWhere, buildColumnTextEqualsWhere } from '../../src/server/weld-server-shared'
import type { WeldReportKind } from '../../src/server/weld-contracts'
import { withE2eDatabase } from '../database'

// Compare the frozen text predicate with the real production builder. DateStyle
// changes and synthetic rows are transaction-local in the disposable database.
const enabled = process.env.DEEP_DATE_CHOICE_SQL === '1'
test.skip(!enabled, 'Opt-in production date-choice comparison with the frozen text predicate')
test.use({ trace: 'off', video: 'off' })
const totals = process.env.DEEP_DATE_CHOICE_ROWS ? [Number(process.env.DEEP_DATE_CHOICE_ROWS)] : [9000, 200000]
const dialect = new PgDialect()
const settings = { ...DEFAULT_OTHER_SETTINGS, wdiCalculationMode: 'manual' as const }
const reports: WeldReportKind[] = ['weldingJournal', 'lnk', 'heatTreatment']
const styles = ['ISO, MDY', 'ISO, DMY', 'SQL, MDY', 'SQL, DMY', 'German, DMY', 'Postgres, MDY', 'Postgres, DMY']
type Variant = 'original' | 'native-prefilter' | 'production'
type Shape = 'count' | 'page' | 'groups'
const rawDateTypes = { getTypeParser: ((oid: number, format?: 'text' | 'binary') => {
  if (format === 'binary') return pg.types.getTypeParser(oid, 'binary')
  return [1082, 1114, 1184].includes(oid) ? (value: string) => value : pg.types.getTypeParser(oid, 'text')
}) as typeof pg.types.getTypeParser }

// PostgreSQL accepts ISO dates in any DateStyle, but date::text follows the
// session output style. Retain the original predicate as a recheck; replacing
// it outright would silently broaden matches in non-ISO sessions.
// https://www.postgresql.org/docs/18/datatype-datetime.html
function candidatePrefilter(filter: string): SQL | undefined {
  const query = filter.trim(), choice = parseWeldColumnChoiceFilter(query)
  const values = choice?.kind === 'values' ? choice.values.map(value => String(value ?? '').trim())
    : query.startsWith('=') ? [query.slice(1).trim().replace(/^["']|["']$/g, '').replace(/^ +| +$/g, '')] : undefined
  if (!values?.length || !values.every(value => value === '' || canonicalDate(value))) return undefined
  const dates = [...new Set(values.filter(Boolean))]
  return or(dates.length ? sql`${weldJoints.weldDate} = any(${sql.param(dates)}::date[])` : undefined,
    values.includes('') ? sql`${weldJoints.weldDate} is null` : undefined)
}

function canonicalDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3])
  if (year < 1 || month < 1 || month > 12 || day < 1) return false
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
}

// Historical physical-date predicate, deliberately independent of a future
// date optimization in buildReportQueryWhere. Report membership and other
// filters still use their normal builder, with weldDate removed.
function originalDatePredicate(filter: string): SQL | undefined {
  const query = filter.trim()
  if (!query) return undefined
  const choice = parseWeldColumnChoiceFilter(query)
  if (choice?.kind === 'values') return buildColumnChoiceWhere(weldJoints.weldDate, choice.values)
  if (query.startsWith('=')) return buildColumnTextEqualsWhere(weldJoints.weldDate,
    query.slice(1).trim().replace(/^["']|["']$/g, ''))
  return sql`coalesce(${weldJoints.weldDate}::text, '') ilike ${`%${query}%`}`
}

function assertOriginalDateFingerprints() {
  const cases = [
    { filter: buildWeldColumnValueFilter(['2026-10-03']),
      sql: `lower(trim(coalesce("weld_joints"."weld_date"::text, ''))) = any(array[lower(trim($1))]::text[])`,
      params: ['2026-10-03'] },
    { filter: " = ' 2026-10-03 ' ",
      sql: `lower(trim(coalesce("weld_joints"."weld_date"::text, ''))) = lower(trim($1))`,
      params: [' 2026-10-03 '] },
    { filter: '2026-10', sql: `coalesce("weld_joints"."weld_date"::text, '') ilike $1`, params: ['%2026-10%'] },
  ]
  for (const item of cases) {
    const compiled = dialect.sqlToQuery(originalDatePredicate(item.filter)!)
    expect({ sql: compiled.sql, params: compiled.params }).toEqual({ sql: item.sql, params: item.params })
  }
  expect(originalDatePredicate('')).toBeUndefined()
  return cases
}

function whereFor(report: WeldReportKind, filter: string, variant: Variant, extra: Record<string, string> = {}) {
  if (variant === 'production') return buildReportQueryWhere(report, { columnFilters: { ...extra, weldDate: filter } }, settings)
  const { weldDate: _discarded, ...otherFilters } = extra
  const base = buildReportQueryWhere(report, { columnFilters: otherFilters }, settings)
  const date = originalDatePredicate(filter)
  // Keep the prior journal control SQL itself, rather than adding a redundant
  // TRUE AND wrapper. Nontrivial LNK/PSTO membership is always preserved.
  const original = date && dialect.sqlToQuery(base).sql === 'true' ? date : and(base, date)!
  return variant === 'original' ? original : and(original, candidatePrefilter(filter))!
}

function queryFor(report: WeldReportKind, filter: string, variant: Variant, shape: Shape, extra: Record<string, string> = {}) {
  const where = whereFor(report, filter, variant, extra)
  if (shape === 'count') return sql`select count(*)::integer as total from ${weldJoints} where ${where}`
  if (shape === 'page') return sql`select ${weldJoints}.* from ${weldJoints} where ${where}
    order by ${sql.join(getReportOrderBy(report, undefined, settings), sql`, `)} limit 100`
  // The real root-group enumeration shape: bind the group key once, preserve
  // count-over-total, child counts, order and bounded page. Chain summaries and
  // card hydration are intentionally outside this SQL predicate experiment.
  return sql`select group_key,child_count,record_count,group_total from (
    select coalesce(${weldJoints.line}::text,'') as group_key,count(*)::int as child_count,
      count(*)::int as record_count,count(*) over()::int as group_total
    from ${weldJoints} where ${where} group by 1
  ) journal_groups order by group_key limit 100`
}

async function execute(client: Client, query: SQL) {
  const compiled = dialect.sqlToQuery(query)
  // Match Drizzle's raw date/timestamp transport without a global pg parser
  // override, especially for BC/5-digit years and non-ISO output styles.
  return client.query({ text: compiled.sql, values: compiled.params, types: rawDateTypes })
}

async function isolated<T>(run: (client: Client) => Promise<T>) {
  return withE2eDatabase(async client => {
    expect((await client.query('select current_database() as name')).rows[0].name).toBe('welding_tracker_e2e')
    await client.query('begin')
    try {
      const seed = (await client.query('select id,project_title,subtitle_code,line,joint,isometry from weld_joints for update')).rows
      expect(seed).toHaveLength(1)
      expect(seed[0]).toMatchObject({ project_title: 'E2E проект', subtitle_code: 'E2E-001', line: 'E2E-L1', joint: 'F1', isometry: 'ISO-E2E' })
      await client.query('delete from weld_joints where id=$1', [seed[0].id])
      await client.query("set local datestyle='ISO, MDY'")
      return await run(client)
    } finally {
      await client.query('rollback')
      await client.query('analyze weld_joints')
    }
  })
}

const smallDates = [null, '2026-10-03', '2024-02-29', '2026-02-28', '1900-02-28', '2000-02-29',
  '0001-01-01', '0099-12-31', '9999-12-31', '10000-01-01', '0001-01-01 BC', 'infinity', '-infinity', '2026-03-10']

type SmallCase = { name: string; filter: string; eligible: boolean; expected: (style: string) => number[] }
const iso = (ids: number[]) => (style: string) => style.startsWith('ISO') ? ids : []
function smallCases(style: string): SmallCase[] {
  const native = style.startsWith('ISO') ? '2026-10-03' : style.startsWith('German') ? '03.10.2026'
    : style.startsWith('SQL') ? style.endsWith('MDY') ? '10/03/2026' : '03/10/2026'
      : style.endsWith('MDY') ? '10-03-2026' : '03-10-2026'
  const choice = (name: string, values: string[], ids: number[], eligible = true): SmallCase => ({ name,
    filter: buildWeldColumnValueFilter(values), eligible, expected: iso(ids) })
  return [
    choice('one canonical day', ['2026-10-03'], [2]),
    choice('multiple canonical days', ['2026-10-03', '2024-02-29'], [2, 3]),
    { ...choice('NULL only', [''], [1]), expected: () => [1] },
    { ...choice('day and NULL', ['2026-10-03', ''], [1, 2]), expected: dateStyle => dateStyle.startsWith('ISO') ? [1, 2] : [1] },
    choice('Unicode outer whitespace choice', ['\u00a02026-10-03\ufeff'], [2]),
    choice('valid leap century', ['2000-02-29'], [6]),
    choice('nonleap century', ['1900-02-29'], [], false),
    choice('invalid leap day', ['2026-02-29'], [], false),
    choice('invalid month', ['2026-13-01'], [], false),
    choice('invalid day', ['2026-04-31'], [], false),
    choice('year zero', ['0000-01-01'], [], false),
    choice('AD one', ['0001-01-01'], [7]),
    choice('AD below 100', ['0099-12-31'], [8]),
    choice('AD 9999', ['9999-12-31'], [9]),
    choice('five-digit year fallback', ['10000-01-01'], [10], false),
    choice('BC fallback', ['0001-01-01 BC'], [11], false),
    { ...choice('infinities fallback', ['infinity', '-infinity'], [12, 13], false), expected: () => [12, 13] },
    choice('mixed invalid: whole-list fallback', ['2026-10-03', 'not-a-date'], [2], false),
    { name: 'legacy exact', filter: '=2026-10-03', eligible: true, expected: iso([2]) },
    { name: 'legacy quoted/spaced exact', filter: " = ' 2026-10-03 ' ", eligible: true, expected: iso([2]) },
    { name: 'legacy Unicode inside quotes is not PG space trim', filter: "='\u00a02026-10-03\u00a0'", eligible: false, expected: () => [] },
    { name: 'legacy empty', filter: "= ''", eligible: true, expected: () => [1] },
    { name: 'current style facet value', filter: buildWeldColumnValueFilter([native]), eligible: style.startsWith('ISO'), expected: () => [2] },
    { name: 'ambiguous SQL value remains style dependent', filter: buildWeldColumnValueFilter(['10/03/2026']), eligible: false,
      expected: dateStyle => dateStyle.startsWith('SQL') ? dateStyle.endsWith('MDY') ? [2] : [14] : [] },
    { name: 'partial contains is untouched', filter: '2026', eligible: false, expected: () => [2, 4, 14] },
    { name: 'no filter is untouched', filter: '', eligible: false, expected: () => smallDates.map((_, n) => n + 1) },
  ]
}

function expectedLargeIds(total: number, name: string, style: string, report: WeldReportKind) {
  // Calendar offsets independently enumerated for non-leap 2026:
  // Oct 3 = day 276, Mar 10 = day 69, May 17 = day 137.
  const ids: number[] = []
  for (let id = 1; id <= total; id++) {
    if (id % 17 === 0) {
      if (report === 'weldingJournal' && name === 'canonical-or-null') ids.push(id)
      continue
    }
    if (!style.startsWith('ISO')) continue
    const day = id % 365
    const matches = name === 'canonical-multiple' ? [275, 68, 136].includes(day)
      : name === 'partial-contains-control' ? day >= 273 && day < 304
        : day === 275 && (name !== 'combined-with-project-choice' || id % 40 <= 1)
    if (matches) ids.push(id)
  }
  return ids
}

test('date choice prefilter: independent small oracle across output styles and fallback boundaries', async ({}, info) => {
  test.setTimeout(300000)
  const checks: object[] = [], originalDateFingerprints = assertOriginalDateFingerprints()
  try {
    await isolated(async client => {
      await client.query(`insert into weld_joints(id,project_title,line,joint,weld_date,has_vik,psto_required,psto_result)
        select n,'DATE SMALL','LINE-'||(n%3),'F'||n,value::date,'да','да','проведено'
        from unnest($1::text[]) with ordinality input(value,n)`, [smallDates])
      for (const style of styles) {
        await client.query("select set_config('DateStyle',$1,true)", [style])
        for (const report of reports) for (const item of smallCases(style)) {
          expect(Boolean(candidatePrefilter(item.filter)), item.name).toBe(item.eligible)
          const expected = item.expected(style).filter(id => report === 'weldingJournal' || smallDates[id - 1] !== null)
          const original = whereFor(report, item.filter, 'original'), candidate = whereFor(report, item.filter, 'native-prefilter')
          const rows = async (where: SQL) => (await execute(client, sql`select ${weldJoints.id} as id from ${weldJoints} where ${where} order by ${weldJoints.id}`)).rows.map(row => row.id)
          expect(await rows(original), `${style}/${report}/${item.name} independent original`).toEqual(expected)
          expect(await rows(candidate), `${style}/${report}/${item.name} independent candidate`).toEqual(expected)
          // Before and after source integration, validate the real builder too;
          // it never supplies the historical baseline or expected membership.
          const production = buildReportQueryWhere(report, { columnFilters: { weldDate: item.filter } }, settings)
          expect(await rows(production), `${style}/${report}/${item.name} production builder`).toEqual(expected)
          if (!item.eligible) expect(dialect.sqlToQuery(candidate)).toEqual(dialect.sqlToQuery(original))
          checks.push({ style, report, name: item.name, eligible: item.eligible, ids: expected })
        }
      }
    })
  } finally { await writeFile(info.outputPath('deep-date-choice-small.json'), JSON.stringify({ originalDateFingerprints, checks }, null, 2)) }
})

for (const total of totals) test(`physical weld-date choice SQL: count/page/group, ${total} rows`, async ({}, info) => {
  expect([9000, 200000]).toContain(total)
  test.setTimeout(900000)
  const samples: object[] = [], checked: object[] = [], originalDateFingerprints = assertOriginalDateFingerprints()
  let environment: unknown
  try {
    await isolated(async client => {
      environment = (await client.query(`select version(),current_setting('DateStyle') as date_style,current_setting('work_mem') as work_mem`)).rows[0]
      await client.query(`insert into weld_joints(id,project_title,subtitle_code,line,joint,weld_date,has_vik,vik_result,psto_required,psto_result,wdi,
        created_at,lnk_created_at,psto_created_at)
        select n,'DATE-PROJECT-'||lpad((n%40)::text,3,'0'),'DATE-CODE-'||lpad((n%400)::text,3,'0'),
          'DATE-LINE-'||lpad((n%100)::text,3,'0'),'F'||lpad(n::text,7,'0'),
          case when n%17=0 then null else date '2026-01-01'+(n%365) end,'да','годен','да','проведено',1,
          timestamp '2026-10-01'+n*interval '1 millisecond',timestamp '2026-10-01'+n*interval '1 millisecond',timestamp '2026-10-01'+n*interval '1 millisecond'
        from generate_series(1,$1::int) n`, [total])
      await client.query('analyze weld_joints')
      for (const style of ['ISO, MDY', 'SQL, MDY', 'German, DMY', 'Postgres, MDY']) {
        await client.query("select set_config('DateStyle',$1,true)", [style])
        const cases: Array<{ name: string; filter: string; extra: Record<string, string> }> = [
          { name: 'canonical-one', filter: buildWeldColumnValueFilter(['2026-10-03']), extra: {} },
          { name: 'canonical-or-null', filter: buildWeldColumnValueFilter(['2026-10-03', '']), extra: {} },
          ...(style.startsWith('ISO') ? [
            { name: 'canonical-multiple', filter: buildWeldColumnValueFilter(['2026-10-03', '2026-03-10', '2026-05-17']), extra: {} },
            { name: 'legacy-exact', filter: '=2026-10-03', extra: {} },
            { name: 'combined-with-project-choice', filter: buildWeldColumnValueFilter(['2026-10-03']), extra: { projectTitle: buildWeldColumnValueFilter(['DATE-PROJECT-000', 'DATE-PROJECT-001']) } },
            { name: 'partial-contains-control', filter: '2026-10', extra: {} },
            { name: 'mixed-invalid-fallback', filter: buildWeldColumnValueFilter(['2026-10-03', 'invalid']), extra: {} },
          ] : []),
        ]
        for (const report of reports) for (const item of cases) {
          const expectedIds = expectedLargeIds(total, item.name, style, report)
          const expectedGroups = new Map<string, number>()
          for (const id of expectedIds) {
            const key = `DATE-LINE-${String(id % 100).padStart(3, '0')}`
            expectedGroups.set(key, (expectedGroups.get(key) ?? 0) + 1)
          }
          const oldWhere = whereFor(report, item.filter, 'original', item.extra), newWhere = whereFor(report, item.filter, 'production', item.extra)
          const difference = await execute(client, sql`select id from (
            (select ${weldJoints.id} as id from ${weldJoints} where ${oldWhere} except select ${weldJoints.id} from ${weldJoints} where ${newWhere})
            union all (select ${weldJoints.id} from ${weldJoints} where ${newWhere} except select ${weldJoints.id} from ${weldJoints} where ${oldWhere})
          ) differences limit 1`)
          expect(difference.rows, `${style}/${report}/${item.name}`).toEqual([])
          checked.push({ style, report, name: item.name, eligible: Boolean(candidatePrefilter(item.filter)) })
          for (const shape of ['count', 'page', 'groups'] as Shape[]) {
            let reference: unknown
            for (let round = 0; round < 3; round++) for (const variant of (round % 2 ? ['production', 'original'] : ['original', 'production']) as Variant[]) {
              const query = queryFor(report, item.filter, variant, shape, item.extra), compiled = dialect.sqlToQuery(query)
              const started = performance.now(), result = await execute(client, query), milliseconds = performance.now() - started
              if (shape === 'count') expect(result.rows[0]?.total).toBe(expectedIds.length)
              else if (shape === 'page') expect(result.rows.map(row => row.id)).toEqual(expectedIds.slice().reverse().slice(0, 100))
              else expect(result.rows).toEqual([...expectedGroups].sort(([a], [b]) => a.localeCompare(b)).slice(0, 100)
                .map(([group_key, count]) => ({ group_key, child_count: count, record_count: count, group_total: expectedGroups.size })))
              if (reference === undefined) reference = result.rows
              else expect(result.rows, `${style}/${report}/${item.name}/${shape}/${variant}`).toEqual(reference)
              const plan = round === 0 ? (await client.query('explain (analyze,buffers,format json) ' + compiled.sql, compiled.params)).rows[0]['QUERY PLAN'] : undefined
              samples.push({ style, report, name: item.name, shape, variant, round, milliseconds, rows: result.rowCount,
                ...(shape === 'count' ? { matching: result.rows[0]?.total } : {}), ...(plan ? { sql: compiled.sql, parameters: compiled.params, plan } : {}) })
            }
          }
        }
      }
    })
  } finally { await writeFile(info.outputPath(`deep-date-choice-${total}.json`), JSON.stringify({ total, environment, originalDateFingerprints,
    comparison: 'Frozen historical date predicate versus actual integrated buildReportQueryWhere; diagnostic native-prefilter is used only by the separate small oracle', checked, samples,
    limits: 'SQL-only physical weldDate. Uses existing native date index; no schema changes. Original date predicate frozen independently of buildReportQueryWhere, with exact SQL fingerprints; production variant calls the real report builder including weldDate and all extra filters. Same source membership, full physical page projection/default order and root-group enumeration; excludes card hydration, chain summaries, RPC and grid. Warm buffers, three alternating original/production pairs. Native DateStyle semantics remain unchanged; invalid/noncanonical values fall back for the whole list.',
  }, null, 2)) }
})
