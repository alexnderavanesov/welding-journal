import { sql, type SQL } from 'drizzle-orm'

import { PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'

type ControlProcessSettingsLockExecutor = {
  execute: (query: SQL) => PromiseLike<unknown>
}

export type ControlProcessLockName = 'layeredControl' | 'preHeatTreatmentLnk'

export async function lockControlProcessSettings(
  executor: ControlProcessSettingsLockExecutor,
  process: ControlProcessLockName,
  mode: 'shared' | 'exclusive' = 'shared',
) {
  const key = `${PROJECT_SETTING_KEYS.controlProcesses}:${process}`
  await executor.execute(mode === 'exclusive'
    ? sql`select pg_advisory_xact_lock(hashtext(${key}))`
    : sql`select pg_advisory_xact_lock_shared(hashtext(${key}))`)
}
