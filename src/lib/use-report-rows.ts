import { useMemo } from 'react'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { DuplicateControlRecord } from '@/lib/duplicate-control-types'
import { clearDisabledLnkRequests } from '@/lib/lnk-field-updates'
import { withPendingPstoResultStatus } from '@/lib/psto-field-updates'
import { normalizeRowPstoRequest } from '@/lib/psto-status'
import { toControlCancellationReportRow, withPendingLnkResults } from '@/lib/report-control-state'
import { withAutoVikForWeldDate } from '@/lib/weld-import-export'
import { buildFinalStatusRowsContext, calculateFinalStatusInRows, type FinalStatusRowsContext } from '@/lib/weld-fields'
import type { OtherSettings } from '@/lib/other-settings'
import { isSystemWdiMode, withSystemWdi } from '@/lib/wdi'

type ReportWdiSettings = Pick<OtherSettings, 'wdiCalculationMode' | 'wdiTable'> &
  Partial<Pick<OtherSettings, 'wdiCalculationRules'>>

export function prepareReportRows(
  sourceRows: unknown[] | undefined,
  duplicateControls: DuplicateControlRecord[] = [],
  finalStatusSourceRows?: WeldRow[],
  finalStatusSourceContext?: FinalStatusRowsContext,
  otherSettings?: ReportWdiSettings,
) {
  const duplicateControlsByWeldId = new Map<number, DuplicateControlRecord[]>()
  for (const control of duplicateControls) {
    const current = duplicateControlsByWeldId.get(control.weldJointId) ?? []
    current.push(control)
    duplicateControlsByWeldId.set(control.weldJointId, current)
  }
  const rows = (sourceRows ?? []).map((row): WeldRow => {
    const sourceRow = row as WeldRow
    const normalizedRow = clearDisabledLnkRequests(withAutoVikForWeldDate(normalizeRowPstoRequest(sourceRow)))
    const withPendingLnk = withPendingLnkResults(normalizedRow)
    const withPendingPsto = withPendingPstoResultStatus(withPendingLnk)
    const prepared = toControlCancellationReportRow(withPendingPsto)
    return {
      ...prepared,
      duplicateControls: duplicateControlsByWeldId.get(Number(prepared.id)) ?? sourceRow.duplicateControls ?? [],
    }
  })
  const finalStatusRows = finalStatusSourceRows ?? rows
  const finalStatusContext = finalStatusSourceContext ?? buildFinalStatusRowsContext(finalStatusRows)
  const preparedRows = rows.map((row) => ({
    ...row,
    finalStatus: calculateFinalStatusInRows(row, finalStatusRows, finalStatusContext),
  }))
  return otherSettings && isSystemWdiMode(otherSettings)
    ? preparedRows.map((row) => withSystemWdi(row, otherSettings))
    : preparedRows
}

export function useReportRows(
  sourceRows: unknown[] | undefined,
  duplicateControls: DuplicateControlRecord[] = [],
  finalStatusSourceRows?: WeldRow[],
  finalStatusSourceContext?: FinalStatusRowsContext,
  otherSettings?: ReportWdiSettings,
) {
  return useMemo(
    () => prepareReportRows(sourceRows, duplicateControls, finalStatusSourceRows, finalStatusSourceContext, otherSettings),
    [duplicateControls, finalStatusSourceContext, finalStatusSourceRows, otherSettings, sourceRows],
  )
}
