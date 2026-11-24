import type { WeldInput, WeldFieldKey } from '@/lib/weld-fields'
import { excludeImportPreviewRows, type ReportImportPreview } from '@/lib/report-import-preview'
import { getLineProgramIdentityKey, getLineProgramMetadataConflicts, type LineProgramProperties, type LineProgramIdentity } from '@/lib/line-program'
import { parseLineProgramPercent } from '@/lib/line-program-calculation'

export type ImportLineProgram = LineProgramIdentity & Pick<LineProgramProperties, 'category' | 'groupName' | 'weldControlPercent'>
const labels = { category: 'Категория', groupName: 'Группа', weldControlPercent: 'Базовый процент' }

/** Checks complete merged preview records, including rows that already have other errors. */
export function addLineProgramImportErrors(preview: ReportImportPreview, programs: readonly ImportLineProgram[], previousRows: readonly WeldInput[] = []): ReportImportPreview {
  const byLine = new Map(programs.map((line) => [getLineProgramIdentityKey(line), line]))
  const previousById = new Map(previousRows.map((row) => [Number(row.id), row]))
  const newGroups = new Map<string, WeldInput[]>()
  for (const row of preview.records) {
    if (row.deleteRequested || !String(row.line ?? '').trim()) continue
    const key = getLineProgramIdentityKey(row)
    if (!byLine.has(key)) {
      const group = newGroups.get(key) ?? []
      group.push(row); newGroups.set(key, group)
    }
  }
  const conflictsByNewLine = new Map<string, Array<keyof typeof labels>>()
  for (const [key, rows] of newGroups) {
    conflictsByNewLine.set(key, (Object.keys(labels) as Array<keyof typeof labels>).filter((field) => {
      const values = rows.map((row) => String(row[field] ?? '').trim()).filter(Boolean)
      return new Set(values.map((value) => field === 'weldControlPercent' ? parseLineProgramPercent(value) : value.toLocaleLowerCase('ru'))).size > 1
    }))
  }
  const errors = preview.errors.map((error) => ({ ...error, fieldKeys: [...(error.fieldKeys ?? [])] }))
  const invalid = new Set<number>()
  const errorsByRow = new Map(errors.map(error => [error.rowNumber, error]))
  preview.records.forEach((row, index) => {
    if (row.deleteRequested) return
    const key = getLineProgramIdentityKey(row)
    const program = byLine.get(key)
    const fields = program ? getLineProgramMetadataConflicts(row, program, previousById.get(Number(row.id))) : conflictsByNewLine.get(key) ?? []
    if (!fields.length) return
    const rowNumber = preview.recordRowNumbers?.[index] ?? index + 2
    invalid.add(rowNumber)
    const message = `Программа линии «${row.line}»: ${fields.map((field) => labels[field]).join(', ')} — ${program ? 'значения не совпадают с программой' : 'противоречивые значения в импортируемых строках'}. Исправьте файл или программу линии.`
    const existing = errorsByRow.get(rowNumber)
    if (existing) {
      existing.message += ` ${message}`
      existing.fieldKeys = [...new Set<WeldFieldKey>([...existing.fieldKeys, ...fields])]
    } else errors.push({ rowNumber, id: row.id, title: `Стык ${row.joint ?? row.id ?? 'без номера'}`, message, fieldKeys: fields })
  })
  return invalid.size ? excludeImportPreviewRows(preview, errors, invalid) : preview
}
