import { LNK_METHODS } from '@/lib/report-config'
import { getLnkMethodByRequestKey, isFinalLnkResultValue } from '@/lib/lnk-status'
import { getManagedLnkResultChangeKey } from '@/lib/lnk-result-draft'
import {
  filterLnkRowsByRequestName,
  getLnkResultMethodsForRows,
  isLnkResultRowApplicable,
} from '@/lib/report-modal-rows'
import { sortRowsByPreservedOrder } from '@/lib/report-row-utils'
import { filterRequestNamesBySearch, withCurrentOption } from '@/lib/report-naming'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { WeldRow } from '@/lib/dispatcher-types'

export function getFilteredManagedLnkResultRequestOptions({
  lnkResultRequestOptions,
  managedLnkResultRequestSearch,
  managedLnkResultRequestName,
}: {
  lnkResultRequestOptions: string[]
  managedLnkResultRequestSearch: string
  managedLnkResultRequestName: string
}) {
  return withCurrentOption(
    filterRequestNamesBySearch(lnkResultRequestOptions, managedLnkResultRequestSearch),
    managedLnkResultRequestName,
  )
}

export function getManagedLnkResultRows({
  lnkRows,
  managedLnkResultRequestName,
  managedLnkResultOrderIds,
}: {
  lnkRows: WeldRow[]
  managedLnkResultRequestName: string
  managedLnkResultOrderIds: number[] | null
}) {
  if (managedLnkResultOrderIds) {
    const selectedIds = new Set(managedLnkResultOrderIds)
    return sortRowsByPreservedOrder(
      lnkRows.filter((row) => selectedIds.has(row.id)),
      managedLnkResultOrderIds,
    )
  }
  return filterLnkRowsByRequestName(lnkRows, managedLnkResultRequestName)
}

export function getManagedLnkResultMethods(managedLnkResultRows: WeldRow[], managedLnkResultRequestName: string) {
  return getLnkResultMethodsForRows(managedLnkResultRows, managedLnkResultRequestName)
}

export function getManagedLnkResultMethodRows({
  managedLnkResultRows,
  managedLnkResultRequestName,
  managedLnkResultMethodKey,
}: {
  managedLnkResultRows: WeldRow[]
  managedLnkResultRequestName: string
  managedLnkResultMethodKey: WeldFieldKey | ''
}) {
  return managedLnkResultRows.filter((row) => {
    const method = getLnkMethodByRequestKey(managedLnkResultMethodKey)
    return Boolean(
      method &&
        isLnkResultRowApplicable(row, managedLnkResultRequestName, managedLnkResultMethodKey) &&
        isFinalLnkResultValue(row[method.resultKey]),
    )
  })
}

export function getManagedLnkResultEntries({
  managedLnkResultRows,
  managedLnkResultMethodRows,
  managedLnkResultRequestName,
  managedLnkResultMethodKey,
}: {
  managedLnkResultRows: WeldRow[]
  managedLnkResultMethodRows: WeldRow[]
  managedLnkResultRequestName: string
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
      isLnkResultRowApplicable(row, managedLnkResultRequestName, method.requestKey) &&
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
