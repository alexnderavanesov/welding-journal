import { calculateFinalStatus, type WeldInput } from '@/lib/weld-fields'
import {
  LNK_METHODS,
  REPEATED_JOINT_CLEARED_FIELD_KEYS as repeatedJointClearedFieldKeys,
} from '@/lib/report-config'
import type { WeldDraft, WeldRow } from '@/lib/dispatcher-types'
import { parseJointName } from './joint-name'
import { isTConnectionType } from './connection-type'
import { normalizeSupportWeldLength } from './support-length-value'
import { loadSystemIndexSettings, type SystemIndexSettings } from './system-index-settings'

export function buildRepeatedJointDraft(sourceRow: WeldRow, targetJoint: string, context: {
  rows?: readonly WeldRow[]; approved?: ReadonlySet<string>; settings?: SystemIndexSettings
} = {}): WeldInput {
  const settings = context.settings ?? loadSystemIndexSettings()
  if (isTConnectionType(sourceRow.connectionType) && parseJointName(targetJoint, settings).segments.some(segment => segment.suffix !== 'R')) {
    throw new Error('Для Т разрешены только ремонты R; вырез и катушка запрещены.')
  }
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
  const sourceSegments = parseJointName(String(sourceRow.joint ?? ''), settings).segments
  const targetSegments = parseJointName(targetJoint, settings).segments
  const newCoil = targetSegments.slice(sourceSegments.length).some(segment => segment.suffix === 'Y')
  draft.preHeatTreatmentRequired = newCoil ? false : sourceRow.preHeatTreatmentRequired === true
  delete (draft as Record<string, unknown>).preHeatTreatmentConfirmation
  restoreRepeatedJointControlAvailability(draft, sourceRow)
  draft.joint = targetJoint
  if (isTConnectionType(draft.connectionType)) draft.weldLength = normalizeSupportWeldLength(sourceRow.weldLength)
  // Copy assignment states/bases exactly; a rejected additional method remains
  // Additional and cancellation remains cancellation. VIK is always mandatory.
  draft.hasVik = 'да'
  draft.officiality = null
  draft.createdAt = new Date().toISOString()
  draft.finalStatus = calculateFinalStatus(draft)
  return draft
}

function restoreRepeatedJointControlAvailability(draft: WeldInput, sourceRow: WeldInput) {
  draft.pstoRequired = sourceRow.pstoRequired
  for (const method of LNK_METHODS) {
    draft[method.enabledKey] = isTConnectionType(sourceRow.connectionType) && method.code === 'РК'
      ? null
      : sourceRow[method.enabledKey]
  }
}
