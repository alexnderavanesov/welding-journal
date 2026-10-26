import * as builders from './report-show-builders'
import { FIELD_BY_KEY, VISIBLE_FIELDS, type WeldField, type WeldInput } from './weld-fields'
import type { ReportOutputRequest } from '@/server/weld-contracts'

export type ReportOutputKind = 'current' | 'system' | 'waitingWeld' | 'waitingRequest' | 'waitingControl' | 'waitingRepair' | 'cancelledAccepted' | 'waitingNk' | 'conclusions' | 'results'

/** Reuse the report definitions for both the bounded preview and the complete file. */
export function getReportOutputBuilder(input: ReportOutputRequest) {
  if (!input || typeof input !== 'object' || input.fieldKeys !== undefined && !Array.isArray(input.fieldKeys)) throw new Error('Некорректные параметры отчёта.')
  const kind = input.kind ?? 'current'
  const fields = input.fieldKeys ? input.fieldKeys.map(key => FIELD_BY_KEY.get(key as never)) : VISIBLE_FIELDS
  if (!fields.length || fields.some(field => !field) || new Set(input.fieldKeys).size !== (input.fieldKeys?.length ?? 0)) {
    throw new Error('Некорректный набор столбцов отчёта.')
  }
  const current = (rows: WeldInput[]) => input.report === 'lnk'
    ? builders.buildLnkCurrentReport(rows, fields as WeldField[])
    : input.report === 'heatTreatment' ? builders.buildPstoCurrentReport(rows, fields as WeldField[])
    : builders.buildWeldingJournalCurrentReport(rows, fields as WeldField[], true)
  const options = input.report === 'weldingJournal' ? {
    current, system: (rows: WeldInput[]) => builders.buildWeldingJournalSystemReport(rows, true),
    waitingWeld: (rows: WeldInput[]) => builders.buildWeldingJournalWaitingWeldReport(rows, true),
    waitingRequest: builders.buildWeldingJournalWaitingRequestReport, waitingControl: builders.buildWeldingJournalWaitingControlReport,
    waitingRepair: builders.buildWeldingJournalWaitingRepairReport, cancelledAccepted: builders.buildWeldingJournalCancelledAcceptedReport,
  } : input.report === 'lnk' ? {
    current, waitingNk: builders.buildLnkWaitingNkReport, waitingRequest: builders.buildLnkToRequestReport, conclusions: builders.buildLnkConclusionsReport,
  } : input.report === 'heatTreatment' ? {
    current, waitingRequest: builders.buildPstoWaitingRequestReport, results: builders.buildPstoResultsReport,
  } : {}
  const build = Object.hasOwn(options, kind) ? (options as Record<string, ((rows: WeldInput[]) => ReturnType<typeof current>) | undefined>)[kind] : undefined
  if (!build) throw new Error('Неизвестный вид отчёта.')
  return build
}
