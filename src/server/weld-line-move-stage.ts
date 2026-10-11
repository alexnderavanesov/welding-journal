import { preHeatTreatmentControls, weldJoints, type WeldJoint } from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import {
  assertPstoCancellationDateAfterHistory,
  buildPstoAssignedKeepPrimaryValidationRow,
  buildPstoMovedToCancelledLineRow,
  buildPstoMovedToUnassignedLineRow,
  getPstoLineIdentityKey,
  hasPerformedPstoHistory,
  normalizePstoLineIdentity,
  normalizePstoLineMoveTargetIdentity,
  hasPrimaryLnkHistoryBeforePstoAssignment,
  type PstoWeldLineMoveDisposition,
} from '@/lib/psto-line-assignment'
import { calculateFinalStatus } from '@/lib/weld-status'
import { buildPstoContextualStageCorrection } from '@/lib/psto-contextual-stage-correction'
import { loadControlProcessSettingsFromTransaction } from '@/server/control-process-settings'
import { type SystemDocumentSequenceTransaction } from '@/server/system-document-sequences'
import { hasPstoLifecycleHistory, loadServerWeldValidationContext } from '@/server/weld-save-validation'
import { and, sql } from 'drizzle-orm'
import { normalizePstoLineIdentityPart } from '@/lib/psto-line-assignment'
import { removeSourcedSystemDocumentPositionsInTransaction } from '@/server/system-document-index'
import { buildNumberArrayMatch } from '@/server/weld-request-utils'
import { WELDING_PROFILE_FIELD_KEYS } from '@/server/weld-mutation-policy'

export function buildWeldLineIdentityWhere(identity: ReturnType<typeof normalizePstoLineIdentity>) {
  return and(
    sql`lower(btrim(coalesce(${weldJoints.projectTitle}, ''))) = ${normalizePstoLineIdentityPart(identity.projectTitle)}`,
    sql`lower(btrim(coalesce(${weldJoints.subtitleCode}, ''))) = ${normalizePstoLineIdentityPart(identity.subtitleCode)}`,
    sql`lower(btrim(coalesce(${weldJoints.line}, ''))) = ${normalizePstoLineIdentityPart(identity.line)}`,
  )
}

