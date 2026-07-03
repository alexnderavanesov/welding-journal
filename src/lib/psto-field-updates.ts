import { hasText, isEnabledControlValue } from '@/lib/report-value-utils'
import type { WeldInput } from '@/lib/weld-fields'

type PstoRow = WeldInput

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

export function clearCancelledPstoRequestWithoutResult<T extends PstoRow>(record: T): T {
  if (isEnabledControlValue(record.pstoRequired) || hasPstoResultHistory(record)) return record
  if (!hasText(record.pstoRequest) && !hasText(record.pstoDate)) return record
  return {
    ...record,
    pstoRequest: null,
    pstoDate: null,
    pstoResult: null,
  }
}

export function withPendingPstoResultStatus<T extends PstoRow>(record: T): T {
  if (!isEnabledControlValue(record.pstoRequired)) return record
  if (hasText(record.pstoResult) && !isPendingPstoResult(record.pstoResult)) return record
  return {
    ...record,
    pstoResult: hasText(record.pstoRequest) ? 'ожидает' : 'ожидает заявку',
  }
}

function isPendingPstoResult(value: unknown) {
  const result = String(value ?? '').trim().toLowerCase()
  return result === 'ожидает' || result === 'ожидает заявку'
}

export function restoreActivePstoCancelledResult<T extends PstoRow>(record: T): T {
  if (!isEnabledControlValue(record.pstoRequired)) return record

  const restoredResult = getRestoredActivePstoResult(record.pstoResult)
  if (restoredResult === undefined) return record

  return {
    ...record,
    pstoResult: restoredResult,
  }
}

function getRestoredActivePstoResult(value: unknown) {
  const result = String(value ?? '').trim().toLowerCase()
  if (result === 'проведено (отменен)') return 'проведено'
  if (result === 'отменен') return null
  return undefined
}

function hasPstoResultHistory(record: PstoRow) {
  return isRealPstoResult(record.pstoResult) || ['heatTreatmentDiagram', 'pstoNote', 'pstoBoq', 'pstoKs3'].some((fieldKey) =>
    hasText(record[fieldKey as keyof PstoRow]),
  )
}

function isRealPstoResult(value: unknown) {
  const result = String(value ?? '').trim().toLowerCase()
  return result === 'проведено' || result === 'проведено (отменен)' || result === 'да'
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
