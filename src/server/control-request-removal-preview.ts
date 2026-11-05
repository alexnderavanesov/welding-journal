import { and, eq, inArray } from 'drizzle-orm'
import { requireDb } from '@/db'
import { generatedDocuments, generatedDocumentWeldJoints, weldJoints } from '@/db/schema'
import type { WeldInput } from '@/lib/weld-fields'
import type { WeldRowVersionTarget } from '@/lib/weld-row-version'
import type { ControlRequestRemoval } from '@/lib/control-request-removal-preview'
import { getClearedControlAssignments } from '@/lib/control-assignment-request-removal'
import { ALL_LNK_FIELD_METHODS } from '@/lib/lnk-report-config'
import { assertWeldImportRowLimit } from '@/lib/weld-import-limits'
import { parseSystemDocumentMetadata, lockSystemDocumentIndexes } from './system-document-index'
import { lockLayeredControlDocumentsForWeldChange } from './layered-control-documents'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'
import { hashJsonRecordTuple } from './json-record-token'
import { buildNumberArrayMatch } from './weld-request-utils'
import { assertSecurityScope } from './security-functions'
import { loadPreviousWeldRows } from './weld-save-validation'
import { assertExpectedInteractiveWeldVersions } from './weld-row-version'

export type ControlRequestRemovalPreviewRequest = {
  records: WeldInput[]
  expectedVersions: WeldRowVersionTarget[]
  deleteIds?: number[]
}
const requestTypes = ['system:lnkRequest', 'system:tvmtRequest', 'system:pstoRequest']
const text = (value: unknown) => String(value ?? '').trim()

/** Reads only stored request membership; never trusts a client's request fields or relations. */
export async function loadControlRequestRemovalPreview(
  tx: SystemDocumentSequenceTransaction,
  records: readonly WeldInput[],
  previousRows: ReadonlyMap<number, WeldInput>,
  deleteIds: readonly number[] = [],
) {
  const cleared = new Map(records.flatMap(record => {
    const previous = previousRows.get(Number(record.id))
    if (!previous) return []
    const fields = getClearedControlAssignments({ ...previous, ...record }, previous)
    return fields.length ? [[Number(record.id), new Set(fields)] as const] : []
  }))
  const deleted = new Set(deleteIds)
  const ids = [...new Set([...cleared.keys(), ...deleted])]
  if (!ids.length) return { removals: [] as ControlRequestRemoval[], token: hashJsonRecordTuple([]) }
  const linked = await tx.select({ document: generatedDocuments }).from(generatedDocumentWeldJoints)
    .innerJoin(generatedDocuments, eq(generatedDocuments.id, generatedDocumentWeldJoints.documentId))
    .where(and(buildNumberArrayMatch(generatedDocumentWeldJoints.weldJointId, ids), inArray(generatedDocuments.type, requestTypes)))
  const documents = [...new Map(linked.map(({ document }) => [document.id, document])).values()].sort((a, b) => a.id - b.id)
  const primaryIds = documents.filter(document => !parseSystemDocumentMetadata(document.sourceMetadata)?.sourceKind).map(document => document.id)
  const memberships = primaryIds.length ? await tx.select({ documentId: generatedDocumentWeldJoints.documentId, row: {
    id: weldJoints.id, joint: weldJoints.joint,
    ...Object.fromEntries(ALL_LNK_FIELD_METHODS.flatMap(method => [[method.requestKey, weldJoints[method.requestKey]], [method.requestDateKey, weldJoints[method.requestDateKey]]])),
    pstoRequest: weldJoints.pstoRequest, pstoRequestDate: weldJoints.pstoRequestDate,
  } }).from(generatedDocumentWeldJoints).innerJoin(weldJoints, eq(weldJoints.id, generatedDocumentWeldJoints.weldJointId))
    .where(buildNumberArrayMatch(generatedDocumentWeldJoints.documentId, primaryIds)) : []
  const primaryByDocument = new Map<number, WeldInput[]>()
  for (const { documentId, row } of memberships) {
    const bucket = primaryByDocument.get(documentId) ?? []
    bucket.push(row as WeldInput); primaryByDocument.set(documentId, bucket)
  }
  const removals: ControlRequestRemoval[] = [], versions: unknown[] = []
  for (const document of documents) {
    const metadata = parseSystemDocumentMetadata(document.sourceMetadata)
    const psto = document.type === 'system:pstoRequest'
    const positions = metadata?.sourceKind
      ? metadata.sourcePositions.map(position => ({ rowId: position.weldJointId,
          method: psto ? 'ПСТО' : position.methodCode || metadata.methodCode || (document.type === 'system:tvmtRequest' ? 'ТВМТ' : ''),
          stage: position.kind === 'beforeHeatTreatment' ? 'до ТО' : `цикл ${position.sequence ?? 1}`,
          pre: position.kind === 'beforeHeatTreatment',
        }))
      : (primaryByDocument.get(document.id) ?? []).flatMap(row => {
          if (psto) return text(row.pstoRequest) === document.title && text(row.pstoRequestDate) === (document.periodFrom ?? '') ? [{ rowId: Number(row.id), method: 'ПСТО', stage: '', pre: false }] : []
          return ALL_LNK_FIELD_METHODS.filter(method => (method.code === 'ТВМТ') === (document.type === 'system:tvmtRequest') &&
            text(row[method.requestKey]) === document.title && text(row[method.requestDateKey]) === (document.periodFrom ?? ''))
            .map(method => ({ rowId: Number(row.id), method: method.code as string, stage: '', pre: false }))
        })
    positions.sort((a, b) => a.rowId - b.rowId || a.method.localeCompare(b.method) || a.stage.localeCompare(b.stage))
    const removed = positions.filter(position => {
      if (deleted.has(position.rowId)) return true
      const fields = cleared.get(position.rowId)
      if (!fields) return false
      if (fields.has('pstoRequired') && (position.pre || ['ПСТО', 'ТВМТ'].includes(position.method))) return true
      return ALL_LNK_FIELD_METHODS.some(method => method.code === position.method && fields.has(method.enabledKey))
    })
    if (!removed.length) continue
    const labels = removed.map(position => `${previousRows.get(position.rowId)?.joint ?? position.rowId} · ${position.method}${position.stage ? ` · ${position.stage}` : ''}`).sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }))
    removals.push({ documentId: document.id, title: document.title, date: document.periodFrom ?? '', positions: labels, remaining: positions.length - removed.length })
    versions.push([document.id, document.updatedAt.toISOString(), document.sourceMetadata, removed, positions.length])
  }
  return { removals, token: hashJsonRecordTuple([versions]) }
}

