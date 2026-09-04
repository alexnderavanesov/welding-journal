import {
  REPAIR_FORBIDDEN_BY_DIAMETER_REASON,
  REPAIR_FORBIDDEN_BY_REPAIR_LIMIT_REASON,
  UNOFFICIAL_REJECTED_WITH_COIL_REASON,
} from '@/lib/report-config'
import {
  LNK_REQUEST_DATE_ORDER_REASON,
  LNK_VIK_DATE_ORDER_REASON,
  LNK_VIK_REQUIRED_REASON,
} from '@/lib/lnk-chronology-checks'
import { PSTO_REQUEST_DATE_ORDER_REASON } from '@/lib/psto-chronology-checks'
import {
  CONTROL_HISTORY_REASON,
  JOINT_CORE_DATA_REASON,
  LNK_RESULT_COMPLETENESS_REASON,
  PSTO_RESULT_COMPLETENESS_REASON,
} from '@/lib/dispatcher-check-reasons'
import { getJointStatusLabel } from '@/lib/lnk-status'
import { formatDisplayDate } from '@/lib/date-format'
import { getWeldDateOrderValue } from '@/lib/report-date-rules'
import { formatRepeatedJointName, normalizeJointChainPart, parseJointChainName, parseRepeatedJointName } from '@/lib/joint-chain'
import { getJointChainIdentity, isUnofficialJoint } from '@/lib/joint-display'
import { getJointChainConsistencyKey } from '@/lib/joint-chain-keys'
import {
  buildJointCoilTransitions,
  type JointCoilTransition,
} from '@/lib/joint-chain-transitions'
import { createJointChainCheckTask, isIncompleteWeldStampGroupReason } from '@/lib/repeated-joint-check-tasks'
import { compareJointChainRows, getRepeatedJointBranchKey, getRepeatedJointIdentity } from '@/lib/repeated-joint-row-utils'
import { getExpectedRepeatedJointName } from '@/lib/repeated-joint-task-helpers'
import {
  getConfiguredJointChainSuffix,
  getSystemIndexSummaryText,
  loadSystemIndexSettings,
  type SystemIndexSettings,
} from '@/lib/system-index-settings'
import type { WeldInput } from '@/lib/weld-fields'
import type { RepeatedJointCheckTask, WeldRow } from '@/lib/dispatcher-types'

type RejectionResolver = (row: WeldInput) => unknown
type OfficialRejectedChainResolver = (rows: WeldRow[], sourceRow: WeldInput, sourceJoint: string) => WeldRow[]

type JointChainConsistencyTaskDeps = {
  getPrimaryRejectedLnkResult: RejectionResolver
  getOfficialRejectedJointChainRows: OfficialRejectedChainResolver
}

const COIL_CHAIN_INTEGRITY_REASON = 'проверить целостность катушки'

