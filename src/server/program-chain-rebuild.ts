import { sql } from 'drizzle-orm'
import { weldJointProgramStates } from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getJointChainConsistencyKey } from '@/lib/joint-chain-keys'
import { captureRebuiltProgramChainStates, type ProgramChainState } from '@/lib/line-program-chain-state'
import type { SystemIndexSettings } from '@/lib/system-index-settings'
import { attachProgramChainStates } from './line-program-chain-state'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'
import { syncSchemePhysicalMembership } from './line-scheme-identity'

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
  const prepared = await prepareRebuiltContext(tx, rows, renamedRowIds, settings)
  const changed = prepared.changed
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
  // Officiality can establish a live official namesake without renaming any
  // row. Preserve that identity too. Rebuilt chains reuse their prepared state
  // rather than loading every program state in the line a second time.
  const rebuilt = new Map(prepared.rows.map(row => [row.id, row]))
  const contextual = rows.map(row => rebuilt.get(row.id) ?? row)
  await syncSchemePhysicalMembership(tx, contextual,
    new Map(contextual.flatMap(row => row.programChainState ? [[row.id, row.programChainState] as const] : [])), new Map(), settings)
}

/** The same preparation is used by the read-only preview and the locked save. */
export async function prepareRebuiltProgramChainStates(
  tx: Pick<SystemDocumentSequenceTransaction, 'select'>,
  rows: readonly WeldRow[],
  renamedRowIds: readonly number[],
  settings: SystemIndexSettings,
) {
  return (await prepareRebuiltContext(tx, rows, renamedRowIds, settings)).changed
}

async function prepareRebuiltContext(
  tx: Pick<SystemDocumentSequenceTransaction, 'select'>, rows: readonly WeldRow[],
  renamedRowIds: readonly number[], settings: SystemIndexSettings,
) {
  if (!renamedRowIds.length) return { changed: [] as ProgramChainState[], rows: [] as WeldRow[] }
  const renamed = new Set(renamedRowIds)
  const keys = new Set(rows.filter(row => renamed.has(row.id))
    .map(row => getJointChainConsistencyKey(row, settings)).filter(key => key !== null))
  const affected = await attachProgramChainStates(rows
    .filter(row => keys.has(getJointChainConsistencyKey(row, settings) ?? ''))
    .map(row => ({ ...row })), tx)
  const states = captureRebuiltProgramChainStates(affected, settings)
  const changed = affected.flatMap(row => {
    const next = states.get(row.id)!
    return JSON.stringify(next) === JSON.stringify(row.programChainState) ? [] : [next]
  })
  return { changed, rows: affected.map(row => ({ ...row, programChainState: states.get(row.id)! })) }
}
