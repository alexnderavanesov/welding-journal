import { LNK_METHODS } from '@/lib/report-config'
import { canCreateLnkRequest } from '@/lib/report-control-state'
import { getLnkMethodByRequestKey, isFinalLnkResultValue, isLnkMethodNoNeed } from '@/lib/lnk-status'
import { compareLnkRequestRows } from '@/lib/report-row-utils'
import { hasText, isEnabledControlValue } from '@/lib/report-value-utils'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'

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
