import type { WeldRow } from '@/lib/dispatcher-types'
import type { PreHeatTreatmentControlRecord } from '@/lib/lnk-control-stage'
import { buildSystemDocumentSummaries } from '@/lib/system-document-types'
import { buildPreHeatTreatmentSystemDocumentRow } from '@/lib/system-document-virtual-row'
import { upsertSourcedSystemDocumentsInTransaction } from '@/server/system-document-index'
import type { SystemDocumentSequenceTransaction } from '@/server/system-document-sequences'

export async function syncPreHeatTreatmentDocumentsInTransaction(
  tx: SystemDocumentSequenceTransaction,
  rows: WeldRow[],
  controls: PreHeatTreatmentControlRecord[],
) {
  if (controls.length === 0) return
  const rowsById = new Map(rows.map((row) => [row.id, row]))
  const controlsByRowId = groupByRowId(controls)
  const virtualRows = [...controlsByRowId].map(([rowId, rowControls]) => {
    const row = rowsById.get(rowId)
    if (!row) throw new Error(`Стык #${rowId} для документа НК до ТО не найден.`)
    return buildPreHeatTreatmentSystemDocumentRow(row, rowControls)
  })

  const documents = [] as Parameters<typeof upsertSourcedSystemDocumentsInTransaction>[0]['documents'][number][]
  const controlsByDocument = indexPreHeatTreatmentDocumentControls(controls)
  for (const type of ['lnkRequest', 'lnkConclusion'] as const) {
    for (const summary of buildSystemDocumentSummaries(virtualRows, type)) {
      const documentControls = type === 'lnkRequest'
        ? controlsByDocument.requests.get(JSON.stringify([summary.title, summary.date])) ?? []
        : controlsByDocument.conclusions.get(JSON.stringify([summary.title, summary.date, summary.methodCode])) ?? []
      documents.push({
        summary: { ...summary, sourceKind: 'beforeHeatTreatment' },
        sourcePositions: documentControls.map((control) => ({
          kind: 'beforeHeatTreatment' as const,
          weldJointId: control.weldJointId,
          relationId: control.id,
          methodCode: control.method,
        })),
      })
    }
  }
  await upsertSourcedSystemDocumentsInTransaction({ tx, documents })
}

/** One pass across positions, even when every weld has a separate document. */
export function indexPreHeatTreatmentDocumentControls(controls: readonly PreHeatTreatmentControlRecord[]) {
  const requests = new Map<string, PreHeatTreatmentControlRecord[]>()
  const conclusions = new Map<string, PreHeatTreatmentControlRecord[]>()
  const add = (index: typeof requests, key: string, control: PreHeatTreatmentControlRecord) => {
    const group = index.get(key) ?? []
    group.push(control); index.set(key, group)
  }
  for (const control of controls) {
    add(requests, JSON.stringify([text(control.requestName), text(control.requestDate)]), control)
    add(conclusions, JSON.stringify([text(control.conclusionName), text(control.conclusionDate), text(control.method)]), control)
  }
  return { requests, conclusions }
}

function groupByRowId<Row extends { weldJointId: number }>(records: Row[]) {
  const groups = new Map<number, Row[]>()
  for (const record of records) {
    const current = groups.get(record.weldJointId) ?? []
    current.push(record)
    groups.set(record.weldJointId, current)
  }
  return groups
}

function text(value: unknown) {
  return String(value ?? '').trim()
}
