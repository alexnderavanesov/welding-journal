import { LNK_METHODS } from '@/lib/report-config'
import { canCreateLnkRequest } from '@/lib/report-control-state'
import {
  getLnkMethodByRequestKey,
  hasPendingLnkRequestResult,
  hasRejectedLnkResult,
  isFinalLnkResultValue,
  isLnkMethodNoNeed,
} from '@/lib/lnk-status'
import { canCreatePstoRequest } from '@/lib/psto-status'
import {
  compactSearchText,
  compareHeatTreatmentReportRows,
  compareLnkRequestRows,
  filterPstoRows,
  normalizeSearchText,
} from '@/lib/report-row-utils'
import { hasText, isEnabledControlValue } from '@/lib/report-value-utils'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'

export function filterPstoRowsByRequestName(rows: WeldRow[], requestName: string) {
  const name = requestName.trim()
  if (!name) return []
  return rows.filter((row) => String(row.pstoRequest ?? '').trim() === name)
}

export function filterLnkRowsByRequestName(rows: WeldRow[], requestName: string) {
  const name = requestName.trim()
  if (!name) return []
  return rows.filter((row) => LNK_METHODS.some((method) => String(row[method.requestKey] ?? '').trim() === name))
}

export function getLnkRequestMethodsForRows(rows: WeldInput[], requestName: string) {
  const name = requestName.trim()
  if (!name) return []
  return LNK_METHODS.filter((method) => rows.some((row) => String(row[method.requestKey] ?? '').trim() === name))
}

export function getLnkInputMethodsForRows(rows: WeldInput[], requestName: string) {
  const name = requestName.trim()
  return LNK_METHODS.filter((method) =>
    rows.some((row) => {
      const rowRequestName = String(row[method.requestKey] ?? '').trim()
      if (!rowRequestName) return false
      if (name && rowRequestName !== name) return false
      if (isLnkMethodNoNeed(row, method)) return false
      return !isFinalLnkResultValue(row[method.resultKey])
    }),
  )
}

export function getLnkRowRequestNames(row: WeldInput) {
  return [
    ...new Set(
      LNK_METHODS.map((method) => String(row[method.requestKey] ?? '').trim()).filter((requestName) => requestName.length > 0),
    ),
  ]
}

export function getLnkRowRequestMethods(row: WeldInput, requestName: string) {
  const name = requestName.trim()
  return LNK_METHODS.filter((method) => {
    const rowRequestName = String(row[method.requestKey] ?? '').trim()
    return name ? rowRequestName === name : rowRequestName.length > 0
  })
}

export function filterLnkResultRows(rows: WeldRow[], search: string, methodKey: WeldFieldKey | '' = '') {
  const query = normalizeSearchText(search)
  const compactQuery = compactSearchText(query)
  return rows
    .filter((row) => {
      if (!query) return true
      const values = [row.projectTitle, row.subtitleCode, row.line, row.spool, row.joint]
      const haystack = normalizeSearchText(values.map((value) => String(value ?? '')).join(' '))
      return haystack.includes(query) || compactSearchText(haystack).includes(compactQuery)
    })
    .sort((left, right) => compareLnkResultEntryRows(left, right, methodKey))
}

export function filterLnkOfficialityRows(rows: WeldRow[], search: string, selectedIds: Set<number>) {
  const query = normalizeSearchText(search)
  const compactQuery = compactSearchText(query)
  return rows
    .filter((row) => {
      if (!query) return true
      const values = [row.projectTitle, row.subtitleCode, row.line, row.spool, row.joint, row.status]
      const haystack = normalizeSearchText(values.map((value) => String(value ?? '')).join(' '))
      return haystack.includes(query) || compactSearchText(haystack).includes(compactQuery)
    })
    .sort((left, right) => {
      const leftSelected = selectedIds.has(left.id)
      const rightSelected = selectedIds.has(right.id)
      if (leftSelected !== rightSelected) return leftSelected ? -1 : 1
      return compareLnkRequestRows(left, right)
    })
}

export function compareLnkResultEntryRows(left: WeldRow, right: WeldRow, methodKey: WeldFieldKey | '') {
  const leftPriority = getLnkResultEntryPriority(left, methodKey)
  const rightPriority = getLnkResultEntryPriority(right, methodKey)
  if (leftPriority !== rightPriority) return leftPriority - rightPriority
  return compareLnkRequestRows(left, right)
}

