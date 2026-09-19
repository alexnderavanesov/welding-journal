import { getDispatcherTaskSettingId } from '@/lib/dispatcher-settings'
import type {
  RepeatedJointRenameChange,
  RepeatedJointRenameTask,
  RepeatedJointTask,
  WeldRow,
} from '@/lib/dispatcher-types'
import { getJointChainConsistencyKey } from '@/lib/joint-chain-keys'
import {
  buildJointCoilTransitions,
  type JointCoilTransition,
} from '@/lib/joint-chain-transitions'
import { hasRejectedLnkResult } from '@/lib/lnk-status'
import { buildRepeatedJointTasks } from '@/lib/repeated-joint-tasks'
import { getOfficialRejectedJointChainRows } from '@/lib/repeated-joint-task-helpers'
import {
  DEFAULT_SYSTEM_INDEX_SETTINGS,
  type SystemIndexSettings,
} from '@/lib/system-index-settings'

export type LnkOfficialityValue = 'official' | 'unofficial'

export type LnkOfficialityChangeTarget = {
  id: number
  version: string
}

export type LnkOfficialityChangeRequest = {
  targets: LnkOfficialityChangeTarget[]
  officiality: LnkOfficialityValue
  expectedPlanKey?: string
}

export type LnkOfficialityChangeResult = {
  plan: LnkOfficialityChainPlan
  savedRows: WeldRow[]
}

export type LnkOfficialityChange = {
  rowId: number
  joint: string
  previousOfficiality: 'official' | 'unofficial'
  nextOfficiality: LnkOfficialityValue
}

export type LnkOfficialityEarlyCoilDecision = {
  sourceRowId: number
  sourceJoint: string
  targetJoints: [string, string]
}

export type LnkOfficialityChainPlan = {
  officiality: LnkOfficialityValue
  officialityChanges: LnkOfficialityChange[]
  renames: RepeatedJointRenameChange[]
  earlyCoilDecisions: LnkOfficialityEarlyCoilDecision[]
  affectedRowIds: number[]
  planKey: string
}

type BuildLnkOfficialityChainPlanOptions = {
  earlyCoilDecisionSourceRowIds?: ReadonlySet<number>
  systemIndexSettings?: SystemIndexSettings
}

const TASK_OPTIONS = {
  includeControlHistoryChecks: false,
  includeIncompleteStampChecks: false,
  includeJointCoreDataChecks: false,
  includeLineConsistencyTasks: false,
  includeLnkResultCompletenessChecks: false,
  includePercentageLineControlTasks: false,
  includePstoResultCompletenessChecks: false,
  includeWelderStampCompatibilityChecks: false,
} as const

