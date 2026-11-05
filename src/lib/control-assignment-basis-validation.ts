import { CONTROL_ASSIGNMENT_BASIS_FIELDS } from './control-assignment-basis'
import { normalizeControlAvailabilityStorageText } from './control-availability-values'
import type { WeldFieldKey, WeldInput } from './weld-field-definitions'

// PSTO/TVMT assignments are derived by their dedicated line/cycle workflows;
// inherited legacy policies must not become a new per-joint editing requirement.
const fields = CONTROL_ASSIGNMENT_BASIS_FIELDS

export function requiresControlAssignmentBasis(value: unknown) {
  const state = normalizeControlAvailabilityStorageText(value)
  return state === 'отменен' || state === 'дополнительный'
}

/** Preserve unchanged legacy values, including automatic copies from a stored
 * source. The inheritance source is supplied by the server workflow, never by
 * a submitted weld payload; it does not exempt a new/changed manual assignment. */
export function getControlAssignmentBasisIssues(record: WeldInput, previous?: WeldInput, inheritedFrom?: WeldInput) {
  const reference = previous?.id ? previous : inheritedFrom
  const issues: { fieldKeys: WeldFieldKey[]; message: string }[] = []
  for (const field of fields) {
    const state = normalizeControlAvailabilityStorageText(record[field.assignmentKey])
    if (!requiresControlAssignmentBasis(state) || String(record[field.basisKey] ?? '').trim()) continue
    if (reference?.id && state === normalizeControlAvailabilityStorageText(reference[field.assignmentKey]) &&
      String(record[field.basisKey] ?? '').trim() === String(reference[field.basisKey] ?? '').trim()) continue
    issues.push({ fieldKeys: [field.assignmentKey, field.basisKey],
      message: `${field.code}: для назначения «${state === 'отменен' ? 'Отменен' : 'Дополнительный'}» заполните «Основание к назначению».` })
  }
  return issues
}
