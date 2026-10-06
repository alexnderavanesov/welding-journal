import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from '../src/db/schema.ts'

// This script deliberately does not load .env or provide a fallback database.
const url = new URL(process.env.DATABASE_URL ?? '')
if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !/^\/welding_tracker_line_program_test_[a-z0-9_]+$/.test(url.pathname)) {
  throw new Error('Specify an isolated local welding_tracker_line_program_test_* database explicitly.')
}
process.env.WELDING_ENV_LOADED = '1'
const { transitionLinePrograms, restoreLineProgramTransition } = await import('../src/server/line-program-transition.ts')
const { loadLineProgramRows, loadLineProgramOverviews, toLineProgramRecord } = await import('../src/server/line-program.ts')
const { calculateLineProgram } = await import('../src/lib/line-program-calculation.ts')
let queryCount = 0
const pool = new pg.Pool({ connectionString: url.toString(), max: 1, allowExitOnIdle: true })
const db = drizzle(pool, { schema, logger: { logQuery: () => { queryCount++ } } })
const initial = await db.execute(sql`select current_database() as name,
  (select count(*)::integer from weld_joints) as welds,
  (select count(*)::integer from line_programs) as programs,
  (select count(*)::integer from line_program_transition_backups) as backups`)
assert.equal(initial.rows[0].name, url.pathname.slice(1))
assert.deepEqual([initial.rows[0].welds, initial.rows[0].programs, initial.rows[0].backups], [0, 0, 0], 'Test DB must initially contain no user data')
const rollback = new Error('intentional synthetic data rollback')
let measurements: Record<string, unknown> = {}
try {
  await db.transaction(async (tx) => {
    await tx.execute(sql`insert into weld_joints (id, project_title, subtitle_code, line, joint, connection_type, weld_date, category, group_name, weld_control_percent, has_vik, stamp_1_k)
      values (-1, 'TEST', 'A', 'L1', 'F1', 'СШ', '2026-09-01', 'II', 'A', 10, 'отменен', 'A'),
        (-2, 'TEST', 'A', 'L1', 'F1R1', 'СШ', '2026-09-02', 'II', 'A', 10, null, 'B'),
        (-3, 'TEST', 'A', 'L2', 'F2', 'УШ', '2026-09-03', 'II', 'A', 25, null, 'A'),
        (-4, 'TEST', 'A', 'L2', 'F3', 'УШ', '2026-09-04', 'III', 'B', 50, null, 'B')`)
    await tx.execute(sql`update weld_joints set rk_result = 'ремонт' where id in (-1, -2)`)
    await tx.execute(sql`insert into generated_documents (id, type, title, file_name, mime_type, document_number, source_metadata)
      values (-1, 'layeredVikEdges', 'legacy', 'legacy.xlsx', 'application/x-test', 75, ${JSON.stringify({ kind: 'layeredControl', version: 1 })}),
        (-2, 'layeredPvkLayers', 'explicit', 'explicit.xlsx', 'application/x-test', 76, ${JSON.stringify({ kind: 'layeredControl', version: 2 })}),
        (-3, 'lnkConclusion', 'ordinary', 'ordinary.xlsx', 'application/x-test', 77, null),
        (-4, 'layeredPvkEdges', 'protected legacy', 'protected.xlsx', 'application/x-test', 78, ${JSON.stringify({ kind: 'layeredControl', version: 1 })})`)
    await tx.execute(sql`update weld_joints set layered_control_assigned = true where id = -4`)
    await tx.execute(sql`insert into generated_document_weld_joints (document_id, weld_joint_id) values (-1, -3), (-2, -3), (-3, -3), (-4, -4)`)
    const started = performance.now()
    assert.equal((await transitionLinePrograms(tx)).skipped, false)
    assert.equal((await transitionLinePrograms(tx)).skipped, true)
    const registry = await tx.execute(sql`select line, category, group_name, weld_control_percent, pvk_control_percent, configuration_issue from line_programs order by line`)
    assert.equal(Number(registry.rows[0].pvk_control_percent), 10)
    assert.equal(registry.rows[1].category, null)
    assert.equal(registry.rows[1].weld_control_percent, null)
    assert.match(String(registry.rows[1].configuration_issue), /СП-02/)
    const documents = await tx.execute(sql`select id from generated_documents order by id`)
    assert.deepEqual(documents.rows.map((row) => row.id), [-4, -3, -2])
    const rows = await loadLineProgramRows(tx, { projectTitle: 'TEST', subtitleCode: 'A', line: 'L1' })
    const calculation = calculateLineProgram(rows, 10, 10)
    assert.equal(calculation.find((stamp) => stamp.stamp === 'A')!.rejectedRowIds.length, 1)
    // Latest agreement: an R/W repair is work by B, but neither a new physical
    // connection nor a source of percentage surcharge for that repairer.
    assert.equal(calculation.some((stamp) => stamp.stamp === 'B'), false)
    await tx.transaction(async (savepoint) => {
      await savepoint.execute(sql`update weld_joints set updated_at = updated_at + interval '1 second' where id = -1`)
      await assert.rejects(() => restoreLineProgramTransition(savepoint), /После перехода данные изменились/)
      await savepoint.execute(sql`update weld_joints set updated_at = updated_at - interval '1 second' where id = -1`)
    })
    await tx.transaction(async (savepoint) => {
      await savepoint.execute(sql`update generated_document_weld_joints set weld_joint_id = -2 where document_id = -4`)
      await assert.rejects(() => restoreLineProgramTransition(savepoint), /Связи резервных документов изменились/)
      await savepoint.execute(sql`update generated_document_weld_joints set weld_joint_id = -4 where document_id = -4`)
    })
    assert.equal((await restoreLineProgramTransition(tx)).skipped, false)
    assert.equal((await restoreLineProgramTransition(tx)).skipped, true)
    const restored = await tx.execute(sql`select (select count(*)::integer from generated_documents) as documents,
      (select count(*)::integer from generated_document_weld_joints) as links,
      (select count(*)::integer from line_programs) as programs,
      (select has_vik from weld_joints where id = -1) as vik`)
    assert.deepEqual(restored.rows[0], { documents: 4, links: 4, programs: 0, vik: 'отменен' })
    measurements = { transitionAndRestoreMs: Math.round(performance.now() - started), cases: 'conflicts, initial PVK, VIK normalization, versioned document cleanup, explicit legacy protection, no repair percentage contribution, idempotency, guarded row and document-link restoration' }
    throw rollback
  })
} catch (error) { if (error !== rollback) throw error }
console.log(JSON.stringify({ database: url.pathname.slice(1), rollback: true, ...measurements }))

