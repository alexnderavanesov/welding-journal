import { createServerFn } from '@tanstack/react-start'
import { hashJsonRecordTuple } from './json-record-token'
import { asc, eq, sql } from 'drizzle-orm'
import { requireDb } from '@/db'
import { weldJoints, weldJointProgramStates } from '@/db/schema'
import { buildChainActualityGroups } from '@/lib/chain-actuality'
import { isRevisionNotActual } from '@/lib/revision-actuality'
import { assertSecurityScope } from './security-functions'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'
import { attachProgramChainStates } from './line-program-chain-state'
import { lineProgramWeldWhere, loadProgramSystemIndexSettings } from './line-program'
import { haveSameWeldLineMemberships, lockWeldLineMemberships } from './weld-line-membership-lock'
import { buildNumberArrayMatch } from './weld-request-utils'
import { getDispatcherDirtyScopes, markDispatcherTaskIndexDirty } from './dispatcher-task-index-dirty'
import { lockWeldValidationSettings } from './weld-validation-settings-lock'

type Tx = SystemDocumentSequenceTransaction
export type ChainActualityInput = { rowId: number; active: boolean }
const changedMessage = 'Состав или данные цепочки изменились. Повторите проверку и подтверждение; ничего не сохранено.'
const columns = { id: weldJoints.id, projectTitle: weldJoints.projectTitle, subtitleCode: weldJoints.subtitleCode,
  line: weldJoints.line, joint: weldJoints.joint, officiality: weldJoints.officiality, weldDate: weldJoints.weldDate,
  revisionActuality: weldJoints.revisionActuality, updatedAt: weldJoints.updatedAt }

async function readContext(tx: Tx, input: ChainActualityInput) {
  if (!Number.isSafeInteger(input.rowId) || input.rowId <= 0 || typeof input.active !== 'boolean') throw new Error('Не указан стык или новое состояние актуальности.')
  const [initial] = await tx.select(columns).from(weldJoints).where(eq(weldJoints.id, input.rowId))
  if (!initial) throw new Error('Стык больше не существует. Обновите данные.')
  if (!String(initial.line ?? '').trim()) throw new Error('Сначала укажите линию стыка.')
  // Same membership → row → dispatcher lock order as ordinary edits/imports.
  await lockWeldLineMemberships(tx, [initial])
  const [current] = await tx.select(columns).from(weldJoints).where(eq(weldJoints.id, input.rowId))
  if (!current || !haveSameWeldLineMemberships([initial], [current])) throw new Error(changedMessage)
  // Legacy membership depends on the configured R/W/Y indexes. Keep that
  // interpretation stable from the read through confirmation and the update.
  await lockWeldValidationSettings(tx)
  const settings = await loadProgramSystemIndexSettings(tx)
  const scope = await attachProgramChainStates(await tx.select(columns).from(weldJoints)
    .where(lineProgramWeldWhere({ projectTitle: String(current.projectTitle ?? '').trim(), subtitleCode: String(current.subtitleCode ?? '').trim(), line: String(current.line ?? '').trim() })).orderBy(asc(weldJoints.id)), tx)
  const { groups, states } = buildChainActualityGroups(scope, settings)
  const group = groups.find(group => group.rows.some(row => row.id === input.rowId))!
  const scopeById = new Map(scope.map(row => [row.id, row]))
  const ids = group.rows.map(row => row.id)
  const locked = await tx.select(columns).from(weldJoints).where(buildNumberArrayMatch(weldJoints.id, ids)).orderBy(asc(weldJoints.id)).for('update')
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
  })) reason = 'Сохранённые связи цепочки неполны или ведут в другую линию. Сначала исправьте целостность по СП-04; актуальность не изменена.'
  const changes = group.rows.filter(row => isRevisionNotActual(row.revisionActuality) === input.active)
  const token = hashJsonRecordTuple([
    input, group.rows.map(row => [scopeById.get(row.id), states.get(row.id)]), settings, linked,
  ])
  return { group, changes, preview: { ...input, token, reason, total: ids.length, changedCount: changes.length,
    rows: group.rows.map(row => ({ id: row.id, joint: String(row.joint ?? row.id), officiality: String(row.officiality ?? ''),
      inactive: isRevisionNotActual(row.revisionActuality) })) } }
}

export async function previewChainActualityInTransaction(tx: Tx, input: ChainActualityInput & { page?: number }) {
  const requestedPage = input.page ?? 0
  if (!Number.isSafeInteger(requestedPage) || requestedPage < 0) throw new Error('Некорректная страница предпросмотра.')
  const preview = (await readContext(tx, { rowId: input.rowId, active: input.active })).preview
  // A concurrent deletion may shrink the group while the last page is open.
  // Never offer confirmation with an empty list merely because its page vanished.
  const page = Math.min(requestedPage, Math.max(0, Math.ceil(preview.total / 100) - 1))
  return { ...preview, rows: preview.rows.slice(page * 100, (page + 1) * 100), page, pageSize: 100 }
}
export async function setChainActualityInTransaction(tx: Tx, input: ChainActualityInput & { token: string; confirmed: boolean }) {
  if (input.confirmed !== true || !/^[a-f0-9]{64}$/.test(input.token)) throw new Error('Проверьте состав цепочки и подтвердите изменение актуальности.')
  const { group, changes, preview } = await readContext(tx, { rowId: input.rowId, active: input.active })
  if (preview.token !== input.token) throw new Error(changedMessage)
  if (preview.reason) throw new Error(preview.reason)
  if (changes.length) {
    const ids = changes.map(row => row.id)
    await tx.update(weldJoints).set({ revisionActuality: input.active ? null : 'не актуален', weldingUpdatedAt: new Date(),
      updatedAt: sql`greatest(clock_timestamp(), ${weldJoints.updatedAt} + interval '1 millisecond')` }).where(buildNumberArrayMatch(weldJoints.id, ids))
    await markDispatcherTaskIndexDirty(tx, { scopes: getDispatcherDirtyScopes(group.rows, new Map()) })
  }
  return { changedCount: changes.length }
}

export const previewChainActuality = createServerFn({ method: 'POST' }).validator((data: ChainActualityInput & { page?: number }) => data).handler(async ({ data }) => {
  await assertSecurityScope('entry')
  return requireDb().transaction(tx => previewChainActualityInTransaction(tx, data))
})
export const setChainActuality = createServerFn({ method: 'POST' }).validator((data: ChainActualityInput & { token: string; confirmed: boolean }) => data).handler(async ({ data }) => {
  await assertSecurityScope('edit')
  return requireDb().transaction(tx => setChainActualityInTransaction(tx, data))
})
