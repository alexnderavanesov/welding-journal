// This module is intentionally domain-scoped. Keep cross-domain rules in weld-server-shared.
import { requireDb } from '@/db'
import { preHeatTreatmentControls, weldJoints, type WeldJoint } from '@/db/schema'
import { isControlEnabledValue } from '@/lib/control-availability-values'
import type { WeldRow } from '@/lib/dispatcher-types'
import { type LnkStageTransferControlWrite } from '@/lib/lnk-stage-transfer'
import {
  getPstoLineIdentityKey,
  normalizePstoLineIdentity,
  type PstoWeldLineMoveDisposition,
} from '@/lib/psto-line-assignment'
import { normalizeJointChainPart, parseJointChainName } from '@/lib/joint-chain'
import { getJointChainRows } from '@/lib/repeated-joint-row-utils'
import { calculateFinalStatus } from '@/lib/weld-status'
import { loadControlProcessSettingsFromTransaction } from '@/server/control-process-settings'
import { normalizeWeldChainLineMovePlan } from '@/server/joint-chain-line-move-guard'
import { getDispatcherDirtyScopes, markDispatcherTaskIndexDirty } from '@/server/dispatcher-task-index-dirty'
import { syncPreHeatTreatmentDocumentsInTransaction } from '@/server/pre-heat-treatment-system-documents'
import { assertSecurityScope } from '@/server/security-functions'
import { syncSystemDocumentsForWeldChangesInTransaction } from '@/server/system-document-index'
import { type WeldPayload } from '@/server/weld-contracts'
import {
  loadPreviousWeldRows,
  loadServerWeldValidationContext,
  mergeWeldRecordsWithPrevious,
  prepareServerWeldRecords,
  validateServerWeldRecords,
} from '@/server/weld-save-validation'
import { asc, eq, or } from 'drizzle-orm'
import { updateWeldJointsInBatches } from '@/server/weld-persistence'
import { assertExpectedInteractiveWeldVersions } from '@/server/weld-row-version'
import { lockWeldLineMemberships } from '@/server/weld-line-membership-lock'
import { restrictWeldMutationRecord } from '@/server/weld-mutation-policy'
import {
  assertEarlyCoilDecisionSourcesRemainValid,
  hasActiveEarlyCoilDecisionForSource,
  refreshEarlyCoilDecisionContextsInTransaction,
} from '@/server/early-coil-decision-guard'

import {
  assertChainLineMoveLnkStageTransfersAllowed,
  preparePstoLineMoveRecordInTransaction,
  applyPstoLineMoveCleanupInTransaction,
  buildWeldLineIdentityWhere,
  type PstoLineMoveCleanupPlan,
} from '@/server/weld-line-move-stage'

export async function moveWeldJointChain({ data }: { data: WeldPayload }) {
  return moveWeldJointChainRecord(data)
}

