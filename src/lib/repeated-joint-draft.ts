import { calculateFinalStatus, type WeldInput } from '@/lib/weld-fields'
import {
  LNK_METHODS,
  REPEATED_JOINT_CLEARED_FIELD_KEYS as repeatedJointClearedFieldKeys,
} from '@/lib/report-config'
import type { WeldDraft, WeldRow } from '@/lib/dispatcher-types'
import { buildProgramRepairRequirements, REPAIR_CONTROL_FIELDS } from './line-program-repair-requirements'
import { parseRepeatedJointName } from './joint-chain'
import { loadSystemIndexSettings, type SystemIndexSettings } from './system-index-settings'

export function buildRepeatedJointDraft(sourceRow: WeldRow, targetJoint: string, context: {
  rows?: readonly WeldRow[]; approved?: ReadonlySet<string>; settings?: SystemIndexSettings
} = {}): WeldInput {
  const draft = { ...sourceRow } as WeldDraft & Pick<
    WeldRow,
    'duplicateControls' | 'preHeatTreatmentControls' | 'pstoRepeatCycles'
  >
  delete draft.id
  delete (draft as Partial<WeldRow>).programChainState
  delete (draft as Partial<WeldRow>).programRepairRequirements
  for (const fieldKey of repeatedJointClearedFieldKeys) {
    ;(draft as Record<string, unknown>)[fieldKey] = null
  }
  draft.duplicateControls = []
  draft.preHeatTreatmentControls = []
  draft.pstoRepeatCycles = []
  draft.layeredControlAssigned = false
  restoreRepeatedJointControlAvailability(draft, sourceRow)
  draft.joint = targetJoint
  const settings = context.settings ?? loadSystemIndexSettings()
  if (parseRepeatedJointName(targetJoint, settings).segments.length) {
    const requirements = buildProgramRepairRequirements([
      ...(context.rows ?? [sourceRow]), { ...draft, id: -1 },
    ], context.approved, settings).get(-1) ?? []
    for (const requirement of requirements) draft[REPAIR_CONTROL_FIELDS[requirement.method]] = 'да'
  }
  draft.officiality = null
  draft.createdAt = new Date().toISOString()
  draft.finalStatus = calculateFinalStatus(draft)
  return draft
}

function restoreRepeatedJointControlAvailability(draft: WeldInput, sourceRow: WeldInput) {
  draft.pstoRequired = sourceRow.pstoRequired
  for (const method of LNK_METHODS) {
    draft[method.enabledKey] = sourceRow[method.enabledKey]
  }
}
