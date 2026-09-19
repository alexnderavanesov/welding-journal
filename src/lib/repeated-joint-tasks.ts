import { type WeldInput } from '@/lib/weld-fields'
import { getJointStatusLabel } from '@/lib/lnk-status'
import { normalizeSearchText } from '@/lib/report-row-utils'
import { hasWeldDate } from '@/lib/report-value-utils'
import { formatDisplayDate } from '@/lib/date-format'
import {
  getCoilJointNames,
  normalizeJointChainPart,
  parseRepeatedJointName,
} from '@/lib/joint-chain'
import { getJointChainIdentity, isUnofficialJoint } from '@/lib/joint-display'
import { getJointChainConsistencyKey } from '@/lib/joint-chain-keys'
import { getCoilTransitionModeForSource } from '@/lib/joint-chain-transitions'
import {
  buildControlHistoryCheckTasks,
  buildForbiddenRepairByDiameterCheckTasks,
  buildIncompleteWelderStampGroupTasks,
  buildJointCoreDataCheckTasks,
  buildLnkChronologyCheckTasks,
  buildLnkResultCompletenessCheckTasks,
  buildPstoChronologyCheckTasks,
  buildPstoResultCompletenessCheckTasks,
  buildPrimaryLnkStageDebtSystemWarnings,
  buildWelderStampCompatibilityCheckTasks,
} from '@/lib/repeated-joint-check-tasks'
import {
  buildJointChainConsistencyCheckTasks,
  hasCompletedParentBranch,
  isBlockingRepeatedJointCheckTask,
} from '@/lib/repeated-joint-consistency-tasks'
import { buildDuplicateJointCheckTasks } from '@/lib/repeated-joint-duplicate-tasks'
import { buildLineConsistencyTasks } from '@/lib/line-consistency-tasks'
import { buildPercentageLineControlTasks } from '@/lib/percentage-line-tasks'
import { REPAIR_FORBIDDEN_BY_REPAIR_LIMIT_REASON } from '@/lib/report-config'
import {
  getExpectedRepeatedJointName,
  getExpectedRepeatedJointSuffix,
  getOfficialRejectedJointChainRows,
  getPrimaryRejectedLnkResult,
  getRepeatedJointSourceCandidates,
  hasRepeatedJointTarget,
  isUnusedRepeatedJointDraft,
} from '@/lib/repeated-joint-task-helpers'
import { compareJointChainRows, getRepeatedJointIdentity } from '@/lib/repeated-joint-row-utils'
import type { RepeatedJointRenameTask, RepeatedJointTask, WeldRow } from '@/lib/dispatcher-types'
import type { WelderStampRecord, WelderStampSuspensionRecord } from '@/lib/welder-stamp-types'
import type { DataListSettings } from '@/lib/data-list-settings'
import { DEFAULT_SYSTEM_INDEX_SETTINGS, type SystemIndexSettings } from '@/lib/system-index-settings'
import { encodeIdentityKey } from '@/lib/identity-key'
import type { ControlProcessSettings } from '@/lib/control-process-settings'

export { getJointChainConsistencyKey } from '@/lib/joint-chain-keys'
export { isUnusedRepeatedJointDraft } from '@/lib/repeated-joint-task-helpers'

type ObsoleteRepeatedJointInfo = {
  row: WeldRow
  sourceRow: WeldRow
  sourceJoint: string
  targetJoint: string
  expectedTargetJoint: string
  suffix: 'R' | 'W'
  reason: string
}

type MatchingJointRowsIndex = Map<string, WeldRow[]>

type BuildRepeatedJointTasksOptions = {
  earlyCoilDecisionSourceRowIds?: ReadonlySet<number>
  dataListSettings?: DataListSettings
  systemIndexSettings?: SystemIndexSettings
  includeControlHistoryChecks?: boolean
  includeIncompleteStampChecks?: boolean
  includeJointCoreDataChecks?: boolean
  includeLineConsistencyTasks?: boolean
  includeLnkResultCompletenessChecks?: boolean
  includePercentageLineControlTasks?: boolean
  includePstoResultCompletenessChecks?: boolean
  includeWelderStampCompatibilityChecks?: boolean
  controlProcessSettings?: ControlProcessSettings
}

