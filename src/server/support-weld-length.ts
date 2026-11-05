import { asc, eq, sql } from 'drizzle-orm'
import { appSettings, weldJoints } from '@/db/schema'
import { isTConnectionType } from '@/lib/connection-type'
import type { WeldRow } from '@/lib/dispatcher-types'
import { PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'
import { getSupportLengthSynchronizations, normalizeSupportWeldLength } from '@/lib/support-weld-length'
import { normalizeSystemIndexSettings, type SystemIndexSettings } from '@/lib/system-index-settings'
import type { WeldInput } from '@/lib/weld-fields'
import { loadProgramChainScopeRows } from './line-program-chain-state'
import { loadSupportLengthChainRows } from './support-weld-length-scope'
import { getDispatcherDirtyScopes, registerAdditionalDispatcherDirtyScopes } from './dispatcher-task-index-dirty'
import { getPstoLineIdentityKey } from '@/lib/psto-line-assignment'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'
import { buildNumberArrayMatch } from './weld-request-utils'
import { WELD_TABLE_RETURNING } from './weld-server-shared'

/** Caller holds membership locks and validates submitted versions before writing.
 * A length correction locks descendants and changes only length and versions in
 * that same transaction. Existing facts, assignments and documents are untouched. */
export async function synchronizeSupportWeldLengths(
  tx: SystemDocumentSequenceTransaction,
  written: readonly WeldInput[],
  previous: ReadonlyMap<number, WeldInput> = new Map(),
  options: { rebuilt?: boolean; settings?: SystemIndexSettings } = {},
) {
  const candidates = written.filter(row => isTConnectionType(row.connectionType) && (options.rebuilt ||
    !previous.has(Number(row.id)) || normalizeSupportWeldLength(row.weldLength) !== normalizeSupportWeldLength(previous.get(Number(row.id))?.weldLength)))
  if (!candidates.length) return []
  let settings = options.settings
  if (!settings) {
    const [stored] = await tx.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, PROJECT_SETTING_KEYS.systemIndex))
    let value: unknown
    try { value = stored ? JSON.parse(stored.value) : undefined } catch { value = undefined }
    settings = normalizeSystemIndexSettings(value)
  }
  const localRows = await loadProgramChainScopeRows(tx, candidates)
  const linkedRows = await loadSupportLengthChainRows(tx, candidates.map(row => Number(row.id)))
  const rows = [...new Map([...localRows, ...linkedRows].map(row => [row.id, row])).values()]
  const changes = getSupportLengthSynchronizations(rows, candidates, previous, settings, options.rebuilt)
  if (!changes.length) return []
  const ids = changes.map(row => row.id).sort((a, b) => a - b)
  const locked = await tx.select({ id: weldJoints.id }).from(weldJoints)
    .where(buildNumberArrayMatch(weldJoints.id, ids)).orderBy(asc(weldJoints.id)).for('update')
  if (locked.length !== ids.length) throw new Error('Состав ремонтной цепочки изменился. Ничего не сохранено; обновите данные.')
  const updated: WeldRow[] = []
  const now = new Date()
  for (let offset = 0; offset < changes.length; offset += 1000) {
    const batch = changes.slice(offset, offset + 1000)
    const lengthCase = sql`case ${weldJoints.id} ${sql.join(batch.map(row => sql`when ${row.id} then ${row.weldLength}::numeric`), sql` `)} end`
    const saved = await tx.update(weldJoints).set({ weldLength: lengthCase, weldingUpdatedAt: now, updatedAt: now })
      .where(buildNumberArrayMatch(weldJoints.id, batch.map(row => row.id))).returning(WELD_TABLE_RETURNING)
    if (saved.length !== batch.length) throw new Error('Состав ремонтной цепочки изменился. Ничего не сохранено; обновите данные.')
    updated.push(...saved)
  }
  const coveredScopes = new Set([...written, ...previous.values()].map(getPstoLineIdentityKey))
  registerAdditionalDispatcherDirtyScopes(tx, getDispatcherDirtyScopes(
    updated.filter(row => !coveredScopes.has(getPstoLineIdentityKey(row))), new Map()))
  return updated
}
