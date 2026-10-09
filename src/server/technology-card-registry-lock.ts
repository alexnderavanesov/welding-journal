import { sql, type SQL } from 'drizzle-orm'

/** Lock order: validation settings, technology card registry, joints, dispatcher.
 * Shared reads cover assignment through commit; registry changes use exclusive. */
export async function lockTechnologyCardRegistry(
  tx: { execute: (query: SQL) => PromiseLike<unknown> },
  mode: 'shared' | 'exclusive' = 'shared',
) {
  await tx.execute(mode === 'exclusive'
    ? sql`select pg_advisory_xact_lock(hashtext('technology-card-registry'))`
    : sql`select pg_advisory_xact_lock_shared(hashtext('technology-card-registry'))`)
}
