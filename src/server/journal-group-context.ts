import { eq } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { requireDb } from '@/db'
import { weldJoints, weldJointProgramStates } from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { ProgramChainState } from '@/lib/line-program-chain-state'
import type { OtherSettings } from '@/lib/other-settings'
import { calculateWdi, isSystemWdiMode } from '@/lib/wdi'
import { journalNumericValue } from '@/lib/welding-journal-grid-state'
import { buildNumberArrayMatch } from './weld-request-utils'

// One indexed page-sized read. Never load a whole line or query from a group renderer.
// Saved root IDs and replacement tombstones must survive filtering and renaming.
export async function attachJournalGroupContext(rows: WeldRow[], settings: OtherSettings, db: Pick<ReturnType<typeof requireDb>, 'select'> = requireDb()): Promise<WeldRow[]> {
  if (!rows.length) return rows
  const root = alias(weldJoints, 'journal_physical_root')
  const rootState = alias(weldJointProgramStates, 'journal_physical_root_state')
  const records = await db.select({
    state: weldJointProgramStates,
    root: { id: root.id, wdi: root.wdi, connectionType: root.connectionType,
      d1: root.d1, d2: root.d2, t1: root.t1, t2: root.t2 },
    replaced: rootState.replacedByCoil,
  }).from(weldJointProgramStates)
    .leftJoin(root, eq(root.id, weldJointProgramStates.physicalRootId))
    .leftJoin(rootState, eq(rootState.weldJointId, weldJointProgramStates.physicalRootId))
    .where(buildNumberArrayMatch(weldJointProgramStates.weldJointId, rows.map(row => row.id)))
  const byId = new Map(records.map(record => [record.state.weldJointId, record]))
  const wdiByRoot = new Map<number, number | null>()
  return rows.map(row => {
    const record = byId.get(row.id)
    if (!record) return row
    const { state, root, replaced } = record
    if (root && !wdiByRoot.has(root.id)) wdiByRoot.set(root.id, isSystemWdiMode(settings)
      ? calculateWdi(root, settings) : journalNumericValue(root.wdi))
    return { ...row, programChainState: state as ProgramChainState,
      ...(state.physicalRootId == null ? {} : { groupPhysicalRoot: {
        id: state.physicalRootId, exists: Boolean(root), replaced: Boolean(replaced),
        wdi: root ? wdiByRoot.get(root.id) ?? null : null,
      } }),
    }
  })
}
