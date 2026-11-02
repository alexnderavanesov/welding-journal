import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import type pg from 'pg'

// This diagnostic consumes the unchanged SELECT actually captured from the
// production bundle. It must not silently follow a later source implementation.
const capturePath = 'outputs/deep-optimization-2026-11-01/psto-filter-group-repro-candidate3/deep-filter-http-200000-we-abd51-up-member-query-diagnostics-chromium/deep-filter-http-200000-40.json'
const signatures = {
  'warmup-50000/project-choice-group': {
    sql: '19c0c01f171ff85a1fabdd404ae9142901d996e850210b7d8f12c6874f590e63',
    parameters: '2e2b71e0a9bceccaf837d7305d2ddfd12a72c5971dea11dfab8af9f70f5dccfd',
  },
  'filtered/group-root': {
    sql: 'ccc7fb50e2965d22c5096aceb56acd116128cf5af73046cce4199092f14c7b8e',
    parameters: 'acefd3fff2fd05dcb1d32cb40e25865f4f854cc99457dbeed3cf5db158eed1eb',
  },
} as const
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
type Query = { sql: string; parameters: unknown[] }
type Fact = { id: number; projectTitle: string; subtitleCode: string; line: string; joint: string; finalStatus: string }
type VariantName = 'original' | 'filtered-cte' | 'literal-raw'
type RecordRow = Record<string, unknown>
type Variant = Query & { name: VariantName; noOp: boolean; plan?: unknown; analyzedPlan?: unknown;
  samples: Array<{ round: number; milliseconds: number; rows: number; bytes: number; digest: string }>;
  error?: string }
type CaseResult = { name: string; expectedRows: number; original: Query; originalPlan?: unknown;
  oracle?: { milliseconds: number; rows: number; bytes: number; digest: string; plan: unknown };
  variants: Variant[]; error?: string }
type Diagnostic = { version: string; selectedCases: string[]; capturePath: string; captureFileHash: string; limits: string; phase: string;
  environment?: unknown; cases: CaseResult[] }

const sourceMarker = ' from "weld_joints"\n    left join '
const whereMarker = '\n    where '
const joinSource = `from "weld_joints"
    left join "weld_joint_program_states" on "weld_joint_program_states"."weld_joint_id" = "weld_joints"."id"
    left join "weld_joints" as "journal_root" on "journal_root"."id" = "weld_joint_program_states"."physical_root_id"
    left join "weld_joint_program_states" as "journal_root_state" on "journal_root_state"."weld_joint_id" = "journal_root"."id"`

function splitQuery(query: Query) {
  assert.equal(query.sql.split(sourceMarker).length, 2, 'Exactly the captured top-level FROM')
  const sourceAt = query.sql.indexOf(sourceMarker) + 1
  const whereAt = query.sql.indexOf(whereMarker, sourceAt)
  assert.ok(whereAt > sourceAt)
  assert.equal(query.sql.slice(sourceAt, whereAt), joinSource)
  assert.ok(query.sql.startsWith('select '))
  return { projection: query.sql.slice(7, sourceAt - 1), where: query.sql.slice(whereAt + whereMarker.length) }
}

function materializedFacts(query: Query): Query {
  const { projection, where } = splitQuery(query)
  const stateAt = projection.indexOf(', "weld_joint_program_states"."weld_joint_id" as "state_weldJointId"')
  assert.ok(stateAt > 0)
  const rowProjection = projection.slice(0, stateAt)
  const fields = [...rowProjection.matchAll(/([\s\S]+?) as "(row_[A-Za-z0-9]+)"(?:, |$)/g)]
  assert.equal(fields.map(match => `${match[1]} as "${match[2]}"`).join(', '), rowProjection)
  assert.equal(fields.length, 37)
  assert.equal(new Set(fields.map(match => match[2])).size, fields.length)
  assert.ok(fields.some(match => match[2] === 'row_id'))
  // The captured projection contains only physical fact columns and the group
  // key coalesce; no parameters, volatile functions or joined dependencies.
  for (const [, expression] of fields) assert.match(expression,
    /^(?:"weld_joints"\."[a-z0-9_]+"|coalesce\("weld_joints"\."project_title"::text, ''\))$/)
  const joinedProjection = projection.slice(stateAt + 2)
  assert.ok(!joinedProjection.includes('"weld_joints".'))
  const joins = joinSource.slice('from "weld_joints"'.length)
  assert.equal(joins.split('"weld_joints"."id"').length, 2)
  return { parameters: [...query.parameters], sql: `with "journal_filtered" as materialized (
    select ${rowProjection} from "weld_joints" where ${where}
  ) select ${fields.map(([, , name]) => `"journal_filtered"."${name}" as "${name}"`).join(', ')}, ${joinedProjection}
  from "journal_filtered"${joins.replace('"weld_joints"."id"', '"journal_filtered"."row_id"')}` }
}

