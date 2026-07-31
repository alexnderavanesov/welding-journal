import { createServerFn } from '@tanstack/react-start'
import { asc, desc } from 'drizzle-orm'
import { requireDb } from '@/db'
import {
  appSettings,
  duplicateControls,
  dispatcherAcceptedWarnings,
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
  type DispatcherReminderSettings,
  type DispatcherSettings,
} from '@/lib/dispatcher-settings'
import { buildVisibleDispatcherTasks, getDispatcherTaskRowIds } from '@/lib/dispatcher-task-builder'
import type { RepeatedJointTask } from '@/lib/dispatcher-types'
import type { DuplicateControlRecord } from '@/lib/duplicate-control-types'
import { PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'
import {
  DEFAULT_SAVE_CHECK_SETTINGS,
  normalizeSaveCheckSettings,
  type SaveCheckSettings,
} from '@/lib/save-check-settings'
import { prepareReportRows } from '@/lib/use-report-rows'
import { getDuplicateKeys } from '@/lib/weld-table-utils'
import type { WelderStampDlsPermit, WelderStampNaksPermit, WelderStampRecord, WelderStampSuspensionRecord } from '@/lib/welder-stamp-types'

export type DispatcherTaskSnapshotRequest = {
  dismissedRepeatedJointTaskKeys?: string[]
  dispatcherSettings?: Partial<DispatcherSettings>
  dispatcherReminderSettings?: Partial<DispatcherReminderSettings>
  saveCheckSettings?: Partial<SaveCheckSettings>
}

export type DispatcherTaskSnapshotResult = {
  rowIds: number[]
  duplicateKeys: string[]
  repeatedJointTasks: RepeatedJointTask[]
  repeatedTaskCount: number
  welderStampExpiryTaskCount: number
  computedAt: string
}

export const getDispatcherTaskSnapshot = createServerFn({ method: 'GET' })
  .validator((data: DispatcherTaskSnapshotRequest | undefined) => data ?? {})
  .handler(async ({ data }): Promise<DispatcherTaskSnapshotResult> => {
    const db = requireDb()
    const [rows, stampRows, suspensionRows, duplicateRows, acceptedWarnings, settingsRows] = await Promise.all([
      db
        .select()
        .from(weldJoints)
        .orderBy(desc(weldJoints.weldDate), asc(weldJoints.line), asc(weldJoints.joint)),
      db.select().from(welderStamps).orderBy(asc(welderStamps.id)),
      db.select().from(welderStampSuspensions).orderBy(asc(welderStampSuspensions.id)),
      db.select().from(duplicateControls).orderBy(asc(duplicateControls.weldJointId), asc(duplicateControls.id)),
      db.select().from(dispatcherAcceptedWarnings).orderBy(asc(dispatcherAcceptedWarnings.acceptedAt)),
      db.select().from(appSettings),
    ])
    const dispatcherSettings = getDispatcherSettings(settingsRows, data.dispatcherSettings)
    const dispatcherReminderSettings = getDispatcherReminderSettings(settingsRows, data.dispatcherReminderSettings)
    const saveCheckSettings = getSaveCheckSettings(settingsRows, data.saveCheckSettings)
    const preparedRows = prepareReportRows(rows, duplicateRows.map(toDuplicateControlRecord))
    const tasks = buildVisibleDispatcherTasks({
      acceptedDispatcherWarningKeys: new Set(acceptedWarnings.map((row) => row.key)),
      dismissedRepeatedJointTaskKeys: new Set(data.dismissedRepeatedJointTaskKeys ?? []),
      dispatcherReminderSettings,
      dispatcherSettings,
      rows: preparedRows,
      saveCheckSettings,
      welderStamps: stampRows.map(toWelderStampRecord),
      welderStampSuspensions: suspensionRows.map(toWelderStampSuspensionRecord),
    })
    const rowIds = [...getDispatcherTaskRowIds(tasks.repeatedJointTasks)].sort((left, right) => left - right)

    return {
      rowIds,
      duplicateKeys: [...getDuplicateKeys(preparedRows)].sort(),
      repeatedJointTasks: tasks.repeatedJointTasks,
      repeatedTaskCount: tasks.repeatedJointTasks.length,
      welderStampExpiryTaskCount: tasks.welderStampExpiryTasks.length,
      computedAt: new Date().toISOString(),
    }
  })

function getDispatcherSettings(rows: AppSetting[], fallback?: Partial<DispatcherSettings>) {
  return normalizeDispatcherSettings(fallback ?? getStoredSetting(rows, PROJECT_SETTING_KEYS.dispatcher) ?? DEFAULT_DISPATCHER_SETTINGS)
}

function getDispatcherReminderSettings(rows: AppSetting[], fallback?: Partial<DispatcherReminderSettings>) {
  return normalizeDispatcherReminderSettings(
    fallback ?? getStoredSetting(rows, PROJECT_SETTING_KEYS.dispatcherReminders) ?? DEFAULT_DISPATCHER_REMINDER_SETTINGS,
  )
}

function getSaveCheckSettings(rows: AppSetting[], fallback?: Partial<SaveCheckSettings>) {
  return normalizeSaveCheckSettings(
    fallback ?? getStoredSetting(rows, PROJECT_SETTING_KEYS.saveCheck) ?? DEFAULT_SAVE_CHECK_SETTINGS,
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
