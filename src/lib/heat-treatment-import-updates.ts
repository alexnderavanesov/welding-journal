import { HEAT_TREATMENT_EDITABLE_FIELD_KEYS as heatTreatmentEditableFieldKeys } from '@/lib/report-config'
import {
  getHeatTreatmentImportKey,
  isSameImportValue,
  normalizeExistingRequestImportValue,
  normalizeHeatTreatmentImportValue,
} from '@/lib/report-import'
import { buildUniqueRowsByHeatTreatmentImportKey } from '@/lib/report-import-row-match'
import { hasText } from '@/lib/report-value-utils'
import { withAutoHeatTreatmentDiagrams } from '@/lib/psto-status'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'
import type { WeldRow } from '@/lib/dispatcher-types'

type RowWithId = WeldRow

export function buildHeatTreatmentImportUpdates(
  importedRecords: WeldInput[],
  heatTreatmentRows: RowWithId[],
  rows: RowWithId[],
  allowedPstoRequestNames: ReadonlySet<string>,
) {
  const rowsByKey = buildUniqueRowsByHeatTreatmentImportKey(heatTreatmentRows)

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

    for (const fieldKey of heatTreatmentEditableFieldKeys) {
      if (!(fieldKey in importedRecord)) continue
      const importedUpdate =
        fieldKey === 'pstoRequest'
          ? normalizeExistingRequestImportValue(importedRecord[fieldKey], allowedPstoRequestNames)
          : { skip: false, value: normalizeHeatTreatmentImportValue(fieldKey, importedRecord[fieldKey]) }
      if (importedUpdate.skip) continue
      const importedValue = importedUpdate.value
      if (fieldKey === 'pstoResult' && importedValue === 'проведено' && !hasText(nextRow.pstoRequest)) continue
      if (isSameImportValue(nextRow[fieldKey], importedValue)) continue

      nextRow = { ...nextRow, [fieldKey]: importedValue }
      changed = true
    }

    if (changed) proposedRowsById.set(currentRow.id, nextRow)
  }

  if (proposedRowsById.size === 0) {
    return { updatedRows: [], changedFieldKeys: [], matched, skipped }
  }

  const updatedIds = new Set(proposedRowsById.keys())
  const recalculatedRows = withAutoHeatTreatmentDiagrams(rows.map((row) => proposedRowsById.get(row.id) ?? row))
  const rowsById = new Map(rows.map((row) => [row.id, row]))
  const updatedRows: WeldRow[] = []
  const changedFieldKeys = new Set<WeldFieldKey>()

  for (const row of recalculatedRows) {
    if (!updatedIds.has(row.id)) continue
    const originalRow = rowsById.get(row.id)
    if (!originalRow) continue

    for (const fieldKey of heatTreatmentEditableFieldKeys) {
      if (!isSameImportValue(originalRow[fieldKey], row[fieldKey])) {
        changedFieldKeys.add(fieldKey)
      }
    }
    if (!isSameImportValue(originalRow.heatTreatmentDiagram, row.heatTreatmentDiagram)) {
      changedFieldKeys.add('heatTreatmentDiagram')
    }
    updatedRows.push(row as WeldRow)
  }

  return { updatedRows, changedFieldKeys: [...changedFieldKeys], matched, skipped }
}
