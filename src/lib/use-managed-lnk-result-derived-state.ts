import { useMemo } from 'react'
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

type ManagedLnkResultDerivedStateParams = {
  lnkRows: WeldRow[]
  lnkResultRequestOptions: string[]
  managedLnkResultRequestSearch: string
  managedLnkResultRequestName: string
  managedLnkResultOrderIds: number[] | null
  managedLnkResultMethodKey: WeldFieldKey | ''
  managedLnkPendingResultChanges: Record<string, string>
}

export function useManagedLnkResultDerivedState({
  lnkRows,
  lnkResultRequestOptions,
  managedLnkResultRequestSearch,
  managedLnkResultRequestName,
  managedLnkResultOrderIds,
  managedLnkResultMethodKey,
  managedLnkPendingResultChanges,
}: ManagedLnkResultDerivedStateParams) {
  const filteredManagedLnkResultRequestOptions = useMemo(
    () =>
      withCurrentOption(
        filterRequestNamesBySearch(lnkResultRequestOptions, managedLnkResultRequestSearch),
        managedLnkResultRequestName,
      ),
    [lnkResultRequestOptions, managedLnkResultRequestName, managedLnkResultRequestSearch],
  )

  const managedLnkResultRows = useMemo(() => {
    if (managedLnkResultOrderIds) {
      const selectedIds = new Set(managedLnkResultOrderIds)
      return sortRowsByPreservedOrder(
        lnkRows.filter((row) => selectedIds.has(row.id)),
        managedLnkResultOrderIds,
      )
    }
    return filterLnkRowsByRequestName(lnkRows, managedLnkResultRequestName)
  }, [lnkRows, managedLnkResultOrderIds, managedLnkResultRequestName])

  const managedLnkResultMethods = useMemo(
    () => getLnkResultMethodsForRows(managedLnkResultRows, managedLnkResultRequestName),
    [managedLnkResultRequestName, managedLnkResultRows],
  )

  const managedLnkResultMethodRows = useMemo(
    () =>
      managedLnkResultRows.filter((row) => {
        const method = getLnkMethodByRequestKey(managedLnkResultMethodKey)
        return Boolean(
          method &&
            isLnkResultRowApplicable(row, managedLnkResultRequestName, managedLnkResultMethodKey) &&
            isFinalLnkResultValue(row[method.resultKey]),
        )
      }),
    [managedLnkResultMethodKey, managedLnkResultRequestName, managedLnkResultRows],
  )

  const managedLnkResultEntries = useMemo(
    () =>
      (managedLnkResultMethodKey
        ? managedLnkResultMethodRows.flatMap((row) => {
            const method = getLnkMethodByRequestKey(managedLnkResultMethodKey)
            return method ? [{ row, method, changeKey: getManagedLnkResultChangeKey(row.id, method.requestKey) }] : []
          })
        : managedLnkResultRows.flatMap((row) =>
            LNK_METHODS.flatMap((method) =>
              isLnkResultRowApplicable(row, managedLnkResultRequestName, method.requestKey) &&
              isFinalLnkResultValue(row[method.resultKey])
                ? [{ row, method, changeKey: getManagedLnkResultChangeKey(row.id, method.requestKey) }]
                : [],
            ),
          )),
    [managedLnkResultMethodKey, managedLnkResultMethodRows, managedLnkResultRequestName, managedLnkResultRows],
  )

  const managedLnkPendingResultRows = useMemo(
    () =>
      managedLnkResultEntries.filter(({ row, method, changeKey }) => {
        const nextResult = managedLnkPendingResultChanges[changeKey]
        const currentResult = String(row[method.resultKey] ?? '').trim()
        return Boolean(nextResult && nextResult !== currentResult)
      }),
    [managedLnkPendingResultChanges, managedLnkResultEntries],
  )

  return {
    filteredManagedLnkResultRequestOptions,
    managedLnkResultRows,
    managedLnkResultMethods,
    managedLnkResultEntries,
    managedLnkPendingResultRows,
  }
}
