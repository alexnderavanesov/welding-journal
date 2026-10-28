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
  pg.Client.prototype.query = function (this: pg.Client, ...args: unknown[]) {
    statements++
    return (original as (...args: unknown[]) => unknown).apply(this, args)
  } as typeof original
  const statsStart = performance.now()
  try {
    const result = await computeStatisticsServerResult({ tab: 'lineSummary', projectFilter: project.toLowerCase(), unit: 'joints' })
    expect(result.lineSummary.total).toBe(50_000)
    expect(result.lineSummary.completed).toBe(50_000)
    // Five SELECTs plus transaction begin/commit; no read for each chain.
    expect(statements).toBeLessThanOrEqual(8)
  } finally { pg.Client.prototype.query = original }
  const measurements = { calculationMs, statisticsMs: Math.round(performance.now() - statsStart), statements, codes, warning }
  console.log('CHAIN_SCALE_INTEGRITY', JSON.stringify(measurements))
  await writeFile(info.outputPath('chain-scale-integrity.json'), JSON.stringify(measurements, null, 2))
})
