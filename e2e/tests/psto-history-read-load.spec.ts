import { expect, test } from '@playwright/test'
import pg from 'pg'
import { writeFile } from 'node:fs/promises'
import { listPstoWorkflowRows, getPstoWorkflowSummary } from '../../src/server/psto-workflow-context'
import { assertSafeE2eDatabaseUrl, withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { asE2eOwner } from '../with-owner-access'

const project = 'E2E PSTO history 200k'
const read = asE2eOwner(listPstoWorkflowRows, 'psto.view')
const summary = asE2eOwner(getPstoWorkflowSummary, 'psto.view')
test.afterEach(() => cleanupLineProgramProjects([project]))

test('200k: request-only, partial and cancelled history stays bounded and searchable across repeat cycles', async ({}, info) => {
  test.setTimeout(180_000)
  assertSafeE2eDatabaseUrl(process.env.DATABASE_URL ?? '')
  const before = await summary()
  await withLineProgramFixture(async db => {
    await db.query(`insert into weld_joints
      (project_title,line,joint,weld_date,connection_type,psto_required,psto_request,psto_request_date,psto_result)
      select $1,'HISTORY-SCALE','F'||lpad(n::text,6,'0'),'2026-09-01','С17',
        case when n%5=4 then 'отменен' else 'да' end,
        case when n%5 in (0,4) then 'PRIMARY-'||n end,
        case when n%5 in (0,2,4) then '2026-09-02'::date end,'ожидает'
      from generate_series(1,200000) n`, [project])
    // Two repeats, with no primary request: search must include an older cycle
    // and must not depend on having a result in any cycle.
    await db.query(`insert into psto_repeat_cycles(weld_joint_id,sequence,psto_request,psto_request_date)
      select id,sequence,'REPEAT-'||joint||'-'||sequence,'2026-09-03'
      from weld_joints cross join generate_series(2,3) sequence
      where project_title=$1 and substring(joint from 2)::int%5=1`, [project])
    await db.query('analyze weld_joints')
    await db.query('analyze psto_repeat_cycles')
  })
  // Four of five independent cases have real history. A waiting label alone
  // is not a saved request; cancellation does not erase a saved request.
  expect((await summary()).resultRegistryCount - before.resultRegistryCount).toBe(160_000)
  const samples: Array<{ limit: number; count: number; milliseconds: number; bytes: number }> = []
  for (const limit of [1, 500, 1000]) {
    const original = pg.Client.prototype.query
    const statements: string[] = []
    pg.Client.prototype.query = function (this: pg.Client, ...args: unknown[]) {
      const query = args[0] as string | { text: string }
      statements.push(typeof query === 'string' ? query : query.text)
      return (original as (...args: unknown[]) => unknown).apply(this, args)
    } as typeof original
    const start = performance.now()
    try {
      const rows = await read({ scope: 'resultRegistry', search: project, limit })
      expect(rows).toHaveLength(limit)
      expect(rows.every(row => Number(String(row.joint).slice(1)) % 5 !== 3)).toBe(true)
      expect(rows.every(row => !row.pstoDate && !row.heatTreatmentDiagram)).toBe(true)
      expect(statements.filter(sql => !/^\s*select\b/i.test(sql)).map(sql => sql.trim().toLowerCase()))
        .toEqual(['begin isolation level repeatable read read only', 'commit'])
      expect(statements.length).toBeLessThanOrEqual(12)
      const source = statements.filter(sql => sql.includes('from "weld_joints"') && sql.includes('"connection_type"'))
      expect(source).toHaveLength(1)
      expect(source[0]).toMatch(/\blimit\b/i)
      samples.push({ limit, count: statements.length, milliseconds: Math.round(performance.now() - start), bytes: Buffer.byteLength(JSON.stringify(rows)) })
    } finally {
      pg.Client.prototype.query = original
    }
  }
  expect(new Set(samples.map(sample => sample.count)).size).toBe(1)
  for (const sequence of [2, 3]) {
    const rows = await read({ scope: 'resultRegistry', search: `REPEAT-F199996-${sequence}`, limit: 500 })
    expect(rows).toHaveLength(1)
    expect(rows[0].joint).toBe('F199996')
    expect(rows[0].pstoRepeatCycles?.map(cycle => cycle.sequence)).toEqual([2, 3])
  }
  expect(await read({ scope: 'resultRegistry', search: 'F199998', limit: 500 })).toEqual([])
  const cancelled = await read({ scope: 'resultRegistry', search: 'PRIMARY-199999', limit: 500 })
  expect(cancelled).toHaveLength(1)
  expect(cancelled[0]).toMatchObject({ joint: 'F199999', pstoRequired: 'отменен', pstoRequest: 'PRIMARY-199999' })
  expect((await withE2eDatabase(db => db.query(`select count(*)::int n from weld_joints
    where project_title=$1 and (psto_date is not null or heat_treatment_diagram is not null)`, [project]))).rows[0].n).toBe(0)
  console.log('PSTO_HISTORY_READ_COUNTS', JSON.stringify(samples))
  await writeFile(info.outputPath('history-read-counts.json'), JSON.stringify(samples, null, 2))
})
