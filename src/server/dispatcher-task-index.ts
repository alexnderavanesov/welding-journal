import { and, asc, desc, eq, inArray, or, sql, type SQLWrapper } from 'drizzle-orm'
import { requireDb } from '@/db'
import {
  appSettings,
  dispatcherAcceptedWarnings,
  dispatcherBackgroundRowTasks,
  dispatcherBackgroundTaskIndexState,
  dispatcherRowTasks,
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
  buildDispatcherTaskIndexRows,
  compareDispatcherTaskCodes,
} from '@/lib/dispatcher-task-row-codes'
import {
  isDispatcherTaskIndexPayloadCurrent,
  parseDispatcherTaskIndexPayload,
  serializeDispatcherTaskIndexPayload,
} from '@/lib/dispatcher-task-index-payload'
import type { RepeatedJointTask, WeldRow, WelderStampExpiryTask } from '@/lib/dispatcher-types'
import type { DuplicateControlRecord } from '@/lib/duplicate-control-types'
import { PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'
import { DEFAULT_DATA_LIST_SETTINGS, normalizeDataListSettings } from '@/lib/data-list-settings'
import { DEFAULT_SAVE_CHECK_SETTINGS, normalizeSaveCheckSettings } from '@/lib/save-check-settings'
import { DEFAULT_SYSTEM_INDEX_SETTINGS, normalizeSystemIndexSettings } from '@/lib/system-index-settings'
import { prepareReportRows } from '@/lib/use-report-rows'
import { getDuplicateKeys } from '@/lib/weld-table-utils'
import type {
  WelderStampDlsPermit,
  WelderStampNaksPermit,
  WelderStampRecord,
  WelderStampSuspensionRecord,
} from '@/lib/welder-stamp-types'
import {
  DISPATCHER_BACKGROUND_INDEX_STATE_ID,
  DISPATCHER_INDEX_LOCK_ID,
  DISPATCHER_INDEX_STATE_ID,
} from '@/server/dispatcher-task-index-constants'
import { markDispatcherTaskIndexDirty } from '@/server/dispatcher-task-index-dirty'
import { getBusinessDateIso } from '@/lib/business-date'
import type { DispatcherDirtyScope } from '@/server/dispatcher-task-index-dirty'

const INSERT_CHUNK_SIZE = 1_000
type DispatcherIndexTransaction = Parameters<Parameters<ReturnType<typeof requireDb>['transaction']>[0]>[0]
let pendingDispatcherTaskIndexRefresh: Promise<typeof dispatcherTaskIndexState.$inferSelect> | null = null

export type DispatcherTaskIndexSnapshot = {
  duplicateKeys: string[]
  repeatedJointTasks: RepeatedJointTask[]
  taskFilterOptions: Array<{ value: string; count: number; label: string }>
  welderStampExpiryTasks: WelderStampExpiryTask[]
  computedAt: string
}

export async function getDispatcherTaskIndexSnapshot(): Promise<DispatcherTaskIndexSnapshot> {
  const db = requireDb()
  const state = await ensureDispatcherTaskIndexFresh()
  const taskOptionResult = await db.execute<{ value: string; count: number | string }>(sql`
    select "code" as "value", count(distinct "weld_joint_id")::int as "count"
    from (
      select "weld_joint_id", "code" from ${dispatcherRowTasks}
      union
      select "weld_joint_id", "code" from ${dispatcherBackgroundRowTasks}
    ) as "dispatcher_all_row_tasks"
    group by "code"
    order by "code"
  `)

  const repeatedJointTasks = parseDispatcherTaskIndexPayload(state.repeatedTasks).tasks
  const welderStampExpiryTasks = parseJsonArray<WelderStampExpiryTask>(state.welderStampExpiryTasks)
  const taskFilterOptions = taskOptionResult.rows
    .sort((left, right) => compareDispatcherTaskCodes(left.value, right.value))
    .map((row) => ({ value: row.value, count: Number(row.count), label: row.value }))

  return {
    duplicateKeys: parseJsonArray<string>(state.duplicateKeys),
    repeatedJointTasks,
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
  } finally {
    if (pendingDispatcherTaskIndexRefresh === pending) pendingDispatcherTaskIndexRefresh = null
  }
}

async function ensureDispatcherTaskIndexFreshOnce() {
  const db = requireDb()
  let state = await ensureAndReadDispatcherTaskIndexState()

  if (isDispatcherTaskIndexFresh(state)) return state

  state = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${DISPATCHER_INDEX_LOCK_ID})`)
    const [lockedState] = await tx
      .select()
      .from(dispatcherTaskIndexState)
      .where(eq(dispatcherTaskIndexState.id, DISPATCHER_INDEX_STATE_ID))
      .limit(1)
    if (isDispatcherTaskIndexFresh(lockedState)) return lockedState

    const dirtyScopes = parseJsonArray<DispatcherDirtyScope>(lockedState.dirtyScopes)
    if (
      isDispatcherTaskIndexPayloadCurrent(lockedState.repeatedTasks) &&
      !lockedState.fullRebuild &&
      dirtyScopes.length > 0 &&
      lockedState.computedAt &&
      isDispatcherTaskIndexBusinessDateCurrent(lockedState.computedAt)
    ) {
      return rebuildScopedDispatcherTaskIndex(tx, lockedState, dirtyScopes)
    }

    return rebuildFullDispatcherTaskIndex(tx, lockedState)
  })

  return state
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
  const state = result.rows[0]
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

async function rebuildFullDispatcherTaskIndex(
  tx: DispatcherIndexTransaction,
  lockedState: typeof dispatcherTaskIndexState.$inferSelect,
) {
    const calculationVersionChanged = !isDispatcherTaskIndexPayloadCurrent(lockedState.repeatedTasks)
    const { preparedRows, tasks } = await calculateFullDispatcherTasks(tx)
    const compactRepeatedTasks = compactDispatcherTasksForTransport(tasks.repeatedJointTasks)
    const taskIndexRows = buildDispatcherTaskIndexRows(compactRepeatedTasks, preparedRows)
    const computedAt = new Date()

    await tx.delete(dispatcherRowTasks)
    for (let index = 0; index < taskIndexRows.length; index += INSERT_CHUNK_SIZE) {
      const chunk = taskIndexRows.slice(index, index + INSERT_CHUNK_SIZE)
      if (chunk.length === 0) continue
      await tx.insert(dispatcherRowTasks).values(
        chunk.map((row) => ({
          weldJointId: row.rowId,
          taskKey: row.taskKey,
          code: row.code,
        })),
      )
    }

    const [updatedState] = await tx
      .update(dispatcherTaskIndexState)
      .set({
        computedRevision: lockedState.sourceRevision,
        repeatedTasks: serializeDispatcherTaskIndexPayload(compactRepeatedTasks),
        welderStampExpiryTasks: JSON.stringify(tasks.welderStampExpiryTasks),
        duplicateKeys: JSON.stringify([...getDuplicateKeys(preparedRows)].sort()),
        dirtyScopes: '[]',
        fullRebuild: false,
        computedAt,
        updatedAt: computedAt,
      })
      .where(eq(dispatcherTaskIndexState.id, DISPATCHER_INDEX_STATE_ID))
      .returning()

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
  } = {},
) {
  // One transaction uses one PostgreSQL client. Sequential reads keep the
  // snapshot consistent and avoid concurrent client.query calls.
  const rows = await tx
    .select()
    .from(weldJoints)
    .orderBy(desc(weldJoints.weldDate), asc(weldJoints.line), asc(weldJoints.joint))
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
  const preparedRows = prepareReportRows(rows, duplicateRows.map(toDuplicateControlRecord))
  const currentDispatcherSettings = getDispatcherSettings(settingsRows)
  const tasks = buildVisibleDispatcherTasks({
    acceptedDispatcherWarningKeys: new Set(acceptedWarnings.map((row) => row.key)),
    dismissedRepeatedJointTaskKeys: new Set(),
    dispatcherReminderSettings: getDispatcherReminderSettings(settingsRows),
    dispatcherSettings: options.dispatcherSettings?.(currentDispatcherSettings) ?? currentDispatcherSettings,
    dataListSettings: getDataListSettings(settingsRows),
    saveCheckSettings: getSaveCheckSettings(settingsRows),
    systemIndexSettings: getSystemIndexSettings(settingsRows),
    rows: preparedRows,
    welderStamps: stampRows.map(toWelderStampRecord),
    welderStampSuspensions: suspensionRows.map(toWelderStampSuspensionRecord),
    includeWelderStampExpiryTasks: options.includeWelderStampExpiryTasks,
  })
  return { preparedRows, tasks }
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
  const duplicateRows = rowIds.length
    ? await tx
        .select()
        .from(duplicateControls)
        .where(inArray(duplicateControls.weldJointId, rowIds))
        .orderBy(asc(duplicateControls.weldJointId), asc(duplicateControls.id))
    : []
  const acceptedWarnings = await tx
    .select()
    .from(dispatcherAcceptedWarnings)
    .orderBy(asc(dispatcherAcceptedWarnings.acceptedAt))
  const settingsRows = await tx.select().from(appSettings)
  const preparedRows = prepareReportRows(rows, duplicateRows.map(toDuplicateControlRecord))
  const scopedTasks = buildVisibleDispatcherTasks({
    acceptedDispatcherWarningKeys: new Set(acceptedWarnings.map((row) => row.key)),
    dismissedRepeatedJointTaskKeys: new Set(),
    dispatcherReminderSettings: getDispatcherReminderSettings(settingsRows),
    dispatcherSettings: getDispatcherSettings(settingsRows),
    dataListSettings: getDataListSettings(settingsRows),
    saveCheckSettings: getSaveCheckSettings(settingsRows),
    systemIndexSettings: getSystemIndexSettings(settingsRows),
    rows: preparedRows,
    welderStamps: stampRows.map(toWelderStampRecord),
    welderStampSuspensions: suspensionRows.map(toWelderStampSuspensionRecord),
  })
  const previousTasks = parseDispatcherTaskIndexPayload(lockedState.repeatedTasks).tasks
  const compactScopedTasks = compactDispatcherTasksForTransport(scopedTasks.repeatedJointTasks)
  const repeatedTasks = [
    ...previousTasks.filter((task) => !isDispatcherTaskInScopes(task, dirtyScopes)),
    ...compactScopedTasks,
  ]
  const rowIdSet = new Set(rowIds)
  const taskIndexRows = buildDispatcherTaskIndexRows(compactScopedTasks, preparedRows)
    .filter((taskRow) => rowIdSet.has(taskRow.rowId))

  if (rowIds.length > 0) {
    await tx.delete(dispatcherRowTasks).where(inArray(dispatcherRowTasks.weldJointId, rowIds))
  }
  for (let index = 0; index < taskIndexRows.length; index += INSERT_CHUNK_SIZE) {
    const chunk = taskIndexRows.slice(index, index + INSERT_CHUNK_SIZE)
    if (chunk.length === 0) continue
    await tx.insert(dispatcherRowTasks).values(
      chunk.map((row) => ({
        weldJointId: row.rowId,
        taskKey: row.taskKey,
        code: row.code,
      })),
    ).onConflictDoNothing()
  }

  const [updatedState] = await tx
    .update(dispatcherTaskIndexState)
    .set({
      computedRevision: lockedState.sourceRevision,
      repeatedTasks: serializeDispatcherTaskIndexPayload(repeatedTasks),
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

function normalizedTextEquals(column: SQLWrapper, value: string) {
  return sql`btrim(coalesce(${column}, '')) = ${String(value ?? '').trim()}`
}

function isDispatcherTaskInScopes(task: RepeatedJointTask, scopes: DispatcherDirtyScope[]) {
  const taskScope = task.kind === 'line-consistency' || task.kind === 'percentage-line-control'
    ? task
    : task.row
  return scopes.some((scope) =>
    String(taskScope.projectTitle ?? '').trim() === String(scope.projectTitle ?? '').trim() &&
    String(taskScope.subtitleCode ?? '').trim() === String(scope.subtitleCode ?? '').trim() &&
    String(taskScope.line ?? '').trim() === String(scope.line ?? '').trim(),
  )
}

async function listDuplicateWeldKeys(tx: DispatcherIndexTransaction) {
  const project = normalizedDuplicatePart(weldJoints.projectTitle)
  const subtitle = normalizedDuplicatePart(weldJoints.subtitleCode)
  const line = normalizedDuplicatePart(weldJoints.line)
  const joint = normalizedDuplicatePart(weldJoints.joint)
  const key = sql<string>`concat(${project}, '|', ${subtitle}, '|', ${line}, '|', ${joint})`
  const rows = await tx
    .select({ key })
    .from(weldJoints)
    .where(sql`lower(btrim(coalesce(${weldJoints.status}, ''))) <> 'неофициальный'`)
    .groupBy(project, subtitle, line, joint)
    .having(sql`count(*) > 1 and not (${project} = '' and ${subtitle} = '' and ${line} = '' and ${joint} = '')`)
  return rows.map((row) => row.key).sort()
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
  'status',
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

function getSaveCheckSettings(rows: AppSetting[]) {
  return normalizeSaveCheckSettings(
    getStoredSetting(rows, PROJECT_SETTING_KEYS.saveCheck) ?? DEFAULT_SAVE_CHECK_SETTINGS,
  )
}

function getSystemIndexSettings(rows: AppSetting[]) {
  return normalizeSystemIndexSettings(
    getStoredSetting(rows, PROJECT_SETTING_KEYS.systemIndex) ?? DEFAULT_SYSTEM_INDEX_SETTINGS,
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
    weldJointId: row.weldJointId,
    method: row.method as DuplicateControlRecord['method'],
    result: row.result as DuplicateControlRecord['result'],
    controlDate: row.controlDate ?? '',
    conclusion: row.conclusion ?? '',
    conclusionDate: row.conclusionDate ?? '',
  }
}