export function buildJointChainConsistencyCheckTasks(
  rows: WeldRow[],
  { getPrimaryRejectedLnkResult, getOfficialRejectedJointChainRows }: JointChainConsistencyTaskDeps,
  systemIndexSettings: SystemIndexSettings = loadSystemIndexSettings(),
  earlyCoilDecisionSourceRowIds: ReadonlySet<number> = new Set(),
): RepeatedJointCheckTask[] {
  const groups = new Map<string, WeldRow[]>()
  for (const row of rows) {
    const key = getRepeatedJointBranchKey(row, systemIndexSettings)
    if (key) {
      const group = groups.get(key) ?? []
      group.push(row)
      groups.set(key, group)
    }
  }

  const tasks = [
    ...buildMissingRepeatedJointSourceCheckTasks(rows, systemIndexSettings),
    ...[...groups.entries()].flatMap(([key, group]) => {
      const sortedGroup = [...group].sort((left, right) => compareJointChainRows(left, right, systemIndexSettings))
      const weldDateOrderIssue = findWeldDateOrderIssue(sortedGroup, systemIndexSettings)
      const checkTasks: RepeatedJointCheckTask[] = weldDateOrderIssue
        ? [
            createJointChainCheckTask(
              weldDateOrderIssue.row,
              `${key}:weld-date-order:${weldDateOrderIssue.row.id}`,
              'проверить даты сварки',
              `Дата стыка ${String(weldDateOrderIssue.previous.joint ?? '').trim() || '-'} (${formatDisplayDate(weldDateOrderIssue.previous.weldDate) || '-'}) позже даты следующего системного шага ${String(weldDateOrderIssue.row.joint ?? '').trim() || '-'} (${formatDisplayDate(weldDateOrderIssue.row.weldDate) || '-'}). Проверь последовательность дат сварки в части ${getSystemIndexSummaryText(systemIndexSettings)}.`,
              systemIndexSettings,
            ),
          ]
        : []
      const firstUnofficialGood = sortedGroup.find((row) => isUnofficialJoint(row) && getJointStatusLabel(row) === 'годен')
      if (firstUnofficialGood) {
        const joint = String(firstUnofficialGood.joint ?? '').trim() || '-'
        return [
          ...checkTasks,
          createJointChainCheckTask(
            firstUnofficialGood,
            key,
            'годный стык неофициальный',
            `Стык ${joint} сейчас годен, но отмечен как неофициальный. Итогом цепочки должен быть годный официальный стык, поэтому нужно проверить официальность и финал цепочки.`,
            systemIndexSettings,
          ),
        ]
      }

      const firstOfficialGoodIndex = sortedGroup.findIndex((row) => !isUnofficialJoint(row) && getJointStatusLabel(row) === 'годен')
      if (firstOfficialGoodIndex < 0) return checkTasks

      const officialGoodCount = sortedGroup.filter((row) => !isUnofficialJoint(row) && getJointStatusLabel(row) === 'годен').length
      const firstOfficialGood = sortedGroup[firstOfficialGoodIndex]
      const rowAfterOfficialGood = sortedGroup.find((row) => isJointChainRowWeldedAfter(row, firstOfficialGood))
      if (!rowAfterOfficialGood && officialGoodCount <= 1) return checkTasks

      const row = firstOfficialGood
      const reason = officialGoodCount > 1 ? 'несколько годных финалов' : 'есть продолжение после годного'
      const details =
        officialGoodCount > 1
          ? `В цепочке найдено ${officialGoodCount} годных официальных стыка. Нужно определить, какой из них является актуальным финалом, а какие строки лишние или требуют смены официальности.`
          : `Стык ${String(firstOfficialGood.joint ?? '').trim() || '-'} уже годен с датой сварки ${formatDisplayDate(firstOfficialGood.weldDate) || '-'}, но после него найден стык ${String(rowAfterOfficialGood?.joint ?? '').trim() || '-'} с более поздней датой ${formatDisplayDate(rowAfterOfficialGood?.weldDate) || '-'}. Проверь, действительно ли цепочка должна продолжаться после годного стыка.`
      return [...checkTasks, createJointChainCheckTask(row, key, reason, details, systemIndexSettings)]
    }),
  ]
  const coilTransitions = buildJointCoilTransitions(rows, {
    earlyCoilDecisionSourceRowIds,
    getOfficialRejectedJointChainRows,
    getPrimaryRejectedLnkResult,
    systemIndexSettings,
  })
  tasks.push(...buildCoilIntegrityCheckTasks(rows, coilTransitions, getPrimaryRejectedLnkResult, systemIndexSettings))
  tasks.push(...buildObsoleteChildBranchCheckTasks(
    rows,
    groups,
    coilTransitions,
    getPrimaryRejectedLnkResult,
    systemIndexSettings,
  ))
  return dedupeRepeatedJointCheckTasks(tasks)
}

export function isBlockingRepeatedJointCheckTask(task: RepeatedJointCheckTask) {
  return (
    task.reason !== UNOFFICIAL_REJECTED_WITH_COIL_REASON &&
    task.reason !== 'проверить целостность цепочки' &&
    task.reason !== COIL_CHAIN_INTEGRITY_REASON &&
    task.reason !== 'проверить клеймо' &&
    !isLnkChronologyReason(task.reason) &&
    task.reason !== PSTO_REQUEST_DATE_ORDER_REASON &&
    task.reason !== JOINT_CORE_DATA_REASON &&
    task.reason !== LNK_RESULT_COMPLETENESS_REASON &&
    task.reason !== PSTO_RESULT_COMPLETENESS_REASON &&
    task.reason !== CONTROL_HISTORY_REASON &&
    !isIncompleteWeldStampGroupReason(task.reason)
  )
}

