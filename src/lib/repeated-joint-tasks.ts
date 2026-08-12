import { type WeldInput } from '@/lib/weld-fields'
import { getJointStatusLabel } from '@/lib/lnk-status'
import { normalizeSearchText } from '@/lib/report-row-utils'
import { hasWeldDate } from '@/lib/report-value-utils'
import { formatDisplayDate } from '@/lib/date-format'
import {
  formatRepeatedJointName,
  getCoilJointNames,
  normalizeJointChainPart,
  parseRepeatedJointName,
} from '@/lib/joint-chain'
import { getJointChainIdentity, isUnofficialJoint } from '@/lib/joint-display'
import { getJointChainConsistencyKey } from '@/lib/joint-chain-keys'
import {
  buildControlHistoryCheckTasks,
  buildForbiddenRepairByDiameterCheckTasks,
  buildIncompleteWelderStampGroupTasks,
  buildJointCoreDataCheckTasks,
  buildLnkChronologyCheckTasks,
  buildLnkResultCompletenessCheckTasks,
  buildPstoChronologyCheckTasks,
  buildPstoResultCompletenessCheckTasks,
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
import {
  getExpectedRepeatedJointName,
  getExpectedRepeatedJointSuffix,
  getOfficialRejectedJointChainRows,
  getPrimaryRejectedLnkResult,
  getRepeatedJointSourceCandidates,
  hasRepeatedJointTarget,
  isUnusedRepeatedJointDraft,
} from '@/lib/repeated-joint-task-helpers'
import { getRepeatedJointIdentity } from '@/lib/repeated-joint-row-utils'
import type { RepeatedJointRenameTask, RepeatedJointTask, WeldRow } from '@/lib/dispatcher-types'
import type { WelderStampRecord, WelderStampSuspensionRecord } from '@/lib/welder-stamp-types'
import type { DataListSettings } from '@/lib/data-list-settings'
import { DEFAULT_SAVE_CHECK_SETTINGS, type SaveCheckSettings } from '@/lib/save-check-settings'
import { DEFAULT_SYSTEM_INDEX_SETTINGS, type SystemIndexSettings } from '@/lib/system-index-settings'

export { getJointChainConsistencyKey } from '@/lib/joint-chain-keys'
export { isUnusedRepeatedJointDraft } from '@/lib/repeated-joint-task-helpers'

type ObsoleteRepeatedJointInfo = {
  sourceRow: WeldRow
  sourceJoint: string
  targetJoint: string
  expectedTargetJoint: string
  suffix: 'R' | 'W'
  reason: string
}

type MatchingJointRowsIndex = Map<string, WeldRow[]>

type BuildRepeatedJointTasksOptions = {
  dataListSettings?: DataListSettings
  saveCheckSettings?: SaveCheckSettings
  systemIndexSettings?: SystemIndexSettings
  includeControlHistoryChecks?: boolean
  includeIncompleteStampChecks?: boolean
  includeJointCoreDataChecks?: boolean
  includeLineConsistencyTasks?: boolean
  includeLnkResultCompletenessChecks?: boolean
  includePercentageLineControlTasks?: boolean
  includePstoResultCompletenessChecks?: boolean
  includeWelderStampCompatibilityChecks?: boolean
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
  const getConfiguredOfficialRejectedJointChainRows = (
    sourceRows: WeldRow[],
    sourceRow: WeldInput,
    sourceJoint: string,
  ) => getOfficialRejectedJointChainRows(sourceRows, sourceRow, sourceJoint, systemIndexSettings)
  const tasks: RepeatedJointTask[] = []
  const orphanGoodRenameTasks = buildOrphanGoodRepeatedJointRenameTasks(rows, systemIndexSettings)
  const orphanGoodRenameRowIds = new Set(orphanGoodRenameTasks.map((task) => task.row.id))
  const chainCheckTasks = [
    ...buildJointChainConsistencyCheckTasks(
      rows,
      { getPrimaryRejectedLnkResult, getOfficialRejectedJointChainRows: getConfiguredOfficialRejectedJointChainRows },
      systemIndexSettings,
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
          options.saveCheckSettings ?? DEFAULT_SAVE_CHECK_SETTINGS,
          systemIndexSettings,
        )
      : []),
    ...(includeIncompleteStampChecks ? buildIncompleteWelderStampGroupTasks(rows, systemIndexSettings) : []),
  ].filter((task) => !(task.reason === 'проверить целостность цепочки' && orphanGoodRenameRowIds.has(task.row.id)))
  const duplicateCheckTasks = buildDuplicateJointCheckTasks(rows, systemIndexSettings)
  const lineConsistencyTasks = includeLineConsistencyTasks ? buildLineConsistencyTasks(rows) : []
  const percentageLineControlTasks = includePercentageLineControlTasks
    ? buildPercentageLineControlTasks(rows, welderStampSuspensions)
    : []
  const matchingJointRowsIndex = buildMatchingJointRowsIndex(rows)
  const blockedChainKeys = new Set(
    [
      ...chainCheckTasks.filter(isBlockingRepeatedJointCheckTask),
      ...duplicateCheckTasks,
    ].map((task) => getJointChainConsistencyKey(task.row, systemIndexSettings)).filter(Boolean) as string[],
  )
  const obsoleteByRowId = new Map<number, ObsoleteRepeatedJointInfo>()
  for (const row of rows) {
    const repeated = getObsoleteRepeatedJointInfo(matchingJointRowsIndex, row, systemIndexSettings)
    if (repeated) obsoleteByRowId.set(row.id, repeated)
  }
  const directObsoleteInfos = Array.from(obsoleteByRowId.values())
  for (const row of rows) {
    if (obsoleteByRowId.has(row.id)) continue
    const repeated = getPropagatedObsoleteRepeatedJointInfo(row, directObsoleteInfos, systemIndexSettings)
    if (repeated) obsoleteByRowId.set(row.id, repeated)
  }
  const createTaskTargetKeys = new Set<string>()

  for (const row of rows) {
    if (obsoleteByRowId.has(row.id)) continue
    if (isRowInBlockedRepeatedJointChain(row, blockedChainKeys, systemIndexSettings)) continue
    const rejection = getPrimaryRejectedLnkResult(row)
    if (!rejection) continue
    const sourceJoint = String(row.joint ?? '').trim()
    if (!sourceJoint) continue
    if (hasCompletedParentBranch(rows, row, sourceJoint, systemIndexSettings)) continue

    const suffix = getExpectedRepeatedJointSuffix(row, rejection.result)
    const parsed = parseRepeatedJointName(sourceJoint, systemIndexSettings)
    const officialRejectedChainRows = getOfficialRejectedJointChainRows(rows, row, sourceJoint, systemIndexSettings)
    const lastOfficialRejectedRow = officialRejectedChainRows.at(-1)
    if (!isUnofficialJoint(row) && officialRejectedChainRows.length > 3 && lastOfficialRejectedRow?.id === row.id) {
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
      })
      continue
    }

    const targetJoint = getExpectedRepeatedJointName(row, sourceJoint, rejection.result, systemIndexSettings)
    if (hasRepeatedJointTarget(rows, row, targetJoint)) continue
    const createTargetKey = getCreateTaskTargetKey(row, targetJoint)
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
  const checkTaskChainKeys = new Set<string>()
  for (const row of rows) {
    const repeated = obsoleteByRowId.get(row.id)
    if (!repeated) continue
    if (isRowInBlockedRepeatedJointChain(row, blockedChainKeys, systemIndexSettings)) continue
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
        baseJoint: parseRepeatedJointName(repeated.expectedTargetJoint, systemIndexSettings).base,
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
    })
  }
  return tasks
}

