import { normalizeDateLikeForStorage, parseDateLikeToIso } from '@/lib/date-format'
import type { WeldRow } from '@/lib/dispatcher-types'
import {
  getCurrentPstoCycle,
  getNextPstoCycleSequence,
  getPstoTvmtWorkflowState,
  normalizeTvmtResult,
} from '@/lib/tvmt-cycle'
import type { PstoRepeatCycleRecord } from '@/lib/psto-cycle'

export type PstoRepeatCycleWrite = Omit<PstoRepeatCycleRecord, 'id'> & { id?: number }

export function buildRepeatPstoRequestCycle({
  row,
  requestName,
  requestDate,
}: {
  row: WeldRow
  requestName: string
  requestDate: string
}): PstoRepeatCycleWrite {
  const name = requestName.trim()
  if (!name) throw new Error('Укажите наименование повторной заявки ПСТО.')
  const date = requireDate(requestDate, 'Укажите дату повторной заявки ПСТО.')
  if (getPstoTvmtWorkflowState(row) !== 'repeat-psto-required') {
    throw new Error(`Стык ${formatJoint(row)}: повторная ПСТО сейчас не требуется.`)
  }
  const currentCycle = getCurrentPstoCycle(row)
  assertNotBefore(
    date,
    currentCycle?.tvmtConclusionDate,
    `Стык ${formatJoint(row)}: дата повторной заявки ПСТО не может быть раньше даты негодной ТВМТ.`,
  )
  return {
    weldJointId: row.id,
    sequence: getNextPstoCycleSequence(row),
    pstoRequest: name,
    pstoRequestDate: date,
  }
}

export function buildRepeatPstoResultCycle({
  row,
  pstoDate,
  diagramName,
}: {
  row: WeldRow
  pstoDate: string
  diagramName: string
}): PstoRepeatCycleWrite {
  const cycle = requireCurrentRepeatCycle(row, 'waiting-psto')
  const date = requireDate(pstoDate, 'Укажите дату повторной ПСТО.')
  const name = diagramName.trim()
  if (!name) throw new Error('Укажите наименование диаграммы повторной ПСТО.')
  assertNotBefore(
    date,
    cycle.pstoRequestDate,
    `Стык ${formatJoint(row)}: дата повторной ПСТО не может быть раньше даты заявки.`,
  )
  return {
    ...cycle,
    pstoDate: date,
    heatTreatmentDiagram: name,
    pstoResult: 'проведено',
  }
}

export function buildRepeatTvmtRequestCycle({
  row,
  requestName,
  requestDate,
}: {
  row: WeldRow
  requestName: string
  requestDate: string
}): PstoRepeatCycleWrite {
  const cycle = requireCurrentRepeatCycle(row, 'waiting-tvmt-request')
  const name = requestName.trim()
  if (!name) throw new Error('Укажите наименование заявки ТВМТ.')
  const date = requireDate(requestDate, 'Укажите дату заявки ТВМТ.')
  assertNotBefore(
    date,
    cycle.pstoDate,
    `Стык ${formatJoint(row)}: дата заявки ТВМТ не может быть раньше даты повторной ПСТО.`,
  )
  return {
    ...cycle,
    tvmtRequest: name,
    tvmtRequestDate: date,
    tvmtResult: 'ожидает НК',
  }
}

export function buildRepeatTvmtResultCycle({
  row,
  controlDate,
  result,
  conclusionName,
}: {
  row: WeldRow
  controlDate: string
  result: string
  conclusionName: string
}): PstoRepeatCycleWrite {
  const cycle = requireCurrentRepeatCycle(row, 'waiting-tvmt')
  const date = requireDate(controlDate, 'Укажите дату ТВМТ.')
  const normalizedResult = normalizeTvmtResult(result)
  if (!normalizedResult) throw new Error('Выберите результат ТВМТ.')
  const name = conclusionName.trim()
  if (!name) throw new Error('Укажите наименование заключения ТВМТ.')
  assertNotBefore(
    date,
    cycle.pstoDate,
    `Стык ${formatJoint(row)}: дата ТВМТ не может быть раньше даты повторной ПСТО.`,
  )
  assertNotBefore(
    date,
    cycle.tvmtRequestDate,
    `Стык ${formatJoint(row)}: дата ТВМТ не может быть раньше даты заявки ТВМТ.`,
  )
  return {
    ...cycle,
    tvmtResult: normalizedResult === 'good' ? 'годен' : 'не годен',
    tvmtConclusionDate: date,
    tvmtConclusion: name,
  }
}

function requireCurrentRepeatCycle(
  row: WeldRow,
  expectedState: 'waiting-psto' | 'waiting-tvmt-request' | 'waiting-tvmt',
) {
  const cycle = getCurrentPstoCycle(row)
  if (cycle?.source !== 'repeat' || !cycle.id || getPstoTvmtWorkflowState(row) !== expectedState) {
    throw new Error(`Стык ${formatJoint(row)}: действие не соответствует текущему циклу ПСТО/ТВМТ.`)
  }
  return {
    ...cycle,
    id: cycle.id,
    weldJointId: row.id,
  } satisfies PstoRepeatCycleWrite & { id: number }
}

function requireDate(value: string, message: string) {
  const date = normalizeDateLikeForStorage(value)
  if (!date) throw new Error(message)
  return date
}

function assertNotBefore(date: string, minimum: unknown, message: string) {
  const minimumDate = parseDateLikeToIso(minimum)
  if (minimumDate && date < minimumDate) throw new Error(message)
}

function formatJoint(row: WeldRow) {
  return String(row.joint ?? '').trim() || `ID ${row.id}`
}
