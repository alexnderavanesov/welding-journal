import { hasPermission, type AccessIdentity } from '@/lib/access-permissions'
import type { ControlWorkflowAccess } from '@/lib/control-workflow-access'
import { getPrimaryPstoStartPrerequisites, isPreHeatTreatmentLnkAvailable, requiresHeatTreatmentStagedLnk } from '@/lib/lnk-control-stage'
import { hasWeldDate } from '@/lib/report-value-utils'
import { getPstoTvmtWorkflowState } from '@/lib/tvmt-cycle'
import type { WeldInput } from '@/lib/weld-fields'

/** Compute before redaction: hidden facts must not look like absent workflow history.
 * Only availability is shared; document names, dates, notes and results stay private.
 * No queries: use the same versioned row snapshot as the response.
 */
export function projectControlWorkflowAccess(identity: AccessIdentity, source: Record<string, unknown>, result: Record<string, unknown>) {
  const lnk = hasPermission(identity, 'lnk.view'), psto = hasPermission(identity, 'psto.view')
  if (!lnk && !psto || typeof source.id !== 'number' || typeof source.rowVersion !== 'string') return result
  // Full workflow/report reads attach both histories and the current policy.
  // A mutation RETURNING row has neither: do not replace cached readiness
  // with a guess from its primary-cycle fields while the fresh read loads.
  // Transport may omit null facts and empty history arrays; the policy marker
  // survives that compaction and is set after both histories were loaded.
  if (!['selected', 'allPsto'].includes(String(source.preHeatTreatmentMode))) return result
  // Do not accept a transported snapshot as authority when projecting fresh data.
  const row = { ...source, controlWorkflowAccess: undefined } as WeldInput
  const access: ControlWorkflowAccess = {}
  if (!hasPermission(identity, 'welding.view')) access.welded = hasWeldDate(row)
  if (lnk && !psto) {
    access.preHeatTreatmentApplicable = isPreHeatTreatmentLnkAvailable(row)
    access.heatTreatmentRequired = requiresHeatTreatmentStagedLnk(row)
    access.heatTreatmentState = getPstoTvmtWorkflowState(row)
  }
  if (psto && !lnk) access.pstoPrerequisites = getPrimaryPstoStartPrerequisites(row)
  return Object.keys(access).length ? { ...result, controlWorkflowAccess: access } : result
}
