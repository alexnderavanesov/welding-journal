import { createServerFn } from '@tanstack/react-start'
import { and, asc, eq, sql, type SQL } from 'drizzle-orm'

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
  buildPstoCancelledRow,
  buildPstoRemovedRow,
  getCompletedPreHeatTreatmentMethodCodes,
  getPendingPreHeatTreatmentMethodCodes,
  getPreHeatTreatmentMethodCodes,
  getPrimaryStagedMethodCodes,
  getPstoLineAssignmentState,
  getPstoLineIdentityKey,
  normalizePstoLineIdentityPart,
  hasPerformedPstoHistory,
  hasPstoLifecycleData,
  hasPrimaryPstoHistory,
  isPstoCancelledValue,
  normalizePstoLineIdentity,
  normalizePstoLineMoveTargetIdentity,
  hasPrimaryLnkHistoryBeforePstoAssignment,
  type PstoLineAssignmentAction,
  type PstoLineActivationDecision,
  type PstoLineAssignmentPageRequest,
  type PstoLineAssignmentPageResult,
  type PstoLineIdentity,
  type PstoLineRemovalPreview,
  type PstoWeldLineMovePreview,
} from '@/lib/psto-line-assignment'
import { calculateFinalStatus } from '@/lib/weld-status'
import { buildPstoContextualStageCorrection, getPstoContextualStageCorrectionReason } from '@/lib/psto-contextual-stage-correction'
import { DEFAULT_CONTROL_PROCESS_SETTINGS, normalizeControlProcessSettings } from '@/lib/control-process-settings'
import { LNK_METHODS } from '@/lib/lnk-report-config'
import { isPreHeatTreatmentLnkMethodCode } from '@/lib/lnk-control-stage'
import { loadProgramSystemIndexSettings } from '@/server/line-program'
import { attachDuplicateControlRelations } from '@/server/duplicate-control-relations'
import { syncPreHeatTreatmentDocumentsInTransaction } from '@/server/pre-heat-treatment-system-documents'
import { splitWeldImportInsertBatches } from '@/lib/weld-import-limits'
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
import { attachHeatTreatmentControlRelations } from '@/server/heat-treatment-control-relations'
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
  syncSystemDocumentsForWeldChangesInTransaction,
} from '@/server/system-document-index'

type PstoLineAssignmentPayload = {
  identity: PstoLineIdentity
  action: PstoLineAssignmentAction
  expectedVersions: WeldRowVersionTarget[]
  cancellationDate?: string
  cancellationBasis?: string
  activationDecisions?: PstoLineActivationDecision[]
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
    const hydratedRows = await attachDuplicateControlRelations(await attachHeatTreatmentControlRelations(rows as WeldRow[]), db)
    const processSettings = await loadCorrectionPreviewProcessSettings(db)
    const systemIndexSettings = await loadProgramSystemIndexSettings(db)
    const preview = buildRemovalPreview(data, hydratedRows)
    preview.rows.forEach((item, index) => {
      const row = hydratedRows[index]!
      if (item.primaryMethods.length > 0 && !isControlEnabledValue(row.pstoRequired)) {
        item.stageCorrection = {
          targetStage: 'beforeHeatTreatment',
          disabledReason: getPstoContextualStageCorrectionReason(
            { ...row, pstoRequired: 'да', pstoCancellationDate: null, pstoControlBasis: null },
            'beforeHeatTreatment', processSettings, systemIndexSettings,
          ),
        }
      }
    })
    return preview
  })

