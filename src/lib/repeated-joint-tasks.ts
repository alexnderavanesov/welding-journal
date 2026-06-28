import { calculateFinalStatus, type WeldFieldKey, type WeldInput } from '@/lib/weld-fields'
import {
  LNK_GENERATED_FIELD_KEYS as lnkGeneratedFieldKeys,
  LNK_METHODS,
  LNK_REQUEST_FIELD_KEYS as lnkRequestFieldKeys,
  REPAIR_FORBIDDEN_BY_DIAMETER_REASON,
  REPEATED_JOINT_CLEARED_FIELD_KEYS as repeatedJointClearedFieldKeys,
  UNOFFICIAL_REJECTED_WITH_COIL_REASON,
} from '@/lib/report-config'
import { getJointStatusLabel } from '@/lib/lnk-status'
import { compareReportRows, normalizeSearchText } from '@/lib/report-row-utils'
import { hasText, hasWeldDate } from '@/lib/report-value-utils'
import { formatDisplayDate } from '@/lib/date-format'
import { getWeldDateOrderValue } from '@/lib/report-date-rules'
import {
  compareJointChainSuffix,
  findLastIndex,
  formatRepeatedJointName,
  getCoilJointNames,
  normalizeJointChainPart,
  parseJointChainName,
  parseRepeatedJointName,
} from '@/lib/joint-chain'
import { getJointChainIdentity, isUnofficialJoint } from '@/lib/joint-display'
import { isLnkRepairForbiddenByOfficialRepairLimit } from '@/lib/lnk-result-rules'
import { getJointChainConsistencyKey } from '@/lib/joint-chain-keys'
import {
  buildControlDateBeforeWeldDateCheckTasks,
  buildForbiddenRepairByDiameterCheckTasks,
  buildIncompleteWelderStampGroupTasks,
  buildWelderStampCompatibilityCheckTasks,
  createJointChainCheckTask,
  isIncompleteWeldStampGroupReason,
} from '@/lib/repeated-joint-check-tasks'
import type { RepeatedJointCheckTask, RepeatedJointDuplicateCheckTask, RepeatedJointTask, WeldRow } from '@/lib/dispatcher-types'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'

export { getJointChainConsistencyKey } from '@/lib/joint-chain-keys'

