import { calculateFinalStatus, type WeldInput } from '@/lib/weld-fields'
import {
  LNK_METHODS,
  REPEATED_JOINT_CLEARED_FIELD_KEYS as repeatedJointClearedFieldKeys,
} from '@/lib/report-config'
import type { WeldDraft, WeldRow } from '@/lib/dispatcher-types'

export function buildRepeatedJointDraft(sourceRow: WeldRow, targetJoint: string): WeldInput {
  const draft = { ...sourceRow } as WeldDraft & Pick<
    WeldRow,
    'duplicateControls' | 'preHeatTreatmentControls' | 'pstoRepeatCycles'
  >
  delete draft.id
  for (const fieldKey of repeatedJointClearedFieldKeys) {
    ;(draft as Record<string, unknown>)[fieldKey] = null
  }
  draft.duplicateControls = []
  draft.preHeatTreatmentControls = []
  draft.pstoRepeatCycles = []
  restoreRepeatedJointControlAvailability(draft, sourceRow)
  draft.joint = targetJoint
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
