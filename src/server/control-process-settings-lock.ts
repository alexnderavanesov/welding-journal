import { sql, type SQL } from 'drizzle-orm'

import { PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'

type ControlProcessSettingsLockExecutor = {
  execute: (query: SQL) => PromiseLike<unknown>
}

export type ControlProcessLockName = 'layeredControl' | 'preHeatTreatmentLnk'

export const CONTROL_PROCESS_LOCK_ORDER: readonly ControlProcessLockName[] = [
  'preHeatTreatmentLnk',
  'layeredControl',
]

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

export async function lockAllControlProcessSettings(
  executor: ControlProcessSettingsLockExecutor,
  mode: 'shared' | 'exclusive' = 'shared',
) {
  for (const process of CONTROL_PROCESS_LOCK_ORDER) {
    await lockControlProcessSettings(executor, process, mode)
  }
}