/** Called under the same locks/order as document synchronization, before any writes. */
export async function assertControlRequestRemovalPreview(tx: SystemDocumentSequenceTransaction, records: readonly WeldInput[], previousRows: ReadonlyMap<number, WeldInput>, token?: string, deleteIds?: readonly number[]) {
  if (token === undefined) return
  await lockLayeredControlDocumentsForWeldChange(tx)
  await lockSystemDocumentIndexes(tx)
  const current = await loadControlRequestRemovalPreview(tx, records, previousRows, deleteIds)
  if (current.token !== token) throw new Error('Состав заявок изменился после подтверждения. Ничего не сохранено. Повторите сохранение и проверьте новые последствия.')
}

export async function previewControlRequestRemoval({ data }: { data: ControlRequestRemovalPreviewRequest }) {
  await assertSecurityScope('edit')
  assertWeldImportRowLimit(data.records.length + (data.deleteIds?.length ?? 0))
  const ids = [...data.records.map(row => Number(row.id)), ...(data.deleteIds ?? [])]
  if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('Передайте существующие стыки без повторов.')
  return requireDb().transaction(async tx => {
    const previous = await loadPreviousWeldRows(tx, ids.map(id => ({ id })))
    assertExpectedInteractiveWeldVersions(ids, data.expectedVersions, [...previous.values()])
    // Only assignment values are relevant; no submitted result can suppress a position.
    const assignments = [...ALL_LNK_FIELD_METHODS.map(method => method.enabledKey), 'pstoRequired'] as const
    const records = data.records.map(row => ({ id: row.id, ...Object.fromEntries(assignments.filter(key => Object.hasOwn(row, key)).map(key => [key, row[key]])) }))
    return loadControlRequestRemovalPreview(tx, records, previous, data.deleteIds)
  })
}
