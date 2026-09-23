import { eq, inArray, sql } from 'drizzle-orm'
import { requireDb } from '@/db'
import {
  appSettings,
  dispatcherBackgroundRowTasks,
  dispatcherBackgroundTaskIndexState,
  dispatcherTaskIndexState,
} from '@/db/schema'
import {
  DEFAULT_DISPATCHER_SETTINGS,
  normalizeDispatcherSettings,
  type DispatcherSettings,
} from '@/lib/dispatcher-settings'
import {
  buildDisabledDispatcherSettings,
  getEnabledDispatcherTaskCodes,
  normalizeDispatcherBackgroundSettings,
  shouldRefreshDispatcherBackgroundIndex,
} from '@/lib/dispatcher-background-settings'
import { PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'
import {
  calculateFullDispatcherTasks,
  ensureDispatcherTaskIndexFresh,
  lockWeldJointWritesForDispatcherReplacement,
} from '@/server/dispatcher-task-index'
import {
  DISPATCHER_BACKGROUND_INDEX_LOCK_ID,
  DISPATCHER_BACKGROUND_INDEX_STATE_ID,
  DISPATCHER_INDEX_LOCK_ID,
  DISPATCHER_INDEX_STATE_ID,
} from '@/server/dispatcher-task-index-constants'
import {
  createDispatcherTaskIndexStage,
  createDispatcherTaskIndexStageWriter,
  getDispatcherTaskIndexStageTable,
} from '@/server/dispatcher-task-index-staging'

type DispatcherBackgroundExecutor = Pick<ReturnType<typeof requireDb>, 'insert' | 'delete'>

export type DispatcherBackgroundTaskIndexStatus = {
  enabled: boolean
  status: 'idle' | 'running' | 'failed' | 'disabled'
  computedAt: string | null
  startedAt: string | null
  lastError: string | null
  rowCount: number
}

export type DispatcherBackgroundRefreshResult = DispatcherBackgroundTaskIndexStatus & {
  refreshed: boolean
}

type DispatcherBackgroundStatusRow = {
  computedAt: Date | string | null
  lastError: string | null
  rowCount: number | string
  settingValue: string | null
  startedAt: Date | string | null
  status: string
}

export async function getDispatcherBackgroundTaskIndexStatus(): Promise<DispatcherBackgroundTaskIndexStatus> {
  const db = requireDb()
  const result = await db.execute<DispatcherBackgroundStatusRow>(sql`
    with "ensure_background_state" as (
      insert into ${dispatcherBackgroundTaskIndexState} ("id")
      values (${DISPATCHER_BACKGROUND_INDEX_STATE_ID})
      on conflict ("id") do nothing
      returning "status", "computed_at", "started_at", "last_error"
    ),
    "background_state" as (
      select "status", "computed_at", "started_at", "last_error"
      from "ensure_background_state"
      union all
      select "status", "computed_at", "started_at", "last_error"
      from ${dispatcherBackgroundTaskIndexState}
      where "id" = ${DISPATCHER_BACKGROUND_INDEX_STATE_ID}
        and not exists (select 1 from "ensure_background_state")
    )
    select
      "state"."status" as "status",
      "state"."computed_at" as "computedAt",
      "state"."started_at" as "startedAt",
      "state"."last_error" as "lastError",
      (
        select count(distinct "tasks"."weld_joint_id")::int
        from ${dispatcherBackgroundRowTasks} as "tasks"
      ) as "rowCount",
      (
        select "settings"."value"
        from ${appSettings} as "settings"
        where "settings"."key" = ${PROJECT_SETTING_KEYS.dispatcherBackground}
        limit 1
      ) as "settingValue"
    from "background_state" as "state"
  `)
  const state = result.rows[0]
  const setting = parseSettingValue(state?.settingValue ?? undefined)
  const enabled = normalizeDispatcherBackgroundSettings(setting).enabled
  return {
    enabled,
    status: enabled ? normalizeStatus(state?.status) : 'disabled',
    computedAt: toIsoString(state?.computedAt),
    startedAt: toIsoString(state?.startedAt),
    lastError: state?.lastError ?? null,
    rowCount: Number(state?.rowCount) || 0,
  }
}

export async function refreshDispatcherBackgroundTaskIndex(
  options: { force?: boolean } = {},
): Promise<DispatcherBackgroundRefreshResult> {
  const db = requireDb()
  const setting = normalizeDispatcherBackgroundSettings(await listBackgroundSetting())
  if (!setting.enabled) {
    await clearDispatcherBackgroundTaskIndex()
    return { ...(await getDispatcherBackgroundTaskIndexStatus()), refreshed: false }
  }

  try {
    const activeState = await ensureDispatcherTaskIndexFresh()
    if (activeState.computedRevision !== activeState.sourceRevision) {
      return { ...(await getDispatcherBackgroundTaskIndexStatus()), refreshed: false }
    }
    const refreshed = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${DISPATCHER_BACKGROUND_INDEX_LOCK_ID})`)
      await tx
        .insert(dispatcherBackgroundTaskIndexState)
        .values({ id: DISPATCHER_BACKGROUND_INDEX_STATE_ID })
        .onConflictDoNothing()
      await tx
        .insert(dispatcherTaskIndexState)
        .values({ id: DISPATCHER_INDEX_STATE_ID })
        .onConflictDoNothing()

      const [state] = await tx
        .select()
        .from(dispatcherBackgroundTaskIndexState)
        .where(eq(dispatcherBackgroundTaskIndexState.id, DISPATCHER_BACKGROUND_INDEX_STATE_ID))
        .limit(1)
      const [sourceState] = await tx
        .select({
          sourceRevision: dispatcherTaskIndexState.sourceRevision,
          computedRevision: dispatcherTaskIndexState.computedRevision,
        })
        .from(dispatcherTaskIndexState)
        .where(eq(dispatcherTaskIndexState.id, DISPATCHER_INDEX_STATE_ID))
        .limit(1)
      if (!sourceState || sourceState.computedRevision !== sourceState.sourceRevision) return false
      if (!shouldRefreshDispatcherBackgroundIndex(state?.computedAt, {
        computedSourceRevision: state?.computedSourceRevision,
        force: options.force,
        sourceRevision: sourceState?.sourceRevision ?? 0,
      })) {
        return false
      }

      const [dispatcherSettingRow] = await tx
        .select({ value: appSettings.value })
        .from(appSettings)
        .where(eq(appSettings.key, PROJECT_SETTING_KEYS.dispatcher))
        .limit(1)
      const disabledSettings = buildDisabledDispatcherSettings(
        normalizeDispatcherSettings(parseSettingValue(dispatcherSettingRow?.value) ?? DEFAULT_DISPATCHER_SETTINGS),
      )
      const hasDisabledRowChecks = Object.values(disabledSettings).some(Boolean)

      const startedAt = new Date()
      await tx
        .update(dispatcherBackgroundTaskIndexState)
        .set({ status: 'running', startedAt, lastError: null, updatedAt: startedAt })
        .where(eq(dispatcherBackgroundTaskIndexState.id, DISPATCHER_BACKGROUND_INDEX_STATE_ID))

      await createDispatcherTaskIndexStage(tx, 'background')
      const taskIndexWriter = createDispatcherTaskIndexStageWriter(tx, 'background')
      if (hasDisabledRowChecks) {
        await calculateFullDispatcherTasks(tx, {
          dispatcherSettings: buildDisabledDispatcherSettings,
          includeWelderStampExpiryTasks: false,
          taskSnapshotLimit: 0,
          onTaskIndexRows: taskIndexWriter.append,
        })
        await taskIndexWriter.flush()
      }

      // Do not block ordinary saves while the disabled-rule calculation runs.
      // The shared dispatcher lock is needed only to validate the source
      // revision and atomically replace the persisted background index.
      await lockWeldJointWritesForDispatcherReplacement(tx)
      await tx.execute(sql`select pg_advisory_xact_lock(${DISPATCHER_INDEX_LOCK_ID})`)
      const [lockedSourceState] = await tx
        .select({
          sourceRevision: dispatcherTaskIndexState.sourceRevision,
          computedRevision: dispatcherTaskIndexState.computedRevision,
        })
        .from(dispatcherTaskIndexState)
        .where(eq(dispatcherTaskIndexState.id, DISPATCHER_INDEX_STATE_ID))
        .limit(1)
      if (
        !lockedSourceState ||
        lockedSourceState.sourceRevision !== sourceState.sourceRevision ||
        lockedSourceState.computedRevision !== lockedSourceState.sourceRevision
      ) {
        const stoppedAt = new Date()
        await tx
          .update(dispatcherBackgroundTaskIndexState)
          .set({ status: 'idle', startedAt: null, updatedAt: stoppedAt })
          .where(eq(dispatcherBackgroundTaskIndexState.id, DISPATCHER_BACKGROUND_INDEX_STATE_ID))
        return false
      }

      await tx.delete(dispatcherBackgroundRowTasks)
      const taskIndexStage = getDispatcherTaskIndexStageTable('background')
      await tx.execute(sql`
        insert into ${dispatcherBackgroundRowTasks} ("weld_joint_id", "task_key", "code")
        select "weld_joint_id", "task_key", "code"
        from ${taskIndexStage}
        on conflict do nothing
      `)
      const computedAt = new Date()

      await tx
        .update(dispatcherBackgroundTaskIndexState)
        .set({
          status: 'idle',
          computedSourceRevision: lockedSourceState.sourceRevision,
          computedAt,
          startedAt: null,
          lastError: null,
          updatedAt: computedAt,
        })
        .where(eq(dispatcherBackgroundTaskIndexState.id, DISPATCHER_BACKGROUND_INDEX_STATE_ID))
      return true
    })
    return { ...(await getDispatcherBackgroundTaskIndexStatus()), refreshed }
  } catch (error) {
    const failedAt = new Date()
    const message = error instanceof Error ? error.message : String(error)
    await db
      .insert(dispatcherBackgroundTaskIndexState)
      .values({
        id: DISPATCHER_BACKGROUND_INDEX_STATE_ID,
        status: 'failed',
        lastError: message,
        updatedAt: failedAt,
      })
      .onConflictDoUpdate({
        target: dispatcherBackgroundTaskIndexState.id,
        set: { status: 'failed', startedAt: null, lastError: message, updatedAt: failedAt },
      })
    throw error
  }
}

export async function applyDispatcherBackgroundSetting(
  enabled: boolean,
  executor: DispatcherBackgroundExecutor = requireDb(),
) {
  if (enabled) {
    await executor
      .insert(dispatcherBackgroundTaskIndexState)
      .values({ id: DISPATCHER_BACKGROUND_INDEX_STATE_ID, status: 'idle' })
      .onConflictDoUpdate({
        target: dispatcherBackgroundTaskIndexState.id,
        set: { status: 'idle', lastError: null, updatedAt: new Date() },
      })
    return
  }
  await executor.delete(dispatcherBackgroundRowTasks)
  await executor
    .insert(dispatcherBackgroundTaskIndexState)
    .values({ id: DISPATCHER_BACKGROUND_INDEX_STATE_ID, status: 'disabled' })
    .onConflictDoUpdate({
      target: dispatcherBackgroundTaskIndexState.id,
      set: {
        status: 'disabled',
        computedSourceRevision: -1,
        computedAt: null,
        startedAt: null,
        lastError: null,
        updatedAt: new Date(),
      },
    })
}

export async function pruneEnabledDispatcherBackgroundTasks(
  settings: DispatcherSettings,
  executor: Pick<ReturnType<typeof requireDb>, 'delete'> = requireDb(),
) {
  const enabledCodes = getEnabledDispatcherTaskCodes(settings)
  if (enabledCodes.length === 0) return
  await executor
    .delete(dispatcherBackgroundRowTasks)
    .where(inArray(dispatcherBackgroundRowTasks.code, enabledCodes))
}

async function clearDispatcherBackgroundTaskIndex() {
  await requireDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${DISPATCHER_BACKGROUND_INDEX_LOCK_ID})`)
    await applyDispatcherBackgroundSetting(false, tx)
  })
}

async function listBackgroundSetting() {
  const [row] = await requireDb()
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, PROJECT_SETTING_KEYS.dispatcherBackground))
    .limit(1)
  return parseSettingValue(row?.value)
}

function parseSettingValue(value: string | undefined) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function normalizeStatus(value: unknown): DispatcherBackgroundTaskIndexStatus['status'] {
  return value === 'running' || value === 'failed' || value === 'disabled' ? value : 'idle'
}

function toIsoString(value: Date | string | null | undefined) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}
