import { type WeldInput } from '@/lib/weld-fields'
import {
  LNK_GENERATED_FIELD_KEYS as lnkGeneratedFieldKeys,
  LNK_METHODS,
  LNK_REQUEST_FIELD_KEYS as lnkRequestFieldKeys,
} from '@/lib/report-config'
import { getJointStatusLabel } from '@/lib/lnk-status'
import { normalizeSearchText } from '@/lib/report-row-utils'
import { hasText, hasWeldDate } from '@/lib/report-value-utils'
import { formatDisplayDate } from '@/lib/date-format'
import {
  findLastIndex,
  formatRepeatedJointName,
  getCoilJointNames,
  normalizeJointChainPart,
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
} from '@/lib/repeated-joint-check-tasks'
import {
  buildJointChainConsistencyCheckTasks,
  hasCompletedParentBranch,
  isBlockingRepeatedJointCheckTask,
} from '@/lib/repeated-joint-consistency-tasks'
import { buildDuplicateJointCheckTasks } from '@/lib/repeated-joint-duplicate-tasks'
import { compareJointChainRows, getRepeatedJointIdentity } from '@/lib/repeated-joint-row-utils'
import type { RepeatedJointTask, WeldRow } from '@/lib/dispatcher-types'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'

export { getJointChainConsistencyKey } from '@/lib/joint-chain-keys'

export function buildRepeatedJointTasks(rows: WeldRow[], welderStampRecords: WelderStampRecord[] = []): RepeatedJointTask[] {
  const tasks: RepeatedJointTask[] = []
  const chainCheckTasks = [
    ...buildJointChainConsistencyCheckTasks(rows, { getPrimaryRejectedLnkResult, getOfficialRejectedJointChainRows }),
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