function literalPredicates(query: Query): Query {
  const { where } = splitQuery(query)
  let replaced = 0
  const changed = where.replace(/coalesce\("weld_joints"\."(project_title|line)"::text, ''\) ilike \$(\d+)/g,
    (match, column: string, position: string) => {
      const pattern = query.parameters[Number(position) - 1]
      assert.equal(typeof pattern, 'string')
      const text = pattern as string
      assert.ok(text.startsWith('%') && text.endsWith('%'))
      const literal = text.slice(1, -1)
      assert.ok(literal.trim().length > 0 && !/[%_\\]/.test(literal), 'Literal-only rewrite; preserve wildcard semantics elsewhere')
      replaced++
      const raw = `"weld_joints"."${column}"`
      return `(${raw} is not null and ${raw}::text ilike $${position})`
    })
  assert.ok(replaced === 0 || replaced === 2, 'Only the two captured physical fragment predicates')
  return { sql: query.sql.slice(0, -where.length) + changed, parameters: [...query.parameters] }
}

function singleProjectChoice(query: Query, value: string): Query {
  // buildColumnChoiceWhere deduplicates values before constructing this array.
  // A real one-choice popup emits one bind, not ten equal binds: the latter
  // has equal membership but a different planner cardinality estimate.
  const capturedArray = `any(array[${Array.from({ length: 10 }, (_, index) => `lower(trim($${index + 9}))`).join(', ')}]::text[])`
  assert.equal(query.parameters.length, 18)
  assert.equal(query.sql.split(capturedArray).length, 2)
  assert.ok(query.sql.endsWith(`${capturedArray})`))
  const single = { sql: query.sql.replace(capturedArray, 'any(array[lower(trim($9))]::text[])'),
    parameters: [...query.parameters.slice(0, 8), value] }
  assert.equal(Math.max(...[...single.sql.matchAll(/\$(\d+)/g)].map(match => Number(match[1]))), single.parameters.length)
  return single
}

async function capturedQueries() {
  const absolute = resolve(capturePath)
  assert.equal(await realpath(absolute), absolute, 'Use the exact preserved artifact, not an alternate symlink')
  const text = await readFile(absolute, 'utf8')
  const artifact = JSON.parse(text) as { total: number; projectCount: number; groupRepro: boolean;
    phases: Array<{ name: string; captures: Query[] }> }
  assert.equal(artifact.total, 200000); assert.equal(artifact.projectCount, 40); assert.equal(artifact.groupRepro, true)
  const queries = Object.fromEntries(Object.entries(signatures).map(([name, signature]) => {
    const phase = artifact.phases.find(item => item.name === name)
    assert.ok(phase && phase.captures.length > 0, name)
    const query = phase.captures.at(-1)!
    assert.equal(hash(query.sql), signature.sql, `${name}: original SELECT fingerprint`)
    assert.equal(hash(JSON.stringify(query.parameters)), signature.parameters, `${name}: original parameter fingerprint`)
    splitQuery(query)
    return [name, { sql: query.sql, parameters: [...query.parameters] }]
  })) as Record<keyof typeof signatures, Query>
  assert.equal(splitQuery(queries['filtered/group-root']).projection, splitQuery(queries['warmup-50000/project-choice-group']).projection)
  return { queries, captureFileHash: hash(text) }
}

async function transaction<T>(db: pg.Client, oracle: boolean, run: () => Promise<T>) {
  await db.query('begin isolation level repeatable read read only')
  try {
    // Local diagnostic ceiling and oracle control only; neither survives this
    // transaction or changes the running application's connection/settings.
    await db.query("set local statement_timeout = '60s'")
    if (oracle) await db.query('set local enable_nestloop = off')
    const result = await run()
    await db.query('rollback')
    return result
  } catch (error) { await db.query('rollback'); throw error }
}

