import { normalizeDateLikeForStorage, parseDateLikeToIso } from '@/lib/date-format'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getLnkChronologyIssues, type LnkChronologyIssue } from '@/lib/lnk-chronology-checks'
import {
  buildPstoCycleTimeline,
  type PstoCycleSnapshot,
  type PstoRepeatCycleRecord,
} from '@/lib/psto-cycle'
import { isCompletedPstoResult, normalizeTvmtResult } from '@/lib/tvmt-cycle'
import { calculateFinalStatus } from '@/lib/weld-status'

export const PSTO_CYCLE_STAGES = [
  'pstoRequest',
  'pstoResult',
  'tvmtRequest',
  'tvmtResult',
] as const

export type PstoCycleStage = (typeof PSTO_CYCLE_STAGES)[number]
export type PstoCycleCorrectionAction = 'update' | 'delete'

export type PstoCycleCorrectionInput = {
  sequence: number
  cycleId?: number
  stage: PstoCycleStage
  action: PstoCycleCorrectionAction
  date?: string
  name?: string
  result?: string
}

export type PstoCycleCorrectionResult = {
  row: WeldRow
  repeatCycle: PstoRepeatCycleRecord | null
  deletedRepeatCycleId: number | null
}

export function applyPstoCycleCorrection(
  row: WeldRow,
  input: PstoCycleCorrectionInput,
): PstoCycleCorrectionResult {
  const repeats = [...(row.pstoRepeatCycles ?? [])]
    .map((cycle) => ({ ...cycle }))
    .sort((left, right) => left.sequence - right.sequence || left.id - right.id)
  const timeline = buildPstoCycleTimeline(row, repeats)
  const index = timeline.findIndex((cycle) => cycle.sequence === input.sequence)
  const current = timeline[index]
  if (!current) throw new Error('Цикл ПСТО/ТВМТ больше не существует. Обновите отчет.')
  if (current.source === 'repeat' && input.cycleId && current.id !== input.cycleId) {
    throw new Error('Повторный цикл уже изменен. Обновите отчет.')
  }
  assertStageExists(current, input.stage)

  const nextCycle = { ...current }
  if (input.action === 'delete') {
    const blockReason = getPstoCycleStageDeleteBlockReason(row, input.sequence, input.stage)
    if (blockReason) throw new Error(blockReason)
    clearStage(nextCycle, input.stage)
  } else {
    updateStage(nextCycle, input)
  }

  const nextTimeline = timeline.map((cycle, cycleIndex) => cycleIndex === index ? nextCycle : cycle)
  validateTimeline(row, nextTimeline)

  if (current.source === 'primary') {
    const nextRow = applyPrimaryCycle(row, nextCycle)
    assertNoPstoCorrectionCrossStageIssues(row, nextRow, input)
    return {
      row: { ...nextRow, finalStatus: calculateFinalStatus(nextRow) },
      repeatCycle: null,
      deletedRepeatCycleId: null,
    }
  }

  const relation = repeats.find((cycle) => cycle.id === current.id)
  if (!relation) throw new Error('Повторный цикл больше не существует. Обновите отчет.')
  const deleteWholeCycle = input.action === 'delete' && input.stage === 'pstoRequest'
  const nextRepeatCycles = deleteWholeCycle
    ? repeats.filter((cycle) => cycle.id !== relation.id)
    : repeats.map((cycle) => cycle.id === relation.id ? applyRepeatCycle(cycle, nextCycle) : cycle)
  const nextRow = { ...row, pstoRepeatCycles: nextRepeatCycles }
  assertNoPstoCorrectionCrossStageIssues(row, nextRow, input)
  return {
    row: { ...nextRow, finalStatus: calculateFinalStatus(nextRow) },
    repeatCycle: deleteWholeCycle ? null : nextRepeatCycles.find((cycle) => cycle.id === relation.id) ?? null,
    deletedRepeatCycleId: deleteWholeCycle ? relation.id : null,
  }
}

const PSTO_CROSS_STAGE_ISSUE_KINDS = new Set<LnkChronologyIssue['kind']>([
  'pre-after-psto',
  'post-before-psto-cycle',
  'post-before-psto',
  'post-before-tvmt',
])

