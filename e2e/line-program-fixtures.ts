import { withE2eDatabase } from './database'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Client } from 'pg'
import { DISPATCHER_BACKGROUND_INDEX_LOCK_ID, DISPATCHER_REFRESH_LOCK_ID } from '../src/server/dispatcher-task-index-constants'
import { markDispatcherTaskIndexDirty } from '../src/server/dispatcher-task-index-dirty'

// Only for raw fixture mutations, never for assertions or application saves:
// both dispatcher and derived caches must see the committed fixture revision.
export async function withLineProgramFixture<T>(run: (db: Client) => Promise<T>): Promise<T> {
  return withE2eDatabase(async db => {
    await db.query('begin')
    try {
      // Preserve cleanup's refresh locks for fixture writes too: no refresh may
      // stage a partial seed or retain parent rows while cleanup deletes them.
      await db.query('select pg_advisory_xact_lock($1)', [DISPATCHER_REFRESH_LOCK_ID])
      await db.query('select pg_advisory_xact_lock($1)', [DISPATCHER_BACKGROUND_INDEX_LOCK_ID])
      const result = await run(db)
      // Use the same isolated connection/transaction, not requireDb's pool.
      // The normal invalidator bumps BOTH revisions and clears derived caches.
      await markDispatcherTaskIndexDirty(drizzle(db))
      await db.query('commit')
      return result
    } catch (error) {
      await db.query('rollback')
      throw error
    }
  })
}

// A joint number is only unique within a line. Do not leave a second F1/F2 in
// unrelated scenarios, or grow their first report page with our large fixtures.
export async function cleanupLineProgramProjects(projects: string[]) {
  await withLineProgramFixture(async db => {
    // Repeated load fixtures can leave FK child-table statistics from an empty
    // database. A cascade then chooses a sequential scan for every deleted
    // weld. Refresh statistics outside measured workflows, before the DELETE
    // starts (changing them during an executing cascade does not replan it).
    const large = await db.query('select 1 from weld_joints where project_title=any($1::text[]) offset 9999 limit 1', [projects])
    if (large.rows.length) {
      const children = await db.query<{ relation: string }>(`select distinct
        quote_ident(n.nspname)||'.'||quote_ident(c.relname) as relation
        from pg_constraint k join pg_class c on c.oid=k.conrelid
        join pg_namespace n on n.oid=c.relnamespace
        where k.confrelid='weld_joints'::regclass and k.contype='f'`)
      for (const { relation } of children.rows) await db.query(`analyze ${relation}`)
    }
    // Aggregate membership once. Correlated EXISTS/NOT EXISTS can choose a
    // quadratic nested-loop plan immediately after a 200k-row seed, before
    // autovacuum has refreshed statistics. Shared documents remain protected.
    await db.query(`delete from generated_documents d
      where d.id in (
        select a.document_id from generated_document_weld_joints a
        join weld_joints w on w.id=a.weld_joint_id
        group by a.document_id
        having bool_and(coalesce(w.project_title=any($1::text[]), false))
      )`, [projects])
    await db.query('delete from weld_joints where project_title=any($1::text[])', [projects])
    await db.query('delete from line_programs where project_title=any($1::text[])', [projects])
  })
}
