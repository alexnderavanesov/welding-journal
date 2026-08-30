import { isControlEnabledValue } from '@/lib/control-availability-values'
import {
  buildPstoCycleTimeline,
  hasPstoExecutionHistory,
  type PstoCycleSnapshot,
  type PstoRepeatCycleRecord,
} from '@/lib/psto-cycle'
import type { WeldInput } from '@/lib/weld-fields'
import { isCancelledControlValue } from '@/lib/report-value-utils'

export const TVMT_RESULT_OPTIONS = ['годен', 'не годен'] as const

export type TvmtNormalizedResult = 'good' | 'failed' | null
export type PstoCycleWorkflowAction = 'pstoRequest' | 'pstoResult' | 'tvmtRequest' | 'tvmtResult'
export type PstoTvmtWorkflowState =
  | 'not-required'
  | 'waiting-psto-request'
  | 'waiting-psto'
  | 'waiting-tvmt-request'
  | 'waiting-tvmt'
  | 'repeat-psto-required'
  | 'complete'

export function getPstoTvmtWorkflowState(
  row: WeldInput,
  repeatCycles: readonly PstoRepeatCycleRecord[] = getRowRepeatCycles(row),
): PstoTvmtWorkflowState {
  const timeline = buildPstoCycleTimeline(row, repeatCycles)
  const active = isControlEnabledValue(row.pstoRequired)
  const inactiveWithPerformedHistory = !active && hasPstoExecutionHistory(row, repeatCycles)
  if (!active && !inactiveWithPerformedHistory) return 'not-required'

  const currentCycle = timeline.at(-1)
  if (!currentCycle?.pstoRequest) return 'waiting-psto-request'
  if (!isCompletedPstoResult(currentCycle.pstoResult)) return 'waiting-psto'
  if (!currentCycle.tvmtRequest) return 'waiting-tvmt-request'

  const tvmtResult = normalizeTvmtResult(currentCycle.tvmtResult)
  if (tvmtResult === 'good') return 'complete'
  if (tvmtResult === 'failed') return active ? 'repeat-psto-required' : 'complete'
  return 'waiting-tvmt'
}

export function getPstoTvmtWorkflowLabel(state: PstoTvmtWorkflowState) {
  if (state === 'not-required') return 'не требуется'
  if (state === 'waiting-psto-request') return 'ожидает заявку ПСТО'
  if (state === 'waiting-psto') return 'ожидает ПСТО'
  if (state === 'waiting-tvmt-request') return 'ожидает заявку ТВМТ'
  if (state === 'waiting-tvmt') return 'ожидает ТВМТ'
  if (state === 'repeat-psto-required') return 'требуется повторная ПСТО'
  return 'цикл завершен'
}

export function getPstoCycleSummary(row: WeldInput, primaryStartStatusLabel = '') {
  const cancelled = isCancelledControlValue(row.pstoRequired)
  const state = getPstoTvmtWorkflowState(row)
  if (state === 'not-required') return cancelled ? 'ПСТО отменено' : 'не требуется'
  const cycle = getCurrentPstoCycle(row)
  const cycleLabel = cycle?.source === 'repeat'
    ? `Повтор #${cycle.sequence}`
    : 'Основной'
  const stateLabel = state === 'waiting-psto-request' && cycle?.source !== 'repeat' && primaryStartStatusLabel
    ? primaryStartStatusLabel
    : getPstoTvmtWorkflowLabel(state)
  return `${cycleLabel} · ${stateLabel}${cancelled ? ' · линия отменена' : ''}`
}

export function requiresPostHeatTreatmentCompletion(row: WeldInput) {
  return getPstoTvmtWorkflowState(row) !== 'not-required'
}

export function getPstoTvmtPendingFinalStatus(state: PstoTvmtWorkflowState) {
  if (state === 'waiting-psto-request' || state === 'waiting-tvmt-request' || state === 'repeat-psto-required') {
    return 'ожидает заявку' as const
  }
  if (state === 'waiting-psto' || state === 'waiting-tvmt') return 'ожидает НК' as const
  return null
}

export function canCreateRepeatPstoCycle(
  row: WeldInput,
  repeatCycles: readonly PstoRepeatCycleRecord[] = getRowRepeatCycles(row),
) {
  return getPstoTvmtWorkflowState(row, repeatCycles) === 'repeat-psto-required'
}

export function getNextPstoCycleSequence(
  row: WeldInput,
  repeatCycles: readonly PstoRepeatCycleRecord[] = getRowRepeatCycles(row),
) {
  return buildPstoCycleTimeline(row, repeatCycles).reduce(
    (maximum, cycle) => Math.max(maximum, cycle.sequence),
    1,
  ) + 1
}

export function getPstoWorkflowCycleSequence(
  row: WeldInput,
  action: PstoCycleWorkflowAction,
) {
  if (action === 'pstoRequest' && canCreateRepeatPstoCycle(row)) {
    return getNextPstoCycleSequence(row)
  }
  return getCurrentPstoCycle(row)?.sequence ?? 1
}

export function getCurrentPstoCycle(
  row: WeldInput,
  repeatCycles: readonly PstoRepeatCycleRecord[] = getRowRepeatCycles(row),
): PstoCycleSnapshot | null {
  return buildPstoCycleTimeline(row, repeatCycles).at(-1) ?? null
}

export function normalizeTvmtResult(value: unknown): TvmtNormalizedResult {
  const result = String(value ?? '').trim().toLocaleLowerCase('ru-RU')
  if (result === 'годен' || result === 'да') return 'good'
  if (result === 'не годен' || result === 'негоден' || result === 'ремонт' || result === 'вырез') return 'failed'
  return null
}

export function isCompletedPstoResult(value: unknown) {
  const result = String(value ?? '').trim().toLocaleLowerCase('ru-RU')
  return result === 'проведено' || result === 'проведено (отменен)' || result === 'да'
}

function getRowRepeatCycles(row: WeldInput) {
  return ((row as WeldInput & { pstoRepeatCycles?: PstoRepeatCycleRecord[] }).pstoRepeatCycles ?? [])
}
