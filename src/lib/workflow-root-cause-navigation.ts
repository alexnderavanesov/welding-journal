import type { WeldRow } from '@/lib/dispatcher-types'
import { isFinalLnkResultValue } from '@/lib/lnk-status'
import { LNK_METHODS } from '@/lib/report-config'
import type { WorkflowRootCauseTarget } from '@/lib/workflow-root-cause-actions'
import type { JointNextAction } from '@/lib/joint-next-actions'
import { getCurrentPstoCycle, getPstoTvmtWorkflowState, getPstoWorkflowCycleSequence } from '@/lib/tvmt-cycle'
import { getPreHeatTreatmentControl, isPreHeatTreatmentLnkMethodCode } from '@/lib/lnk-control-stage'
import { canAddPreHeatTreatmentResult, canCreatePreHeatTreatmentRequest } from '@/lib/pre-heat-treatment-control-updates'

export function getPreHeatTreatmentStageCompletionNextAction(
  target: Extract<WorkflowRootCauseTarget, { kind: 'lnk-control' }>,
  row: WeldRow,
): JointNextAction | null {
  if (target.intent !== 'complete-stage' || target.stage !== 'beforeHeatTreatment' ||
    target.rowId !== row.id || !isPreHeatTreatmentLnkMethodCode(target.methodCode)) return null
  const control = getPreHeatTreatmentControl(row, target.methodCode)
  if (target.relationId !== undefined && target.relationId !== control?.id) return null
  const request = target.documentPart === 'request'
  if (request ? !canCreatePreHeatTreatmentRequest(row, target.methodCode)
    : target.documentPart !== 'result' || !canAddPreHeatTreatmentResult(row, target.methodCode)) return null
  return {
    key: `complete-stage:${row.id}:beforeHeatTreatment:${target.methodCode}:${target.documentPart}`,
    kind: request ? 'preLnkRequest' : 'preLnkResult',
    methodCode: target.methodCode,
    title: request ? 'Создать заявку НК до ТО' : 'Внести результат НК до ТО',
    description: `Недостающие данные ${target.methodCode} до ТО`,
    tone: 'warning',
  }
}

// Completion must use the creation workflow, not the existing-stage editor.
// Compare with freshly loaded state so a stale card cannot target another cycle.
export function getPstoStageCompletionNextAction(
  target: Extract<WorkflowRootCauseTarget, { kind: 'psto-cycle' }>,
  row: WeldRow,
): JointNextAction | null {
  if (target.intent !== 'complete-stage') return null
  const state = getPstoTvmtWorkflowState(row)
  const stage = state === 'waiting-psto-request' || state === 'repeat-psto-required'
    ? 'pstoRequest'
    : state === 'waiting-psto' ? 'pstoResult'
      : state === 'waiting-tvmt-request' ? 'tvmtRequest'
        : state === 'waiting-tvmt' ? 'tvmtResult' : null
  if (!stage || stage !== target.stage || row.id !== target.rowId ||
    getPstoWorkflowCycleSequence(row, stage) !== target.sequence ||
    (target.cycleId !== undefined && target.cycleId !== getCurrentPstoCycle(row)?.id)) return null
  return {
    key: `complete-stage:${row.id}:${target.sequence}:${stage}`,
    kind: stage,
    title: stage.startsWith('tvmt') ? 'Завершить ТВМТ' : 'Завершить ПСТО',
    description: `Недостающий этап цикла ${target.sequence}`,
    tone: 'warning',
  }
}

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
  if (target.stage === 'beforeHeatTreatment') {
    return 'pre-lnk-manager'
  }
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
