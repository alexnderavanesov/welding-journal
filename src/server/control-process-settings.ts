import { count, eq, sql } from 'drizzle-orm'

import { requireDb } from '@/db'
import {
  appSettings,
  preHeatTreatmentControls,
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
import { rebuildAllLayeredControlDocumentsInTransaction } from '@/server/layered-control-documents'
import type { GeneratedDocumentsTransaction } from '@/server/generated-document-number-sequence'
import { assertSecurityScope } from '@/server/security-functions'

export type ControlProcessSettingsOverview = {
  preHeatTreatmentBlockerCount: number
}

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
  const requestedNext = normalizeControlProcessSettings(nextValue)
  const next = requestedNext.preHeatTreatmentLnkEnabled
    ? requestedNext
    : {
        ...requestedNext,
        allowPrimaryLnkBeforePreviousStagesComplete: false,
      }
  const preHeatTreatmentChanged = (
    current.preHeatTreatmentLnkEnabled !== next.preHeatTreatmentLnkEnabled
  )
  const layeredControlChanged = current.layeredControlEnabled !== next.layeredControlEnabled

  // Keep this order aligned with weld mutations that can touch both processes.
  if (preHeatTreatmentChanged && !processLocksAlreadyHeld) {
    await lockControlProcessSettings(tx, 'preHeatTreatmentLnk', 'exclusive')
  }
  if (layeredControlChanged && !processLocksAlreadyHeld) {
    await lockControlProcessSettings(tx, 'layeredControl', 'exclusive')
  }

  if (current.preHeatTreatmentLnkEnabled && !next.preHeatTreatmentLnkEnabled) {
    const blockerCount = await countPreHeatTreatmentDisableBlockers(tx)
    if (blockerCount > 0) {
      throw new Error(
        `НК до ТО нельзя выключить: незавершенных заявок или негодных результатов — ${blockerCount}. ` +
        'Сначала завершите или исправьте их в отчете ЛНК.',
      )
    }
  }

  if (!current.layeredControlEnabled && next.layeredControlEnabled) {
    await rebuildAllLayeredControlDocumentsInTransaction(tx, { allowCreate: true })
  }

  return next
}

export async function countPreHeatTreatmentDisableBlockers(
  tx: Pick<GeneratedDocumentsTransaction, 'select'>,
) {
  const [summary] = await tx
    .select({ total: count() })
    .from(preHeatTreatmentControls)
    .where(sql`lower(btrim(coalesce(${preHeatTreatmentControls.result}, ''))) <> 'годен'`)
  return Number(summary?.total ?? 0)
}

export async function getControlProcessSettingsOverview() {
  await assertSecurityScope('entry')
  const db = requireDb()
  return {
    preHeatTreatmentBlockerCount: await countPreHeatTreatmentDisableBlockers(db),
  } satisfies ControlProcessSettingsOverview
}

export async function getPreHeatTreatmentDisableBlockerRowIds() {
  await assertSecurityScope('entry')
  const db = requireDb()
  const blockerRows = await db
    .selectDistinct({ id: preHeatTreatmentControls.weldJointId })
    .from(preHeatTreatmentControls)
    .where(sql`lower(btrim(coalesce(${preHeatTreatmentControls.result}, ''))) <> 'годен'`)
    .orderBy(preHeatTreatmentControls.weldJointId)
  return blockerRows.map((row) => Number(row.id)).filter(Number.isFinite)
}
