import type { WeldRow } from '@/lib/dispatcher-types'
import { getCoilJointNames, parseRepeatedJointName } from '@/lib/joint-chain'
import { isUnofficialJoint } from '@/lib/joint-display'
import {
  findMatchingJointRows,
  getExpectedRepeatedJointName,
  getPrimaryRejectedLnkResult,
  isUnusedRepeatedJointDraft,
} from '@/lib/repeated-joint-task-helpers'
import { buildRepeatedJointTasks } from '@/lib/repeated-joint-tasks'
import {
  loadSystemIndexSettings,
  type SystemIndexSettings,
} from '@/lib/system-index-settings'

export type EarlyCoilCandidate = {
  methodCode: string
  replacementRow: WeldRow | null
  result: 'ремонт' | 'вырез'
  sourceJoint: string
  sourceRow: WeldRow
  targetJoints: [string, string]
}

export type EarlyCoilCandidateEvaluation =
  | { candidate: EarlyCoilCandidate; reason: null }
  | { candidate: null; reason: string }

type EvaluateEarlyCoilCandidateOptions = {
  documentedRowIds?: ReadonlySet<number>
  earlyCoilDecisionSourceRowIds?: ReadonlySet<number>
  systemIndexSettings?: SystemIndexSettings
}

export function evaluateEarlyCoilCandidate(
  rows: readonly WeldRow[],
  sourceRow: WeldRow,
  options: EvaluateEarlyCoilCandidateOptions = {},
): EarlyCoilCandidateEvaluation {
  const settings = options.systemIndexSettings ?? loadSystemIndexSettings()
  const sourceJoint = String(sourceRow.joint ?? '').trim()
  if (!sourceJoint) return blocked('У исходного стыка не заполнен номер.')
  if (isUnofficialJoint(sourceRow)) {
    return blocked('Досрочную катушку можно создать только после негодного официального стыка.')
  }
  if (options.earlyCoilDecisionSourceRowIds?.has(sourceRow.id)) {
    return blocked('Решение о досрочной врезке катушки уже принято.')
  }

  const rejection = getPrimaryRejectedLnkResult(sourceRow)
  if (!rejection) {
    return blocked('Досрочная катушка доступна только после результата «ремонт» или «вырез».')
  }

  const branchJoint = parseRepeatedJointName(sourceJoint, settings).base
  const targetJoints = getCoilJointNames(branchJoint, settings) as [string, string]
  if (targetJoints.some((joint) => findMatchingJointRows([...rows], sourceRow, joint).length > 0)) {
    return blocked(`Ветка катушки ${targetJoints.join(' + ')} уже существует или создана не полностью.`)
  }

  const expectedRepeatedJoint = getExpectedRepeatedJointName(
    sourceRow,
    sourceJoint,
    rejection.result,
    settings,
  )
  const replacementRows = findMatchingJointRows([...rows], sourceRow, expectedRepeatedJoint)
  if (replacementRows.length > 1) {
    return blocked(`Найдено несколько стыков ${expectedRepeatedJoint}. Сначала устраните дубль цепочки.`)
  }
  const replacementRow = replacementRows[0] ?? null
  if (replacementRow && !isSafeEarlyCoilReplacementRow(replacementRow, options.documentedRowIds)) {
    return blocked(
      `Стык ${expectedRepeatedJoint} уже содержит данные, историю или документы. Досрочная катушка не будет удалять его автоматически.`,
    )
  }

  const validationRows = replacementRow
    ? rows.filter((row) => row.id !== replacementRow.id)
    : [...rows]
  const currentTask = buildRepeatedJointTasks(validationRows, [], [], {
    includeControlHistoryChecks: false,
    includeIncompleteStampChecks: false,
    includeJointCoreDataChecks: false,
    includeLineConsistencyTasks: false,
    includeLnkResultCompletenessChecks: false,
    includePercentageLineControlTasks: false,
    includePstoResultCompletenessChecks: false,
    includeWelderStampCompatibilityChecks: false,
    systemIndexSettings: settings,
  }).find((task) => task.kind === 'create' && task.row.id === sourceRow.id)

  if (!currentTask || currentTask.kind !== 'create' || currentTask.targetJoint !== expectedRepeatedJoint) {
    return blocked('Этот стык больше не является текущим негодным концом ветки. Обновите цепочку.')
  }

  return {
    candidate: {
      methodCode: rejection.method.code,
      replacementRow,
      result: rejection.result,
      sourceJoint,
      sourceRow,
      targetJoints,
    },
    reason: null,
  }
}

export function isSafeEarlyCoilReplacementRow(
  row: WeldRow,
  documentedRowIds: ReadonlySet<number> = new Set(),
) {
  if (!isUnusedRepeatedJointDraft(row) || documentedRowIds.has(row.id)) return false
  if ((row.duplicateControls?.length ?? 0) > 0) return false
  if ((row.preHeatTreatmentControls?.length ?? 0) > 0) return false
  if ((row.pstoRepeatCycles?.length ?? 0) > 0) return false

  const auditRow = row as WeldRow & { updatedAt?: unknown }
  const createdAt = timestamp(auditRow.createdAt)
  const updatedAt = timestamp(auditRow.updatedAt)
  return createdAt !== null && updatedAt !== null && createdAt === updatedAt
}

function blocked(reason: string): EarlyCoilCandidateEvaluation {
  return { candidate: null, reason }
}

function timestamp(value: unknown) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(String(value))
  const result = date.getTime()
  return Number.isFinite(result) ? result : null
}
