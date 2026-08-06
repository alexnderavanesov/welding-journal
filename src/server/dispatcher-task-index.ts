import { asc, countDistinct, desc, eq, notInArray, sql } from 'drizzle-orm'
import { requireDb } from '@/db'
import {
  appSettings,
  dispatcherAcceptedWarnings,
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
} from '@/lib/dispatcher-settings'
import { buildVisibleDispatcherTasks } from '@/lib/dispatcher-task-builder'
import {
  buildDispatcherTaskIndexRows,
  compareDispatcherTaskCodes,
} from '@/lib/dispatcher-task-row-codes'
import type { RepeatedJointTask, WeldRow, WelderStampExpiryTask } from '@/lib/dispatcher-types'
import type { DuplicateControlRecord } from '@/lib/duplicate-control-types'
import { PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'
import { prepareReportRows } from '@/lib/use-report-rows'
import { getDuplicateKeys } from '@/lib/weld-table-utils'
import type {
  WelderStampDlsPermit,
  WelderStampNaksPermit,
  WelderStampRecord,
  WelderStampSuspensionRecord,
} from '@/lib/welder-stamp-types'
import {
  DISPATCHER_INDEX_LOCK_ID,
  DISPATCHER_INDEX_STATE_ID,
} from '@/server/dispatcher-task-index-constants'
import { markDispatcherTaskIndexDirty } from '@/server/dispatcher-task-index-dirty'

const INSERT_CHUNK_SIZE = 1_000

export type DispatcherTaskIndexSnapshot = {
  duplicateKeys: string[]
  repeatedJointTasks: RepeatedJointTask[]
  taskFilterOptions: Array<{ value: string; count: number; label: string }>
  welderStampExpiryTasks: WelderStampExpiryTask[]
  computedAt: string
}

export async function getDispatcherTaskIndexSnapshot(
  dismissedTaskKeys: readonly string[] = [],
): Promise<DispatcherTaskIndexSnapshot> {
  const db = requireDb()
  const state = await ensureDispatcherTaskIndexFresh()
  const dismissedKeys = [...new Set(dismissedTaskKeys.map((key) => key.trim()).filter(Boolean))]
  const rowTaskWhere = dismissedKeys.length > 0
    ? notInArray(dispatcherRowTasks.taskKey, dismissedKeys)
    : undefined
  const taskOptionRows = await db
    .select({
      value: dispatcherRowTasks.code,
      count: countDistinct(dispatcherRowTasks.weldJointId),
    })
    .from(dispatcherRowTasks)
    .where(rowTaskWhere)
    .groupBy(dispatcherRowTasks.code)
    .orderBy(asc(dispatcherRowTasks.code))

  const dismissedSet = new Set(dismissedKeys)
  const repeatedJointTasks = parseJsonArray<RepeatedJointTask>(state.repeatedTasks).filter(
    (task) => !dismissedSet.has(task.key),
  )
  const welderStampExpiryTasks = parseJsonArray<WelderStampExpiryTask>(state.welderStampExpiryTasks).filter(
    (task) => !dismissedSet.has(task.key),
  )
  const taskFilterOptions = taskOptionRows
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
  const db = requireDb()
  await db
    .insert(dispatcherTaskIndexState)
    .values({ id: DISPATCHER_INDEX_STATE_ID })
    .onConflictDoNothing()

  let [state] = await db
    .select()
    .from(dispatcherTaskIndexState)
    .where(eq(dispatcherTaskIndexState.id, DISPATCHER_INDEX_STATE_ID))
    .limit(1)

  if (isDispatcherTaskIndexFresh(state)) return state

  state = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${DISPATCHER_INDEX_LOCK_ID})`)
    const [lockedState] = await tx
      .select()
      .from(dispatcherTaskIndexState)
      .where(eq(dispatcherTaskIndexState.id, DISPATCHER_INDEX_STATE_ID))
      .limit(1)
    if (isDispatcherTaskIndexFresh(lockedState)) return lockedState

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
    const tasks = buildVisibleDispatcherTasks({
      acceptedDispatcherWarningKeys: new Set(acceptedWarnings.map((row) => row.key)),
      dismissedRepeatedJointTaskKeys: new Set(),
      dispatcherReminderSettings: getDispatcherReminderSettings(settingsRows),
      dispatcherSettings: getDispatcherSettings(settingsRows),
      rows: preparedRows,
      welderStamps: stampRows.map(toWelderStampRecord),
      welderStampSuspensions: suspensionRows.map(toWelderStampSuspensionRecord),
    })
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
        repeatedTasks: JSON.stringify(compactRepeatedTasks),
        welderStampExpiryTasks: JSON.stringify(tasks.welderStampExpiryTasks),
        duplicateKeys: JSON.stringify([...getDuplicateKeys(preparedRows)].sort()),
        computedAt,
        updatedAt: computedAt,
      })
      .where(eq(dispatcherTaskIndexState.id, DISPATCHER_INDEX_STATE_ID))
      .returning()
    return updatedState
  })

  return state
}

function isDispatcherTaskIndexFresh(state: typeof dispatcherTaskIndexState.$inferSelect | undefined) {
  if (!state || state.computedRevision !== state.sourceRevision || !state.computedAt) return false
  return state.computedAt.toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10)
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
