import type { RemoteGeneratedDocument } from '@/server/generated-documents'
import type { SystemDocumentSummary } from './system-document-types'
import { getSystemDocumentMethodCodes, getSystemDocumentStageLabel } from './system-document-stage'
function parseDate(value: unknown) {
  const raw = String(value ?? '').trim()
  if (!raw) return null

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) {
    return new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]))
  }

  const displayMatch = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  if (displayMatch) {
    return new Date(Number(displayMatch[3]), Number(displayMatch[2]) - 1, Number(displayMatch[1]))
  }

  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function formatDocumentDate(value: unknown) {
  const parsed = parseDate(value)
  if (!parsed) return String(value ?? '').trim()
  return `${String(parsed.getDate()).padStart(2, '0')}.${String(parsed.getMonth() + 1).padStart(2, '0')}.${parsed.getFullYear()}`
}

export function formatDocumentUpdatedAt(value: string) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
export function formatDocumentWdi(value: number | undefined) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(value) || 0)
}
export function generatedDocumentGridValue(key: string, record: RemoteGeneratedDocument, singleDate = false): string | number {
  switch (key) {
    case 'title': return record.title
    case 'stage': return record.stage ?? '-'
    case 'project': return record.projects.join(', ') || '-'
    case 'subtitle': return record.subtitleCodes.join(', ') || '-'
    case 'line': return record.lines.join(', ') || '-'
    case 'period': return singleDate ? formatDocumentDate(record.periodFrom ?? record.periodTo) : `${formatDocumentDate(record.periodFrom)} - ${formatDocumentDate(record.periodTo)}`
    case 'rowCount': return record.rowCount
    case 'wdi': return formatDocumentWdi(record.wdiTotal)
    case 'updatedAt': return formatDocumentUpdatedAt(record.updatedAt)
    case 'specialistFirst': case 'specialistSecond': return record.specialists?.[key === 'specialistFirst' ? 'first' : 'second']?.name || 'Не назначен'
    default: return ''
  }
}
export function systemDocumentGridValue(key: string, record: SystemDocumentSummary): string | number {
  switch (key) {
    case 'title': return record.title
    case 'method': return getSystemDocumentMethodCodes(record).join(', ') || '-'
    case 'stage': return getSystemDocumentStageLabel(record)
    case 'project': return record.projects.join(', ') || '-'
    case 'subtitle': return record.subtitleCodes.join(', ') || '-'
    case 'line': return record.lines.join(', ') || '-'
    case 'rowCount': return record.rowCount
    case 'date': return formatDocumentDate(record.date) || '-'
    case 'specialistFirst': case 'specialistSecond': return record.specialists?.[key === 'specialistFirst' ? 'first' : 'second']?.name || 'Не назначен'
    default: return ''
  }
}
