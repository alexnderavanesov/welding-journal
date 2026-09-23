import { createServerFn } from '@tanstack/react-start'
import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm'

import { requireDb } from '@/db'
import {
  appSettings,
  duplicateControls,
  preHeatTreatmentControls,
  pstoRepeatCycles,
  weldJoints,
  type NewWeldJoint,
} from '@/db/schema'
import {
  isControlEnabledValue,
  normalizeControlAvailabilityStorageText,
} from '@/lib/control-availability-values'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { DuplicateControlRecord } from '@/lib/duplicate-control-types'
import { normalizeJointChainPart, parseJointChainName } from '@/lib/joint-chain'
import {
  assertPstoCancellationDateAfterHistory,
  assertPstoLineAssignmentActionAllowed,
  blocksPstoLineActivation,
  buildPstoCancelledRow,
  buildPstoRemovedRow,
  getCompletedPreHeatTreatmentMethodCodes,
  getPendingPreHeatTreatmentMethodCodes,
  getPreHeatTreatmentMethodCodes,
  getPrimaryStagedMethodCodes,
  getPstoLineAssignmentState,
  getPstoLineActivationBlockReason,
  getPstoLineIdentityKey,
  normalizePstoLineIdentityPart,
  hasPerformedPstoHistory,
  hasPstoLifecycleData,
  hasPrimaryPstoHistory,
  isPstoCancelledValue,
  normalizePstoLineIdentity,
  requiresPrimaryStageResolutionForAssignedPstoLine,
  type PstoLineAssignmentAction,
  type PstoLineActivationDecision,
  type PstoLineAssignmentPageRequest,
  type PstoLineAssignmentPageResult,
  type PstoLineIdentity,
  type PstoLineRemovalDecision,
  type PstoLineRemovalDisposition,
  type PstoLineRemovalPreview,
  type PstoWeldLineMovePreview,
} from '@/lib/psto-line-assignment'
import {
  buildPrimaryToPreHeatTreatmentTransfer,
  findBlockingLnkStageTransferChronologyIssue,
  type LnkStageTransferPosition,
} from '@/lib/lnk-stage-transfer'
import {
  isPreHeatTreatmentLnkMethodCode,
  type PreHeatTreatmentControlRecord,
} from '@/lib/lnk-control-stage'
import { calculateFinalStatus } from '@/lib/weld-status'
import { splitWeldImportInsertBatches } from '@/lib/weld-import-limits'
import { hasPstoCycleExecutionHistory } from '@/lib/psto-cycle'
import { PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'
import { getJointChainRows } from '@/lib/repeated-joint-row-utils'
import {
  DEFAULT_SYSTEM_INDEX_SETTINGS,
  normalizeSystemIndexSettings,
} from '@/lib/system-index-settings'
import { loadControlProcessSettingsFromTransaction } from '@/server/control-process-settings'
import { markDispatcherTaskIndexDirty } from '@/server/dispatcher-task-index-dirty'
import {
  assertStoredEarlyCoilDecisionSourcesRemainValid,
  hasActiveEarlyCoilDecisionForSource,
} from '@/server/early-coil-decision-guard'
import {
  deletePstoRepeatCyclesInTransaction,
  getPrimaryPstoCyclePersistenceValues,
} from '@/server/psto-cycle-state'
import { attachHeatTreatmentControlRelations } from '@/server/heat-treatment-control-relations'
import { syncPreHeatTreatmentDocumentsInTransaction } from '@/server/pre-heat-treatment-system-documents'
import { assertSecurityScope } from '@/server/security-functions'
import {
  loadPstoLineAssignmentSummaryPage,
  normalizePstoLineAssignmentPageRequest,
} from '@/server/psto-line-assignment-summary'
import type { SystemDocumentSequenceTransaction } from '@/server/system-document-sequences'
import { WELD_TABLE_COLUMNS, WELD_TABLE_RETURNING } from '@/server/weld-server-shared'
import { assertExpectedInteractiveWeldVersions } from '@/server/weld-row-version'
import { lockWeldLineMemberships } from '@/server/weld-line-membership-lock'
import type { WeldRowVersionTarget } from '@/lib/weld-row-version'
import { buildNumberArrayMatch } from '@/server/weld-request-utils'
import {
  removeSourcedSystemDocumentPositionsInTransaction,
  syncSystemDocumentsForWeldChangesInTransaction,
} from '@/server/system-document-index'

type PstoLineAssignmentPayload = {
  identity: PstoLineIdentity
  action: PstoLineAssignmentAction
  expectedVersions: WeldRowVersionTarget[]
  cancellationDate?: string
  cancellationBasis?: string
  activationDecisions?: PstoLineActivationDecision[]
  decisions?: PstoLineRemovalDecision[]
}

function parseStoredJson(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

export function normalizePstoLineAssignmentPayload(value: PstoLineAssignmentPayload) {
  return normalizePayload(value)
}

export const listPstoLineAssignmentPage = createServerFn({ method: 'POST' })
  .validator((value: PstoLineAssignmentPageRequest | undefined) =>
    normalizePstoLineAssignmentPageRequest(value),
  )
  .handler(async ({ data }): Promise<PstoLineAssignmentPageResult> => {
    await assertSecurityScope('entry')
    return loadPstoLineAssignmentSummaryPage(requireDb(), data)
  })

export const getPstoLineRemovalPreview = createServerFn({ method: 'POST' })
  .validator((value: PstoLineIdentity) => requireLineIdentity(value))
  .handler(async ({ data }): Promise<PstoLineRemovalPreview> => {
    await assertSecurityScope('entry')
    const db = requireDb()
    const rows = await db.select(WELD_TABLE_RETURNING).from(weldJoints).where(buildLineWhere(data))
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
      .select(WELD_TABLE_RETURNING)
      .from(weldJoints)
      .where(eq(weldJoints.id, data.rowId))
      .limit(1)
    if (!storedRow) throw new Error('Стык для переноса больше не существует.')

    const sourceIdentity = normalizePstoLineIdentity(storedRow)
    if (getPstoLineIdentityKey(sourceIdentity) === getPstoLineIdentityKey(data.targetIdentity)) {
      return null
    }

    if (!data.targetIdentity.projectTitle || !data.targetIdentity.subtitleCode || !data.targetIdentity.line) {
      throw new Error('Для переноса укажите проект, шифр и линию.')
    }

    const [systemIndexRow] = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, PROJECT_SETTING_KEYS.systemIndex))
      .limit(1)
    const systemIndexSettings = normalizeSystemIndexSettings(
      parseStoredJson(systemIndexRow?.value) ?? DEFAULT_SYSTEM_INDEX_SETTINGS,
    )
    const parsedSourceJoint = parseJointChainName(
      String(storedRow.joint ?? ''),
      systemIndexSettings,
    )
    const rootJoint = parsedSourceJoint.base || String(storedRow.joint ?? '').trim()
    if (parsedSourceJoint.segments.length > 0) {
      throw new Error(
        `Стык ${String(storedRow.joint ?? '').trim() || `#${storedRow.id}`} входит в цепочку ${rootJoint}. ` +
        `Линия всей цепочки изменяется через базовый стык ${rootJoint}.`,
      )
    }

    const sourceScopeRows = sourceIdentity.line
      ? await db.select(WELD_TABLE_RETURNING).from(weldJoints).where(buildLineWhere(sourceIdentity))
      : [storedRow]
    const hydratedSourceScopeRows = await attachHeatTreatmentControlRelations(sourceScopeRows as WeldRow[])
    const chainRows = getJointChainRows(
      hydratedSourceScopeRows,
      storedRow,
      systemIndexSettings,
    )
    const isChainMove = chainRows.length > 1 ||
      await hasActiveEarlyCoilDecisionForSource(db, storedRow.id)
    if (
      isChainMove &&
      (
        normalizeJointChainPart(sourceIdentity.projectTitle) !== normalizeJointChainPart(data.targetIdentity.projectTitle) ||
        normalizeJointChainPart(sourceIdentity.subtitleCode) !== normalizeJointChainPart(data.targetIdentity.subtitleCode)
      )
    ) {
      throw new Error(
        `Для цепочки ${rootJoint} можно изменить только линию. Проект и шифр цепочки должны остаться прежними.`,
      )
    }

    const targetRows = data.targetIdentity.line
      ? await db
          .select()
          .from(weldJoints)
          .where(buildLineWhere(data.targetIdentity))
      : []
    if (isChainMove) {
      const collisions = targetRows.filter((row) => (
        normalizeJointChainPart(parseJointChainName(
          String(row.joint ?? ''),
          systemIndexSettings,
        ).base) === normalizeJointChainPart(rootJoint)
      ))
      if (collisions.length > 0) {
        const joints = [...new Set(collisions.map((row) => String(row.joint ?? '').trim() || `#${row.id}`))]
        throw new Error(
          `На целевой линии уже есть цепочка ${rootJoint}: ${joints.slice(0, 8).join(', ')}` +
          `${joints.length > 8 ? ` и еще ${joints.length - 8}` : ''}. Выберите другую линию или устраните конфликт.`,
        )
      }
    }
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
    const targetAssigned = targetRows.length > 0 && targetAssignedCount === targetRows.length
    const sourceRow = chainRows.find((row) => row.id === storedRow.id) ?? (storedRow as WeldRow)
    if (
      !isChainMove &&
      targetAssigned &&
      !requiresPrimaryStageResolutionForAssignedPstoLine(sourceRow)
    ) return null
    if (
      !isChainMove &&
      !targetAssigned &&
      !hasPrimaryPstoHistory(sourceRow) &&
      (sourceRow.preHeatTreatmentControls?.length ?? 0) === 0 &&
      (sourceRow.pstoRepeatCycles?.length ?? 0) === 0
    ) {
      return null
    }
    const targetState = targetAssigned
      ? 'assigned'
      : targetRows.length > 0 && targetCancelledCount === targetRows.length
        ? 'cancelled'
        : 'unassigned'
    const preview = buildRemovalPreview(sourceIdentity, chainRows)
    const sourceRowsById = new Map(chainRows.map((row) => [row.id, row]))
    const previewRows = preview.rows.map((row) => ({
      ...row,
      requiresDisposition: targetAssigned
        ? requiresPrimaryStageResolutionForAssignedPstoLine(sourceRowsById.get(row.rowId)!)
        : hasPstoLifecycleData(sourceRowsById.get(row.rowId)!),
    }))
    return {
      sourceIdentity,
      targetIdentity: data.targetIdentity,
      targetState,
      rootRowId: storedRow.id,
      rootJoint,
      isChainMove,
      expectedRowIds: chainRows.map((row) => row.id),
      expectedVersions: preview.expectedVersions,
      requestOnlyCount: preview.requestOnlyCount,
      completedPstoCount: preview.completedPstoCount,
      preControlCount: preview.preControlCount,
      completedPreControlCount: preview.completedPreControlCount,
      pendingPreControlCount: preview.pendingPreControlCount,
      repeatCycleCount: preview.repeatCycleCount,
      rows: previewRows,
      row: previewRows.find((row) => row.rowId === storedRow.id)!,
    }
  })

