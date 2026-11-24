import type { WeldInput, WeldFieldKey } from './weld-fields'
import { excludeImportPreviewRows, type ReportImportPreview, type ReportImportPreviewError } from './report-import-preview'
import { OFFICIAL_STAMP_VALIDATION_FIELD_KEYS, shouldValidateOfficialStampCompatibilityForSave } from './welder-stamp-compatibility-validation'

export type ImportStampInput = Pick<WeldInput, typeof OFFICIAL_STAMP_VALIDATION_FIELD_KEYS[number]>
export type ImportStampIssue = { index: number; fieldKey: WeldFieldKey; message: string }

export async function reviewImportStamps(
  preview: ReportImportPreview,
  previous: readonly WeldInput[],
  check: (records: ImportStampInput[]) => Promise<ImportStampIssue[]>,
): Promise<ReportImportPreview> {
  const previousById = new Map(previous.map(row => [row.id, row]))
  const inputs: ImportStampInput[] = []
  const inputByKey = new Map<string, number>()
  const indexes = preview.records.map(row => {
    if (row.deleteRequested || !(row.stamp1K || row.stamp1Z) ||
      !shouldValidateOfficialStampCompatibilityForSave(row, (row.id ? previousById.get(row.id) : undefined))) return -1
    const input = Object.fromEntries(OFFICIAL_STAMP_VALIDATION_FIELD_KEYS.map(key => [key, row[key] ?? null]))
    const key = JSON.stringify(input)
    let index = inputByKey.get(key)
    if (index === undefined) {
      index = inputs.length
      inputByKey.set(key, index)
      inputs.push(input)
    }
    return index
  })
  if (!inputs.length) return preview
  const issuesByInput = new Map<number, ImportStampIssue[]>()
  for (const issue of await check(inputs)) {
    const group = issuesByInput.get(issue.index)
    if (group) group.push(issue)
    else issuesByInput.set(issue.index, [issue])
  }
  if (!issuesByInput.size) return preview
  const invalidNumbers = new Set<number>()
  const errors = new Map<number, ReportImportPreviewError>(preview.errors.map(error => [error.rowNumber, error]))
  indexes.forEach((input, index) => {
    const issues = issuesByInput.get(input)
    if (!issues) return
    const row = preview.records[index]
    const rowNumber = preview.recordRowNumbers?.[index] ?? index + 2
    invalidNumbers.add(rowNumber)
    const old = errors.get(rowNumber)
    const invalidStampFields = [...new Set(issues.map(issue => issue.fieldKey))]
    errors.set(rowNumber, {
      rowNumber, id: row.id, title: old?.title ?? `Стык ${row.joint ?? row.id ?? 'без номера'}`,
      message: [...new Set([old?.message, ...issues.map(issue => issue.message)].filter(Boolean))].join(' '),
      invalidStampFields,
      fieldKeys: [...new Set([...(old?.fieldKeys ?? []), ...invalidStampFields])],
    })
  })
  return excludeImportPreviewRows(preview, Array.from(errors.values()).sort((a, b) => a.rowNumber - b.rowNumber), invalidNumbers)
}
