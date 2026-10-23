import { useMemo, useRef } from 'react'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { DuplicateControlRecord } from '@/lib/duplicate-control-types'
import { clearDisabledLnkRequests } from '@/lib/lnk-field-updates'
import { withPendingPstoResultStatus } from '@/lib/psto-field-updates'
import { normalizeRowPstoRequest } from '@/lib/psto-status'
import { toControlCancellationReportRow, withPendingLnkResults } from '@/lib/report-control-state'
import { withAutoVikForWeldDate } from '@/lib/weld-import-export'
import { buildFinalStatusRowsContext, calculateFinalStatusInRows, type FinalStatusRowsContext } from '@/lib/weld-fields'
import { LNK_METHODS } from '@/lib/report-config'
import type { OtherSettings } from '@/lib/other-settings'
import { isSystemWdiMode, withSystemWdi } from '@/lib/wdi'
import { isControlCancelledValue } from '@/lib/control-availability-values'
import type { WeldReportKind } from '@/server/weld-contracts'

type ReportWdiSettings = Pick<OtherSettings, 'wdiCalculationMode' | 'wdiTable'> &
  Partial<Pick<OtherSettings, 'wdiCalculationRules'>>

const IN_PLACE_REPORT_PREPARATION_KEYS = [
  'hasVik',
  'pstoRequest',
  'pstoRequired',
  'pstoResult',
  ...LNK_METHODS.flatMap((method) => [
    method.enabledKey,
    method.requestKey,
    method.requestDateKey,
    method.resultKey,
  ]),
] as const

