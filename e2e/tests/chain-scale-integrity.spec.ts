import { expect, test } from '@playwright/test'
import pg from 'pg'
import { writeFile } from 'node:fs/promises'
import { ensureDispatcherTaskIndexFresh } from '../../src/server/dispatcher-task-index'
import { computeStatisticsServerResult } from '../../src/server/statistics'
import { withE2eDatabase } from '../database'

test('200k mixed chains: completed coil pairs replace their roots without false continuation tasks', async ({}, info) => {
  test.skip(process.env.AUDIT_CHAIN_SCALE !== '1', 'Requires the owned mixed-chain background')
  test.setTimeout(300_000)
  const project = 'E2E chain-scale background'
  const start = performance.now()
  await ensureDispatcherTaskIndexFresh()
  const calculationMs = Math.round(performance.now() - start)
  const codes = await withE2eDatabase(async db => (await db.query(`select t.code,count(*)::int n
    from dispatcher_row_tasks t join weld_joints w on w.id=t.weld_joint_id
    where w.project_title=$1 group by t.code order by t.code`, [project])).rows)
  // Each eight-record history has four rejected S/R/W records (the existing
  // automatic-coil threshold), two welded coil sides and their good repairs.
  // A three-rejection fixture would require an explicit early-coil decision;
  // treating its warning as false would incorrectly weaken the business guard.
  // Every line deliberately has zero quota but 50 explicitly assigned physical
  // controls. Its excess-assignment warning is valid and must remain visible.
  expect(codes.filter(row => ['СП-07', 'СП-09'].includes(row.code))).toEqual([])
  const warning = await withE2eDatabase(async db => (await db.query(`select
    task->>'kind' kind,task->>'issue' issue,(task->>'assignedControls')::int assigned,
    (task->>'requiredControls')::int required,count(*) over()::int warnings
    from dispatcher_task_pages cross join lateral jsonb_array_elements(tasks::jsonb) task
    where task->>'projectTitle'=$1 limit 1`, [project])).rows[0])
  expect(warning).toEqual({ kind: 'percentage-line-control', issue: 'excess', assigned: 50, required: 0, warnings: 1000 })
  const original = pg.Client.prototype.query
  let statements = 0
  const sqlCalls: { sql: string; startedMs: number; client: number; callsite: string[] }[] = []
  const clients = new WeakMap<pg.Client, number>()
  let nextClient = 0
  const statsStart = performance.now()
  pg.Client.prototype.query = function (this: pg.Client, ...args: unknown[]) {
    statements++
    if (!clients.has(this)) clients.set(this, ++nextClient)
    const query = args[0]
    // Record SQL shape only: never capture parameter values or query objects.
    const text = typeof query === 'string' ? query
      : query && typeof query === 'object' && 'text' in query && typeof query.text === 'string' ? query.text : '<non-text query>'
    sqlCalls.push({ sql: text.replace(/\s+/g, ' ').trim(), startedMs: Math.round(performance.now() - statsStart),
      client: clients.get(this)!, callsite: (new Error().stack ?? '').split('\n').slice(1)
        .filter(line => !line.includes('node_modules')).slice(0, 5).map(line => line.trim()) })
    return (original as (...args: unknown[]) => unknown).apply(this, args)
  } as typeof original
  let result: Awaited<ReturnType<typeof computeStatisticsServerResult>> | undefined
  try {
    result = await computeStatisticsServerResult({ tab: 'lineSummary', projectFilter: project.toLowerCase(), unit: 'joints' })
  } finally {
    pg.Client.prototype.query = original
    const sqlCounts = [...sqlCalls.reduce((counts, call) => counts.set(call.sql, (counts.get(call.sql) ?? 0) + 1), new Map<string, number>())]
      .map(([sql, count]) => ({ sql, count }))
    const measurements = { calculationMs, statisticsMs: Math.round(performance.now() - statsStart), statements, codes, warning,
      totals: result && { total: result.lineSummary.total, completed: result.lineSummary.completed }, sqlCounts, sqlCalls }
    console.log('CHAIN_SCALE_INTEGRITY', JSON.stringify({ calculationMs, statisticsMs: measurements.statisticsMs, statements }))
    // Preserve evidence even when computation or a subsequent SQL-bound assertion fails.
    const path = info.outputPath('chain-scale-integrity.json')
    await writeFile(path, JSON.stringify(measurements, null, 2))
    await info.attach('chain-scale-integrity', { path, contentType: 'application/json' })
  }
  expect(result!.lineSummary.total).toBe(50_000)
  expect(result!.lineSummary.completed).toBe(50_000)
  // The November line-summary scheme coverage adds five batched reads to the
  // original five: registry + complete line settings/topology/history/members.
  // The captured 200k trace proves ten SELECTs in one read-only snapshot, not
  // auth/background traffic. Keep per-table ceilings so duplicates cannot hide
  // behind a larger total. This fixture has registered lines but no PDF bundles.
  expect(new Set(sqlCalls.map(call => call.client)).size).toBe(1)
  expect(sqlCalls[0].sql).toBe('begin isolation level repeatable read read only')
  expect(sqlCalls.at(-1)?.sql).toBe('commit')
  const reads = sqlCalls.filter(call => call.sql.startsWith('select '))
  expect(reads).toHaveLength(statements - 2)
  const limits: Record<string, number> = { weld_joints: 4, app_settings: 2,
    weld_joint_program_states: 2, line_programs: 1, line_scheme_members: 1 }
  const perTable = new Map<string, number>()
  for (const { sql } of reads) {
    const table = /\bfrom "([^"]+)"/i.exec(sql)?.[1] ?? '<unknown>'
    expect(Object.hasOwn(limits, table), `Unexpected statistics read: ${sql}`).toBe(true)
    perTable.set(table, (perTable.get(table) ?? 0) + 1)
  }
  for (const [table, count] of perTable) expect(count, `Repeated reads of ${table}`).toBeLessThanOrEqual(limits[table])
  expect(statements).toBeLessThanOrEqual(12)
})