export async function moveWeldJointChainRecord(data: WeldPayload) {
  await assertSecurityScope('edit')
  const sourceRowId = Number(data?.id)
  const plan = normalizeWeldChainLineMovePlan(data?.weldChainLineMovePlan)
  if (!Number.isInteger(sourceRowId) || sourceRowId <= 0 || !plan) {
    throw new Error('Не передан план переноса цепочки стыка.')
  }

  return requireDb().transaction(async (tx) => {
    const processSettings = await loadControlProcessSettingsFromTransaction(tx)
    const [sourceSnapshot] = await tx
      .select()
      .from(weldJoints)
      .where(eq(weldJoints.id, sourceRowId))
      .limit(1)
    if (!sourceSnapshot) throw new Error('Базовый стык для переноса больше не существует.')

    const scopedData = restrictWeldMutationRecord(data, data.mutationScope ?? 'welding')
    const [draftSnapshot] = mergeWeldRecordsWithPrevious(
      [scopedData],
      new Map([[sourceSnapshot.id, sourceSnapshot]]),
    )
    const targetIdentity = normalizePstoLineIdentity(draftSnapshot)
    const sourceIdentity = normalizePstoLineIdentity(sourceSnapshot)
    if (!targetIdentity.projectTitle || !targetIdentity.subtitleCode || !targetIdentity.line) {
      throw new Error('Для переноса цепочки укажите проект, шифр и линию.')
    }
    if (normalizeJointChainPart(sourceIdentity.line) === normalizeJointChainPart(targetIdentity.line)) {
      throw new Error('Новая линия совпадает с текущей линией цепочки.')
    }

    const sourceIdentityKey = getPstoLineIdentityKey(sourceIdentity)
    const targetIdentityKey = getPstoLineIdentityKey(targetIdentity)
    await lockWeldLineMemberships(tx, [sourceIdentity, targetIdentity])

    const lockedScopeRows = await tx
      .select()
      .from(weldJoints)
      .where(or(
        buildWeldLineIdentityWhere(sourceIdentity),
        buildWeldLineIdentityWhere(targetIdentity),
      ))
      .orderBy(asc(weldJoints.id))
      .for('update')
    const sourceScopeRows = lockedScopeRows.filter(
      (row) => getPstoLineIdentityKey(row) === sourceIdentityKey,
    )
    const targetRows = lockedScopeRows.filter(
      (row) => getPstoLineIdentityKey(row) === targetIdentityKey,
    )
    const storedSource = sourceScopeRows.find((row) => row.id === sourceRowId)
    if (!storedSource || getPstoLineIdentityKey(storedSource) !== sourceIdentityKey) {
      throw new Error('Исходный стык изменился во время переноса. Вернитесь к форме и повторите действие.')
    }

    const initialContext = await loadServerWeldValidationContext(tx, lockedScopeRows)
    const parsedSource = parseJointChainName(
      String(storedSource.joint ?? ''),
      initialContext.systemIndexSettings,
    )
    const rootJoint = parsedSource.base || String(storedSource.joint ?? '').trim()
    if (parsedSource.segments.length > 0) {
      throw new Error(
        `Стык ${String(storedSource.joint ?? '').trim() || `#${storedSource.id}`} входит в цепочку ${rootJoint}. ` +
        `Линия всей цепочки изменяется через базовый стык ${rootJoint}.`,
      )
    }

    const [draftSource] = mergeWeldRecordsWithPrevious(
      [scopedData],
      new Map([[storedSource.id, storedSource]]),
    )
    if (
      getPstoLineIdentityKey(draftSource) !== targetIdentityKey ||
      normalizeJointChainPart(sourceIdentity.projectTitle) !== normalizeJointChainPart(targetIdentity.projectTitle) ||
      normalizeJointChainPart(sourceIdentity.subtitleCode) !== normalizeJointChainPart(targetIdentity.subtitleCode) ||
      normalizeJointChainPart(storedSource.joint) !== normalizeJointChainPart(draftSource.joint)
    ) {
      throw new Error(
        `Для цепочки ${rootJoint} можно изменить только линию. Проект, шифр и номер базового стыка должны остаться прежними.`,
      )
    }

    const chainRows = getJointChainRows(
      sourceScopeRows as WeldRow[],
      storedSource,
      initialContext.systemIndexSettings,
    )
    const hasEarlyCoilDecision = await hasActiveEarlyCoilDecisionForSource(tx, storedSource.id)
    if (chainRows.length <= 1 && !hasEarlyCoilDecision) {
      throw new Error(`Цепочка ${rootJoint} уже изменилась. Вернитесь к форме и повторите перенос.`)
    }

    assertExpectedChainRows(plan.expectedRowIds, chainRows)
    assertNoTargetChainCollision(
      targetRows as WeldRow[],
      rootJoint,
      initialContext.systemIndexSettings,
    )

    const previousRows = await loadPreviousWeldRows(
      tx,
      chainRows.map((row) => ({ id: row.id })),
    )
    if (previousRows.size !== chainRows.length) {
      throw new Error('Состав цепочки изменился во время переноса. Повторите действие.')
    }
    assertExpectedInteractiveWeldVersions(
      chainRows.map((row) => row.id),
      plan.expectedVersions,
      [...previousRows.values()],
    )
    assertExpectedInteractiveWeldVersions(
      [sourceRowId],
      [{ id: sourceRowId, version: String(data.expectedVersion ?? '').trim() }],
      [previousRows.get(sourceRowId)!],
    )
    const validationContext = withLockedTargetLineState(
      initialContext,
      targetIdentity,
      targetRows as WeldRow[],
    )
    const decisions = normalizeChainLineMoveDecisions(plan.decisions, new Set(previousRows.keys()))
    const [mergedSource] = mergeWeldRecordsWithPrevious([scopedData], previousRows)
    const records = chainRows.map((chainRow) => {
      const previous = previousRows.get(chainRow.id) as unknown as WeldRow
      return chainRow.id === sourceRowId
        ? mergedSource as WeldRow
        : { ...previous, line: targetIdentity.line } as WeldRow
    })

    const validationPreviousRows = new Map<number, WeldJoint>()
    const pendingPreHeatTreatmentControls: LnkStageTransferControlWrite[] = []
    const cleanupPlans: PstoLineMoveCleanupPlan[] = []
    let requiresLifecycleCleanup = false
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index]!
      const previousStored = previousRows.get(Number(record.id))!
      const prepared = await preparePstoLineMoveRecordInTransaction({
        tx,
        record,
        previousStored,
        validationContext,
        processSettings,
        disposition: decisions.get(Number(record.id)),
      })
      records[index] = prepared.record
      validationPreviousRows.set(Number(record.id), prepared.validationPrevious)
      pendingPreHeatTreatmentControls.push(...prepared.pendingPreHeatTreatmentControls)
      cleanupPlans.push(prepared.cleanup)
      requiresLifecycleCleanup ||= prepared.requiresLifecycleCleanup
    }

    const allowedLineMoveRowIds = new Set(records.map((record) => Number(record.id)))
    await assertEarlyCoilDecisionSourcesRemainValid(tx, records, previousRows, {
      allowedLineMoveRowIds,
    })
    prepareServerWeldRecords({
      records,
      previousRows: validationPreviousRows,
      context: validationContext,
      allowPstoLineLifecycleMove: requiresLifecycleCleanup,
    })
    assertChainLineMoveLnkStageTransfersAllowed(records, previousRows, decisions)
    validateServerWeldRecords({
      records,
      previousRows: validationPreviousRows,
      context: validationContext,
      allowSystemJointNames: true,
    })
    await applyPstoLineMoveCleanupInTransaction(tx, cleanupPlans)

    const savedPreHeatTreatmentControls = pendingPreHeatTreatmentControls.length > 0
      ? await tx
          .insert(preHeatTreatmentControls)
          .values(pendingPreHeatTreatmentControls)
          .returning()
      : []
    const savedControlsByRowId = new Map<number, typeof savedPreHeatTreatmentControls>()
    for (const control of savedPreHeatTreatmentControls) {
      const controls = savedControlsByRowId.get(control.weldJointId) ?? []
      controls.push(control)
      savedControlsByRowId.set(control.weldJointId, controls)
    }
    for (const record of records) {
      const savedControls = savedControlsByRowId.get(Number(record.id))
      if (!savedControls) continue
      record.preHeatTreatmentControls = savedControls
      record.finalStatus = calculateFinalStatus(record)
    }

    const updatedRows = await updateWeldJointsInBatches(tx, records, previousRows)
    await syncSystemDocumentsForWeldChangesInTransaction(tx, updatedRows, previousRows)
    if (savedPreHeatTreatmentControls.length > 0) {
      await syncPreHeatTreatmentDocumentsInTransaction(
        tx,
        updatedRows.map((row) => ({
          ...row,
          preHeatTreatmentControls: savedControlsByRowId.get(row.id) ?? [],
        })) as WeldRow[],
        savedPreHeatTreatmentControls,
      )
    }
    await refreshEarlyCoilDecisionContextsInTransaction(
      tx,
      updatedRows,
      validationContext.systemIndexSettings,
    )
    await markDispatcherTaskIndexDirty(tx, {
      scopes: getDispatcherDirtyScopes(records, previousRows),
    })

    const recordsById = new Map(records.map((record) => [Number(record.id), record]))
    return updatedRows.map((row) => {
      const prepared = recordsById.get(row.id)
      return {
        ...row,
        duplicateControls: prepared?.duplicateControls ?? [],
        preHeatTreatmentControls: prepared?.preHeatTreatmentControls ?? [],
        pstoRepeatCycles: prepared?.pstoRepeatCycles ?? [],
      } as WeldRow
    })
  })
}

