import { isControlEnabledValue } from '@/lib/control-availability-values'
import type { WeldInput } from '@/lib/weld-fields'

export type PstoRepeatCycleRecord = {
  id: number
  weldJointId: number
  sequence: number
  pstoRequest?: string | null
  pstoRequestDate?: string | null
  pstoDate?: string | null
  heatTreatmentDiagram?: string | null
  pstoResult?: string | null
  pstoNote?: string | null
  tvmtRequest?: string | null
  tvmtRequestDate?: string | null
  tvmtResult?: string | null
  tvmtConclusionDate?: string | null
  tvmtConclusion?: string | null
  createdAt?: Date | string
  updatedAt?: Date | string
}

export type PstoCycleSnapshot = {
  id?: number
  source: 'primary' | 'repeat'
  sequence: number
  pstoRequest: string
  pstoRequestDate: string
  pstoDate: string
  heatTreatmentDiagram: string
  pstoResult: string
  pstoNote: string
  tvmtRequest: string
  tvmtRequestDate: string
  tvmtResult: string
  tvmtConclusionDate: string
  tvmtConclusion: string
}

const PRIMARY_PSTO_CYCLE_FIELD_KEYS = [
  'pstoRequest',
  'pstoRequestDate',
  'pstoDate',
  'heatTreatmentDiagram',
  'pstoResult',
  'pstoNote',
  'tvmtRequest',
  'tvmtRequestDate',
  'tvmtResult',
  'tvmtConclusionDate',
  'tvmtConclusion',
] as const satisfies readonly (keyof WeldInput)[]

export function buildPstoCycleTimeline(
  row: WeldInput,
  repeatCycles: readonly PstoRepeatCycleRecord[] = [],
): PstoCycleSnapshot[] {
  const normalizedRepeats = repeatCycles
    .filter((cycle) => Number.isInteger(cycle.sequence) && cycle.sequence >= 2)
    .map(buildRepeatCycleSnapshot)
    .sort((left, right) => left.sequence - right.sequence || Number(left.id ?? 0) - Number(right.id ?? 0))

  if (!hasPrimaryPstoCycle(row) && normalizedRepeats.length === 0) return []
  return [buildPrimaryCycleSnapshot(row), ...normalizedRepeats]
}

export function hasPrimaryPstoCycle(row: WeldInput) {
  return (
    isControlEnabledValue(row.pstoRequired) ||
    PRIMARY_PSTO_CYCLE_FIELD_KEYS.some((key) => hasText(row[key]))
  )
}

export function hasAnyPstoCycle(
  row: WeldInput,
  repeatCycles: readonly PstoRepeatCycleRecord[] = getRowRepeatCycles(row),
) {
  return hasPrimaryPstoCycle(row) || repeatCycles.some(
    (cycle) => Number.isInteger(cycle.sequence) && cycle.sequence >= 2,
  )
}

export function hasPstoExecutionHistory(
  row: WeldInput,
  repeatCycles: readonly PstoRepeatCycleRecord[] = getRowRepeatCycles(row),
) {
  return (
    isCompletedPstoResult(row.pstoResult) ||
    hasText(row.pstoDate) ||
    hasText(row.heatTreatmentDiagram) ||
    hasText(row.tvmtRequest) ||
    hasText(row.tvmtRequestDate) ||
    hasFinalTvmtResult(row.tvmtResult) ||
    hasText(row.tvmtConclusionDate) ||
    hasText(row.tvmtConclusion) ||
    repeatCycles.some(hasPstoCycleExecutionHistory)
  )
}

export function hasPstoCycleExecutionHistory(
  cycle: Pick<
    PstoRepeatCycleRecord,
    | 'pstoDate'
    | 'heatTreatmentDiagram'
    | 'pstoResult'
    | 'tvmtRequest'
    | 'tvmtRequestDate'
    | 'tvmtResult'
    | 'tvmtConclusionDate'
    | 'tvmtConclusion'
  >,
) {
  return (
    isCompletedPstoResult(cycle.pstoResult) ||
    hasText(cycle.pstoDate) ||
    hasText(cycle.heatTreatmentDiagram) ||
    hasText(cycle.tvmtRequest) ||
    hasText(cycle.tvmtRequestDate) ||
    hasFinalTvmtResult(cycle.tvmtResult) ||
    hasText(cycle.tvmtConclusionDate) ||
    hasText(cycle.tvmtConclusion)
  )
}

function buildPrimaryCycleSnapshot(row: WeldInput): PstoCycleSnapshot {
  return {
    source: 'primary',
    sequence: 1,
    pstoRequest: normalizeValue(row.pstoRequest),
    pstoRequestDate: normalizeValue(row.pstoRequestDate),
    pstoDate: normalizeValue(row.pstoDate),
    heatTreatmentDiagram: normalizeValue(row.heatTreatmentDiagram),
    pstoResult: normalizeValue(row.pstoResult),
    pstoNote: normalizeValue(row.pstoNote),
    tvmtRequest: normalizeValue(row.tvmtRequest),
    tvmtRequestDate: normalizeValue(row.tvmtRequestDate),
    tvmtResult: normalizeValue(row.tvmtResult),
    tvmtConclusionDate: normalizeValue(row.tvmtConclusionDate),
    tvmtConclusion: normalizeValue(row.tvmtConclusion),
  }
}

function buildRepeatCycleSnapshot(cycle: PstoRepeatCycleRecord): PstoCycleSnapshot {
  return {
    id: cycle.id,
    source: 'repeat',
    sequence: cycle.sequence,
    pstoRequest: normalizeValue(cycle.pstoRequest),
    pstoRequestDate: normalizeValue(cycle.pstoRequestDate),
    pstoDate: normalizeValue(cycle.pstoDate),
    heatTreatmentDiagram: normalizeValue(cycle.heatTreatmentDiagram),
    pstoResult: normalizeValue(cycle.pstoResult),
    pstoNote: normalizeValue(cycle.pstoNote),
    tvmtRequest: normalizeValue(cycle.tvmtRequest),
    tvmtRequestDate: normalizeValue(cycle.tvmtRequestDate),
    tvmtResult: normalizeValue(cycle.tvmtResult),
    tvmtConclusionDate: normalizeValue(cycle.tvmtConclusionDate),
    tvmtConclusion: normalizeValue(cycle.tvmtConclusion),
  }
}

function hasText(value: unknown) {
  return String(value ?? '').trim().length > 0
}

function isCompletedPstoResult(value: unknown) {
  const result = String(value ?? '').trim().toLocaleLowerCase('ru-RU')
  return result === 'проведено' || result === 'проведено (отменен)' || result === 'да'
}

function hasFinalTvmtResult(value: unknown) {
  const result = String(value ?? '').trim().toLocaleLowerCase('ru-RU')
  return result === 'годен' || result === 'да' || result === 'не годен' || result === 'негоден' || result === 'ремонт' || result === 'вырез'
}

function getRowRepeatCycles(row: WeldInput) {
  return ((row as WeldInput & { pstoRepeatCycles?: PstoRepeatCycleRecord[] }).pstoRepeatCycles ?? [])
}

function normalizeValue(value: unknown) {
  return String(value ?? '').trim()
}
