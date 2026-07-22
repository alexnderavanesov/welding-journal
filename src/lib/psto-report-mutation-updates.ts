import { getDateInputValidationReason, normalizeDateLikeForStorage } from '@/lib/date-format'
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
import { assertNoPstoChronologyIssues } from '@/lib/psto-chronology-checks'
import { formatDateBeforeWeldDateSaveReason, isDateBeforeWeldDate } from '@/lib/report-date-rules'
import { formatCustomDocumentName } from '@/lib/report-request-naming'
import { hasText } from '@/lib/report-value-utils'
import { loadSaveCheckSettings } from '@/lib/save-check-settings'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { RowWithId } from '@/lib/psto-report-mutation-types'

export function buildPstoRequestRows({
  records,
  requestName,
  requestDate,
}: {
  records: RowWithId[]
  requestName: string
  requestDate: string
}) {
  const saveCheckSettings = loadSaveCheckSettings()
  const requestDateReason = getDateInputValidationReason(requestDate, 'Дата заявки ПСТО')
  if (requestDateReason) throw new Error(requestDateReason)
  const proposedRecords = buildPstoRequestDraftRows({ records, requestName, requestDate })
  assertNoPstoChronologyIssues(proposedRecords, saveCheckSettings)
  return proposedRecords
}

export function buildPstoRequestDraftRows({
  records,
  requestName,
  requestDate,
}: {
  records: RowWithId[]
  requestName: string
  requestDate: string
}) {
  const normalizedRequestDate = normalizeDateLikeForStorage(requestDate)
  return assignPstoRequest({
    records,
    requestName,
    requestDate: normalizedRequestDate,
    pstoCreatedAt: new Date().toISOString(),
  })
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
  const saveCheckSettings = loadSaveCheckSettings()
  if (result !== 'проведено') throw new Error('Выберите результат ПСТО')
  if (saveCheckSettings.pstoResultDateRequired && !pstoDate) throw new Error('Укажите дату ПСТО')
  if (saveCheckSettings.pstoResultDateFormat) {
    const pstoDateReason = getDateInputValidationReason(pstoDate, 'Дата ПСТО')
    if (pstoDateReason) throw new Error(pstoDateReason)
  }
  if (saveCheckSettings.pstoResultDiagramRequired && !diagramName.trim()) {
    throw new Error('Укажите наименование диаграммы термообработки')
  }
  if (records.some((record) => !hasText(record.pstoRequest))) throw new Error('Сначала укажите заявку ПСТО')
  const normalizedPstoDate = normalizeDateLikeForStorage(pstoDate)

  const pstoUpdatedAt = new Date().toISOString()
  const proposedRowsById = new Map<number, RowWithId>()
  for (const record of records) {
    if (saveCheckSettings.pstoResultDateAfterWeldDate && isDateBeforeWeldDate(normalizedPstoDate ?? pstoDate, record.weldDate)) {
      throw new Error(formatDateBeforeWeldDateSaveReason(record, normalizedPstoDate ?? pstoDate, 'Дата ПСТО'))
    }
    proposedRowsById.set(record.id, applyPstoResult({ record, shouldClearResult: false, pstoDate: normalizedPstoDate ?? pstoDate, diagramName, pstoCreatedAt: pstoUpdatedAt }))
  }
  const recalculatedRows = withAutoHeatTreatmentDiagrams(rows.map((row) => proposedRowsById.get(row.id) ?? row))
  const changedRows = recalculatedRows.filter((row) => proposedRowsById.has(row.id))
  assertNoPstoChronologyIssues(changedRows, saveCheckSettings)
  return changedRows
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
  const fixedDateDiagramName =
    action === 'renameDiagram' ? formatCustomDocumentName(nextDiagramName, record.pstoDate) : nextDiagramName
  return applyPstoResultCorrection({ record, action, diagramName: fixedDateDiagramName }) as RowWithId
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
