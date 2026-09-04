import { sql, type SQL } from 'drizzle-orm'

import { PROJECT_SETTING_KEYS, type ProjectSettingKey } from '@/lib/project-settings-remote'

type SettingsLockExecutor = {
  execute: (query: SQL) => PromiseLike<unknown>
}

const WELD_VALIDATION_SETTINGS_LOCK_KEY = 'weld-validation-settings'

const WELD_VALIDATION_SETTING_KEYS = new Set<ProjectSettingKey>([
  PROJECT_SETTING_KEYS.dataList,
  PROJECT_SETTING_KEYS.other,
  PROJECT_SETTING_KEYS.saveCheck,
  PROJECT_SETTING_KEYS.systemIndex,
])

export function projectSettingAffectsWeldValidationSnapshot(key: unknown) {
  return WELD_VALIDATION_SETTING_KEYS.has(key as ProjectSettingKey)
}

export async function lockWeldValidationSettings(
  executor: SettingsLockExecutor,
  mode: 'shared' | 'exclusive' = 'shared',
) {
  await executor.execute(mode === 'exclusive'
    ? sql`select pg_advisory_xact_lock(hashtext(${WELD_VALIDATION_SETTINGS_LOCK_KEY}))`
    : sql`select pg_advisory_xact_lock_shared(hashtext(${WELD_VALIDATION_SETTINGS_LOCK_KEY}))`)
}
