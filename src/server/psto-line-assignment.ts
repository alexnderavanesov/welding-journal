import { createServerFn } from '@tanstack/react-start'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'

import { requireDb } from '@/db'
import {
  duplicateControls,
  preHeatTreatmentControls,
  pstoRepeatCycles,
  weldJoints,
} from '@/db/schema'
import { isControlEnabledValue } from '@/lib/control-availability-values'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { DuplicateControlRecord } from '@/lib/duplicate-control-types'
import {
  assertPstoCancellationDateAfterHistory,
  blocksPstoLineActivation,
  buildPstoCancelledRow,
  buildPstoRemovedRow,
  getCompletedPreHeatTreatmentMethodCodes,
  getPendingPreHeatTreatmentMethodCodes,
  getPreHeatTreatmentMethodCodes,
  getPrimaryStagedMethodCodes,
  getPstoLineActivationBlockReason,
  getPstoLineIdentityKey,
  hasPerformedPstoHistory,
  hasPstoLifecycleData,
  hasPrimaryPstoHistory,
  isPstoCancelledValue,
  normalizePstoLineIdentity,
  requiresPrimaryStageResolutionForAssignedPstoLine,
  type PstoLineAssignmentAction,
  type PstoLineActivationDecision,
  type PstoLineAssignmentSummary,
  type PstoLineIdentity,
  type PstoLineRemovalDecision,
  type PstoLineRemovalDisposition,
  type PstoLineRemovalPreview,
  type PstoWeldLineMovePreview,
} from '@/lib/psto-line-assignment'
import {
  buildPrimaryToPreHeatTreatmentTransfer,
  type LnkStageTransferPosition,
} from '@/lib/lnk-stage-transfer'
import {
  isPreHeatTreatmentLnkMethodCode,
  type PreHeatTreatmentControlRecord,
} from '@/lib/lnk-control-stage'
import { calculateFinalStatus } from '@/lib/weld-status'
import { hasPstoCycleExecutionHistory } from '@/lib/psto-cycle'
import { loadControlProcessSettingsFromTransaction } from '@/server/control-process-settings'
import { markDispatcherTaskIndexDirty } from '@/server/dispatcher-task-index-dirty'
import { assertStoredEarlyCoilDecisionSourcesRemainValid } from '@/server/early-coil-decision-guard'
import {
  deletePstoRepeatCyclesInTransaction,
  getPrimaryPstoCyclePersistenceValues,
} from '@/server/psto-cycle-state'
import { attachHeatTreatmentControlRelations } from '@/server/heat-treatment-control-relations'
import { syncPreHeatTreatmentDocumentsInTransaction } from '@/server/pre-heat-treatment-system-documents'
import { assertSecurityScope } from '@/server/security-functions'
import {
  removeSourcedSystemDocumentPositionsInTransaction,
  syncSystemDocumentsForWeldChangesInTransaction,
} from '@/server/system-document-index'

type PstoLineAssignmentPayload = {
  identity: PstoLineIdentity
  action: PstoLineAssignmentAction
  cancellationDate?: string
  cancellationBasis?: string
  activationDecisions?: PstoLineActivationDecision[]
  decisions?: PstoLineRemovalDecision[]
}

export function normalizePstoLineAssignmentPayload(value: PstoLineAssignmentPayload) {
  return normalizePayload(value)
}