export async function preparePstoLineMoveRecordInTransaction({
  record: inputRecord,
  previousStored,
  validationContext,
  processSettings,
  disposition,
}: {
  tx: SystemDocumentSequenceTransaction
  record: WeldRow
  previousStored: WeldJoint
  validationContext: Awaited<ReturnType<typeof loadServerWeldValidationContext>>
  processSettings: Awaited<ReturnType<typeof loadControlProcessSettingsFromTransaction>>
  disposition?: PstoWeldLineMoveDisposition
}) {
  const previous = previousStored as unknown as WeldRow
  let record: WeldRow = { ...inputRecord, ...normalizePstoLineMoveTargetIdentity(inputRecord) }
  let validationPrevious = previousStored
  const targetIdentity = normalizePstoLineIdentity(record)
  const targetLineState = targetIdentity.line
    ? validationContext.pstoLineAssignments.get(getPstoLineIdentityKey(targetIdentity))
    : undefined
  const targetLineAssigned = Boolean(
    targetLineState &&
    targetLineState.rowCount > 0 &&
    targetLineState.assignedCount === targetLineState.rowCount,
  )
  const targetLineCancelled = Boolean(
    targetLineState &&
    targetLineState.rowCount > 0 &&
    targetLineState.cancelledCount === targetLineState.rowCount,
  )
  const identityChanged = getPstoLineIdentityKey(previous) !== getPstoLineIdentityKey(targetIdentity)
  if (disposition !== undefined && disposition !== 'keepPrimary' && disposition !== 'movePreHeatTreatmentToPrimary') {
    throw new Error('Смена этапа НК больше не поддерживается. Обновите окно: при смене линии все этапы сохраняются.')
  }
  const actuallyChanged = getPstoLineIdentityKey(normalizePstoLineMoveTargetIdentity(previous)) !== getPstoLineIdentityKey(targetIdentity)
  if (disposition === 'movePreHeatTreatmentToPrimary' && (
    !actuallyChanged || targetLineAssigned || !targetIdentity.projectTitle || !targetIdentity.subtitleCode || !targetIdentity.line
  )) {
    throw new Error('Исправление НК до ТО доступно только при переносе стыка на другую линию без ПСТО. Проверьте целевую линию.')
  }
  const preservesPrimaryHistory = (
    processSettings.preHeatTreatmentLnkEnabled &&
    identityChanged &&
    targetLineAssigned &&
    hasPrimaryLnkHistoryBeforePstoAssignment(previous)
  )
  const preservesLifecycleHistory = identityChanged && !targetLineAssigned && hasPstoLifecycleHistory(previousStored)

  if (preservesPrimaryHistory) {
    // Existing main control stays historical; new work still uses the normal stage prerequisites.
    validationPrevious = buildPstoAssignedKeepPrimaryValidationRow(previous) as unknown as WeldJoint
  }

  if (preservesLifecycleHistory) {
    const controls = previous.preHeatTreatmentControls ?? []
    const preservesPerformedHistory = hasPerformedPstoHistory(previous)
    if (targetLineCancelled && (preservesPerformedHistory || disposition === 'movePreHeatTreatmentToPrimary')) {
      assertPstoCancellationDateAfterHistory(
        [previous],
        String(targetLineState?.cancellationDate ?? '').trim(),
      )
    }
    const moveRow = {
      ...record,
      duplicateControls: previous.duplicateControls ?? [],
      preHeatTreatmentControls: controls,
      pstoRepeatCycles: previous.pstoRepeatCycles ?? [],
    } as WeldRow
    const preservedRecord = targetLineCancelled
      ? buildPstoMovedToCancelledLineRow({
          row: moveRow,
          controls,
          cancellationDate: targetLineState?.cancellationDate ?? '',
          cancellationBasis: targetLineState?.cancellationBasis ?? '',
        })
      : buildPstoMovedToUnassignedLineRow({ row: moveRow, controls })
    preservedRecord.finalStatus = calculateFinalStatus(preservedRecord)
    record = preservedRecord

    if (disposition === 'movePreHeatTreatmentToPrimary') {
      try {
        record = buildPstoContextualStageCorrection(record, 'primary', processSettings, validationContext.systemIndexSettings)
      } catch (error) {
        throw new Error(`Стык ${record.joint || `#${record.id}`}: ${error instanceof Error ? error.message : String(error)}`)
      }
      // Strict chronology above checks the actual draft, including a changed weld date.
      record.finalStatus = calculateFinalStatus(record)
    }

    validationPrevious = {
      ...record,
      // Only stage/assignment changes form the validation baseline. Keep original
      // editable values so a simultaneous weld-date, stamp or officiality edit
      // cannot be mistaken for unchanged history and bypass ordinary validation.
      ...Object.fromEntries(WELDING_PROFILE_FIELD_KEYS.map(key => [key, previous[key]])),
      officiality: previous.officiality,
      projectTitle: previous.projectTitle,
      subtitleCode: previous.subtitleCode,
      line: previous.line,
    } as unknown as WeldJoint
  }
  if (disposition === 'movePreHeatTreatmentToPrimary' && !preservesLifecycleHistory) {
    throw new Error('Комплект НК до ТО больше не найден. Обновите окно переноса.')
  }

  return {
    record,
    validationPrevious,
    preservesLifecycleHistory,
    preserveRecordedControlHistory: actuallyChanged,
    transferredPreControlIds: disposition === 'movePreHeatTreatmentToPrimary'
      ? (previous.preHeatTreatmentControls ?? []).map(control => control.id)
      : [],
  }
}

/** Call once per transaction, after validating every weld, never once per chain row. */
export async function removeTransferredPreControlsInTransaction(
  tx: SystemDocumentSequenceTransaction,
  controlIds: readonly number[],
) {
  const ids = [...new Set(controlIds)]
  if (ids.length === 0) return
  await removeSourcedSystemDocumentPositionsInTransaction({ tx, sourceKind: 'beforeHeatTreatment', relationIds: ids })
  await tx.delete(preHeatTreatmentControls).where(buildNumberArrayMatch(preHeatTreatmentControls.id, ids))
}
