import { and, asc, eq, sql } from 'drizzle-orm'
import { requireDb } from '@/db'
import { generatedDocuments, generatedDocumentWeldJoints, preHeatTreatmentControls, weldJoints } from '@/db/schema'
import { isControlEnabledValue } from '@/lib/control-availability-values'
import type { PreHeatTreatmentConfirmation } from '@/lib/pre-heat-treatment-change'
import { loadPhysicalChainContext } from './physical-chain-context'
import { loadControlProcessSettingsFromTransaction } from './control-process-settings'
import { attachHeatTreatmentControlRelations } from './heat-treatment-control-relations'
import { attachDuplicateControlRelations } from './duplicate-control-relations'
import { hashJsonRecordTuple } from './json-record-token'
import { buildNumberArrayMatch } from './weld-request-utils'
import { lockSystemDocumentIndexes, parseSystemDocumentMetadata, removeSourcedSystemDocumentPositionsInTransaction } from './system-document-index'
import { lockLayeredControlDocumentsForWeldChange } from './layered-control-documents'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'
import { requireContextPermission } from './access-payload'
import { assertSecurityScope } from './security-functions'
import { persistPreHeatTreatmentTouchedRows } from './pre-heat-treatment-lnk-workflow'
import { getDispatcherDirtyScopes, markDispatcherTaskIndexDirty } from './dispatcher-task-index-dirty'

type Tx = SystemDocumentSequenceTransaction
export const PRE_HEAT_CHAIN_CHANGED = 'Данные для НК до ТО изменились после подтверждения. Ничего не сохранено. Откройте карточку стыка заново, повторите изменение НК до ТО и нажмите «Сохранить».'

export async function readPreHeatTreatmentChain(tx: Tx, rowId: number) {
  const settings = await loadControlProcessSettingsFromTransaction(tx)
  const chain = await loadPhysicalChainContext(tx, rowId)
  const rows = await attachDuplicateControlRelations(await attachHeatTreatmentControlRelations(chain.locked, tx), tx)
  const root = rows.find(row => row.id === chain.group.id)!
  if (!root) throw new Error('Исходный стык цепочки не найден.')
  const controls = rows.flatMap(row => row.preHeatTreatmentControls ?? [])
  // Shared documents are versioned as whole documents, including foreign positions.
  if (controls.length) {
    await lockLayeredControlDocumentsForWeldChange(tx)
    await lockSystemDocumentIndexes(tx)
  }
  const documents = controls.length ? await tx.select({ document: generatedDocuments })
    .from(generatedDocuments).where(and(
      sql`case when ${generatedDocuments.sourceMetadata} is json then ${generatedDocuments.sourceMetadata}::jsonb ->> 'sourceKind' = 'beforeHeatTreatment' else false end`,
      sql`exists (select 1 from ${generatedDocumentWeldJoints} where ${generatedDocumentWeldJoints.documentId} = ${generatedDocuments.id}
        and ${buildNumberArrayMatch(generatedDocumentWeldJoints.weldJointId, chain.ids)})`,
    )).orderBy(asc(generatedDocuments.id)) : []
  const idSet = new Set(chain.ids)
  const affectedDocuments = [...new Map(documents.map(item => [item.document.id, item.document])).values()].flatMap(document => {
    const metadata = parseSystemDocumentMetadata(document.sourceMetadata)
    if (metadata?.sourceKind !== 'beforeHeatTreatment') return []
    const removed = metadata.sourcePositions.filter(position => position.kind === 'beforeHeatTreatment' && idSet.has(position.weldJointId))
    if (!removed.length) return []
    return [{ document, removed, remaining: metadata.sourcePositions.length - removed.length }]
  })
  const rejections = controls.filter(control => ['ремонт', 'вырез'].includes(String(control.result ?? '').trim().toLowerCase()))
  const token = hashJsonRecordTuple([settings, chain.settings, rows, chain.linked, affectedDocuments])
  const required = root.preHeatTreatmentRequired === true || settings.preHeatTreatmentMode === 'allPsto' && (isControlEnabledValue(root.pstoRequired) || controls.length > 0)
  return { chain, settings, rows, root, controls, rejections, affectedDocuments, token, required }
}

export function assertPreHeatTreatmentChainChange(context: Awaited<ReturnType<typeof readPreHeatTreatmentChain>>, required: boolean) {
  const { chain, root, settings, rejections } = context
  if (chain.reason) throw new Error(chain.reason)
  if (settings.preHeatTreatmentMode === 'allPsto' && isControlEnabledValue(root.pstoRequired)) {
    throw new Error('НК до ТО обязателен по настройкам проекта. Для индивидуальной настройки выберите режим «На выбранных стыках».')
  }
  if (required && !isControlEnabledValue(root.pstoRequired)) throw new Error('На линии исходного стыка ПСТО не назначено. Включить НК до ТО нельзя.')
  if (!required && rejections.length) {
    const labels = rejections.map(control => `${context.rows.find(row => row.id === control.weldJointId)?.joint ?? control.weldJointId}: ${control.method} — ${control.result}`)
    throw new Error(`НК до ТО нельзя отключить: ${labels.join('; ')}. Сначала исправьте предварительный результат отдельной штатной операцией.`)
  }
}

