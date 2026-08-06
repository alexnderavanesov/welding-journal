import { useMemo } from 'react'
import {
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
  managedLnkResultOrderIds: number[] | null
  managedLnkResultMethodKey: WeldFieldKey | ''
  managedLnkPendingResultChanges: Record<string, string>
}

export function useManagedLnkResultDerivedState({
  lnkRows,
  managedLnkResultOrderIds,
  managedLnkResultMethodKey,
  managedLnkPendingResultChanges,
}: ManagedLnkResultDerivedStateParams) {
  const managedLnkResultRows = useMemo(
    () =>
      getManagedLnkResultRows({
        lnkRows,
        managedLnkResultOrderIds,
      }),
    [lnkRows, managedLnkResultOrderIds],
  )

  const managedLnkResultMethods = useMemo(
    () => getManagedLnkResultMethods(managedLnkResultRows),
    [managedLnkResultRows],
  )

  const managedLnkResultMethodRows = useMemo(
    () =>
      getManagedLnkResultMethodRows({
        managedLnkResultRows,
        managedLnkResultMethodKey,
      }),
    [managedLnkResultMethodKey, managedLnkResultRows],
  )

  const managedLnkResultEntries = useMemo(
    () =>
      getManagedLnkResultEntries({
        managedLnkResultRows,
        managedLnkResultMethodRows,
        managedLnkResultMethodKey,
      }),
    [managedLnkResultMethodKey, managedLnkResultMethodRows, managedLnkResultRows],
  )

  const managedLnkPendingResultRows = useMemo(
    () => getManagedLnkPendingResultRows(managedLnkResultEntries, managedLnkPendingResultChanges),
    [managedLnkPendingResultChanges, managedLnkResultEntries],
  )

  return {
    managedLnkResultRows,
    managedLnkResultMethods,
    managedLnkResultEntries,
    managedLnkPendingResultRows,
  }
}
