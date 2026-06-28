import type { WeldDraft, WeldRow } from '@/lib/dispatcher-types'
import {
  hasAnyLnkReportControl,
  hasHeatTreatmentReportState,
  toHeatTreatmentReportRow,
  toLnkReportRow,
} from '@/lib/report-control-state'

export function sumAcceptedWdi(rows: WeldDraft[]) {
  return rows.reduce((total, row) => {
    if (String(row.finalStatus ?? '').trim().toLowerCase() !== 'годен') return total
    const value = typeof row.wdi === 'number' ? row.wdi : Number(String(row.wdi ?? '').replace(',', '.'))
    return Number.isFinite(value) ? total + value : total
  }, 0)
}

export function filterPstoResultRows(rows: WeldRow[], search: string) {
  return filterPstoRows(rows, search).sort(compareHeatTreatmentReportRows)
}

export function buildHeatTreatmentReportRows(rows: WeldRow[]) {
  return rows.filter(hasHeatTreatmentReportState).map(toHeatTreatmentReportRow).sort(compareHeatTreatmentReportRows)
}

export function buildLnkReportRows(rows: WeldRow[], preservedIds?: number[] | null) {
  const sortedRows = rows.filter(hasAnyLnkReportControl).map(toLnkReportRow).sort(compareLnkReportRows)
  return preservedIds ? sortRowsByPreservedOrder(sortedRows, preservedIds) : sortedRows
}

export function filterPstoRows(rows: WeldRow[], search: string) {
  const query = normalizeSearchText(search)
  const compactQuery = compactSearchText(query)
  return rows.filter((row) => {
    if (!query) return true
    const values = [row.projectTitle, row.subtitleCode, row.line, row.spool, row.joint]
    const haystack = normalizeSearchText(values.map((value) => String(value ?? '')).join(' '))
    return haystack.includes(query) || compactSearchText(haystack).includes(compactQuery)
  })
}

export function normalizeSearchText(value: unknown) {
  return String(value ?? '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ')
}

export function compactSearchText(value: string) {
  return value.replace(/[^\p{L}\p{N}]+/gu, '')
}

export function sortRowsByPreservedOrder(rows: WeldRow[], preservedIds: number[]) {
  const orderById = new Map(preservedIds.map((id, index) => [id, index]))
  return [...rows].sort((left, right) => {
    const leftOrder = orderById.get(left.id)
    const rightOrder = orderById.get(right.id)
    if (leftOrder !== undefined && rightOrder !== undefined) return leftOrder - rightOrder
    if (leftOrder !== undefined) return -1
    if (rightOrder !== undefined) return 1
    return compareLnkReportRows(left, right)
  })
}

export function compareHeatTreatmentReportRows(left: WeldRow, right: WeldRow) {
  const leftTime = parseReportTimestamp(left.pstoCreatedAt)
  const rightTime = parseReportTimestamp(right.pstoCreatedAt)
  if (leftTime !== rightTime) return rightTime - leftTime
  return compareReportRows(left, right)
}

export function compareLnkReportRows(left: WeldRow, right: WeldRow) {
  const leftTime = parseReportTimestamp(left.lnkCreatedAt)
  const rightTime = parseReportTimestamp(right.lnkCreatedAt)
  if (leftTime !== rightTime) return rightTime - leftTime
  return compareReportRows(left, right)
}

export function compareLnkRequestRows(left: WeldRow, right: WeldRow) {
  return compareReportRows(left, right)
}

export function compareReportRows(left: WeldRow, right: WeldRow) {
  const leftValue = [left.line, left.spool, left.joint].map((value) => String(value ?? '')).join(' ')
  const rightValue = [right.line, right.spool, right.joint].map((value) => String(value ?? '')).join(' ')
  return leftValue.localeCompare(rightValue, 'ru', { numeric: true })
}

export function parseReportTimestamp(value: unknown) {
  const time = new Date(String(value ?? '')).getTime()
  return Number.isFinite(time) ? time : 0
}
