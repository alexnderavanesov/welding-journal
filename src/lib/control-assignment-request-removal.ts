import type { WeldRow } from './dispatcher-types'
import type { WeldInput, WeldFieldKey } from './weld-fields'
import { isControlCancelledValue, isControlEnabledValue } from './control-availability-values'
import { getControlAssignmentRemovalReason } from './control-assignment-history'
import { ALL_LNK_FIELD_METHODS } from './lnk-report-config'

const assigned = (value: unknown) => isControlEnabledValue(value) || isControlCancelledValue(value)

export function getClearedControlAssignments(record: WeldInput, previous: WeldInput): WeldFieldKey[] {
  return [...ALL_LNK_FIELD_METHODS.map(method => method.enabledKey), 'pstoRequired' as const]
    .filter(field => assigned(previous[field]) && !assigned(record[field]))
}

/** Server-owned effects of a saved assignment change. No document is changed
 * while editing a draft; the transaction persists the relation changes below. */
export function clearRequestsForRemovedControlAssignments(record: WeldInput, previous: WeldInput): void {
  const fields = new Set(getClearedControlAssignments(record, previous))
  if (!fields.size) return
  const reason = getControlAssignmentRemovalReason(record, previous)
  if (reason) throw new Error(reason)
  const removesPsto = fields.has('pstoRequired')
  const methods = new Set(ALL_LNK_FIELD_METHODS.filter(method => fields.has(method.enabledKey)).map(method => method.code))
  if (removesPsto) methods.add('ТВМТ')
  for (const method of ALL_LNK_FIELD_METHODS) {
    if (!methods.has(method.code)) continue
    record[method.requestKey] = null
    record[method.requestDateKey] = null
    record[method.resultKey] = null
  }
  if (removesPsto) {
    record.pstoRequest = null
    record.pstoRequestDate = null
    record.pstoResult = null
  }
  const hydrated = record as WeldRow
  if (hydrated.preHeatTreatmentControls) hydrated.preHeatTreatmentControls = hydrated.preHeatTreatmentControls.map(control =>
    removesPsto || methods.has(control.method as typeof ALL_LNK_FIELD_METHODS[number]['code'])
      ? { ...control, requestName: null, requestDate: null, result: null }
      : control)
  if (hydrated.pstoRepeatCycles) hydrated.pstoRepeatCycles = hydrated.pstoRepeatCycles.map(cycle => ({
    ...cycle,
    ...(removesPsto ? { pstoRequest: null, pstoRequestDate: null, pstoResult: null } : {}),
    ...(methods.has('ТВМТ') ? { tvmtRequest: null, tvmtRequestDate: null, tvmtResult: null } : {}),
  }))
}
