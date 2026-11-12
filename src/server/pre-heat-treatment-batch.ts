import { prepareDocumentCreationIndex } from './document-name-conflicts'
import { sql } from 'drizzle-orm'
import { requireDb } from '@/db'
import { preHeatTreatmentControls, weldJoints } from '@/db/schema'
import type { PreHeatTreatmentFillOptions } from '@/lib/pre-heat-treatment-fill'
import { assertWorkflowSelectionLimit } from '@/lib/workflow-selection-limit'
import { hashJsonRecordTuple } from './json-record-token'
import { readPreHeatTreatmentChains, assertPreHeatTreatmentChainChange } from './pre-heat-treatment-chain'
import { lockPreHeatTreatmentFillCounters, savePreHeatTreatmentFillInTransaction } from './pre-heat-treatment-fill'
import { buildNumberArrayMatch } from './weld-request-utils'
import { removeSourcedSystemDocumentPositionsInTransaction } from './system-document-index'
import { persistPreHeatTreatmentTouchedRows } from './pre-heat-treatment-lnk-workflow'
import { markDispatcherTaskIndexDirty, getDispatcherDirtyScopes } from './dispatcher-task-index-dirty'
import { assertSecurityScope } from './security-functions'
import { requireContextPermission } from './access-payload'
import { beginDocumentSaveReceipt, finishDocumentSaveReceipt } from './document-save-receipt'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'

export type PreHeatTreatmentBatchRequest = { rowIds: number[]; required: boolean; token?: string; fill?: PreHeatTreatmentFillOptions }
const CHANGED = 'Состав цепочек, документы или настройки изменились. Ничего не сохранено. Повторите проверку НК до ТО.'

function normalize(input: PreHeatTreatmentBatchRequest) {
  if (!Array.isArray(input?.rowIds) || !input.rowIds.length || input.rowIds.some(id => !Number.isSafeInteger(id) || id <= 0)
    || typeof input.required !== 'boolean') throw new Error('Выберите стыки и действие НК до ТО.')
  const rowIds = [...new Set(input.rowIds)].sort((a, b) => a - b)
  assertWorkflowSelectionLimit(rowIds)
  if (input.fill && !input.required) throw new Error('Заполнение невозможно при снятии отметки.')
  return { ...input, rowIds }
}

/** All memberships are locked in a common order before any chain row/document.
 * Aggregate shared-document effects BEFORE deleting anything. */
export async function readPreHeatTreatmentBatch(tx: SystemDocumentSequenceTransaction, input: PreHeatTreatmentBatchRequest) {
  const data = normalize(input)
  await lockPreHeatTreatmentFillCounters(tx)
  const contexts = await readPreHeatTreatmentChains(tx, data.rowIds)
  const rows = contexts.flatMap(context => context.rows).sort((a, b) => a.id - b.id)
  const chains = contexts.map(context => {
    let reason: string | null = null
    try { assertPreHeatTreatmentChainChange(context, data.required) } catch (error) { reason = (error as Error).message }
    return { rootId: context.root.id, rootJoint: String(context.root.joint ?? context.root.id),
      location: [context.root.projectTitle, context.root.subtitleCode, context.root.line].filter(Boolean).join(' · '),
      required: context.required, reason, rows: context.rows.map(row => ({ id: row.id, joint: String(row.joint ?? row.id) })) }
  })
  const documents = new Map<number, { id: number; kind: 'request' | 'result'; name: string; date: string | null;
    removed: number; remaining: number; methods: string[] }>()
  for (const context of contexts) for (const affected of context.affectedDocuments) {
    const existing = documents.get(affected.document.id)
    if (existing) {
      existing.removed += affected.removed.length
      existing.remaining -= affected.removed.length
      existing.methods = [...new Set([...existing.methods, ...affected.removed.map(p => p.methodCode ?? '')])]
    } else documents.set(affected.document.id, { id: affected.document.id,
      kind: affected.document.type === 'system:lnkRequest' ? 'request' : 'result', name: affected.document.title,
      date: affected.document.periodFrom, removed: affected.removed.length, remaining: affected.remaining,
      methods: [...new Set(affected.removed.map(p => p.methodCode ?? ''))] })
  }
  const removals = data.required ? [] : [...documents.values()]
  const controls = data.required ? [] : rows.flatMap(row => (row.preHeatTreatmentControls ?? []).map(control => ({
    rowId: row.id, joint: String(row.joint ?? row.id), location: [row.projectTitle, row.subtitleCode, row.line].filter(Boolean).join(' · '),
    method: control.method, result: control.result, request: control.requestName, requestDate: control.requestDate,
    conclusion: control.conclusionName, conclusionDate: control.conclusionDate,
  })))
  const token = hashJsonRecordTuple([data.rowIds, data.required, contexts.map(context => context.token)])
  return { rows, chains, removals, controls, token, selectedCount: data.rowIds.length }
}

export async function previewPreHeatTreatmentBatch({ data }: { data: PreHeatTreatmentBatchRequest }) {
  await assertSecurityScope('entry')
  requireContextPermission('lnk.view')
  return requireDb().transaction(async tx => {
    const { rows, ...preview } = await readPreHeatTreatmentBatch(tx, data)
    return { ...preview, affectedCount: rows.length }
  })
}

export async function savePreHeatTreatmentBatch({ data: input }: { data: PreHeatTreatmentBatchRequest }) {
  const data = normalize(input)
  await assertSecurityScope('edit')
  requireContextPermission('lnk.view')
  requireContextPermission('welding.edit')
  if (data.fill) { requireContextPermission('lnk.edit'); await prepareDocumentCreationIndex(true) }
  return requireDb().transaction(async tx => {
    const receipt = await beginDocumentSaveReceipt(tx, data)
    const plan = await readPreHeatTreatmentBatch(tx, data)
    if (!data.token || plan.token !== data.token) throw new Error(CHANGED)
    const reasons = plan.chains.flatMap(chain => chain.reason ? [`${chain.location} · ${chain.rootJoint}: ${chain.reason}`] : [])
    if (reasons.length) throw new Error(reasons.join('\n'))
    const ids = plan.rows.map(row => row.id)
    if (!data.required && plan.controls.length) {
      requireContextPermission('lnk.delete')
      await removeSourcedSystemDocumentPositionsInTransaction({ tx, sourceKind: 'beforeHeatTreatment', weldJointIds: ids })
      await tx.delete(preHeatTreatmentControls).where(buildNumberArrayMatch(preHeatTreatmentControls.weldJointId, ids))
    }
    const rows = plan.rows.map(row => ({ ...row, preHeatTreatmentRequired: data.required,
      preHeatTreatmentControls: data.required ? row.preHeatTreatmentControls : [] }))
    const changedIds = rows.filter((row, index) => plan.rows[index].preHeatTreatmentRequired !== data.required).map(row => row.id)
    if (changedIds.length) await tx.update(weldJoints).set({ preHeatTreatmentRequired: data.required,
      weldingUpdatedAt: new Date(), updatedAt: sql`greatest(clock_timestamp(), ${weldJoints.updatedAt} + interval '1 millisecond')`,
    }).where(buildNumberArrayMatch(weldJoints.id, changedIds))
    const saved = data.fill ? await savePreHeatTreatmentFillInTransaction(tx, rows, data.fill)
      : { rows: await persistPreHeatTreatmentTouchedRows(tx, rows), references: [] }
    await markDispatcherTaskIndexDirty(tx, { scopes: getDispatcherDirtyScopes(rows, new Map()) })
    await finishDocumentSaveReceipt(tx, receipt, saved.references)
    return saved.rows
  })
}