function buildCoilIntegrityCheckTasks(
  rows: WeldRow[],
  transitions: readonly JointCoilTransition[],
  getPrimaryRejectedLnkResult: RejectionResolver,
  systemIndexSettings: SystemIndexSettings,
) {
  const tasks: RepeatedJointCheckTask[] = []
  for (const transition of transitions) {
    const targetRows = transition.targetRowIds
      .map((rowId) => rows.find((row) => row.id === rowId))
      .filter((row): row is WeldRow => Boolean(row))
    const sourceRow = transition.sourceRowId
      ? rows.find((row) => row.id === transition.sourceRowId)
      : undefined
    const taskRow = sourceRow ?? targetRows[0]
    if (!taskRow) continue

    const details: string[] = []
    const missingCoilJoints = transition.targetJoints.filter((_, index) => !transition.targetRowIds[index])
    if (missingCoilJoints.length > 0) {
      const existingText = targetRows.map((row) => String(row.joint ?? '').trim()).filter(Boolean).join(', ') || '-'
      details.push(
        `Катушка ${transition.parentBranchJoint} создана не полностью: найдено ${existingText}, но не найдено ${missingCoilJoints.join(' и ')}. Катушка должна состоять из двух стыков ${transition.targetJoints.join(' и ')}.`,
      )
    }

    if (!transition.mode) {
      const expectedTriggerJoint = getExpectedCoilTriggerJointForBranch(
        rows,
        taskRow,
        transition.parentBranchJoint,
        getPrimaryRejectedLnkResult,
        systemIndexSettings,
      )
      details.push(
        `В цепочке уже есть стык катушки ${transition.targetJoints.join('/')}, но диспетчер не нашел для ветки ${transition.parentBranchJoint} ни достижения лимита, ни принятого решения о досрочной катушке.${expectedTriggerJoint ? ` Перед катушкой ожидается следующий повторный стык ${expectedTriggerJoint} и его негодный результат контроля.` : ' Сначала должен существовать негодный официальный стык этой ветки.'} До этого катушка считается преждевременной.`,
      )
    }

    if (details.length === 0) continue
    tasks.push(
      createJointChainCheckTask(
        taskRow,
        `${transition.key}:coil-integrity`,
        COIL_CHAIN_INTEGRITY_REASON,
        details.join(' '),
        systemIndexSettings,
      ),
    )
  }
  return tasks
}

function buildObsoleteChildBranchCheckTasks(
  rows: WeldRow[],
  branchGroups: Map<string, WeldRow[]>,
  transitions: readonly JointCoilTransition[],
  getPrimaryRejectedLnkResult: RejectionResolver,
  systemIndexSettings: SystemIndexSettings,
) {
  const tasks: RepeatedJointCheckTask[] = []
  for (const [branchKey, group] of branchGroups) {
    const transition = transitions.find((candidate) => candidate.key === branchKey)
    if (!transition) continue
    const unofficialRejectedRowWithObsoleteCoil = group.find(
      (row) => isUnofficialJoint(row) && Boolean(getPrimaryRejectedLnkResult(row)),
    )
    if (unofficialRejectedRowWithObsoleteCoil && !transition.mode) {
      tasks.push(
        createJointChainCheckTask(
          unofficialRejectedRowWithObsoleteCoil,
          `${branchKey}:unofficial-rejected-with-coil`,
          UNOFFICIAL_REJECTED_WITH_COIL_REASON,
          `Стык ${String(unofficialRejectedRowWithObsoleteCoil.joint ?? '').trim() || '-'} отмечен как неофициальный, но в этой же цепочке уже есть ветка катушки ${getConfiguredJointChainSuffix('Y', systemIndexSettings)}. После смены официальности катушка может быть лишней или требовать другой логики, поэтому нужно проверить цепочку целиком.`,
          systemIndexSettings,
        ),
      )
      continue
    }

    const sourceRow = group.find((row) => !isUnofficialJoint(row) && getJointStatusLabel(row) === 'годен')
    const childRow = transition.targetRowIds
      .map((rowId) => rows.find((row) => row.id === rowId))
      .find(Boolean)
    if (sourceRow && childRow) {
      tasks.push(
        createJointChainCheckTask(
          childRow,
          `${branchKey}:child-after-good`,
          'есть лишняя ветка после годного',
          `Ветка ${String(childRow?.joint ?? '').trim() || '-'} выглядит лишней, потому что в цепочке уже есть годный официальный стык ${String(sourceRow?.joint ?? '').trim() || '-'}${sourceRow?.weldDate ? ` с датой сварки ${formatDisplayDate(sourceRow.weldDate)}` : ''}. Проверь, нужно ли оставлять эту ветку.`,
          systemIndexSettings,
        ),
      )
    }
  }
  return tasks
}

