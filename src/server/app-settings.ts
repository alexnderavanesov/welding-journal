import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import {
  projectSettingAffectsDerivedCalculations,
  projectSettingAffectsDispatcherIndex,
} from '@/lib/project-settings-remote'
import {
  invalidateDerivedCalculationCache,
  markDispatcherTaskIndexDirty,
} from '@/server/dispatcher-task-index-dirty'

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
}

const assertSettingsSecurityScope = createServerOnlyFn(async () => {
  const { assertSecurityScope } = await import('@/server/security')
  await assertSecurityScope('settings')
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

async function listAppSettingsFromDb() {
  const { requireDb } = await import('@/db')
  const { appSettings } = await import('@/db/schema')
  const rows = await requireDb().select().from(appSettings)
  return Object.fromEntries(rows.map((row) => [row.key, parseStoredSetting(row.value)])) as AppSettingsMap
}

async function saveAppSettingToDb({ key, value }: AppSettingPayload) {
  await assertSettingsSecurityScope()
  const { sql } = await import('drizzle-orm')
  const { requireDb } = await import('@/db')
  const { appSettings } = await import('@/db/schema')
  const normalizedKey = normalizeSettingKey(key)
  if (!normalizedKey) throw new Error('Setting key is required')

  await requireDb().transaction(async (tx) => {
    await tx
      .insert(appSettings)
      .values({
        key: normalizedKey,
        value: serializeSettingValue(value),
      })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: {
          value: serializeSettingValue(value),
          updatedAt: sql`now()`,
        },
      })
    if (projectSettingAffectsDispatcherIndex(normalizedKey)) {
      await markDispatcherTaskIndexDirty(tx)
    } else if (projectSettingAffectsDerivedCalculations(normalizedKey)) {
      await invalidateDerivedCalculationCache(tx)
    }
  })

  return { key: normalizedKey, value }
}

async function saveAppSettingsToDb(settings: AppSettingsMap) {
  await assertSettingsSecurityScope()
  const entries = Object.entries(settings).filter(([key]) => normalizeSettingKey(key))
  if (entries.length === 0) return listAppSettingsFromDb()

  const { sql } = await import('drizzle-orm')
  const { requireDb } = await import('@/db')
  const { appSettings } = await import('@/db/schema')
  await requireDb().transaction(async (tx) => {
    for (const [key, value] of entries) {
      const normalizedKey = normalizeSettingKey(key)
      await tx
        .insert(appSettings)
        .values({
          key: normalizedKey,
          value: serializeSettingValue(value),
        })
        .onConflictDoUpdate({
          target: appSettings.key,
          set: {
            value: serializeSettingValue(value),
            updatedAt: sql`now()`,
          },
        })
    }
    if (entries.some(([key]) => projectSettingAffectsDispatcherIndex(normalizeSettingKey(key)))) {
      await markDispatcherTaskIndexDirty(tx)
    } else if (entries.some(([key]) => projectSettingAffectsDerivedCalculations(normalizeSettingKey(key)))) {
      await invalidateDerivedCalculationCache(tx)
    }
  })
  return listAppSettingsFromDb()
}

export const listAppSettings = createServerFn({ method: 'GET' }).handler(async () => listAppSettingsFromDb())

export const saveAppSetting = createServerFn({ method: 'POST' })
  .validator((data: AppSettingPayload) => data)
  .handler(async ({ data }) => saveAppSettingToDb(data))

export const saveAppSettings = createServerFn({ method: 'POST' })
  .validator((data: { settings: AppSettingsMap }) => data)
  .handler(async ({ data }) => saveAppSettingsToDb(data.settings))
