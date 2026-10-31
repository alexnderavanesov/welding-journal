import type { WeldInput } from './weld-fields'
import type { PstoTvmtWorkflowState } from './tvmt-cycle'

/** Availability context for fields hidden by access rights, never editable facts. */
export type ControlWorkflowAccess = {
  welded?: boolean
  heatTreatmentRequired?: boolean
  heatTreatmentState?: PstoTvmtWorkflowState
  pstoPrerequisites?: { rejected: string[]; missingRequests: string[]; pendingResults: string[] }
}

export function getControlWorkflowAccess(row: WeldInput): ControlWorkflowAccess | undefined {
  return (row as WeldInput & { controlWorkflowAccess?: ControlWorkflowAccess }).controlWorkflowAccess
}