function prepareReportControlRows(
  sourceRows: unknown[] | undefined,
  duplicateControls: DuplicateControlRecord[] = [],
) {
  const duplicateControlsByWeldId = new Map<number, DuplicateControlRecord[]>()
  for (const control of duplicateControls) {
    const current = duplicateControlsByWeldId.get(control.weldJointId) ?? []
    current.push(control)
    duplicateControlsByWeldId.set(control.weldJointId, current)
  }
  return (sourceRows ?? []).map((row): WeldRow => {
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
}

/** Server journal pages already have revision-checked final statuses and WDI.
 * Only decorate controls; a partial page must not rebuild chain statuses that
 * its caller would immediately discard. Other reports keep their full path. */
export function prepareJournalPageRows(sourceRows: unknown[], report: WeldReportKind = 'weldingJournal') {
  const rows = prepareReportControlRows(sourceRows)
  // PSTO's display accessor needs the primary fact even after cancellation;
  // current-cycle decoration belongs to that accessor, not to stored facts.
  return report === 'heatTreatment' ? rows.map((row, index) => isControlCancelledValue(row.pstoRequired)
    ? { ...row, pstoResult: (sourceRows[index] as WeldRow).pstoResult } : row) : rows
}

export function prepareReportRows(
  sourceRows: unknown[] | undefined,
  duplicateControls: DuplicateControlRecord[] = [],
  finalStatusSourceRows?: WeldRow[],
  finalStatusSourceContext?: FinalStatusRowsContext,
  otherSettings?: ReportWdiSettings,
  preserveStoredRepairStatus = false,
  preserveCancelledPstoResult = false,
) {
  const rows = prepareReportControlRows(sourceRows, duplicateControls)
  const finalStatusRows = finalStatusSourceRows ?? rows
  const finalStatusContext = finalStatusSourceContext ?? buildFinalStatusRowsContext(finalStatusRows)
  const preparedRows = rows.map((row, index) => {
    const calculatedStatus = calculateFinalStatusInRows(row, finalStatusRows, finalStatusContext)
    // A paged report may not contain the rejected source. Keep its server-
    // calculated repair status until an authoritative complete context is loaded.
    const keepRepair = preserveStoredRepairStatus && !finalStatusSourceContext &&
      calculatedStatus === 'ожидает сварку' && row.finalStatus === 'ожидает ремонт'
    const source = sourceRows?.[index] as WeldRow | undefined
    // PSTO's display accessor decorates cancellation. Restore the primary fact
    // only after the existing status calculation, without changing dispatcher
    // preparation or the journal/LNK's established result annotations.
    return { ...row, finalStatus: keepRepair ? 'ожидает ремонт' : calculatedStatus,
      ...(preserveCancelledPstoResult && source && isControlCancelledValue(source.pstoRequired)
        ? { pstoResult: source.pstoResult } : {}) }
  })
  return otherSettings && isSystemWdiMode(otherSettings)
    ? preparedRows.map((row) => withSystemWdi(row, otherSettings))
    : preparedRows
}

/**
 * Dispatcher-only variant for full-journal calculations. The caller owns the
 * freshly loaded rows, so reusing those objects avoids retaining several wide
 * copies of every weld joint while preserving prepareReportRows semantics.
 */
export function prepareReportRowsInPlace(
  sourceRows: WeldRow[],
  duplicateControls: DuplicateControlRecord[] = [],
) {
  const duplicateControlsByWeldId = new Map<number, DuplicateControlRecord[]>()
  for (const control of duplicateControls) {
    const current = duplicateControlsByWeldId.get(control.weldJointId) ?? []
    current.push(control)
    duplicateControlsByWeldId.set(control.weldJointId, current)
  }

  for (const row of sourceRows) {
    const normalizedRow = clearDisabledLnkRequests(withAutoVikForWeldDate(normalizeRowPstoRequest(row)))
    const withPendingLnk = withPendingLnkResults(normalizedRow)
    const withPendingPsto = withPendingPstoResultStatus(withPendingLnk)
    const prepared = toControlCancellationReportRow(withPendingPsto)
    if (prepared !== row) {
      for (const key of IN_PLACE_REPORT_PREPARATION_KEYS) {
        if (!Object.is(row[key], prepared[key])) row[key] = prepared[key]
      }
    }
    const rowDuplicateControls = duplicateControlsByWeldId.get(Number(row.id))
    if (rowDuplicateControls?.length) row.duplicateControls = rowDuplicateControls
  }

  const finalStatusContext = buildFinalStatusRowsContext(sourceRows)
  for (const row of sourceRows) {
    row.finalStatus = calculateFinalStatusInRows(row, sourceRows, finalStatusContext)
  }
  return sourceRows
}

export function useReportRows(
  sourceRows: unknown[] | undefined,
  duplicateControls: DuplicateControlRecord[] = [],
  finalStatusSourceRows?: WeldRow[],
  finalStatusSourceContext?: FinalStatusRowsContext,
  otherSettings?: ReportWdiSettings,
  preserveStoredRepairStatus = false,
  preserveCancelledPstoResult = false,
) {
  const previousRowsRef = useRef<WeldRow[]>([])
  return useMemo(
    () => {
      const nextRows = prepareReportRows(
        sourceRows,
        duplicateControls,
        finalStatusSourceRows,
        finalStatusSourceContext,
        otherSettings,
        preserveStoredRepairStatus,
        preserveCancelledPstoResult,
      )
      const sharedRows = reuseEquivalentWeldRows(previousRowsRef.current, nextRows)
      previousRowsRef.current = sharedRows
      return sharedRows
    },
    [duplicateControls, finalStatusSourceContext, finalStatusSourceRows, otherSettings, preserveStoredRepairStatus, preserveCancelledPstoResult, sourceRows],
  )
}

export function reuseEquivalentWeldRows(previousRows: WeldRow[], nextRows: WeldRow[]) {
  if (previousRows.length === 0 || nextRows.length === 0) return nextRows
  const previousById = new Map(previousRows.map((row) => [Number(row.id), row]))
  let reusedCount = 0
  const sharedRows = nextRows.map((row) => {
    const previous = previousById.get(Number(row.id))
    if (!previous || !areWeldRowsShallowEqual(previous, row)) return row
    reusedCount += 1
    return previous
  })
  return reusedCount > 0 ? sharedRows : nextRows
}

function areWeldRowsShallowEqual(left: WeldRow, right: WeldRow) {
  if (left === right) return true
  const leftKeys = Object.keys(left) as Array<keyof WeldRow>
  const rightKeys = Object.keys(right) as Array<keyof WeldRow>
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every((key) => areWeldRowValuesEqual(left[key], right[key]))
}

function areWeldRowValuesEqual(left: unknown, right: unknown) {
  if (Object.is(left, right)) return true
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
  return left.every((value, index) => Object.is(value, right[index]))
}
