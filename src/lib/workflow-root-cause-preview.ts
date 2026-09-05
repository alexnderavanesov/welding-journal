import type { WeldRow } from '@/lib/dispatcher-types'
import type { PreHeatTreatmentControlRecord } from '@/lib/lnk-control-stage'
import type { PstoRepeatCycleRecord } from '@/lib/psto-cycle'
import type { SaveCheckSettings } from '@/lib/save-check-settings'
import { getNewChronologyRootCauseState } from '@/lib/workflow-root-cause-actions'

export type WorkflowDraftUpdate =
  | {
      kind: 'pre-lnk-request'
      rowId: number
      methodCode: string
      documentName: string
      date: string
    }
  | {
      kind: 'pre-lnk-result'
      rowId: number
      methodCode: string
      documentName: string
      date: string
      result: string
    }
  | {
      kind: 'psto-stage'
      rowId: number
      sequence: number
      stage: 'pstoRequest' | 'pstoResult' | 'tvmtRequest' | 'tvmtResult'
      documentName: string
      date: string
      result?: string
    }

export function getWorkflowDraftRootCauseState({
  rows,
  updates,
  settings,
}: {
  rows: readonly WeldRow[]
  updates: readonly WorkflowDraftUpdate[]
  settings: SaveCheckSettings
}) {
  if (rows.length === 0 || updates.length === 0) return { message: null, actions: [] }
  const proposedRows = rows.map(cloneRow)
  const rowsById = new Map(proposedRows.map((row) => [row.id, row]))
  for (const update of updates) {
    const row = rowsById.get(update.rowId)
    if (!row) continue
    if (update.kind === 'pre-lnk-request' || update.kind === 'pre-lnk-result') {
      applyPreHeatTreatmentUpdate(row, update)
    } else {
      applyPstoStageUpdate(row, update)
    }
  }
  return getNewChronologyRootCauseState({
    previousRows: rows,
    proposedRows,
    settings,
  })
}

function applyPreHeatTreatmentUpdate(
  row: WeldRow,
  update: Extract<WorkflowDraftUpdate, { kind: 'pre-lnk-request' | 'pre-lnk-result' }>,
) {
  const controls = row.preHeatTreatmentControls ?? (row.preHeatTreatmentControls = [])
  let control = controls.find((candidate) => candidate.method === update.methodCode)
  if (!control) {
    control = {
      id: syntheticRelationId(row.id, update.methodCode),
      weldJointId: row.id,
      method: update.methodCode,
    }
    controls.push(control)
  }
  if (update.kind === 'pre-lnk-request') {
    control.requestName = update.documentName
    control.requestDate = update.date
    control.result = 'ожидает НК'
    return
  }
  control.result = update.result
  control.conclusionName = update.documentName
  control.conclusionDate = update.date
}

function applyPstoStageUpdate(
  row: WeldRow,
  update: Extract<WorkflowDraftUpdate, { kind: 'psto-stage' }>,
) {
  if (update.sequence <= 1) {
    applyPstoFields(row, update)
    return
  }
  const cycles = row.pstoRepeatCycles ?? (row.pstoRepeatCycles = [])
  let cycle = cycles.find((candidate) => candidate.sequence === update.sequence)
  if (!cycle) {
    cycle = {
      id: syntheticRelationId(row.id, `psto-${update.sequence}`),
      weldJointId: row.id,
      sequence: update.sequence,
    }
    cycles.push(cycle)
  }
  applyPstoFields(cycle, update)
}

function applyPstoFields(
  target: WeldRow | PstoRepeatCycleRecord,
  update: Extract<WorkflowDraftUpdate, { kind: 'psto-stage' }>,
) {
  if (update.stage === 'pstoRequest') {
    target.pstoRequest = update.documentName
    target.pstoRequestDate = update.date
    return
  }
  if (update.stage === 'pstoResult') {
    target.heatTreatmentDiagram = update.documentName
    target.pstoDate = update.date
    target.pstoResult = 'проведено'
    return
  }
  if (update.stage === 'tvmtRequest') {
    target.tvmtRequest = update.documentName
    target.tvmtRequestDate = update.date
    target.tvmtResult = 'ожидает НК'
    return
  }
  target.tvmtConclusion = update.documentName
  target.tvmtConclusionDate = update.date
  target.tvmtResult = update.result
}

function cloneRow(row: WeldRow): WeldRow {
  return {
    ...row,
    preHeatTreatmentControls: row.preHeatTreatmentControls?.map(clonePreControl),
    pstoRepeatCycles: row.pstoRepeatCycles?.map(clonePstoCycle),
  }
}

function clonePreControl(control: PreHeatTreatmentControlRecord) {
  return { ...control }
}

function clonePstoCycle(cycle: PstoRepeatCycleRecord) {
  return { ...cycle }
}

function syntheticRelationId(rowId: number, discriminator: string) {
  let hash = Math.abs(rowId) || 1
  for (const character of discriminator) hash = (hash * 31 + character.charCodeAt(0)) % 1_000_000
  return -(hash || 1)
}
