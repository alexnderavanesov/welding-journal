import { getDateInputValidationReason, parseDateLikeToIso } from '@/lib/date-format'
import type { WeldRow } from '@/lib/dispatcher-types'
import { assertNoNewLnkChronologyIssues } from '@/lib/lnk-chronology-checks'
import {
  getCurrentPstoCycle,
  getNextPstoCycleSequence,
  getPstoTvmtWorkflowState,
  normalizeTvmtResult,
} from '@/lib/tvmt-cycle'
import type { PstoRepeatCycleRecord } from '@/lib/psto-cycle'
import { loadSaveCheckSettings, type SaveCheckSettings } from '@/lib/save-check-settings'
import { formatDateBeforeWeldDateSaveReason, isDateBeforeWeldDate } from '@/lib/report-date-rules'

export type PstoRepeatCycleWrite = Omit<PstoRepeatCycleRecord, 'id'> & { id?: number }

export function buildRepeatPstoRequestCycle({
  row,
  requestName,
  requestDate,
  saveCheckSettings = loadSaveCheckSettings(),
}: {
  row: WeldRow
  requestName: string
  requestDate: string
  saveCheckSettings?: SaveCheckSettings
}): PstoRepeatCycleWrite {
  const name = requestName.trim()
  if (!name) throw new Error('Укажите наименование повторной заявки ПСТО.')
  const date = requireDate(
    requestDate,
    'Укажите дату повторной заявки ПСТО.',
    'Дата повторной заявки ПСТО',
  )
  if (getPstoTvmtWorkflowState(row) !== 'repeat-psto-required') {
    throw new Error(`Стык ${formatJoint(row)}: повторная ПСТО сейчас не требуется.`)
  }
  const currentCycle = getCurrentPstoCycle(row)
  if (saveCheckSettings.pstoResultRequestDateOrder) {
    assertNotBefore(
      date,
      currentCycle?.tvmtConclusionDate,
      `Стык ${formatJoint(row)}: дата повторной заявки ПСТО не может быть раньше даты негодной ТВМТ.`,
    )
  }
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
  saveCheckSettings = loadSaveCheckSettings(),
}: {
  row: WeldRow
  pstoDate: string
  diagramName: string
  saveCheckSettings?: SaveCheckSettings
}): PstoRepeatCycleWrite {
  const cycle = requireCurrentRepeatCycle(row, 'waiting-psto')
  const date = normalizeOptionalPstoResultDate(pstoDate, saveCheckSettings)
  const name = diagramName.trim()
  if (saveCheckSettings.pstoResultDiagramRequired && !name) {
    throw new Error('Укажите наименование диаграммы повторной ПСТО.')
  }
  if (
    date &&
    saveCheckSettings.pstoResultDateAfterWeldDate &&
    isDateBeforeWeldDate(date, row.weldDate)
  ) {
    throw new Error(formatDateBeforeWeldDateSaveReason(row, date, 'Дата повторной ПСТО'))
  }
  if (date && saveCheckSettings.pstoResultRequestDateOrder) {
    assertNotBefore(
      date,
      cycle.pstoRequestDate,
      `Стык ${formatJoint(row)}: дата повторной ПСТО не может быть раньше даты заявки.`,
    )
  }
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
  saveCheckSettings = loadSaveCheckSettings(),
}: {
  row: WeldRow
  requestName: string
  requestDate: string
  saveCheckSettings?: SaveCheckSettings
}): PstoRepeatCycleWrite {
  const cycle = requireCurrentRepeatCycle(row, 'waiting-tvmt-request')
  const name = requestName.trim()
  if (!name) throw new Error('Укажите наименование заявки ТВМТ.')
  const date = requireDate(requestDate, 'Укажите дату заявки ТВМТ.', 'Дата заявки ТВМТ')
  if (saveCheckSettings.pstoResultRequestDateOrder) {
    assertNotBefore(
      date,
      cycle.pstoDate,
      `Стык ${formatJoint(row)}: дата заявки ТВМТ не может быть раньше даты повторной ПСТО.`,
    )
  }
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
  saveCheckSettings = loadSaveCheckSettings(),
}: {
  row: WeldRow
  controlDate: string
  result: string
  conclusionName: string
  saveCheckSettings?: SaveCheckSettings
}): PstoRepeatCycleWrite {
  const cycle = requireCurrentRepeatCycle(row, 'waiting-tvmt')
  const date = requireDate(controlDate, 'Укажите дату ТВМТ.', 'Дата ТВМТ')
  const normalizedResult = normalizeTvmtResult(result)
  if (!normalizedResult) throw new Error('Выберите результат ТВМТ.')
  const name = conclusionName.trim()
  if (!name) throw new Error('Укажите наименование заключения ТВМТ.')
  if (saveCheckSettings.pstoResultRequestDateOrder) {
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
  }
  const nextCycle = {
    ...cycle,
    tvmtResult: normalizedResult === 'good' ? 'годен' : 'не годен',
    tvmtConclusionDate: date,
    tvmtConclusion: name,
  }
  const nextRow = {
    ...row,
    pstoRepeatCycles: (row.pstoRepeatCycles ?? []).map((candidate) => (
      candidate.id === nextCycle.id ? nextCycle : candidate
    )),
  }
  assertNoNewLnkChronologyIssues([nextRow], [row], saveCheckSettings)
  return nextCycle
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

function requireDate(value: string, message: string, label: string) {
  const rawDate = String(value ?? '').trim()
  if (!rawDate) throw new Error(message)
  const date = parseDateLikeToIso(rawDate)
  if (!date) throw new Error('Укажите корректную дату документа.')
  const reason = getDateInputValidationReason(date, label)
  if (reason) throw new Error(reason)
  return date
}

function normalizeOptionalPstoResultDate(value: string, settings: SaveCheckSettings) {
  const rawDate = String(value ?? '').trim()
  if (!rawDate) {
    if (settings.pstoResultDateRequired) throw new Error('Укажите дату повторной ПСТО.')
    return ''
  }
  const parsedDate = parseDateLikeToIso(rawDate)
  if (!parsedDate) {
    throw new Error('Укажите корректную дату повторной ПСТО.')
  }
  const reason = getDateInputValidationReason(parsedDate, 'Дата повторной ПСТО')
  if (reason) throw new Error(reason)
  return parsedDate
}

function assertNotBefore(date: string, minimum: unknown, message: string) {
  const minimumDate = parseDateLikeToIso(minimum)
  if (minimumDate && date < minimumDate) throw new Error(message)
}

function formatJoint(row: WeldRow) {
  return String(row.joint ?? '').trim() || `ID ${row.id}`
}