export const listPstoLineAssignments = createServerFn({ method: 'GET' })
  .handler(async () => {
    await assertSecurityScope('entry')
    const db = requireDb()
    const rows = await db
      .select()
      .from(weldJoints)
      .orderBy(
        asc(weldJoints.projectTitle),
        asc(weldJoints.subtitleCode),
        asc(weldJoints.line),
        asc(weldJoints.id),
      )
    const rowIds = rows.map((row) => row.id)
    const [controls, repeats] = rowIds.length > 0
      ? await Promise.all([
          db
            .select({ id: preHeatTreatmentControls.id, weldJointId: preHeatTreatmentControls.weldJointId })
            .from(preHeatTreatmentControls)
            .where(inArray(preHeatTreatmentControls.weldJointId, rowIds)),
          db
            .select({ id: pstoRepeatCycles.id, weldJointId: pstoRepeatCycles.weldJointId })
            .from(pstoRepeatCycles)
            .where(inArray(pstoRepeatCycles.weldJointId, rowIds)),
        ])
      : [[], []]
    const preCountByRowId = countByRowId(controls)
    const repeatCountByRowId = countByRowId(repeats)
    const summaries = new Map<string, PstoLineAssignmentSummary>()
    for (const row of rows as WeldRow[]) {
      const identity = normalizePstoLineIdentity(row)
      if (!identity.line) continue
      const key = getPstoLineIdentityKey(identity)
      const current = summaries.get(key) ?? {
        ...identity,
        key,
        rowCount: 0,
        assignedCount: 0,
        cancelledCount: 0,
        historyRowCount: 0,
        preControlCount: 0,
        repeatCycleCount: 0,
      }
      const preControlCount = preCountByRowId.get(row.id) ?? 0
      const repeatCycleCount = repeatCountByRowId.get(row.id) ?? 0
      current.rowCount += 1
      if (isControlEnabledValue(row.pstoRequired)) current.assignedCount += 1
      if (isPstoCancelledValue(row.pstoRequired)) current.cancelledCount += 1
      if (hasPrimaryPstoHistory(row) || preControlCount > 0 || repeatCycleCount > 0) {
        current.historyRowCount += 1
      }
      current.preControlCount += preControlCount
      current.repeatCycleCount += repeatCycleCount
      summaries.set(key, current)
    }
    return [...summaries.values()]
  })

export const getPstoLineRemovalPreview = createServerFn({ method: 'POST' })
  .validator((value: PstoLineIdentity) => requireLineIdentity(value))
  .handler(async ({ data }): Promise<PstoLineRemovalPreview> => {
    await assertSecurityScope('entry')
    const db = requireDb()
    const rows = await db.select().from(weldJoints).where(buildLineWhere(data))
    if (rows.length === 0) throw new Error('Линия больше не найдена. Обновите программу ПСТО.')
    const hydratedRows = await attachHeatTreatmentControlRelations(rows as WeldRow[])
    return buildRemovalPreview(data, hydratedRows)
  })

export const getPstoWeldLineMovePreview = createServerFn({ method: 'POST' })
  .validator((value: { rowId: number; targetIdentity: PstoLineIdentity }) => ({
    rowId: Math.floor(Number(value?.rowId)),
    targetIdentity: normalizePstoLineIdentity(value?.targetIdentity ?? {}),
  }))
  .handler(async ({ data }): Promise<PstoWeldLineMovePreview | null> => {
    await assertSecurityScope('entry')
    if (data.rowId <= 0) throw new Error('Стык для переноса не найден.')
    const db = requireDb()
    const [storedRow] = await db
      .select()
      .from(weldJoints)
      .where(eq(weldJoints.id, data.rowId))
      .limit(1)
    if (!storedRow) throw new Error('Стык для переноса больше не существует.')

    const sourceIdentity = normalizePstoLineIdentity(storedRow)
    if (getPstoLineIdentityKey(sourceIdentity) === getPstoLineIdentityKey(data.targetIdentity)) {
      return null
    }

    const targetRows = data.targetIdentity.line
      ? await db
          .select({
            pstoRequired: weldJoints.pstoRequired,
            pstoCancellationDate: weldJoints.pstoCancellationDate,
            pstoControlBasis: weldJoints.pstoControlBasis,
          })
          .from(weldJoints)
          .where(buildLineWhere(data.targetIdentity))
      : []
    const targetAssignedCount = targetRows.filter((row) => isControlEnabledValue(row.pstoRequired)).length
    const targetCancelledCount = targetRows.filter((row) => isPstoCancelledValue(row.pstoRequired)).length
    if (
      targetRows.length > 0 &&
      targetAssignedCount !== targetRows.length &&
      targetCancelledCount !== targetRows.length &&
      (targetAssignedCount > 0 || targetCancelledCount > 0)
    ) {
      throw new Error('Целевая линия содержит смешанное назначение ПСТО. Сначала выровняйте ее в «Программе ПСТО».')
    }
    const [row] = await attachHeatTreatmentControlRelations([storedRow as WeldRow])
    const targetAssigned = targetRows.length > 0 && targetAssignedCount === targetRows.length
    if (targetAssigned && !requiresPrimaryStageResolutionForAssignedPstoLine(row)) return null
    if (
      !targetAssigned &&
      !hasPrimaryPstoHistory(row) &&
      (row.preHeatTreatmentControls?.length ?? 0) === 0 &&
      (row.pstoRepeatCycles?.length ?? 0) === 0
    ) {
      return null
    }
    const preview = buildRemovalPreview(sourceIdentity, [row])
    return {
      sourceIdentity,
      targetIdentity: data.targetIdentity,
      targetState: targetAssigned
        ? 'assigned'
        : targetRows.length > 0 && targetCancelledCount === targetRows.length
          ? 'cancelled'
          : 'unassigned',
      requestOnlyCount: preview.requestOnlyCount,
      completedPstoCount: preview.completedPstoCount,
      preControlCount: preview.preControlCount,
      completedPreControlCount: preview.completedPreControlCount,
      pendingPreControlCount: preview.pendingPreControlCount,
      repeatCycleCount: preview.repeatCycleCount,
      row: preview.rows[0]!,
    }
  })

