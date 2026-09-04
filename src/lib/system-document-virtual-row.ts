import type { WeldRow } from '@/lib/dispatcher-types'
import { ALL_LNK_FIELD_METHODS } from '@/lib/lnk-report-config'
import type { PreHeatTreatmentControlRecord } from '@/lib/lnk-control-stage'
import type { PstoRepeatCycleRecord } from '@/lib/psto-cycle'

export function buildPreHeatTreatmentSystemDocumentRow(
  row: WeldRow,
  controls: readonly PreHeatTreatmentControlRecord[],
): WeldRow {
  let nextRow = clearLnkDocumentFields(row)
  for (const control of controls) {
    const method = ALL_LNK_FIELD_METHODS.find((candidate) => candidate.code === control.method)
    if (!method) continue
    nextRow = {
      ...nextRow,
      [method.requestKey]: normalizeRelationValue(control.requestName),
      [method.requestDateKey]: normalizeRelationValue(control.requestDate),
      [method.resultKey]: normalizeRelationValue(control.result),
      [method.conclusionDateKey]: normalizeRelationValue(control.conclusionDate),
      [method.conclusionKey]: normalizeRelationValue(control.conclusionName),
      ...(method.defectDescriptionKey
        ? {
            [method.defectDescriptionKey]: normalizeRelationValue(control.defectDescription),
            ...(method.preDefectDescriptionKey
              ? { [method.preDefectDescriptionKey]: normalizeRelationValue(control.defectDescription) }
              : {}),
          }
        : {}),
      ...(control.method === 'РК'
        ? {
            rkExposureConfirmedDiameter: control.rkExposureConfirmedDiameter ?? undefined,
          }
        : {}),
    }
  }
  return nextRow
}

export function buildPstoRepeatSystemDocumentRow(
  row: WeldRow,
  cycle: PstoRepeatCycleRecord,
): WeldRow {
  return {
    ...clearLnkDocumentFields(clearPstoDocumentFields(row)),
    pstoRepeatCycles: [cycle],
    pstoRequest: normalizeRelationValue(cycle.pstoRequest),
    pstoRequestDate: normalizeRelationValue(cycle.pstoRequestDate),
    pstoDate: normalizeRelationValue(cycle.pstoDate),
    heatTreatmentDiagram: normalizeRelationValue(cycle.heatTreatmentDiagram),
    pstoResult: normalizeRelationValue(cycle.pstoResult),
    pstoNote: normalizeRelationValue(cycle.pstoNote),
    tvmtRequest: normalizeRelationValue(cycle.tvmtRequest),
    tvmtRequestDate: normalizeRelationValue(cycle.tvmtRequestDate),
    tvmtResult: normalizeRelationValue(cycle.tvmtResult),
    tvmtConclusionDate: normalizeRelationValue(cycle.tvmtConclusionDate),
    tvmtConclusion: normalizeRelationValue(cycle.tvmtConclusion),
  }
}

export function buildPrimaryPstoSystemDocumentRow(row: WeldRow): WeldRow {
  return {
    ...clearLnkDocumentFields(clearPstoDocumentFields(row)),
    pstoRepeatCycles: [],
    pstoRequest: normalizeRelationValue(row.pstoRequest),
    pstoRequestDate: normalizeRelationValue(row.pstoRequestDate),
    pstoDate: normalizeRelationValue(row.pstoDate),
    heatTreatmentDiagram: normalizeRelationValue(row.heatTreatmentDiagram),
    pstoResult: normalizeRelationValue(row.pstoResult),
    pstoNote: normalizeRelationValue(row.pstoNote),
    tvmtRequest: normalizeRelationValue(row.tvmtRequest),
    tvmtRequestDate: normalizeRelationValue(row.tvmtRequestDate),
    tvmtResult: normalizeRelationValue(row.tvmtResult),
    tvmtConclusionDate: normalizeRelationValue(row.tvmtConclusionDate),
    tvmtConclusion: normalizeRelationValue(row.tvmtConclusion),
  }
}

function clearLnkDocumentFields(row: WeldRow): WeldRow {
  const nextRow: WeldRow = { ...row }
  for (const method of ALL_LNK_FIELD_METHODS) {
    nextRow[method.requestKey] = undefined
    nextRow[method.requestDateKey] = undefined
    nextRow[method.resultKey] = undefined
    nextRow[method.conclusionDateKey] = undefined
    nextRow[method.conclusionKey] = undefined
    if (method.defectDescriptionKey) nextRow[method.defectDescriptionKey] = undefined
    if (method.preDefectDescriptionKey) nextRow[method.preDefectDescriptionKey] = undefined
  }
  nextRow.rkExposureConfirmedDiameter = undefined
  return nextRow
}

function clearPstoDocumentFields(row: WeldRow): WeldRow {
  return {
    ...row,
    pstoRequest: undefined,
    pstoRequestDate: undefined,
    pstoDate: undefined,
    heatTreatmentDiagram: undefined,
    pstoResult: undefined,
    pstoNote: undefined,
  }
}

function normalizeRelationValue(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10)
  const normalized = String(value ?? '').trim()
  return normalized || undefined
}