function buildMissingRepeatedJointSourceCheckTasks(
  rows: WeldRow[],
  systemIndexSettings: SystemIndexSettings,
) {
  const tasks: RepeatedJointCheckTask[] = []
  for (const row of rows) {
    const joint = String(row.joint ?? '').trim()
    if (!joint) continue

    const parsed = parseRepeatedJointName(joint, systemIndexSettings)
    if (parsed.segments.length === 0) continue

    const sourceCandidates = getStrictRepeatedJointSourceCandidates(parsed, systemIndexSettings)
    if (sourceCandidates.length === 0) continue

    const hasSource = sourceCandidates.some((sourceJoint) => hasMatchingRepeatedJoint(rows, row, sourceJoint))
    if (hasSource) continue

    const expectedSourceText = sourceCandidates.join(' или ')
    tasks.push(
      createJointChainCheckTask(
        row,
        `${getJointChainConsistencyKey(row, systemIndexSettings) ?? row.id}:missing-source:${row.id}:${sourceCandidates.join('|')}`,
        'проверить целостность цепочки',
        `Стык ${joint} находится в цепочке, но предыдущий или исходный стык ${expectedSourceText} не найден в журнале. Проверь, не был ли удален базовый или промежуточный стык цепочки.`,
        systemIndexSettings,
      ),
    )
  }
  return tasks
}

function getStrictRepeatedJointSourceCandidates(
  parsed: ReturnType<typeof parseRepeatedJointName>,
  systemIndexSettings: SystemIndexSettings,
) {
  const candidates: string[] = []
  const lastIndex = parsed.segments.length - 1

  parsed.segments.forEach((segment, index) => {
    const segments = parsed.segments.map((currentSegment) => ({ ...currentSegment }))
    if (segment.index > 1) {
      segments[index] = { ...segment, index: segment.index - 1 }
      candidates.push(formatRepeatedJointName(parsed.base, segments, systemIndexSettings))
      return
    }

    if (index === lastIndex) {
      segments.splice(index, 1)
      candidates.push(formatRepeatedJointName(parsed.base, segments, systemIndexSettings))
    }
  })

  return [...new Set(candidates.map((candidate) => candidate.trim()).filter(Boolean))]
}

function hasMatchingRepeatedJoint(rows: WeldRow[], row: WeldInput, joint: string) {
  const expectedIdentity = getRepeatedJointIdentity(row, joint)
  if (!expectedIdentity) return false
  return rows.some((candidate) => {
    const candidateIdentity = getRepeatedJointIdentity(candidate)
    return Boolean(
      candidateIdentity &&
        candidateIdentity.project === expectedIdentity.project &&
        candidateIdentity.subtitle === expectedIdentity.subtitle &&
        candidateIdentity.line === expectedIdentity.line &&
        candidateIdentity.joint === expectedIdentity.joint,
    )
  })
}

function isJointChainRowWeldedAfter(row: WeldInput, referenceRow: WeldInput) {
  const rowDate = getWeldDateOrderValue(row.weldDate)
  const referenceDate = getWeldDateOrderValue(referenceRow.weldDate)
  return Boolean(rowDate && referenceDate && rowDate > referenceDate)
}

function findWeldDateOrderIssue(rows: WeldRow[], systemIndexSettings: SystemIndexSettings) {
  let previousDatedRow: WeldRow | null = null
  let previousChainStepKey: string | null = null
  for (const row of rows) {
    const rowDate = getWeldDateOrderValue(row.weldDate)
    if (!rowDate) continue
    const chainStepKey = getJointChainStepKey(row, systemIndexSettings)
    if (chainStepKey === previousChainStepKey) continue
    if (previousDatedRow) {
      const previousDate = getWeldDateOrderValue(previousDatedRow.weldDate)
      if (previousDate && rowDate < previousDate) {
        return { previous: previousDatedRow, row }
      }
    }
    previousDatedRow = row
    previousChainStepKey = chainStepKey
  }
  return null
}

function getJointChainStepKey(row: WeldInput, systemIndexSettings: SystemIndexSettings) {
  const parsed = parseJointChainName(String(row.joint ?? ''), systemIndexSettings)
  return `${normalizeJointChainPart(parsed.base)}:${parsed.segments.map((segment) => `${segment.suffix}${segment.index}`).join('')}`
}