export const savePstoLineAssignment = createServerFn({ method: 'POST' })
  .validator(normalizePayload)
  .handler(async ({ data }) => {
    await assertSecurityScope('edit')
    const db = requireDb()
    return db.transaction(async (tx) => {
      const processSettings = await loadControlProcessSettingsFromTransaction(tx)
      const storedRows = await tx
        .select()
        .from(weldJoints)
        .where(buildLineWhere(data.identity))
        .orderBy(asc(weldJoints.id))
        .for('update')
      if (storedRows.length === 0) throw new Error('Линия больше не найдена. Обновите программу ПСТО.')
      const rowIds = storedRows.map((row) => row.id)
      await tx
        .select({ id: preHeatTreatmentControls.id })
        .from(preHeatTreatmentControls)
        .where(inArray(preHeatTreatmentControls.weldJointId, rowIds))
        .for('update')
      await tx
        .select({ id: pstoRepeatCycles.id })
        .from(pstoRepeatCycles)
        .where(inArray(pstoRepeatCycles.weldJointId, rowIds))
        .for('update')

      const rowsWithRelations = await attachHeatTreatmentControlRelations(storedRows as WeldRow[], tx)
      const duplicateRecords = await tx
        .select()
        .from(duplicateControls)
        .where(inArray(duplicateControls.weldJointId, rowIds))
      const duplicatesByRowId = groupByRowId(duplicateRecords)
      const rows: WeldRow[] = rowsWithRelations.map((row) => ({
        ...row,
        duplicateControls: (duplicatesByRowId.get(row.id) ?? []) as unknown as DuplicateControlRecord[],
      }))
      const previousRows = new Map<number, WeldRow>(rows.map((row) => [row.id, row]))
      const now = new Date()

      if (data.action === 'assign' || data.action === 'reactivate') {
        if (data.action === 'reactivate' && !rows.every((row) => isPstoCancelledValue(row.pstoRequired))) {
          throw new Error('Возобновление доступно только для полностью отмененной линии ПСТО.')
        }
        const activationPositions = processSettings.preHeatTreatmentLnkEnabled
          ? validateActivationDecisions(rows, data.activationDecisions)
          : []
        const activationTransfer = activationPositions.length > 0
          ? buildPrimaryToPreHeatTreatmentTransfer({ rows, positions: activationPositions })
          : { rows, controls: [] }
        const savedActivationControls = activationTransfer.controls.length > 0
          ? await tx
              .insert(preHeatTreatmentControls)
              .values(activationTransfer.controls)
              .returning()
          : []
        const activationRows = attachSavedPreHeatTreatmentControls(
          activationTransfer.rows,
          savedActivationControls,
        )
        const transferredRowIds = new Set(activationPositions.map((position) => position.rowId))
        const updatedRows: WeldRow[] = []
        for (const row of activationRows) {
          const next = {
            ...row,
            pstoRequired: 'да',
            pstoControlBasis: null,
            pstoCancellationDate: null,
          } as WeldRow
          const [updated] = await tx
            .update(weldJoints)
            .set({
              pstoRequired: 'да',
              pstoControlBasis: null,
              pstoCancellationDate: null,
              ...(transferredRowIds.has(row.id) ? getPrimaryLnkPersistenceValues(next) : {}),
              finalStatus: calculateFinalStatus(next),
              pstoCreatedAt: sql`coalesce(${weldJoints.pstoCreatedAt}, ${now})`,
              pstoUpdatedAt: now,
              ...(transferredRowIds.has(row.id) ? { lnkUpdatedAt: now } : {}),
              updatedAt: now,
            })
            .where(eq(weldJoints.id, row.id))
            .returning()
          updatedRows.push({
            ...updated,
            preHeatTreatmentControls: row.preHeatTreatmentControls ?? [],
            pstoRepeatCycles: row.pstoRepeatCycles ?? [],
            duplicateControls: row.duplicateControls ?? [],
          } as WeldRow)
        }
        if (savedActivationControls.length > 0) {
          await syncSystemDocumentsForWeldChangesInTransaction(tx, updatedRows, previousRows)
          await syncPreHeatTreatmentDocumentsInTransaction(
            tx,
            updatedRows,
            savedActivationControls,
          )
        }
        await assertStoredEarlyCoilDecisionSourcesRemainValid(tx, rowIds)
        await markDispatcherTaskIndexDirty(tx)
        return updatedRows
      }

      if (data.action === 'remove') {
        if (rows.some((row) => hasPstoLifecycleData(row))) {
          throw new Error('У линии уже есть история ПСТО или НК до ТО. Используйте официальную отмену ПСТО.')
        }
        const updatedRows: WeldRow[] = []
        for (const row of rows) {
          const next = buildPstoRemovedRow({ row, controls: [], disposition: 'keepPrimary' })
          const [updated] = await tx
            .update(weldJoints)
            .set({
              pstoRequired: null,
              pstoControlBasis: null,
              pstoCancellationDate: null,
              finalStatus: calculateFinalStatus(next),
              pstoUpdatedAt: now,
              updatedAt: now,
            })
            .where(eq(weldJoints.id, row.id))
            .returning()
          updatedRows.push({
            ...updated,
            preHeatTreatmentControls: [],
            pstoRepeatCycles: [],
            duplicateControls: row.duplicateControls ?? [],
          } as WeldRow)
        }
        await assertStoredEarlyCoilDecisionSourcesRemainValid(tx, rowIds)
        await markDispatcherTaskIndexDirty(tx)
        return updatedRows
      }

      if (!rows.some((row) => hasPstoLifecycleData(row))) {
        throw new Error('У линии нет истории. Уберите ошибочное назначение без оформления отмены.')
      }
      assertPstoCancellationDateAfterHistory(rows, data.cancellationDate)
      const decisionsByRowId = validateRemovalDecisions(rows, data.decisions)
      const rowsWithoutPerformedPsto = rows.filter((row) => !hasPerformedPstoHistory(row))
      const preRelationIds = rowsWithoutPerformedPsto.flatMap((row) =>
        (row.preHeatTreatmentControls ?? []).map((control) => control.id),
      )
      const unstartedRepeatCycles = rows.flatMap((row) =>
        (row.pstoRepeatCycles ?? []).filter((cycle) => !hasPstoCycleExecutionHistory(cycle)),
      )
      if (preRelationIds.length > 0) {
        await removeSourcedSystemDocumentPositionsInTransaction({
          tx,
          sourceKind: 'beforeHeatTreatment',
          relationIds: preRelationIds,
        })
      }
      if (unstartedRepeatCycles.length > 0) {
        await removeSourcedSystemDocumentPositionsInTransaction({
          tx,
          sourceKind: 'pstoCycle',
          sourcePositions: unstartedRepeatCycles.map((cycle) => ({
            weldJointId: cycle.weldJointId,
            relationId: cycle.id,
            sequence: cycle.sequence,
          })),
        })
        await removeSourcedSystemDocumentPositionsInTransaction({
          tx,
          sourceKind: 'pstoRepeat',
          relationIds: unstartedRepeatCycles.map((cycle) => cycle.id),
        })
      }

      const updatedRows: WeldRow[] = []
      for (const row of rows) {
        const preservesPerformedHistory = hasPerformedPstoHistory(row)
        const next = buildPstoCancelledRow({
          row,
          controls: row.preHeatTreatmentControls ?? [],
          disposition: decisionsByRowId.get(row.id) ?? 'keepPrimary',
          cancellationDate: data.cancellationDate,
          cancellationBasis: data.cancellationBasis,
        })
        next.preHeatTreatmentControls = preservesPerformedHistory ? row.preHeatTreatmentControls ?? [] : []
        const [updated] = await tx
          .update(weldJoints)
          .set({
            pstoRequired: 'отменен',
            pstoControlBasis: textOrNull(next.pstoControlBasis),
            pstoCancellationDate: data.cancellationDate,
            ...getPrimaryPstoCyclePersistenceValues(next),
            vikRequest: textOrNull(next.vikRequest),
            vikRequestDate: textOrNull(next.vikRequestDate),
            vikResult: textOrNull(next.vikResult),
            vikConclusionDate: textOrNull(next.vikConclusionDate),
            vikConclusion: textOrNull(next.vikConclusion),
            rkRequest: textOrNull(next.rkRequest),
            rkRequestDate: textOrNull(next.rkRequestDate),
            rkResult: textOrNull(next.rkResult),
            rkConclusionDate: textOrNull(next.rkConclusionDate),
            rkConclusion: textOrNull(next.rkConclusion),
            uzkRequest: textOrNull(next.uzkRequest),
            uzkRequestDate: textOrNull(next.uzkRequestDate),
            uzkResult: textOrNull(next.uzkResult),
            uzkConclusionDate: textOrNull(next.uzkConclusionDate),
            uzkConclusion: textOrNull(next.uzkConclusion),
            pvkRequest: textOrNull(next.pvkRequest),
            pvkRequestDate: textOrNull(next.pvkRequestDate),
            pvkResult: textOrNull(next.pvkResult),
            pvkConclusionDate: textOrNull(next.pvkConclusionDate),
            pvkConclusion: textOrNull(next.pvkConclusion),
            lnkDefectDescription: textOrNull(next.lnkDefectDescription),
            rkExposureConfirmedDiameter: numberOrNull(next.rkExposureConfirmedDiameter),
            finalStatus: calculateFinalStatus(next),
            pstoUpdatedAt: now,
            lnkUpdatedAt: now,
            updatedAt: now,
          })
          .where(eq(weldJoints.id, row.id))
          .returning()
        updatedRows.push({
          ...updated,
          preHeatTreatmentControls: next.preHeatTreatmentControls,
          pstoRepeatCycles: next.pstoRepeatCycles,
          duplicateControls: row.duplicateControls ?? [],
        } as WeldRow)
      }
      await syncSystemDocumentsForWeldChangesInTransaction(tx, updatedRows, previousRows)
      if (preRelationIds.length > 0) {
        await tx
          .delete(preHeatTreatmentControls)
          .where(inArray(preHeatTreatmentControls.id, preRelationIds))
      }
      if (unstartedRepeatCycles.length > 0) {
        await deletePstoRepeatCyclesInTransaction(
          tx,
          unstartedRepeatCycles.map((cycle) => cycle.id),
        )
      }
      await assertStoredEarlyCoilDecisionSourcesRemainValid(tx, rowIds)
      await markDispatcherTaskIndexDirty(tx)
      return updatedRows
    })
  })

