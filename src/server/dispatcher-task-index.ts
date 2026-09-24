import { and, asc, desc, eq, inArray, or, sql, type SQLWrapper } from 'drizzle-orm'
import { requireDb } from '@/db'
import {
  appSettings,
  dispatcherAcceptedWarnings,
  dispatcherBackgroundRowTasks,
  dispatcherBackgroundTaskIndexState,
  dispatcherRowTasks,
  dispatcherTaskPages,
  dispatcherTaskIndexState,
  duplicateControls,
  welderStampSuspensions,
  welderStamps,
  weldJoints,
  type AppSetting,
  type DuplicateControl,
  type WelderStamp,
  type WelderStampSuspension,
} from '@/db/schema'
import {
  DEFAULT_DISPATCHER_REMINDER_SETTINGS,
  DEFAULT_DISPATCHER_SETTINGS,
  normalizeDispatcherReminderSettings,
  normalizeDispatcherSettings,
  type DispatcherSettings,
} from '@/lib/dispatcher-settings'
import { buildVisibleDispatcherTasks } from '@/lib/dispatcher-task-builder'
import {
  buildDispatcherTaskCodeIndexRows,
  compareDispatcherTaskCodes,
  type DispatcherTaskIndexRow,
} from '@/lib/dispatcher-task-row-codes'
import {
  isDispatcherTaskIndexPayloadCurrent,
  parseDispatcherTaskIndexPayload,
  serializeDispatcherTaskIndexPayload,
} from '@/lib/dispatcher-task-index-payload'
import type { RepeatedJointTask, WeldRow, WelderStampExpiryTask } from '@/lib/dispatcher-types'
import { buildJointChainContinuations } from '@/lib/joint-chain-continuations'
import { getEarlyCoilDecisionSourceRowIds } from '@/lib/early-coil-decision'
import type { DuplicateControlRecord } from '@/lib/duplicate-control-types'
import { PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'
import { DEFAULT_DATA_LIST_SETTINGS, normalizeDataListSettings } from '@/lib/data-list-settings'
import { DEFAULT_SYSTEM_INDEX_SETTINGS, normalizeSystemIndexSettings } from '@/lib/system-index-settings'
import { prepareReportRows, prepareReportRowsInPlace } from '@/lib/use-report-rows'
import type {
  WelderStampDlsPermit,
  WelderStampNaksPermit,
  WelderStampRecord,
  WelderStampSuspensionRecord,
} from '@/lib/welder-stamp-types'
import {
  DISPATCHER_BACKGROUND_INDEX_LOCK_ID,
  DISPATCHER_BACKGROUND_INDEX_STATE_ID,
  DISPATCHER_INDEX_LOCK_ID,
  DISPATCHER_INDEX_STATE_ID,
  DISPATCHER_REFRESH_LOCK_ID,
} from '@/server/dispatcher-task-index-constants'
import {
  invalidateDerivedCalculationCache,
  markDispatcherTaskIndexDirty,
} from '@/server/dispatcher-task-index-dirty'
import { getBusinessDateIso } from '@/lib/business-date'
import type { DispatcherDirtyScope } from '@/server/dispatcher-task-index-dirty'
import {
  attachHeatTreatmentControlRelations,
  attachHeatTreatmentControlRelationsInPlace,
} from '@/server/heat-treatment-control-relations'
import { lockWelderStampRegistry } from '@/server/welder-stamp-registry-lock'
import { encodeIdentityKey } from '@/lib/identity-key'
import { WELD_EFFECTIVE_OFFICIALITY } from '@/server/weld-server-shared'
import { buildNumberArrayMatch } from '@/server/weld-request-utils'
import {
  DEFAULT_CONTROL_PROCESS_SETTINGS,
  normalizeControlProcessSettings,
} from '@/lib/control-process-settings'
import {
  createDispatcherTaskIndexStage,
  createDispatcherTaskIndexStageWriter,
  createDispatcherTaskPageStage,
  createDispatcherTaskPageStageWriter,
  getDispatcherTaskIndexStageTable,
  getDispatcherTaskPageStageTable,
} from '@/server/dispatcher-task-index-staging'
import { persistCalculatedFinalStatuses } from '@/server/final-status-persistence'

export { getFinalStatusPersistenceChanges } from '@/server/final-status-persistence'

export const DISPATCHER_TASK_SNAPSHOT_LIMIT = 5_000
const MAX_SCOPED_REBUILD_SCOPES = 500
type DispatcherIndexTransaction = Parameters<Parameters<ReturnType<typeof requireDb>['transaction']>[0]>[0]
let pendingDispatcherTaskIndexRefresh: Promise<typeof dispatcherTaskIndexState.$inferSelect> | null = null

export type DispatcherTaskIndexSnapshot = {
  duplicateKeys: string[]
  repeatedJointTasks: RepeatedJointTask[]
  taskFilterOptions: Array<{ value: string; count: number; label: string }>
  welderStampExpiryTasks: WelderStampExpiryTask[]
  repeatedJointTaskCount: number
  repeatedJointTaskPageCount: number
  repeatedJointTasksTruncated: boolean
  sourceRevision: number
  computedRevision: number
  isFresh: boolean
  computedAt: string
}

export async function getDispatcherTaskIndexSnapshot(
  options: { ensureFresh?: boolean; scheduleRefresh?: boolean } = {},
): Promise<DispatcherTaskIndexSnapshot> {
  const db = requireDb()
  const state = options.ensureFresh
    ? await ensureDispatcherTaskIndexFresh()
    : await readDispatcherTaskIndexState({ scheduleRefresh: options.scheduleRefresh })

  const taskPayload = parseDispatcherTaskIndexPayload(state.repeatedTasks)
  const repeatedJointTasks = taskPayload.tasks
  const welderStampExpiryTasks = parseJsonArray<WelderStampExpiryTask>(state.welderStampExpiryTasks)
  const taskFilterOptions = await listDispatcherTaskFilterOptions(db, taskPayload)

  return {
    duplicateKeys: parseJsonArray<string>(state.duplicateKeys),
    repeatedJointTasks,
    repeatedJointTaskCount: taskPayload.totalTaskCount,
    repeatedJointTaskPageCount: taskPayload.totalPageCount,
    repeatedJointTasksTruncated: taskPayload.tasksTruncated,
    sourceRevision: state.sourceRevision,
    computedRevision: state.computedRevision,
    isFresh: isDispatcherTaskIndexFresh(state),
    taskFilterOptions,
    welderStampExpiryTasks,
    computedAt: state.computedAt?.toISOString() ?? new Date(0).toISOString(),
  }
}

export { markDispatcherTaskIndexDirty }

export async function ensureDispatcherTaskIndexFresh() {
  if (pendingDispatcherTaskIndexRefresh) return pendingDispatcherTaskIndexRefresh
  const pending = ensureDispatcherTaskIndexFreshOnce()
  pendingDispatcherTaskIndexRefresh = pending
  try {
    return await pending
  } catch (error) {
    // Report once per coalesced calculation, even if all HTTP callers left.
    console.error('Не удалось выполнить пересчет индекса диспетчера.', error)
    throw error
  } finally {
    if (pendingDispatcherTaskIndexRefresh === pending) pendingDispatcherTaskIndexRefresh = null
  }
}

export async function readDispatcherTaskIndexState(
  options: { scheduleRefresh?: boolean } = {},
) {
  const state = await ensureAndReadDispatcherTaskIndexState()
  if (!isDispatcherTaskIndexFresh(state) && options.scheduleRefresh !== false) {
    scheduleDispatcherTaskIndexRefresh()
  }
  return state
}

export function scheduleDispatcherTaskIndexRefresh() {
  if (pendingDispatcherTaskIndexRefresh) return
  // The shared calculation reports real failures itself, including detached work.
  void ensureDispatcherTaskIndexFresh().catch(() => {})
}

async function ensureDispatcherTaskIndexFreshOnce(
  retryFullRebuild = true,
): Promise<typeof dispatcherTaskIndexState.$inferSelect> {
  const db = requireDb()
  let state = await ensureAndReadDispatcherTaskIndexState()

  if (isDispatcherTaskIndexFresh(state)) return state

  state = await db.transaction(async (tx) => {
    // This lock coalesces expensive refreshes across application processes, but
    // deliberately does not block saves that only invalidate the index.
    await tx.execute(sql`select pg_advisory_xact_lock(${DISPATCHER_REFRESH_LOCK_ID})`)
    const [refreshState] = await tx
      .select()
      .from(dispatcherTaskIndexState)
      .where(eq(dispatcherTaskIndexState.id, DISPATCHER_INDEX_STATE_ID))
      .limit(1)
    if (!refreshState) throw new Error('Не удалось получить состояние расчета диспетчера.')
    if (isDispatcherTaskIndexFresh(refreshState)) return refreshState

    const dirtyScopes = getScopedDispatcherDirtyScopes(refreshState)
    if (dirtyScopes) {
      // Scoped rebuilds are bounded. Keep the established registry -> index
      // order while validating the state immediately before applying one.
      await lockWelderStampRegistry(tx)
      await lockWeldJointWritesForDispatcherReplacement(tx)
      await tx.execute(sql`select pg_advisory_xact_lock(${DISPATCHER_INDEX_LOCK_ID})`)
      const [lockedState] = await tx
        .select()
        .from(dispatcherTaskIndexState)
        .where(eq(dispatcherTaskIndexState.id, DISPATCHER_INDEX_STATE_ID))
        .limit(1)
      if (!lockedState) throw new Error('Не удалось получить состояние расчета диспетчера.')
      if (isDispatcherTaskIndexFresh(lockedState)) return lockedState
      const lockedDirtyScopes = getScopedDispatcherDirtyScopes(lockedState)
      // A concurrent save widened the invalidation while the locks were being
      // acquired. Leave it stale; the next coalesced refresh will do a full pass
      // without holding the writer lock for that calculation.
      if (!lockedDirtyScopes) return lockedState
      return rebuildScopedDispatcherTaskIndex(tx, lockedState, lockedDirtyScopes)
    }

    return rebuildFullDispatcherTaskIndex(tx, refreshState)
  })

  if (retryFullRebuild && !isDispatcherTaskIndexFresh(state) && state.fullRebuild) {
    return ensureDispatcherTaskIndexFreshOnce(false)
  }
  return state
}

function getScopedDispatcherDirtyScopes(
  state: typeof dispatcherTaskIndexState.$inferSelect,
) {
  const dirtyScopes = parseJsonArray<DispatcherDirtyScope>(state.dirtyScopes)
  return (
    isDispatcherTaskIndexPayloadCurrent(state.repeatedTasks) &&
    !state.fullRebuild &&
    dirtyScopes.length > 0 &&
    dirtyScopes.length <= MAX_SCOPED_REBUILD_SCOPES &&
    state.computedAt &&
    isDispatcherTaskIndexBusinessDateCurrent(state.computedAt)
  ) ? dirtyScopes : null
}

async function ensureAndReadDispatcherTaskIndexState() {
  const result = await requireDb().execute<typeof dispatcherTaskIndexState.$inferSelect>(sql`
    with "inserted_state" as (
      insert into ${dispatcherTaskIndexState} ("id")
      values (${DISPATCHER_INDEX_STATE_ID})
      on conflict ("id") do nothing
      returning *
    ),
    "current_state" as (
      select * from "inserted_state"
      union all
      select * from ${dispatcherTaskIndexState}
      where "id" = ${DISPATCHER_INDEX_STATE_ID}
        and not exists (select 1 from "inserted_state")
    )
    select
      "id",
      "source_revision" as "sourceRevision",
      "computed_revision" as "computedRevision",
      "repeated_tasks" as "repeatedTasks",
      "welder_stamp_expiry_tasks" as "welderStampExpiryTasks",
      "duplicate_keys" as "duplicateKeys",
      "dirty_scopes" as "dirtyScopes",
      "full_rebuild" as "fullRebuild",
      "computed_at" as "computedAt",
      "updated_at" as "updatedAt"
    from "current_state"
    limit 1
  `)
  // A concurrent first insert can win ON CONFLICT while remaining invisible
  // to this statement's READ COMMITTED snapshot. Only that rare case needs
  // a second statement with a fresh snapshot; normal reads stay one query.
  const state = result.rows[0] ?? (await requireDb().select()
    .from(dispatcherTaskIndexState)
    .where(eq(dispatcherTaskIndexState.id, DISPATCHER_INDEX_STATE_ID))
    .limit(1))[0]
  if (!state) throw new Error('Не удалось получить состояние расчета диспетчера.')
  return {
    ...state,
    computedAt: toDateOrNull(state.computedAt),
    updatedAt: toDateOrNull(state.updatedAt) ?? new Date(0),
  }
}

function toDateOrNull(value: Date | string | null | undefined) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

export function getDispatcherTaskPublicationRevision(
  state: { sourceRevision: number; computedRevision: number },
) {
  // Date- and code-driven rebuilds can change task pages without a weld save.
  // Give that publication its own revision so old pages cannot be mixed in.
  return state.sourceRevision === state.computedRevision
    ? state.sourceRevision + 1
    : state.sourceRevision
}

async function rebuildFullDispatcherTaskIndex(
  tx: DispatcherIndexTransaction,
  refreshState: typeof dispatcherTaskIndexState.$inferSelect,
) {
  const calculationVersionChanged = !isDispatcherTaskIndexPayloadCurrent(refreshState.repeatedTasks)
  await createDispatcherTaskIndexStage(tx, 'active')
  const taskIndexWriter = createDispatcherTaskIndexStageWriter(tx, 'active')
  await createDispatcherTaskPageStage(tx)
  const taskPageWriter = createDispatcherTaskPageStageWriter(tx)
  const taskFilterOptionCounts = new Map<string, number>()
  const {
    chainContinuations,
    repeatedJointTaskCount,
    repeatedJointTasksTruncated,
    sourceRows,
    preparedRows,
    tasks,
  } = await calculateFullDispatcherTasks(tx, {
    onTaskIndexRows: async (rows) => {
      for (const row of rows) {
        taskFilterOptionCounts.set(row.code, (taskFilterOptionCounts.get(row.code) ?? 0) + 1)
      }
      await taskIndexWriter.append(rows)
    },
    onTaskPageRows: (scopeKey, rows) => taskPageWriter.append(scopeKey, rows),
  })
  await taskIndexWriter.flush()
  await taskPageWriter.flush()
  if (taskPageWriter.getMetrics().taskCount !== repeatedJointTaskCount) {
    throw new Error('Количество сохранённых карточек диспетчера не совпало с расчётом.')
  }
  const duplicateKeys = await listDuplicateWeldKeys(tx)

  // Registry writers take their lock before invalidating the dispatcher
  // index. Acquire the same pair only for the final consistency check and
  // atomic replacement, never for the expensive full calculation above.
  await lockWelderStampRegistry(tx)
  if (calculationVersionChanged) {
    // An older-version background refresh can hold its state row until commit.
    // Wait for it before locking weld writes, or each refresh can block the other.
    await tx.execute(sql`select pg_advisory_xact_lock(${DISPATCHER_BACKGROUND_INDEX_LOCK_ID})`)
  }
  await lockWeldJointWritesForDispatcherReplacement(tx)
  await tx.execute(sql`select pg_advisory_xact_lock(${DISPATCHER_INDEX_LOCK_ID})`)
  const [lockedState] = await tx
    .select()
    .from(dispatcherTaskIndexState)
    .where(eq(dispatcherTaskIndexState.id, DISPATCHER_INDEX_STATE_ID))
    .limit(1)
  if (!lockedState) throw new Error('Не удалось получить состояние расчета диспетчера.')
  if (
    lockedState.sourceRevision !== refreshState.sourceRevision ||
    isDispatcherTaskIndexFresh(lockedState)
  ) {
    return lockedState
  }

  await tx.delete(dispatcherRowTasks)
  const taskIndexStage = getDispatcherTaskIndexStageTable('active')
  await tx.execute(sql`
    insert into ${dispatcherRowTasks} ("weld_joint_id", "task_key", "code")
    select "weld_joint_id", "task_key", "code"
    from ${taskIndexStage}
    on conflict do nothing
  `)
  await tx.delete(dispatcherTaskPages)
  const taskPageStage = getDispatcherTaskPageStageTable()
  await tx.execute(sql`
    insert into ${dispatcherTaskPages} ("scope_key", "page_number", "task_count", "tasks")
    select "scope_key", "page_number", "task_count", "tasks"
    from ${taskPageStage}
  `)
  const finalStatusChangeCount = await persistCalculatedFinalStatuses(tx, sourceRows, preparedRows)
  if (finalStatusChangeCount > 0) await invalidateDerivedCalculationCache(tx)
  const compactRepeatedTasks = await loadDispatcherTaskSnapshotFromPages(tx)
  if (compactRepeatedTasks.length !== Math.min(DISPATCHER_TASK_SNAPSHOT_LIMIT, repeatedJointTaskCount)) {
    throw new Error('Снимок задач диспетчера не совпал с полным постраничным индексом.')
  }
  const computedAt = new Date()
  const publishedRevision = getDispatcherTaskPublicationRevision(lockedState)

  const [updatedState] = await tx
    .update(dispatcherTaskIndexState)
    .set({
      sourceRevision: publishedRevision,
      computedRevision: publishedRevision,
      repeatedTasks: serializeDispatcherTaskIndexPayload(compactRepeatedTasks, chainContinuations, {
        totalTaskCount: repeatedJointTaskCount,
        totalPageCount: taskPageWriter.getMetrics().pageCount,
        tasksTruncated: repeatedJointTasksTruncated,
        taskFilterOptions: buildTaskFilterOptionsFromCounts(taskFilterOptionCounts),
      }),
      welderStampExpiryTasks: JSON.stringify(tasks.welderStampExpiryTasks),
      duplicateKeys: JSON.stringify(duplicateKeys),
      dirtyScopes: '[]',
      fullRebuild: false,
      computedAt,
      updatedAt: computedAt,
    })
    .where(and(
      eq(dispatcherTaskIndexState.id, DISPATCHER_INDEX_STATE_ID),
      eq(dispatcherTaskIndexState.sourceRevision, refreshState.sourceRevision),
    ))
    .returning()
  if (!updatedState) throw new Error('Состояние расчета диспетчера изменилось во время сохранения индекса.')

  if (calculationVersionChanged) {
    await tx.delete(dispatcherBackgroundRowTasks)
    await tx
      .update(dispatcherBackgroundTaskIndexState)
      .set({
        computedSourceRevision: -1,
        computedAt: null,
        startedAt: null,
        lastError: null,
        updatedAt: computedAt,
      })
      .where(eq(dispatcherBackgroundTaskIndexState.id, DISPATCHER_BACKGROUND_INDEX_STATE_ID))
  }
  return updatedState
}

export async function calculateFullDispatcherTasks(
  tx: DispatcherIndexTransaction,
  options: {
    dispatcherSettings?: (current: DispatcherSettings) => DispatcherSettings
    includeWelderStampExpiryTasks?: boolean
    onProgress?: (stage: string) => void
    onTaskIndexRows?: (rows: DispatcherTaskIndexRow[]) => void | Promise<void>
    onTaskPageRows?: (scopeKey: string, rows: RepeatedJointTask[]) => void | Promise<void>
    taskSnapshotLimit?: number
  } = {},
) {
  // One transaction uses one PostgreSQL client. Sequential reads keep the
  // snapshot consistent and avoid concurrent client.query calls.
  const rows = await tx
    .select()
    .from(weldJoints)
    .orderBy(desc(weldJoints.weldDate), asc(weldJoints.line), asc(weldJoints.joint))
  options.onProgress?.('weld-rows-loaded')
  const stampRows = await tx.select().from(welderStamps).orderBy(asc(welderStamps.id))
  const suspensionRows = await tx
    .select()
    .from(welderStampSuspensions)
    .orderBy(asc(welderStampSuspensions.id))
  const duplicateRows = await tx
    .select()
    .from(duplicateControls)
    .orderBy(asc(duplicateControls.weldJointId), asc(duplicateControls.id))
  const acceptedWarnings = await tx
    .select()
    .from(dispatcherAcceptedWarnings)
    .orderBy(asc(dispatcherAcceptedWarnings.acceptedAt))
  const settingsRows = await tx.select().from(appSettings)
  options.onProgress?.('supporting-rows-loaded')
  const sourceRows = rows.map((row) => ({ id: row.id, finalStatus: row.finalStatus }))
  const preparedRows = prepareReportRowsInPlace(
    await attachHeatTreatmentControlRelationsInPlace(rows, tx, getControlProcessSettings(settingsRows)),
    duplicateRows.map(toDuplicateControlRecord),
  )
  options.onProgress?.('report-rows-prepared')
  const currentDispatcherSettings = getDispatcherSettings(settingsRows)
  const acceptedDispatcherWarningKeys = new Set(acceptedWarnings.map((row) => row.key))
  const systemIndexSettings = getSystemIndexSettings(settingsRows)
  const dispatcherSettings = options.dispatcherSettings?.(currentDispatcherSettings) ?? currentDispatcherSettings
  const dispatcherTaskInput = {
    acceptedDispatcherWarningKeys,
    dismissedRepeatedJointTaskKeys: new Set<string>(),
    dispatcherReminderSettings: getDispatcherReminderSettings(settingsRows),
    dispatcherSettings,
    dataListSettings: getDataListSettings(settingsRows),
    controlProcessSettings: getControlProcessSettings(settingsRows),
    systemIndexSettings,
    welderStamps: stampRows.map(toWelderStampRecord),
    welderStampSuspensions: suspensionRows.map(toWelderStampSuspensionRecord),
  }
  const chainContinuationOptions = {
    earlyCoilDecisionSourceRowIds: getEarlyCoilDecisionSourceRowIds(acceptedDispatcherWarningKeys),
    systemIndexSettings,
  }
  const chainContinuations: ReturnType<typeof buildJointChainContinuations> = []
  const repeatedJointTasks: RepeatedJointTask[] = []
  let repeatedJointTaskCount = 0
  const taskSnapshotLimit = Math.max(0, options.taskSnapshotLimit ?? DISPATCHER_TASK_SNAPSHOT_LIMIT)
  const rowScopes = groupDispatcherRowsByScope(preparedRows)
  for (const scopeRows of rowScopes) {
    const scopeKey = getDispatcherScopeKey(scopeRows[0]!)
    for (const continuation of buildJointChainContinuations(scopeRows, chainContinuationOptions)) {
      chainContinuations.push(continuation)
    }
    const scopeTasks = buildVisibleDispatcherTasks({
      ...dispatcherTaskInput,
      rows: scopeRows,
      includeWelderStampExpiryTasks: false,
    }).repeatedJointTasks
    repeatedJointTaskCount += scopeTasks.length
    if (options.onTaskIndexRows) {
      await options.onTaskIndexRows(buildDispatcherTaskCodeIndexRows(scopeTasks, scopeRows))
    }
    if (options.onTaskPageRows) {
      for (let index = 0; index < scopeTasks.length; index += 1_000) {
        await options.onTaskPageRows(scopeKey, compactDispatcherTasksForTransport(
          scopeTasks.slice(index, index + 1_000),
        ))
      }
    }
    const remainingSnapshotSize = taskSnapshotLimit - repeatedJointTasks.length
    if (remainingSnapshotSize > 0) {
      repeatedJointTasks.push(...compactDispatcherTasksForTransport(
        scopeTasks.slice(0, remainingSnapshotSize),
      ))
    }
  }
  options.onProgress?.('chain-continuations-built')
  const welderStampExpiryTasks = options.includeWelderStampExpiryTasks === false
    ? []
    : buildVisibleDispatcherTasks({
        ...dispatcherTaskInput,
        rows: [],
        includeRepeatedJointTasks: false,
      }).welderStampExpiryTasks
  const tasks = { repeatedJointTasks, welderStampExpiryTasks }
  options.onProgress?.('dispatcher-tasks-built')
  return {
    chainContinuations,
    repeatedJointTaskCount,
    repeatedJointTasksTruncated: repeatedJointTaskCount > repeatedJointTasks.length,
    sourceRows,
    preparedRows,
    tasks,
  }
}

export function groupDispatcherRowsByScope(rows: WeldRow[]) {
  const rowsByScope = new Map<string, WeldRow[]>()
  for (const row of rows) {
    const key = getDispatcherScopeKey(row)
    const scopeRows = rowsByScope.get(key)
    if (scopeRows) scopeRows.push(row)
    else rowsByScope.set(key, [row])
  }
  return [...rowsByScope.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([, scopeRows]) => scopeRows)
}

export function getDispatcherScopeKey(scope: { projectTitle?: unknown; subtitleCode?: unknown; line?: unknown }) {
  return encodeIdentityKey([
    normalizeScopeText(scope.projectTitle),
    normalizeScopeText(scope.subtitleCode),
    normalizeScopeText(scope.line),
  ])
}

export async function lockWeldJointWritesForDispatcherReplacement(
  tx: Pick<DispatcherIndexTransaction, 'execute'>,
) {
  // Acquire the parent-table lock before the dispatcher advisory lock. A weld
  // deletion cascades into dispatcher_row_tasks; otherwise a full replacement
  // can hold an index row while waiting for the deleted parent, and the delete
  // can wait for that same index row (PostgreSQL deadlock 40P01).
  // Self-exclusive: active and background refreshes must not each hold SHARE
  // while one upgrades to ROW EXCLUSIVE to persist calculated final statuses.
  await tx.execute(sql`lock table ${weldJoints} in share row exclusive mode`)
}

async function rebuildScopedDispatcherTaskIndex(
  tx: DispatcherIndexTransaction,
  lockedState: typeof dispatcherTaskIndexState.$inferSelect,
  dirtyScopes: DispatcherDirtyScope[],
) {
  const scopeWhere = or(...dirtyScopes.map((scope) => and(
    normalizedTextEquals(weldJoints.projectTitle, scope.projectTitle),
    normalizedTextEquals(weldJoints.subtitleCode, scope.subtitleCode),
    normalizedTextEquals(weldJoints.line, scope.line),
  ))) ?? sql`false`
  const rows = await tx
    .select()
    .from(weldJoints)
    .where(scopeWhere)
    .orderBy(desc(weldJoints.weldDate), asc(weldJoints.line), asc(weldJoints.joint))
  const rowIds = rows.map((row) => row.id)
  const stampRows = await tx.select().from(welderStamps).orderBy(asc(welderStamps.id))
  const suspensionRows = await tx
    .select()
    .from(welderStampSuspensions)
    .orderBy(asc(welderStampSuspensions.id))
  const duplicateRows: DuplicateControl[] = rowIds.length > 0
    ? await tx
      .select()
      .from(duplicateControls)
      .where(buildNumberArrayMatch(duplicateControls.weldJointId, rowIds))
      .orderBy(asc(duplicateControls.weldJointId), asc(duplicateControls.id))
    : []
  const acceptedWarnings = await tx
    .select()
    .from(dispatcherAcceptedWarnings)
    .orderBy(asc(dispatcherAcceptedWarnings.acceptedAt))
  const settingsRows = await tx.select().from(appSettings)
  const preparedRows = await prepareDispatcherReportRows(tx, rows, duplicateRows)
  const finalStatusChangeCount = await persistCalculatedFinalStatuses(tx, rows, preparedRows)
  if (finalStatusChangeCount > 0) await invalidateDerivedCalculationCache(tx)
  const acceptedDispatcherWarningKeys = new Set(acceptedWarnings.map((row) => row.key))
  const systemIndexSettings = getSystemIndexSettings(settingsRows)
  const chainContinuationOptions = {
    earlyCoilDecisionSourceRowIds: getEarlyCoilDecisionSourceRowIds(acceptedDispatcherWarningKeys),
    systemIndexSettings,
  }
  const dispatcherTaskInput = {
    acceptedDispatcherWarningKeys,
    dismissedRepeatedJointTaskKeys: new Set<string>(),
    dispatcherReminderSettings: getDispatcherReminderSettings(settingsRows),
    dispatcherSettings: getDispatcherSettings(settingsRows),
    dataListSettings: getDataListSettings(settingsRows),
    controlProcessSettings: getControlProcessSettings(settingsRows),
    systemIndexSettings,
    welderStamps: stampRows.map(toWelderStampRecord),
    welderStampSuspensions: suspensionRows.map(toWelderStampSuspensionRecord),
  }
  const dirtyScopeKeys = [...new Set(dirtyScopes.map(getDispatcherScopeKey))]
  const oldPageTotals = await tx.execute<{ pageCount: number | string; taskCount: number | string }>(sql`
    select count(*)::int as "pageCount", coalesce(sum("task_count"), 0)::int as "taskCount"
    from ${dispatcherTaskPages}
    where "scope_key" = any(${sql.param(dirtyScopeKeys)}::text[])
  `)
  await createDispatcherTaskPageStage(tx)
  const taskPageWriter = createDispatcherTaskPageStageWriter(tx)
  const scopedChainContinuations: ReturnType<typeof buildJointChainContinuations> = []
  const taskIndexRows: DispatcherTaskIndexRow[] = []
  const rowIdSet = new Set(rowIds)
  for (const scopeRows of groupDispatcherRowsByScope(preparedRows)) {
    const scopeKey = getDispatcherScopeKey(scopeRows[0]!)
    for (const continuation of buildJointChainContinuations(scopeRows, chainContinuationOptions)) {
      scopedChainContinuations.push(continuation)
    }
    const scopeTasks = buildVisibleDispatcherTasks({
      ...dispatcherTaskInput,
      rows: scopeRows,
      includeWelderStampExpiryTasks: false,
    }).repeatedJointTasks
    for (const taskIndexRow of buildDispatcherTaskCodeIndexRows(scopeTasks, scopeRows)) {
      if (rowIdSet.has(taskIndexRow.rowId)) taskIndexRows.push(taskIndexRow)
    }
    for (let index = 0; index < scopeTasks.length; index += 1_000) {
      await taskPageWriter.append(scopeKey, compactDispatcherTasksForTransport(
        scopeTasks.slice(index, index + 1_000),
      ))
    }
  }
  await taskPageWriter.flush()
  const newPageTotals = taskPageWriter.getMetrics()
  await tx.delete(dispatcherTaskPages).where(sql`
    ${dispatcherTaskPages.scopeKey} = any(${sql.param(dirtyScopeKeys)}::text[])
  `)
  const taskPageStage = getDispatcherTaskPageStageTable()
  await tx.execute(sql`
    insert into ${dispatcherTaskPages} ("scope_key", "page_number", "task_count", "tasks")
    select "scope_key", "page_number", "task_count", "tasks"
    from ${taskPageStage}
  `)
  const previousPayload = parseDispatcherTaskIndexPayload(lockedState.repeatedTasks)
  const repeatedJointTaskCount = previousPayload.totalTaskCount -
    Number(oldPageTotals.rows[0]?.taskCount ?? 0) + newPageTotals.taskCount
  const repeatedJointTaskPageCount = previousPayload.totalPageCount -
    Number(oldPageTotals.rows[0]?.pageCount ?? 0) + newPageTotals.pageCount
  if (repeatedJointTaskCount < 0 || repeatedJointTaskPageCount < 0) {
    throw new Error('Индекс страниц диспетчера рассинхронизирован. Требуется полный пересчёт.')
  }
  const repeatedTasks = await loadDispatcherTaskSnapshotFromPages(tx)
  if (repeatedTasks.length !== Math.min(DISPATCHER_TASK_SNAPSHOT_LIMIT, repeatedJointTaskCount)) {
    throw new Error('Снимок задач диспетчера не совпал с постраничным индексом.')
  }
  const chainContinuations = [
    ...previousPayload.chainContinuations.filter(
      (continuation) => !isChainContinuationInScopes(continuation, dirtyScopes),
    ),
    ...scopedChainContinuations,
  ]
  await replaceScopedDispatcherTaskIndexRows(tx, rowIds, taskIndexRows)

  const [updatedState] = await tx
    .update(dispatcherTaskIndexState)
    .set({
      computedRevision: lockedState.sourceRevision,
      repeatedTasks: serializeDispatcherTaskIndexPayload(repeatedTasks, chainContinuations, {
        totalTaskCount: repeatedJointTaskCount,
        totalPageCount: repeatedJointTaskPageCount,
        taskFilterOptions: await listActiveDispatcherTaskFilterOptions(tx),
      }),
      duplicateKeys: JSON.stringify(await listDuplicateWeldKeys(tx)),
      dirtyScopes: '[]',
      fullRebuild: false,
      computedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(dispatcherTaskIndexState.id, DISPATCHER_INDEX_STATE_ID))
    .returning()
  return updatedState
}

async function loadDispatcherTaskSnapshotFromPages(tx: DispatcherIndexTransaction) {
  // Rank only the small page metadata, then fetch JSON for pages that actually
  // intersect the first 5,000 cards. A scoped update must not read every card.
  const result = await tx.execute<{ tasks: string }>(sql`
    with "ranked_pages" as (
      select "scope_key", "page_number",
        coalesce(sum("task_count") over (
          order by "scope_key", "page_number"
          rows between unbounded preceding and 1 preceding
        ), 0) as "preceding_task_count"
      from ${dispatcherTaskPages}
    )
    select "page"."tasks"
    from "ranked_pages" as "ranked"
    join ${dispatcherTaskPages} as "page"
      on "page"."scope_key" = "ranked"."scope_key"
      and "page"."page_number" = "ranked"."page_number"
    where "ranked"."preceding_task_count" < ${DISPATCHER_TASK_SNAPSHOT_LIMIT}
    order by "ranked"."scope_key", "ranked"."page_number"
  `)
  const tasks: RepeatedJointTask[] = []
  for (const page of result.rows) {
    const parsed = JSON.parse(page.tasks) as unknown
    if (!Array.isArray(parsed)) throw new Error('Некорректная страница задач диспетчера.')
    tasks.push(...parsed.slice(0, DISPATCHER_TASK_SNAPSHOT_LIMIT - tasks.length) as RepeatedJointTask[])
    if (tasks.length >= DISPATCHER_TASK_SNAPSHOT_LIMIT) break
  }
  return tasks
}

export async function replaceScopedDispatcherTaskIndexRows(
  tx: Pick<DispatcherIndexTransaction, 'delete' | 'execute'>,
  rowIds: readonly number[],
  taskIndexRows: DispatcherTaskIndexRow[],
) {
  await createDispatcherTaskIndexStage(tx, 'active')
  const writer = createDispatcherTaskIndexStageWriter(tx, 'active')
  await writer.append(taskIndexRows)
  await writer.flush()

  if (rowIds.length > 0) {
    await tx
      .delete(dispatcherRowTasks)
      .where(buildNumberArrayMatch(dispatcherRowTasks.weldJointId, rowIds))
  }

  const stage = getDispatcherTaskIndexStageTable('active')
  await tx.execute(sql`
    insert into ${dispatcherRowTasks} ("weld_joint_id", "task_key", "code")
    select "weld_joint_id", "task_key", "code"
    from ${stage}
    on conflict do nothing
  `)
}

async function listDispatcherTaskFilterOptions(
  executor: Pick<ReturnType<typeof requireDb>, 'execute'>,
  payload: ReturnType<typeof parseDispatcherTaskIndexPayload>,
) {
  if (payload.taskFilterOptions === null) {
    return toLabeledTaskFilterOptions(await listExactDispatcherTaskFilterOptions(executor))
  }

  const backgroundOptions = await listBackgroundDispatcherTaskFilterOptions(executor)
  const activeByCode = new Map(payload.taskFilterOptions.map((option) => [option.value, option.count]))
  const backgroundByCode = new Map(backgroundOptions.map((option) => [option.value, option.count]))
  const overlappingCodes = [...backgroundByCode.keys()].filter((code) => activeByCode.has(code))
  const exactOverlapByCode = new Map(
    overlappingCodes.length > 0
      ? (await listExactDispatcherTaskFilterOptions(executor, overlappingCodes))
          .map((option) => [option.value, option.count] as const)
      : [],
  )
  return toLabeledTaskFilterOptions(mergeDispatcherTaskFilterOptionCounts(
    payload.taskFilterOptions,
    backgroundOptions,
    [...exactOverlapByCode].map(([value, count]) => ({ value, count })),
  ))
}

export function mergeDispatcherTaskFilterOptionCounts(
  activeOptions: Array<{ value: string; count: number }>,
  backgroundOptions: Array<{ value: string; count: number }>,
  exactOverlapOptions: Array<{ value: string; count: number }>,
) {
  const activeByCode = new Map(activeOptions.map((option) => [option.value, option.count]))
  const backgroundByCode = new Map(backgroundOptions.map((option) => [option.value, option.count]))
  const exactOverlapByCode = new Map(exactOverlapOptions.map((option) => [option.value, option.count]))
  const codes = new Set([...activeByCode.keys(), ...backgroundByCode.keys()])
  return [...codes].map((value) => ({
    value,
    count: exactOverlapByCode.get(value) ?? (
      (activeByCode.get(value) ?? 0) + (backgroundByCode.get(value) ?? 0)
    ),
  }))
}

async function listActiveDispatcherTaskFilterOptions(
  executor: Pick<ReturnType<typeof requireDb>, 'execute'>,
) {
  const result = await executor.execute<{ value: string; count: number | string }>(sql`
    select "code" as "value", count(distinct "weld_joint_id")::int as "count"
    from ${dispatcherRowTasks}
    group by "code"
  `)
  return normalizeTaskFilterOptionRows(result.rows)
}

async function listBackgroundDispatcherTaskFilterOptions(
  executor: Pick<ReturnType<typeof requireDb>, 'execute'>,
) {
  const result = await executor.execute<{ value: string; count: number | string }>(sql`
    select "code" as "value", count(distinct "weld_joint_id")::int as "count"
    from ${dispatcherBackgroundRowTasks}
    group by "code"
  `)
  return normalizeTaskFilterOptionRows(result.rows)
}

async function listExactDispatcherTaskFilterOptions(
  executor: Pick<ReturnType<typeof requireDb>, 'execute'>,
  codes: string[] = [],
) {
  const codeWhere = codes.length > 0
    ? sql`where "code" in (${sql.join(codes.map((code) => sql`${code}`), sql`, `)})`
    : sql``
  const result = await executor.execute<{ value: string; count: number | string }>(sql`
    select "code" as "value", count(distinct "weld_joint_id")::int as "count"
    from (
      select "weld_joint_id", "code" from ${dispatcherRowTasks}
      union
      select "weld_joint_id", "code" from ${dispatcherBackgroundRowTasks}
    ) as "dispatcher_all_row_tasks"
    ${codeWhere}
    group by "code"
  `)
  return normalizeTaskFilterOptionRows(result.rows)
}

function normalizeTaskFilterOptionRows(
  rows: Array<{ value: string; count: number | string }>,
) {
  return rows.map((row) => ({ value: String(row.value), count: Number(row.count) || 0 }))
}

function buildTaskFilterOptionsFromCounts(counts: ReadonlyMap<string, number>) {
  return [...counts].map(([value, count]) => ({ value, count }))
}

function toLabeledTaskFilterOptions(options: Array<{ value: string; count: number }>) {
  return options
    .sort((left, right) => compareDispatcherTaskCodes(left.value, right.value))
    .map((option) => ({ ...option, label: option.value }))
}

function normalizedTextEquals(column: SQLWrapper, value: string) {
  return sql`lower(btrim(coalesce(${column}, ''))) = ${normalizeScopeText(value)}`
}

export async function prepareDispatcherReportRows(
  tx: DispatcherIndexTransaction,
  rows: Array<typeof weldJoints.$inferSelect>,
  duplicateRows: DuplicateControl[],
) {
  const rowsWithHeatTreatmentControls = await attachHeatTreatmentControlRelations(rows, tx)
  return prepareReportRows(
    rowsWithHeatTreatmentControls,
    duplicateRows.map(toDuplicateControlRecord),
  )
}

function isChainContinuationInScopes(
  continuation: { projectTitle: string; subtitleCode: string; line: string },
  scopes: DispatcherDirtyScope[],
) {
  return scopes.some((scope) =>
    normalizeScopeText(continuation.projectTitle) === normalizeScopeText(scope.projectTitle) &&
    normalizeScopeText(continuation.subtitleCode) === normalizeScopeText(scope.subtitleCode) &&
    normalizeScopeText(continuation.line) === normalizeScopeText(scope.line),
  )
}

function normalizeScopeText(value: unknown) {
  return String(value ?? '').trim().toLocaleLowerCase('ru-RU')
}

async function listDuplicateWeldKeys(tx: DispatcherIndexTransaction) {
  const project = normalizedDuplicatePart(weldJoints.projectTitle)
  const subtitle = normalizedDuplicatePart(weldJoints.subtitleCode)
  const line = normalizedDuplicatePart(weldJoints.line)
  const joint = normalizedDuplicatePart(weldJoints.joint)
  const rows = await tx
    .select({ project, subtitle, line, joint })
    .from(weldJoints)
    .where(sql`lower(btrim(coalesce(${WELD_EFFECTIVE_OFFICIALITY}, ''))) <> 'неофициальный'`)
    .groupBy(project, subtitle, line, joint)
    .having(sql`count(*) > 1 and not (${project} = '' and ${subtitle} = '' and ${line} = '' and ${joint} = '')`)
  return rows
    .map((row) => encodeIdentityKey([row.project, row.subtitle, row.line, row.joint]))
    .sort()
}

function normalizedDuplicatePart(column: SQLWrapper) {
  return sql<string>`lower(regexp_replace(coalesce(${column}, ''), '\\s+', '', 'g'))`
}

function isDispatcherTaskIndexFresh(state: typeof dispatcherTaskIndexState.$inferSelect | undefined) {
  if (
    !state ||
    state.computedRevision !== state.sourceRevision ||
    !state.computedAt ||
    !isDispatcherTaskIndexPayloadCurrent(state.repeatedTasks)
  ) return false
  return isDispatcherTaskIndexBusinessDateCurrent(state.computedAt)
}

function isDispatcherTaskIndexBusinessDateCurrent(computedAt: Date) {
  return getBusinessDateIso(computedAt) === getBusinessDateIso()
}

const DISPATCHER_ROW_CONTEXT_KEYS = [
  'projectTitle',
  'subtitleCode',
  'line',
  'joint',
  'officiality',
  'weldDate',
] as const

function compactDispatcherRow(row: WeldRow): WeldRow {
  const compact: WeldRow = { id: row.id }
  for (const key of DISPATCHER_ROW_CONTEXT_KEYS) {
    if (row[key] !== undefined) compact[key] = row[key]
  }
  return compact
}

export function compactDispatcherTasksForTransport(tasks: RepeatedJointTask[]): RepeatedJointTask[] {
  return tasks.map((task) => {
    if (task.kind === 'check') {
      return {
        ...task,
        row: compactDispatcherRow(task.row),
        sourceRow: compactDispatcherRow(task.sourceRow),
      }
    }
    if (task.kind === 'duplicate-check' || task.kind === 'line-consistency') {
      return {
        ...task,
        row: compactDispatcherRow(task.row),
      }
    }
    return task
  })
}

function getDispatcherSettings(rows: AppSetting[]) {
  return normalizeDispatcherSettings(
    getStoredSetting(rows, PROJECT_SETTING_KEYS.dispatcher) ?? DEFAULT_DISPATCHER_SETTINGS,
  )
}

function getDispatcherReminderSettings(rows: AppSetting[]) {
  return normalizeDispatcherReminderSettings(
    getStoredSetting(rows, PROJECT_SETTING_KEYS.dispatcherReminders) ?? DEFAULT_DISPATCHER_REMINDER_SETTINGS,
  )
}

function getDataListSettings(rows: AppSetting[]) {
  return normalizeDataListSettings(
    getStoredSetting(rows, PROJECT_SETTING_KEYS.dataList) ?? DEFAULT_DATA_LIST_SETTINGS,
  )
}

function getSystemIndexSettings(rows: AppSetting[]) {
  return normalizeSystemIndexSettings(
    getStoredSetting(rows, PROJECT_SETTING_KEYS.systemIndex) ?? DEFAULT_SYSTEM_INDEX_SETTINGS,
  )
}

function getControlProcessSettings(rows: AppSetting[]) {
  return normalizeControlProcessSettings(
    getStoredSetting(rows, PROJECT_SETTING_KEYS.controlProcesses) ?? DEFAULT_CONTROL_PROCESS_SETTINGS,
  )
}

function getStoredSetting(rows: AppSetting[], key: string) {
  const row = rows.find((candidate) => candidate.key === key)
  if (!row) return null
  try {
    return JSON.parse(row.value)
  } catch {
    return null
  }
}

function parseJsonArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[]
  if (typeof value !== 'string' || !value.trim()) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

function toWelderStampRecord(row: WelderStamp): WelderStampRecord {
  return {
    id: row.id,
    naksStamp: row.naksStamp ?? '',
    welderName: row.welderName ?? '',
    internalStamp: row.internalStamp ?? '',
    weldType: row.weldType ?? '',
    materialGroups: row.materialGroups ?? '',
    diameterFrom: row.diameterFrom ?? '',
    diameterTo: row.diameterTo ?? '',
    thicknessFrom: row.thicknessFrom ?? '',
    thicknessTo: row.thicknessTo ?? '',
    validFrom: row.validFrom ?? '',
    validTo: row.validTo ?? '',
    naksPermits: parseJsonArray<WelderStampNaksPermit>(row.naksPermits),
    dlsPermits: parseJsonArray<WelderStampDlsPermit>(row.dlsPermits),
    archived: Boolean(row.archived),
    archivedAt: row.archivedAt ?? '',
  }
}

function toWelderStampSuspensionRecord(row: WelderStampSuspension): WelderStampSuspensionRecord {
  return {
    id: row.id,
    naksStamp: row.naksStamp ?? '',
    suspendedFrom: row.suspendedFrom ?? '',
    suspendedTo: row.suspendedTo ?? '',
  }
}

function toDuplicateControlRecord(row: DuplicateControl): DuplicateControlRecord {
  return {
    id: row.id,
    version: row.updatedAt?.toISOString?.() ?? '',
    weldJointId: row.weldJointId,
    method: row.method as DuplicateControlRecord['method'],
    result: row.result as DuplicateControlRecord['result'],
    controlDate: row.controlDate ?? '',
    conclusion: row.conclusion ?? '',
    conclusionDate: row.conclusionDate ?? '',
  }
}
