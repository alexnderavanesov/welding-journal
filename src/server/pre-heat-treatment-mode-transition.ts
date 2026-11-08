import { eq, isNull } from 'drizzle-orm'
import { appSettings, weldJoints } from '@/db/schema'
import { normalizeControlProcessSettings } from '@/lib/control-process-settings'
import { PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'
import { lockAllControlProcessSettings } from './control-process-settings-lock'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'

/** Explicit release preparation only; preserves the old implicit enabled default. */
export async function initializePreHeatTreatmentMode(tx: SystemDocumentSequenceTransaction) {
  await lockAllControlProcessSettings(tx)
  const [stored] = await tx.select().from(appSettings).where(eq(appSettings.key, PROJECT_SETTING_KEYS.controlProcesses)).limit(1)
  let previous: Record<string, unknown> | null = null
  try { previous = stored ? JSON.parse(stored.value) : null } catch { /* old defaults */ }
  if (previous?.preHeatTreatmentMode === 'selected' || previous?.preHeatTreatmentMode === 'allPsto') return { skipped: true }
  const [legacy] = await tx.select({ id: weldJoints.id }).from(weldJoints).where(isNull(weldJoints.preHeatTreatmentRequired)).limit(1)
  const next = normalizeControlProcessSettings(previous ?? (legacy ? {} : null))
  await tx.insert(appSettings).values({ key: PROJECT_SETTING_KEYS.controlProcesses, value: JSON.stringify(next) })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: JSON.stringify(next), updatedAt: new Date() } })
  return { skipped: false, mode: next.preHeatTreatmentMode }
}
