import { eq, sql } from 'drizzle-orm'
import { appSettings, weldJoints, weldJointProgramStates } from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import { chainDeletionBlockMessage, getRetainedChainDependants } from '@/lib/joint-chain-deletion'
import { normalizeSystemIndexSettings } from '@/lib/system-index-settings'
import { PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'
import { loadProgramChainScopeRows } from './line-program-chain-state'

/** Caller holds the selected rows and their ordered membership locks. All normal
 * structural writers use those locks; no later row-by-row locks/queries are taken.
 * The second check follows immutable stored IDs across moved/deleted intermediates. */
export async function assertJointChainRowsCanBeDeleted(tx: SystemDocumentSequenceTransaction, selected: readonly WeldRow[]) {
  if (!selected.length) return
  const ids = [...new Set(selected.map(row => row.id))], selectedIds = new Set(ids)
  const rows = await loadProgramChainScopeRows(tx, selected)
  const [stored] = await tx.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, PROJECT_SETTING_KEYS.systemIndex))
  let value: unknown
  try { value = stored ? JSON.parse(stored.value) : undefined } catch { value = undefined }
  const retained = getRetainedChainDependants(rows, selectedIds, normalizeSystemIndexSettings(value))
  if (retained.length) throw new Error(chainDeletionBlockMessage(retained))
  const descendants = await tx.execute<{ id: number; joint: string | null; line: string | null }>(buildRetainedChainDescendantsQuery(ids))
  if (descendants.rows.length) throw new Error(chainDeletionBlockMessage(descendants.rows))
}

export function buildRetainedChainDescendantsQuery(ids: readonly number[]) {
  // Filter selected IDs on the small traversal before looking up live rows.
  // LATERAL + LIMIT keeps this a primary-key lookup, even with stale statistics;
  // a sorted merge join used to scan almost all 200k unrelated welds for 200 IDs.
  return sql`
    with recursive descendants(id) as (
      select unnest(${sql.param(ids)}::integer[])
      union
      select s.weld_joint_id from ${weldJointProgramStates} s join descendants d
        on (s.source_row_id = d.id or s.physical_root_id = d.id or s.coil_parent_id = d.id)
          and s.weld_joint_id <> d.id
    )
    select w.id, w.joint, w.line from descendants d cross join lateral (
      select id, joint, line from ${weldJoints} where id = d.id limit 1
    ) w
    where not (d.id = any(${sql.param(ids)}::integer[])) limit 6
  `
}
