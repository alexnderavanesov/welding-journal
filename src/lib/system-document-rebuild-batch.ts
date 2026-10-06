/** Server ceilings, not a truncation of a document's contents. */
export const REBUILD_DOCUMENT_LIMIT = 200
export const REBUILD_POSITION_LIMIT = 60_000
export const REBUILD_METADATA_LIMIT = 8 * 1024 * 1024
export const REBUILD_FACT_BYTES_LIMIT = 64 * 1024 * 1024
export const REBUILD_PREVIEW_BYTES_LIMIT = 8 * 1024 * 1024

export type RebuildCursor = { afterId: number; throughId: number }
export type RebuildBatch = {
  cursor: RebuildCursor
  nextCursor: RebuildCursor | null
  documentIds: number[]
  blocked: Array<{ documentId: number; title: string; reason: string }>
  documentLimit: number
  positionLimit: number
}
export type RebuildCatalogSize = { documentId: number; title: string; positionCount: number; metadataBytes: number; factBytes?: number }

export function normalizeRebuildCursor(value: unknown): RebuildCursor | undefined {
  if (value == null) return undefined
  const cursor = value as Partial<RebuildCursor>
  if (!Number.isSafeInteger(cursor.afterId) || !Number.isSafeInteger(cursor.throughId) ||
    cursor.afterId! < 0 || cursor.throughId! < cursor.afterId!) throw new Error('Некорректная область пакета. Откройте пересборку заново.')
  return { afterId: cursor.afterId!, throughId: cursor.throughId! }
}

export function selectRebuildBatch(entries: RebuildCatalogSize[], cursor: RebuildCursor, limit = REBUILD_DOCUMENT_LIMIT): RebuildBatch {
  const batch: RebuildBatch = { cursor, nextCursor: null, documentIds: [], blocked: [], documentLimit: limit, positionLimit: REBUILD_POSITION_LIMIT }
  let positions = 0, bytes = 0, facts = 0, lastId = cursor.afterId, checked = 0
  for (const entry of entries) {
    if (checked >= limit) break
    const factBytes = Number(entry.factBytes ?? 0)
    if (entry.positionCount > REBUILD_POSITION_LIMIT || entry.metadataBytes > REBUILD_METADATA_LIMIT || factBytes > REBUILD_FACT_BYTES_LIMIT) {
      batch.blocked.push({ documentId: entry.documentId, title: entry.title,
        reason: `Документ превышает безопасный объём пакета (${REBUILD_POSITION_LIMIT} позиций, 8 МиБ состава или 64 МиБ фактов). Он оставлен без изменений; частичная пересборка не выполняется.` })
    } else {
      if (positions + entry.positionCount > REBUILD_POSITION_LIMIT || bytes + entry.metadataBytes > REBUILD_METADATA_LIMIT || facts + factBytes > REBUILD_FACT_BYTES_LIMIT) break
      batch.documentIds.push(entry.documentId)
      positions += entry.positionCount
      bytes += entry.metadataBytes
      facts += factBytes
    }
    checked += 1
    lastId = entry.documentId
  }
  if (entries.some(entry => entry.documentId > lastId)) batch.nextCursor = { afterId: lastId, throughId: cursor.throughId }
  return batch
}