export const savePstoLineAssignment = createServerFn({ method: 'POST' })
  .validator(normalizePayload)
  .handler(async ({ data }) => {
    await assertSecurityScope('edit')
    const db = requireDb()
    return db.transaction(async (tx) => {
      const processSettings = await loadControlProcessSettingsFromTransaction(tx)
      await lockWeldLineMemberships(tx, [data.identity])
      const storedRows = await tx
        .select(WELD_TABLE_RETURNING)
        .from(weldJoints)
        .where(buildLineWhere(data.identity))
        .orderBy(asc(weldJoints.id))
        .for('update')
      if (storedRows.length === 0) throw new Error('Линия больше не найдена. Обновите программу ПСТО.')
      const rowIds = storedRows.map((row) => row.id)
      assertExpectedInteractiveWeldVersions(rowIds, data.expectedVersions, storedRows)
      await tx
        .select({ id: preHeatTreatmentControls.id })
        .from(preHeatTreatmentControls)
        .where(buildNumberArrayMatch(preHeatTreatmentControls.weldJointId, rowIds))
        .orderBy(asc(preHeatTreatmentControls.id))
        .for('update')
      await tx
        .select({ id: pstoRepeatCycles.id })
        .from(pstoRepeatCycles)
        .where(buildNumberArrayMatch(pstoRepeatCycles.weldJointId, rowIds))
        .orderBy(asc(pstoRepeatCycles.id))
        .for('update')

      const rowsWithRelations = await attachHeatTreatmentControlRelations(storedRows as WeldRow[], tx)
      const duplicateRecords = await tx
        .select()
        .from(duplicateControls)
        .where(buildNumberArrayMatch(duplicateControls.weldJointId, rowIds))
      const duplicatesByRowId = groupByRowId(duplicateRecords)
      const rows: WeldRow[] = rowsWithRelations.map((row) => ({
        ...row,
        duplicateControls: (duplicatesByRowId.get(row.id) ?? []) as unknown as DuplicateControlRecord[],
      }))
      const previousRows = new Map<number, WeldRow>(rows.map((row) => [row.id, row]))
      const now = new Date()
      assertPstoLineAssignmentActionAllowed(data.action, getPstoLineAssignmentState(rows))

      if (data.action === 'assign' || data.action === 'reactivate') {
        const activationPositions = processSettings.preHeatTreatmentLnkEnabled
          ? validateActivationDecisions(rows, data.activationDecisions)
          : []
        const activationTransfer = activationPositions.length > 0
          ? buildPrimaryToPreHeatTreatmentTransfer({ rows, positions: activationPositions })
          : { rows, controls: [] }
        if (activationTransfer.controls.length > 0) {
          const previewControls = activationTransfer.controls.map((control, index) => ({
            ...control,
            id: -(index + 1),
          }))
          const previewRows = attachSavedPreHeatTreatmentControls(
            activationTransfer.rows,
            previewControls,
          ).map((row) => ({
            ...row,
            pstoRequired: 'да',
            pstoControlBasis: null,
            pstoCancellationDate: null,
          } as WeldRow))
          assertPstoLineActivationTransferAllowed(rows, previewRows)
        }
        const savedActivationControls: Array<typeof preHeatTreatmentControls.$inferSelect> = []
        for (const batch of splitWeldImportInsertBatches(activationTransfer.controls)) {
          savedActivationControls.push(...await tx
            .insert(preHeatTreatmentControls)
            .values(batch)
            .returning())
        }
        const activationRows = attachSavedPreHeatTreatmentControls(
          activationTransfer.rows,
          savedActivationControls,
        )
        const transferredRowIds = new Set(activationPositions.map((position) => position.rowId))
        const nextRows = activationRows.map((row) => {
          const next = {
            ...row,
            pstoRequired: 'да',
            pstoControlBasis: null,
            pstoCancellationDate: null,
          } as WeldRow
          next.finalStatus = calculateFinalStatus(next)
          return next
        })
        const updatedRows = await persistPstoLineAssignmentRows(
          tx,
          nextRows,
          now,
          transferredRowIds,
        )
        if (savedActivationControls.length > 0) {
          await syncSystemDocumentsForWeldChangesInTransaction(tx, updatedRows, previousRows)
          await syncPreHeatTreatmentDocumentsInTransaction(
            tx,
            updatedRows,
            savedActivationControls,
          )
        }
        await assertStoredEarlyCoilDecisionSourcesRemainValid(tx, rowIds)
        await markDispatcherTaskIndexDirty(tx, { scopes: [data.identity] })
        return updatedRows
      }

      if (data.action === 'remove') {
        if (rows.some((row) => hasPstoLifecycleData(row))) {
          throw new Error('У линии уже есть история ПСТО или НК до ТО. Используйте официальную отмену ПСТО.')
        }
        const nextRows = rows.map((row) => {
          const next = buildPstoRemovedRow({ row, controls: [], disposition: 'keepPrimary' })
          return {
            ...next,
            preHeatTreatmentControls: [],
            pstoRepeatCycles: [],
            finalStatus: calculateFinalStatus(next),
          } as WeldRow
        })
        const updatedRows = await persistPstoLineAssignmentRows(tx, nextRows, now)
        await assertStoredEarlyCoilDecisionSourcesRemainValid(tx, rowIds)
        await markDispatcherTaskIndexDirty(tx, { scopes: [data.identity] })
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

      const nextRows = rows.map((row) => {
        const preservesPerformedHistory = hasPerformedPstoHistory(row)
        const next = buildPstoCancelledRow({
          row,
          controls: row.preHeatTreatmentControls ?? [],
          disposition: decisionsByRowId.get(row.id) ?? 'keepPrimary',
          cancellationDate: data.cancellationDate,
          cancellationBasis: data.cancellationBasis,
        })
        next.preHeatTreatmentControls = preservesPerformedHistory ? row.preHeatTreatmentControls ?? [] : []
        next.finalStatus = calculateFinalStatus(next)
        return next
      })
      if ([...decisionsByRowId.values()].includes('promoteBeforeHeatTreatment')) {
        assertPstoLineCancellationPromotionAllowed(rows, nextRows)
      }
      const updatedRows = await persistPstoLineAssignmentRows(
        tx,
        nextRows,
        now,
        new Set(nextRows.map((row) => row.id)),
      )
      await syncSystemDocumentsForWeldChangesInTransaction(tx, updatedRows, previousRows)
      if (preRelationIds.length > 0) {
        await tx
          .delete(preHeatTreatmentControls)
          .where(buildNumberArrayMatch(preHeatTreatmentControls.id, preRelationIds))
      }
      if (unstartedRepeatCycles.length > 0) {
        await deletePstoRepeatCyclesInTransaction(
          tx,
          unstartedRepeatCycles.map((cycle) => cycle.id),
        )
      }
      await assertStoredEarlyCoilDecisionSourcesRemainValid(tx, rowIds)
      await markDispatcherTaskIndexDirty(tx, { scopes: [data.identity] })
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
    expectedVersions: (Array.isArray(value?.expectedVersions) ? value.expectedVersions : []).map((entry) => ({
      id: Number(entry?.id),
      version: String(entry?.version ?? '').trim(),
    })),
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
    sql`lower(btrim(coalesce(${weldJoints.projectTitle}, ''))) = ${normalizePstoLineIdentityPart(identity.projectTitle)}`,
    sql`lower(btrim(coalesce(${weldJoints.subtitleCode}, ''))) = ${normalizePstoLineIdentityPart(identity.subtitleCode)}`,
    sql`lower(btrim(coalesce(${weldJoints.line}, ''))) = ${normalizePstoLineIdentityPart(identity.line)}`,
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
    expectedVersions: rows.map((row) => ({
      id: row.id,
      version: String(row.rowVersion ?? '').trim(),
    })),
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

export function assertPstoLineActivationTransferAllowed(
  previousRows: WeldRow[],
  nextRows: WeldRow[],
) {
  const issue = findBlockingLnkStageTransferChronologyIssue({
    previousRows,
    nextRows,
    targetStage: 'beforeHeatTreatment',
  })
  if (issue) {
    throw new Error(`Назначение ПСТО невозможно: перенос НК в «До ТО» нарушает данные. ${issue.message}`)
  }
}

export function assertPstoLineCancellationPromotionAllowed(
  previousRows: WeldRow[],
  nextRows: WeldRow[],
) {
  const issue = findBlockingLnkStageTransferChronologyIssue({
    previousRows,
    nextRows,
    targetStage: 'primary',
  })
  if (issue) {
    throw new Error(`Отмена ПСТО невозможна: перенос НК в основной комплект нарушает данные. ${issue.message}`)
  }
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

const PSTO_LINE_ASSIGNMENT_UPDATE_FIELD_KEYS = [
  'preHeatTreatmentLnkExempt',
  'pstoRequired',
  'pstoControlBasis',
  'pstoCancellationDate',
  'pstoRequest',
  'pstoRequestDate',
  'pstoDate',
  'heatTreatmentDiagram',
  'pstoResult',
  'pstoNote',
  'tvmtRequest',
  'tvmtRequestDate',
  'tvmtResult',
  'tvmtConclusionDate',
  'tvmtConclusion',
  'vikRequest',
  'vikRequestDate',
  'vikResult',
  'vikConclusionDate',
  'vikConclusion',
  'vikDefectDescription',
  'rkRequest',
  'rkRequestDate',
  'rkResult',
  'rkConclusionDate',
  'rkConclusion',
  'uzkRequest',
  'uzkRequestDate',
  'uzkResult',
  'uzkConclusionDate',
  'uzkConclusion',
  'uzkDefectDescription',
  'pvkRequest',
  'pvkRequestDate',
  'pvkResult',
  'pvkConclusionDate',
  'pvkConclusion',
  'pvkDefectDescription',
  'lnkDefectDescription',
  'rkExposureConfirmedDiameter',
  'finalStatus',
  'pstoCreatedAt',
  'pstoUpdatedAt',
  'lnkUpdatedAt',
  'updatedAt',
] as const satisfies readonly (keyof NewWeldJoint)[]

const PSTO_LINE_ASSIGNMENT_UPDATE_SET = Object.fromEntries(
  PSTO_LINE_ASSIGNMENT_UPDATE_FIELD_KEYS.map((fieldKey) => [
    fieldKey,
    sql.raw(`excluded."${WELD_TABLE_COLUMNS[fieldKey].name}"`),
  ]),
) as Partial<Record<keyof NewWeldJoint, SQL>>

export async function persistPstoLineAssignmentRows(
  tx: SystemDocumentSequenceTransaction,
  rows: WeldRow[],
  now = new Date(),
  lnkTouchedRowIds: ReadonlySet<number> = new Set(),
) {
  if (rows.length === 0) return []
  const payloads = rows.map((row) => {
    const values: Record<string, unknown> = {
      id: row.id,
      pstoRequired: normalizeControlAvailabilityStorageText(row.pstoRequired),
      pstoControlBasis: textOrNull(row.pstoControlBasis),
      pstoCancellationDate: textOrNull(row.pstoCancellationDate),
      ...getPrimaryPstoCyclePersistenceValues(row),
      ...getPrimaryLnkPersistenceValues(row),
      finalStatus: textOrNull(calculateFinalStatus(row)),
      pstoCreatedAt: isControlEnabledValue(row.pstoRequired)
        ? timestampOrNull(row.pstoCreatedAt) ?? now
        : timestampOrNull(row.pstoCreatedAt),
      pstoUpdatedAt: now,
      lnkUpdatedAt: lnkTouchedRowIds.has(row.id)
        ? now
        : timestampOrNull(row.lnkUpdatedAt),
      updatedAt: now,
    }
    return Object.fromEntries([
      ['id', row.id],
      ...PSTO_LINE_ASSIGNMENT_UPDATE_FIELD_KEYS.map((fieldKey) => [
        fieldKey,
        values[fieldKey] ?? null,
      ]),
    ]) as NewWeldJoint
  })

  const savedRows: WeldRow[] = []
  for (const batch of splitWeldImportInsertBatches(payloads)) {
    const saved = await tx
      .insert(weldJoints)
      .values(batch)
      .onConflictDoUpdate({
        target: weldJoints.id,
        set: PSTO_LINE_ASSIGNMENT_UPDATE_SET,
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

function getPrimaryLnkPersistenceValues(row: WeldRow) {
  return {
    vikRequest: textOrNull(row.vikRequest),
    vikRequestDate: textOrNull(row.vikRequestDate),
    vikResult: textOrNull(row.vikResult),
    vikConclusionDate: textOrNull(row.vikConclusionDate),
    vikConclusion: textOrNull(row.vikConclusion),
    vikDefectDescription: textOrNull(row.vikDefectDescription),
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
    uzkDefectDescription: textOrNull(row.uzkDefectDescription),
    pvkRequest: textOrNull(row.pvkRequest),
    pvkRequestDate: textOrNull(row.pvkRequestDate),
    pvkResult: textOrNull(row.pvkResult),
    pvkConclusionDate: textOrNull(row.pvkConclusionDate),
    pvkConclusion: textOrNull(row.pvkConclusion),
    pvkDefectDescription: textOrNull(row.pvkDefectDescription),
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

function timestampOrNull(value: unknown) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null
  const text = String(value ?? '').trim()
  if (!text) return null
  const timestamp = new Date(text)
  return Number.isFinite(timestamp.getTime()) ? timestamp : null
}