function assertNoPstoCorrectionCrossStageIssues(
  currentRow: WeldRow,
  nextRow: WeldRow,
  input: PstoCycleCorrectionInput,
) {
  assertPrimaryPstoNotAfterCancellation(nextRow, input)

  const newIssue = getNewPstoCrossStageIssue(currentRow, nextRow)
  if (newIssue) throw new Error(newIssue.message)
}

function getNewPstoCrossStageIssue(currentRow: WeldRow, nextRow: WeldRow) {
  const currentSignatures = new Set(
    getPstoCrossStageIssues(currentRow).map(getChronologyIssueSignature),
  )
  return getPstoCrossStageIssues(nextRow)
    .find((issue) => !currentSignatures.has(getChronologyIssueSignature(issue)))
}

function assertPrimaryPstoNotAfterCancellation(
  row: WeldRow,
  input: PstoCycleCorrectionInput,
) {
  if (
    input.action !== 'update' ||
    input.sequence !== 1 ||
    (input.stage !== 'pstoRequest' && input.stage !== 'pstoResult')
  ) return

  const cancellationDate = parseDateLikeToIso(row.pstoCancellationDate)
  const eventDate = parseDateLikeToIso(
    input.stage === 'pstoRequest' ? row.pstoRequestDate : row.pstoDate,
  )
  if (cancellationDate && eventDate && eventDate > cancellationDate) {
    throw new Error(
      `Дата ${input.stage === 'pstoRequest' ? 'заявки ПСТО' : 'результата ПСТО'} не может быть позже даты официальной отмены ПСТО.`,
    )
  }
}

function getPstoCrossStageIssues(row: WeldRow) {
  return getLnkChronologyIssues([row])
    .filter((issue) => PSTO_CROSS_STAGE_ISSUE_KINDS.has(issue.kind))
}

function getChronologyIssueSignature(issue: LnkChronologyIssue) {
  return `${issue.kind}\u0000${issue.methodCode}\u0000${issue.message}`
}

export function getPstoCycleStageDeleteBlockReason(
  row: WeldRow,
  sequence: number,
  stage: PstoCycleStage,
) {
  const timeline = buildPstoCycleTimeline(row, row.pstoRepeatCycles ?? [])
  const cycle = timeline.find((candidate) => candidate.sequence === sequence)
  if (!cycle) return 'Цикл ПСТО/ТВМТ больше не существует.'
  const latest = timeline.at(-1)
  if (latest?.sequence !== sequence) {
    return 'Сначала удалите последующие повторные циклы. Цепочка удаляется только с конца.'
  }
  const laterStage = getPopulatedStages(cycle)
    .filter((candidate) => stageIndex(candidate) > stageIndex(stage))
    .at(-1)
  if (laterStage) {
    return `Сначала удалите последующий этап «${getStageLabel(laterStage)}». Цепочка удаляется только с конца.`
  }
  const nextCycle = { ...cycle }
  clearStage(nextCycle, stage)
  const nextRow = cycle.source === 'primary'
    ? applyPrimaryCycle(row, nextCycle)
    : {
        ...row,
        pstoRepeatCycles: stage === 'pstoRequest'
          ? (row.pstoRepeatCycles ?? []).filter((repeat) => repeat.id !== cycle.id)
          : (row.pstoRepeatCycles ?? []).map((repeat) => (
              repeat.id === cycle.id ? applyRepeatCycle(repeat, nextCycle) : repeat
            )),
      }
  const crossStageIssue = getNewPstoCrossStageIssue(row, nextRow)
  if (crossStageIssue) return crossStageIssue.message
  return ''
}

export function getPstoCycleStageLabel(stage: PstoCycleStage) {
  return getStageLabel(stage)
}

function updateStage(cycle: PstoCycleSnapshot, input: PstoCycleCorrectionInput) {
  const date = requireDate(input.date)
  const name = String(input.name ?? '').trim()
  if (!name) throw new Error(`Укажите наименование: ${getStageLabel(input.stage).toLocaleLowerCase('ru-RU')}.`)

  if (input.stage === 'pstoRequest') {
    cycle.pstoRequest = name
    cycle.pstoRequestDate = date
    return
  }
  if (input.stage === 'pstoResult') {
    cycle.pstoDate = date
    cycle.heatTreatmentDiagram = name
    return
  }
  if (input.stage === 'tvmtRequest') {
    cycle.tvmtRequest = name
    cycle.tvmtRequestDate = date
    return
  }
  const normalizedResult = normalizeTvmtResult(input.result)
  if (!normalizedResult) throw new Error('Выберите результат ТВМТ.')
  cycle.tvmtConclusionDate = date
  cycle.tvmtConclusion = name
  cycle.tvmtResult = normalizedResult === 'good' ? 'годен' : 'не годен'
}