export function buildRepeatedJointTasks(rows: WeldRow[], welderStampRecords: WelderStampRecord[] = []): RepeatedJointTask[] {
  const tasks: RepeatedJointTask[] = []
  const chainCheckTasks = [
    ...buildJointChainConsistencyCheckTasks(rows),
    ...buildControlDateBeforeWeldDateCheckTasks(rows),
    ...buildForbiddenRepairByDiameterCheckTasks(rows),
    ...buildWelderStampCompatibilityCheckTasks(rows, welderStampRecords),
    ...buildIncompleteWelderStampGroupTasks(rows),
  ]
  const duplicateCheckTasks = buildDuplicateJointCheckTasks(rows)
  const blockedChainKeys = new Set(
    [
      ...chainCheckTasks.filter(isBlockingRepeatedJointCheckTask),
      ...duplicateCheckTasks,
    ].map((task) => getJointChainConsistencyKey(task.row)).filter(Boolean) as string[],
  )
  const obsoleteByRowId = new Map<number, NonNullable<ReturnType<typeof getObsoleteRepeatedJointInfo>>>()
  for (const row of rows) {
    const repeated = getObsoleteRepeatedJointInfo(rows, row)
    if (repeated) obsoleteByRowId.set(row.id, repeated)
  }

  for (const row of rows) {
    if (obsoleteByRowId.has(row.id)) continue
    if (isRowInBlockedRepeatedJointChain(row, blockedChainKeys)) continue
    const rejection = getPrimaryRejectedLnkResult(row)
    if (!rejection) continue
    const sourceJoint = String(row.joint ?? '').trim()
    if (!sourceJoint) continue
    if (hasCompletedParentBranch(rows, row, sourceJoint)) continue

    const suffix = getExpectedRepeatedJointSuffix(row, rejection.result)
    const parsed = parseRepeatedJointName(sourceJoint)
    const officialRejectedChainRows = getOfficialRejectedJointChainRows(rows, row, sourceJoint)
    const lastOfficialRejectedRow = officialRejectedChainRows.at(-1)
    if (!isUnofficialJoint(row) && officialRejectedChainRows.length > 3 && lastOfficialRejectedRow?.id === row.id) {
      const targetJoints = getCoilJointNames(parsed.base).filter((targetJoint) => !hasRepeatedJointTarget(rows, row, targetJoint))
      if (targetJoints.length === 0) continue

      tasks.push({
        kind: 'coil',
        key: `${row.id}:${rejection.method.resultKey}:${rejection.result}:coil:${targetJoints.join('+')}`,
        row,
        sourceJoint,
        targetJoints,
        result: rejection.result,
        methodCode: rejection.method.code,
      })
      continue
    }

    const targetJoint = getExpectedRepeatedJointName(row, sourceJoint, rejection.result)
    if (hasRepeatedJointTarget(rows, row, targetJoint)) continue

    tasks.push({
      kind: 'create',
      key: `${row.id}:${rejection.method.resultKey}:${rejection.result}:${targetJoint}`,
      row,
      sourceJoint,
      targetJoint,
      result: rejection.result,
      suffix,
      methodCode: rejection.method.code,
    })
  }
  const checkTaskChainKeys = new Set<string>()
  for (const row of rows) {
    const repeated = obsoleteByRowId.get(row.id)
    if (!repeated) continue
    if (isRowInBlockedRepeatedJointChain(row, blockedChainKeys)) continue
    if (
      repeated.expectedTargetJoint &&
      normalizeJointChainPart(repeated.expectedTargetJoint) !== normalizeJointChainPart(repeated.targetJoint) &&
      !hasRepeatedJointTarget(rows, repeated.sourceRow, repeated.expectedTargetJoint)
    ) {
      tasks.push({
        kind: 'rename',
        key: `rename-obsolete:${repeated.sourceRow.id}:${row.id}:${repeated.sourceJoint}:${repeated.targetJoint}:${repeated.expectedTargetJoint}`,
        row,
        sourceRow: repeated.sourceRow,
        sourceJoint: repeated.sourceJoint,
        currentJoint: repeated.targetJoint,
        targetJoint: repeated.expectedTargetJoint,
        baseJoint: parseRepeatedJointName(repeated.expectedTargetJoint).base,
      })
    } else if (isUnusedRepeatedJointDraft(row)) {
      tasks.push({
        kind: 'delete',
        key: `obsolete:${repeated.sourceRow.id}:${row.id}:${repeated.sourceJoint}:${repeated.targetJoint}`,
        row,
        sourceRow: repeated.sourceRow,
        sourceJoint: repeated.sourceJoint,
        targetJoint: repeated.targetJoint,
        suffix: repeated.suffix,
        reason: repeated.reason,
      })
    } else {
      const identity = getJointChainIdentity(row)
      const baseJoint = parseRepeatedJointName(repeated.targetJoint).base
      const chainKey = identity
        ? `${identity.project}:${identity.subtitle}:${identity.line}:${identity.baseJoint}`
        : `${normalizeSearchText(row.projectTitle)}:${normalizeSearchText(row.subtitleCode)}:${normalizeSearchText(row.line)}:${normalizeSearchText(baseJoint)}`
      if (checkTaskChainKeys.has(chainKey)) continue
      checkTaskChainKeys.add(chainKey)
      tasks.push({
        kind: 'check',
        key: `check-obsolete:${chainKey}:${row.id}`,
        row,
        sourceRow: repeated.sourceRow,
        sourceJoint: repeated.sourceJoint,
        targetJoint: repeated.targetJoint,
        baseJoint,
        suffix: repeated.suffix,
        reason: hasWeldDate(row) ? 'повторный стык уже заварен' : 'повторный стык содержит данные',
        details: hasWeldDate(row)
          ? `Стык ${repeated.targetJoint} выглядит лишним по текущим правилам цепочки, но у него уже заполнена дата сварки ${formatDisplayDate(row.weldDate) || '-'}. Диспетчер не удаляет такие строки автоматически: открой цепочку и проверь вручную.`
          : `Стык ${repeated.targetJoint} выглядит лишним по текущим правилам цепочки, но в нем уже есть данные. Проверь цепочку перед удалением или исправлением.`,
      })
    }
  }
  return [...chainCheckTasks, ...duplicateCheckTasks, ...tasks]
}