function getCreateTaskTargetKey(row: WeldInput, targetJoint: string) {
  const identity = getRepeatedJointIdentity(row, targetJoint)
  if (!identity) return null
  return `${identity.project}:${identity.subtitle}:${identity.line}:${identity.joint}`
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
  let obsoleteCandidate: ObsoleteRepeatedJointInfo | null = null
  for (const candidate of getRepeatedJointSourceCandidates(parsed, systemIndexSettings)) {
    const sourceRows = findMatchingJointRowsInIndex(index, row, candidate.sourceJoint)
    if (sourceRows.length === 0) continue
    const validSource = sourceRows.find((sourceRow) => {
      const rejection = getPrimaryRejectedLnkResult(sourceRow)
      const expectedSuffix = rejection ? (rejection.result === 'ремонт' ? 'R' : 'W') : null
      const expectedTargetJoint = rejection
        ? getExpectedRepeatedJointName(sourceRow, candidate.sourceJoint, rejection.result, systemIndexSettings)
        : ''
      return expectedSuffix === candidate.suffix && normalizeJointChainPart(expectedTargetJoint) === normalizeJointChainPart(targetJoint)
    })
    if (validSource) return null
    const sourceRow = sourceRows[0]
    const rejection = getPrimaryRejectedLnkResult(sourceRow)
    const expectedTargetJoint = rejection
      ? getExpectedRepeatedJointName(sourceRow, candidate.sourceJoint, rejection.result, systemIndexSettings)
      : ''
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

function getPropagatedObsoleteRepeatedJointInfo(
  row: WeldRow,
  directObsoleteInfos: ObsoleteRepeatedJointInfo[],
  systemIndexSettings: SystemIndexSettings,
): ObsoleteRepeatedJointInfo | null {
  const targetJoint = String(row.joint ?? '').trim()
  const parsed = parseRepeatedJointName(targetJoint, systemIndexSettings)
  if (parsed.segments.length === 0) return null

  for (const direct of directObsoleteInfos) {
    if (!direct.expectedTargetJoint) continue
    if (normalizeJointChainPart(direct.targetJoint) === normalizeJointChainPart(targetJoint)) continue
    if (!isSameRepeatedJointLine(row, direct.sourceRow)) continue

    const directTarget = parseRepeatedJointName(direct.targetJoint, systemIndexSettings)
    const directExpected = parseRepeatedJointName(direct.expectedTargetJoint, systemIndexSettings)
    if (directTarget.segments.length === 0) continue
    if (normalizeJointChainPart(parsed.base) !== normalizeJointChainPart(directTarget.base)) continue

    const changedSegmentIndex = directTarget.segments.length - 1
    if (parsed.segments.length <= changedSegmentIndex) continue

    const hasSamePrefixBeforeChangedSegment = directTarget.segments
      .slice(0, changedSegmentIndex)
      .every((segment, index) => {
        const currentSegment = parsed.segments[index]
        return currentSegment?.suffix === segment.suffix && currentSegment.index === segment.index
      })
    if (!hasSamePrefixBeforeChangedSegment) continue

    const changedSegment = directTarget.segments[changedSegmentIndex]
    const currentSegment = parsed.segments[changedSegmentIndex]
    if (!currentSegment || currentSegment.suffix !== changedSegment.suffix || currentSegment.index < changedSegment.index) continue

    const expectedTargetJoint = formatRepeatedJointName(directExpected.base, [
      ...directExpected.segments,
      ...parsed.segments.slice(changedSegmentIndex),
    ], systemIndexSettings)
    if (normalizeJointChainPart(expectedTargetJoint) === normalizeJointChainPart(targetJoint)) continue

    return {
      sourceRow: direct.sourceRow,
      sourceJoint: direct.sourceJoint,
      targetJoint,
      expectedTargetJoint,
      suffix: direct.suffix,
      reason: `Стык ${targetJoint} продолжает цепочку стыка ${direct.targetJoint}, который должен быть переименован в ${direct.expectedTargetJoint}. Поэтому продолжение цепочки тоже нужно переименовать.`,
    }
  }

  return null
}

function isSameRepeatedJointLine(row: WeldInput, sourceRow: WeldInput) {
  return (
    normalizeSearchText(row.projectTitle) === normalizeSearchText(sourceRow.projectTitle) &&
    normalizeSearchText(row.subtitleCode) === normalizeSearchText(sourceRow.subtitleCode) &&
    normalizeSearchText(row.line) === normalizeSearchText(sourceRow.line)
  )
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
