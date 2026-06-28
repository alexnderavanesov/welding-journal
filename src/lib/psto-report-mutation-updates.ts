import { PSTO_EMPTY_RESULT_VALUE } from '@/lib/report-config'
import {
  applyPstoRequestManagerAction,
  applyPstoResult,
  applyPstoResultCorrection,
  assignPstoRequest,
  clearPstoRequestPosition,
  type PstoRequestManagerAction,
  type PstoResultCorrectionAction,
} from '@/lib/psto-field-updates'
import {
  withAutoHeatTreatmentDiagram,
  withAutoHeatTreatmentDiagrams,
} from '@/lib/psto-status'
import { hasText } from '@/lib/report-value-utils'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { RowWithId } from '@/lib/psto-report-mutation-types'

export function buildPstoRequestRows({
  records,
  requestName,
}: {
  records: RowWithId[]
  requestName: string
}) {
  return assignPstoRequest(records, requestName, new Date().toISOString())
}

export function buildPstoResultRows({
  records,
  pstoDate,
  result,
  diagramName,
  rows,
}: {
  records: RowWithId[]
  pstoDate: string
  result: string
  diagramName: string
  rows: RowWithId[]
}) {
  const shouldClearResult = result === PSTO_EMPTY_RESULT_VALUE
  if (!shouldClearResult && result !== 'проведено') throw new Error('Выберите результат ПСТО')
  if (!shouldClearResult && !pstoDate) throw new Error('Укажите дату ПСТО')
  if (!shouldClearResult && !diagramName.trim()) throw new Error('Укажите наименование диаграммы термообработки')
  if (records.some((record) => !hasText(record.pstoRequest))) throw new Error('Сначала укажите заявку ПСТО')

  const pstoUpdatedAt = new Date().toISOString()
  const proposedRowsById = new Map<number, RowWithId>()
  for (const record of records) {
    proposedRowsById.set(record.id, applyPstoResult({ record, shouldClearResult, pstoDate, diagramName, pstoCreatedAt: pstoUpdatedAt }))
  }
  const recalculatedRows = withAutoHeatTreatmentDiagrams(rows.map((row) => proposedRowsById.get(row.id) ?? row))
  return recalculatedRows.filter((row) => proposedRowsById.has(row.id))
}

export function buildPstoRequestManagerRows({
  heatTreatmentRows,
  requestName,
  nextRequestName,
  action,
}: {
  heatTreatmentRows: RowWithId[]
  requestName: string
  nextRequestName: string
  action: PstoRequestManagerAction
}) {
  const pstoUpdatedAt = new Date().toISOString()
  return heatTreatmentRows.flatMap((record) => {
    if (String(record.pstoRequest ?? '').trim() !== requestName) return []
    return [applyPstoRequestManagerAction({ record, nextRequestName, action, pstoCreatedAt: pstoUpdatedAt }) as RowWithId]
  })
}

export function buildPstoRequestCorrectionRow(record: RowWithId) {
  return clearPstoRequestPosition(record) as RowWithId
}

export function buildPstoResultCorrectionRow({
  record,
  action,
  diagramName,
}: {
  record: RowWithId
  action: PstoResultCorrectionAction
  diagramName?: string
}) {
  const nextDiagramName = diagramName?.trim() ?? ''
  if (action === 'renameDiagram' && !nextDiagramName) throw new Error('Укажите наименование диаграммы')
  return applyPstoResultCorrection({ record, action, diagramName: nextDiagramName }) as RowWithId
}

export function buildHeatTreatmentFieldRow({
  record,
  fieldKey,
  value,
  rows,
}: {
  record: RowWithId
  fieldKey: WeldFieldKey
  value: string | null
  rows: RowWithId[]
}) {
  return withAutoHeatTreatmentDiagram({ ...record, [fieldKey]: value }, rows) as RowWithId
}