function assertExpectedChainRows(expectedRowIds: readonly number[], rows: readonly WeldRow[]) {
  const normalizedExpected = [...new Set(expectedRowIds.map(Number))]
    .filter((id) => Number.isInteger(id) && id > 0)
    .sort((left, right) => left - right)
  const current = rows.map((row) => row.id).sort((left, right) => left - right)
  if (
    normalizedExpected.length !== expectedRowIds.length ||
    normalizedExpected.length !== current.length ||
    normalizedExpected.some((id, index) => id !== current[index])
  ) {
    throw new Error('Состав цепочки изменился после подтверждения. Вернитесь к форме и проверьте перенос еще раз.')
  }
}

function normalizeChainLineMoveDecisions(
  decisions: readonly { rowId: number; disposition: PstoWeldLineMoveDisposition }[],
  chainRowIds: ReadonlySet<number>,
) {
  const allowedDispositions = new Set<PstoWeldLineMoveDisposition>([
    'keepPrimary',
    'movePrimaryToBeforeHeatTreatment',
    'promoteBeforeHeatTreatment',
  ])
  const result = new Map<number, PstoWeldLineMoveDisposition>()
  for (const decision of decisions) {
    const rowId = Number(decision?.rowId)
    if (!chainRowIds.has(rowId)) {
      throw new Error('План переноса содержит стык, который больше не входит в цепочку.')
    }
    if (result.has(rowId)) throw new Error(`Для стыка #${rowId} передано несколько решений переноса.`)
    if (!allowedDispositions.has(decision.disposition)) {
      throw new Error(`Для стыка #${rowId} передано неизвестное решение переноса.`)
    }
    result.set(rowId, decision.disposition)
  }
  return result
}

