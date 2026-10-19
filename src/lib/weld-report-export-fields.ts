import { FIELD_BY_KEY, type WeldField, type WeldFieldKey } from './weld-fields'
import type { AgGridWeldReport } from './weld-report-grid-profile'

/** Reads live columns at the export click; rejects a grid from another report. */
export type WeldReportExportFieldsRef = { current: ((report: AgGridWeldReport) => WeldField[] | null) | null }

export function getWeldReportExportFields(displayedColumnIds: readonly string[]): WeldField[] {
  // AG already accounts for visibility, pinning and screen order. Service,
  // selection and group columns are not weld fields and never enter output.
  return displayedColumnIds.flatMap(id => FIELD_BY_KEY.get(id as WeldFieldKey) ?? [])
}
