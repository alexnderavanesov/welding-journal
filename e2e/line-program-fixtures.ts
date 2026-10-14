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
