import assert from 'node:assert/strict'
import pg from 'pg'
import { eq, sql } from 'drizzle-orm'
import { LNK_METHODS } from '../src/lib/lnk-report-config'
import { buildOwnLnkBackfillWhere } from '../src/server/lnk-system-order-sql'
import { buildNumberArrayMatch } from '../src/server/weld-request-utils'
import { assertJointChainRowsCanBeDeleted, buildRetainedChainDescendantsQuery } from '../src/server/joint-chain-deletion'
import { lockWeldLineMemberships } from '../src/server/weld-line-membership-lock'
import { computeStatisticsServerResult } from '../src/server/statistics'

const url = new URL(process.env.DATABASE_URL ?? '')
assert.equal(url.hostname, '127.0.0.1')
assert.equal(url.pathname, '/welding_tracker_e2e')
assert.equal(process.env.WELDING_ENV_LOADED, '1')
const [{ requireDb }, { linePrograms, weldJoints }, { loadLineProgramOverviews, toLineProgramRecord }] = await Promise.all([
  import('../src/db/index'), import('../src/db/schema'), import('../src/server/line-program'),
])
const db = requireDb()
const client = new pg.Client({ connectionString: url.toString() })
await client.connect()
const project = 'E2E unified load 200k'
assert.equal((await db.select({ id: linePrograms.id }).from(linePrograms).where(eq(linePrograms.projectTitle, project))).length, 0)
const original = pg.Client.prototype.query
let statements = 0
let deletionTimings: Array<{ milliseconds: number; statement: string }> | undefined
try {
  await client.query(`insert into line_programs (project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
    select $1,'LOAD','LOAD-'||n,'II','A',10,10 from generate_series(1,1000) n`, [project])
  await client.query(`insert into weld_joints (line_program_id,project_title,subtitle_code,line,joint,weld_date,connection_type,category,group_name,weld_control_percent,pvk_control_percent,has_vik,has_rk,has_pvk,stamp_1_k)
    select p.id,p.project_title,p.subtitle_code,p.line,'F'||n,date '2026-09-01','С19','II','A',10,10,'да',case when n<=25 then 'да' end,case when n<=10 then 'да' end,'K'||((n-1)/50) from line_programs p cross join generate_series(1,200) n where p.project_title=$1`, [project])
  const programs = (await db.select().from(linePrograms).where(eq(linePrograms.projectTitle, project))).map(toLineProgramRecord)
  pg.Client.prototype.query = function (this: unknown, ...args: unknown[]) {
    statements++
    const start = performance.now(), timings = deletionTimings
    const result = (original as (...args: unknown[]) => unknown).apply(this, args)
    if (timings && result && typeof (result as Promise<unknown>).then === 'function') {
      return (result as Promise<unknown>).then(value => {
        timings.push({ milliseconds: Math.round(performance.now() - start),
          statement: String(typeof args[0] === 'string' ? args[0] : (args[0] as { text: string }).text).slice(0, 180) })
        return value
      })
    }
    return result
  } as typeof original
  const results = []
  for (const count of [1, 1000]) {
    statements = 0
    const start = performance.now()
    const result = await loadLineProgramOverviews(db, programs.slice(0, count))
    assert.equal(result.length, count)
    assert.equal(result.reduce((n, line) => n + line.overview.joints, 0), count * 200)
    assert(result.every(line => line.overview.common?.required === 20 && line.overview.pvk?.required === 20))
    results.push({ lines: count, joints: count * 200, queries: statements, milliseconds: Math.round(performance.now() - start), responseBytes: Buffer.byteLength(JSON.stringify(result)) })
  }
  assert.equal(results[0].queries, results[1].queries, 'No per-line/per-row query fan-out')
  // Joints + stable identities + three history tables + process settings +
  // system indexes + approvals: eight batched reads, independent of line count.
  assert(results[1].queries <= 8)
  // Exercise the historical-candidate predicate on actual PostgreSQL rows, not
  // just generated SQL. These are this disposable benchmark's own fixtures.
  await client.query(`update weld_joints set vik_result='годен', pvk_result='годен (отменен)',
    rk_result='ремонт · назначение отменено' where project_title=$1`, [project])
  const historicalCandidates = []
  for (const count of [1, 1000]) {
    statements = 0
    const start = performance.now()
    const result = await db.execute<{ count: string }>(sql`select count(*)::text as count from ${weldJoints}
      where ${buildNumberArrayMatch(weldJoints.lineProgramId, programs.slice(0, count).map(line => line.id))}
        and ${buildOwnLnkBackfillWhere(LNK_METHODS.find(method => method.code === 'УЗК')!)}`)
    assert.equal(Number(result.rows[0].count), count * 200)
    assert.equal(statements, 1, 'The SQL predicate must not add row-wise lookups')
    historicalCandidates.push({ joints: count * 200, queries: statements, milliseconds: Math.round(performance.now() - start) })
  }
  await client.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id)
    select id,'primary',id from weld_joints where project_title=$1`, [project])
  // Select one subtitle and then the whole project through the real statistics
  // loader. Saved physical states must cost one batch, never one query per row.
  await client.query(`update weld_joints set subtitle_code='SMALL' where line_program_id=$1`, [programs[0].id])
  const statistics = []
  for (const tab of ['lineSummary', 'general'] as const) for (const count of [200, 200000]) {
    statements = 0
    const start = performance.now()
    const result = await computeStatisticsServerResult({ tab, unit: 'joints', projectFilter: project.toLowerCase(),
      selectedSubtitles: count === 200 ? ['small'] : [], from: '2026-01-01', to: '2026-12-31' })
    assert.equal((tab === 'lineSummary' ? result.lineSummary : result.generalProgressSummary).total, count)
    assert.equal(statements, tab === 'lineSummary' ? 5 : 8, 'One batched physical-state load; no control-history reads for welding-only summary')
    statistics.push({ tab, joints: count, queries: statements, milliseconds: Math.round(performance.now() - start),
      responseBytes: Buffer.byteLength(JSON.stringify(result)) })
  }
  await client.query(`update weld_joints set subtitle_code='LOAD' where line_program_id=$1`, [programs[0].id])
  const deletionChecks: Array<{ joints: number; queries: number; milliseconds: number;
    sql: Array<{ milliseconds: number; statement: string }> }> = []
  const plans: unknown[] = []
  for (const count of [1, 1000]) {
    const selected = await db.select({ id: weldJoints.id, projectTitle: weldJoints.projectTitle,
      subtitleCode: weldJoints.subtitleCode, line: weldJoints.line, joint: weldJoints.joint })
      .from(weldJoints).where(buildNumberArrayMatch(weldJoints.lineProgramId, programs.slice(0, count).map(line => line.id)))
    if (count === 1) {
      for (const analyzed of [false, true]) {
        if (analyzed) await client.query('analyze weld_joint_program_states')
        const explanation = await db.execute(sql`explain (analyze, buffers, format json) ${buildRetainedChainDescendantsQuery(selected.map(row => row.id))}`)
        type Plan = { 'Relation Name'?: string; 'Actual Loops'?: number; Plans?: Plan[] }
        const plan = (explanation.rows[0]['QUERY PLAN'] as Array<{ Plan: Plan }>)[0].Plan
        const checkReads = (node: Plan) => {
          if (node['Relation Name'] === 'weld_joints') assert.equal(node['Actual Loops'], 0,
            'No retained descendants: never scan unrelated weld rows, even before ANALYZE')
          for (const child of node.Plans ?? []) checkReads(child)
        }
        checkReads(plan)
        plans.push({ analyzed, result: explanation.rows })
      }
    }
    await db.transaction(async tx => {
      await lockWeldLineMemberships(tx, selected)
      statements = 0
      deletionTimings = []
      const start = performance.now()
      await assertJointChainRowsCanBeDeleted(tx, selected)
      assert.equal(statements, Math.ceil(count / 500) + 3, 'Scope batches plus one state/settings/ID traversal each; never per-row reads')
      deletionChecks.push({ joints: selected.length, queries: statements, milliseconds: Math.round(performance.now() - start), sql: deletionTimings })
      deletionTimings = undefined
    })
  }
  console.log(JSON.stringify({ isolated: true, results, historicalCandidates, statistics, deletionChecks, plans }))
} finally {
  pg.Client.prototype.query = original
  await db.delete(weldJoints).where(eq(weldJoints.projectTitle, project))
  await db.delete(linePrograms).where(eq(linePrograms.projectTitle, project))
  await client.end()
}
