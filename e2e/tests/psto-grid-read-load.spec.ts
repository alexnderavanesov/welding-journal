import { expect, test } from '@playwright/test'
import assert from 'node:assert/strict'
import pg from 'pg'

import type { WeldRow } from '../../src/lib/dispatcher-types'
import { getPstoDisplayValue } from '../../src/lib/lnk-status'
import { calculateWdi, isSystemWdiMode } from '../../src/lib/wdi'
import { buildWeldColumnValueFilter } from '../../src/lib/weld-column-choice-filter'
import type { WeldPageRequest } from '../../src/server/weld-contracts'
import { assertSafeE2eDatabaseUrl, withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { loadDispatcherTaskContext, normalizeDispatcherTaskContextRequest } from '../../src/server/dispatcher-task-context'

const project = 'E2E PSTO page read 200k'
const fixtureSize = 200_000
const repeatEvery = 20
const outputSize = 5_000

type ExpectedRow = { id: number; n: number; rootId: number; cycleIds: number[] }
type SeedRow = { id: number; n: number; physicalRootId: number; sourceRowId: number | null; kind: string; cycleIds: number[] }
type Statement = {
  sql: string
  table: string
  parameters: unknown[]
  rows: number | null
  fields: string[]
}

async function cleanup() {
  // Program identities intentionally survive joint deletion and have no FK.
  await withE2eDatabase(db => db.query(`delete from weld_joint_program_states s using weld_joints w
    where s.weld_joint_id=w.id and w.project_title=$1`, [project]))
  await cleanupLineProgramProjects([project])
}

function dayOffset(n: number) { return Math.floor((n - 1) / repeatEvery) % 28 }
function date(month: number, day: number) { return new Date(Date.UTC(2026, month - 1, day)).toISOString().slice(0, 10) }
function primaryDate(n: number, daysAfter = 0) { return date(7, 1 + dayOffset(n) + daysAfter) }
function repeatDate(n: number, sequence: number, daysAfter = 0) {
  return sequence === 2 ? date(8, 1 + dayOffset(n) + daysAfter) : date(9, 28 - dayOffset(n) + daysAfter)
}

test.beforeEach(cleanup)
test.afterEach(cleanup)

test('200k ПСТО: paged current-cycle filters and sorting retain raw facts and bounded group metadata', async ({}, info) => {
  test.setTimeout(240_000)
  assertSafeE2eDatabaseUrl(process.env.DATABASE_URL ?? '')
  await withLineProgramFixture(async db => {
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,isometry,weld_date,
      connection_type,d1,t1,wdi,psto_required,psto_request,psto_request_date,psto_date,psto_result,
      tvmt_request,tvmt_request_date,tvmt_result,tvmt_conclusion_date,tvmt_conclusion)
      select $1,'PSTO-READ','PSTO-READ-'||lpad(((n-1)/5000+1)::text,2,'0'),
        case when n%20=0 then 'F'||lpad((n-1)::text,6,'0')||'R1' else 'F'||lpad(n::text,6,'0') end,
        lpad(n::text,6,'0'),'2026-06-01','С17',
        case when n%20=0 then 245 else 114 end,case when n%20=0 then 12 else 6 end,
        case when n%20=0 then 99 else 7 end,'да','PRIMARY-PSTO-'||n,
        '2026-07-01'::date+((n-1)/20)%28,'2026-07-01'::date+((n-1)/20)%28,'проведено',
        'PRIMARY-TVMT-'||n,'2026-07-02'::date+((n-1)/20)%28,'не годен',
        '2026-07-03'::date+((n-1)/20)%28,'PRIMARY-CON-'||n
      from generate_series(1,200000) n`, [project])
    // Exactly 5% of joints have repeats. Two repeats catch choosing the first
    // repeat instead of the current one; 20k relation rows exceed any page.
    // Primary dates increase, while current dates decrease within each 28-cycle
    // block. Sorting stored primary dates therefore cannot accidentally pass.
    await db.query(`insert into psto_repeat_cycles(weld_joint_id,sequence,psto_request,psto_request_date,
      psto_date,psto_result,tvmt_request,tvmt_request_date,tvmt_result,tvmt_conclusion_date,tvmt_conclusion)
      select id,sequence,'REPEAT-PSTO-'||isometry::int||'-'||sequence,
        cycle_date,cycle_date,'проведено','REPEAT-TVMT-'||isometry::int||'-'||sequence,cycle_date+1,
        case when sequence=3 then 'годен' else 'не годен' end,cycle_date+2,
        'REPEAT-CON-'||isometry::int||'-'||sequence
      from weld_joints cross join generate_series(2,3) sequence
      cross join lateral (select case when sequence=2 then '2026-08-01'::date+((isometry::int-1)/20)%28
        else '2026-09-28'::date-((isometry::int-1)/20)%28 end as cycle_date) cycle
      where project_title=$1 and isometry::int%20=0`, [project])
    // One project-scoped scan and sort. Joining 200k rows to the same table by
    // an unindexed ordinal can choose a quadratic plan before ANALYZE. IDs
    // need not be contiguous: the previous fixture ordinal supplies the root.
    await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id,source_row_id)
      select id,case when n%$2=0 then 'repair' else 'primary' end,
        case when n%$2=0 then previous_id else id end,
        case when n%$2=0 then previous_id else null end
      from (
        select id,isometry::int n,lag(id) over(order by isometry) previous_id
        from weld_joints where project_title=$1
      ) fixture`, [project, repeatEvery])
  })
  const expected = await withE2eDatabase(async db => {
    const [counts] = (await db.query<{ total: number; welded: number; repeats: number; states: number; invalidPrimary: number }>(`select count(*)::int total,
      count(w.weld_date)::int welded,count(*) filter(where w.isometry::int%$2=0)::int repeats,
      count(s.weld_joint_id)::int states,
      count(*) filter(where w.isometry::int%$2<>0 and
        (s.physical_root_id is distinct from w.id or s.source_row_id is not null or s.kind is distinct from 'primary'))::int as "invalidPrimary"
      from weld_joints w left join weld_joint_program_states s on s.weld_joint_id=w.id
      where w.project_title=$1`, [project, repeatEvery])).rows
    expect(counts).toEqual({ total: fixtureSize, welded: fixtureSize, repeats: fixtureSize / repeatEvery,
      states: fixtureSize, invalidPrimary: 0 })
    for (const table of ['weld_joints', 'psto_repeat_cycles', 'weld_joint_program_states']) await db.query(`analyze ${table}`)
    // Read only identities/cycle IDs for output rows, all repeats and their
    // primary predecessors. Expected roots come from ordinal n-1, independently
    // of program state and of the report's SQL; no 200k application hydration.
    const seeds = (await db.query<SeedRow>(`select w.id,w.isometry::int n,
      s.physical_root_id as "physicalRootId",s.source_row_id as "sourceRowId",s.kind,
      array(select c.id from psto_repeat_cycles c where c.weld_joint_id=w.id order by c.sequence) as "cycleIds"
      from weld_joints w join weld_joint_program_states s on s.weld_joint_id=w.id
      where w.project_title=$1 and (w.isometry::int<=$2 or w.isometry::int%$3 in (0,$3-1))
      order by w.isometry`, [project, outputSize, repeatEvery])).rows
    const idsByOrdinal = new Map(seeds.map(row => [row.n, row.id]))
    const selected = seeds.filter(row => row.n <= outputSize || row.n % repeatEvery === 0)
    const result: ExpectedRow[] = selected.map(row => ({ id: row.id, n: row.n,
      rootId: row.n % repeatEvery === 0 ? idsByOrdinal.get(row.n - 1)! : row.id, cycleIds: row.cycleIds }))
    expect(result.every(row => Number.isSafeInteger(row.rootId))).toBe(true)
    expect(selected.map(row => [row.id, row.kind, row.physicalRootId, row.sourceRowId]))
      .toEqual(result.map(row => [row.id, row.n % repeatEvery === 0 ? 'repair' : 'primary', row.rootId,
        row.n % repeatEvery === 0 ? row.rootId : null]))
    return result
  })
  const byNumber = new Map(expected.map(row => [row.n, row]))
  const repeats = expected.filter(row => row.n % repeatEvery === 0)
  expect(repeats).toHaveLength(fixtureSize / repeatEvery)
  expect(repeats.every(row => row.cycleIds.length === 2 && row.rootId !== row.id)).toBe(true)

  const { listReportPage, normalizeWeldPageRequest } = await import('../../src/server/weld-read')
  const { ensureDispatcherTaskIndexFresh, isDispatcherTaskIndexFresh } = await import('../../src/server/dispatcher-task-index')
  const { loadServerOtherSettings } = await import('../../src/server/weld-server-shared')
  // Fixture invalidation legitimately requires a dispatcher refresh. Finish it
  // before measuring the changed read boundary, rather than hiding a background
  // rebuild among page queries or pretending the stored index is current.
  const publishedDispatcher = await ensureDispatcherTaskIndexFresh()
  expect(isDispatcherTaskIndexFresh(publishedDispatcher)).toBe(true)
  const settings = await loadServerOtherSettings()
  const rootWdi = isSystemWdiMode(settings)
    ? calculateWdi({ connectionType: 'С17', d1: '114', t1: '6', d2: null, t2: null }, settings)
    : 7

  const prototype = pg.Client.prototype, original = prototype.query
  let statements: Statement[] = []
  prototype.query = function (this: unknown, ...args: unknown[]) {
    type Callback = (error: Error | null | undefined, reply?: pg.QueryResult) => unknown
    const config = args[0] as string | { text?: string; values?: unknown[]; callback?: Callback }
    const sql = typeof config === 'string' ? config : config.text ?? ''
    const statement: Statement = {
      sql, table: /\bfrom\s+"?(\w+)"?/i.exec(sql)?.[1] ?? 'other',
      parameters: Array.isArray(args[1]) ? args[1] : typeof config === 'object' ? config.values ?? [] : [],
      rows: null, fields: [],
    }
    statements.push(statement)
    const capture = (reply: pg.QueryResult) => {
      statement.rows = reply.rowCount ?? 0
      statement.fields = reply.fields.map(field => field.name)
    }
    const observeCallback = (callback: Callback): Callback => function (this: unknown, error, reply) {
      if (reply) capture(reply)
      return callback.call(this, error, reply)
    }
    // pg.Pool resolves promises through Client's callback API.
    if (typeof args[2] === 'function') args[2] = observeCallback(args[2] as Callback)
    else if (typeof args[1] === 'function') args[1] = observeCallback(args[1] as Callback)
    else if (typeof config === 'object' && typeof config.callback === 'function') {
      args[0] = { ...config, callback: observeCallback(config.callback) }
    }
    const result = (original as (...args: unknown[]) => unknown).apply(this, args)
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      return (result as Promise<pg.QueryResult>).then(reply => { capture(reply); return reply })
    }
    return result
  } as typeof original

  const measurements: Array<{ name: string; returned: number; statements: number; bytes: number; elapsedMs: number;
    reads: Array<{ table: string; rows: number | null; fields: number; parameterArraySizes: number[] }> }> = []
  let pageStatementCount: number | undefined
  const assertFacts = (rows: WeldRow[], selection: ExpectedRow[]) => {
    expect(rows.map(row => row.id)).toEqual(selection.map(row => row.id))
    // Keep every fact check, without creating tens of thousands of individual
    // Playwright trace steps (their parent lookup dominates this load test).
    rows.forEach((row, index) => {
      const fact = selection[index]!, hasRepeat = fact.n % repeatEvery === 0
      assert.equal(row.projectTitle, project)
      assert.equal(row.weldDate, '2026-06-01')
      // Current display fields may be projected for SQL, but stored primary
      // fields and both repeat cycles must survive for workflows and export.
      assert.deepEqual([row.pstoDate, row.tvmtResult, row.tvmtConclusionDate, row.tvmtConclusion], [
        primaryDate(fact.n), 'не годен', primaryDate(fact.n, 2), `PRIMARY-CON-${fact.n}`,
      ])
      assert.deepEqual(row.pstoRepeatCycles?.map(cycle => ({ id: cycle.id, sequence: cycle.sequence,
        pstoDate: cycle.pstoDate, tvmtResult: cycle.tvmtResult, tvmtConclusionDate: cycle.tvmtConclusionDate })),
        hasRepeat ? fact.cycleIds.map((id, cycleIndex) => ({ id, sequence: cycleIndex + 2,
          pstoDate: repeatDate(fact.n, cycleIndex + 2), tvmtResult: cycleIndex === 1 ? 'годен' : 'не годен',
          tvmtConclusionDate: repeatDate(fact.n, cycleIndex + 2, 2) })) : undefined)
      assert.equal(getPstoDisplayValue(row, 'tvmtResult'), hasRepeat ? 'годен' : 'не годен')
      assert.equal(getPstoDisplayValue(row, 'tvmtConclusionDate'), hasRepeat ? repeatDate(fact.n, 3, 2) : primaryDate(fact.n, 2))
      assert.deepEqual(row.programChainState, { weldJointId: fact.id, kind: hasRepeat ? 'repair' : 'primary',
        physicalRootId: fact.rootId, sourceRowId: hasRepeat ? fact.rootId : null,
        coilParentId: null, coilSide: null, replacedByCoil: false, replacementCoilIds: [] })
      assert.deepEqual(row.groupPhysicalRoot, { id: fact.rootId, exists: true, replaced: false, wdi: rootWdi })
    })
  }

  const measure = async (name: string, request: WeldPageRequest, selection: ExpectedRow[], expectedTotal?: number) => {
    statements = []
    const start = performance.now()
    const result = await listReportPage('heatTreatment', normalizeWeldPageRequest({
      projectTitle: project, page: 1, pageSize: 100, includeTotals: false,
      sort: { fieldKey: 'isometry', direction: 'asc' }, ...request,
    }))
    const elapsedMs = Math.round(performance.now() - start)
    measurements.push({ name, returned: result.rows.length, statements: statements.length,
      bytes: Buffer.byteLength(JSON.stringify(result)), elapsedMs,
      reads: statements.map(statement => ({ table: statement.table, rows: statement.rows, fields: statement.fields.length,
        parameterArraySizes: statement.parameters.filter(Array.isArray).map(value => value.length) })) })
    assertFacts(result.rows, selection)
    expect(result.total).toBe(expectedTotal)
    const count = selection.length, ids = selection.map(row => row.id).sort((a, b) => a - b)
    const extraRead = request.pageSize === 'all' || request.includeTotals === true ? 1 : 0
    pageStatementCount ??= statements.length - extraRead
    expect(statements.length, `${name}: count must not grow with page or repeat population`).toBe(pageStatementCount + extraRead)
    // One source read, settings/index reads and fixed relation families. This
    // budget is independent of the 200k source, page length and repeat count.
    expect(statements.length).toBeLessThanOrEqual(14)
    expect(statements.every(statement => statement.rows !== null)).toBe(true)
    const stateReads = statements.filter(statement => /^\s*with "inserted_state" as/i.test(statement.sql))
    expect(stateReads).toHaveLength(1)
    expect(stateReads[0]!.sql).toMatch(/on conflict \("id"\) do nothing/i)
    expect(statements.filter(statement => !stateReads.includes(statement)).every(statement => /^\s*select\b/i.test(statement.sql))).toBe(true)

    // Inspect database-returned rows, not just the final JavaScript slice.
    // Derived/global hydration would fail even if the returned page looked right.
    const sourceReads = statements.filter(statement => ['weld_date', 'psto_required', 'tvmt_result']
      .every(field => statement.fields.includes(field)))
    expect(sourceReads, `${name}: exactly one full-row source query`).toHaveLength(1)
    expect(sourceReads[0]!.rows).toBeGreaterThanOrEqual(count)
    expect(sourceReads[0]!.rows).toBeLessThanOrEqual(count + (request.pageSize === 'all' || request.includeTotals ? 0 : 1))
    const repeatReads = statements.filter(statement => statement.table === 'psto_repeat_cycles')
    expect(repeatReads).toHaveLength(1)
    expect(repeatReads[0]!.rows).toBe(selection.filter(row => row.n % repeatEvery === 0).length * 2)
    const groupReads = statements.filter(statement => statement.sql.includes('"journal_physical_root"'))
    expect(groupReads).toHaveLength(1)
    expect(groupReads[0]!.rows).toBe(count)
    const metadataReads = [...repeatReads]
    for (const [table, readsPerPage, expectedRows] of [
      ['duplicate_controls', 1, 0], ['pre_heat_treatment_controls', 1, 0],
      ['weld_joint_program_states', 2, count], ['generated_document_weld_joints', 1, 0],
    ] as const) {
      const reads = statements.filter(statement => statement.table === table)
      expect(reads, `${name}: ${table} queries`).toHaveLength(readsPerPage)
      expect(reads.every(read => read.rows === expectedRows), `${name}: ${table} database rows`).toBe(true)
      metadataReads.push(...reads)
    }
    for (const read of metadataReads) {
      expect(read.sql).toMatch(/= any\(\$\d+::integer\[\]\)/)
      const arrays = read.parameters.filter(Array.isArray)
      expect(arrays).toHaveLength(1)
      expect([...(arrays[0] as number[])].sort((a, b) => a - b)).toEqual(ids)
    }
    const taskReads = statements.filter(statement => statement.table === 'dispatcher_row_tasks')
    expect(taskReads).toHaveLength(1)
    const taskScopes = taskReads[0]!.parameters.filter(Array.isArray)
    expect(taskScopes).toHaveLength(2) // active/background branches of one query
    for (const scope of taskScopes) expect([...(scope as number[])].sort((a, b) => a - b)).toEqual(ids)
    return result
  }

  try {
    // Page sizes are 100/300/500/1000. Select one actual record through an exact
    // source filter rather than inventing an unsupported pageSize=1 contract.
    const singleton = await measure('one repair; physical root outside page', {
      columnFilters: { isometry: buildWeldColumnValueFilter(['000020']) },
    }, [byNumber.get(20)!])
    expect(singleton.hasMore).toBe(false)
    expect(singleton.rows.some(row => row.id === singleton.rows[0]!.groupPhysicalRoot!.id)).toBe(false)
    for (const pageSize of [100, 1000] as const) {
      const page = await measure(`ordinary page ${pageSize}`, { pageSize }, expected.filter(row => row.n <= pageSize))
      expect(page.hasMore).toBe(true)
    }
    const nextPage = await measure('ordinary second page 1000', { page: 2, pageSize: 1000 },
      expected.filter(row => row.n > 1000 && row.n <= 2000))
    expect(nextPage.hasMore).toBe(true)
    const totals = await measure('ordinary page with total', { includeTotals: true }, expected.filter(row => row.n <= 100), fixtureSize)
    expect(totals.hasMore).toBe(true)

    const goodFilter = { tvmtResult: buildWeldColumnValueFilter(['годен']) }
    const good = await measure('current good; primary and first repeat bad', { pageSize: 1000, columnFilters: goodFilter }, repeats.slice(0, 1000))
    expect(good.hasMore).toBe(true)
    await measure('current good total', { columnFilters: goodFilter, includeTotals: true }, repeats.slice(0, 100), fixtureSize / repeatEvery)
    const bad = expected.filter(row => row.n % repeatEvery !== 0).slice(0, 1000)
    await measure('current bad excludes successful repeats', { pageSize: 1000,
      columnFilters: { tvmtResult: buildWeldColumnValueFilter(['не годен']) } }, bad)
    for (const direction of ['asc', 'desc'] as const) {
      const ordered = [...repeats].sort((left, right) =>
        (direction === 'asc' ? -1 : 1) * (dayOffset(left.n) - dayOffset(right.n)) || left.n - right.n).slice(0, 1000)
      expect(dayOffset(ordered[0]!.n)).toBe(direction === 'asc' ? 27 : 0)
      await measure(`current TVMT date ${direction}; reverse primary dates`, { pageSize: 1000,
        columnFilters: goodFilter, sort: { fieldKey: 'tvmtConclusionDate', direction } }, ordered)
    }
    const output = await measure('bounded current-version output 5000', { pageSize: 'all', line: 'PSTO-READ-01' },
      expected.filter(row => row.n <= outputSize), outputSize)
    expect(output.hasMore).toBe(false)
    const contextMeasurements = []
    for (const size of [1, 100, 500]) {
      const rowIds = expected.slice(-size).map(row => row.id)
      statements = []
      const started = performance.now()
      const context = await loadDispatcherTaskContext(normalizeDispatcherTaskContextRequest({ mode: 'rows', rowIds,
        computedRevision: publishedDispatcher.computedRevision }))
      const reads = statements.filter(statement => /^\s*(select|with)\b/i.test(statement.sql))
      expect(reads).toHaveLength(3) // state, requested identities by PK, matching scoped task cards
      expect(reads.find(statement => statement.table === 'weld_joints')?.rows).toBe(size)
      expect(statements.some(statement => /\b(update|insert|delete)\s+/i.test(statement.sql))).toBe(false)
      expect(reads[2].sql).toContain('"dispatcher_task_pages"."scope_key" in')
      contextMeasurements.push({ rows: size, sql: reads.length, tasks: context.tasks.length,
        bytes: Buffer.byteLength(JSON.stringify(context)), ms: Math.round(performance.now() - started) })
    }
    console.info('Dispatcher contexts on 200k joints:', JSON.stringify(contextMeasurements))
    await info.attach('dispatcher-context-200k.json', { body: JSON.stringify(contextMeasurements), contentType: 'application/json' })
    console.info(JSON.stringify({ workflow: 'psto-page-read-200k',
      measurements: measurements.map(({ name, returned, statements, bytes, elapsedMs }) => ({ name, returned, statements, bytes, elapsedMs })) }))
  } finally {
    prototype.query = original
    await info.attach('psto-page-read-query-counts', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' })
  }
})
