import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { cpus, totalmem } from 'node:os'
import { performance } from 'node:perf_hooks'
import pg from 'pg'
import { eq, sql } from 'drizzle-orm'
import type { requireDb } from '../src/db'
import * as schema from '../src/db/schema'
import type { AccessIdentity } from '../src/lib/access-permissions'
import { runWithAccess } from '../src/server/access-context'
import { listActivityHistory, getActivityDetails, getActivityFilters } from '../src/server/activity-history'

export async function measureAuthenticationLoad(db: ReturnType<typeof requireDb>, owner: AccessIdentity) {
  const target = new URL(process.env.DATABASE_URL!)
  assert.equal(target.hostname, '127.0.0.1')
  assert.match(target.pathname, /^\/welding_tracker_auth_20261029_\d+$/)
  const originalQuery = pg.Client.prototype.query
  let queryCount = 0
  pg.Client.prototype.query = function(this: unknown, ...args: unknown[]) { queryCount++; return (originalQuery as (...args: unknown[]) => unknown).apply(this, args) } as typeof originalQuery
  const observations: any[] = []
  const time = async (label: string, run: () => Promise<unknown>) => {
    const before = queryCount, start = performance.now(); await run()
    return { label, ms: Math.round((performance.now() - start) * 10) / 10, sql: queryCount - before }
  }
  try {
    const actors = Array.from({ length: 25 }, (_, index) => ({ ...owner, id: randomUUID(), name: `Инженер ${index}`, email: `scale-${index}@example.test`, role: 'user' as const,
      permissions: ['welding.view', 'welding.edit', 'history.view', 'history.joint'] as AccessIdentity['permissions'], revision: 1 }))
    await db.insert(schema.authUsers).values(actors.map(actor => ({ ...actor, status: 'active' as const, emailVerified: true })))
    let total = 0
    for (const count of [20000, 200000]) {
      await db.execute(sql`insert into weld_joints (project_title, line, joint, welding_journal_note)
        select 'AUTH-SCALE', 'SCALE-' || (n / 1000)::text, 'F' || n::text, 'baseline'
        from generate_series(${total + 1}::integer, ${count}::integer) n`)
      total = count
      const ids = (await db.select({ id: schema.weldJoints.id }).from(schema.weldJoints).where(eq(schema.weldJoints.projectTitle, 'AUTH-SCALE')).orderBy(schema.weldJoints.id).limit(1000)).map(row => row.id)
      const series: any[] = []
      for (let repeat = 0; repeat < 5; repeat++) {
        series.push(await time('read100', () => db.select().from(schema.weldJoints).orderBy(schema.weldJoints.id).limit(100)))
        for (const size of [1, 1000]) {
          const where = sql`${schema.weldJoints.id} = any(${sql.param(ids.slice(0, size))}::integer[])`
          series.push(await time(`baseline-save-${size}`, () => db.transaction(tx => tx.update(schema.weldJoints).set({ weldingJournalNote: `baseline-${repeat}` }).where(where))))
          series.push(await time(`audited-save-${size}`, () => runWithAccess(owner, 'benchmarkAuditSave', ['welding.edit'], () => db.transaction(tx => tx.update(schema.weldJoints).set({ weldingJournalNote: `audited-${repeat}` }).where(where)))))
        }
      }
      // Independent operation/detail cardinalities: 400k single-object edits,
      // followed by 4m details in batches of 1000. Keep both histories together.
      // Never fabricate pre-auth authors in the working database.
      const batchSize = count === 20000 ? 1 : 1000
      const prefix = `scale-${count}`
      const eventsBefore = Number((await db.execute(sql`select count(*) as count from audit_changes`)).rows[0].count)
      const seed = await time('seed-history', async () => {
        for (let round = 1; round <= 20; round++) {
          await db.execute(sql`insert into audit_operations(id, actor_id, actor_name, action, area, source, created_at)
            select md5(${prefix} || ':' || ${round}::text || ':' || bucket::text), ${owner.id}, ${owner.name}, 'loadHistorySeed', 'welding', 'application',
              '2026-10-01T00:00:00Z'::timestamptz + (${round}::integer * ${count / batchSize}::integer + bucket) * interval '1 second'
            from generate_series(0, ${(count - 1) / batchSize | 0}::integer) bucket`)
          await db.execute(sql`insert into audit_changes(operation_id, entity, entity_id, joint_id, label, area, kind, changes)
            select md5(${prefix} || ':' || ${round}::text || ':' || ((n-1)/${batchSize}::integer)::text), 'weld_joints', id::text, id, joint, 'welding', 'update',
              jsonb_build_object('weldingJournalNote', jsonb_build_object('before', 'Замечание ' || (${round}-1)::text, 'after', 'Замечание ' || ${round}::text))
            from (select id,joint,row_number() over(order by id)::integer as n from weld_joints where project_title='AUTH-SCALE') source`)
        }
      })
      assert.equal(Number((await db.execute(sql`select count(*) as count from audit_changes`)).rows[0].count) - eventsBefore, count * 20)
      await db.execute(sql`analyze audit_operations`); await db.execute(sql`analyze audit_changes`); await db.execute(sql`analyze weld_joints`)
      const histories: any[] = []
      for (let repeat = 0; repeat < 5; repeat++) await runWithAccess(owner, 'history', [], async () => {
        let first: Awaited<ReturnType<typeof listActivityHistory>>
        histories.push(await time('history-global', async () => { first = await listActivityHistory({}) }))
        histories.push(await time('history-joint', () => listActivityHistory({ jointId: ids[0] })))
        histories.push(await time('history-filtered', () => listActivityHistory({ actorId: owner.id, action: 'loadHistorySeed', from: '2026-10-01T00:00:00Z', until: '2026-10-25T00:00:00Z' })))
        histories.push(await time('history-options', () => getActivityFilters({})))
        await runWithAccess(actors[0], 'history', [], async () => {
          histories.push(await time('history-restricted', () => listActivityHistory({})))
          histories.push(await time('history-restricted-options', () => getActivityFilters({})))
        })
        histories.push(await time('history-details', () => getActivityDetails({ operationId: first!.rows[0].id })))
        const next = await listActivityHistory({ cursor: first!.nextCursor ?? undefined, until: first!.until })
        assert.equal(new Set([...first!.rows, ...next.rows].map(row => row.id)).size, first!.rows.length + next.rows.length)
      })
      // Sparse/empty visibility must not be mistaken for the inexpensive case
      // where the first fifty events are all visible. Exercise both sides.
      for (let repeat = 0; repeat < 3; repeat++) {
        const lnkReader = { ...actors[0], permissions: ['lnk.view', 'history.view'] as AccessIdentity['permissions'] }
        histories.push(await time('history-hidden-seed', () => runWithAccess(lnkReader, 'history', [], async () => {
          const page = await listActivityHistory({ action: 'loadHistorySeed' })
          assert.equal(page.rows.length, 0)
        })))
        histories.push(await time('history-no-deletions', () => runWithAccess(owner, 'history', [], async () => {
          const page = await listActivityHistory({ action: 'kind:delete', from: '2026-10-01T00:00:00Z', until: '2026-10-25T00:00:00Z' })
          assert.equal(page.rows.length, 0)
        })))
        histories.push(await time('history-missing-joint', () => runWithAccess(owner, 'history', [], async () => {
          const page = await listActivityHistory({ jointId: 2147483647 })
          assert.equal(page.rows.length, 0)
        })))
      }
      const concurrent = await time('25-concurrent-writers-3-saves-each', () => Promise.all(actors.map((actor, index) => runWithAccess(actor, 'benchmarkConcurrentSave', ['welding.edit'], async () => {
        for (let iteration = 0; iteration < 3; iteration++) await db.transaction(tx => tx.update(schema.weldJoints).set({ weldingJournalNote: `actor-${index}-${iteration}` }).where(eq(schema.weldJoints.id, ids[index])))
      }))))
      const storage = (await db.execute(sql`select 'audit_operations' as relation, pg_relation_size('audit_operations')::bigint as data_bytes, pg_indexes_size('audit_operations')::bigint as index_bytes
        union all select 'audit_changes',pg_relation_size('audit_changes'),pg_indexes_size('audit_changes')`)).rows
      observations.push({ joints: count, seededEvents: count * 20, batchSize, seededOperations: count * 20 / batchSize, series, seed, histories, concurrent, storage })
      console.log('AUTH_SCALE', JSON.stringify(observations.at(-1)))
    }
    console.log('AUTH_SCALE_ENV', JSON.stringify({ cpus: cpus().length, memoryGB: Math.round(totalmem()/1024**3), node: process.version, peakRssMB: Math.round(process.resourceUsage().maxRSS / 1024), observations: observations.length }))
  } finally { pg.Client.prototype.query = originalQuery }
}