export function buildLnkOfficialityChainPlan(
  rows: readonly WeldRow[],
  targetRowIds: readonly number[],
  officiality: LnkOfficialityValue,
  options: BuildLnkOfficialityChainPlanOptions = {},
): LnkOfficialityChainPlan {
  const settings = options.systemIndexSettings ?? DEFAULT_SYSTEM_INDEX_SETTINGS
  const earlyCoilDecisionSourceRowIds = options.earlyCoilDecisionSourceRowIds ?? new Set<number>()
  const normalizedTargetIds = normalizeTargetRowIds(targetRowIds)
  const rowsById = new Map(rows.map((row) => [row.id, row]))
  const targetRows = normalizedTargetIds.map((rowId) => {
    const row = rowsById.get(rowId)
    if (!row) throw new Error('Один или несколько выбранных стыков больше не существуют. Обновите отчет.')
    return row
  })
  const officialityChanges = targetRows.flatMap((row): LnkOfficialityChange[] => {
    const previousOfficiality = isUnofficial(row) ? 'unofficial' : 'official'
    if (previousOfficiality === officiality) return []
    if (officiality === 'unofficial' && !hasRejectedLnkResult(row)) {
      throw new Error(
        `Стык ${formatJoint(row)} нельзя сделать неофициальным: нужен результат контроля «ремонт» или «вырез».`,
      )
    }
    return [{
      rowId: row.id,
      joint: formatJoint(row),
      previousOfficiality,
      nextOfficiality: officiality,
    }]
  })
  if (officialityChanges.length === 0) {
    throw new Error('Выбранные стыки уже имеют такую официальность.')
  }

  const changedRows = officialityChanges.map((change) => rowsById.get(change.rowId)!)
  assertOneOfficialityChangePerChain(changedRows, settings)
  const affectedChainKeys = new Set(
    changedRows.map((row) => getJointChainConsistencyKey(row, settings)).filter(Boolean) as string[],
  )
  assertAffectedChainsDoNotAlreadyRequireRename(
    rows,
    affectedChainKeys,
    earlyCoilDecisionSourceRowIds,
    settings,
  )
  const initialRowsById = new Map(rows.map((row) => [row.id, row]))
  const beforeTransitions = buildJointCoilTransitions([...rows], {
    earlyCoilDecisionSourceRowIds,
    systemIndexSettings: settings,
  }).filter((transition) => isTransitionInAffectedChain(
    transition,
    initialRowsById,
    affectedChainKeys,
    settings,
  ))
  assertChangedRowsAreNotCoilSources(changedRows, beforeTransitions)

  const officialityChangesByRowId = new Map(
    officialityChanges.map((change) => [change.rowId, change]),
  )
  let workingRows = rows.map((row) => {
    if (!officialityChangesByRowId.has(row.id)) return row
    return {
      ...row,
      officiality: officiality === 'unofficial' ? 'неофициальный' : null,
    }
  })
  const renameByRowId = new Map<number, RepeatedJointRenameChange>()

  for (let pass = 0; pass <= workingRows.length; pass += 1) {
    const tasks = buildPlanTasks(workingRows, earlyCoilDecisionSourceRowIds, settings)
    const renameTasks = tasks.filter(
      (task): task is RepeatedJointRenameTask => (
        task.kind === 'rename' && isTaskInAffectedChain(task, affectedChainKeys, settings)
      ),
    )
    if (renameTasks.length === 0) break
    if (pass === workingRows.length) {
      throw new Error('Не удалось однозначно завершить пересчет названий цепочки.')
    }
    const changes = renameTasks.flatMap((task) => task.changes)
    const currentRowsById = new Map(workingRows.map((row) => [row.id, row]))
    assertNonConflictingRenameChanges(changes, currentRowsById, settings)
    for (const change of changes) {
      const currentRow = currentRowsById.get(change.rowId)
      if (!currentRow || normalize(currentRow.joint) !== normalize(change.currentJoint)) {
        throw new Error('Цепочка изменилась во время расчета. Обновите отчет и повторите действие.')
      }
      const previousChange = renameByRowId.get(change.rowId)
      renameByRowId.set(change.rowId, {
        rowId: change.rowId,
        currentJoint: previousChange?.currentJoint ?? change.currentJoint,
        targetJoint: change.targetJoint,
      })
    }
    const targetsById = new Map(changes.map((change) => [change.rowId, change.targetJoint]))
    workingRows = workingRows.map((row) => {
      const targetJoint = targetsById.get(row.id)
      return targetJoint ? { ...row, joint: targetJoint } : row
    })
  }

  const earlyCoilDecisions = buildRequiredEarlyCoilDecisions({
    beforeTransitions,
    earlyCoilDecisionSourceRowIds,
    rows: workingRows,
    settings,
  })
  const finalEarlyCoilDecisionSourceRowIds = new Set([
    ...earlyCoilDecisionSourceRowIds,
    ...earlyCoilDecisions.map((decision) => decision.sourceRowId),
  ])
  assertFinalChainIsSafe(
    workingRows,
    affectedChainKeys,
    finalEarlyCoilDecisionSourceRowIds,
    settings,
  )

  const renames = [...renameByRowId.values()].filter(
    (change) => normalize(change.currentJoint) !== normalize(change.targetJoint),
  )
  const affectedRowIds = [...new Set([
    ...officialityChanges.map((change) => change.rowId),
    ...renames.map((change) => change.rowId),
    ...earlyCoilDecisions.map((decision) => decision.sourceRowId),
  ])].sort((left, right) => left - right)
  const planBody = {
    officiality,
    officialityChanges: officialityChanges.map(({ rowId, previousOfficiality, nextOfficiality }) => ({
      rowId,
      previousOfficiality,
      nextOfficiality,
    })),
    renames,
    earlyCoilDecisions,
  }

  return {
    officiality,
    officialityChanges,
    renames,
    earlyCoilDecisions,
    affectedRowIds,
    planKey: JSON.stringify(planBody),
  }
}

function buildPlanTasks(
  rows: WeldRow[],
  earlyCoilDecisionSourceRowIds: ReadonlySet<number>,
  settings: SystemIndexSettings,
) {
  return buildRepeatedJointTasks(rows, [], [], {
    ...TASK_OPTIONS,
    earlyCoilDecisionSourceRowIds,
    systemIndexSettings: settings,
  })
}

