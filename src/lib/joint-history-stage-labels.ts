import { isControlCancelledValue, isControlEnabledValue } from '@/lib/control-availability-values'
import {
  getPreHeatTreatmentControls,
  getPreHeatTreatmentPendingFinalStatus,
  getRejectedPreHeatTreatmentControls,
  PRE_HEAT_TREATMENT_LNK_METHODS,
} from '@/lib/lnk-control-stage'
import { isPstoNoNeed } from '@/lib/lnk-status'
import {
  getRetainedPstoCycleLabel,
  hasPstoCycleExecutionHistory,
  type PstoCycleSnapshot,
} from '@/lib/psto-cycle'
import { isPreHeatTreatmentStageEnabled } from '@/lib/pre-heat-treatment-policy'
import { hasWeldDate, normalizeControlResultText } from '@/lib/report-value-utils'
import { isCompletedPstoResult, normalizeTvmtResult } from '@/lib/tvmt-cycle'
import type { WeldInput } from '@/lib/weld-fields'

// Read-only picture labels. Assignment and workflow rules remain in their
// existing helpers; documents are rendered independently of these captions.
export function getJointPstoAssignmentLabel(row: WeldInput): string | null {
  if (isControlCancelledValue(row.pstoRequired)) return 'ПСТО отменено'
  return isControlEnabledValue(row.pstoRequired) ? null : 'ПСТО не предусмотрено'
}

export function getJointPreHeatTreatmentLabel(row: WeldInput): string | null {
  const assignment = getJointPstoAssignmentLabel(row)
  if (assignment) return assignment
  if (!isPreHeatTreatmentStageEnabled(row)) return 'НК до ТО отключён в настройках'
  if (getRejectedPreHeatTreatmentControls(row).length > 0) return null
  if (!PRE_HEAT_TREATMENT_LNK_METHODS.some(method => isControlEnabledValue(row[method.enabledKey]))) {
    return 'Методы НК до ТО не назначены'
  }
  if (!hasWeldDate(row)) {
    return getPreHeatTreatmentControls(row).length ? 'Дата сварки не указана' : 'Ожидает сварку'
  }
  const pending = getPreHeatTreatmentPendingFinalStatus(row)
  if (pending === 'ожидает заявку') return 'Ожидает заявку НК до ТО'
  if (pending === 'ожидает НК') return 'Ожидает результаты НК до ТО'
  return null
}

export function getJointPstoStartLabel(row: WeldInput): string {
  const assignment = getJointPstoAssignmentLabel(row)
  if (assignment) return assignment
  if (getRejectedPreHeatTreatmentControls(row).length > 0) {
    return 'ПСТО не требуется: НК до ТО имеет негодный результат'
  }
  if (isPstoNoNeed(row)) return 'ПСТО не требуется: стык имеет негодный результат'
  if (!hasWeldDate(row)) return 'Ожидает сварку'
  const pending = getPreHeatTreatmentPendingFinalStatus(row)
  if (pending === 'ожидает заявку') return 'Ожидает НК до ТО'
  if (pending === 'ожидает НК') return 'Ожидает завершения НК до ТО'
  return 'Ожидает заявку ПСТО'
}

export function hasJointPstoCycleHistory(cycle: PstoCycleSnapshot): boolean {
  // The timeline also creates a placeholder cycle from assignment/waiting
  // values alone. Only that placeholder is replaced with a section caption.
  return hasPstoCycleExecutionHistory(cycle) || Boolean(
    cycle.pstoRequest || cycle.pstoRequestDate || cycle.pstoNote ||
    [cycle.pstoResult, cycle.tvmtResult].some(value => {
      const result = normalizeControlResultText(value)
      return result && !result.startsWith('ожидает')
    }),
  )
}

export function getJointPstoCycleLabel(row: WeldInput, cycle: PstoCycleSnapshot): string {
  const retained = getRetainedPstoCycleLabel(row, cycle)
  const hasRecordedResult = [cycle.pstoResult, cycle.tvmtResult].some(value => {
    const result = normalizeControlResultText(value)
    return result && !result.startsWith('ожидает') &&
      !['-', 'нет потребности', 'не требуется', 'отменен'].includes(result)
  })
  if (retained && !hasRecordedResult) return retained
  // A recorded result must remain visible even if the current assignment or
  // another method's result no longer requires future PSTO for this joint.
  if (normalizeTvmtResult(cycle.tvmtResult)) return `ТВМТ: ${cycle.tvmtResult}`
  if (cycle.tvmtResult && !normalizeControlResultText(cycle.tvmtResult).startsWith('ожидает')) {
    return `ТВМТ: ${cycle.tvmtResult}`
  }
  if (isCompletedPstoResult(cycle.pstoResult)) {
    return `ПСТО: ${cycle.pstoResult} · ${cycle.tvmtRequest ? 'Ожидает результат ТВМТ' : 'Ожидает заявку ТВМТ'}`
  }
  if (cycle.pstoResult && !normalizeControlResultText(cycle.pstoResult).startsWith('ожидает')) {
    return `ПСТО: ${cycle.pstoResult}`
  }
  if (isPstoNoNeed(row, cycle.pstoResult)) {
    return getJointPstoStartLabel(row)
  }
  if (cycle.pstoRequest) return 'Ожидает ПСТО'
  // Preserve partial historical facts without suggesting that treatment has
  // already happened merely because a generated waiting value exists.
  if (hasPstoCycleExecutionHistory(cycle)) return 'Данные цикла неполные'
  return cycle.source === 'repeat' ? 'Ожидает заявку ПСТО' : getJointPstoStartLabel(row)
}