function assertNoTargetChainCollision(
  targetRows: readonly WeldRow[],
  rootJoint: string,
  settings: Parameters<typeof parseJointChainName>[1],
) {
  const collisions = targetRows.filter((row) => (
    normalizeJointChainPart(parseJointChainName(String(row.joint ?? ''), settings).base) ===
    normalizeJointChainPart(rootJoint)
  ))
  if (collisions.length === 0) return
  const joints = [...new Set(collisions.map((row) => String(row.joint ?? '').trim() || `#${row.id}`))]
  throw new Error(
    `На целевой линии уже есть цепочка ${rootJoint}: ${joints.slice(0, 8).join(', ')}` +
    `${joints.length > 8 ? ` и еще ${joints.length - 8}` : ''}. Выберите другую линию или устраните конфликт.`,
  )
}

function withLockedTargetLineState(
  context: Awaited<ReturnType<typeof loadServerWeldValidationContext>>,
  targetIdentity: ReturnType<typeof normalizePstoLineIdentity>,
  targetRows: readonly WeldRow[],
) {
  const pstoLineAssignments = new Map(context.pstoLineAssignments)
  const key = getPstoLineIdentityKey(targetIdentity)
  if (targetRows.length === 0) {
    pstoLineAssignments.delete(key)
  } else {
    const cancellationDates = targetRows
      .map((row) => String(row.pstoCancellationDate ?? '').trim())
      .filter(Boolean)
      .sort()
    pstoLineAssignments.set(key, {
      rowCount: targetRows.length,
      assignedCount: targetRows.filter((row) => isControlEnabledValue(row.pstoRequired)).length,
      cancelledCount: targetRows.filter((row) => String(row.pstoRequired ?? '').trim().toLowerCase() === 'отменен').length,
      cancellationDate: cancellationDates.at(-1) ?? '',
      cancellationBasis: targetRows
        .map((row) => String(row.pstoControlBasis ?? '').trim())
        .find(Boolean) ?? '',
    })
  }
  return { ...context, pstoLineAssignments }
}