function buildRequiredEarlyCoilDecisions({
  beforeTransitions,
  earlyCoilDecisionSourceRowIds,
  rows,
  settings,
}: {
  beforeTransitions: readonly JointCoilTransition[]
  earlyCoilDecisionSourceRowIds: ReadonlySet<number>
  rows: WeldRow[]
  settings: SystemIndexSettings
}) {
  const afterTransitions = buildJointCoilTransitions(rows, {
    earlyCoilDecisionSourceRowIds,
    systemIndexSettings: settings,
  })
  const rowsById = new Map(rows.map((row) => [row.id, row]))
  const decisions: LnkOfficialityEarlyCoilDecision[] = []

  for (const before of beforeTransitions) {
    if (before.mode !== 'limit' || before.targetRowIds.some((rowId) => rowId === null)) continue
    const after = afterTransitions.find((transition) => transition.key === before.key)
    if (!after || after.mode !== null || after.targetRowIds.some((rowId) => rowId === null)) continue
    const anchor = after.targetRowIds.map((rowId) => rowId ? rowsById.get(rowId) : undefined).find(Boolean)
    if (!anchor) throw new Error(`Не удалось проверить катушку ${after.targetJoints.join(' + ')}.`)
    const sourceRow = getOfficialRejectedJointChainRows(
      rows,
      anchor,
      after.parentBranchJoint,
      settings,
    ).at(-1)
    if (!sourceRow) {
      throw new Error(
        `После смены официальности катушка ${after.targetJoints.join(' + ')} потеряет допустимое основание. Изменение остановлено.`,
      )
    }
    decisions.push({
      sourceRowId: sourceRow.id,
      sourceJoint: formatJoint(sourceRow),
      targetJoints: after.targetJoints,
    })
  }
  return [...new Map(decisions.map((decision) => [decision.sourceRowId, decision])).values()]
}

function assertFinalChainIsSafe(
  rows: WeldRow[],
  affectedChainKeys: ReadonlySet<string>,
  earlyCoilDecisionSourceRowIds: ReadonlySet<number>,
  settings: SystemIndexSettings,
) {
  const transitions = buildJointCoilTransitions(rows, {
    earlyCoilDecisionSourceRowIds,
    systemIndexSettings: settings,
  })
  const rowsById = new Map(rows.map((row) => [row.id, row]))
  const affectedTransitions = transitions.filter((transition) => isTransitionInAffectedChain(
    transition,
    rowsById,
    affectedChainKeys,
    settings,
  ))
  const invalidCoil = affectedTransitions.find(
    (transition) => transition.targetRowIds.some((rowId) => rowId !== null) && (
      transition.targetRowIds.some((rowId) => rowId === null) || transition.mode === null
    ),
  )
  if (invalidCoil) {
    throw new Error(
      `Катушка ${invalidCoil.targetJoints.join(' + ')} создана не полностью или больше не соответствует цепочке. ` +
      'Сначала откройте картину стыка и проверьте катушку.',
    )
  }

  const blockingTask = buildPlanTasks(rows, earlyCoilDecisionSourceRowIds, settings).find((task) => (
    isTaskInAffectedChain(task, affectedChainKeys, settings) && isOfficialityPlanBlockingTask(task)
  ))
  if (!blockingTask) return
  if (blockingTask.kind === 'duplicate-check') {
    throw new Error(
      `В цепочке найдено несколько официальных стыков ${blockingTask.sourceJoint}. ` +
      'Сначала определите единственный актуальный официальный стык.',
    )
  }
  if (blockingTask.kind === 'delete') {
    throw new Error(
      `После изменения стык ${blockingTask.targetJoint} станет лишним. ` +
      'Сначала откройте картину стыка и проверьте его данные.',
    )
  }
  if (blockingTask.kind === 'rename') {
    throw new Error('Не удалось полностью пересчитать продолжение цепочки. Обновите картину стыка.')
  }
  if (blockingTask.kind === 'check') {
    throw new Error(blockingTask.details || 'После изменения цепочка останется неоднозначной. Проверьте картину стыка.')
  }
}

function isTransitionInAffectedChain(
  transition: JointCoilTransition,
  rowsById: ReadonlyMap<number, WeldRow>,
  affectedChainKeys: ReadonlySet<string>,
  settings: SystemIndexSettings,
) {
  const rowIds = [transition.sourceRowId, ...transition.targetRowIds]
  return rowIds.some((rowId) => {
    const row = rowId ? rowsById.get(rowId) : undefined
    return Boolean(row && affectedChainKeys.has(getJointChainConsistencyKey(row, settings) ?? ''))
  })
}

