import { sql, type SQL } from 'drizzle-orm'
import { preHeatTreatmentControls, weldJoints, type NewWeldJoint } from '@/db/schema'
import { isControlEnabledValue, normalizeControlAvailabilityStorageText } from '@/lib/control-availability-values'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { PstoLineActivationDecision } from '@/lib/psto-line-assignment'
import { calculateFinalStatus } from '@/lib/weld-status'
import { buildPstoContextualStageCorrection } from '@/lib/psto-contextual-stage-correction'
import { LNK_METHODS } from '@/lib/lnk-report-config'
import { isPreHeatTreatmentLnkMethodCode } from '@/lib/lnk-control-stage'
import { splitWeldImportInsertBatches } from '@/lib/weld-import-limits'
import type { loadProgramSystemIndexSettings } from './line-program'
import type { loadControlProcessSettingsFromTransaction } from './control-process-settings'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'
import { captureTransferredSpecialists, restoreTransferredSpecialists } from './document-specialist-transfers'
import { removeTransferredPreControlsInTransaction } from './weld-line-move-stage'
import { syncSystemDocumentsForWeldChangesInTransaction } from './system-document-index'
import { syncPreHeatTreatmentDocumentsInTransaction } from './pre-heat-treatment-system-documents'
import { assertStoredEarlyCoilDecisionSourcesRemainValid } from './early-coil-decision-guard'
import { WELD_TABLE_COLUMNS, WELD_TABLE_RETURNING } from './weld-server-shared'

/** Shared transition for a whole line and a chain exception. Only an explicit
 * validated decision transfers the existing NK package and its specialists. */
export async function applyPstoAssignmentRows(
  tx: SystemDocumentSequenceTransaction,
  rows: WeldRow[], nextRows: WeldRow[], decisions: PstoLineActivationDecision[],
  processSettings: Awaited<ReturnType<typeof loadControlProcessSettingsFromTransaction>>,
  systemIndexSettings: Awaited<ReturnType<typeof loadProgramSystemIndexSettings>>,
) {
  const previousRows = new Map(rows.map(row => [row.id, row]))
  const decisionsById = new Map(decisions.map(decision => [decision.rowId, decision]))
  if (decisionsById.size !== decisions.length || decisions.some(decision => !previousRows.has(decision.rowId))) {
    throw new Error('Решение о НК содержит повторный стык или стык вне выбранной цепочки/линии.')
  }
  const toPre = new Set<number>(), toPrimary = new Set<number>()
  nextRows = nextRows.map(row => {
    const disposition = decisionsById.get(row.id)?.disposition ?? 'keepPrimary'
    if (disposition === 'keepPrimary') return row
    const required = isControlEnabledValue(row.pstoRequired)
    const wasRequired = isControlEnabledValue(previousRows.get(row.id)!.pstoRequired)
    if (required === wasRequired || disposition !== (required ? 'movePrimaryToPreHeatTreatment' : 'movePreHeatTreatmentToPrimary')) {
      throw new Error(`Стык ${row.joint}: назначение ПСТО не меняется в выбранном направлении; исправление этапа недоступно.`)
    }
    const target = required ? 'beforeHeatTreatment' : 'primary'
    const corrected = buildPstoContextualStageCorrection(row, target, processSettings, systemIndexSettings)
    ;(required ? toPre : toPrimary).add(row.id)
    return corrected
  })
  const pending = nextRows.flatMap(row => (row.preHeatTreatmentControls ?? []).filter(control => control.id < 0))
  const savedControls: Array<typeof preHeatTreatmentControls.$inferSelect> = []
  for (const batch of splitWeldImportInsertBatches(pending.map(({ id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...control }) => control))) {
    savedControls.push(...await tx.insert(preHeatTreatmentControls).values(batch).returning())
  }
  if (savedControls.length !== pending.length) throw new Error('Не удалось перенести весь комплект НК. Ничего не сохранено.')
  const savedByRow = groupByRowId(savedControls)
  for (const row of nextRows) if (toPre.has(row.id)) row.preHeatTreatmentControls = savedByRow.get(row.id) ?? []
  const primarySpecialists = await captureTransferredSpecialists(tx, [...toPrimary], 'primary', decisions.find(d => toPrimary.has(d.rowId))?.specialistTransferConfirmation)
  const preSpecialists = await captureTransferredSpecialists(tx, [...toPre], 'beforeHeatTreatment', decisions.find(d => toPre.has(d.rowId))?.specialistTransferConfirmation)
  const updatedRows = await persistPstoLineAssignmentRows(tx, nextRows, new Date(), new Set([...toPre, ...toPrimary]))
  if (toPre.size || toPrimary.size) {
    await removeTransferredPreControlsInTransaction(tx, rows.filter(row => toPrimary.has(row.id)).flatMap(row => (row.preHeatTreatmentControls ?? []).map(c => c.id)))
    await syncSystemDocumentsForWeldChangesInTransaction(tx, updatedRows, previousRows)
    if (toPre.size) await syncPreHeatTreatmentDocumentsInTransaction(tx, updatedRows, savedControls)
    await restoreTransferredSpecialists(tx, primarySpecialists)
    await restoreTransferredSpecialists(tx, preSpecialists)
  }
  await assertStoredEarlyCoilDecisionSourcesRemainValid(tx, rows.map(row => row.id))
  return updatedRows
}

