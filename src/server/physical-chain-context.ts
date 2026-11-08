import { asc, eq } from 'drizzle-orm'
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
  if (!Number.isSafeInteger(rowId) || rowId <= 0) throw new Error('Не указан стык.')
  const [initial] = await tx.select(columns).from(weldJoints).where(eq(weldJoints.id, rowId))
  if (!initial) throw new Error('Стык больше не существует. Обновите данные.')
  if (!String(initial.line ?? '').trim()) throw new Error('Сначала укажите линию стыка.')
  // Same membership → row → dispatcher lock order as ordinary edits/imports.
  await lockWeldLineMemberships(tx, [initial])
  const [current] = await tx.select(columns).from(weldJoints).where(eq(weldJoints.id, rowId))
  if (!current || !haveSameWeldLineMemberships([initial], [current])) throw new Error(changedMessage)
  // Legacy membership depends on the configured R/W/Y indexes. Keep that
  // interpretation stable from the read through confirmation and the update.
  await lockWeldValidationSettings(tx)
  const settings = await loadProgramSystemIndexSettings(tx)
  const scope = await attachProgramChainStates(await tx.select(columns).from(weldJoints)
    .where(lineProgramWeldWhere({ projectTitle: String(current.projectTitle ?? '').trim(), subtitleCode: String(current.subtitleCode ?? '').trim(), line: String(current.line ?? '').trim() })).orderBy(asc(weldJoints.id)), tx)
  const { groups, states } = buildChainActualityGroups(scope, settings)
  const group = groups.find(group => group.rows.some(row => row.id === rowId))!
  const scopeById = new Map(scope.map(row => [row.id, row]))
  const ids = group.rows.map(row => row.id)
  const locked = await tx.select().from(weldJoints).where(buildNumberArrayMatch(weldJoints.id, ids)).orderBy(asc(weldJoints.id)).for('update')
  if (locked.length !== ids.length || locked.some(row => row.updatedAt.getTime() !== scopeById.get(row.id)?.updatedAt.getTime())) throw new Error(changedMessage)
  const roots = [...new Set(ids.map(id => states.get(id)!.physicalRootId ?? id))]
  // A saved link may point to a row moved to another line. Never silently change
  // a partial physical connection; the integrity workflow must repair that first.
  const linked = await tx.select({ id: weldJoints.id }).from(weldJointProgramStates)
    .innerJoin(weldJoints, eq(weldJoints.id, weldJointProgramStates.weldJointId))
    .where(buildNumberArrayMatch(weldJointProgramStates.physicalRootId, roots)).orderBy(asc(weldJoints.id))
  const idSet = new Set(ids)
  let reason: string | null = null
  if (linked.some(row => !idSet.has(row.id)) || ids.some(id => {
    const state = states.get(id)!
    return state.physicalRootId == null || !idSet.has(state.physicalRootId) ||
      state.kind === 'repair' && (state.sourceRowId == null || !idSet.has(state.sourceRowId))
  })) reason = 'Сохранённые связи цепочки неполны или ведут в другую линию. Сначала исправьте целостность по СП-09; изменение не сохранено.'
  return { group, states, scopeById, ids, locked, settings, linked, reason }
}
