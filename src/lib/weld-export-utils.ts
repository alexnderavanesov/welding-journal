import { VISIBLE_FIELDS, type WeldField, type WeldInput } from './weld-fields'
import { parseDate, parseNumber } from './weld-import-parsers'
import { formatControlAvailabilityForExport } from './report-value-utils'

export function recordsToVisibleExportMatrix(records: WeldInput[], fields: readonly WeldField[] = VISIBLE_FIELDS) {
  return [
    fields.map((field) => field.label),
    ...records.map((record) =>
      fields.map((field) => {
        const value = record[field.key as keyof WeldInput]
        if (field.kind === 'boolean') return formatControlAvailabilityForExport(value)
        if (field.kind === 'date') return formatExportDate(value)
        if (field.key === 'wdi') return formatExportNumber(value)
        return value ?? ''
      }),
    ),
  ]
}

export function getExportColumnWidth(field: WeldField) {
  if (field.kind === 'date') return 12
  if (field.label.length <= 4) return 10
  return Math.min(Math.max(field.label.length + 4, 14), 28)
}

export function normalizeSheetName(value: string) {
  const sheetName = value.replace(/[:\\/?*[\]]/g, ' ').replace(/\s+/g, ' ').trim()
  return (sheetName || 'Отчет').slice(0, 31)
}

export function escapeXml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function formatExportDate(value: unknown) {
  const normalized = parseDate(value)
  if (!normalized) return ''
  const isoMatch = String(normalized).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!isoMatch) return normalized
  return `${isoMatch[3]}.${isoMatch[2]}.${isoMatch[1]}`
}

export function formatExportNumber(value: unknown) {
  const number = parseNumber(value)
  return number === null ? '' : number
}