function verifyRows(rows: RecordRow[], expected: Fact[], columns: string[]) {
  assert.equal(rows.length, expected.length, 'Independent fixture membership count')
  rows.sort((a, b) => Number(a.row_id) - Number(b.row_id))
  const sortedExpected = expected.slice().sort((a, b) => a.id - b.id)
  const sha = createHash('sha256')
  let bytes = 0
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index], fact = sortedExpected[index]
    assert.equal(row.row_id, fact.id, 'Independent membership/order after canonical sort')
    assert.equal(row.row_projectTitle, fact.projectTitle)
    assert.equal(row.row_subtitleCode, fact.subtitleCode)
    assert.equal(row.row_line, fact.line)
    assert.equal(row.row_joint, fact.joint)
    assert.equal(row.row_groupKey, fact.projectTitle)
    assert.equal(row.row_finalStatus, fact.finalStatus)
    assert.equal(Number(row.row_wdi), 1)
    assert.equal(row.state_weldJointId, fact.id)
    assert.equal(row.state_physicalRootId, fact.id)
    assert.equal(row.root_id, fact.id)
    const json = JSON.stringify(columns.map(column => row[column]))
    sha.update(json); sha.update('\n'); bytes += Buffer.byteLength(json) + 1
  }
  return { rows: rows.length, bytes, digest: sha.digest('hex') }
}