export function getLnkResultEntryPriority(row: WeldInput, methodKey: WeldFieldKey | '') {
  const method = getLnkMethodByRequestKey(methodKey)
  if (!hasRejectedLnkResult(row)) {
    if (method && hasText(row[method.requestKey]) && !isFinalLnkResultValue(row[method.resultKey])) return 0
    if (hasPendingLnkRequestResult(row)) return 0
  }

  const finalStatus = String(row.finalStatus ?? '').trim().toLowerCase()
  if (finalStatus === 'годен') return 1
  if (finalStatus === 'не годен') return 2
  return 3
}

export function filterPstoRequestRows(rows: WeldRow[], search: string) {
  return sortPstoRequestRows(filterPstoRows(rows, search))
}

export function isLnkResultRowApplicable(row: WeldInput, requestName: string, methodKey: WeldFieldKey | '') {
  const method = methodKey ? getLnkMethodByRequestKey(methodKey) : null
  if (!method) return false
  const rowRequestName = String(row[method.requestKey] ?? '').trim()
  if (!rowRequestName) return false
  const name = requestName.trim()
  return !name || rowRequestName === name
}

export function getLnkResultMethodsForRows(rows: WeldInput[], requestName: string) {
  const name = requestName.trim()
  return LNK_METHODS.filter((method) =>
    rows.some((row) => {
      const rowRequestName = String(row[method.requestKey] ?? '').trim()
      if (!rowRequestName) return false
      if (name && rowRequestName !== name) return false
      return isFinalLnkResultValue(row[method.resultKey])
    }),
  )
}

export function rowBelongsToLnkRequest(row: WeldInput, requestName: string) {
  const name = requestName.trim()
  return Boolean(name && LNK_METHODS.some((method) => String(row[method.requestKey] ?? '').trim() === name))
}

export function canSelectLnkResultRow(row: WeldInput, requestName: string, methodKey: WeldFieldKey | '') {
  if (methodKey) {
    const method = getLnkMethodByRequestKey(methodKey)
    if (!method || !isLnkResultRowApplicable(row, requestName, methodKey)) return false
    if (isLnkMethodNoNeed(row, method)) return false
    return !isFinalLnkResultValue(row[method.resultKey])
  }
  if (requestName.trim()) return rowBelongsToLnkRequest(row, requestName)
  return getLnkRowRequestNames(row).length > 0
}

export function rowBelongsToPstoRequest(row: WeldInput, requestName: string) {
  const name = requestName.trim()
  return Boolean(name && String(row.pstoRequest ?? '').trim() === name)
}

export function canSelectPstoResultRow(row: WeldInput, requestName: string) {
  if (requestName.trim()) return rowBelongsToPstoRequest(row, requestName)
  return hasText(row.pstoRequest)
}

export function filterLnkRequestRows(rows: WeldRow[], search: string) {
  const query = search.trim().toLowerCase()
  const sortedRows = sortLnkRequestRows(rows)
  if (!query) return sortedRows

  return sortedRows.filter((row) => {
    const values = [row.line, row.spool, row.joint]
    return values.some((value) => String(value ?? '').toLowerCase().includes(query))
  })
}

export function sortLnkRequestRows(rows: WeldRow[]) {
  return [...rows].sort((left, right) => {
    const leftAvailable = canCreateLnkRequest(left)
    const rightAvailable = canCreateLnkRequest(right)
    if (leftAvailable !== rightAvailable) return leftAvailable ? -1 : 1
    return compareLnkRequestRows(left, right)
  })
}

export function sortPstoRequestRows(rows: WeldRow[]) {
  return [...rows].sort((left, right) => {
    const leftAvailable = canCreatePstoRequest(left)
    const rightAvailable = canCreatePstoRequest(right)
    if (leftAvailable !== rightAvailable) return leftAvailable ? -1 : 1
    return compareHeatTreatmentReportRows(left, right)
  })
}

export function isEveryFilteredLnkRequestRowSelected(selectedIds: ReadonlySet<number>, rows: WeldRow[]) {
  return rows.length > 0 && rows.every((row) => selectedIds.has(row.id))
}

export function countLnkRequestTargets(rows: WeldInput[], methodKeys: WeldFieldKey[]) {
  if (rows.length === 0 || methodKeys.length === 0) return 0
  return rows.reduce((total, row) => {
    return (
      total +
      methodKeys.filter((requestKey) => {
        const method = getLnkMethodByRequestKey(requestKey)
        return method && isEnabledControlValue(row[method.enabledKey]) && !hasText(row[method.requestKey])
      }).length
    )
  }, 0)
}
