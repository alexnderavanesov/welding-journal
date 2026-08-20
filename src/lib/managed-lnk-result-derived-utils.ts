import { LNK_METHODS } from '@/lib/report-config'
import { getLnkMethodByRequestKey, isFinalLnkResultValue } from '@/lib/lnk-status'
import { getManagedLnkResultChangeKey } from '@/lib/lnk-result-draft'
import {
  getLnkResultMethodsForRows,
  isLnkResultRowApplicable,
} from '@/lib/report-modal-rows'
import { sortRowsByPreservedOrder } from '@/lib/report-row-utils'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { WeldRow } from '@/lib/dispatcher-types'

export function getManagedLnkResultRows({
  lnkRows,
  managedLnkResultOrderIds,
}: {
  lnkRows: WeldRow[]
  managedLnkResultOrderIds: number[] | null
}) {
  if (managedLnkResultOrderIds) {
    const selectedIds = new Set(managedLnkResultOrderIds)
    return sortRowsByPreservedOrder(
      lnkRows.filter((row) => selectedIds.has(row.id)),
      managedLnkResultOrderIds,
    )
  }
  return lnkRows
}

export function getManagedLnkResultMethods(managedLnkResultRows: WeldRow[]) {
  return getLnkResultMethodsForRows(managedLnkResultRows, '')
}

export function getManagedLnkResultMethodRows({
  managedLnkResultRows,
  managedLnkResultMethodKey,
}: {
  managedLnkResultRows: WeldRow[]
  managedLnkResultMethodKey: WeldFieldKey | ''
}) {
  return managedLnkResultRows.filter((row) => {
    const method = getLnkMethodByRequestKey(managedLnkResultMethodKey)
    return Boolean(
      method &&
        isLnkResultRowApplicable(row, '', managedLnkResultMethodKey) &&
        isFinalLnkResultValue(row[method.resultKey]),
    )
  })
}

export function getManagedLnkResultEntries({
  managedLnkResultRows,
  managedLnkResultMethodRows,
  managedLnkResultMethodKey,
}: {
  managedLnkResultRows: WeldRow[]
  managedLnkResultMethodRows: WeldRow[]
  managedLnkResultMethodKey: WeldFieldKey | ''
}) {
  if (managedLnkResultMethodKey) {
    return managedLnkResultMethodRows.flatMap((row) => {
      const method = getLnkMethodByRequestKey(managedLnkResultMethodKey)
      return method ? [{ row, method, changeKey: getManagedLnkResultChangeKey(row.id, method.requestKey) }] : []
    })
  }

  return managedLnkResultRows.flatMap((row) =>
    LNK_METHODS.flatMap((method) =>
      isLnkResultRowApplicable(row, '', method.requestKey) &&
      isFinalLnkResultValue(row[method.resultKey])
        ? [{ row, method, changeKey: getManagedLnkResultChangeKey(row.id, method.requestKey) }]
        : [],
    ),
  )
}

export function getManagedLnkPendingResultRows<
  TEntry extends {
    row: WeldRow
    method: { resultKey: WeldFieldKey }
    changeKey: string
  },
>(managedLnkResultEntries: TEntry[], managedLnkPendingResultChanges: Record<string, string>) {
  return managedLnkResultEntries.filter(({ row, method, changeKey }) => {
    const nextResult = managedLnkPendingResultChanges[changeKey]
    const currentResult = String(row[method.resultKey] ?? '').trim()
    return Boolean(nextResult && nextResult !== currentResult)
  })
}
