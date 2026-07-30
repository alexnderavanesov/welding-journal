import { createServerFn } from '@tanstack/react-start'

export type AppSettingsMap = Record<string, unknown>

export type AppSettingPayload = {
  key: string
  value: unknown
}

function parseStoredSetting(value: string) {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

function normalizeSettingKey(value: unknown) {
  return String(value ?? '').trim()
}

function serializeSettingValue(value: unknown) {
  return JSON.stringify(value ?? null)
}

async function listAppSettingsFromDb() {
  const { requireDb } = await import('@/db')
  const { appSettings } = await import('@/db/schema')
  const rows = await requireDb().select().from(appSettings)
  return Object.fromEntries(rows.map((row) => [row.key, parseStoredSetting(row.value)])) as AppSettingsMap
}

async function saveAppSettingToDb({ key, value }: AppSettingPayload) {
  const { sql } = await import('drizzle-orm')
  const { requireDb } = await import('@/db')
  const { appSettings } = await import('@/db/schema')
  const normalizedKey = normalizeSettingKey(key)
  if (!normalizedKey) throw new Error('Setting key is required')

  await requireDb()
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

  return { key: normalizedKey, value }
}

async function saveAppSettingsToDb(settings: AppSettingsMap) {
  const entries = Object.entries(settings).filter(([key]) => normalizeSettingKey(key))
  for (const [key, value] of entries) {
    await saveAppSettingToDb({ key, value })
  }
  return listAppSettingsFromDb()
}

export const listAppSettings = createServerFn({ method: 'GET' }).handler(async () => listAppSettingsFromDb())

export const saveAppSetting = createServerFn({ method: 'POST' })
  .validator((data: AppSettingPayload) => data)
  .handler(async ({ data }) => saveAppSettingToDb(data))

export const saveAppSettings = createServerFn({ method: 'POST' })
  .validator((data: { settings: AppSettingsMap }) => data)
  .handler(async ({ data }) => saveAppSettingsToDb(data.settings))
