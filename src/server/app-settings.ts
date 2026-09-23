import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import {
  projectSettingAffectsDerivedCalculations,
  projectSettingAffectsDispatcherIndex,
  PROJECT_SETTING_KEYS,
  PROJECT_SETTING_KEY_VALUES,
  isProjectSettingKey,
} from '@/lib/project-settings-remote'
import { normalizeDispatcherBackgroundSettings } from '@/lib/dispatcher-background-settings'
import {
  invalidateDerivedCalculationCache,
  markDispatcherTaskIndexDirty,
} from '@/server/dispatcher-task-index-dirty'
import { DISPATCHER_BACKGROUND_INDEX_LOCK_ID } from '@/server/dispatcher-task-index-constants'
import { getNextTimestampVersion } from '@/server/timestamp-version'
import {
  lockWeldValidationSettings,
  projectSettingAffectsWeldValidationSnapshot,
} from '@/server/weld-validation-settings-lock'

export type AppSettingValue =
  | string
  | number
  | boolean
  | null
  | AppSettingValue[]
  | { [key: string]: AppSettingValue }

export type AppSettingsMap = Record<string, AppSettingValue>

export type AppSettingPayload = {
  key: string
  value: AppSettingValue
  expectedUpdatedAt: string | null
}

export type AppSettingsSnapshot = {
  values: AppSettingsMap
  updatedAt: Record<string, string>
}

const assertSettingsSecurityScope = createServerOnlyFn(async () => {
  const { assertSecurityScope } = await import('@/server/security')
  await assertSecurityScope('settings')
})

const assertEntrySecurityScope = createServerOnlyFn(async () => {
  const { assertSecurityScope } = await import('@/server/security')
  await assertSecurityScope('entry')
})

function parseStoredSetting(value: string) {
  try {
    return JSON.parse(value) as AppSettingValue
  } catch {
    return null
  }
}

function normalizeSettingKey(value: unknown) {
  return String(value ?? '').trim()
}

function serializeSettingValue(value: AppSettingValue) {
  return JSON.stringify(value ?? null)
}

async function listAppSettingsSnapshotFromDb(): Promise<AppSettingsSnapshot> {
  const { inArray } = await import('drizzle-orm')
  const { requireDb } = await import('@/db')
  const { appSettings } = await import('@/db/schema')
  const rows = await requireDb()
    .select()
    .from(appSettings)
    .where(inArray(appSettings.key, PROJECT_SETTING_KEY_VALUES))
  return {
    values: Object.fromEntries(rows.map((row) => [row.key, parseStoredSetting(row.value)])),
    updatedAt: Object.fromEntries(rows.map((row) => [row.key, row.updatedAt.toISOString()])),
  }
}

