import { preHeatTreatmentControls, weldJoints, type WeldJoint } from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import {
  buildPrimaryToPreHeatTreatmentTransfer,
  findBlockingLnkStageTransferChronologyIssue,
  type LnkStageTransferControlWrite,
} from '@/lib/lnk-stage-transfer'
import {
  assertPstoCancellationDateAfterHistory,
  buildPstoAssignedKeepPrimaryValidationRow,
  buildPstoMovedToCancelledLineRow,
  buildPstoMovedToUnassignedLineRow,
  getPrimaryStagedMethodCodes,
  getPstoLineIdentityKey,
  hasPerformedPstoHistory,
  normalizePstoLineIdentity,
  requiresPrimaryStageResolutionForAssignedPstoLine,
  type PstoWeldLineMoveDisposition,
} from '@/lib/psto-line-assignment'
import { calculateFinalStatus } from '@/lib/weld-status'
import { loadControlProcessSettingsFromTransaction } from '@/server/control-process-settings'
import { removeSourcedSystemDocumentPositionsInTransaction } from '@/server/system-document-index'
import { type SystemDocumentSequenceTransaction } from '@/server/system-document-sequences'
import { hasPstoLifecycleHistory, loadServerWeldValidationContext } from '@/server/weld-save-validation'
import { buildNumberArrayMatch } from '@/server/weld-request-utils'
import { and, sql } from 'drizzle-orm'
import { normalizePstoLineIdentityPart } from '@/lib/psto-line-assignment'

export function buildWeldLineIdentityWhere(identity: ReturnType<typeof normalizePstoLineIdentity>) {
  return and(
    sql`lower(btrim(coalesce(${weldJoints.projectTitle}, ''))) = ${normalizePstoLineIdentityPart(identity.projectTitle)}`,
    sql`lower(btrim(coalesce(${weldJoints.subtitleCode}, ''))) = ${normalizePstoLineIdentityPart(identity.subtitleCode)}`,
    sql`lower(btrim(coalesce(${weldJoints.line}, ''))) = ${normalizePstoLineIdentityPart(identity.line)}`,
  )
}

export function assertChainLineMoveLnkStageTransfersAllowed(
  records: WeldRow[],
  previousRows: ReadonlyMap<number, WeldJoint>,
  decisions: ReadonlyMap<number, PstoWeldLineMoveDisposition>,
) {
  for (const record of records) {
    const disposition = decisions.get(record.id)
    const targetStage = disposition === 'movePrimaryToBeforeHeatTreatment'
      ? 'beforeHeatTreatment'
      : disposition === 'promoteBeforeHeatTreatment'
        ? 'primary'
        : null
    if (!targetStage) continue
    const previous = previousRows.get(record.id)
    if (!previous) continue
    const issue = findBlockingLnkStageTransferChronologyIssue({
      previousRows: [previous as unknown as WeldRow],
      nextRows: [record],
      targetStage,
    })
    if (issue) {
      throw new Error(`Перенос цепочки невозможен: смена этапа ЛНК нарушает данные. ${issue.message}`)
    }
  }
}

