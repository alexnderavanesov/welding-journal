import { loadPhysicalChainContext } from './physical-chain-context'
import { createServerFn } from '@tanstack/react-start'
import { hashJsonRecordTuple } from './json-record-token'
import { sql } from 'drizzle-orm'
import { requireDb } from '@/db'
import { weldJoints } from '@/db/schema'
import { isRevisionNotActual } from '@/lib/revision-actuality'
import { assertSecurityScope } from './security-functions'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'
import { buildNumberArrayMatch } from './weld-request-utils'
import { getDispatcherDirtyScopes, markDispatcherTaskIndexDirty } from './dispatcher-task-index-dirty'
import { getPendingActualityRequests } from '@/lib/chain-actuality-requests'
import type { ChainActualityConfirmation } from '@/lib/chain-actuality'
import { attachPreHeatTreatmentControlRelations, attachPstoRepeatCycleRelations } from './heat-treatment-control-relations'
import { loadControlRequestRemovalPreview } from './control-request-removal-preview'
import { lockLayeredControlDocumentsForWeldChange } from './layered-control-documents'
import { lockSystemDocumentIndexes } from './system-document-index'
import { persistChainActualityRequestRemovals } from './chain-actuality-requests'
import { lockAllControlProcessSettings } from './control-process-settings-lock'
import { projectControlRequestRemovalPreview } from './control-request-removal-access'

type Tx = SystemDocumentSequenceTransaction
export type ChainActualityInput = { rowId: number; active: boolean }
const changedMessage = 'Состав или данные цепочки изменились. Повторите проверку и подтверждение; ничего не сохранено.'
async function readContext(tx: Tx, input: ChainActualityInput) {
  if (typeof input.active !== 'boolean') throw new Error('Не указано новое состояние актуальности.')
  // The standalone preview does not pass through the card's process locks.
  // Settings transitions lock processes before updating these same chain rows;
  // retain that order even when pending requests are discovered only later.
  await lockAllControlProcessSettings(tx)
  const { group, states, scopeById, ids, locked, settings, linked, reason } = await loadPhysicalChainContext(tx, input.rowId)
  const changes = group.rows.filter(row => isRevisionNotActual(row.revisionActuality) === input.active)
  const history = !input.active && changes.length && !reason
    ? await attachPstoRepeatCycleRelations(await attachPreHeatTreatmentControlRelations(locked, tx), tx) : []
  const pendingRequests = getPendingActualityRequests(history)
  if (pendingRequests.length) {
    await lockLayeredControlDocumentsForWeldChange(tx)
    await lockSystemDocumentIndexes(tx)
  }
  const requestPreview = await loadControlRequestRemovalPreview(tx, [], new Map(history.map(row => [row.id, row])), [], pendingRequests)
  const token = hashJsonRecordTuple([
    input, group.rows.map(row => [scopeById.get(row.id), states.get(row.id)]), settings, linked, pendingRequests, requestPreview.token,
  ])
  return { group, changes, history, pendingRequests, preview: { ...input, token, reason, total: ids.length, changedCount: changes.length,
    requestRemovals: requestPreview.removals, pendingRequestCount: pendingRequests.length,
    rows: group.rows.map(row => ({ id: row.id, joint: String(row.joint ?? row.id), officiality: String(row.officiality ?? ''),
      inactive: isRevisionNotActual(row.revisionActuality) })) } }
}