function getExpectedCoilTriggerJointForBranch(
  rows: WeldRow[],
  anchorRow: WeldRow,
  parentBranchJoint: string,
  getPrimaryRejectedLnkResult: RejectionResolver,
  systemIndexSettings: SystemIndexSettings,
) {
  const branchIdentity = getRepeatedJointIdentity(anchorRow, parentBranchJoint)
  if (!branchIdentity) return ''
  const rejectedRows = rows
    .filter((row) => {
      if (isUnofficialJoint(row) || !getPrimaryRejectedLnkResult(row)) return false
      const rowBranch = parseRepeatedJointName(String(row.joint ?? ''), systemIndexSettings).base
      const rowIdentity = getRepeatedJointIdentity(row, rowBranch)
      return Boolean(
        rowIdentity &&
          rowIdentity.project === branchIdentity.project &&
          rowIdentity.subtitle === branchIdentity.subtitle &&
          rowIdentity.line === branchIdentity.line &&
          rowIdentity.joint === branchIdentity.joint,
      )
    })
    .sort((left, right) => compareJointChainRows(left, right, systemIndexSettings))
  const lastRejectedRow = rejectedRows.at(-1)
  if (!lastRejectedRow) return ''
  const rejection = getPrimaryRejectedLnkResult(lastRejectedRow)
  const sourceJoint = String(lastRejectedRow.joint ?? '').trim()
  if (!isRepeatedJointRejection(rejection) || !sourceJoint) return ''
  return getExpectedRepeatedJointName(lastRejectedRow, sourceJoint, rejection.result, systemIndexSettings)
}

function isRepeatedJointRejection(value: unknown): value is { result: 'ремонт' | 'вырез' } {
  if (!value || typeof value !== 'object') return false
  const result = (value as { result?: unknown }).result
  return result === 'ремонт' || result === 'вырез'
}

function hasJointChainSegment(
  joint: string,
  suffix: string,
  systemIndexSettings: SystemIndexSettings,
) {
  const normalizedSuffix = suffix.toUpperCase()
  return parseJointChainName(joint, systemIndexSettings).segments.some((segment) => segment.suffix === normalizedSuffix)
}

export function hasCompletedParentBranch(
  rows: WeldRow[],
  row: WeldInput,
  sourceJoint: string,
  systemIndexSettings: SystemIndexSettings = loadSystemIndexSettings(),
) {
  if (!hasJointChainSegment(sourceJoint, 'Y', systemIndexSettings)) return false
  const chainIdentity = getJointChainIdentity({ ...row, joint: sourceJoint }, systemIndexSettings)
  const branchIdentity = getRepeatedJointIdentity(row, parseRepeatedJointName(sourceJoint, systemIndexSettings).base)
  if (!chainIdentity || !branchIdentity) return false
  return rows.some((candidate) => {
    if (isUnofficialJoint(candidate) || getJointStatusLabel(candidate) !== 'годен') return false
    const candidateChainIdentity = getJointChainIdentity(candidate, systemIndexSettings)
    if (
      !candidateChainIdentity ||
      candidateChainIdentity.project !== chainIdentity.project ||
      candidateChainIdentity.subtitle !== chainIdentity.subtitle ||
      candidateChainIdentity.line !== chainIdentity.line ||
      candidateChainIdentity.baseJoint !== chainIdentity.baseJoint
    ) {
      return false
    }
    const candidateBranchJoint = parseRepeatedJointName(String(candidate.joint ?? ''), systemIndexSettings).base
    const candidateBranchIdentity = getRepeatedJointIdentity(candidate, candidateBranchJoint)
    return Boolean(
      candidateBranchIdentity &&
        candidateBranchIdentity.joint !== branchIdentity.joint &&
        !hasJointChainSegment(candidateBranchJoint, 'Y', systemIndexSettings),
    )
  })
}

function dedupeRepeatedJointCheckTasks(tasks: RepeatedJointCheckTask[]) {
  const seen = new Set<string>()
  return tasks.filter((task) => {
    const key =
      task.reason === 'проверить клеймо' ||
      isLnkChronologyReason(task.reason) ||
      task.reason === PSTO_REQUEST_DATE_ORDER_REASON ||
      task.reason === REPAIR_FORBIDDEN_BY_DIAMETER_REASON ||
      task.reason === REPAIR_FORBIDDEN_BY_REPAIR_LIMIT_REASON ||
      task.reason === JOINT_CORE_DATA_REASON ||
      task.reason === LNK_RESULT_COMPLETENESS_REASON ||
      task.reason === PSTO_RESULT_COMPLETENESS_REASON ||
      task.reason === CONTROL_HISTORY_REASON ||
      isIncompleteWeldStampGroupReason(task.reason) ||
      task.reason === COIL_CHAIN_INTEGRITY_REASON
        ? task.key
        : `${task.baseJoint}:${task.reason ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function isLnkChronologyReason(reason?: string) {
  return (
    reason === LNK_REQUEST_DATE_ORDER_REASON ||
    reason === LNK_VIK_DATE_ORDER_REASON ||
    reason === LNK_VIK_REQUIRED_REASON
  )
}