export async function preparePstoLineMoveRecordInTransaction({
  tx,
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
  const id = previousStored.id
  const previous = previousStored as unknown as WeldRow
  let record = inputRecord
  let validationPrevious = previousStored
  let pendingPreHeatTreatmentControls: LnkStageTransferControlWrite[] = []
  const cleanup: PstoLineMoveCleanupPlan = {
    preHeatTreatmentControlIds: [],
    preHeatTreatmentWeldJointId: null,
  }
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
  if (
    disposition === 'movePrimaryToBeforeHeatTreatment' &&
    !targetLineAssigned
  ) {
    throw new Error('Назначение ПСТО целевой линии изменилось. Вернитесь к форме и проверьте линию еще раз.')
  }
  const requiresPrimaryStageResolution = (
    processSettings.preHeatTreatmentLnkEnabled &&
    identityChanged &&
    targetLineAssigned &&
    requiresPrimaryStageResolutionForAssignedPstoLine(previous)
  )
  const requiresLifecycleCleanup = identityChanged && !targetLineAssigned && hasPstoLifecycleHistory(previousStored)

  if (requiresPrimaryStageResolution) {
    if (
      disposition !== 'keepPrimary' &&
      disposition !== 'movePrimaryToBeforeHeatTreatment'
    ) {
      throw new Error(
        `Стык ${String(previous.joint ?? '').trim() || `#${id}`}: выберите, сохранить основной комплект, ` +
        'или перенести его в «До ТО». Удаление документов выполняется отдельно.',
      )
    }
    const positions = getPrimaryStagedMethodCodes(previous).map((methodCode) => ({
      rowId: id,
      methodCode,
    }))
    const moveRow = {
      ...record,
      duplicateControls: previous.duplicateControls ?? [],
      preHeatTreatmentControls: previous.preHeatTreatmentControls ?? [],
      pstoRepeatCycles: previous.pstoRepeatCycles ?? [],
    } as WeldRow

    if (disposition === 'keepPrimary') {
      record = moveRow
      validationPrevious = buildPstoAssignedKeepPrimaryValidationRow(previous) as unknown as WeldJoint
    } else if (disposition === 'movePrimaryToBeforeHeatTreatment') {
      const transfer = buildPrimaryToPreHeatTreatmentTransfer({
        rows: [moveRow],
        positions,
      })
      pendingPreHeatTreatmentControls = transfer.controls
      record = {
        ...transfer.rows[0]!,
        preHeatTreatmentControls: transfer.controls.map((control, index) => ({
          ...control,
          id: -(id * 10_000 + index + 1),
        })),
      }
    }
  }

  if (requiresLifecycleCleanup) {
    if (disposition !== 'keepPrimary' && disposition !== 'promoteBeforeHeatTreatment') {
      throw new Error(
        `Стык ${String(previous.joint ?? '').trim() || `#${id}`}: выберите перенос НК до ТО в основной ` +
        'либо сохранение всех этапов и истории при смене линии.',
      )
    }
    const controls = previous.preHeatTreatmentControls ?? []
    const preservesPerformedHistory = hasPerformedPstoHistory(previous)
    if (targetLineCancelled && preservesPerformedHistory) {
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
    const cleanedRecord = targetLineCancelled
      ? buildPstoMovedToCancelledLineRow({
          row: moveRow,
          controls,
          disposition,
          cancellationDate: targetLineState?.cancellationDate ?? '',
          cancellationBasis: targetLineState?.cancellationBasis ?? '',
        })
      : buildPstoMovedToUnassignedLineRow({ row: moveRow, controls, disposition })
    cleanedRecord.finalStatus = calculateFinalStatus(cleanedRecord)
    record = cleanedRecord

    validationPrevious = {
      ...cleanedRecord,
      projectTitle: previous.projectTitle,
      subtitleCode: previous.subtitleCode,
      line: previous.line,
    } as unknown as WeldJoint

    if (disposition === 'promoteBeforeHeatTreatment' && controls.length > 0) {
      cleanup.preHeatTreatmentControlIds = controls.map((control) => control.id)
      cleanup.preHeatTreatmentWeldJointId = id
    }
  }

  return {
    record,
    validationPrevious,
    pendingPreHeatTreatmentControls,
    requiresLifecycleCleanup,
    cleanup,
  }
}

export type PstoLineMoveCleanupPlan = {
  preHeatTreatmentControlIds: number[]
  preHeatTreatmentWeldJointId: number | null
}

export async function applyPstoLineMoveCleanupInTransaction(
  tx: SystemDocumentSequenceTransaction,
  plans: readonly PstoLineMoveCleanupPlan[],
) {
  const preHeatTreatmentControlIds = [...new Set(
    plans.flatMap((plan) => plan.preHeatTreatmentControlIds),
  )]
  const preHeatTreatmentWeldJointIds = [...new Set(
    plans.flatMap((plan) => plan.preHeatTreatmentWeldJointId === null
      ? []
      : [plan.preHeatTreatmentWeldJointId]),
  )]
  if (preHeatTreatmentControlIds.length > 0) {
    await removeSourcedSystemDocumentPositionsInTransaction({
      tx,
      sourceKind: 'beforeHeatTreatment',
      relationIds: preHeatTreatmentControlIds,
    })
  }
  if (preHeatTreatmentWeldJointIds.length > 0) {
    await tx
      .delete(preHeatTreatmentControls)
      .where(buildNumberArrayMatch(
        preHeatTreatmentControls.weldJointId,
        preHeatTreatmentWeldJointIds,
      ))
  }

}
