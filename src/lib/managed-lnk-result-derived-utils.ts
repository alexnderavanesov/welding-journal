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

export type ForcedLnkResultEntry = {
  rowId: number
  methodKey: WeldFieldKey
}

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

export function getManagedLnkResultMethods(
  managedLnkResultRows: WeldRow[],
  forcedEntry?: ForcedLnkResultEntry,
) {
  const methods = getLnkResultMethodsForRows(managedLnkResultRows, '')
  const forcedMethod = forcedEntry && managedLnkResultRows.some((row) => row.id === forcedEntry.rowId)
    ? getLnkMethodByRequestKey(forcedEntry.methodKey)
    : undefined
  return forcedMethod && !methods.some((method) => method.requestKey === forcedMethod.requestKey)
    ? [forcedMethod, ...methods]
    : methods
}

export function getManagedLnkResultMethodRows({
  managedLnkResultRows,
  managedLnkResultMethodKey,
  forcedEntry,
}: {
  managedLnkResultRows: WeldRow[]
  managedLnkResultMethodKey: WeldFieldKey | ''
  forcedEntry?: ForcedLnkResultEntry
}) {
  return managedLnkResultRows.filter((row) => {
    const method = getLnkMethodByRequestKey(managedLnkResultMethodKey)
    return Boolean(
      method &&
        isFinalLnkResultValue(row[method.resultKey]) &&
        (
          isLnkResultRowApplicable(row, '', managedLnkResultMethodKey) ||
          (forcedEntry?.rowId === row.id && forcedEntry.methodKey === managedLnkResultMethodKey)
        ),
    )
  })
}

export function getManagedLnkResultEntries({
  managedLnkResultRows,
  managedLnkResultMethodRows,
  managedLnkResultMethodKey,
  forcedEntry,
}: {
  managedLnkResultRows: WeldRow[]
  managedLnkResultMethodRows: WeldRow[]
  managedLnkResultMethodKey: WeldFieldKey | ''
  forcedEntry?: ForcedLnkResultEntry
}) {
  if (managedLnkResultMethodKey) {
    return managedLnkResultMethodRows.flatMap((row) => {
      const method = getLnkMethodByRequestKey(managedLnkResultMethodKey)
      return method ? [{ row, method, changeKey: getManagedLnkResultChangeKey(row.id, method.requestKey) }] : []
    })
  }

  const entries = managedLnkResultRows.flatMap((row) =>
    LNK_METHODS.flatMap((method) =>
      isLnkResultRowApplicable(row, '', method.requestKey) &&
      isFinalLnkResultValue(row[method.resultKey])
        ? [{ row, method, changeKey: getManagedLnkResultChangeKey(row.id, method.requestKey) }]
        : [],
    ),
  )
  if (!forcedEntry || entries.some((entry) => entry.changeKey === getManagedLnkResultChangeKey(
    forcedEntry.rowId,
    forcedEntry.methodKey,
  ))) return entries
  const row = managedLnkResultRows.find((candidate) => candidate.id === forcedEntry.rowId)
  const method = getLnkMethodByRequestKey(forcedEntry.methodKey)
  return row && method && isFinalLnkResultValue(row[method.resultKey])
    ? [{ row, method, changeKey: getManagedLnkResultChangeKey(row.id, method.requestKey) }, ...entries]
    : entries
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
