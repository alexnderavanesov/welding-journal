import { sql } from 'drizzle-orm'
import { generatedDocuments, pstoRepeatCycles, weldJoints } from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import { ALL_LNK_FIELD_METHODS as LNK_METHODS } from '@/lib/lnk-report-config'
import type { PstoRepeatCycleRecord } from '@/lib/psto-cycle'
import type { DocumentOperationSource } from '@/lib/system-document-operation'
import { REBUILD_POSITION_LIMIT } from '@/lib/system-document-rebuild-batch'
import { parseSystemDocumentMetadata } from './system-document-index'
import { assertRebuildFactBudget } from './system-document-rebuild-batch'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'
import { buildNumberArrayMatch } from './weld-request-utils'

export async function attachRebuildCyclePositions(tx: SystemDocumentSequenceTransaction, sources: DocumentOperationSource[]) {
  const cycleSources = sources.filter(source => source.document.sourceKind === 'pstoCycle' || source.document.sourceKind === 'pstoRepeat')
  if (!cycleSources.length) return
  const metadataRows = await tx.select({ id: generatedDocuments.id, sourceMetadata: generatedDocuments.sourceMetadata })
    .from(generatedDocuments).where(buildNumberArrayMatch(generatedDocuments.id, cycleSources.map(source => source.document.documentId)))
  const metadataById = new Map(metadataRows.map(row => [row.id, parseSystemDocumentMetadata(row.sourceMetadata)]))
  const cycleIds = [...new Set(metadataRows.flatMap(row => (metadataById.get(row.id)?.sourcePositions ?? [])
    .filter(position => position.kind === 'pstoRepeat' || Number(position.sequence) >= 2).map(position => position.relationId)))]
  const cyclesById = new Map<number, typeof pstoRepeatCycles.$inferSelect>()
  if (metadataRows.reduce((sum, row) => sum + (metadataById.get(row.id)?.sourcePositions.length ?? 0), 0) > REBUILD_POSITION_LIMIT) {
    throw new Error('Состав циклов вырос сверх лимита пакета. Обновите предварительный просмотр.')
  }
  await assertRebuildFactBudget(tx, [...new Set(sources.flatMap(source => source.document.rowIds))], cycleIds)
  for (let offset = 0; offset < cycleIds.length; offset += 5000) {
    const batch = await tx.select().from(pstoRepeatCycles)
      .where(buildNumberArrayMatch(pstoRepeatCycles.id, cycleIds.slice(offset, offset + 5000)))
    for (const cycle of batch) cyclesById.set(cycle.id, cycle)
  }
  for (const source of cycleSources) {
    const metadata = metadataById.get(source.document.documentId)
    if (!metadata || metadata.sourceKind !== source.document.sourceKind || !metadata.sourcePositions.length) {
      throw new Error(`Не найден точный состав циклов документа «${source.document.title}». Обновите предварительный просмотр.`)
    }
    const rowIds = new Set(source.rows.map(row => row.id))
    const positionRowIds = new Set(metadata.sourcePositions.map(position => position.weldJointId))
    if (rowIds.size !== source.document.rowIds.length || rowIds.size !== positionRowIds.size ||
      metadata.sourcePositions.some(position => !rowIds.has(position.weldJointId) || position.kind !== metadata.sourceKind)) {
      throw new Error(`Состав стыков и циклов документа «${source.document.title}» расходится. Обновите предварительный просмотр.`)
    }
    source.cyclePositions = metadata.sourcePositions.map(position => ({ position,
      ...(position.kind === 'pstoRepeat' || Number(position.sequence) >= 2 ? { cycle: cyclesById.get(position.relationId) } : {}),
    }))
  }
}

// Rebuilding names must not run general weld/cycle normalization: that can
// change legacy results, waiting labels or final status unrelated to naming.
export async function persistRebuildDocumentNames(
  tx: SystemDocumentSequenceTransaction, rows: WeldRow[], cycles: PstoRepeatCycleRecord[],
) {
  const primaryKeys = [...new Set([
    ...LNK_METHODS.flatMap(method => [method.requestKey, method.conclusionKey]),
    'pstoRequest', 'heatTreatmentDiagram',
  ])] as Array<keyof typeof weldJoints.$inferSelect>
  const cycleKeys = ['pstoRequest', 'heatTreatmentDiagram', 'tvmtRequest', 'tvmtConclusion'] as const
  for (const scope of [
    { table: weldJoints, records: rows, keys: primaryKeys, timestamps: ['lnkUpdatedAt', 'pstoUpdatedAt'] },
    { table: pstoRepeatCycles, records: cycles, keys: cycleKeys, timestamps: [] },
  ]) {
    const columns = [...scope.keys, ...scope.timestamps].map(key => ({ key,
      column: (scope.table as unknown as Record<string, { name: string }>)[key].name,
      type: (scope.timestamps as readonly string[]).includes(key) ? 'timestamptz' : 'text',
    }))
    for (let offset = 0; offset < scope.records.length; offset += 1000) {
      const records = scope.records.slice(offset, offset + 1000)
      const payload = records.map(record => ({ id: record.id, ...Object.fromEntries(columns.map(({ key, column }) =>
        [column, (record as unknown as Record<string, unknown>)[key] ?? null])) }))
      const result = await tx.execute(sql`
        update ${scope.table} as target set
          ${sql.join(columns.map(({ column }) => sql`${sql.identifier(column)} = renamed.${sql.identifier(column)}`), sql`, `)},
          updated_at = now()
        from jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) as renamed(
          id integer, ${sql.join(columns.map(({ column, type }) => sql`${sql.identifier(column)} ${sql.raw(type)}`), sql`, `)}
        ) where target.id = renamed.id returning target.id
      `)
      if (result.rows.length !== records.length) throw new Error('Документы или циклы изменились. Обновите предварительный просмотр.')
    }
  }
}
