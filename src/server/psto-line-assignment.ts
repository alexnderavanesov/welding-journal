import { applyPstoAssignmentRows } from './psto-assignment-transition'
import { applyPstoChainPolicy, getPstoChainDecision, getPstoProgramState } from '@/lib/psto-chain-policy'
import { ensurePstoProgram, overlayPstoProgramPolicies, setPstoProgram } from './psto-chain-policy'
import { createServerFn } from '@tanstack/react-start'
import { and, asc, eq, sql } from 'drizzle-orm'

import { requireDb } from '@/db'
import {
  appSettings,
  duplicateControls,
  preHeatTreatmentControls,
  pstoRepeatCycles,
  weldJoints,
} from '@/db/schema'
import {
  isControlEnabledValue,
} from '@/lib/control-availability-values'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { DuplicateControlRecord } from '@/lib/duplicate-control-types'
import { normalizeJointChainPart, parseJointChainName } from '@/lib/joint-chain'
import {
  assertPstoCancellationDateAfterHistory,
  assertPstoLineAssignmentActionAllowed,
  getCompletedPreHeatTreatmentMethodCodes,
  getPendingPreHeatTreatmentMethodCodes,
  getPreHeatTreatmentMethodCodes,
  getPrimaryStagedMethodCodes,
  getPstoLineIdentityKey,
  normalizePstoLineIdentityPart,
  hasPerformedPstoHistory,
  hasPstoLifecycleData,
  hasPrimaryPstoHistory,
  isPstoCancelledValue,
  normalizePstoLineIdentity,
  normalizePstoLineMoveTargetIdentity,
  type PstoLineAssignmentAction,
  type PstoLineActivationDecision,
  type PstoLineAssignmentPageRequest,
  type PstoLineAssignmentPageResult,
  type PstoLineIdentity,
  type PstoLineRemovalPreview,
  type PstoWeldLineMovePreview,
} from '@/lib/psto-line-assignment'
import { getPstoContextualStageCorrectionReason } from '@/lib/psto-contextual-stage-correction'
import { DEFAULT_CONTROL_PROCESS_SETTINGS, normalizeControlProcessSettings } from '@/lib/control-process-settings'
import { loadProgramSystemIndexSettings } from '@/server/line-program'
import { attachDuplicateControlRelations } from '@/server/duplicate-control-relations'
import { PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'
import { getJointChainRows } from '@/lib/repeated-joint-row-utils'
import {
  DEFAULT_SYSTEM_INDEX_SETTINGS,
  normalizeSystemIndexSettings,
} from '@/lib/system-index-settings'
import { loadControlProcessSettingsFromTransaction } from '@/server/control-process-settings'
import { markDispatcherTaskIndexDirty } from '@/server/dispatcher-task-index-dirty'
import {
  hasActiveEarlyCoilDecisionForSource,
} from '@/server/early-coil-decision-guard'
import { attachHeatTreatmentControlRelations } from '@/server/heat-treatment-control-relations'
import { assertSecurityScope } from '@/server/security-functions'
import {
  loadPstoLineAssignmentSummaryPage,
  loadPstoLineFilterOptions,
  normalizePstoLineAssignmentPageRequest,
} from '@/server/psto-line-assignment-summary'
import type { SystemDocumentSequenceTransaction } from '@/server/system-document-sequences'
import { WELD_TABLE_RETURNING } from '@/server/weld-server-shared'
import { assertExpectedInteractiveWeldVersions } from '@/server/weld-row-version'
import { lockWeldLineMemberships } from '@/server/weld-line-membership-lock'
import type { WeldRowVersionTarget } from '@/lib/weld-row-version'
import { buildNumberArrayMatch } from '@/server/weld-request-utils'

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

export const listPstoLineFilterOptions = createServerFn({ method: 'POST' })
  .validator((value: PstoLineAssignmentPageRequest & { field: string; match?: string; offset?: number }) => ({
    ...normalizePstoLineAssignmentPageRequest(value), field: String(value.field), match: String(value.match ?? '').trim().slice(0, 200),
    offset: Number.isSafeInteger(value.offset) && value.offset! > 0 ? value.offset! : 0,
  }))
  .handler(async ({ data }) => {
    await assertSecurityScope('entry')
    return loadPstoLineFilterOptions(requireDb(), data, data.field, data.match, data.offset)
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
    // Exceptions retain their effective decision while the baseline changes.
    // Their history must not force a cancellation of otherwise empty assignments.
    const baselinePreview = buildRemovalPreview(data, hydratedRows.filter(row => !row.pstoExceptionBasis))
    for (const key of ['historyRowCount', 'requestOnlyCount', 'completedPstoCount', 'preControlCount', 'completedPreControlCount', 'pendingPreControlCount', 'repeatCycleCount'] as const) preview[key] = baselinePreview[key]
    preview.rows.forEach((item, index) => {
      const row = hydratedRows[index]!
      if (row.pstoExceptionBasis) return
      if (item.primaryMethods.length > 0 && !isControlEnabledValue(row.pstoRequired)) {
        item.stageCorrection = {
          targetStage: 'beforeHeatTreatment',
          disabledReason: getPstoContextualStageCorrectionReason(
            { ...row, pstoRequired: 'да', pstoCancellationDate: null, pstoControlBasis: null },
            'beforeHeatTreatment', processSettings, systemIndexSettings,
          ),
        }
      } else if (item.preMethods.length > 0 && isControlEnabledValue(row.pstoRequired)) {
        item.stageCorrection = {
          targetStage: 'primary',
          disabledReason: getPstoContextualStageCorrectionReason({ ...row, pstoRequired: 'отменен' }, 'primary', processSettings, systemIndexSettings),
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
    const isChainMove = Boolean(storedRow.pstoExceptionBasis) || chainRows.length > 1 ||
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
    const policies = await overlayPstoProgramPolicies(db, [storedRow, data.targetIdentity], new Map([[getPstoLineIdentityKey(data.targetIdentity), {
      rowCount: targetRows.length, assignedCount: targetRows.filter(row => isControlEnabledValue(row.pstoRequired)).length,
      cancelledCount: targetRows.filter(row => isPstoCancelledValue(row.pstoRequired)).length,
    }]]))
    const targetPolicy = policies.get(getPstoLineIdentityKey(data.targetIdentity))
    const targetProgramState = getPstoProgramState(targetPolicy)
    if (targetProgramState === 'mixed') throw new Error('Целевая линия содержит смешанное назначение ПСТО. Сначала уточните её программу.')
    const sourceException = getPstoChainDecision(policies.get(getPstoLineIdentityKey(storedRow)), storedRow.joint, systemIndexSettings)
    const targetException = getPstoChainDecision(targetPolicy, storedRow.joint, systemIndexSettings)
    const targetAssigned = sourceException?.required ?? targetException?.required ?? targetProgramState === 'assigned'
    const sourceRow = chainRows.find((row) => row.id === storedRow.id) ?? (storedRow as WeldRow)
    if (
      !isChainMove &&
      targetAssigned &&
      getPrimaryStagedMethodCodes(sourceRow).length === 0
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
    const targetState = targetAssigned ? 'assigned' : targetProgramState === 'cancelled' ? 'cancelled' : 'unassigned'
    const preview = buildRemovalPreview(sourceIdentity, chainRows)
    {
      const processSettings = await loadCorrectionPreviewProcessSettings(db)
      const targetCancellationDate = targetPolicy?.cancellationDate || targetRows.map(row => String(row.pstoCancellationDate ?? '').trim()).filter(Boolean).sort().at(-1) || ''
      preview.rows.forEach((item, index) => {
        const row = chainRows[index]!
        if (targetAssigned ? item.primaryMethods.length === 0 : (row.preHeatTreatmentControls?.length ?? 0) === 0) return
        let cancellationReason: string | null = null
        if (targetState === 'cancelled') {
          try { assertPstoCancellationDateAfterHistory([row], targetCancellationDate) }
          catch (error) { cancellationReason = error instanceof Error ? error.message : String(error) }
        }
        item.stageCorrection = {
          targetStage: targetAssigned ? 'beforeHeatTreatment' : 'primary',
          disabledReason: cancellationReason ?? getPstoContextualStageCorrectionReason(
            { ...row, ...data.targetIdentity, pstoRequired: targetAssigned ? 'да' : targetState === 'cancelled' ? 'отменен' : null },
            targetAssigned ? 'beforeHeatTreatment' : 'primary', processSettings, systemIndexSettings,
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
      const policies = await overlayPstoProgramPolicies(tx, [data.identity], new Map([[getPstoLineIdentityKey(data.identity), {
        rowCount: rows.length, assignedCount: rows.filter(row => isControlEnabledValue(row.pstoRequired)).length,
        cancelledCount: rows.filter(row => isPstoCancelledValue(row.pstoRequired)).length,
      }]]))
      const state = getPstoProgramState(policies.get(getPstoLineIdentityKey(data.identity)))
      assertPstoLineAssignmentActionAllowed(data.action, state)
      // Legacy mixed lines can still be repaired by the explicit whole-line command.
      const nextState = data.action === 'assign' || data.action === 'reactivate' ? 'assigned' : data.action === 'cancel' ? 'cancelled' : 'unassigned'
      const policy = policies.get(getPstoLineIdentityKey(data.identity))!
      const settings = await loadProgramSystemIndexSettings(tx)
      const affectedRows = rows.filter(row => {
        const next = applyPstoChainPolicy(row, { ...policy, programState: nextState }, settings)
        return isControlEnabledValue(next.pstoRequired) !== isControlEnabledValue(row.pstoRequired)
      })
      if (data.action === 'remove' && affectedRows.some(row => hasPstoLifecycleData(row))) {
        throw new Error('У линии уже есть история ПСТО или НК до ТО. Используйте официальную отмену ПСТО.')
      }
      if (data.action === 'cancel') {
        if (!affectedRows.some(row => hasPstoLifecycleData(row))) throw new Error('У линии нет истории. Уберите ошибочное назначение без оформления отмены.')
        assertPstoCancellationDateAfterHistory(affectedRows, data.cancellationDate)
      }
      const program = await ensurePstoProgram(tx, rows, state === 'mixed' ? nextState : state)
      await setPstoProgram(tx, program, nextState, data.cancellationDate, data.cancellationBasis)
      const nextPolicies = await overlayPstoProgramPolicies(tx, [data.identity], policies)
      const nextRows = rows.map(row => applyPstoChainPolicy(row, nextPolicies.get(getPstoLineIdentityKey(data.identity))!, settings))
      const updatedRows = await applyPstoAssignmentRows(tx, rows, nextRows, data.activationDecisions, processSettings, settings)
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
  if (activationDecisions.length > 0 && action === 'remove') throw new Error('При удалении пустого назначения нет НК для переноса.')
  const decisionIds = new Set<number>()
  for (const decision of activationDecisions) {
    if (!Number.isSafeInteger(decision?.rowId) || decision.rowId <= 0 || decisionIds.has(decision.rowId)) throw new Error('Некорректный или повторный стык в решениях о НК.')
    if (!['keepPrimary', action === 'cancel' ? 'movePreHeatTreatmentToPrimary' : 'movePrimaryToPreHeatTreatment'].includes(decision.disposition) || 'methodCodes' in decision) {
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

export function buildRemovalPreview(
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

function groupByRowId<Row extends { weldJointId: number }>(records: Row[]) {
  const groups = new Map<number, Row[]>()
  for (const record of records) {
    const current = groups.get(record.weldJointId) ?? []
    current.push(record)
    groups.set(record.weldJointId, current)
  }
  return groups
}
