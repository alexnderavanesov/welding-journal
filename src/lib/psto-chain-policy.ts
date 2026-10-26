import { parseJointChainName, normalizeJointChainPart } from './joint-chain'
import { hasPstoLifecycleData, isPstoCancelledValue, type PstoLineAssignmentState } from './psto-line-assignment'
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

/** Change the decision, never the facts. Withdrawal of an existing package keeps
 * a cancellation marker; new unrelated joints on an unassigned line stay empty. */
export function applyPstoChainPolicy(row: WeldRow, policy: PstoLinePolicy, settings: SystemIndexSettings): WeldRow {
  const state = getPstoProgramState(policy)
  if (state === 'mixed') throw new Error('Назначение ПСТО линии противоречиво. Уточните программу линии перед изменением исключений.')
  const exception = getPstoChainDecision(policy, row.joint, settings)
  const required = exception?.required ?? state === 'assigned'
  const cancelled = !required && (state === 'cancelled' || exception?.required === false ||
    hasPstoLifecycleData(row) || isPstoCancelledValue(row.pstoRequired))
  return {
    ...row,
    pstoRequired: required ? 'да' : cancelled ? 'отменен' : null,
    pstoExceptionBasis: exception?.basis ?? null,
    pstoCancellationDate: !required && state === 'cancelled' ? policy.cancellationDate || null : null,
    pstoControlBasis: !required && state === 'cancelled' ? policy.cancellationBasis || null : null,
  }
}
