import { useMemo } from 'react'
import type { WeldRow } from '@/lib/dispatcher-types'
import { clearDisabledLnkRequests } from '@/lib/lnk-field-updates'
import { normalizeRowPstoRequest, withPstoCreatedAt } from '@/lib/psto-status'
import { toControlCancellationReportRow, withPendingLnkResults } from '@/lib/report-control-state'
import { withAutoVikForWeldDate } from '@/lib/weld-import-export'
import { calculateFinalStatus } from '@/lib/weld-fields'

export function useReportRows(sourceRows: unknown[] | undefined) {
  return useMemo(
    () =>
      (sourceRows ?? []).map((row): WeldRow => {
        const normalizedRow = clearDisabledLnkRequests(withAutoVikForWeldDate(normalizeRowPstoRequest(row as WeldRow)))
        const withTimestamps = withPstoCreatedAt([normalizedRow])[0]
        const withPendingLnk = withPendingLnkResults(withTimestamps)
        const withCancellationState = toControlCancellationReportRow(withPendingLnk)
        return { ...withCancellationState, finalStatus: calculateFinalStatus(withCancellationState) }
      }),
    [sourceRows],
  )
}