const PSTO_LINE_ASSIGNMENT_UPDATE_FIELD_KEYS = [
  'pstoRequired',
  'pstoExceptionBasis',
  'pstoControlBasis',
  'pstoCancellationDate',
  'finalStatus',
  'pstoCreatedAt',
  'pstoUpdatedAt',
  'updatedAt',
] as const satisfies readonly (keyof NewWeldJoint)[]

const PSTO_LINE_ASSIGNMENT_UPDATE_SET = Object.fromEntries(
  PSTO_LINE_ASSIGNMENT_UPDATE_FIELD_KEYS.map((fieldKey) => [
    fieldKey,
    sql.raw(`excluded."${WELD_TABLE_COLUMNS[fieldKey].name}"`),
  ]),
) as Partial<Record<keyof NewWeldJoint, SQL>>

const CORRECTED_PRIMARY_FIELDS = [
  ...LNK_METHODS.filter(method => isPreHeatTreatmentLnkMethodCode(method.code)).flatMap(method => [
    method.requestKey, method.requestDateKey, method.resultKey, method.conclusionDateKey,
    method.conclusionKey, method.defectDescriptionKey,
  ]),
  'rkExposureConfirmedDiameter', 'lnkUpdatedAt',
] as const
const CORRECTED_PRIMARY_UPDATE_SET = Object.fromEntries(CORRECTED_PRIMARY_FIELDS.map(key => [
  key, sql.raw(`excluded."${WELD_TABLE_COLUMNS[key].name}"`),
]))

export async function persistPstoLineAssignmentRows(
  tx: SystemDocumentSequenceTransaction,
  rows: WeldRow[],
  now = new Date(),
  transferredRowIds: ReadonlySet<number> = new Set(),
) {
  if (rows.length === 0) return []
  const payloads = rows.map((row) => {
    const values: Record<string, unknown> = {
      id: row.id,
      pstoRequired: normalizeControlAvailabilityStorageText(row.pstoRequired),
      pstoExceptionBasis: textOrNull(row.pstoExceptionBasis),
      pstoControlBasis: textOrNull(row.pstoControlBasis),
      pstoCancellationDate: textOrNull(row.pstoCancellationDate),
      finalStatus: textOrNull(calculateFinalStatus(row)),
      pstoCreatedAt: isControlEnabledValue(row.pstoRequired)
        ? timestampOrNull(row.pstoCreatedAt) ?? now
        : timestampOrNull(row.pstoCreatedAt),
      pstoUpdatedAt: now,
      updatedAt: now,
    }
    return Object.fromEntries([
      ['id', row.id],
      ...PSTO_LINE_ASSIGNMENT_UPDATE_FIELD_KEYS.map((fieldKey) => [
        fieldKey,
        values[fieldKey] ?? null,
      ]),
      ...(transferredRowIds.has(row.id) ? CORRECTED_PRIMARY_FIELDS.map(key => [
        key, key === 'lnkUpdatedAt' ? now : row[key] ?? null,
      ]) : []),
    ]) as NewWeldJoint
  })

  const savedRows: WeldRow[] = []
  const groups = [payloads.filter(row => !transferredRowIds.has(Number(row.id))), payloads.filter(row => transferredRowIds.has(Number(row.id)))]
  for (const batch of groups.flatMap(group => splitWeldImportInsertBatches(group))) {
    const saved = await tx
      .insert(weldJoints)
      .values(batch)
      .onConflictDoUpdate({
        target: weldJoints.id,
        set: transferredRowIds.has(Number(batch[0]?.id))
          ? { ...PSTO_LINE_ASSIGNMENT_UPDATE_SET, ...CORRECTED_PRIMARY_UPDATE_SET }
          : PSTO_LINE_ASSIGNMENT_UPDATE_SET,
      })
      .returning(WELD_TABLE_RETURNING)
    if (saved.length !== batch.length) {
      throw new Error('Не удалось сохранить всю линию ПСТО. Ничего не сохранено.')
    }
    savedRows.push(...saved as WeldRow[])
  }

  const savedRowsById = new Map(savedRows.map((row) => [row.id, row]))
  return rows.map((row) => {
    const saved = savedRowsById.get(row.id)
    if (!saved) throw new Error(`Стык #${row.id} больше не существует. Обновите программу ПСТО.`)
    return {
      ...saved,
      preHeatTreatmentControls: row.preHeatTreatmentControls ?? [],
      pstoRepeatCycles: row.pstoRepeatCycles ?? [],
      duplicateControls: row.duplicateControls ?? [],
    } as WeldRow
  })
}

function groupByRowId<Row extends { weldJointId: number }>(records: Row[]) {
  const groups = new Map<number, Row[]>()
  for (const record of records) {
    const current = groups.get(record.weldJointId) ?? []
    current.push(record)
    groups.set(record.weldJointId, current)
  }
  return groups
}

function textOrNull(value: unknown) {
  const text = String(value ?? '').trim()
  return text || null
}

function timestampOrNull(value: unknown) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null
  const text = String(value ?? '').trim()
  if (!text) return null
  const timestamp = new Date(text)
  return Number.isFinite(timestamp.getTime()) ? timestamp : null
}