function isOfficialityPlanBlockingTask(task: RepeatedJointTask) {
  if (task.kind === 'duplicate-check' || task.kind === 'delete' || task.kind === 'rename') return true
  if (task.kind !== 'check') return false
  if (task.systemWarningCode) return false
  const settingId = getDispatcherTaskSettingId(task)
  return settingId === 'chain-consistency' ||
    settingId === 'chain-duplicate' ||
    settingId === 'chain-date-order' ||
    settingId === 'repeated-obsolete-check'
}

function assertChangedRowsAreNotCoilSources(
  changedRows: readonly WeldRow[],
  transitions: readonly JointCoilTransition[],
) {
  const changedToUnofficialIds = new Set(
    changedRows.filter((row) => !isUnofficial(row)).map((row) => row.id),
  )
  const directTransition = transitions.find((transition) => (
    transition.sourceRowId !== null &&
    changedToUnofficialIds.has(transition.sourceRowId) &&
    transition.targetRowIds.some((rowId) => rowId !== null)
  ))
  if (!directTransition) return
  throw new Error(
    `Стык ${directTransition.sourceJoint} является непосредственным основанием катушки ` +
    `${directTransition.targetJoints.join(' + ')}. Сначала нужно отдельно решить судьбу катушки; ` +
    'система не будет создавать отсутствующий физический стык автоматически.',
  )
}

function assertAffectedChainsDoNotAlreadyRequireRename(
  rows: readonly WeldRow[],
  affectedChainKeys: ReadonlySet<string>,
  earlyCoilDecisionSourceRowIds: ReadonlySet<number>,
  settings: SystemIndexSettings,
) {
  const existingRename = buildPlanTasks(
    [...rows],
    earlyCoilDecisionSourceRowIds,
    settings,
  ).find((task): task is RepeatedJointRenameTask => (
    task.kind === 'rename' && isTaskInAffectedChain(task, affectedChainKeys, settings)
  ))
  if (!existingRename) return
  throw new Error(
    `Цепочка уже требует отдельного переименования ${existingRename.currentJoint} -> ${existingRename.targetJoint}. ` +
    'Сначала выполните эту задачу и снова откройте картину стыка.',
  )
}

function assertOneOfficialityChangePerChain(rows: readonly WeldRow[], settings: SystemIndexSettings) {
  const seen = new Set<string>()
  for (const row of rows) {
    const key = getJointChainConsistencyKey(row, settings) ?? `row:${row.id}`
    if (seen.has(key)) {
      throw new Error(
        'В одной операции можно изменить только один стык каждой цепочки. ' +
        'Измените взаимосвязанные стыки последовательно, проверяя картину после каждого шага.',
      )
    }
    seen.add(key)
  }
}

function assertNonConflictingRenameChanges(
  changes: readonly RepeatedJointRenameChange[],
  rowsById: ReadonlyMap<number, WeldRow>,
  settings: SystemIndexSettings,
) {
  const rowIds = new Set<number>()
  const targets = new Set<string>()
  for (const change of changes) {
    const row = rowsById.get(change.rowId)
    const chainKey = row ? getJointChainConsistencyKey(row, settings) : null
    const target = `${chainKey ?? `row:${change.rowId}`}\u0000${normalize(change.targetJoint)}`
    if (rowIds.has(change.rowId) || targets.has(target)) {
      throw new Error('Продолжение цепочки имеет развилку или конфликтующие названия. Автоматическое изменение остановлено.')
    }
    rowIds.add(change.rowId)
    targets.add(target)
  }
}

function isTaskInAffectedChain(
  task: RepeatedJointTask,
  affectedChainKeys: ReadonlySet<string>,
  settings: SystemIndexSettings,
) {
  return affectedChainKeys.has(getJointChainConsistencyKey(task.row, settings) ?? '')
}

function normalizeTargetRowIds(rowIds: readonly number[]) {
  const result = [...new Set(rowIds.map(Number))]
  if (
    result.length === 0 ||
    result.length !== rowIds.length ||
    result.some((rowId) => !Number.isInteger(rowId) || rowId <= 0)
  ) {
    throw new Error('Некорректный список стыков для изменения официальности.')
  }
  return result
}

function isUnofficial(row: WeldRow) {
  return String(row.officiality ?? '').trim().toLowerCase() === 'неофициальный'
}

function formatJoint(row: WeldRow) {
  return String(row.joint ?? '').trim() || `ID ${row.id}`
}

function normalize(value: unknown) {
  return String(value ?? '').replace(/\s+/g, '').trim().toLowerCase()
}
