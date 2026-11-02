import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { and, sql, type SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { Client } from 'pg'
import { withE2eDatabase } from '../database'
import { weldJoints } from '../../src/db/schema'
import { DEFAULT_OTHER_SETTINGS } from '../../src/lib/other-settings'
import { buildReportQueryWhere, getReportOrderBy } from '../../src/server/weld-read'
import { reportTextSql } from '../../src/server/report-filter-text-sql'
import type { WeldReportKind } from '../../src/server/weld-contracts'

// SQL-only experiment, deliberately separate from the full HTTP/grid profile.
// No production schema/migration is changed. Parent coordinates its exclusive
// use of the runner-owned local disposable database with its one setup row.
const enabled = process.env.DEEP_FILTER_SQL === '1'
test.skip(!enabled, 'Opt-in sequential substring index experiment')
test.use({ trace: 'off', video: 'off' })
const sizes = process.env.DEEP_FILTER_SQL_SIZE ? [Number(process.env.DEEP_FILTER_SQL_SIZE)] : [9000, 200_000]
const fields = ['projectTitle', 'subtitleCode', 'line', 'joint'] as const
type Field = typeof fields[number]
type Phase = 'baseline' | 'coalesce-gin' | 'raw-gin'
type Scenario = { name: string; report: WeldReportKind; filters: Record<string, string>; search?: string; shapes?: Shape[] }
type Shape = 'count' | 'page' | 'facet' | 'groups'
const dialect = new PgDialect()
const settings = { ...DEFAULT_OTHER_SETTINGS, wdiCalculationMode: 'manual' as const }
const dbNames: Record<Field, string> = { projectTitle: 'project_title', subtitleCode: 'subtitle_code', line: 'line', joint: 'joint' }
const indexName = (phase: Exclude<Phase, 'baseline'>, field: Field) => `e2e_deep_${phase === 'raw-gin' ? 'raw' : 'coalesce'}_${dbNames[field]}_trgm`
const phases: Phase[][] = [['baseline', 'coalesce-gin', 'raw-gin'], ['raw-gin', 'baseline', 'coalesce-gin'], ['coalesce-gin', 'raw-gin', 'baseline']]

function whereFor(scenario: Scenario, phase: Phase) {
  if (phase !== 'raw-gin') return buildReportQueryWhere(scenario.report,
    { columnFilters: scenario.filters, search: scenario.search }, settings)
  const remainder = { ...scenario.filters }, rewritten: SQL[] = []
  for (const field of fields) {
    const value = remainder[field]?.trim()
    if (!value) continue
    // This experiment only rewrites ordinary fragments. Exact/choice filters
    // and every calculated/status/date expression retain the production path.
    if (value.startsWith('=') || value.startsWith('{')) continue
    delete remainder[field]
    const column = weldJoints[field], pattern = `%${value}%`
    // Preserve the original ILIKE grammar, case/collation and NULL-as-empty
    // behavior, including '%' and escaped trailing '%' from a final backslash.
    // The parameter-only arm can be folded by PostgreSQL for ordinary text.
    rewritten.push(sql`(${column} ilike ${pattern} or (${column} is null and '' ilike ${pattern}))`)
  }
  return and(buildReportQueryWhere(scenario.report, { columnFilters: remainder, search: scenario.search }, settings), ...rewritten)!
}

function queryFor(scenario: Scenario, shape: Shape, phase: Phase) {
  const where = whereFor(scenario, phase)
  if (shape === 'count') return sql`select count(*)::integer as total from ${weldJoints} where ${where}`
  if (shape === 'page') return sql`select ${weldJoints}.* from ${weldJoints} where ${where}
    order by ${sql.join(getReportOrderBy(scenario.report, undefined, settings), sql`, `)} limit 100`
  if (shape === 'groups') return sql`select coalesce(${weldJoints.line}::text, '') as value, count(*)::integer as total
    from ${weldJoints} where ${where} group by 1 order by 1 limit 100`
  // The opened facet excludes its own filter, as listColumnFilterOptions does.
  const field = scenario.filters.projectTitle ? 'line' : 'projectTitle'
  const filters = { ...scenario.filters }; delete filters[field]
  return sql`select ${reportTextSql(weldJoints[field])} as value, count(*)::integer as total
    from ${weldJoints} where ${whereFor({ ...scenario, filters }, phase)} group by 1 order by 1`
}

async function execute(client: Client, query: SQL) {
  const compiled = dialect.sqlToQuery(query)
  return client.query(compiled.sql, compiled.params)
}

function scenarios(): Scenario[] {
  const result: Scenario[] = []
  for (const report of ['weldingJournal', 'lnk', 'heatTreatment'] as const) {
    for (const [field, fragment] of Object.entries({ projectTitle: 'проект-017', subtitleCode: 'шифр-037', line: 'ЛИНИЯ-0123', joint: 'F0000123' })) {
      result.push({ name: `${report}-${field}-selective`, report, filters: { [field]: fragment } })
    }
    result.push({ name: `${report}-combined`, report, filters: { projectTitle: 'проект-017', subtitleCode: 'шифр-017', line: 'ЛИНИЯ-0' }, shapes: ['count', 'page'] })
  }
  for (const fragment of ['7', '37', '237', 'F', '%', '_', '\\', 'ends\\', '100\\%', 'A\\_B']) {
    result.push({ name: `journal-pattern-${JSON.stringify(fragment)}`, report: 'weldingJournal', filters: { joint: fragment }, shapes: ['count'] })
  }
  for (const fragment of ['годен', 'ожидает', 'РК']) {
    result.push({ name: `final-status-control-${fragment}`, report: 'weldingJournal', filters: { finalStatus: fragment }, shapes: ['count'] })
  }
  result.push({ name: 'date-control', report: 'weldingJournal', filters: { weldDate: '2026-10-0' }, shapes: ['count'] })
  for (const search of ['F0000123', 'ответственный-017']) {
    result.push({ name: `quick-search-control-${search}`, report: 'weldingJournal', filters: {}, search, shapes: ['count', 'page'] })
  }
  return result
}

async function keepOnly(client: Client, phase: Phase) {
  for (const kind of ['raw-gin', 'coalesce-gin'] as const) if (kind !== phase) {
    await client.query(`drop index ${fields.map(field => indexName(kind, field)).join(', ')}`)
  }
}

async function buildIndex(client: Client, phase: Exclude<Phase, 'baseline'>, field: Field) {
  const column = dbNames[field], expression = phase === 'raw-gin' ? column : `(coalesce(${column}::text,''))`
  await client.query(`create index ${indexName(phase, field)} on weld_joints using gin (${expression} gin_trgm_ops)`)
}

function independentCount(scenario: Scenario, total: number) {
  if (scenario.name === 'weldingJournal-projectTitle-selective') return Math.floor((total - 17) / 40) + 2 // mixed-case edge row, plus ordinary residue 17
  if (scenario.name === 'weldingJournal-subtitleCode-selective') return Math.floor((total - 37) / 400) + 1
  if (scenario.name === 'weldingJournal-line-selective') return Math.floor((total - 123) / 2000) + 1
  if (scenario.name === 'weldingJournal-joint-selective') return 10 // F00001230 through F00001239
  if (scenario.report !== 'weldingJournal' || Object.keys(scenario.filters).length !== 1) return undefined
  return ({ '%': total, '_': total - 2, '\\': 2, 'ends\\': 1, '100\\%': 1, 'A\\_B': 1 } as Record<string, number>)[scenario.filters.joint]
}

async function checkRewriteSemantics(client: Client) {
  const values = [null, '', ' ', '\u00a0', '\ufeff', 'ПроЕкт-017', '100%', 'A_B', 'C\\path', 'ends%', 'prefix ends% suffix']
  const patterns = ['проект', 'ПРОЕКТ', ' ', '\u00a0', '\ufeff', '%', '_', '\\', 'ends\\', '100\\%', 'A\\_B', 'C\\\\path']
  const result = await client.query(`select v, fragment from unnest($1::text[]) as v cross join unnest($2::text[]) as fragment
    where ((coalesce(v::text,'') ilike '%'||fragment||'%') is true)
      is distinct from ((v ilike '%'||fragment||'%' or (v is null and '' ilike '%'||fragment||'%')) is true)`, [values, patterns])
  expect(result.rows, 'NULL, empty, Unicode whitespace, ILIKE wildcards and escaping').toEqual([])
  // Independent counterexamples: '%' must include NULL; '_' must not; a final
  // backslash escapes the wrapper's final wildcard, retaining its end anchor.
  const examples = await client.query(`select
    coalesce(null::text,'') ilike '%%%' as null_percent,
    coalesce(null::text,'') ilike '%_%' as null_underscore,
    'ends%' ilike $1 as trailing_match,
    'prefix ends% suffix' ilike $1 as trailing_nonmatch`, ['%ends\\%'])
  expect(examples.rows[0]).toEqual({ null_percent: true, null_underscore: false, trailing_match: true, trailing_nonmatch: false })
}

async function seed(client: Client, total: number) {
  const edge = [null, '', ' ', '\u00a0', '\ufeff', '  ПроЕкт-017  ', '100%', 'A_B', 'C\\path', 'ends%', 'prefix ends% suffix']
  await client.query(`insert into weld_joints(id,project_title,subtitle_code,line,joint,weld_date,has_vik,vik_result,
    psto_required,psto_result,wdi,officiality,final_status,responsible,created_at,lnk_created_at,psto_created_at)
    select n,
      case when n<=cardinality($2::text[]) then ($2::text[])[n] else 'Проект-'||lpad((n%40)::text,3,'0') end,
      case when n<=cardinality($2::text[]) then ($2::text[])[n] else 'Шифр-'||lpad((n%400)::text,3,'0') end,
      case when n<=cardinality($2::text[]) then ($2::text[])[n] else 'Линия-'||lpad((n%2000)::text,4,'0') end,
      case when n<=cardinality($2::text[]) then ($2::text[])[n] else 'F'||lpad(n::text,8,'0') end,
      case when n%17=0 then null else date '2026-10-01'+(n%20) end,
      case when n%5=0 then 'нет' else 'да' end,'годен',
      case when n%4=0 then 'нет' else 'да' end,'проведено',1,'действующий',
      case when n%19=0 then 'не годен по дублю' when n%11=0 then 'ожидает сварки' else 'годен' end,
      'ответственный-'||lpad((n%100)::text,3,'0'),
      timestamp '2026-10-01'+n*interval '1 millisecond',timestamp '2026-10-01'+n*interval '1 millisecond',
      timestamp '2026-10-01'+n*interval '1 millisecond' from generate_series(1,$1::integer) n`, [total, edge])
  // One insert avoids manufacturing a full table of dead tuples by updating
  // seeded statuses before measuring a transaction that cannot VACUUM itself.
  await client.query(`insert into duplicate_controls(weld_joint_id,method,result)
    select id,'РК','ремонт' from weld_joints where id%19=0`)
  await client.query('analyze weld_joints')
  await client.query('analyze duplicate_controls')
}

async function writeCost(client: Client, phase: Phase, total: number) {
  const records = 1000
  const statements = [
    { name: 'insert', query: `insert into weld_joints(id,project_title,subtitle_code,line,joint,welding_journal_note)
      select ${total}+n,'Write project-'||n,'Write subtitle-'||n,'Write line-'||n,'Write joint-'||n,'before'
      from generate_series(1,${records}) n` },
    { name: 'unrelated-note', query: `update weld_joints set welding_journal_note='after' where id>${total}` },
    { name: 'indexed-four-fields', query: `update weld_joints set project_title=project_title||'-new',subtitle_code=subtitle_code||'-new',
      line=line||'-new',joint=joint||'-new' where id>${total}` },
  ]
  const samples: object[] = []
  for (const statement of statements) {
    const started = performance.now()
    const result = await client.query('explain (analyze, buffers, wal, format json) ' + statement.query)
    const statementMs = performance.now() - started
    const cleanupStarted = performance.now(), cleanup: object[] = []
    // GIN fastupdate can defer its cost. Include explicit pending-list merge
    // cost, without pretending this is a vacuum or long-lived production test.
    if (phase !== 'baseline') for (const field of fields) {
      const name = indexName(phase, field)
      const merged = await client.query('select gin_clean_pending_list($1::regclass)::integer as pages', [name])
      cleanup.push({ index: name, pages: merged.rows[0].pages })
    }
    samples.push({ operation: statement.name, records, statementMs,
      cleanupMs: performance.now() - cleanupStarted, cleanup, plan: result.rows[0]['QUERY PLAN'] })
  }
  return samples
}

for (const total of sizes) test(`substring SQL plans, equivalent membership and index write cost: ${total}`, async ({}, info) => {
  expect([9000, 200_000]).toContain(total)
  test.setTimeout(900_000)
  const output: Record<string, unknown> = { total,
    limits: ['SQL predicates and physical page projection only; no application hydration, RPC, grid or dispatcher timing.',
      'Warm buffers after seed/index build; three alternating phase orders, no forced planner switches.',
      'Default GIN fastupdate; each measured write explicitly merges pending lists, included separately.',
      'Active indexes are rebuilt before each write sample to avoid accumulated aborted GIN entries; rebuild is outside write timing.',
      'Writes are sequential savepoint-rolled-back batches; not a vacuum, concurrency or sustained-write benchmark.',
      'Final status and date are controls without added indexes; quick search still covers all 26 columns.'] }
  await withE2eDatabase(async client => {
    const identity = (await client.query(`select current_database() as database,version() as version,
      current_setting('server_version_num') as server_version_num,current_setting('DateStyle') as date_style,
      (select datcollate from pg_database where datname=current_database()) as lc_collate,current_setting('work_mem') as work_mem,
      current_setting('max_parallel_workers_per_gather') as parallel_workers,
      current_setting('gin_pending_list_limit') as gin_pending_list_limit,
      (select count(*)::integer from weld_joints) as existing_welds`)).rows[0]
    expect(identity.database).toBe('welding_tracker_e2e')
    expect(identity.existing_welds, 'Only the single known global-setup row may exist').toBe(1)
    const extension = (await client.query(`select name,default_version,installed_version from pg_available_extensions where name='pg_trgm'`)).rows
    expect(extension.length, 'pg_trgm must be available in the local image').toBe(1)
    output.environment = { ...identity, extension }
    await client.query('begin')
    try {
      // Remove only the verified runner setup row inside this transaction. Its
      // card and cascaded children are restored by the final rollback.
      const initial = await client.query(`select id,project_title,subtitle_code,line,joint,isometry from weld_joints for update`)
      expect(initial.rows).toHaveLength(1)
      expect(initial.rows[0]).toMatchObject({ project_title: 'E2E проект', subtitle_code: 'E2E-001', line: 'E2E-L1', joint: 'F1', isometry: 'ISO-E2E' })
      await client.query('delete from weld_joints where id=$1', [initial.rows[0].id])
      // Transactional experimental DDL only in the verified disposable DB.
      await client.query('create extension if not exists pg_trgm')
      await seed(client, total)
      await checkRewriteSemantics(client)
      const cases = scenarios(), equivalence: string[] = []
      for (const item of cases) {
        const oldWhere = whereFor(item, 'baseline'), newWhere = whereFor(item, 'raw-gin')
        const difference = await execute(client, sql`select id from (
          (select ${weldJoints.id} as id from ${weldJoints} where ${oldWhere}
            except select ${weldJoints.id} from ${weldJoints} where ${newWhere})
          union all
          (select ${weldJoints.id} from ${weldJoints} where ${newWhere}
            except select ${weldJoints.id} from ${weldJoints} where ${oldWhere})
        ) differences limit 1`)
        expect(difference.rows, item.name).toEqual([])
        equivalence.push(item.name)
      }
      output.equivalence = equivalence
      const builds: object[] = []
      for (const phase of ['coalesce-gin', 'raw-gin'] as const) for (const field of fields) {
        const started = performance.now()
        await buildIndex(client, phase, field)
        builds.push({ phase, field, milliseconds: performance.now() - started })
      }
      // Expression-index statistics do not exist before index creation. Give
      // coalesce indexes the same analyzed data as the already analyzed raw
      // columns before comparing planner choices, especially AND combinations.
      await client.query('analyze weld_joints')
      output.indexBuilds = builds
      output.indexes = (await client.query(`select c.relname,pg_relation_size(c.oid)::integer as bytes,c.reloptions,
        pg_get_indexdef(c.oid) as definition from pg_class c where c.relname like 'e2e_deep_%_trgm' order by c.relname`)).rows
      const samples: object[] = [], reference = new Map<string, unknown>()
      for (let round = 0; round < phases.length; round++) for (const phase of phases[round]) {
        await client.query('savepoint phase')
        try {
          await keepOnly(client, phase)
          // Every substantive shape has three measured observations per phase.
          // ANALYZE is collected only in round zero, outside timed plain reads.
          for (const item of cases) for (const shape of item.shapes ?? ['count', 'page', 'facet', 'groups']) {
            const query = queryFor(item, shape, phase), compiled = dialect.sqlToQuery(query)
            const started = performance.now(), result = await client.query(compiled.sql, compiled.params)
            const milliseconds = performance.now() - started, key = `${item.name}/${shape}`
            const expectedCount = independentCount(item, total)
            if (shape === 'count' && expectedCount !== undefined) expect(result.rows[0]?.total, key).toBe(expectedCount)
            if (!reference.has(key)) reference.set(key, result.rows)
            else expect(result.rows, `${phase}/${round}/${key}`).toEqual(reference.get(key))
            const plan = round === 0 ? (await client.query('explain (analyze, buffers, format json) ' + compiled.sql, compiled.params)).rows[0]['QUERY PLAN'] : undefined
            samples.push({ round, phase, name: item.name, shape, milliseconds, rows: result.rowCount,
              ...(shape === 'count' ? { matching: result.rows[0]?.total } : {}),
              ...(plan ? { sql: compiled.sql, parameters: compiled.params, plan } : {}) })
          }
        } finally { await client.query('rollback to savepoint phase'); await client.query('release savepoint phase') }
      }
      output.samples = samples
      const writes: object[] = []
      // Read samples finish before rolled-back writes can leave dead GIN items.
      for (let round = 0; round < phases.length; round++) for (const phase of phases[round]) {
        await client.query('savepoint writes')
        try {
          await keepOnly(client, 'baseline')
          if (phase !== 'baseline') for (const field of fields) await buildIndex(client, phase, field)
          writes.push({ round, phase, samples: await writeCost(client, phase, total) })
        } finally { await client.query('rollback to savepoint writes'); await client.query('release savepoint writes') }
      }
      output.writes = writes
    } finally {
      await client.query('rollback')
      // Restore planner statistics to the actual setup fixture after rollback.
      await client.query('analyze weld_joints')
      await client.query('analyze duplicate_controls')
      await writeFile(info.outputPath(`deep-filter-sql-${total}.json`), JSON.stringify(output, null, 2))
    }
  })
})
