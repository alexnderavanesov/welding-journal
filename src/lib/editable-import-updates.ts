import {
  getHeatTreatmentImportKey,
  isSameImportValue,
  normalizeEditableImportValue,
} from '@/lib/report-import'
import { buildUniqueRowsByHeatTreatmentImportKey } from '@/lib/report-import-row-match'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'
import type { WeldRow } from '@/lib/dispatcher-types'

type RowWithId = WeldRow

export function buildEditableImportUpdates({
  importedRecords,
  targetRows,
  rows,
  editableFieldKeys,
  normalizeValue,
  transformRow,
}: {
  importedRecords: WeldInput[]
  targetRows: RowWithId[]
  rows: RowWithId[]
  editableFieldKeys: ReadonlySet<WeldFieldKey>
  normalizeValue?: (
    fieldKey: WeldFieldKey,
    value: unknown,
    currentRow: RowWithId,
  ) => { skip: boolean; value: unknown }
  transformRow?: (row: RowWithId) => RowWithId
}) {
  const rowsByKey = buildUniqueRowsByHeatTreatmentImportKey(targetRows)

  const proposedRowsById = new Map<number, RowWithId>()
  let matched = 0
  let skipped = 0

  for (const importedRecord of importedRecords) {
    const key = getHeatTreatmentImportKey(importedRecord)
    const currentRow = key ? rowsByKey.get(key) : null
    if (!currentRow) {
      skipped += 1
      continue
    }

    matched += 1
    let nextRow: RowWithId = { ...currentRow }
    let changed = false

    for (const fieldKey of editableFieldKeys) {
      if (!(fieldKey in importedRecord)) continue
      const importedUpdate = normalizeValue
        ? normalizeValue(fieldKey, importedRecord[fieldKey], currentRow)
        : { skip: false, value: normalizeEditableImportValue(fieldKey, importedRecord[fieldKey]) }
      if (importedUpdate.skip) continue
      const importedValue = importedUpdate.value
      if (isSameImportValue(nextRow[fieldKey], importedValue)) continue
      nextRow = { ...nextRow, [fieldKey]: importedValue }
      changed = true
    }

    if (changed) proposedRowsById.set(currentRow.id, transformRow ? transformRow(nextRow) : nextRow)
  }

  const rowsById = new Map(rows.map((row) => [row.id, row]))
  const updatedRows: WeldRow[] = []
  const changedFieldKeys = new Set<WeldFieldKey>()

  for (const row of proposedRowsById.values()) {
    const originalRow = rowsById.get(row.id)
    if (!originalRow) continue

    for (const fieldKey of editableFieldKeys) {
      if (!isSameImportValue(originalRow[fieldKey], row[fieldKey])) {
        changedFieldKeys.add(fieldKey)
      }
    }
    if (!isSameImportValue(originalRow.finalStatus, row.finalStatus)) {
      changedFieldKeys.add('finalStatus')
    }
    updatedRows.push(row as WeldRow)
  }

  return { updatedRows, changedFieldKeys: [...changedFieldKeys], matched, skipped }
}