export async function previewChainActualityInTransaction(tx: Tx, input: ChainActualityInput & { page?: number }) {
  const { accessContext } = await import('./access-store')
  const requestedPage = input.page ?? 0
  if (!Number.isSafeInteger(requestedPage) || requestedPage < 0) throw new Error('Некорректная страница предпросмотра.')
  const preview = (await readContext(tx, { rowId: input.rowId, active: input.active })).preview
  // A concurrent deletion may shrink the group while the last page is open.
  // Never offer confirmation with an empty list merely because its page vanished.
  const page = Math.min(requestedPage, Math.max(0, Math.ceil(preview.total / 100) - 1))
  const { removals, hiddenRemovalCount } = projectControlRequestRemovalPreview({ removals: preview.requestRemovals }, accessContext.getStore()?.identity)
  return { ...preview, requestRemovals: removals, hiddenRemovalCount,
    rows: preview.rows.slice(page * 100, (page + 1) * 100), page, pageSize: 100 }
}
export async function prepareChainActualityInTransaction(tx: Tx, input: ChainActualityInput & { token: string; confirmed: boolean }) {
  if (input.confirmed !== true || !/^[a-f0-9]{64}$/.test(input.token)) throw new Error('Проверьте состав цепочки и подтвердите изменение актуальности.')
  const context = await readContext(tx, { rowId: input.rowId, active: input.active })
  const { preview } = context
  if (preview.token !== input.token) throw new Error(changedMessage)
  if (preview.reason) throw new Error(preview.reason)
  return context
}

async function persistContext(tx: Tx, context: Awaited<ReturnType<typeof readContext>>) {
  const { group, changes, history, pendingRequests, preview } = context
  if (changes.length) {
    await persistChainActualityRequestRemovals(tx, history, pendingRequests)
    const ids = [...new Set([...changes.map(row => row.id), ...pendingRequests.map(position => position.rowId)])]
    await tx.update(weldJoints).set({ revisionActuality: preview.active ? null : 'не актуален', weldingUpdatedAt: new Date(),
      updatedAt: sql`greatest(clock_timestamp(), ${weldJoints.updatedAt} + interval '1 millisecond')` }).where(buildNumberArrayMatch(weldJoints.id, ids))
    await markDispatcherTaskIndexDirty(tx, { scopes: getDispatcherDirtyScopes(group.rows, new Map()) })
  }
  return { changedCount: changes.length, removedRequestPositions: pendingRequests.length }
}

export async function setChainActualityInTransaction(tx: Tx, input: ChainActualityInput & { token: string; confirmed: boolean }) {
  return persistContext(tx, await prepareChainActualityInTransaction(tx, input))
}

/** Called before card writes, after locking both old/new line memberships. */
export async function prepareCardChainActuality(tx: Tx, rowId: number, confirmation: ChainActualityConfirmation | undefined, scope: string) {
  if (!confirmation) return null
  if (scope !== 'welding') throw new Error('Актуальность меняется только в карточке сварочного журнала.')
  return prepareChainActualityInTransaction(tx, { rowId, active: confirmation.active, token: confirmation.token, confirmed: confirmation.confirmed })
}

/** The card may legitimately move a control to another stage or remove its
 * assignment. Re-read after those writes: never overwrite a completed result
 * or remove a request which was not included in the user's confirmation. */
export async function finishCardChainActuality(tx: Tx, prepared: NonNullable<Awaited<ReturnType<typeof prepareCardChainActuality>>>) {
  const current = await readContext(tx, { rowId: prepared.preview.rowId, active: prepared.preview.active })
  if (current.preview.reason) throw new Error(current.preview.reason)
  if (current.group.rows.length !== prepared.group.rows.length || current.group.rows.some((row, i) => row.id !== prepared.group.rows[i].id)) throw new Error(changedMessage)
  const requestKey = (request: typeof current.pendingRequests[number]) => JSON.stringify([request.rowId, request.method, request.name, request.date])
  const confirmedRequests = new Set(prepared.pendingRequests.map(requestKey))
  if (current.pendingRequests.some(request => !confirmedRequests.has(requestKey(request)))) throw new Error(changedMessage)
  return persistContext(tx, current)
}

export const previewChainActuality = createServerFn({ method: 'POST' }).validator((data: ChainActualityInput & { page?: number }) => data).handler(async ({ data }) => {
  await assertSecurityScope('entry')
  return requireDb().transaction(tx => previewChainActualityInTransaction(tx, data))
})
