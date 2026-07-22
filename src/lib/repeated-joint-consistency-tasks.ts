import { REPAIR_FORBIDDEN_BY_DIAMETER_REASON, UNOFFICIAL_REJECTED_WITH_COIL_REASON } from '@/lib/report-config'
import {
  LNK_REQUEST_DATE_ORDER_REASON,
  LNK_VIK_DATE_ORDER_REASON,
  LNK_VIK_REQUIRED_REASON,
} from '@/lib/lnk-chronology-checks'
import { PSTO_REQUEST_DATE_ORDER_REASON } from '@/lib/psto-chronology-checks'
import { getJointStatusLabel } from '@/lib/lnk-status'
import { formatDisplayDate } from '@/lib/date-format'
import { getWeldDateOrderValue } from '@/lib/report-date-rules'
import { formatRepeatedJointName, getCoilJointNames, normalizeJointChainPart, parseJointChainName, parseRepeatedJointName } from '@/lib/joint-chain'
import { getJointChainIdentity, isUnofficialJoint } from '@/lib/joint-display'
import { getJointChainConsistencyKey } from '@/lib/joint-chain-keys'
import { createJointChainCheckTask, isIncompleteWeldStampGroupReason } from '@/lib/repeated-joint-check-tasks'
import { compareJointChainRows, getRepeatedJointBranchKey, getRepeatedJointIdentity } from '@/lib/repeated-joint-row-utils'
import { getExpectedRepeatedJointName } from '@/lib/repeated-joint-task-helpers'
import { getConfiguredJointChainSuffix, getSystemIndexSummaryText } from '@/lib/system-index-settings'
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
): RepeatedJointCheckTask[] {
  const groups = new Map<string, WeldRow[]>()
  const chainGroups = new Map<string, WeldRow[]>()
  for (const row of rows) {
    const key = getRepeatedJointBranchKey(row)
    if (key) {
      const group = groups.get(key) ?? []
      group.push(row)
      groups.set(key, group)
    }

    const chainKey = getJointChainConsistencyKey(row)
    if (chainKey) {
      const chainGroup = chainGroups.get(chainKey) ?? []
      chainGroup.push(row)
      chainGroups.set(chainKey, chainGroup)
    }
  }

  const tasks = [
    ...buildMissingRepeatedJointSourceCheckTasks(rows),
    ...[...groups.entries()].flatMap(([key, group]) => {
      const sortedGroup = [...group].sort(compareJointChainRows)
      const weldDateOrderIssue = findWeldDateOrderIssue(sortedGroup)
      const checkTasks: RepeatedJointCheckTask[] = weldDateOrderIssue
        ? [
            createJointChainCheckTask(
              weldDateOrderIssue.row,
              `${key}:weld-date-order:${weldDateOrderIssue.row.id}`,
              'проверить даты сварки',
              `Дата стыка ${String(weldDateOrderIssue.previous.joint ?? '').trim() || '-'} (${formatDisplayDate(weldDateOrderIssue.previous.weldDate) || '-'}) позже даты следующего системного шага ${String(weldDateOrderIssue.row.joint ?? '').trim() || '-'} (${formatDisplayDate(weldDateOrderIssue.row.weldDate) || '-'}). Проверь последовательность дат сварки в части ${getSystemIndexSummaryText()}.`,
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
          ? `В цепочке найдено ${officialGoodCount} годных официальных стыка. Нужно определить, какой из них является актуальным финалом, а какие строки лишние или требуют смены статуса.`
          : `Стык ${String(firstOfficialGood.joint ?? '').trim() || '-'} уже годен с датой сварки ${formatDisplayDate(firstOfficialGood.weldDate) || '-'}, но после него найден стык ${String(rowAfterOfficialGood?.joint ?? '').trim() || '-'} с более поздней датой ${formatDisplayDate(rowAfterOfficialGood?.weldDate) || '-'}. Проверь, действительно ли цепочка должна продолжаться после годного стыка.`
      return [...checkTasks, createJointChainCheckTask(row, key, reason, details)]
    }),
  ]
  tasks.push(...buildCoilIntegrityCheckTasks(rows, chainGroups, { getPrimaryRejectedLnkResult, getOfficialRejectedJointChainRows }))
  tasks.push(...buildObsoleteChildBranchCheckTasks(rows, chainGroups, groups, { getPrimaryRejectedLnkResult, getOfficialRejectedJointChainRows }))
  return dedupeRepeatedJointCheckTasks(tasks)
}

export function isBlockingRepeatedJointCheckTask(task: RepeatedJointCheckTask) {
  return (
    task.reason !== UNOFFICIAL_REJECTED_WITH_COIL_REASON &&
    task.reason !== COIL_CHAIN_INTEGRITY_REASON &&
    task.reason !== 'проверить клеймо' &&
    !isLnkChronologyReason(task.reason) &&
    !isIncompleteWeldStampGroupReason(task.reason)
  )
}

function buildCoilIntegrityCheckTasks(
  rows: WeldRow[],
  chainGroups: Map<string, WeldRow[]>,
  deps: JointChainConsistencyTaskDeps,
) {
  const tasks: RepeatedJointCheckTask[] = []
  for (const [chainKey, chainRows] of chainGroups) {
    const coilGroups = new Map<string, WeldRow[]>()
    for (const row of chainRows) {
      const coilBaseJoint = getCoilBaseJoint(String(row.joint ?? ''))
      if (!coilBaseJoint) continue
      const group = coilGroups.get(coilBaseJoint) ?? []
      group.push(row)
      coilGroups.set(coilBaseJoint, group)
    }
    if (coilGroups.size === 0) continue

    const details: string[] = []
    const sourceRow = [...coilGroups.values()].flat().sort(compareJointChainRows)[0]
    if (!sourceRow) continue

    for (const [coilBaseJoint, coilRows] of coilGroups) {
      const expectedCoilJoints = getCoilJointNames(coilBaseJoint)
      const missingCoilJoints = expectedCoilJoints.filter((joint) => !hasMatchingRepeatedJoint(rows, sourceRow, joint))
      if (missingCoilJoints.length > 0) {
        const existingText = coilRows.map((row) => String(row.joint ?? '').trim()).filter(Boolean).join(', ') || '-'
        details.push(
          `Катушка ${coilBaseJoint} создана не полностью: найдено ${existingText}, но не найдено ${missingCoilJoints.join(' и ')}. Катушка должна состоять из двух стыков ${expectedCoilJoints.join(' и ')}.`,
        )
      }
    }

    if (!hasValidOfficialCoilTrigger(rows, chainRows, deps)) {
      const coilText = [...coilGroups.keys()].map((coilBaseJoint) => getCoilJointNames(coilBaseJoint).join('/')).join(', ')
      const expectedTriggerJoint = getExpectedCoilTriggerJoint(chainRows, deps.getPrimaryRejectedLnkResult)
      details.push(
        `В цепочке уже есть стык катушки ${coilText}, но диспетчер не нашел официальный негодный стык, который по правилам должен породить катушку.${expectedTriggerJoint ? ` Перед катушкой ожидается следующий повторный стык ${expectedTriggerJoint} и его негодный результат контроля.` : ' Сначала должен существовать следующий повторный стык и его негодный результат контроля.'} До этого катушка считается преждевременной.`,
      )
    }

    if (details.length === 0) continue
    tasks.push(
      createJointChainCheckTask(
        sourceRow,
        `${chainKey}:coil-integrity`,
        COIL_CHAIN_INTEGRITY_REASON,
        details.join(' '),
      ),
    )
  }
  return tasks
}

function buildObsoleteChildBranchCheckTasks(
  rows: WeldRow[],
  chainGroups: Map<string, WeldRow[]>,
  branchGroups: Map<string, WeldRow[]>,
  { getPrimaryRejectedLnkResult, getOfficialRejectedJointChainRows }: JointChainConsistencyTaskDeps,
) {
  const tasks: RepeatedJointCheckTask[] = []
  for (const [chainKey, chainRows] of chainGroups) {
    const branchKeys = [...new Set(chainRows.map((row) => getRepeatedJointBranchKey(row)).filter(Boolean) as string[])]
    const unofficialRejectedRowWithObsoleteCoil = chainRows.find((row) => {
      if (!isUnofficialJoint(row) || !getPrimaryRejectedLnkResult(row)) return false
      if (hasValidOfficialCoilTrigger(rows, chainRows, { getPrimaryRejectedLnkResult, getOfficialRejectedJointChainRows })) return false
      const rowBranchKey = getRepeatedJointBranchKey(row)
      return branchKeys.some((branchKey) => {
        if (branchKey === rowBranchKey) return false
        const branchJoint = branchKey.split(':').at(-1) ?? ''
        return hasJointChainSegment(branchJoint, 'Y')
      })
    })
    if (unofficialRejectedRowWithObsoleteCoil) {
      tasks.push(
        createJointChainCheckTask(
          unofficialRejectedRowWithObsoleteCoil,
          `${chainKey}:unofficial-rejected-with-coil`,
          UNOFFICIAL_REJECTED_WITH_COIL_REASON,
          `Стык ${String(unofficialRejectedRowWithObsoleteCoil.joint ?? '').trim() || '-'} отмечен как неофициальный, но в этой же цепочке уже есть ветка катушки ${getConfiguredJointChainSuffix('Y')}. После смены официальности катушка может быть лишней или требовать другой логики, поэтому нужно проверить цепочку целиком.`,
        ),
      )
      continue
    }

    const completedBranchKeys = branchKeys.filter((branchKey) => {
      const group = branchGroups.get(branchKey) ?? []
      return group.some((row) => !isUnofficialJoint(row) && getJointStatusLabel(row) === 'годен')
    })

    for (const completedBranchKey of completedBranchKeys) {
      const completedBranchJoint = completedBranchKey.split(':').at(-1) ?? ''
      const completedBranchHasCoil = hasJointChainSegment(completedBranchJoint, 'Y')
      const obsoleteChildKey = branchKeys.find((branchKey) => {
        if (branchKey === completedBranchKey) return false
        const branchJoint = branchKey.split(':').at(-1) ?? ''
        return completedBranchHasCoil ? branchJoint.startsWith(`${completedBranchJoint}${getConfiguredJointChainSuffix('Y')}`) : hasJointChainSegment(branchJoint, 'Y')
      })
      if (!obsoleteChildKey) continue

      const sourceRow = branchGroups.get(completedBranchKey)?.find((row) => !isUnofficialJoint(row) && getJointStatusLabel(row) === 'годен')
      const childRow = branchGroups.get(obsoleteChildKey)?.[0]
      const row = childRow ?? sourceRow
      if (!row) continue
      tasks.push(
        createJointChainCheckTask(
          row,
          `${chainKey}:${completedBranchKey}:child`,
          'есть лишняя ветка после годного',
          `Ветка ${String(childRow?.joint ?? '').trim() || '-'} выглядит лишней, потому что в цепочке уже есть годный официальный стык ${String(sourceRow?.joint ?? '').trim() || '-'}${sourceRow?.weldDate ? ` с датой сварки ${formatDisplayDate(sourceRow.weldDate)}` : ''}. Проверь, нужно ли оставлять эту ветку.`,
        ),
      )
      break
    }
  }
  return tasks
}

function buildMissingRepeatedJointSourceCheckTasks(rows: WeldRow[]) {
  const tasks: RepeatedJointCheckTask[] = []
  for (const row of rows) {
    const joint = String(row.joint ?? '').trim()
    if (!joint) continue

    const parsed = parseRepeatedJointName(joint)
    if (parsed.segments.length === 0) continue

    const sourceCandidates = getStrictRepeatedJointSourceCandidates(parsed)
    if (sourceCandidates.length === 0) continue

    const hasSource = sourceCandidates.some((sourceJoint) => hasMatchingRepeatedJoint(rows, row, sourceJoint))
    if (hasSource) continue

    const expectedSourceText = sourceCandidates.join(' или ')
    tasks.push(
      createJointChainCheckTask(
        row,
        `${getJointChainConsistencyKey(row) ?? row.id}:missing-source:${row.id}:${sourceCandidates.join('|')}`,
        'проверить целостность цепочки',
        `Стык ${joint} находится в цепочке, но предыдущий или исходный стык ${expectedSourceText} не найден в журнале. Проверь, не был ли удален базовый или промежуточный стык цепочки.`,
      ),
    )
  }
  return tasks
}

function getStrictRepeatedJointSourceCandidates(parsed: ReturnType<typeof parseRepeatedJointName>) {
  const candidates: string[] = []
  const lastIndex = parsed.segments.length - 1

  parsed.segments.forEach((segment, index) => {
    const segments = parsed.segments.map((currentSegment) => ({ ...currentSegment }))
    if (segment.index > 1) {
      segments[index] = { ...segment, index: segment.index - 1 }
      candidates.push(formatRepeatedJointName(parsed.base, segments))
      return
    }

    if (index === lastIndex) {
      segments.splice(index, 1)
      candidates.push(formatRepeatedJointName(parsed.base, segments))
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

function findWeldDateOrderIssue(rows: WeldRow[]) {
  let previousDatedRow: WeldRow | null = null
  let previousChainStepKey: string | null = null
  for (const row of rows) {
    const rowDate = getWeldDateOrderValue(row.weldDate)
    if (!rowDate) continue
    const chainStepKey = getJointChainStepKey(row)
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

function getJointChainStepKey(row: WeldInput) {
  const parsed = parseJointChainName(String(row.joint ?? ''))
  return `${normalizeJointChainPart(parsed.base)}:${parsed.segments.map((segment) => `${segment.suffix}${segment.index}`).join('')}`
}

function getCoilBaseJoint(joint: string) {
  const parsed = parseJointChainName(joint)
  const firstCoilIndex = parsed.segments.findIndex((segment) => segment.suffix === 'Y')
  if (firstCoilIndex < 0) return null
  const baseSegments = parsed.segments.slice(0, firstCoilIndex)
  return formatRepeatedJointName(parsed.base, baseSegments)
}

function getExpectedCoilTriggerJoint(chainRows: WeldRow[], getPrimaryRejectedLnkResult: RejectionResolver) {
  const rejectedRows = chainRows
    .filter((row) => !isUnofficialJoint(row) && getPrimaryRejectedLnkResult(row))
    .sort(compareJointChainRows)
  const lastRejectedRow = rejectedRows.at(-1)
  if (!lastRejectedRow) return ''
  const rejection = getPrimaryRejectedLnkResult(lastRejectedRow)
  const sourceJoint = String(lastRejectedRow.joint ?? '').trim()
  if (!isRepeatedJointRejection(rejection) || !sourceJoint) return ''
  return getExpectedRepeatedJointName(lastRejectedRow, sourceJoint, rejection.result)
}

function isRepeatedJointRejection(value: unknown): value is { result: 'ремонт' | 'вырез' } {
  if (!value || typeof value !== 'object') return false
  const result = (value as { result?: unknown }).result
  return result === 'ремонт' || result === 'вырез'
}

function hasValidOfficialCoilTrigger(rows: WeldRow[], chainRows: WeldRow[], { getPrimaryRejectedLnkResult, getOfficialRejectedJointChainRows }: JointChainConsistencyTaskDeps) {
  return chainRows.some((row) => {
    if (isUnofficialJoint(row) || !getPrimaryRejectedLnkResult(row)) return false
    const sourceJoint = String(row.joint ?? '').trim()
    if (!sourceJoint) return false
    const officialRejectedChainRows = getOfficialRejectedJointChainRows(rows, row, sourceJoint)
    return officialRejectedChainRows.length > 3 && officialRejectedChainRows.at(-1)?.id === row.id
  })
}

function hasJointChainSegment(joint: string, suffix: string) {
  const normalizedSuffix = suffix.toUpperCase()
  return parseJointChainName(joint).segments.some((segment) => segment.suffix === normalizedSuffix)
}

export function hasCompletedParentBranch(rows: WeldRow[], row: WeldInput, sourceJoint: string) {
  if (!hasJointChainSegment(sourceJoint, 'Y')) return false
  const chainIdentity = getJointChainIdentity({ ...row, joint: sourceJoint })
  const branchIdentity = getRepeatedJointIdentity(row, parseRepeatedJointName(sourceJoint).base)
  if (!chainIdentity || !branchIdentity) return false
  return rows.some((candidate) => {
    if (isUnofficialJoint(candidate) || getJointStatusLabel(candidate) !== 'годен') return false
    const candidateChainIdentity = getJointChainIdentity(candidate)
    if (
      !candidateChainIdentity ||
      candidateChainIdentity.project !== chainIdentity.project ||
      candidateChainIdentity.subtitle !== chainIdentity.subtitle ||
      candidateChainIdentity.line !== chainIdentity.line ||
      candidateChainIdentity.baseJoint !== chainIdentity.baseJoint
    ) {
      return false
    }
    const candidateBranchJoint = parseRepeatedJointName(String(candidate.joint ?? '')).base
    const candidateBranchIdentity = getRepeatedJointIdentity(candidate, candidateBranchJoint)
    return Boolean(
      candidateBranchIdentity &&
        candidateBranchIdentity.joint !== branchIdentity.joint &&
        !hasJointChainSegment(candidateBranchJoint, 'Y'),
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
      isIncompleteWeldStampGroupReason(task.reason)
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