export function buildRepeatedJointTasks(
  rows: WeldRow[],
  welderStampRecords: WelderStampRecord[] = [],
  welderStampSuspensions: WelderStampSuspensionRecord[] = [],
  options: BuildRepeatedJointTasksOptions = {},
): RepeatedJointTask[] {
  const {
    includeControlHistoryChecks = true,
    includeIncompleteStampChecks = true,
    includeJointCoreDataChecks = true,
    includeLineConsistencyTasks = true,
    includeLnkResultCompletenessChecks = true,
    includePercentageLineControlTasks = true,
    includePstoResultCompletenessChecks = true,
    includeWelderStampCompatibilityChecks = true,
  } = options
  const systemIndexSettings = options.systemIndexSettings ?? DEFAULT_SYSTEM_INDEX_SETTINGS
  const earlyCoilDecisionSourceRowIds = options.earlyCoilDecisionSourceRowIds ?? new Set<number>()
  const getConfiguredOfficialRejectedJointChainRows = (
    sourceRows: WeldRow[],
    sourceRow: WeldInput,
    sourceJoint: string,
  ) => getOfficialRejectedJointChainRows(sourceRows, sourceRow, sourceJoint, systemIndexSettings)
  const tasks: RepeatedJointTask[] = []
  const orphanGoodRenameTasks = buildOrphanGoodRepeatedJointRenameTasks(rows, systemIndexSettings)
  const orphanGoodRenameRowIds = new Set(orphanGoodRenameTasks.map((task) => task.row.id))
  const chainCheckTasks = [
    ...buildPrimaryLnkStageDebtSystemWarnings(rows, options.controlProcessSettings),
    ...buildJointChainConsistencyCheckTasks(
      rows,
      { getPrimaryRejectedLnkResult, getOfficialRejectedJointChainRows: getConfiguredOfficialRejectedJointChainRows },
      systemIndexSettings,
      earlyCoilDecisionSourceRowIds,
    ),
    ...buildLnkChronologyCheckTasks(rows, systemIndexSettings),
    ...buildPstoChronologyCheckTasks(rows, systemIndexSettings),
    ...buildForbiddenRepairByDiameterCheckTasks(rows, systemIndexSettings),
    ...(includeJointCoreDataChecks
      ? buildJointCoreDataCheckTasks(rows, systemIndexSettings)
      : []),
    ...(includeLnkResultCompletenessChecks ? buildLnkResultCompletenessCheckTasks(rows, systemIndexSettings) : []),
    ...(includePstoResultCompletenessChecks ? buildPstoResultCompletenessCheckTasks(rows, systemIndexSettings) : []),
    ...(includeControlHistoryChecks ? buildControlHistoryCheckTasks(rows, systemIndexSettings) : []),
    ...(includeWelderStampCompatibilityChecks
      ? buildWelderStampCompatibilityCheckTasks(
          rows,
          welderStampRecords,
          welderStampSuspensions,
          options.dataListSettings,
          systemIndexSettings,
        )
      : []),
    ...(includeIncompleteStampChecks ? buildIncompleteWelderStampGroupTasks(rows, systemIndexSettings) : []),
  ].filter((task) => !(task.reason === 'проверить целостность цепочки' && orphanGoodRenameRowIds.has(task.row.id)))
  const duplicateCheckTasks = buildDuplicateJointCheckTasks(rows, systemIndexSettings)
  const lineConsistencyTasks = includeLineConsistencyTasks ? buildLineConsistencyTasks(rows) : []
  const percentageLineControlTasks = includePercentageLineControlTasks
    ? buildPercentageLineControlTasks(rows, welderStampSuspensions, systemIndexSettings)
    : []
  const matchingJointRowsIndex = buildMatchingJointRowsIndex(rows)
  const blockedChainKeys = new Set(
    [
      ...chainCheckTasks.filter(isBlockingRepeatedJointCheckTask),
      ...duplicateCheckTasks,
    ].map((task) => getJointChainConsistencyKey(task.row, systemIndexSettings)).filter(Boolean) as string[],
  )
  const renameBlockedChainKeys = new Set(
    [
      ...chainCheckTasks.filter((task) => (
        isBlockingRepeatedJointCheckTask(task) &&
        task.reason !== REPAIR_FORBIDDEN_BY_REPAIR_LIMIT_REASON
      )),
      ...duplicateCheckTasks,
    ].map((task) => getJointChainConsistencyKey(task.row, systemIndexSettings)).filter(Boolean) as string[],
  )
  const obsoleteByRowId = new Map<number, ObsoleteRepeatedJointInfo>()
  for (const row of rows) {
    const repeated = getObsoleteRepeatedJointInfo(matchingJointRowsIndex, row, systemIndexSettings)
    if (repeated) obsoleteByRowId.set(row.id, repeated)
  }
  const renameTasks = buildObsoleteRepeatedJointRenameTasks({
    blockedChainKeys: renameBlockedChainKeys,
    matchingJointRowsIndex,
    obsoleteInfos: [...obsoleteByRowId.values()],
    rows,
    systemIndexSettings,
  })
  const renameChangeRowIds = new Set(renameTasks.flatMap((task) => task.changes.map((change) => change.rowId)))
  const renameReplacementTargetKeys = new Set([...obsoleteByRowId.values()].flatMap((info) => {
    if (
      !info.expectedTargetJoint ||
      normalizeJointChainPart(info.targetJoint) === normalizeJointChainPart(info.expectedTargetJoint)
    ) return []
    const key = getCreateTaskTargetKey(info.sourceRow, info.expectedTargetJoint)
    return key ? [key] : []
  }))
  const createTaskTargetKeys = new Set<string>()

  for (const row of rows) {
    if (obsoleteByRowId.has(row.id)) continue
    if (isRowInBlockedRepeatedJointChain(row, renameBlockedChainKeys, systemIndexSettings)) continue
    const rejection = getPrimaryRejectedLnkResult(row)
    if (!rejection) continue
    const sourceJoint = String(row.joint ?? '').trim()
    if (!sourceJoint) continue
    if (hasCompletedParentBranch(rows, row, sourceJoint, systemIndexSettings)) continue

    const suffix = getExpectedRepeatedJointSuffix(row, rejection.result, systemIndexSettings)
    const parsed = parseRepeatedJointName(sourceJoint, systemIndexSettings)
    const officialRejectedChainRows = getOfficialRejectedJointChainRows(rows, row, sourceJoint, systemIndexSettings)
    const lastOfficialRejectedRow = officialRejectedChainRows.at(-1)
    const coilTransitionMode = getCoilTransitionModeForSource({
      earlyCoilDecisionSourceRowIds,
      officialRejectedRows: officialRejectedChainRows,
      sourceRow: row,
      systemIndexSettings,
    })
    if (coilTransitionMode) {
      const targetJoints = getCoilJointNames(parsed.base, systemIndexSettings)
        .filter((targetJoint) => !hasRepeatedJointTarget(rows, row, targetJoint))
      if (targetJoints.length === 0) continue

      tasks.push({
        kind: 'coil',
        key: `${row.id}:${rejection.method.resultKey}:${rejection.result}:coil:${targetJoints.join('+')}`,
        row,
        sourceJoint,
        targetJoints,
        result: rejection.result,
        methodCode: rejection.method.code,
        transitionMode: coilTransitionMode,
      })
      continue
    }

    const targetJoint = getExpectedRepeatedJointName(row, sourceJoint, rejection.result, systemIndexSettings)
    if (hasRepeatedJointTarget(rows, row, targetJoint)) continue
    const createTargetKey = getCreateTaskTargetKey(row, targetJoint)
    if (createTargetKey && renameReplacementTargetKeys.has(createTargetKey)) continue
    if (createTargetKey && createTaskTargetKeys.has(createTargetKey)) continue
    if (createTargetKey) createTaskTargetKeys.add(createTargetKey)

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
  tasks.push(...renameTasks)
  const checkTaskChainKeys = new Set<string>()
  for (const row of rows) {
    const repeated = obsoleteByRowId.get(row.id)
    if (!repeated) continue
    if (renameChangeRowIds.has(row.id)) continue
    if (isRowInBlockedRepeatedJointChain(row, blockedChainKeys, systemIndexSettings)) continue
    if (
      repeated.expectedTargetJoint &&
      normalizeJointChainPart(repeated.expectedTargetJoint) !== normalizeJointChainPart(repeated.targetJoint) &&
      !hasRepeatedJointTarget(rows, repeated.sourceRow, repeated.expectedTargetJoint)
    ) {
      const identity = getJointChainIdentity(row, systemIndexSettings)
      const baseJoint = parseRepeatedJointName(repeated.targetJoint, systemIndexSettings).base
      const chainKey = identity
        ? encodeIdentityKey([identity.project, identity.subtitle, identity.line, identity.baseJoint])
        : encodeIdentityKey([
            normalizeSearchText(row.projectTitle),
            normalizeSearchText(row.subtitleCode),
            normalizeSearchText(row.line),
            normalizeSearchText(baseJoint),
          ])
      if (checkTaskChainKeys.has(chainKey)) continue
      checkTaskChainKeys.add(chainKey)
      tasks.push({
        kind: 'check',
        key: `check-obsolete-rename:${chainKey}:${row.id}`,
        row,
        sourceRow: repeated.sourceRow,
        sourceJoint: repeated.sourceJoint,
        targetJoint: repeated.targetJoint,
        baseJoint,
        suffix: repeated.suffix,
        reason: 'проверить целостность цепочки',
        details: `Стык ${repeated.targetJoint} должен называться ${repeated.expectedTargetJoint}, но диспетчер не может безопасно перестроить продолжение цепочки автоматически. Проверь существующие имена и возможные дубли.`,
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
      const identity = getJointChainIdentity(row, systemIndexSettings)
      const baseJoint = parseRepeatedJointName(repeated.targetJoint, systemIndexSettings).base
      const chainKey = identity
        ? encodeIdentityKey([identity.project, identity.subtitle, identity.line, identity.baseJoint])
        : encodeIdentityKey([
            normalizeSearchText(row.projectTitle),
            normalizeSearchText(row.subtitleCode),
            normalizeSearchText(row.line),
            normalizeSearchText(baseJoint),
          ])
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
  return [
    ...chainCheckTasks,
    ...duplicateCheckTasks,
    ...lineConsistencyTasks,
    ...percentageLineControlTasks,
    ...orphanGoodRenameTasks,
    ...tasks,
  ]
}

function buildOrphanGoodRepeatedJointRenameTasks(
  rows: WeldRow[],
  systemIndexSettings: SystemIndexSettings,
): RepeatedJointRenameTask[] {
  const tasks: RepeatedJointRenameTask[] = []
  for (const row of rows) {
    if (isUnofficialJoint(row) || getJointStatusLabel(row) !== 'годен') continue
    const currentJoint = String(row.joint ?? '').trim()
    if (!currentJoint) continue
    const parsed = parseRepeatedJointName(currentJoint, systemIndexSettings)
    if (parsed.segments.length === 0) continue

    const sourceCandidates = getRepeatedJointSourceCandidates(parsed, systemIndexSettings)
    const targetJoint = sourceCandidates.find((candidate) => !hasRepeatedJointTarget(rows, row, candidate.sourceJoint))?.sourceJoint ?? ''
    if (!targetJoint) continue
    const hasAnySource = sourceCandidates.some((candidate) => hasRepeatedJointTarget(rows, row, candidate.sourceJoint))
    if (hasAnySource) continue

    tasks.push({
      kind: 'rename',
      key: `rename-orphan-good:${row.id}:${currentJoint}:${targetJoint}`,
      row,
      sourceRow: row,
      sourceJoint: targetJoint,
      currentJoint,
      targetJoint,
      baseJoint: parseRepeatedJointName(targetJoint, systemIndexSettings).base,
      changes: [{ rowId: row.id, currentJoint, targetJoint }],
    })
  }
  return tasks
}

function getCreateTaskTargetKey(row: WeldInput, targetJoint: string) {
  const identity = getRepeatedJointIdentity(row, targetJoint)
  if (!identity) return null
  return encodeIdentityKey([
    identity.project,
    identity.subtitle,
    identity.line,
    identity.joint,
  ])
}

function isRowInBlockedRepeatedJointChain(
  row: WeldInput,
  blockedChainKeys: Set<string>,
  systemIndexSettings: SystemIndexSettings,
) {
  const chainKey = getJointChainConsistencyKey(row, systemIndexSettings)
  return Boolean(chainKey && blockedChainKeys.has(chainKey))
}

function buildMatchingJointRowsIndex(rows: WeldRow[]): MatchingJointRowsIndex {
  const index: MatchingJointRowsIndex = new Map()
  for (const row of rows) {
    const key = getMatchingJointRowsIndexKey(row, row.joint)
    if (!key) continue
    const group = index.get(key)
    if (group) {
      group.push(row)
    } else {
      index.set(key, [row])
    }
  }
  return index
}

function getMatchingJointRowsIndexKey(row: WeldInput, joint: unknown) {
  const normalizedJoint = normalizeSearchText(joint)
  if (!normalizedJoint) return ''
  return [
    normalizeSearchText(row.projectTitle),
    normalizeSearchText(row.subtitleCode),
    normalizeSearchText(row.line),
    normalizedJoint,
  ].join('\u0000')
}

function findMatchingJointRowsInIndex(index: MatchingJointRowsIndex, sourceRow: WeldInput, joint: string) {
  return index.get(getMatchingJointRowsIndexKey(sourceRow, joint)) ?? []
}

function getObsoleteRepeatedJointInfo(
  index: MatchingJointRowsIndex,
  row: WeldRow,
  systemIndexSettings: SystemIndexSettings,
): ObsoleteRepeatedJointInfo | null {
  const targetJoint = String(row.joint ?? '').trim()
  const parsed = parseRepeatedJointName(targetJoint, systemIndexSettings)
  if (parsed.segments.length === 0) return null
  const obsoleteCandidates: ObsoleteRepeatedJointInfo[] = []
  for (const candidate of getRepeatedJointSourceCandidates(parsed, systemIndexSettings)) {
    const matchingSourceRows = findMatchingJointRowsInIndex(index, row, candidate.sourceJoint)
    const officialSourceRows = matchingSourceRows.filter((sourceRow) => !isUnofficialJoint(sourceRow))
    const sourceRows = officialSourceRows.length > 0 ? officialSourceRows : matchingSourceRows
    if (sourceRows.length === 0) continue
    const validSource = sourceRows.find((sourceRow) => {
      const rejection = getPrimaryRejectedLnkResult(sourceRow)
      const expectedSuffix = rejection
        ? getExpectedRepeatedJointSuffix(sourceRow, rejection.result, systemIndexSettings)
        : null
      const expectedTargetJoint = rejection
        ? getExpectedRepeatedJointName(sourceRow, candidate.sourceJoint, rejection.result, systemIndexSettings)
        : ''
      return expectedSuffix === candidate.suffix && normalizeJointChainPart(expectedTargetJoint) === normalizeJointChainPart(targetJoint)
    })
    if (validSource) return null
    for (const sourceRow of sourceRows) {
      const rejection = getPrimaryRejectedLnkResult(sourceRow)
      const expectedTargetJoint = rejection
        ? getExpectedRepeatedJointName(sourceRow, candidate.sourceJoint, rejection.result, systemIndexSettings)
        : ''
      obsoleteCandidates.push({
        row,
        sourceRow,
        sourceJoint: candidate.sourceJoint,
        targetJoint,
        expectedTargetJoint,
        suffix: candidate.suffix,
        reason: getObsoleteRepeatedJointReason(sourceRow, rejection, expectedTargetJoint, targetJoint),
      })
    }
  }
  const uniqueCandidates = [...new Map(
    obsoleteCandidates.map((candidate) => [candidate.sourceRow.id, candidate]),
  ).values()]
  return uniqueCandidates.length === 1 ? uniqueCandidates[0]! : null
}

function buildObsoleteRepeatedJointRenameTasks({
  blockedChainKeys,
  matchingJointRowsIndex,
  obsoleteInfos,
  rows,
  systemIndexSettings,
}: {
  blockedChainKeys: Set<string>
  matchingJointRowsIndex: MatchingJointRowsIndex
  obsoleteInfos: ObsoleteRepeatedJointInfo[]
  rows: WeldRow[]
  systemIndexSettings: SystemIndexSettings
}): RepeatedJointRenameTask[] {
  const potentialChildrenBySourceRowId = new Map<number, WeldRow[]>()
  const potentialSourceRowIdsByChildRowId = new Map<number, Set<number>>()
  for (const childRow of rows) {
    const childJoint = String(childRow.joint ?? '').trim()
    const parsed = parseRepeatedJointName(childJoint, systemIndexSettings)
    if (parsed.segments.length === 0) continue
    for (const candidate of getRepeatedJointSourceCandidates(parsed, systemIndexSettings)) {
      const matchingSourceRows = findMatchingJointRowsInIndex(
        matchingJointRowsIndex,
        childRow,
        candidate.sourceJoint,
      )
      const officialSourceRows = matchingSourceRows.filter((sourceRow) => !isUnofficialJoint(sourceRow))
      const preferredSourceRows = officialSourceRows.length > 0 ? officialSourceRows : matchingSourceRows
      for (const sourceRow of preferredSourceRows) {
        const children = potentialChildrenBySourceRowId.get(sourceRow.id) ?? []
        if (!children.some((row) => row.id === childRow.id)) children.push(childRow)
        potentialChildrenBySourceRowId.set(sourceRow.id, children)
        const sourceIds = potentialSourceRowIdsByChildRowId.get(childRow.id) ?? new Set<number>()
        sourceIds.add(sourceRow.id)
        potentialSourceRowIdsByChildRowId.set(childRow.id, sourceIds)
      }
    }
  }

  const tasks: RepeatedJointRenameTask[] = []
  const claimedRowIds = new Set<number>()
  const sortedInfos = [...obsoleteInfos].sort((left, right) =>
    compareJointChainRows(left.row, right.row, systemIndexSettings),
  )
  for (const info of sortedInfos) {
    if (claimedRowIds.has(info.row.id)) continue
    if (!info.expectedTargetJoint) continue
    if (normalizeJointChainPart(info.targetJoint) === normalizeJointChainPart(info.expectedTargetJoint)) continue
    if (hasRepeatedJointTarget(rows, info.sourceRow, info.expectedTargetJoint)) continue
    if (
      isRowInBlockedRepeatedJointChain(info.row, blockedChainKeys, systemIndexSettings) ||
      isRowInBlockedRepeatedJointChain(info.sourceRow, blockedChainKeys, systemIndexSettings)
    ) continue

    const sourceChildren = potentialChildrenBySourceRowId.get(info.sourceRow.id) ?? []
    if (sourceChildren.length !== 1 || sourceChildren[0]?.id !== info.row.id) continue
    const changes: RepeatedJointRenameTask['changes'] = []
    const visitedRowIds = new Set<number>()
    let currentRow: WeldRow | undefined = info.row
    let targetJoint = info.expectedTargetJoint
    let isSafePlan = true

    while (currentRow) {
      if (visitedRowIds.has(currentRow.id)) {
        isSafePlan = false
        break
      }
      visitedRowIds.add(currentRow.id)
      const currentJoint = String(currentRow.joint ?? '').trim()
      if (!currentJoint || !targetJoint || normalizeJointChainPart(currentJoint) === normalizeJointChainPart(targetJoint)) {
        isSafePlan = false
        break
      }
      changes.push({ rowId: currentRow.id, currentJoint, targetJoint })

      const children: WeldRow[] = potentialChildrenBySourceRowId.get(currentRow.id) ?? []
      if (children.length === 0) break
      if (children.length !== 1) {
        isSafePlan = false
        break
      }
      const childRow: WeldRow = children[0]!
      const childSourceRowIds = potentialSourceRowIdsByChildRowId.get(childRow.id) ?? new Set<number>()
      if (childSourceRowIds.size !== 1 || !childSourceRowIds.has(currentRow.id)) {
        isSafePlan = false
        break
      }
      const rejection = getPrimaryRejectedLnkResult(currentRow)
      if (!rejection) {
        isSafePlan = false
        break
      }
      targetJoint = getExpectedRepeatedJointName(
        currentRow,
        targetJoint,
        rejection.result,
        systemIndexSettings,
      )
      currentRow = childRow
    }

    if (!isSafePlan || changes.length === 0 || changes.some((change) => claimedRowIds.has(change.rowId))) continue
    const planRowIds = new Set(changes.map((change) => change.rowId))
    const uniqueTargets = new Set(changes.map((change) => normalizeJointChainPart(change.targetJoint)))
    if (uniqueTargets.size !== changes.length) continue
    const hasCollision = changes.some((change) =>
      findMatchingJointRowsInIndex(matchingJointRowsIndex, info.row, change.targetJoint)
        .some((row) => !planRowIds.has(row.id) && !isUnofficialJoint(row)),
    )
    if (hasCollision) continue

    changes.forEach((change) => claimedRowIds.add(change.rowId))
    tasks.push({
      kind: 'rename',
      key: `rename-obsolete:${info.sourceRow.id}:${changes.map((change) => `${change.rowId}:${change.currentJoint}:${change.targetJoint}`).join('|')}`,
      row: info.row,
      sourceRow: info.sourceRow,
      sourceJoint: info.sourceJoint,
      currentJoint: changes[0]!.currentJoint,
      targetJoint: changes[0]!.targetJoint,
      baseJoint: parseRepeatedJointName(changes[0]!.targetJoint, systemIndexSettings).base,
      changes,
    })
  }
  return tasks
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
