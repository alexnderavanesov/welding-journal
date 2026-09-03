import { count, eq, inArray, sql } from 'drizzle-orm'

import { requireDb } from '@/db'
import {
  appSettings,
  preHeatTreatmentControls,
  pstoRepeatCycles,
  weldJoints,
} from '@/db/schema'
import {
  DEFAULT_CONTROL_PROCESS_SETTINGS,
  normalizeControlProcessSettings,
  type ControlProcessSettings,
} from '@/lib/control-process-settings'
import {
  getPstoLineIdentityKey,
  normalizePstoLineIdentity,
} from '@/lib/psto-line-assignment'
import { PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'
import type { WeldInput } from '@/lib/weld-fields'
import { lockControlProcessSettings } from '@/server/control-process-settings-lock'
import { rebuildAllLayeredControlDocumentsInTransaction } from '@/server/layered-control-documents'
import type { GeneratedDocumentsTransaction } from '@/server/generated-document-number-sequence'
import { splitNumberBatches } from '@/server/weld-request-utils'
import { assertSecurityScope } from '@/server/security-functions'

type ControlProcessRow = Pick<
  typeof weldJoints.$inferSelect,
  | 'id'
  | 'projectTitle'
  | 'subtitleCode'
  | 'line'
  | 'pstoRequest'
  | 'pstoRequestDate'
  | 'pstoDate'
  | 'heatTreatmentDiagram'
  | 'pstoResult'
  | 'pstoNote'
  | 'tvmtRequest'
  | 'tvmtRequestDate'
  | 'tvmtResult'
  | 'tvmtConclusionDate'
  | 'tvmtConclusion'
>

export type ControlProcessSettingsOverview = {
  preHeatTreatmentBlockerCount: number
}

export async function loadControlProcessSettingsFromTransaction(
  tx: Pick<GeneratedDocumentsTransaction, 'execute' | 'select'>,
) {
  await lockControlProcessSettings(tx, 'preHeatTreatmentLnk')
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

export async function getPreHeatTreatmentLnkExemptionsForNewRows(
  tx: Pick<GeneratedDocumentsTransaction, 'execute' | 'select'>,
  rows: readonly Pick<WeldInput, 'projectTitle' | 'subtitleCode' | 'line'>[],
) {
  if (rows.length === 0) return []
  const settings = await loadControlProcessSettingsFromTransaction(tx)
  if (!settings.preHeatTreatmentLnkEnabled) return rows.map(() => true)

  const exemptLines = await tx
    .select({
      projectTitle: weldJoints.projectTitle,
      subtitleCode: weldJoints.subtitleCode,
      line: weldJoints.line,
    })
    .from(weldJoints)
    .where(eq(weldJoints.preHeatTreatmentLnkExempt, true))
    .groupBy(weldJoints.projectTitle, weldJoints.subtitleCode, weldJoints.line)
  const exemptLineKeys = new Set(exemptLines.map(getPstoLineIdentityKey))

  return rows.map((row) => {
    const identity = normalizePstoLineIdentity(row)
    return Boolean(identity.line) && exemptLineKeys.has(getPstoLineIdentityKey(identity))
  })
}

export async function getPreHeatTreatmentLnkExemptionForNewRow(
  tx: Pick<GeneratedDocumentsTransaction, 'execute' | 'select'>,
  row: Pick<WeldInput, 'projectTitle' | 'subtitleCode' | 'line'>,
) {
  const [exempt = false] = await getPreHeatTreatmentLnkExemptionsForNewRows(tx, [row])
  return exempt
}

export async function prepareControlProcessSettingsChangeInTransaction({
  tx,
  currentValue,
  nextValue,
}: {
  tx: GeneratedDocumentsTransaction
  currentValue: unknown
  nextValue: unknown
}) {
  const current = normalizeControlProcessSettings(currentValue)
  const next = normalizeControlProcessSettings(nextValue)
  const preHeatTreatmentChanged = (
    current.preHeatTreatmentLnkEnabled !== next.preHeatTreatmentLnkEnabled
  )
  const layeredControlChanged = current.layeredControlEnabled !== next.layeredControlEnabled

  // Keep this order aligned with weld mutations that can touch both processes.
  if (preHeatTreatmentChanged) {
    await lockControlProcessSettings(tx, 'preHeatTreatmentLnk', 'exclusive')
  }
  if (layeredControlChanged) {
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
    await tx
      .update(weldJoints)
      .set({ preHeatTreatmentLnkExempt: true, updatedAt: new Date() })
  } else if (!current.preHeatTreatmentLnkEnabled && next.preHeatTreatmentLnkEnabled) {
    await restorePreHeatTreatmentRequirementsForUnstartedLines(tx)
  }

  if (!current.layeredControlEnabled && next.layeredControlEnabled) {
    await rebuildAllLayeredControlDocumentsInTransaction(tx, { allowCreate: true })
  }

  return next
}

export function isControlProcessPstoStarted(row: Partial<ControlProcessRow>) {
  return [
    row.pstoRequest,
    row.pstoRequestDate,
    row.pstoDate,
    row.heatTreatmentDiagram,
    row.pstoResult,
    row.pstoNote,
    row.tvmtRequest,
    row.tvmtRequestDate,
    row.tvmtResult,
    row.tvmtConclusionDate,
    row.tvmtConclusion,
  ].some(hasText)
}

export function getPreHeatTreatmentExemptionIdsToRetain(
  rows: readonly ControlProcessRow[],
  repeatCycleWeldIds: ReadonlySet<number> = new Set(),
) {
  const startedLineKeys = new Set(
    rows
      .filter((row) => isControlProcessPstoStarted(row) || repeatCycleWeldIds.has(row.id))
      .map((row) => getPstoLineIdentityKey(row as WeldInput)),
  )
  return rows
    .filter((row) => startedLineKeys.has(getPstoLineIdentityKey(row as WeldInput)))
    .map((row) => row.id)
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

async function restorePreHeatTreatmentRequirementsForUnstartedLines(
  tx: GeneratedDocumentsTransaction,
) {
  const rows = await tx
    .select({
      id: weldJoints.id,
      projectTitle: weldJoints.projectTitle,
      subtitleCode: weldJoints.subtitleCode,
      line: weldJoints.line,
      pstoRequest: weldJoints.pstoRequest,
      pstoRequestDate: weldJoints.pstoRequestDate,
      pstoDate: weldJoints.pstoDate,
      heatTreatmentDiagram: weldJoints.heatTreatmentDiagram,
      pstoResult: weldJoints.pstoResult,
      pstoNote: weldJoints.pstoNote,
      tvmtRequest: weldJoints.tvmtRequest,
      tvmtRequestDate: weldJoints.tvmtRequestDate,
      tvmtResult: weldJoints.tvmtResult,
      tvmtConclusionDate: weldJoints.tvmtConclusionDate,
      tvmtConclusion: weldJoints.tvmtConclusion,
    })
    .from(weldJoints)
    .where(eq(weldJoints.preHeatTreatmentLnkExempt, true))
  if (rows.length === 0) return

  const rowIds = rows.map((row) => row.id)
  const repeatRows = await tx
    .select({ weldJointId: pstoRepeatCycles.weldJointId })
    .from(pstoRepeatCycles)
    .where(inArray(pstoRepeatCycles.weldJointId, rowIds))
  const retainIds = new Set(getPreHeatTreatmentExemptionIdsToRetain(
    rows,
    new Set(repeatRows.map((row) => row.weldJointId)),
  ))
  const releaseIds = rowIds.filter((id) => !retainIds.has(id))

  for (const batch of splitNumberBatches(releaseIds, 1000)) {
    await tx
      .update(weldJoints)
      .set({ preHeatTreatmentLnkExempt: false, updatedAt: new Date() })
      .where(inArray(weldJoints.id, batch))
  }
}

function hasText(value: unknown) {
  return String(value ?? '').trim().length > 0
}
