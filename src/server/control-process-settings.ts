import { eq } from 'drizzle-orm'

import {
  appSettings,
} from '@/db/schema'
import {
  DEFAULT_CONTROL_PROCESS_SETTINGS,
  normalizeControlProcessSettings,
} from '@/lib/control-process-settings'
import { PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'
import {
  lockAllControlProcessSettings,
  lockControlProcessSettings,
} from '@/server/control-process-settings-lock'
import type { GeneratedDocumentsTransaction } from '@/server/generated-document-number-sequence'

export async function loadControlProcessSettingsFromTransaction(
  tx: Pick<GeneratedDocumentsTransaction, 'execute' | 'select'>,
) {
  await lockAllControlProcessSettings(tx)
  const [stored] = await tx
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, PROJECT_SETTING_KEYS.controlProcesses))
    .limit(1)
  if (!stored) return DEFAULT_CONTROL_PROCESS_SETTINGS
  try {
    return normalizeControlProcessSettings(JSON.parse(stored.value))
  } catch {
    return DEFAULT_CONTROL_PROCESS_SETTINGS
  }
}

export async function prepareControlProcessSettingsChangeInTransaction({
  tx,
  currentValue,
  nextValue,
  processLocksAlreadyHeld = false,
}: {
  tx: GeneratedDocumentsTransaction
  currentValue: unknown
  nextValue: unknown
  processLocksAlreadyHeld?: boolean
}) {
  const current = normalizeControlProcessSettings(currentValue)
  const next = normalizeControlProcessSettings(nextValue)
  const pvkGoodOnlyChanged = current.pvkGoodOnly !== next.pvkGoodOnly

  if (pvkGoodOnlyChanged && !processLocksAlreadyHeld) {
    await lockControlProcessSettings(tx, 'layeredControl', 'exclusive')
  }

  return next
}
