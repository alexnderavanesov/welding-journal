import { useMemo } from 'react'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { DuplicateControlRecord } from '@/lib/duplicate-control-types'
import { clearDisabledLnkRequests } from '@/lib/lnk-field-updates'
import { withPendingPstoResultStatus } from '@/lib/psto-field-updates'
import { normalizeRowPstoRequest, withPstoCreatedAt } from '@/lib/psto-status'
import { toControlCancellationReportRow, withPendingLnkResults } from '@/lib/report-control-state'
import { withAutoVikForWeldDate } from '@/lib/weld-import-export'
import { calculateFinalStatusInRows } from '@/lib/weld-fields'

export function useReportRows(sourceRows: unknown[] | undefined, duplicateControls: DuplicateControlRecord[] = []) {
  return useMemo(
    () => {
      const duplicateControlsByWeldId = new Map<number, DuplicateControlRecord[]>()
      for (const control of duplicateControls) {
        const current = duplicateControlsByWeldId.get(control.weldJointId) ?? []
        current.push(control)
        duplicateControlsByWeldId.set(control.weldJointId, current)
      }
      const rows = (sourceRows ?? []).map((row): WeldRow => {
        const normalizedRow = clearDisabledLnkRequests(withAutoVikForWeldDate(normalizeRowPstoRequest(row as WeldRow)))
        const withTimestamps = withPstoCreatedAt([normalizedRow])[0]
        const withPendingLnk = withPendingLnkResults(withTimestamps)
        const withPendingPsto = withPendingPstoResultStatus(withPendingLnk)
        const prepared = toControlCancellationReportRow(withPendingPsto)
        return {
          ...prepared,
          duplicateControls: duplicateControlsByWeldId.get(Number(prepared.id)) ?? [],
        }
      })
      return rows.map((row) => ({ ...row, finalStatus: calculateFinalStatusInRows(row, rows) }))
    },
    [duplicateControls, sourceRows],
  )
}
