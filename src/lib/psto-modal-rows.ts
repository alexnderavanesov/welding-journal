import { canCreatePstoRequest } from '@/lib/psto-status'
import {
  compareHeatTreatmentReportRows,
  filterPstoRows,
} from '@/lib/report-row-utils'
import { hasText, isYesText } from '@/lib/report-value-utils'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { WeldInput } from '@/lib/weld-fields'

export function filterPstoRowsByRequestName(rows: WeldRow[], requestName: string) {
  const name = requestName.trim()
  if (!name) return []
  return rows.filter((row) => String(row.pstoRequest ?? '').trim() === name)
}

export function filterPstoRequestRows(rows: WeldRow[], search: string) {
  return sortPstoRequestRows(filterPstoRows(rows, search))
}

export function rowBelongsToPstoRequest(row: WeldInput, requestName: string) {
  const name = requestName.trim()
  return Boolean(name && String(row.pstoRequest ?? '').trim() === name)
}

export function canSelectPstoResultRow(row: WeldInput, requestName: string) {
  if (!isYesText(row.pstoRequired)) return false
  if (requestName.trim()) return rowBelongsToPstoRequest(row, requestName)
  return hasText(row.pstoRequest)
}

export function sortPstoRequestRows(rows: WeldRow[]) {
  return [...rows].sort((left, right) => {
    const leftAvailable = canCreatePstoRequest(left)
    const rightAvailable = canCreatePstoRequest(right)
    if (leftAvailable !== rightAvailable) return leftAvailable ? -1 : 1
    return compareHeatTreatmentReportRows(left, right)
  })
}