async function saveAppSettingToDb({ key, value, expectedUpdatedAt }: AppSettingPayload) {
  await assertSettingsSecurityScope()
  const { eq, sql } = await import('drizzle-orm')
  const { requireDb } = await import('@/db')
  const { appSettings } = await import('@/db/schema')
  const normalizedKey = normalizeSettingKey(key)
  if (!normalizedKey) throw new Error('Setting key is required')
  if (!isProjectSettingKey(normalizedKey)) {
    throw new Error('Эта настройка изменяется только через специальный защищенный раздел.')
  }

  const savedResult = await requireDb().transaction(async (tx) => {
    if (normalizedKey === PROJECT_SETTING_KEYS.controlProcesses) {
      const { lockAllControlProcessSettings } = await import('@/server/control-process-settings-lock')
      await lockAllControlProcessSettings(tx, 'exclusive')
    }
    if (projectSettingAffectsWeldValidationSnapshot(normalizedKey)) {
      await lockWeldValidationSettings(tx, 'exclusive')
    }
    if (normalizedKey === PROJECT_SETTING_KEYS.dispatcher ||
      normalizedKey === PROJECT_SETTING_KEYS.dispatcherBackground) {
      // Settings may prune or disable background rows after dirtying the active
      // index. Serialize with background refresh before acquiring the index lock.
      await tx.execute(sql`select pg_advisory_xact_lock(${DISPATCHER_BACKGROUND_INDEX_LOCK_ID})`)
    }
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${normalizedKey}))`)
    const [current] = await tx
      .select({ value: appSettings.value, updatedAt: appSettings.updatedAt })
      .from(appSettings)
      .where(eq(appSettings.key, normalizedKey))
      .limit(1)
      .for('update')
    assertAppSettingVersion(current?.updatedAt.toISOString() ?? null, expectedUpdatedAt)
    const nextUpdatedAt = current ? getNextTimestampVersion(current.updatedAt) : new Date()
    let preparedValue = value
    if (normalizedKey === PROJECT_SETTING_KEYS.saveCheck) {
      const { normalizeSaveCheckSettings } = await import('@/lib/save-check-settings')
      preparedValue = prepareAppSettingValue(normalizeSaveCheckSettings(value))
    }
    if (normalizedKey === PROJECT_SETTING_KEYS.controlProcesses) {
      const { prepareControlProcessSettingsChangeInTransaction } = await import('@/server/control-process-settings')
      preparedValue = prepareAppSettingValue(await prepareControlProcessSettingsChangeInTransaction({
        tx,
        currentValue: current ? parseStoredSetting(current.value) : undefined,
        nextValue: value,
        processLocksAlreadyHeld: true,
      }))
    }
    const [saved] = await tx
      .insert(appSettings)
      .values({
        key: normalizedKey,
        value: serializeSettingValue(preparedValue),
        updatedAt: nextUpdatedAt,
      })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: {
          value: serializeSettingValue(preparedValue),
          updatedAt: nextUpdatedAt,
        },
      })
      .returning({ updatedAt: appSettings.updatedAt })
    if (projectSettingAffectsDispatcherIndex(normalizedKey)) {
      await markDispatcherTaskIndexDirty(tx)
    } else if (projectSettingAffectsDerivedCalculations(normalizedKey)) {
      await invalidateDerivedCalculationCache(tx)
    }
    if (normalizedKey === PROJECT_SETTING_KEYS.dispatcherBackground) {
      const { applyDispatcherBackgroundSetting } = await import('@/server/dispatcher-background-task-index')
      await applyDispatcherBackgroundSetting(normalizeDispatcherBackgroundSettings(preparedValue).enabled, tx)
    }
    if (normalizedKey === PROJECT_SETTING_KEYS.dispatcher) {
      const { normalizeDispatcherSettings } = await import('@/lib/dispatcher-settings')
      const { pruneEnabledDispatcherBackgroundTasks } = await import('@/server/dispatcher-background-task-index')
      await pruneEnabledDispatcherBackgroundTasks(normalizeDispatcherSettings(preparedValue), tx)
    }
    return {
      value: preparedValue,
      updatedAt: saved?.updatedAt.toISOString() ?? null,
    }
  })

  return {
    key: normalizedKey,
    value: savedResult.value,
    updatedAt: savedResult.updatedAt,
  }
}

function prepareAppSettingValue(value: unknown): AppSettingValue {
  return value as AppSettingValue
}

export const listAppSettingsSnapshot = createServerFn({ method: 'GET' }).handler(async () => {
  await assertEntrySecurityScope()
  return listAppSettingsSnapshotFromDb()
})

export const saveAppSetting = createServerFn({ method: 'POST' })
  .validator((data: AppSettingPayload) => data)
  .handler(async ({ data }) => saveAppSettingToDb(data))

export function assertAppSettingVersion(
  currentRevision: string | null,
  expectedRevision: string | null | undefined,
) {
  if (currentRevision !== expectedRevision) {
    throw new Error('Настройка уже изменена другим пользователем. Свежие данные загружены; повторите изменение.')
  }
}