/** SQL-plan isolation, not end-to-end timing and not a production planner fix. */
export async function runDeepFilterGroupSqlExperiment(db: pg.Client, facts: Fact[],
  onProgress: (value: Diagnostic) => Promise<void>) {
  // Verify the actual client endpoint before issuing SQL. A PostgreSQL server
  // behind the local Docker mapping reports its container address instead.
  assert.equal(db.host, '127.0.0.1')
  assert.equal(db.port, 5432)
  assert.equal(db.database, 'welding_tracker_e2e')
  const captured = await capturedQueries()
  const diagnostic: Diagnostic = { version: 'captured-member-sql-v2-single-bind', selectedCases: [],
    capturePath, captureFileHash: captured.captureFileHash, phase: 'prepare', cases: [],
    limits: 'Same independently seeded 200k/40 fixture and captured 53-column SELECT. Broad original default-planner SELECT already timed out twice and is EXPLAIN-only here. Full-value oracle uses the unchanged SELECT with transaction-local enable_nestloop=off; it is not baseline performance. Every SELECT is bounded by transaction-local 60s statement_timeout. Candidate measured calls use default planner settings; EXPLAIN/ANALYZE and JS equality checks are outside timings. Three alternating paired rounds; same warm server, no browser latency or production claim.' }
  diagnostic.environment = (await db.query(`select current_database() as database,inet_server_addr()::text as server_address,
    current_setting('enable_nestloop') as enable_nestloop,current_setting('statement_timeout') as statement_timeout,
    current_setting('work_mem') as work_mem,current_setting('jit') as jit,version()`)).rows[0]
  assert.equal((diagnostic.environment as { database: string }).database, 'welding_tracker_e2e')
  assert.equal((diagnostic.environment as { enable_nestloop: string }).enable_nestloop, 'on')
  assert.equal(facts.length, 200000)
  const wide = captured.queries['filtered/group-root'], choice = captured.queries['warmup-50000/project-choice-group']
  const chosenProjects = new Set(choice.parameters.slice(8) as string[])
  const cases: Array<{ name: string; query: Query; expected: Fact[]; originalTiming: boolean }> = [
    { name: 'wide-literal-102000', query: wide, expected: facts.filter(row => row.line.includes('LINE-0')), originalTiming: false },
    { name: 'choice-50000', query: choice, expected: facts.filter(row => chosenProjects.has(row.projectTitle)), originalTiming: true },
    { name: 'single-choice-5000', query: singleProjectChoice(choice, String(choice.parameters[8])),
      expected: facts.filter(row => row.projectTitle === choice.parameters[8]), originalTiming: true },
    { name: 'empty-choice', query: singleProjectChoice(choice, 'E2E-DEEP-HTTP-NO-SUCH-PROJECT'),
      expected: [], originalTiming: true },
    // These two small controls exercise the raw rewrite when broad fragments
    // stop matching most data, rather than mistaking no-op exact choices for it.
    { name: 'narrow-literal-line', query: { sql: wide.sql, parameters: wide.parameters.map((value, index) => index === 9 ? '%LINE-0017%' : value) },
      expected: facts.filter(row => row.line === 'LINE-0017'), originalTiming: false },
    { name: 'empty-literal', query: { sql: wide.sql, parameters: wide.parameters.map((value, index) => index === 9 ? '%NO-SUCH-LINE%' : value) },
      expected: [], originalTiming: false },
  ]
  const requested = process.env.DEEP_FILTER_GROUP_SQL_CASES?.split(',').map(name => name.trim())
  if (requested) {
    assert.ok(requested.length > 0 && requested.every(name => cases.some(item => item.name === name)), 'Known nonempty DEEP_FILTER_GROUP_SQL_CASES')
    assert.equal(new Set(requested).size, requested.length, 'No duplicate diagnostic cases')
  }
  const selectedCases = requested ? cases.filter(item => requested.includes(item.name)) : cases
  diagnostic.selectedCases = selectedCases.map(item => item.name)
  const failures: string[] = []
  await onProgress(diagnostic)
  for (const item of selectedCases) {
    const result: CaseResult = { name: item.name, expectedRows: item.expected.length, original: item.query, variants: [] }
    diagnostic.cases.push(result)
    diagnostic.phase = `${item.name}/original-plan`
    await onProgress(diagnostic)
    const columns = [...splitQuery(item.query).projection.matchAll(/ as "([A-Za-z0-9_]+)"/g)].map(match => match[1])
    assert.equal(columns.length, 53)
    try {
      result.originalPlan = await transaction(db, false, async () =>
        (await db.query('explain (format json) ' + item.query.sql, item.query.parameters)).rows[0]['QUERY PLAN'])
      diagnostic.phase = `${item.name}/oracle-nestloop-off`; await onProgress(diagnostic)
      const oracle = await transaction(db, true, async () => {
        const started = performance.now(), records = await db.query(item.query.sql, item.query.parameters)
        const milliseconds = performance.now() - started
        assert.deepEqual(records.fields.map(field => field.name), columns)
        const checked = verifyRows(records.rows as RecordRow[], item.expected, columns)
        const plan = (await db.query('explain (analyze,buffers,format json) ' + item.query.sql, item.query.parameters)).rows[0]['QUERY PLAN']
        return { milliseconds, ...checked, plan }
      })
      result.oracle = oracle
      const raw = literalPredicates(item.query)
      const candidates: Array<Query & { name: VariantName }> = [
        ...(item.originalTiming ? [{ ...item.query, name: 'original' as const }] : []),
        { ...materializedFacts(item.query), name: 'filtered-cte' }, { ...raw, name: 'literal-raw' },
      ]
      result.variants = candidates.map(candidate => ({ ...candidate, noOp: candidate.sql === item.query.sql, samples: [] }))
      // Capture all candidate plans before executing either form, so a bounded
      // timeout still leaves both shapes available for independent review.
      for (const variant of result.variants) {
        diagnostic.phase = `${item.name}/${variant.name}/plan`; await onProgress(diagnostic)
        variant.plan = await transaction(db, false, async () =>
          (await db.query('explain (format json) ' + variant.sql, variant.parameters)).rows[0]['QUERY PLAN'])
      }
      for (let round = 0; round < 3; round++) {
        const order = round % 2 ? result.variants.slice().reverse() : result.variants
        for (const variant of order) {
          if (variant.error) continue
          diagnostic.phase = `${item.name}/${variant.name}/round-${round}`; await onProgress(diagnostic)
          try {
            const measured = await transaction(db, false, async () => {
              const started = performance.now(), records = await db.query(variant.sql, variant.parameters)
              const milliseconds = performance.now() - started
              assert.deepEqual(records.fields.map(field => field.name), columns)
              return { milliseconds, ...verifyRows(records.rows as RecordRow[], item.expected, columns) }
            })
            assert.equal(measured.digest, oracle.digest, 'All 53 selected values equal unchanged original SELECT')
            assert.equal(measured.bytes, oracle.bytes)
            variant.samples.push({ round, ...measured })
            if (round === 0) variant.analyzedPlan = await transaction(db, false, async () =>
              (await db.query('explain (analyze,buffers,format json) ' + variant.sql, variant.parameters)).rows[0]['QUERY PLAN'])
          } catch (error) {
            variant.error = error instanceof Error ? error.message : String(error)
            failures.push(`${item.name}/${variant.name}: ${variant.error}`)
          }
          await onProgress(diagnostic)
        }
      }
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error)
      failures.push(`${item.name}: ${result.error}`)
    }
    await onProgress(diagnostic)
  }
  diagnostic.phase = failures.length ? 'failed' : 'complete'
  await onProgress(diagnostic)
  assert.deepEqual(failures, [], 'Bounded SQL experiments and full-output equivalence')
  return diagnostic
}
