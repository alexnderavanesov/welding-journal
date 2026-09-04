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
  for (const type of ['lnkRequest', 'lnkConclusion'] as const) {
    for (const summary of buildSystemDocumentSummaries(virtualRows, type)) {
      const documentControls = controls.filter((control) => (
        type === 'lnkRequest'
          ? text(control.requestName) === summary.title && text(control.requestDate) === summary.date
          : text(control.method) === summary.methodCode &&
            text(control.conclusionName) === summary.title &&
            text(control.conclusionDate) === summary.date
      ))
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
