import { parseJointChainName, normalizeJointChainPart } from './joint-chain'
import { isPstoCancelledValue, type PstoLineAssignmentState } from './psto-line-assignment'
import { getControlAssignmentPerformedHistory, getControlAssignmentRemovalHistory } from './control-assignment-history'
import type { SystemIndexSettings } from './system-index-settings'
import type { WeldRow } from './dispatcher-types'

export type PstoChainDecision = { id: number; required: boolean; basis: string }
export type ImportPstoLinePolicy = {
  key: string
  state: PstoLineAssignmentState
  exceptions: { rootJoint: string; required: boolean }[]
}
export type PstoLinePolicy = {
  rowCount: number
  assignedCount: number
  cancelledCount?: number
  cancellationDate?: string
  cancellationBasis?: string
  programState?: PstoLineAssignmentState | null
  exceptions?: ReadonlyMap<string, PstoChainDecision>
}

export function getPstoProgramState(policy: PstoLinePolicy | undefined): PstoLineAssignmentState {
  if (policy?.programState) return policy.programState
  if (!policy?.rowCount) return 'unassigned'
  if (policy.assignedCount === policy.rowCount) return 'assigned'
  if (policy.cancelledCount === policy.rowCount) return 'cancelled'
  return policy.assignedCount || policy.cancelledCount ? 'mixed' : 'unassigned'
}

export function getPstoChainRoot(joint: unknown, settings: SystemIndexSettings) {
  return normalizeJointChainPart(parseJointChainName(String(joint ?? ''), settings).base)
}

export function getPstoChainDecision(policy: PstoLinePolicy | undefined, joint: unknown, settings: SystemIndexSettings) {
  return policy?.exceptions?.get(getPstoChainRoot(joint, settings))
}

/** The line policy governs future work. Its withdrawal must not cancel a
 * performed joint or the TVMT/repeats still required by that joint's own work. */
export function applyPstoChainPolicy(row: WeldRow, policy: PstoLinePolicy, settings: SystemIndexSettings): WeldRow {
  const state = getPstoProgramState(policy)
  if (state === 'mixed') throw new Error('Назначение ПСТО линии противоречиво. Уточните программу линии перед изменением исключений.')
  const exception = getPstoChainDecision(policy, row.joint, settings)
  const required = exception?.required ?? state === 'assigned'
  if (!required && getControlAssignmentPerformedHistory(row, 'pstoRequired')) {
    return { ...row, pstoExceptionBasis: exception?.basis ?? null }
  }
  const cancelled = !required && (state === 'cancelled' || exception?.required === false ||
    getControlAssignmentRemovalHistory(row, 'pstoRequired') || isPstoCancelledValue(row.pstoRequired))
  return {
    ...row,
    pstoRequired: required ? 'да' : cancelled ? 'отменен' : null,
    pstoExceptionBasis: exception?.basis ?? null,
    pstoCancellationDate: !required && state === 'cancelled' ? policy.cancellationDate || null : null,
    pstoControlBasis: !required && state === 'cancelled' ? policy.cancellationBasis || null : null,
  }
}