function normalizePayload(value: PstoLineAssignmentPayload) {
  const identity = requireLineIdentity(value?.identity)
  const action = value?.action
  if (!['assign', 'remove', 'cancel', 'reactivate'].includes(action)) {
    throw new Error('Неизвестное действие программы ПСТО.')
  }
  const cancellationDate = String(value?.cancellationDate ?? '').trim().slice(0, 10)
  if (action === 'cancel' && !/^\d{4}-\d{2}-\d{2}$/.test(cancellationDate)) {
    throw new Error('Укажите дату решения об отмене ПСТО.')
  }
  const decisions = (Array.isArray(value?.decisions) ? value.decisions : []).flatMap((decision) => {
    const rowId = Math.floor(Number(decision?.rowId))
    const disposition = decision?.disposition
    return rowId > 0 && isRemovalDisposition(disposition) ? [{ rowId, disposition }] : []
  })
  const activationDecisions = (Array.isArray(value?.activationDecisions) ? value.activationDecisions : [])
    .flatMap((decision) => {
      const rowId = Math.floor(Number(decision?.rowId))
      const disposition = decision?.disposition
      const methodCodes = [...new Set((Array.isArray(decision?.methodCodes) ? decision.methodCodes : [])
        .map((method) => String(method ?? '').trim().toLocaleUpperCase('ru-RU'))
        .filter(isPreHeatTreatmentLnkMethodCode))]
      return rowId > 0 &&
        (disposition === 'keepPrimary' || disposition === 'movePrimaryToBeforeHeatTreatment') &&
        methodCodes.length > 0
        ? [{ rowId, disposition, methodCodes }]
        : []
    })
  return {
    identity,
    action,
    cancellationDate,
    cancellationBasis: String(value?.cancellationBasis ?? '').trim(),
    activationDecisions,
    decisions,
  }
}

