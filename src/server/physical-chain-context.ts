import { asc, eq, or } from 'drizzle-orm'
import { getPstoLineIdentityKey, normalizePstoLineIdentity } from '@/lib/psto-line-assignment'
import { weldJoints, weldJointProgramStates } from '@/db/schema'
import { buildChainActualityGroups } from '@/lib/chain-actuality'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'
import { attachProgramChainStates } from './line-program-chain-state'
import { lineProgramWeldWhere, loadProgramSystemIndexSettings } from './line-program'
import { haveSameWeldLineMemberships, lockWeldLineMemberships } from './weld-line-membership-lock'
import { buildNumberArrayMatch } from './weld-request-utils'
import { lockWeldValidationSettings } from './weld-validation-settings-lock'
const changedMessage = 'Состав или данные цепочки изменились. Повторите проверку; ничего не сохранено.'
const columns = { id: weldJoints.id, projectTitle: weldJoints.projectTitle, subtitleCode: weldJoints.subtitleCode,
  line: weldJoints.line, joint: weldJoints.joint, officiality: weldJoints.officiality, weldDate: weldJoints.weldDate,
  revisionActuality: weldJoints.revisionActuality, updatedAt: weldJoints.updatedAt }

export async function loadPhysicalChainContext(tx: SystemDocumentSequenceTransaction, rowId: number) {
  return (await loadPhysicalChainContexts(tx, [rowId]))[0]
}

/** One membership/scope/history read for a selection, not one full-line read per joint. */
export async function loadPhysicalChainContexts(tx: SystemDocumentSequenceTransaction, rowIds: number[]) {
  if (!rowIds.length || rowIds.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('Не указан стык.')
  const selected = new Set(rowIds)
  const initial = await tx.select(columns).from(weldJoints).where(buildNumberArrayMatch(weldJoints.id, [...selected])).orderBy(asc(weldJoints.id))
  if (initial.length !== selected.size) throw new Error('Стык больше не существует. Обновите данные.')
  if (initial.some(row => !String(row.line ?? '').trim())) throw new Error('Сначала укажите линию стыка.')
  // Same membership → row → dispatcher lock order as ordinary edits/imports.
  await lockWeldLineMemberships(tx, initial)
  const current = await tx.select(columns).from(weldJoints).where(buildNumberArrayMatch(weldJoints.id, [...selected])).orderBy(asc(weldJoints.id))
  if (current.length !== selected.size || !haveSameWeldLineMemberships(initial, current)) throw new Error(changedMessage)
  // Legacy membership depends on the configured R/W/Y indexes. Keep that
  // interpretation stable from the read through confirmation and the update.
  await lockWeldValidationSettings(tx)
  const settings = await loadProgramSystemIndexSettings(tx)
  const identities = [...new Map(current.map(row => [getPstoLineIdentityKey(row), normalizePstoLineIdentity(row)])).values()]
  const scopeRecords: typeof current = []
  for (let offset = 0; offset < identities.length; offset += 500) {
    const batch = await tx.select(columns).from(weldJoints).where(or(...identities.slice(offset, offset + 500).map(lineProgramWeldWhere))).orderBy(asc(weldJoints.id))
    for (const row of batch) scopeRecords.push(row)
  }
  const scope = await attachProgramChainStates(scopeRecords, tx)
  const { groups, states } = buildChainActualityGroups(scope, settings)
  const affected = groups.filter(group => group.rows.some(row => selected.has(row.id)))
  const scopeById = new Map(scope.map(row => [row.id, row]))
  const ids = affected.flatMap(group => group.rows.map(row => row.id)).sort((a, b) => a - b)
  const locked = await tx.select().from(weldJoints).where(buildNumberArrayMatch(weldJoints.id, ids)).orderBy(asc(weldJoints.id)).for('update')
  if (locked.length !== ids.length || locked.some(row => row.updatedAt.getTime() !== scopeById.get(row.id)?.updatedAt.getTime())) throw new Error(changedMessage)
  const roots = [...new Set(ids.map(id => states.get(id)!.physicalRootId ?? id))]
  // A saved link may point to a row moved to another line. Never silently change
  // a partial physical connection; the integrity workflow must repair that first.
  const linked = await tx.select({ id: weldJoints.id, rootId: weldJointProgramStates.physicalRootId }).from(weldJointProgramStates)
    .innerJoin(weldJoints, eq(weldJoints.id, weldJointProgramStates.weldJointId))
    .where(buildNumberArrayMatch(weldJointProgramStates.physicalRootId, roots)).orderBy(asc(weldJoints.id))
  const lockedById = new Map(locked.map(row => [row.id, row]))
  const linksByRoot = new Map<number, typeof linked>()
  for (const row of linked) if (row.rootId != null) {
    const links = linksByRoot.get(row.rootId) ?? []; links.push(row); linksByRoot.set(row.rootId, links)
  }
  return affected.map(group => {
    const ids = group.rows.map(row => row.id).sort((a, b) => a - b), idSet = new Set(ids)
    const roots = [...new Set(ids.map(id => states.get(id)!.physicalRootId ?? id))]
    const linked = roots.flatMap(root => linksByRoot.get(root) ?? []).sort((a, b) => a.id - b.id)
    let reason: string | null = null
    if (new Set(group.rows.map(getPstoLineIdentityKey)).size > 1 || linked.some(row => !idSet.has(row.id)) || ids.some(id => {
      const state = states.get(id)!
      return state.physicalRootId == null || !idSet.has(state.physicalRootId) ||
        state.kind === 'repair' && (state.sourceRowId == null || !idSet.has(state.sourceRowId))
    })) reason = 'Сохранённые связи цепочки неполны или ведут в другую линию. Сначала исправьте целостность по СП-09; изменение не сохранено.'
    return { group, states, scopeById, ids, locked: ids.map(id => lockedById.get(id)!), settings, linked, reason }
  })
}