export async function prepareCardPreHeatTreatment(tx: Tx, rowId: number, confirmation: PreHeatTreatmentConfirmation | undefined, scope: string) {
  if (!confirmation) return null
  if (scope !== 'welding') throw new Error('Требование НК до ТО меняется только в карточке исходного стыка сварочного журнала.')
  requireContextPermission('welding.edit')
  if (typeof confirmation.required !== 'boolean' || !/^[a-f0-9]{64}$/.test(confirmation.token)) throw new Error('Проверьте и подтвердите изменение НК до ТО.')
  const context = await readPreHeatTreatmentChain(tx, rowId)
  if (context.root.id !== rowId) throw new Error(`НК до ТО настраивается в карточке исходного стыка ${context.root.joint}.`)
  if (context.token !== confirmation.token) throw new Error(PRE_HEAT_CHAIN_CHANGED)
  assertPreHeatTreatmentChainChange(context, confirmation.required)
  if (!confirmation.required && context.controls.length) {
    requireContextPermission('lnk.view')
    requireContextPermission('lnk.delete')
  }
  if (confirmation.fill) {
    requireContextPermission('lnk.edit')
    if (!confirmation.required) throw new Error('Заполнение невозможно при отключении этапа.')
    const { planPreHeatTreatmentFill } = await import('./pre-heat-treatment-fill')
    const plan = await planPreHeatTreatmentFill(tx, context.rows.map(row => ({ ...row, preHeatTreatmentRequired: true })), confirmation.fill)
    if (plan.token !== confirmation.fill.token) throw new Error(PRE_HEAT_CHAIN_CHANGED)
  }
  return { context, confirmation }
}

export async function finishCardPreHeatTreatment(tx: Tx, prepared: NonNullable<Awaited<ReturnType<typeof prepareCardPreHeatTreatment>>>) {
  const { context: previous, confirmation } = prepared
  const current = await readPreHeatTreatmentChain(tx, previous.root.id)
  // Other card edits may change dates/line/assignments, but cannot add deletions
  // or change the confirmed physical membership and control/document history.
  if (JSON.stringify(current.chain.ids) !== JSON.stringify(previous.chain.ids) ||
    hashJsonRecordTuple([current.controls, current.affectedDocuments]) !== hashJsonRecordTuple([previous.controls, previous.affectedDocuments])) throw new Error(PRE_HEAT_CHAIN_CHANGED)
  assertPreHeatTreatmentChainChange(current, confirmation.required)
  if (!confirmation.required && current.controls.length) {
    await removeSourcedSystemDocumentPositionsInTransaction({ tx, sourceKind: 'beforeHeatTreatment', weldJointIds: current.chain.ids })
    await tx.delete(preHeatTreatmentControls).where(buildNumberArrayMatch(preHeatTreatmentControls.weldJointId, current.chain.ids))
  }
  await tx.update(weldJoints).set({ preHeatTreatmentRequired: confirmation.required,
    weldingUpdatedAt: new Date(), updatedAt: sql`greatest(clock_timestamp(), ${weldJoints.updatedAt} + interval '1 millisecond')`,
  }).where(buildNumberArrayMatch(weldJoints.id, current.chain.ids))
  const rows = current.rows.map(row => ({ ...row, preHeatTreatmentRequired: confirmation.required,
    preHeatTreatmentControls: confirmation.required ? row.preHeatTreatmentControls : [] }))
  if (confirmation.fill) {
    const { savePreHeatTreatmentFillInTransaction } = await import('./pre-heat-treatment-fill')
    await savePreHeatTreatmentFillInTransaction(tx, rows, confirmation.fill, true)
  } else await persistPreHeatTreatmentTouchedRows(tx, rows)
  await markDispatcherTaskIndexDirty(tx, { scopes: getDispatcherDirtyScopes(rows, new Map()) })
}

export async function previewPreHeatTreatmentChain({ data }: { data: { rowId: number; required?: boolean } }) {
    await assertSecurityScope('entry')
    return requireDb().transaction(async tx => {
      const context = await readPreHeatTreatmentChain(tx, data.rowId)
      let reason = context.chain.reason
      if (typeof data.required === 'boolean') {
        try { assertPreHeatTreatmentChainChange(context, data.required) } catch (error) { reason = (error as Error).message }
      }
      if (data.required === false && context.controls.length) requireContextPermission('lnk.view')
      return {
        rootId: context.root.id, rootJoint: String(context.root.joint ?? context.root.id), required: context.required,
        applicable: isControlEnabledValue(context.root.pstoRequired), mode: context.settings.preHeatTreatmentMode,
        token: context.token, reason, rows: context.rows.map(row => ({ id: row.id, joint: String(row.joint ?? row.id) })),
        removals: data.required === false ? context.affectedDocuments.map(({ document, removed, remaining }) => ({
          id: document.id, kind: document.type === 'system:lnkRequest' ? 'request' as const : 'result' as const, name: document.title, date: document.periodFrom, removed: removed.length, remaining,
          methods: [...new Set(removed.map(position => position.methodCode))],
        })) : [],
        controls: data.required === false ? context.controls.map(control => ({ rowId: control.weldJointId, method: control.method,
          result: control.result, request: control.requestName, requestDate: control.requestDate, conclusion: control.conclusionName, date: control.conclusionDate })) : [],
      }
    })
  }
