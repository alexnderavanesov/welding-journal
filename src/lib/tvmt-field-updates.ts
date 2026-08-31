import { normalizeDateLikeForStorage, parseDateLikeToIso } from '@/lib/date-format'
import type { WeldRow } from '@/lib/dispatcher-types'
import { assertNoNewLnkChronologyIssues } from '@/lib/lnk-chronology-checks'
import { calculateFinalStatus } from '@/lib/weld-status'
import {
  getCurrentPstoCycle,
  getPstoTvmtWorkflowState,
  normalizeTvmtResult,
} from '@/lib/tvmt-cycle'

export function canCreatePrimaryTvmtRequest(row: WeldRow) {
  const cycle = getCurrentPstoCycle(row)
  return Boolean(cycle?.source === 'primary' && getPstoTvmtWorkflowState(row) === 'waiting-tvmt-request')
}

export function canCreateTvmtRequest(row: WeldRow) {
  return getPstoTvmtWorkflowState(row) === 'waiting-tvmt-request'
}

export function canAddPrimaryTvmtResult(row: WeldRow) {
  const cycle = getCurrentPstoCycle(row)
  return Boolean(cycle?.source === 'primary' && getPstoTvmtWorkflowState(row) === 'waiting-tvmt')
}

export function canAddTvmtResult(row: WeldRow) {
  return getPstoTvmtWorkflowState(row) === 'waiting-tvmt'
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
}: {
  records: WeldRow[]
  requestName: string
  requestDate: string
}) {
  const name = requestName.trim()
  if (!name) throw new Error('Укажите наименование заявки ТВМТ.')
  const date = normalizeDateLikeForStorage(requestDate)
  if (!date) throw new Error('Укажите дату заявки ТВМТ.')

  return records.map((record) => {
    if (!canCreatePrimaryTvmtRequest(record)) {
      throw new Error(`Стык ${formatJoint(record)}: заявка ТВМТ сейчас недоступна.`)
    }
    assertDateNotBeforePsto(record, date, 'Дата заявки ТВМТ')
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
}: {
  records: WeldRow[]
  controlDate: string
  result: string
  conclusionName: string
}) {
  const normalizedResult = normalizeTvmtResult(result)
  if (!normalizedResult) throw new Error('Выберите результат ТВМТ.')
  const date = normalizeDateLikeForStorage(controlDate)
  if (!date) throw new Error('Укажите дату ТВМТ.')
  const name = conclusionName.trim()
  if (!name) throw new Error('Укажите наименование заключения ТВМТ.')

  const proposedRows = records.map((record) => {
    if (!canAddPrimaryTvmtResult(record)) {
      throw new Error(`Стык ${formatJoint(record)}: результат ТВМТ сейчас недоступен.`)
    }
    assertDateNotBeforePsto(record, date, 'Дата ТВМТ')
    const requestDate = parseDateLikeToIso(record.tvmtRequestDate)
    if (requestDate && date < requestDate) {
      throw new Error(
        `Стык ${formatJoint(record)}: дата ТВМТ не может быть раньше даты заявки ТВМТ.`,
      )
    }
    return withPstoStatus({
      ...record,
      tvmtResult: normalizedResult === 'good' ? 'годен' : 'не годен',
      tvmtConclusionDate: date,
      tvmtConclusion: name,
    })
  })
  assertNoNewLnkChronologyIssues(proposedRows, records)
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
