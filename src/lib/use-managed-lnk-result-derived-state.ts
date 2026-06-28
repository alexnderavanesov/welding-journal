import { useMemo } from 'react'
import {
  getFilteredManagedLnkResultRequestOptions,
  getManagedLnkPendingResultRows,
  getManagedLnkResultEntries,
  getManagedLnkResultMethodRows,
  getManagedLnkResultMethods,
  getManagedLnkResultRows,
} from '@/lib/managed-lnk-result-derived-utils'
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
      getFilteredManagedLnkResultRequestOptions({
        lnkResultRequestOptions,
        managedLnkResultRequestSearch,
        managedLnkResultRequestName,
      }),
    [lnkResultRequestOptions, managedLnkResultRequestName, managedLnkResultRequestSearch],
  )

  const managedLnkResultRows = useMemo(
    () =>
      getManagedLnkResultRows({
        lnkRows,
        managedLnkResultRequestName,
        managedLnkResultOrderIds,
      }),
    [lnkRows, managedLnkResultOrderIds, managedLnkResultRequestName],
  )

  const managedLnkResultMethods = useMemo(
    () => getManagedLnkResultMethods(managedLnkResultRows, managedLnkResultRequestName),
    [managedLnkResultRequestName, managedLnkResultRows],
  )

  const managedLnkResultMethodRows = useMemo(
    () =>
      getManagedLnkResultMethodRows({
        managedLnkResultRows,
        managedLnkResultRequestName,
        managedLnkResultMethodKey,
      }),
    [managedLnkResultMethodKey, managedLnkResultRequestName, managedLnkResultRows],
  )

  const managedLnkResultEntries = useMemo(
    () =>
      getManagedLnkResultEntries({
        managedLnkResultRows,
        managedLnkResultMethodRows,
        managedLnkResultRequestName,
        managedLnkResultMethodKey,
      }),
    [managedLnkResultMethodKey, managedLnkResultMethodRows, managedLnkResultRequestName, managedLnkResultRows],
  )

  const managedLnkPendingResultRows = useMemo(
    () => getManagedLnkPendingResultRows(managedLnkResultEntries, managedLnkPendingResultChanges),
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