function requireLineIdentity(value: Partial<PstoLineIdentity> | undefined) {
  const identity = normalizePstoLineIdentity(value ?? {})
  if (!identity.line) throw new Error('Для назначения ПСТО укажите линию.')
  return identity
}

function buildLineWhere(identity: PstoLineIdentity) {
  return and(
    sql`btrim(coalesce(${weldJoints.projectTitle}, '')) = ${identity.projectTitle}`,
    sql`btrim(coalesce(${weldJoints.subtitleCode}, '')) = ${identity.subtitleCode}`,
    sql`btrim(coalesce(${weldJoints.line}, '')) = ${identity.line}`,
  )
}

function buildRemovalPreview(
  identity: PstoLineIdentity,
  rows: WeldRow[],
): PstoLineRemovalPreview {
  const previewRows = rows.map((row) => {
    const preMethods = getPreHeatTreatmentMethodCodes(row.preHeatTreatmentControls ?? [])
    const promotablePreMethods = getCompletedPreHeatTreatmentMethodCodes(row.preHeatTreatmentControls ?? [])
    const pendingPreMethods = getPendingPreHeatTreatmentMethodCodes(row.preHeatTreatmentControls ?? [])
    const primaryMethods = getPrimaryStagedMethodCodes(row)
    return {
      rowId: row.id,
      joint: String(row.joint ?? '').trim(),
      spool: String(row.spool ?? '').trim(),
      preMethods,
      promotablePreMethods,
      pendingPreMethods,
      primaryMethods,
      pstoRequest: String(row.pstoRequest ?? '').trim(),
      pstoResult: String(row.pstoResult ?? '').trim(),
      repeatCycleCount: row.pstoRepeatCycles?.length ?? 0,
      preservesPerformedHistory: hasPerformedPstoHistory(row),
      hasConflict: promotablePreMethods.some((method) => primaryMethods.includes(method)),
      blocksActivation: blocksPstoLineActivation(row),
      activationTransferBlockedMethods: blocksPstoLineActivation(row)
        ? primaryMethods.filter((method) => preMethods.includes(method))
        : [],
    }
  })
  return {
    identity,
    rowCount: rows.length,
    assignedCount: rows.filter((row) => isControlEnabledValue(row.pstoRequired)).length,
    requestOnlyCount: rows.filter((row) => (
      Boolean(String(row.pstoRequest ?? '').trim()) && !hasPerformedPstoHistory(row)
    )).length,
    completedPstoCount: rows.filter((row) => hasPerformedPstoHistory(row)).length,
    preControlCount: rows.reduce((count, row) => count + (row.preHeatTreatmentControls?.length ?? 0), 0),
    completedPreControlCount: rows.reduce(
      (count, row) => count + getCompletedPreHeatTreatmentMethodCodes(row.preHeatTreatmentControls ?? []).length,
      0,
    ),
    pendingPreControlCount: rows.reduce(
      (count, row) => count + getPendingPreHeatTreatmentMethodCodes(row.preHeatTreatmentControls ?? []).length,
      0,
    ),
    repeatCycleCount: rows.reduce((count, row) => count + (row.pstoRepeatCycles?.length ?? 0), 0),
    rows: previewRows,
  }
}

