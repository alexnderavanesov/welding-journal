import { formatPstoDiagramDate } from '@/lib/date-format'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getPstoResultValue } from '@/lib/report-import'
import { hasText, isYesText } from '@/lib/report-value-utils'
import { escapeRegExp } from '@/lib/string-utils'
import type { WeldInput } from '@/lib/weld-fields'

export function canCreatePstoRequest(row: WeldInput) {
  return isYesText(row.pstoRequired) && !hasText(row.pstoRequest)
}

export function buildPstoWaitingRequestRows(rows: WeldRow[]) {
  return rows
    .filter(canCreatePstoRequest)
    .map((row) => ({
      projectTitle: row.projectTitle ?? '',
      subtitleCode: row.subtitleCode ?? '',
      line: row.line ?? '',
      spool: row.spool ?? '',
      joint: row.joint ?? '',
      wdi: row.wdi ?? '',
      weldDate: row.weldDate ?? '',
      status: 'ожидает заявку ПСТО',
    }))
}

export function buildPstoResultsRows(rows: WeldRow[]) {
  return rows
    .filter((row) => hasText(row.pstoResult) || hasText(row.pstoDate) || hasText(row.heatTreatmentDiagram))
    .map((row) => ({
      projectTitle: row.projectTitle ?? '',
      subtitleCode: row.subtitleCode ?? '',
      line: row.line ?? '',
      spool: row.spool ?? '',
      joint: row.joint ?? '',
      wdi: row.wdi ?? '',
      weldDate: row.weldDate ?? '',
      pstoRequest: row.pstoRequest ?? '',
      pstoDate: row.pstoDate ?? '',
      heatTreatmentDiagram: row.heatTreatmentDiagram ?? '',
    }))
}

export function withAutoHeatTreatmentDiagram<T extends WeldRow>(record: T, rows: WeldRow[]) {
  if (getPstoResultValue(record.pstoResult) !== 'проведено') {
    return { ...record, heatTreatmentDiagram: null }
  }

  const date = formatPstoDiagramDate(record.pstoDate)
  if (!date) return record

  const prefix = `ПСТО-Д-${date}-`
  const currentDiagram = String(record.heatTreatmentDiagram ?? '').trim()
  if (currentDiagram) return record
  const diagramPattern = new RegExp(`^${escapeRegExp(prefix)}(\\d{3})$`)

  const maxNumber = rows
    .filter((row) => row.id !== record.id)
    .map((row) => String(row.heatTreatmentDiagram ?? '').trim().match(diagramPattern)?.[1])
    .reduce((max, value) => (value ? Math.max(max, Number(value)) : max), 0)
  const nextNumber = maxNumber + 1

  return { ...record, heatTreatmentDiagram: `${prefix}${String(nextNumber).padStart(3, '0')}` }
}

export function normalizePstoRequest(value: unknown) {
  const text = String(value ?? '').trim()
  return text || null
}

export function normalizeRowPstoRequest<T extends WeldInput>(row: T) {
  const pstoRequest = normalizePstoRequest(row.pstoRequest)
  return row.pstoRequest === pstoRequest ? row : { ...row, pstoRequest }
}

export function withPstoCreatedAt<T extends WeldInput>(rows: T[]) {
  const pstoCreatedAt = new Date().toISOString()
  return rows.map((row) => (isYesText(row.pstoRequired) && !row.pstoCreatedAt ? { ...row, pstoCreatedAt } : row))
}

export function withAutoHeatTreatmentDiagrams<T extends WeldRow>(rows: T[]) {
  const nextRows = [...rows]
  for (let index = 0; index < nextRows.length; index += 1) {
    nextRows[index] = withAutoHeatTreatmentDiagram(nextRows[index], nextRows) as T
  }
  return nextRows
}