function clearStage(cycle: PstoCycleSnapshot, stage: PstoCycleStage) {
  if (stage === 'tvmtResult') {
    cycle.tvmtResult = cycle.tvmtRequest ? 'ожидает НК' : ''
    cycle.tvmtConclusionDate = ''
    cycle.tvmtConclusion = ''
    return
  }
  if (stage === 'tvmtRequest') {
    cycle.tvmtRequest = ''
    cycle.tvmtRequestDate = ''
    cycle.tvmtResult = ''
    cycle.tvmtConclusionDate = ''
    cycle.tvmtConclusion = ''
    return
  }
  if (stage === 'pstoResult') {
    cycle.pstoDate = ''
    cycle.heatTreatmentDiagram = ''
    cycle.pstoResult = ''
    cycle.pstoNote = ''
    return
  }
  cycle.pstoRequest = ''
  cycle.pstoRequestDate = ''
}

function validateTimeline(row: WeldRow, timeline: PstoCycleSnapshot[]) {
  const weldDate = parseDateLikeToIso(row.weldDate)
  for (const [index, cycle] of timeline.entries()) {
    const label = cycle.sequence === 1 ? 'основного цикла' : `цикла #${cycle.sequence}`
    const requestDate = parseDateLikeToIso(cycle.pstoRequestDate)
    const pstoDate = parseDateLikeToIso(cycle.pstoDate)
    const tvmtRequestDate = parseDateLikeToIso(cycle.tvmtRequestDate)
    const tvmtDate = parseDateLikeToIso(cycle.tvmtConclusionDate)
    const tvmtResult = normalizeTvmtResult(cycle.tvmtResult)
    const hasPstoResult = isCompletedPstoResult(cycle.pstoResult)

    if (cycle.pstoRequest || requestDate) {
      if (!cycle.pstoRequest || !requestDate) throw new Error(`У заявки ПСТО ${label} должны быть имя и дата.`)
      if (weldDate && requestDate < weldDate) {
        throw new Error(`Дата заявки ПСТО ${label} не может быть раньше даты сварки.`)
      }
    }
    if (hasPstoResult || pstoDate || cycle.heatTreatmentDiagram) {
      if (!cycle.pstoRequest || !requestDate) throw new Error(`Сначала восстановите заявку ПСТО ${label}.`)
      if (!hasPstoResult || !pstoDate || !cycle.heatTreatmentDiagram) {
        throw new Error(`У результата ПСТО ${label} должны быть дата и диаграмма.`)
      }
      if (pstoDate < requestDate) throw new Error(`Дата результата ПСТО ${label} не может быть раньше даты заявки.`)
    }
    if (cycle.tvmtRequest || tvmtRequestDate) {
      if (!hasPstoResult || !pstoDate) throw new Error(`Сначала восстановите результат ПСТО ${label}.`)
      if (!cycle.tvmtRequest || !tvmtRequestDate) throw new Error(`У заявки ТВМТ ${label} должны быть имя и дата.`)
      if (tvmtRequestDate < pstoDate) throw new Error(`Дата заявки ТВМТ ${label} не может быть раньше ПСТО.`)
    }
    if (tvmtResult || tvmtDate || cycle.tvmtConclusion) {
      if (!cycle.tvmtRequest || !tvmtRequestDate) throw new Error(`Сначала восстановите заявку ТВМТ ${label}.`)
      if (!tvmtResult || !tvmtDate || !cycle.tvmtConclusion) {
        throw new Error(`У результата ТВМТ ${label} должны быть результат, дата и заключение.`)
      }
      if (pstoDate && tvmtDate < pstoDate) throw new Error(`Дата результата ТВМТ ${label} не может быть раньше ПСТО.`)
      if (tvmtDate < tvmtRequestDate) throw new Error(`Дата результата ТВМТ ${label} не может быть раньше даты заявки.`)
    }

    const previous = timeline[index - 1]
    if (previous) {
      if (normalizeTvmtResult(previous.tvmtResult) !== 'failed') {
        throw new Error(`Цикл #${cycle.sequence} допустим только после негодной ТВМТ предыдущего цикла.`)
      }
      const previousTvmtDate = parseDateLikeToIso(previous.tvmtConclusionDate)
      if (previousTvmtDate && requestDate && requestDate < previousTvmtDate) {
        throw new Error(`Дата заявки ПСТО цикла #${cycle.sequence} не может быть раньше предыдущей ТВМТ.`)
      }
    }
  }
}