function isRowInBlockedRepeatedJointChain(row: WeldInput, blockedChainKeys: Set<string>) {
  const chainKey = getJointChainConsistencyKey(row)
  return Boolean(chainKey && blockedChainKeys.has(chainKey))
}

function buildJointChainConsistencyCheckTasks(rows: WeldRow[]): RepeatedJointCheckTask[] {
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

  const tasks = [...groups.entries()].flatMap(([key, group]) => {
    const sortedGroup = [...group].sort(compareJointChainRows)
    const weldDateOrderIssue = findWeldDateOrderIssue(sortedGroup)
    const checkTasks: RepeatedJointCheckTask[] = weldDateOrderIssue
      ? [
          createJointChainCheckTask(
            weldDateOrderIssue.row,
            `${key}:weld-date-order:${weldDateOrderIssue.row.id}`,
            'проверить даты сварки',
            `Дата стыка ${String(weldDateOrderIssue.previous.joint ?? '').trim() || '-'} (${formatDisplayDate(weldDateOrderIssue.previous.weldDate) || '-'}) позже даты следующего системного шага ${String(weldDateOrderIssue.row.joint ?? '').trim() || '-'} (${formatDisplayDate(weldDateOrderIssue.row.weldDate) || '-'}). Проверь последовательность дат сварки в части R/W/Y.`,
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
  })
  tasks.push(...buildObsoleteChildBranchCheckTasks(rows, chainGroups, groups))
  return dedupeRepeatedJointCheckTasks(tasks)
}

function buildObsoleteChildBranchCheckTasks(rows: WeldRow[], chainGroups: Map<string, WeldRow[]>, branchGroups: Map<string, WeldRow[]>) {
  const tasks: RepeatedJointCheckTask[] = []
  for (const [chainKey, chainRows] of chainGroups) {
    const branchKeys = [...new Set(chainRows.map((row) => getRepeatedJointBranchKey(row)).filter(Boolean) as string[])]
    const unofficialRejectedRowWithObsoleteCoil = chainRows.find((row) => {
      if (!isUnofficialJoint(row) || !getPrimaryRejectedLnkResult(row)) return false
      if (hasValidOfficialCoilTrigger(rows, chainRows)) return false
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
          `Стык ${String(unofficialRejectedRowWithObsoleteCoil.joint ?? '').trim() || '-'} отмечен как неофициальный, но в этой же цепочке уже есть ветка катушки Y. После смены официальности катушка может быть лишней или требовать другой логики, поэтому нужно проверить цепочку целиком.`,
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
        return completedBranchHasCoil ? branchJoint.startsWith(`${completedBranchJoint}Y`) : hasJointChainSegment(branchJoint, 'Y')
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

function isBlockingRepeatedJointCheckTask(task: RepeatedJointCheckTask) {
  return task.reason !== UNOFFICIAL_REJECTED_WITH_COIL_REASON && task.reason !== 'проверить клеймо' && !isIncompleteWeldStampGroupReason(task.reason)
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

function hasValidOfficialCoilTrigger(rows: WeldRow[], chainRows: WeldRow[]) {
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

function hasCompletedParentBranch(rows: WeldRow[], row: WeldInput, sourceJoint: string) {
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
      task.reason === REPAIR_FORBIDDEN_BY_DIAMETER_REASON ||
      isIncompleteWeldStampGroupReason(task.reason)
        ? task.key
        : `${task.baseJoint}:${task.reason ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function buildDuplicateJointCheckTasks(rows: WeldRow[]): RepeatedJointDuplicateCheckTask[] {
  const groups = new Map<string, WeldRow[]>()
  for (const row of rows) {
    const key = getDuplicateJointKey(row)
    if (!key) continue
    const group = groups.get(key) ?? []
    group.push(row)
    groups.set(key, group)
  }

  return [...groups.entries()].flatMap(([key, group]) => {
    if (group.length < 2) return []
    const sortedGroup = [...group].sort(compareJointChainRows)
    const row = sortedGroup[0]
    const sourceJoint = String(row.joint ?? '').trim()
    if (!sourceJoint) return []
    const baseJoint = parseJointChainName(sourceJoint).base || sourceJoint
    return [
      {
        kind: 'duplicate-check' as const,
        key: `duplicate-check:${key}`,
        row,
        sourceJoint,
        baseJoint,
        count: group.length,
      },
    ]
  })
}

function getObsoleteRepeatedJointInfo(rows: WeldRow[], row: WeldRow) {
  const targetJoint = String(row.joint ?? '').trim()
  const parsed = parseRepeatedJointName(targetJoint)
  if (parsed.segments.length === 0) return null
  let obsoleteCandidate: {
    sourceRow: WeldRow
    sourceJoint: string
    targetJoint: string
    expectedTargetJoint: string
    suffix: 'R' | 'W'
    reason: string
  } | null = null
  for (const candidate of getRepeatedJointSourceCandidates(parsed)) {
    const sourceRows = findMatchingJointRows(rows, row, candidate.sourceJoint)
    if (sourceRows.length === 0) continue
    const validSource = sourceRows.find((sourceRow) => {
      const rejection = getPrimaryRejectedLnkResult(sourceRow)
      const expectedSuffix = rejection ? (rejection.result === 'ремонт' ? 'R' : 'W') : null
      const expectedTargetJoint = rejection ? getExpectedRepeatedJointName(sourceRow, candidate.sourceJoint, rejection.result) : ''
      return expectedSuffix === candidate.suffix && normalizeJointChainPart(expectedTargetJoint) === normalizeJointChainPart(targetJoint)
    })
    if (validSource) return null
    const sourceRow = sourceRows[0]
    const rejection = getPrimaryRejectedLnkResult(sourceRow)
    const expectedTargetJoint = rejection ? getExpectedRepeatedJointName(sourceRow, candidate.sourceJoint, rejection.result) : ''
    obsoleteCandidate =
      obsoleteCandidate ?? {
        sourceRow,
        sourceJoint: candidate.sourceJoint,
        targetJoint,
        expectedTargetJoint,
        suffix: candidate.suffix,
        reason: getObsoleteRepeatedJointReason(sourceRow, rejection, expectedTargetJoint, targetJoint),
      }
  }
  return obsoleteCandidate
}

function getObsoleteRepeatedJointReason(
  sourceRow: WeldInput,
  rejection: ReturnType<typeof getPrimaryRejectedLnkResult>,
  expectedTargetJoint: string,
  targetJoint: string,
) {
  if (!rejection) {
    return getJointStatusLabel(sourceRow) === 'годен' ? 'исходный стык стал годным' : 'исходный стык больше не требует повтора'
  }
  if (isUnofficialJoint(sourceRow)) return 'исходный стык неофициальный'
  if (expectedTargetJoint && normalizeJointChainPart(expectedTargetJoint) !== normalizeJointChainPart(targetJoint)) return 'лишний по текущим правилам'
  return 'повторный стык не актуален'
}

export function isUnusedRepeatedJointDraft(row: WeldInput) {
  if (hasText(row.weldDate)) return false
  return ![...lnkRequestFieldKeys, ...lnkGeneratedFieldKeys, 'pstoRequest', 'pstoDate', 'pstoResult', 'heatTreatmentDiagram'].some((fieldKey) =>
    hasText(row[fieldKey]),
  )
}

function getPrimaryRejectedLnkResult(row: WeldInput) {
  const cut = LNK_METHODS.find((method) => String(row[method.resultKey] ?? '').trim().toLowerCase() === 'вырез')
  if (cut) return { method: cut, result: 'вырез' as const }
  const repair = LNK_METHODS.find((method) => String(row[method.resultKey] ?? '').trim().toLowerCase() === 'ремонт')
  if (repair) return { method: repair, result: 'ремонт' as const }
  return null
}

function getNextRepeatedJointName(sourceJoint: string, suffix: 'R' | 'W') {
  const parsed = parseRepeatedJointName(sourceJoint)
  const segments = parsed.segments.map((segment) => ({ ...segment }))
  const segmentIndex = findLastIndex(segments, (segment) => segment.suffix === suffix)
  if (segmentIndex >= 0) {
    segments[segmentIndex] = { ...segments[segmentIndex], index: segments[segmentIndex].index + 1 }
  } else {
    segments.push({ suffix, index: 1 })
  }
  return formatRepeatedJointName(parsed.base, segments)
}

function getExpectedRepeatedJointName(sourceRow: WeldInput, sourceJoint: string, result: 'ремонт' | 'вырез') {
  if (isUnofficialJoint(sourceRow)) return sourceJoint.trim()
  const suffix = getExpectedRepeatedJointSuffix(sourceRow, result)
  return getNextRepeatedJointName(sourceJoint, suffix)
}

function getExpectedRepeatedJointSuffix(sourceRow: WeldInput, result: 'ремонт' | 'вырез'): 'R' | 'W' {
  return result === 'ремонт' && !isLnkRepairForbiddenByOfficialRepairLimit(sourceRow) ? 'R' : 'W'
}

function getOfficialRejectedJointChainRows(rows: WeldRow[], sourceRow: WeldInput, sourceJoint: string) {
  const parsedSource = parseRepeatedJointName(sourceJoint)
  const sourceIdentity = getRepeatedJointIdentity(sourceRow, parsedSource.base)
  if (!sourceIdentity) return []
  return rows
    .filter((row) => {
      if (isUnofficialJoint(row) || !getPrimaryRejectedLnkResult(row)) return false
      const rowJoint = String(row.joint ?? '').trim()
      if (!rowJoint) return false
      const rowIdentity = getRepeatedJointIdentity(row, parseRepeatedJointName(rowJoint).base)
      if (!rowIdentity) return false
      return (
        rowIdentity.project === sourceIdentity.project &&
        rowIdentity.subtitle === sourceIdentity.subtitle &&
        rowIdentity.line === sourceIdentity.line &&
        rowIdentity.joint === sourceIdentity.joint
      )
    })
    .sort(compareJointChainRows)
}

function getRepeatedJointSourceCandidates(parsed: ReturnType<typeof parseRepeatedJointName>) {
  return parsed.segments.flatMap((segment, index) => {
    if (segment.index <= 0) return []
    const segments = parsed.segments.map((current) => ({ ...current }))
    if (segment.index > 1) {
      segments[index] = { ...segment, index: segment.index - 1 }
    } else {
      segments.splice(index, 1)
    }
    return [{ sourceJoint: formatRepeatedJointName(parsed.base, segments), suffix: segment.suffix }]
  })
}

function hasRepeatedJointTarget(rows: WeldRow[], sourceRow: WeldInput, targetJoint: string) {
  return Boolean(findRepeatedJointRow(rows, sourceRow, targetJoint))
}

function findRepeatedJointRow(rows: WeldRow[], sourceRow: WeldInput, joint: string) {
  const sourceIdentity = getRepeatedJointIdentity(sourceRow, joint)
  if (!sourceIdentity) return null
  const sourceId = typeof (sourceRow as { id?: unknown }).id === 'number' ? (sourceRow as { id: number }).id : null
  const sourceJointIdentity = getRepeatedJointIdentity(sourceRow)
  const needsOfficialSameNameTarget =
    isUnofficialJoint(sourceRow) && sourceJointIdentity !== null && sourceJointIdentity.joint === sourceIdentity.joint
  return (
    rows.find((row) => {
      if (sourceId !== null && row.id === sourceId) return false
      if (needsOfficialSameNameTarget && isUnofficialJoint(row)) return false
      const rowIdentity = getRepeatedJointIdentity(row)
      return (
        rowIdentity &&
        rowIdentity.project === sourceIdentity.project &&
        rowIdentity.subtitle === sourceIdentity.subtitle &&
        rowIdentity.line === sourceIdentity.line &&
        rowIdentity.joint === sourceIdentity.joint
      )
    }) ?? null
  )
}

function findMatchingJointRows(rows: WeldRow[], sourceRow: WeldInput, joint: string) {
  const normalizedJoint = normalizeSearchText(joint)
  return rows.filter((row) => {
    if (normalizeSearchText(row.joint) !== normalizedJoint) return false
    return (
      normalizeSearchText(row.projectTitle) === normalizeSearchText(sourceRow.projectTitle) &&
      normalizeSearchText(row.subtitleCode) === normalizeSearchText(sourceRow.subtitleCode) &&
      normalizeSearchText(row.line) === normalizeSearchText(sourceRow.line)
    )
  })
}

function getRepeatedJointIdentity(row: WeldInput, jointOverride?: string) {
  const joint = String(jointOverride ?? row.joint ?? '').trim()
  if (!joint) return null
  return {
    project: normalizeJointChainPart(row.projectTitle),
    subtitle: normalizeJointChainPart(row.subtitleCode),
    line: normalizeJointChainPart(row.line),
    joint: normalizeJointChainPart(joint),
  }
}

function getDuplicateJointKey(row: WeldInput) {
  if (isUnofficialJoint(row)) return null
  const values = ['projectTitle', 'subtitleCode', 'line', 'joint'].map((fieldKey) =>
    normalizeJointChainPart(row[fieldKey as WeldFieldKey]),
  )
  if (values.every((value) => value === '')) return null
  return values.join('|')
}

function getRepeatedJointBranchKey(row: WeldInput) {
  const joint = String(row.joint ?? '').trim()
  if (!joint) return null
  const branchJoint = parseRepeatedJointName(joint).base
  const identity = getRepeatedJointIdentity(row, branchJoint)
  if (!identity) return null
  return `${identity.project}:${identity.subtitle}:${identity.line}:${identity.joint}`
}

export function buildRepeatedJointDraft(sourceRow: WeldRow, targetJoint: string): WeldInput {
  const draft = { ...sourceRow } as WeldInput & { id?: number }
  delete draft.id
  for (const fieldKey of repeatedJointClearedFieldKeys) {
    draft[fieldKey] = null
  }
  restoreRepeatedJointControlAvailability(draft, sourceRow)
  draft.joint = targetJoint
  draft.status = null
  draft.createdAt = new Date().toISOString()
  draft.finalStatus = calculateFinalStatus(draft)
  return draft
}

function restoreRepeatedJointControlAvailability(draft: WeldInput, sourceRow: WeldInput) {
  draft.pstoRequired = sourceRow.pstoRequired
  for (const method of LNK_METHODS) {
    draft[method.enabledKey] = sourceRow[method.enabledKey]
  }
}

export function getJointChainRows(rows: WeldRow[], targetRow: WeldInput) {
  const targetIdentity = getJointChainIdentity(targetRow)
  if (!targetIdentity) return []
  return rows
    .filter((row) => {
      const identity = getJointChainIdentity(row)
      return (
        identity &&
        identity.project === targetIdentity.project &&
        identity.subtitle === targetIdentity.subtitle &&
        identity.line === targetIdentity.line &&
        identity.baseJoint === targetIdentity.baseJoint
      )
    })
    .sort(compareJointChainRows)
}

function compareJointChainRows(left: WeldRow, right: WeldRow) {
  const leftParsed = parseJointChainName(String(left.joint ?? ''))
  const rightParsed = parseJointChainName(String(right.joint ?? ''))
  const leftBase = normalizeJointChainPart(leftParsed.base)
  const rightBase = normalizeJointChainPart(rightParsed.base)
  if (leftBase !== rightBase) return leftBase.localeCompare(rightBase, 'ru', { numeric: true })

  const maxLength = Math.max(leftParsed.segments.length, rightParsed.segments.length)
  for (let index = 0; index < maxLength; index += 1) {
    const leftSegment = leftParsed.segments[index]
    const rightSegment = rightParsed.segments[index]
    if (!leftSegment && rightSegment) return -1
    if (leftSegment && !rightSegment) return 1
    if (!leftSegment || !rightSegment) continue
    const suffixDiff = compareJointChainSuffix(leftSegment.suffix, rightSegment.suffix)
    if (suffixDiff !== 0) return suffixDiff
    if (leftSegment.index !== rightSegment.index) return leftSegment.index - rightSegment.index
  }
  return compareReportRows(left, right)
}
