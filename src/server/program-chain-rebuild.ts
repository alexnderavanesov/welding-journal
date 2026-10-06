import { sql } from 'drizzle-orm'
import { weldJointProgramStates } from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getJointChainConsistencyKey } from '@/lib/joint-chain-keys'
import { captureRebuiltProgramChainStates } from '@/lib/line-program-chain-state'
import type { SystemIndexSettings } from '@/lib/system-index-settings'
import { attachProgramChainStates } from './line-program-chain-state'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'

/** Caller has locked the line, validated the officiality plan and saved its
 * renames in this transaction. Reuse that context: no journal reload per row.
 * Only explicitly rebuilt chains may change their computational roles/links.
 */
export async function syncRebuiltProgramChainStates(
  tx: SystemDocumentSequenceTransaction,
  rows: readonly WeldRow[],
  renamedRowIds: readonly number[],
  settings: SystemIndexSettings,
) {
  const changed = await prepareRebuiltProgramChainStates(tx, rows, renamedRowIds, settings)
  for (let offset = 0; offset < changed.length; offset += 1_000) {
    await tx.insert(weldJointProgramStates).values(changed.slice(offset, offset + 1_000)).onConflictDoUpdate({
      target: weldJointProgramStates.weldJointId,
      set: {
        kind: sql`excluded.kind`,
        physicalRootId: sql`excluded.physical_root_id`,
        sourceRowId: sql`excluded.source_row_id`,
        coilParentId: sql`excluded.coil_parent_id`,
        coilSide: sql`excluded.coil_side`,
        replacedByCoil: sql`excluded.replaced_by_coil`,
        replacementCoilIds: sql`excluded.replacement_coil_ids`,
      },
    })
  }
}

/** The same preparation is used by the read-only preview and the locked save. */
export async function prepareRebuiltProgramChainStates(
  tx: Pick<SystemDocumentSequenceTransaction, 'select'>,
  rows: readonly WeldRow[],
  renamedRowIds: readonly number[],
  settings: SystemIndexSettings,
) {
  if (!renamedRowIds.length) return []
  const renamed = new Set(renamedRowIds)
  const keys = new Set(rows.filter(row => renamed.has(row.id))
    .map(row => getJointChainConsistencyKey(row, settings)).filter(key => key !== null))
  const affected = await attachProgramChainStates(rows
    .filter(row => keys.has(getJointChainConsistencyKey(row, settings) ?? ''))
    .map(row => ({ ...row })), tx)
  const states = captureRebuiltProgramChainStates(affected, settings)
  return affected.flatMap(row => {
    const next = states.get(row.id)!
    return JSON.stringify(next) === JSON.stringify(row.programChainState) ? [] : [next]
  })
}