function validateActivationDecisions(
  rows: WeldRow[],
  decisions: PstoLineActivationDecision[],
): LnkStageTransferPosition[] {
  const blockedRows = rows.filter(blocksPstoLineActivation)
  if (blockedRows.length === 0) return []

  const decisionsByRowId = new Map(decisions.map((decision) => [decision.rowId, decision]))
  const positions: LnkStageTransferPosition[] = []
  for (const row of blockedRows) {
    const primaryMethods = getPrimaryStagedMethodCodes(row)
    const decision = decisionsByRowId.get(row.id)
    if (!decision) throw new Error(getPstoLineActivationBlockReason(blockedRows))
    const decidedMethods = [...decision.methodCodes].sort(compareMethods)
    if (
      decidedMethods.length !== primaryMethods.length ||
      decidedMethods.some((method, index) => method !== primaryMethods[index])
    ) {
      throw new Error(`Стык ${formatJoint(row)}: состав основного НК изменился. Обновите проверку линии.`)
    }
    if (decision.disposition === 'keepPrimary') continue

    const occupiedPreMethods = getPreHeatTreatmentMethodCodes(row.preHeatTreatmentControls ?? [])
      .filter((method) => primaryMethods.includes(method))
    if (occupiedPreMethods.length > 0) {
      throw new Error(
        `Стык ${formatJoint(row)}: в «НК до ТО» уже заполнено ${occupiedPreMethods.join(', ')}. ` +
        'Перенос основного комплекта невозможен; сохраните его основным либо исправьте комплекты через окна ЛНК.',
      )
    }
    positions.push(...primaryMethods.map((methodCode) => ({ rowId: row.id, methodCode })))
  }
  return positions
}

