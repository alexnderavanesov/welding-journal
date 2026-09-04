import { getDateInputValidationReason, parseDateLikeToIso } from '@/lib/date-format'
import type { WeldRow } from '@/lib/dispatcher-types'
import { assertNoNewLnkChronologyIssues } from '@/lib/lnk-chronology-checks'
import { getRejectedPreHeatTreatmentControls } from '@/lib/lnk-control-stage'
import { isCancelledControlValue } from '@/lib/report-value-utils'
import { calculateFinalStatus } from '@/lib/weld-status'
import { loadSaveCheckSettings, type SaveCheckSettings } from '@/lib/save-check-settings'
import {
  getCurrentPstoCycle,
  getPstoTvmtWorkflowLabel,
  getPstoTvmtWorkflowState,
  normalizeTvmtResult,
} from '@/lib/tvmt-cycle'

export function canCreatePrimaryTvmtRequest(row: WeldRow) {
  if (getRejectedPreHeatTreatmentControls(row).length > 0) return false
  const cycle = getCurrentPstoCycle(row)
  return Boolean(cycle?.source === 'primary' && getPstoTvmtWorkflowState(row) === 'waiting-tvmt-request')
}

export function canCreateTvmtRequest(row: WeldRow) {
  return getRejectedPreHeatTreatmentControls(row).length === 0 &&
    getPstoTvmtWorkflowState(row) === 'waiting-tvmt-request'
}

export function canAddPrimaryTvmtResult(row: WeldRow) {
  if (getRejectedPreHeatTreatmentControls(row).length > 0) return false
  const cycle = getCurrentPstoCycle(row)
  return Boolean(cycle?.source === 'primary' && getPstoTvmtWorkflowState(row) === 'waiting-tvmt')
}

export function canAddTvmtResult(row: WeldRow) {
  return getRejectedPreHeatTreatmentControls(row).length === 0 &&
    getPstoTvmtWorkflowState(row) === 'waiting-tvmt'
}

export function getTvmtWorkflowBlockReason(row: WeldRow, mode: 'request' | 'result') {
  const available = mode === 'request' ? canCreateTvmtRequest(row) : canAddTvmtResult(row)
  if (available) return ''
  const rejectedPreControls = getRejectedPreHeatTreatmentControls(row)
  if (rejectedPreControls.length > 0) {
    return `Недоступно: НК до ТО не годен (${rejectedPreControls.map(({ methodCode }) => methodCode).join(', ')}); ТВМТ для этого стыка не требуется.`
  }
  const state = getPstoTvmtWorkflowState(row)
  if (state === 'not-required') {
    return isCancelledControlValue(row.pstoRequired)
      ? 'Недоступно: ПСТО по линии отменена.'
      : 'Недоступно: на линии не назначена ПСТО.'
  }
  if (state === 'complete') {
    const tvmtResult = normalizeTvmtResult(getCurrentPstoCycle(row)?.tvmtResult)
    if (tvmtResult === 'failed' && isCancelledControlValue(row.pstoRequired)) {
      return 'Недоступно: линия ПСТО отменена; негодная ТВМТ завершила текущий цикл, новый повтор не создается.'
    }
    if (tvmtResult === 'good') return 'Недоступно: текущий цикл уже завершен годной ТВМТ.'
    return 'Недоступно: текущий физический цикл уже завершен.'
  }
  if (state === 'repeat-psto-required') return 'Недоступно: сначала создайте и проведите повторную ПСТО.'
  return `Недоступно: текущий этап — ${getPstoTvmtWorkflowLabel(state).toLocaleLowerCase('ru')}.`
}

export function getCurrentTvmtDocumentFields(row: WeldRow) {
  const cycle = getCurrentPstoCycle(row)
  return {
    source: cycle?.source ?? 'primary',
    sequence: cycle?.sequence ?? 1,
    requestName: cycle?.tvmtRequest ?? '',
    requestDate: cycle?.tvmtRequestDate ?? '',
    conclusionName: cycle?.tvmtConclusion ?? '',
    conclusionDate: cycle?.tvmtConclusionDate ?? '',
  } as const
}

