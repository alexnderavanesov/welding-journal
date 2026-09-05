import type { WeldRow } from '@/lib/dispatcher-types'
import { isFinalLnkResultValue } from '@/lib/lnk-status'
import { LNK_METHODS } from '@/lib/report-config'
import type { WorkflowRootCauseTarget } from '@/lib/workflow-root-cause-actions'

export type WorkflowRootCauseDestination =
  | 'weld-form'
  | 'lnk-request-dialog'
  | 'lnk-request-manager'
  | 'lnk-result-manager'
  | 'lnk-result-dialog'
  | 'pre-lnk-manager'
  | 'psto-request-manager'
  | 'psto-result-manager'
  | 'duplicate-control'

export function getWorkflowRootCauseDestination(
  target: WorkflowRootCauseTarget,
  row: WeldRow,
): WorkflowRootCauseDestination {
  if (target.kind === 'weld-field') return 'weld-form'
  if (target.kind === 'duplicate-control') return 'duplicate-control'
  if (target.kind === 'psto-cycle') {
    return target.sequence === 1 && target.stage === 'pstoRequest' && String(row.pstoRequest ?? '').trim()
      ? 'psto-request-manager'
      : 'psto-result-manager'
  }
  if (target.stage === 'beforeHeatTreatment') return 'pre-lnk-manager'
  const method = LNK_METHODS.find((candidate) => candidate.code === target.methodCode)
  if (target.documentPart === 'request') {
    if (method && String(row[method.requestKey] ?? '').trim()) return 'lnk-request-manager'
    return method && isFinalLnkResultValue(row[method.resultKey])
      ? 'lnk-result-manager'
      : 'lnk-request-dialog'
  }
  return method && isFinalLnkResultValue(row[method.resultKey])
    ? 'lnk-result-manager'
    : 'lnk-result-dialog'
}

export function getCurrentWorkflowRequestIdentity(
  target: WorkflowRootCauseTarget,
  row: WeldRow,
) {
  if (
    target.kind === 'lnk-control' &&
    target.stage === 'primary' &&
    target.documentPart === 'request'
  ) {
    const method = LNK_METHODS.find((candidate) => candidate.code === target.methodCode)
    if (!method) return null
    return {
      name: String(row[method.requestKey] ?? '').trim(),
      date: String(row[method.requestDateKey] ?? '').trim().slice(0, 10),
    }
  }
  if (
    target.kind === 'psto-cycle' &&
    target.sequence === 1 &&
    target.stage === 'pstoRequest'
  ) {
    return {
      name: String(row.pstoRequest ?? '').trim(),
      date: String(row.pstoRequestDate ?? '').trim().slice(0, 10),
    }
  }
  return null
}