export const getPstoWeldLineMovePreview = createServerFn({ method: 'POST' })
  .validator((value: { rowId: number; targetIdentity: PstoLineIdentity }) => ({
    rowId: Math.floor(Number(value?.rowId)),
    targetIdentity: normalizePstoLineMoveTargetIdentity(value?.targetIdentity ?? {}),
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
    if (getPstoLineIdentityKey(normalizePstoLineMoveTargetIdentity(sourceIdentity)) === getPstoLineIdentityKey(data.targetIdentity)) {
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
    const hydratedSourceScopeRows = await attachDuplicateControlRelations(await attachHeatTreatmentControlRelations(sourceScopeRows as WeldRow[]), db)
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
      !hasPrimaryLnkHistoryBeforePstoAssignment(sourceRow)
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
    if (!targetAssigned) {
      const processSettings = await loadCorrectionPreviewProcessSettings(db)
      const targetCancellationDate = targetRows.map(row => String(row.pstoCancellationDate ?? '').trim()).filter(Boolean).sort().at(-1) ?? ''
      preview.rows.forEach((item, index) => {
        const row = chainRows[index]!
        if ((row.preHeatTreatmentControls?.length ?? 0) === 0) return
        let cancellationReason: string | null = null
        if (targetState === 'cancelled') {
          try { assertPstoCancellationDateAfterHistory([row], targetCancellationDate) }
          catch (error) { cancellationReason = error instanceof Error ? error.message : String(error) }
        }
        item.stageCorrection = {
          targetStage: 'primary',
          disabledReason: cancellationReason ?? getPstoContextualStageCorrectionReason(
            { ...row, ...data.targetIdentity, pstoRequired: targetState === 'cancelled' ? 'отменен' : null },
            'primary', processSettings, systemIndexSettings,
          ),
        }
      })
    }
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
      rows: preview.rows,
      row: preview.rows.find((row) => row.rowId === storedRow.id)!,
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
        const decisions = new Map(data.activationDecisions.map(decision => [decision.rowId, decision.disposition]))
        if ([...decisions.keys()].some(id => !previousRows.has(id))) {
          throw new Error('Решение о НК содержит стык вне выбранной линии. Обновите окно.')
        }
        const transferredRowIds = new Set(data.activationDecisions
          .filter(decision => decision.disposition === 'movePrimaryToPreHeatTreatment').map(decision => decision.rowId))
        const systemIndexSettings = transferredRowIds.size > 0 ? await loadProgramSystemIndexSettings(tx) : DEFAULT_SYSTEM_INDEX_SETTINGS
        const nextRows = rows.map((row) => {
          let next = {
            ...row,
            pstoRequired: 'да',
            pstoControlBasis: null,
            pstoCancellationDate: null,
          } as WeldRow
          if (transferredRowIds.has(row.id)) {
            if (isControlEnabledValue(row.pstoRequired)) throw new Error(`Стык ${row.joint}: ПСТО уже назначено; исправление этапа недоступно.`)
            try {
              next = buildPstoContextualStageCorrection(next, 'beforeHeatTreatment', processSettings, systemIndexSettings)
            } catch (error) {
              throw new Error(`Стык ${row.joint || `#${row.id}`}: ${error instanceof Error ? error.message : String(error)}`)
            }
          }
          next.finalStatus = calculateFinalStatus(next)
          return next
        })
        const pendingControls = nextRows.flatMap(row => (row.preHeatTreatmentControls ?? []).filter(control => control.id < 0))
        const savedControls: Array<typeof preHeatTreatmentControls.$inferSelect> = []
        for (const batch of splitWeldImportInsertBatches(pendingControls.map(({ id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...control }) => control))) {
          savedControls.push(...await tx.insert(preHeatTreatmentControls).values(batch).returning())
        }
        if (savedControls.length !== pendingControls.length) throw new Error('Не удалось перенести весь комплект НК. Ничего не сохранено.')
        const savedByRow = groupByRowId(savedControls)
        for (const row of nextRows) {
          if (transferredRowIds.has(row.id)) row.preHeatTreatmentControls = savedByRow.get(row.id) ?? []
        }
        const updatedRows = await persistPstoLineAssignmentRows(
          tx,
          nextRows,
          now,
          transferredRowIds,
        )
        if (transferredRowIds.size > 0) {
          await syncSystemDocumentsForWeldChangesInTransaction(tx, updatedRows, previousRows)
          await syncPreHeatTreatmentDocumentsInTransaction(tx, updatedRows, savedControls)
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
          const next = buildPstoRemovedRow(row)
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
      const nextRows = rows.map(row => {
        const next = buildPstoCancelledRow({ row, cancellationDate: data.cancellationDate, cancellationBasis: data.cancellationBasis })
        next.finalStatus = calculateFinalStatus(next)
        return next
      })
      const updatedRows = await persistPstoLineAssignmentRows(tx, nextRows, now)
      // No stage promotion, source-document removal or repeat-cycle deletion on cancellation.
      await syncSystemDocumentsForWeldChangesInTransaction(tx, updatedRows, previousRows)
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
  if (value.activationDecisions !== undefined && !Array.isArray(value.activationDecisions)) throw new Error('Некорректные решения о НК.')
  const activationDecisions = value.activationDecisions ?? []
  if (activationDecisions.length > 0 && action !== 'assign' && action !== 'reactivate') throw new Error('При снятии или отмене ПСТО этапы НК сохраняются.')
  const decisionIds = new Set<number>()
  for (const decision of activationDecisions) {
    if (!Number.isSafeInteger(decision?.rowId) || decision.rowId <= 0 || decisionIds.has(decision.rowId)) throw new Error('Некорректный или повторный стык в решениях о НК.')
    if (!['keepPrimary', 'movePrimaryToPreHeatTreatment'].includes(decision.disposition) || 'methodCodes' in decision) {
      throw new Error('Смена этапа НК больше не поддерживается в прежнем формате. Обновите окно: переносится только целый комплект.')
    }
    decisionIds.add(decision.rowId)
  }
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
  }
}

async function loadCorrectionPreviewProcessSettings(db: Pick<SystemDocumentSequenceTransaction, 'select'>) {
  const [stored] = await db.select({ value: appSettings.value }).from(appSettings)
    .where(eq(appSettings.key, PROJECT_SETTING_KEYS.controlProcesses)).limit(1)
  return normalizeControlProcessSettings(parseStoredJson(stored?.value) ?? DEFAULT_CONTROL_PROCESS_SETTINGS)
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
    const completedPreMethods = getCompletedPreHeatTreatmentMethodCodes(row.preHeatTreatmentControls ?? [])
    const pendingPreMethods = getPendingPreHeatTreatmentMethodCodes(row.preHeatTreatmentControls ?? [])
    const primaryMethods = getPrimaryStagedMethodCodes(row)
    return {
      rowId: row.id,
      joint: String(row.joint ?? '').trim(),
      spool: String(row.spool ?? '').trim(),
      preMethods,
      completedPreMethods,
      pendingPreMethods,
      primaryMethods,
      pstoRequest: String(row.pstoRequest ?? '').trim(),
      pstoResult: String(row.pstoResult ?? '').trim(),
      repeatCycleCount: row.pstoRepeatCycles?.length ?? 0,
      preservesPerformedHistory: hasPerformedPstoHistory(row),
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
    historyRowCount: rows.filter(hasPstoLifecycleData).length,
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

const PSTO_LINE_ASSIGNMENT_UPDATE_FIELD_KEYS = [
  'pstoRequired',
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