export function buildPrimaryTvmtRequestRows({
  records,
  requestName,
  requestDate,
  saveCheckSettings = loadSaveCheckSettings(),
}: {
  records: WeldRow[]
  requestName: string
  requestDate: string
  saveCheckSettings?: SaveCheckSettings
}) {
  const name = requestName.trim()
  if (!name) throw new Error('Укажите наименование заявки ТВМТ.')
  const date = requireDate(requestDate, 'Укажите дату заявки ТВМТ.', 'Дата заявки ТВМТ')

  return records.map((record) => {
    if (!canCreatePrimaryTvmtRequest(record)) {
      throw new Error(`Стык ${formatJoint(record)}: заявка ТВМТ сейчас недоступна.`)
    }
    if (saveCheckSettings.pstoResultRequestDateOrder) {
      assertDateNotBeforePsto(record, date, 'Дата заявки ТВМТ')
    }
    return withPstoStatus({
      ...record,
      tvmtRequest: name,
      tvmtRequestDate: date,
      tvmtResult: 'ожидает НК',
    })
  })
}

export function buildPrimaryTvmtResultRows({
  records,
  controlDate,
  result,
  conclusionName,
  saveCheckSettings = loadSaveCheckSettings(),
}: {
  records: WeldRow[]
  controlDate: string
  result: string
  conclusionName: string
  saveCheckSettings?: SaveCheckSettings
}) {
  const normalizedResult = normalizeTvmtResult(result)
  if (!normalizedResult) throw new Error('Выберите результат ТВМТ.')
  const date = requireDate(controlDate, 'Укажите дату ТВМТ.', 'Дата ТВМТ')
  const name = conclusionName.trim()
  if (!name) throw new Error('Укажите наименование заключения ТВМТ.')

  const proposedRows = records.map((record) => {
    if (!canAddPrimaryTvmtResult(record)) {
      throw new Error(`Стык ${formatJoint(record)}: результат ТВМТ сейчас недоступен.`)
    }
    if (saveCheckSettings.pstoResultRequestDateOrder) {
      assertDateNotBeforePsto(record, date, 'Дата ТВМТ')
      const requestDate = parseDateLikeToIso(record.tvmtRequestDate)
      if (requestDate && date < requestDate) {
        throw new Error(
          `Стык ${formatJoint(record)}: дата ТВМТ не может быть раньше даты заявки ТВМТ.`,
        )
      }
    }
    return withPstoStatus({
      ...record,
      tvmtResult: normalizedResult === 'good' ? 'годен' : 'не годен',
      tvmtConclusionDate: date,
      tvmtConclusion: name,
    })
  })
  assertNoNewLnkChronologyIssues(proposedRows, records, saveCheckSettings)
  return proposedRows
}

function assertDateNotBeforePsto(record: WeldRow, date: string, label: string) {
  const pstoDate = parseDateLikeToIso(record.pstoDate)
  if (pstoDate && date < pstoDate) {
    throw new Error(`Стык ${formatJoint(record)}: ${label.toLowerCase()} не может быть раньше даты ПСТО.`)
  }
}

function withPstoStatus<T extends WeldRow>(record: T): T {
  const now = new Date().toISOString()
  const nextRecord = {
    ...record,
    pstoCreatedAt: record.pstoCreatedAt ?? now,
    pstoUpdatedAt: now,
  }
  return { ...nextRecord, finalStatus: calculateFinalStatus(nextRecord) }
}

function formatJoint(row: WeldRow) {
  return String(row.joint ?? '').trim() || `ID ${row.id}`
}

function requireDate(value: string, message: string, label: string) {
  const rawDate = String(value ?? '').trim()
  if (!rawDate) throw new Error(message)
  const date = parseDateLikeToIso(rawDate)
  if (!date) throw new Error('Укажите корректную дату документа.')
  const reason = getDateInputValidationReason(date, label)
  if (reason) throw new Error(reason)
  return date
}