function validateRemovalDecisions(rows: WeldRow[], decisions: PstoLineRemovalDecision[]) {
  const validRowIds = new Set(rows.map((row) => row.id))
  const byRowId = new Map<number, PstoLineRemovalDisposition>()
  for (const decision of decisions) {
    if (!validRowIds.has(decision.rowId)) continue
    byRowId.set(decision.rowId, decision.disposition)
  }
  const missing = rows.find((row) => (
    !hasPerformedPstoHistory(row) &&
    getCompletedPreHeatTreatmentMethodCodes(row.preHeatTreatmentControls ?? []).length > 0 &&
    !byRowId.has(row.id)
  ))
  if (missing) {
    throw new Error(`Стык ${String(missing.joint ?? missing.id)}: выберите, какой комплект НК оставить основным.`)
  }
  const invalidPromotion = rows.find((row) => (
    byRowId.get(row.id) === 'promoteBeforeHeatTreatment' &&
    (
      hasPerformedPstoHistory(row) ||
      getCompletedPreHeatTreatmentMethodCodes(row.preHeatTreatmentControls ?? []).length === 0
    )
  ))
  if (invalidPromotion) {
    throw new Error(`Стык ${String(invalidPromotion.joint ?? invalidPromotion.id)}: нет завершенного НК до ТО для переноса.`)
  }
  return byRowId
}

function attachSavedPreHeatTreatmentControls(
  rows: WeldRow[],
  controls: PreHeatTreatmentControlRecord[],
) {
  const controlsByRowId = groupByRowId(controls)
  return rows.map((row) => ({
    ...row,
    preHeatTreatmentControls: [
      ...(row.preHeatTreatmentControls ?? []),
      ...(controlsByRowId.get(row.id) ?? []),
    ],
  }))
}

function getPrimaryLnkPersistenceValues(row: WeldRow) {
  return {
    vikRequest: textOrNull(row.vikRequest),
    vikRequestDate: textOrNull(row.vikRequestDate),
    vikResult: textOrNull(row.vikResult),
    vikConclusionDate: textOrNull(row.vikConclusionDate),
    vikConclusion: textOrNull(row.vikConclusion),
    rkRequest: textOrNull(row.rkRequest),
    rkRequestDate: textOrNull(row.rkRequestDate),
    rkResult: textOrNull(row.rkResult),
    rkConclusionDate: textOrNull(row.rkConclusionDate),
    rkConclusion: textOrNull(row.rkConclusion),
    uzkRequest: textOrNull(row.uzkRequest),
    uzkRequestDate: textOrNull(row.uzkRequestDate),
    uzkResult: textOrNull(row.uzkResult),
    uzkConclusionDate: textOrNull(row.uzkConclusionDate),
    uzkConclusion: textOrNull(row.uzkConclusion),
    pvkRequest: textOrNull(row.pvkRequest),
    pvkRequestDate: textOrNull(row.pvkRequestDate),
    pvkResult: textOrNull(row.pvkResult),
    pvkConclusionDate: textOrNull(row.pvkConclusionDate),
    pvkConclusion: textOrNull(row.pvkConclusion),
    lnkDefectDescription: textOrNull(row.lnkDefectDescription),
    rkExposureConfirmedDiameter: numberOrNull(row.rkExposureConfirmedDiameter),
  }
}

function formatJoint(row: WeldRow) {
  return String(row.joint ?? '').trim() || `#${row.id}`
}

function compareMethods(left: string, right: string) {
  const order = ['ВИК', 'РК', 'УЗК', 'ПВК']
  return order.indexOf(left) - order.indexOf(right)
}

function isRemovalDisposition(value: unknown): value is PstoLineRemovalDisposition {
  return value === 'keepPrimary' || value === 'promoteBeforeHeatTreatment'
}

function countByRowId(records: Array<{ weldJointId: number }>) {
  const counts = new Map<number, number>()
  for (const record of records) counts.set(record.weldJointId, (counts.get(record.weldJointId) ?? 0) + 1)
  return counts
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

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}
