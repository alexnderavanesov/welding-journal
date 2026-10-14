import { OFFICIAL_WELDER_STAMP_FIELD_KEYS } from './report-common-config'
import type { WeldInput } from './weld-fields'

/** Every row value read by getOfficialStampCompatibilityIssues, including team
 * positions and ordered dimensions of dissimilar materials. Keep raw spelling:
 * issue messages also depend on it. Per-joint labels/keys are assembled later.
 */
export const OFFICIAL_STAMP_COMPATIBILITY_PROFILE_FIELDS = [
  ...OFFICIAL_WELDER_STAMP_FIELD_KEYS,
  'weldingMethod', 'materialGroup', 'connectionType', 'd1', 'd2', 't1', 't2', 'weldDate',
] as const

export function getOfficialStampCompatibilityProfileKey(record: WeldInput) {
  return JSON.stringify(OFFICIAL_STAMP_COMPATIBILITY_PROFILE_FIELDS.map(key => String(record[key] ?? '')))
}
