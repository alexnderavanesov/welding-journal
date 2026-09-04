import { inArray } from 'drizzle-orm'

import { appSettings } from '@/db/schema'
import {
  DEFAULT_OTHER_SETTINGS,
  normalizeOtherSettings,
} from '@/lib/other-settings'
import { PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'
import {
  DEFAULT_SAVE_CHECK_SETTINGS,
  normalizeSaveCheckSettings,
} from '@/lib/save-check-settings'
import {
  DEFAULT_SYSTEM_INDEX_SETTINGS,
  normalizeSystemIndexSettings,
} from '@/lib/system-index-settings'
import type { SystemDocumentSequenceTransaction } from '@/server/system-document-sequences'
import { lockWeldValidationSettings } from '@/server/weld-validation-settings-lock'

type WorkflowSettingsDb = Pick<SystemDocumentSequenceTransaction, 'execute' | 'select'>

export async function loadWeldWorkflowSettingsFromTransaction(db: WorkflowSettingsDb) {
  await lockWeldValidationSettings(db)
  const rows = await db
    .select({ key: appSettings.key, value: appSettings.value })
    .from(appSettings)
    .where(inArray(appSettings.key, [
      PROJECT_SETTING_KEYS.other,
      PROJECT_SETTING_KEYS.saveCheck,
      PROJECT_SETTING_KEYS.systemIndex,
    ]))
  const values = new Map(rows.map((row) => [row.key, parseStoredValue(row.value)]))
  const otherSettings = values.has(PROJECT_SETTING_KEYS.other)
    ? normalizeOtherSettings(values.get(PROJECT_SETTING_KEYS.other))
    : DEFAULT_OTHER_SETTINGS
  const saveCheckSettings = values.has(PROJECT_SETTING_KEYS.saveCheck)
    ? normalizeSaveCheckSettings(
        values.get(PROJECT_SETTING_KEYS.saveCheck),
        { officialDlsFallback: otherSettings.requireDlsForOfficialStamps },
      )
    : {
        ...DEFAULT_SAVE_CHECK_SETTINGS,
        officialDls: otherSettings.requireDlsForOfficialStamps,
      }
  const systemIndexSettings = values.has(PROJECT_SETTING_KEYS.systemIndex)
    ? normalizeSystemIndexSettings(values.get(PROJECT_SETTING_KEYS.systemIndex))
    : DEFAULT_SYSTEM_INDEX_SETTINGS
  return { otherSettings, saveCheckSettings, systemIndexSettings }
}

function parseStoredValue(value: string) {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}
