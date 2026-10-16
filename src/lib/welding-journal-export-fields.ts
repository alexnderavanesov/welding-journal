import { FIELD_BY_KEY, type WeldField, type WeldFieldKey } from './weld-fields'

/** Scoped to the mounted journal; reads live columns at the user's export click. */
export type JournalExportFieldsRef = { current: (() => WeldField[] | null) | null }

export function getWeldingJournalExportFields(displayedColumnIds: readonly string[]): WeldField[] {
  // AG already accounts for visibility, pinning and screen order. Service,
  // selection and group columns are not weld fields and never enter output.
  return displayedColumnIds.flatMap(id => FIELD_BY_KEY.get(id as WeldFieldKey) ?? [])
}
