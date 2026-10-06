import { asc, eq, sql } from 'drizzle-orm'
import { appSettings, weldJoints, weldJointProgramStates } from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import { captureProgramChainStates, type ProgramChainState } from '@/lib/line-program-chain-state'
import { programJointIdentity } from '@/lib/line-program-topology'
import { normalizeSystemIndexSettings } from '@/lib/system-index-settings'
import { PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'
import { buildNumberArrayMatch } from './weld-request-utils'

export async function attachProgramChainStates<T extends { id: number }>(rows: T[], db: Pick<SystemDocumentSequenceTransaction, 'select'>) {
  if (!rows.length) return rows as (T & { programChainState?: ProgramChainState })[]
  const stored = await db.select().from(weldJointProgramStates).where(buildNumberArrayMatch(weldJointProgramStates.weldJointId, rows.map(row => row.id))).orderBy(asc(weldJointProgramStates.weldJointId))
  const states = new Map(stored.map(state => [state.weldJointId, state as ProgramChainState]))
  for (const row of rows) {
    const state = states.get(row.id)
    if (state) Object.assign(row, { programChainState: state })
  }
  return rows as (T & { programChainState?: ProgramChainState })[]
}

/** Compact full-line context for structural writes, batched by identity. */
export async function loadProgramChainScopeRows(tx: Pick<SystemDocumentSequenceTransaction, 'select'>, scope: readonly Partial<WeldRow>[]) {
  const scopes = [...new Map(scope.map(row => [programJointIdentity(row as WeldRow, ''), row])).values()]
  const rows: WeldRow[] = []
  for (let offset = 0; offset < scopes.length; offset += 500) {
    const tuples = scopes.slice(offset, offset + 500).map(row => sql`(${String(row.projectTitle ?? '').trim().toLocaleLowerCase('ru')}, ${String(row.subtitleCode ?? '').trim().toLocaleLowerCase('ru')}, ${String(row.line ?? '').trim().toLocaleLowerCase('ru')})`)
    const batch = await tx.select({ id: weldJoints.id, projectTitle: weldJoints.projectTitle, subtitleCode: weldJoints.subtitleCode,
      line: weldJoints.line, joint: weldJoints.joint, officiality: weldJoints.officiality, weldDate: weldJoints.weldDate,
    }).from(weldJoints).where(sql`(lower(btrim(coalesce(${weldJoints.projectTitle}, ''))), lower(btrim(coalesce(${weldJoints.subtitleCode}, ''))),
      lower(btrim(coalesce(${weldJoints.line}, '')))) in (${sql.join(tuples, sql`, `)})`)
    for (const row of batch) rows.push(row)
  }
  return attachProgramChainStates(rows, tx)
}

/** Captures the before-state as well as the final state inside the user's transaction.
 * Deletion must not undo a physical replacement or bind descendants to a reused name.
 * Control-only writes need no topology queries. Structural writes use batched line reads.
 */
export async function syncProgramChainStates(
  tx: SystemDocumentSequenceTransaction,
  current: (Partial<WeldRow> & { id: number })[],
  previous: ReadonlyMap<number, Partial<WeldRow> & { id: number }>,
) {
  const fields = ['projectTitle', 'subtitleCode', 'line', 'joint', 'weldDate'] as const
  const currentIds = new Set(current.map(row => row.id))
  const structural = current.some(row => !previous.has(row.id) || fields.some(key => row[key] !== undefined && row[key] !== previous.get(row.id)?.[key])) ||
    [...previous.keys()].some(id => !currentIds.has(id))
  if (!structural) return
  const rows = await loadProgramChainScopeRows(tx, [...current, ...previous.values()])
  const [setting] = await tx.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, PROJECT_SETTING_KEYS.systemIndex))
  let storedSettings: unknown
  try { storedSettings = setting ? JSON.parse(setting.value) : undefined } catch { storedSettings = undefined }
  const settings = normalizeSystemIndexSettings(storedSettings)
  const before = new Map(rows.filter(row => previous.has(row.id) || !currentIds.has(row.id)).map(row => [row.id, row]))
  for (const [id, row] of previous) before.set(id, { ...before.get(id), ...row } as WeldRow)
  const beforeStates = captureProgramChainStates([...before.values()], settings)
  const finalRows = rows.map(row => ({ ...row, programChainState: beforeStates.get(row.id) ?? row.programChainState }))
  const states = captureProgramChainStates(finalRows, settings)
  const changed = rows.flatMap(row => {
    const state = states.get(row.id)!
    return JSON.stringify(state) === JSON.stringify(row.programChainState) ? [] : [state]
  })
  // First structural touch may be deletion of a legacy row with no captured
  // state yet. Persist its before-image as an ID tombstone in the same transaction.
  const survivingIds = new Set(rows.map(row => row.id))
  for (const id of previous.keys()) {
    const state = beforeStates.get(id)
    if (!survivingIds.has(id) && state) changed.push(state)
  }
  for (let offset = 0; offset < changed.length; offset += 1000) {
    await tx.insert(weldJointProgramStates).values(changed.slice(offset, offset + 1000)).onConflictDoUpdate({
      target: weldJointProgramStates.weldJointId,
      // Identity is established once. Replacement is monotonic; deleting a row isn't
      // an instruction to undo the physical work. Full planning is still dynamic.
      set: { replacedByCoil: sql`${weldJointProgramStates.replacedByCoil} or excluded.replaced_by_coil`,
        replacementCoilIds: sql`case when not ${weldJointProgramStates.replacedByCoil} and excluded.replaced_by_coil
          then excluded.replacement_coil_ids else ${weldJointProgramStates.replacementCoilIds} end` },
    })
  }
}
