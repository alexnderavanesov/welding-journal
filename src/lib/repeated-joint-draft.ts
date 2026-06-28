import { calculateFinalStatus, type WeldInput } from '@/lib/weld-fields'
import {
  LNK_METHODS,
  REPEATED_JOINT_CLEARED_FIELD_KEYS as repeatedJointClearedFieldKeys,
} from '@/lib/report-config'
import type { WeldRow } from '@/lib/dispatcher-types'

export function buildRepeatedJointDraft(sourceRow: WeldRow, targetJoint: string): WeldInput {
  const draft = { ...sourceRow } as WeldInput & { id?: number }
  delete draft.id
  for (const fieldKey of repeatedJointClearedFieldKeys) {
    draft[fieldKey] = null
  }
  restoreRepeatedJointControlAvailability(draft, sourceRow)
  draft.joint = targetJoint
  draft.status = null
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