if (process.argv.includes('--scale')) {
  for (const count of [200, 200_000]) {
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`insert into weld_joints (id, project_title, subtitle_code, line, joint, connection_type, weld_date, category, group_name, weld_control_percent, stamp_1_k)
          select n, 'SCALE', 'A', 'L' || ((n - 1) / 200)::text, 'F' || n::text, 'СШ', '2026-09-01', 'II', 'A', 10, 'STAMP'
          from generate_series(1, ${count}::integer) n`)
        const transitionStart = performance.now()
        const beforeTransition = queryCount
        await transitionLinePrograms(tx)
        const transitionQueries = queryCount - beforeTransition
        const transitionMs = Math.round(performance.now() - transitionStart)
        const readStart = performance.now()
        const beforeRead = queryCount
        const rows = await loadLineProgramRows(tx, { projectTitle: 'SCALE', subtitleCode: 'A', line: 'L0' })
        const readQueries = queryCount - beforeRead
        assert.equal(rows.length, 200)
        assert.equal(readQueries, 6, 'One line uses six batched reads including persisted chain identity, independent of journal size')
        const calculated = calculateLineProgram(rows, 10, 10)
        assert.equal(calculated[0].common.required, 20)
        assert.equal(calculated[0].pvk.required, 20)
        const programs = (await tx.select().from(schema.linePrograms).limit(30)).map(toLineProgramRecord)
        const overviewStart = performance.now()
        const beforeOverview = queryCount
        const overview = await loadLineProgramOverviews(tx, programs)
        const overviewQueries = queryCount - beforeOverview
        assert.equal(overviewQueries, 8, 'Overview batches chain identity, settings and decisions across all lines, never per card')
        assert.equal(overview.length, Math.min(30, count / 200))
        for (const item of overview) {
          assert.equal(item.overview.joints, 200)
          assert.equal(item.overview.common!.required, 20)
          assert.equal(item.overview.pvk!.required, 20)
        }
        const beforeEmpty = queryCount
        assert.deepEqual(await loadLineProgramOverviews(tx, []), [])
        assert.equal(queryCount, beforeEmpty, 'Empty registry page must not query any welds')
        console.log(JSON.stringify({ overviewLines: programs.length, overviewQueries, overviewMs: Math.round(performance.now() - overviewStart), responseBytes: Buffer.byteLength(JSON.stringify(overview)) }))
        console.log(JSON.stringify({ welds: count, transitionQueries, transitionMs, lineReadQueries: readQueries, lineReadAndCalculationMs: Math.round(performance.now() - readStart), rollback: true }))
        throw rollback
      })
    } catch (error) { if (error !== rollback) throw error }
  }
}
await pool.end()
