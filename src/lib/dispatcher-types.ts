import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'
import type { DuplicateControlRecord } from '@/lib/duplicate-control-types'
import type { PreHeatTreatmentControlRecord } from '@/lib/lnk-control-stage'
import type { PstoRepeatCycleRecord } from '@/lib/psto-cycle'
import type { WorkflowRootCauseAction } from '@/lib/workflow-root-cause-actions'

export type JointChainContinuation = {
  kind: 'repeated-joint' | 'official-joint' | 'coil'
  sourceRowId: number
  sourceJoint: string
  targetJoints: string[]
  targetRowIds: number[]
  projectTitle: string
  subtitleCode: string
  line: string
}

export type WeldRow = WeldInput & {
  id: number
  programRepairRequirements?: import('./line-program-repair-requirements').RepairControlRequirement[]
  programChainState?: import('./line-program-chain-state').ProgramChainState
  chainContinuation?: JointChainContinuation
  earlyCoilDecisionAccepted?: boolean
  preHeatTreatmentLnkEnabled?: boolean
  rowVersion?: string
  activeDispatcherTasks?: string
  duplicateControls?: DuplicateControlRecord[]
  preHeatTreatmentControls?: PreHeatTreatmentControlRecord[]
  pstoRepeatCycles?: PstoRepeatCycleRecord[]
  jsrDocumentId?: number
  checklistDocumentId?: number
  zniDocumentId?: number
  layeredVikEdgesDocumentId?: number
  layeredVikLayersDocumentId?: number
  layeredPvkEdgesDocumentId?: number
  layeredPvkLayersDocumentId?: number
  systemDocumentIds?: Partial<Record<WeldFieldKey, number>>
}
export type WeldDraft = WeldInput & { id?: number }

export type RepeatedJointCreateTask = {
  kind: 'create'
  key: string
  row: WeldRow
  sourceJoint: string
  targetJoint: string
  result: 'ремонт' | 'вырез'
  suffix: 'R' | 'W'
  methodCode: string
}

export type RepeatedJointCoilTask = {
  kind: 'coil'
  key: string
  row: WeldRow
  sourceJoint: string
  targetJoints: string[]
  result: 'ремонт' | 'вырез'
  methodCode: string
  transitionMode?: 'limit' | 'early-decision'
}

export type RepeatedJointDeleteTask = {
  kind: 'delete'
  key: string
  row: WeldRow
  sourceRow: WeldRow
  sourceJoint: string
  targetJoint: string
  suffix: 'R' | 'W'
  reason: string
}

export type RepeatedJointRenameChange = {
  rowId: number
  currentJoint: string
  targetJoint: string
}

export type RepeatedJointRenameTask = {
  kind: 'rename'
  key: string
  row: WeldRow
  sourceRow: WeldRow
  sourceJoint: string
  currentJoint: string
  targetJoint: string
  baseJoint: string
  changes: RepeatedJointRenameChange[]
}

export type RepeatedJointCheckTask = {
  kind: 'check'
  key: string
  row: WeldRow
  sourceRow: WeldRow
  sourceJoint: string
  targetJoint: string
  baseJoint: string
  suffix: 'R' | 'W'
  reason?: string
  details?: string
  rootCauseActions?: WorkflowRootCauseAction[]
  systemWarningCode?: 'СП-01' | 'СП-04'
  coilRestorationRootId?: number
  actualityRowIds?: number[]
}

export type RepeatedJointDuplicateCheckTask = {
  kind: 'duplicate-check'
  key: string
  row: WeldRow
  sourceJoint: string
  baseJoint: string
  count: number
}

export type LineConsistencyTask = {
  kind: 'line-consistency'
  key: string
  row: WeldRow
  line: string
  projectTitle: string
  subtitleCode: string
  fieldKey: 'weldControlPercent' | 'pvkControlPercent' | 'groupName' | 'category' | 'controlPresence' | 'pstoPresence'
  systemWarningCode?: 'СП-02' | 'СП-03'
  fieldLabel: string
  title: string
  values: string[]
  details: string
}

export type PercentageLineControlTask = {
  kind: 'percentage-line-control'
  key: string
  row: WeldRow
  issue: 'missing' | 'excess' | 'new-welder' | 'rejected-rows' | 'suspend-welder'
  demandKind?: 'common' | 'pvk'
  projectTitle: string
  subtitleCode: string
  line: string
  stamp: string
  title: string
  details: string
  targetRowIds?: number[]
  suspensionFrom?: string
  requiredControls: number
  coveredControls: number
  assignedControls: number
  count: number
  fullControlRequired?: boolean
}

export type RepeatedJointTask =
  | RepeatedJointCreateTask
  | RepeatedJointCoilTask
  | RepeatedJointDeleteTask
  | RepeatedJointRenameTask
  | RepeatedJointCheckTask
  | RepeatedJointDuplicateCheckTask
  | LineConsistencyTask
  | PercentageLineControlTask

export type WelderStampExpiryTask = {
  kind: 'welder-stamp-expiry'
  key: string
  stamp: WelderStampRecord
  permitKind: 'naks' | 'dls'
  permitNumber?: string
  naksStamp: string
  validTo: string
  daysLeft: number
  expired: boolean
}

export type DispatcherTask = RepeatedJointTask | WelderStampExpiryTask

export function isSystemDispatcherWarningTask(
  task: { kind?: string; systemWarningCode?: string },
): task is (RepeatedJointCheckTask & { systemWarningCode: 'СП-01' | 'СП-04' }) | (LineConsistencyTask & { systemWarningCode: 'СП-02' | 'СП-03' }) {
  return (task.kind === 'check' && (task.systemWarningCode === 'СП-01' || task.systemWarningCode === 'СП-04')) ||
    (task.kind === 'line-consistency' && (task.systemWarningCode === 'СП-02' || task.systemWarningCode === 'СП-03'))
}

export type RepeatedJointTaskGroup = {
  key: string
  baseJoint: string
  tasks: DispatcherTask[]
}
