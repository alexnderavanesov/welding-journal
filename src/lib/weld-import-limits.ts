export const WELD_IMPORT_MAX_ROWS = 2000

// A weld row contains many columns. Keeping inserts small prevents PostgreSQL's
// bind-parameter limit from being reached while the surrounding transaction
// still makes the whole import atomic.
export const WELD_IMPORT_INSERT_BATCH_SIZE = 100

export function assertWeldImportRowLimit(rowCount: number) {
  if (rowCount <= WELD_IMPORT_MAX_ROWS) return
  throw new Error(
    `В одном файле можно обработать не более ${WELD_IMPORT_MAX_ROWS} строк. ` +
      `Найдено: ${rowCount}. Разделите файл на несколько частей.`,
  )
}

export function splitWeldImportInsertBatches<T>(records: readonly T[], batchSize = WELD_IMPORT_INSERT_BATCH_SIZE) {
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error('Размер пакета импорта должен быть положительным целым числом.')
  }

  const batches: T[][] = []
  for (let start = 0; start < records.length; start += batchSize) {
    batches.push(records.slice(start, start + batchSize))
  }
  return batches
}

export function assertUniqueWeldMutationTargets(
  records: ReadonlyArray<{ id?: unknown }>,
  deleteIds: readonly number[] = [],
) {
  const recordIds = records.map((record) => Number(record.id))
  const seenRecordIds = new Set<number>()
  for (const id of recordIds) {
    if (!Number.isInteger(id) || id <= 0) continue
    if (seenRecordIds.has(id)) {
      throw new Error(`Запись с ID ${id} передана на обновление несколько раз.`)
    }
    seenRecordIds.add(id)
  }

  const overlappingId = deleteIds.find((id) => seenRecordIds.has(id))
  if (overlappingId !== undefined) {
    throw new Error(`Запись с ID ${overlappingId} нельзя одновременно обновить и удалить.`)
  }
}

export function compactWeldWritePayload<T extends Record<string, unknown>>(record: T): T {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== null && value !== undefined && value !== ''),
  ) as T
}
