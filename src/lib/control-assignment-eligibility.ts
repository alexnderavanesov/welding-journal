import type { WeldInput } from './weld-fields'
import { normalizeControlAvailabilityStorageText } from './control-availability-values'

export const EXCLUDED_CONTROL_ASSIGNMENT_REASON = 'Изменение назначений НК доступно только для официального актуального стыка. Сначала верните официальность и актуальность; сохранённая история не удаляется.'
export const EDITABLE_NK_ASSIGNMENT_FIELDS = ['hasRk', 'hasUzk', 'hasPvk'] as const

/** Exclusion suspends work, not history. This is independent of joint type and
 * does not restrict unrelated edits or the always-on system assignment of VIK. */
export function isActiveOfficialWeld(row: Pick<WeldInput, 'officiality' | 'revisionActuality'>) {
  const officiality = row.officiality
  if (officiality === 'неофициальный') return false
  if (officiality !== 'действующий' && officiality !== '' && officiality != null &&
    String(officiality ?? '').trim().toLocaleLowerCase('ru') === 'неофициальный') return false

  const revisionActuality = row.revisionActuality
  if (revisionActuality === 'не актуален') return false
  return revisionActuality === 'актуальная' || revisionActuality === '' || revisionActuality == null ||
    String(revisionActuality ?? '').trim().toLocaleLowerCase('ru') !== 'не актуален'
}

export function getExcludedControlAssignmentIssues(current: WeldInput, previous?: WeldInput) {
  if (isActiveOfficialWeld(current)) return []
  return EDITABLE_NK_ASSIGNMENT_FIELDS.flatMap(field =>
    normalizeControlAvailabilityStorageText(current[field]) === normalizeControlAvailabilityStorageText(previous?.[field])
      ? [] : [{ message: EXCLUDED_CONTROL_ASSIGNMENT_REASON, fieldKeys: [field] }])
}
