import type { WeldInput } from '@/lib/weld-fields'

type PstoRow = WeldInput & { id: number }

export type PstoRequestManagerAction = 'rename' | 'delete'
export type PstoResultCorrectionAction = 'renameDiagram' | 'deleteResult'

export function assignPstoRequest<T extends PstoRow>(records: T[], requestName: string, pstoCreatedAt = new Date().toISOString()) {
  return records.map((record) => ({ ...record, pstoRequest: requestName, pstoCreatedAt }))
}

export function applyPstoResult<T extends PstoRow>({
  record,
  shouldClearResult,
  pstoDate,
  diagramName,
  pstoCreatedAt = new Date().toISOString(),
}: {
  record: T
  shouldClearResult: boolean
  pstoDate: string
  diagramName: string
  pstoCreatedAt?: string
}) {
  return {
    ...record,
    pstoDate: shouldClearResult ? null : pstoDate,
    pstoResult: shouldClearResult ? null : 'проведено',
    heatTreatmentDiagram: shouldClearResult ? null : diagramName.trim(),
    pstoCreatedAt,
  }
}

export function applyPstoRequestManagerAction<T extends PstoRow>({
  record,
  nextRequestName,
  action,
  pstoCreatedAt = new Date().toISOString(),
}: {
  record: T
  nextRequestName: string
  action: PstoRequestManagerAction
  pstoCreatedAt?: string
}) {
  return {
    ...record,
    pstoRequest: action === 'rename' ? nextRequestName : null,
    pstoDate: action === 'rename' ? record.pstoDate : null,
    pstoResult: action === 'rename' ? record.pstoResult : null,
    heatTreatmentDiagram: action === 'rename' ? record.heatTreatmentDiagram : null,
    pstoCreatedAt,
  }
}

export function clearPstoRequestPosition<T extends PstoRow>(record: T, pstoCreatedAt = new Date().toISOString()) {
  return {
    ...record,
    pstoRequest: null,
    pstoDate: null,
    pstoResult: null,
    heatTreatmentDiagram: null,
    pstoCreatedAt,
  }
}

export function applyPstoResultCorrection<T extends PstoRow>({
  record,
  action,
  diagramName,
  pstoCreatedAt = new Date().toISOString(),
}: {
  record: T
  action: PstoResultCorrectionAction
  diagramName?: string
  pstoCreatedAt?: string
}) {
  const nextDiagramName = diagramName?.trim() ?? ''
  return {
    ...record,
    pstoDate: action === 'deleteResult' ? null : record.pstoDate,
    pstoResult: action === 'deleteResult' ? null : record.pstoResult,
    heatTreatmentDiagram: action === 'deleteResult' ? null : nextDiagramName,
    pstoCreatedAt,
  }
}