function assertStageExists(cycle: PstoCycleSnapshot, stage: PstoCycleStage) {
  const exists = getPopulatedStages(cycle).includes(stage)
  if (!exists) throw new Error(`Этап «${getStageLabel(stage)}» еще не создан.`)
}

function getPopulatedStages(cycle: PstoCycleSnapshot): PstoCycleStage[] {
  const stages: PstoCycleStage[] = []
  if (cycle.pstoRequest || cycle.pstoRequestDate) stages.push('pstoRequest')
  if (isCompletedPstoResult(cycle.pstoResult) || cycle.pstoDate || cycle.heatTreatmentDiagram) stages.push('pstoResult')
  if (cycle.tvmtRequest || cycle.tvmtRequestDate) stages.push('tvmtRequest')
  if (normalizeTvmtResult(cycle.tvmtResult) || cycle.tvmtConclusionDate || cycle.tvmtConclusion) stages.push('tvmtResult')
  return stages
}

function applyPrimaryCycle(row: WeldRow, cycle: PstoCycleSnapshot): WeldRow {
  return {
    ...row,
    pstoRequest: valueOrNull(cycle.pstoRequest),
    pstoRequestDate: valueOrNull(cycle.pstoRequestDate),
    pstoDate: valueOrNull(cycle.pstoDate),
    heatTreatmentDiagram: valueOrNull(cycle.heatTreatmentDiagram),
    pstoResult: valueOrNull(cycle.pstoResult),
    pstoNote: valueOrNull(cycle.pstoNote),
    tvmtRequest: valueOrNull(cycle.tvmtRequest),
    tvmtRequestDate: valueOrNull(cycle.tvmtRequestDate),
    tvmtResult: valueOrNull(cycle.tvmtResult),
    tvmtConclusionDate: valueOrNull(cycle.tvmtConclusionDate),
    tvmtConclusion: valueOrNull(cycle.tvmtConclusion),
  }
}

function applyRepeatCycle(
  relation: PstoRepeatCycleRecord,
  cycle: PstoCycleSnapshot,
): PstoRepeatCycleRecord {
  return {
    ...relation,
    pstoRequest: valueOrNull(cycle.pstoRequest),
    pstoRequestDate: valueOrNull(cycle.pstoRequestDate),
    pstoDate: valueOrNull(cycle.pstoDate),
    heatTreatmentDiagram: valueOrNull(cycle.heatTreatmentDiagram),
    pstoResult: valueOrNull(cycle.pstoResult),
    pstoNote: valueOrNull(cycle.pstoNote),
    tvmtRequest: valueOrNull(cycle.tvmtRequest),
    tvmtRequestDate: valueOrNull(cycle.tvmtRequestDate),
    tvmtResult: valueOrNull(cycle.tvmtResult),
    tvmtConclusionDate: valueOrNull(cycle.tvmtConclusionDate),
    tvmtConclusion: valueOrNull(cycle.tvmtConclusion),
  }
}

function requireDate(value: unknown) {
  const date = normalizeDateLikeForStorage(value)
  if (!date) throw new Error('Укажите дату документа.')
  return date
}

function stageIndex(stage: PstoCycleStage) {
  return PSTO_CYCLE_STAGES.indexOf(stage)
}

function getStageLabel(stage: PstoCycleStage) {
  if (stage === 'pstoRequest') return 'Заявка ПСТО'
  if (stage === 'pstoResult') return 'Результат ПСТО'
  if (stage === 'tvmtRequest') return 'Заявка ТВМТ'
  return 'Заключение ТВМТ'
}

function valueOrNull(value: unknown) {
  const normalized = String(value ?? '').trim()
  return normalized || null
}
