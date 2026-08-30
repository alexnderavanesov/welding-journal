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
} from '@/lib/psto-status'
import { assertNoNewLnkChronologyIssues } from '@/lib/lnk-chronology-checks'
import { assertNoPstoChronologyIssues } from '@/lib/psto-chronology-checks'
import { formatDateBeforeWeldDateSaveReason, isDateBeforeWeldDate } from '@/lib/report-date-rules'
import { formatCustomDocumentName } from '@/lib/report-request-naming'
import { hasText } from '@/lib/report-value-utils'
import { loadSaveCheckSettings } from '@/lib/save-check-settings'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { RowWithId } from '@/lib/psto-report-mutation-types'
import { isSameRequestDocument } from '@/lib/request-document-identity'
import { getPrimaryPstoStartBlockReason } from '@/lib/lnk-control-stage'
import { getPstoCycleStageDeleteBlockReason } from '@/lib/psto-cycle-corrections'

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
  assertPrimaryPstoReady(records)
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
    pstoUpdatedAt: new Date().toISOString(),
  })
}

export function buildPstoResultRows({
  records,
  pstoDate,
  result,
  diagramName,
  rows: _rows,
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
  assertPrimaryPstoReady(records)
  const normalizedPstoDate = normalizeDateLikeForStorage(pstoDate)

  const pstoUpdatedAt = new Date().toISOString()
  const proposedRows = records.map((record) => {
    if (saveCheckSettings.pstoResultDateAfterWeldDate && isDateBeforeWeldDate(normalizedPstoDate ?? pstoDate, record.weldDate)) {
      throw new Error(formatDateBeforeWeldDateSaveReason(record, normalizedPstoDate ?? pstoDate, 'Дата ПСТО'))
    }
    return applyPstoResult({
      record,
      shouldClearResult: false,
      pstoDate: normalizedPstoDate ?? pstoDate,
      diagramName,
      pstoUpdatedAt,
    })
  })
  assertNoPstoChronologyIssues(proposedRows, saveCheckSettings)
  assertNoNewLnkChronologyIssues(proposedRows, records, saveCheckSettings)
  return proposedRows
}

function assertPrimaryPstoReady(records: RowWithId[]) {
  const blocked = records.find((record) => getPrimaryPstoStartBlockReason(record))
  if (!blocked) return
  const joint = String(blocked.joint ?? '').trim() || `ID ${blocked.id}`
  throw new Error(`Стык ${joint}: ${getPrimaryPstoStartBlockReason(blocked)}`)
}

export function buildPstoRequestManagerRows({
  heatTreatmentRows,
  requestName,
  requestDate,
  nextRequestName,
  action,
}: {
  heatTreatmentRows: RowWithId[]
  requestName: string
  requestDate: string
  nextRequestName: string
  action: PstoRequestManagerAction
}) {
  const pstoUpdatedAt = new Date().toISOString()
  return heatTreatmentRows.flatMap((record) => {
    if (
      !isSameRequestDocument(record.pstoRequest, record.pstoRequestDate, {
        name: requestName,
        date: requestDate,
      })
    ) {
      return []
    }
    if (action === 'delete') assertPstoRequestCanBeRemoved(record)
    return [applyPstoRequestManagerAction({ record, nextRequestName, action, pstoUpdatedAt }) as RowWithId]
  })
}

export function buildPstoRequestCorrectionRow(record: RowWithId) {
  assertPstoRequestCanBeRemoved(record)
  return clearPstoRequestPosition(record) as RowWithId
}

function assertPstoRequestCanBeRemoved(record: RowWithId) {
  const blockReason = getPstoCycleStageDeleteBlockReason(record, 1, 'pstoRequest')
  if (!blockReason) return
  const joint = String(record.joint ?? '').trim() || `ID ${record.id}`
  throw new Error(`Стык ${joint}: ${blockReason}`)
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
  const customDiagramName =
    action === 'renameDiagram' ? formatCustomDocumentName(nextDiagramName) : nextDiagramName
  return applyPstoResultCorrection({ record, action, diagramName: customDiagramName }) as RowWithId
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
  const pstoUpdatedAt = new Date().toISOString()
  return withAutoHeatTreatmentDiagram({
    ...record,
    [fieldKey]: value,
    pstoCreatedAt: record.pstoCreatedAt ?? pstoUpdatedAt,
    pstoUpdatedAt,
  }, rows) as RowWithId
}
