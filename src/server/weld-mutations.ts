// This module is intentionally domain-scoped. Keep cross-domain rules in weld-server-shared.

import { requireDb } from '@/db'
import {
duplicateControls,
generatedDocuments,
generatedDocumentWeldJoints,
preHeatTreatmentControls,
weldJoints,
type WeldJoint
} from '@/db/schema'
import { normalizeDateLikeForStorage } from '@/lib/date-format'
import { isControlEnabledValue } from '@/lib/control-availability-values'
import type { WeldRow } from '@/lib/dispatcher-types'
import {
assertExistingRowsImportPayload,
} from '@/lib/existing-row-import-validation'
import {
buildLnkRequestExtensionRows,
getLnkRequestExtensionDisabledReason,
normalizeLnkRequestExtensionRequest,
type LnkRequestExtensionRequest,
} from '@/lib/lnk-request-extension'
import {
buildLnkRequestManagerRows,
buildLnkRequestPositionRemovalRow,
} from '@/lib/lnk-request-mutation-updates'
import {
buildClearedPrimaryLnkStageRows,
buildPrimaryToPreHeatTreatmentTransfer,
type LnkStageTransferControlWrite,
} from '@/lib/lnk-stage-transfer'
import { getLnkMethodByRequestKey } from '@/lib/lnk-status'
import {
assertPstoCancellationDateAfterHistory,
buildPstoAssignedKeepPrimaryValidationRow,
buildPstoCancelledRow,
buildPstoMovedToUnassignedLineRow,
getCompletedPreHeatTreatmentMethodCodes,
getPrimaryStagedMethodCodes,
getPstoLineIdentityKey,
hasPerformedPstoHistory,
normalizePstoLineIdentity,
requiresPrimaryStageResolutionForAssignedPstoLine,
type PstoWeldLineMoveDisposition,
} from '@/lib/psto-line-assignment'
import { normalizeJointChainPart, parseJointChainName } from '@/lib/joint-chain'
import { getJointChainRows } from '@/lib/repeated-joint-row-utils'
import {
isAuthorizedSystemRepeatedJointRename,
type SystemRepeatedJointRenameRequest,
} from '@/lib/repeated-joint-system-rename'
import {
LNK_METHODS
} from '@/lib/report-config'
import { isSameRequestDocument } from '@/lib/request-document-identity'
import {
type WeldFieldKey,
type WeldInput
} from '@/lib/weld-fields'
import {
assertUniqueWeldMutationTargets,
splitWeldImportInsertBatches
} from '@/lib/weld-import-limits'
import { calculateFinalStatus } from '@/lib/weld-status'
import { hasPstoCycleExecutionHistory } from '@/lib/psto-cycle'
import {
getPreHeatTreatmentLnkExemptionForNewRow,
getPreHeatTreatmentLnkExemptionsForNewRows,
loadControlProcessSettingsFromTransaction,
} from '@/server/control-process-settings'
import {
assertJointChainIdentityChangesUseDedicatedMove,
normalizeWeldChainLineMovePlan,
} from '@/server/joint-chain-line-move-guard'
import { attachDuplicateControlRelations } from '@/server/duplicate-control-relations'
import { attachHeatTreatmentControlRelations } from '@/server/heat-treatment-control-relations'
import {
markDispatcherTaskIndexDirty,
type DispatcherDirtyScope,
} from '@/server/dispatcher-task-index-dirty'
import { syncPreHeatTreatmentDocumentsInTransaction } from '@/server/pre-heat-treatment-system-documents'
import { deletePstoRepeatCyclesInTransaction } from '@/server/psto-cycle-state'
import { assertPstoWorkflowLinesFullyAssigned } from '@/server/psto-workflow-line-guard'
import { assertSecurityScope } from '@/server/security-functions'
import {
removeHeatTreatmentSourcedDocumentPositionsForWeldsInTransaction,
removeSourcedSystemDocumentPositionsInTransaction,
syncSystemDocumentsForWeldChangesInTransaction,
} from '@/server/system-document-index'
import {
applyReservedSystemDocumentNames,
reserveSystemDocumentName,
type SystemDocumentSequenceTransaction,
} from '@/server/system-document-sequences'
import {
type WeldBatchUpdateData,
type WeldMutationScope,
type WeldPayload
} from '@/server/weld-contracts'
import {
hasPstoLifecycleHistory,
loadPreviousWeldRows,
loadServerWeldValidationContext,
mergeWeldRecordsWithPrevious,
prepareServerWeldRecords,
validateServerWeldRecords,
} from '@/server/weld-save-validation'
import { createServerFn } from '@tanstack/react-start'
import { and,eq,inArray,isNull,notExists,or,sql } from 'drizzle-orm'

import {
getProfileTimestampUpdates,
toDbInsert,
updateWeldJointsInBatches,
} from '@/server/weld-persistence'
import { restrictWeldMutationRecord } from '@/server/weld-mutation-policy'
import { splitNumberBatches } from '@/server/weld-request-utils'
import {
assertEarlyCoilDecisionRowsCanBeDeleted,
assertEarlyCoilDecisionSourcesRemainValid,
hasActiveEarlyCoilDecisionForSource,
refreshEarlyCoilDecisionContextsInTransaction,
} from '@/server/early-coil-decision-guard'

export { restrictWeldMutationRecord } from '@/server/weld-mutation-policy'

export const createWeldJoint = createServerFn({ method: 'POST' })
  .validator((data: WeldPayload) => data)
  .handler(async ({ data }) => {
    await assertSecurityScope('edit')
    const db = requireDb()
    return db.transaction(async (tx) => {
      const validationContext = await loadServerWeldValidationContext(tx)
      prepareServerWeldRecords({ records: [data], previousRows: new Map(), context: validationContext })
      validateServerWeldRecords({
        records: [data],
        previousRows: new Map(),
        context: validationContext,
      })
      const preHeatTreatmentLnkExempt = await getPreHeatTreatmentLnkExemptionForNewRow(tx, data)
      const [created] = await tx
        .insert(weldJoints)
        .values({ ...toDbInsert(data, true), preHeatTreatmentLnkExempt })
        .returning()
      await syncSystemDocumentsForWeldChangesInTransaction(tx, [created], new Map())
      await markDispatcherTaskIndexDirty(tx, { scopes: getDispatcherDirtyScopes([data], new Map()) })
      return created
    })
  })

export const updateWeldJoint = createServerFn({ method: 'POST' })
  .validator((data: WeldPayload) => data)
  .handler(async ({ data }) => updateWeldJointRecord(data, false))

export const updateSystemWeldJoint = createServerFn({ method: 'POST' })
  .validator((data: SystemRepeatedJointRenameRequest) => ({
    changes: Array.isArray(data.changes)
      ? data.changes.map((change) => ({
          rowId: Number(change?.rowId),
          currentJoint: String(change?.currentJoint ?? '').trim(),
          targetJoint: String(change?.targetJoint ?? '').trim(),
        }))
      : [],
  }))
  .handler(async ({ data }) => {
    await assertSecurityScope('edit')
    if (
      data.changes.length === 0 ||
      data.changes.length > 1_000 ||
      data.changes.some((change) => (
        !Number.isInteger(change.rowId) ||
        change.rowId <= 0 ||
        !change.currentJoint ||
        !change.targetJoint ||
        change.currentJoint.toUpperCase() === change.targetJoint.toUpperCase()
      )) ||
      new Set(data.changes.map((change) => change.rowId)).size !== data.changes.length
    ) {
      throw new Error('Некорректные данные системного переименования стыка.')
    }
    const db = requireDb()
    return db.transaction(async (tx) => {
      const firstChange = data.changes[0]!
      const [anchor] = await tx.select().from(weldJoints).where(eq(weldJoints.id, firstChange.rowId)).limit(1)
      if (!anchor) throw new Error('Стык для переименования не найден.')

      const projectClause = anchor.projectTitle === null
        ? or(isNull(weldJoints.projectTitle), eq(weldJoints.projectTitle, ''))!
        : eq(weldJoints.projectTitle, anchor.projectTitle)
      const subtitleClause = anchor.subtitleCode === null
        ? or(isNull(weldJoints.subtitleCode), eq(weldJoints.subtitleCode, ''))!
        : eq(weldJoints.subtitleCode, anchor.subtitleCode)
      const lineClause = anchor.line === null
        ? or(isNull(weldJoints.line), eq(weldJoints.line, ''))!
        : eq(weldJoints.line, anchor.line)
      const storedRows = await tx
        .select()
        .from(weldJoints)
        .where(and(projectClause, subtitleClause, lineClause))
        .for('update')
      const rows = await attachDuplicateControlRelations(
        await attachHeatTreatmentControlRelations(storedRows as WeldRow[], tx),
        tx,
      )
      const previousRows = new Map(rows.map((row) => [row.id, row as unknown as WeldJoint]))
      for (const change of data.changes) {
        const previous = previousRows.get(change.rowId)
        if (!previous) throw new Error('Состав цепочки уже изменился. Обновите диспетчер задач.')
        if (String(previous.joint ?? '').trim().toUpperCase() !== change.currentJoint.toUpperCase()) {
          throw new Error('Название одного из стыков уже изменилось. Обновите диспетчер задач.')
        }
      }

      const validationContext = await loadServerWeldValidationContext(tx)
      if (!isAuthorizedSystemRepeatedJointRename(
        rows as WeldRow[],
        data,
        validationContext.systemIndexSettings,
      )) {
        throw new Error('Системное переименование больше не соответствует текущим правилам цепочки.')
      }

      const records = data.changes.map((change) => ({
        ...previousRows.get(change.rowId)!,
        joint: change.targetJoint,
      }))
      const allowedJointRenameRowIds = new Set(data.changes.map((change) => change.rowId))
      await assertEarlyCoilDecisionSourcesRemainValid(
        tx,
        records,
        previousRows,
        { allowedJointRenameRowIds },
      )
      validateServerWeldRecords({
        records,
        previousRows,
        context: validationContext,
        allowSystemJointNames: true,
      })
      const updatedRows = await updateWeldJointsInBatches(tx, records, previousRows)
      await syncSystemDocumentsForWeldChangesInTransaction(
        tx,
        updatedRows,
        previousRows,
      )
      await refreshEarlyCoilDecisionContextsInTransaction(
        tx,
        updatedRows,
        validationContext.systemIndexSettings,
      )
      await markDispatcherTaskIndexDirty(tx, {
        scopes: getDispatcherDirtyScopes(records, previousRows),
      })
      return updatedRows
    })
  })

export async function updateWeldJointRecord(data: WeldPayload, allowSystemJointNames: boolean) {
  await assertSecurityScope('edit')
  if (!data.id) throw new Error('Не передан id записи')
  const id = data.id
  const db = requireDb()

  return db.transaction(async (tx) => {
    const processSettings = await loadControlProcessSettingsFromTransaction(tx)
    const mutationScope = data.mutationScope ?? 'welding'
    const scopedData = restrictWeldMutationRecord(data, mutationScope)
    const previousRows = await loadPreviousWeldRows(tx, [scopedData])
    if (!previousRows.has(id)) throw new Error(`Запись ${id} не найдена`)
    const [mergedRecord] = mergeWeldRecordsWithPrevious([scopedData], previousRows)
    let record = mergedRecord as WeldRow
    const validationContext = await loadServerWeldValidationContext(tx)
    const previousStored = previousRows.get(id)!
    await assertJointChainIdentityChangesUseDedicatedMove(
      tx,
      [record],
      previousRows,
      validationContext.systemIndexSettings,
    )
    const preparedMove = await preparePstoLineMoveRecordInTransaction({
      tx,
      record,
      previousStored,
      validationContext,
      processSettings,
      disposition: data.pstoLineMoveDisposition,
    })
    record = preparedMove.record
    const validationPreviousRows = new Map([[id, preparedMove.validationPrevious]])
    const pendingPreHeatTreatmentControls = preparedMove.pendingPreHeatTreatmentControls
    const requiresLifecycleCleanup = preparedMove.requiresLifecycleCleanup

    await assertEarlyCoilDecisionSourcesRemainValid(tx, [record], previousRows)
    prepareServerWeldRecords({
      records: [record],
      previousRows: validationPreviousRows,
      context: validationContext,
      allowPstoLineLifecycleMove: requiresLifecycleCleanup,
    })
    validateServerWeldRecords({
      records: [record],
      previousRows: validationPreviousRows,
      context: validationContext,
      allowSystemJointNames,
    })
    await applyPstoLineMoveCleanupInTransaction(tx, [preparedMove.cleanup])
    let savedPreHeatTreatmentControls: typeof preHeatTreatmentControls.$inferSelect[] = []
    if (pendingPreHeatTreatmentControls.length > 0) {
      savedPreHeatTreatmentControls = await tx
        .insert(preHeatTreatmentControls)
        .values(pendingPreHeatTreatmentControls)
        .returning()
      record.preHeatTreatmentControls = savedPreHeatTreatmentControls
      record.finalStatus = calculateFinalStatus(record)
    }
    const insertData = toDbInsert(record)
    const timestampUpdates = getProfileTimestampUpdates(record, previousRows.get(id), new Date())
    const [updated] = await tx
      .update(weldJoints)
      .set({
        ...insertData,
        preHeatTreatmentLnkExempt: record.preHeatTreatmentLnkExempt === true,
        ...timestampUpdates,
        updatedAt: new Date(),
      })
      .where(eq(weldJoints.id, id))
      .returning()
    if (!updated) throw new Error(`Запись ${id} не найдена`)
    await syncSystemDocumentsForWeldChangesInTransaction(tx, [updated], previousRows)
    if (savedPreHeatTreatmentControls.length > 0) {
      await syncPreHeatTreatmentDocumentsInTransaction(
        tx,
        [{ ...updated, preHeatTreatmentControls: savedPreHeatTreatmentControls } as WeldRow],
        savedPreHeatTreatmentControls,
      )
    }
    await markDispatcherTaskIndexDirty(tx, { scopes: getDispatcherDirtyScopes([record], previousRows) })
    return savedPreHeatTreatmentControls.length > 0
      ? { ...updated, preHeatTreatmentControls: savedPreHeatTreatmentControls }
      : updated
  })
}

export const moveWeldJointChain = createServerFn({ method: 'POST' })
  .validator((data: WeldPayload) => data)
  .handler(async ({ data }) => moveWeldJointChainRecord(data))

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
    const sourceFirst = sourceIdentityKey.localeCompare(targetIdentityKey) <= 0
    const lockKey = [sourceIdentityKey, targetIdentityKey].sort().join('|')
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`weld-chain-line-move:${lockKey}`}))`)

    const firstScopeRows = await tx
      .select()
      .from(weldJoints)
      .where(buildWeldLineIdentityWhere(sourceFirst ? sourceIdentity : targetIdentity))
      .for('update')
    const secondScopeRows = await tx
      .select()
      .from(weldJoints)
      .where(buildWeldLineIdentityWhere(sourceFirst ? targetIdentity : sourceIdentity))
      .for('update')
    const sourceScopeRows = sourceFirst ? firstScopeRows : secondScopeRows
    const targetRows = sourceFirst ? secondScopeRows : firstScopeRows
    const storedSource = sourceScopeRows.find((row) => row.id === sourceRowId)
    if (!storedSource || getPstoLineIdentityKey(storedSource) !== sourceIdentityKey) {
      throw new Error('Исходный стык изменился во время переноса. Вернитесь к форме и повторите действие.')
    }

    const initialContext = await loadServerWeldValidationContext(tx)
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
    const exemptionCandidates = records.filter((record) => {
      const previous = previousRows.get(Number(record.id))
      if (!previous || previous.preHeatTreatmentLnkExempt === true) return false
      return getPstoLineIdentityKey(previous) !== getPstoLineIdentityKey(record)
    })
    const exemptions = exemptionCandidates.length > 0
      ? await getPreHeatTreatmentLnkExemptionsForNewRows(tx, exemptionCandidates)
      : []
    const exemptionsByRowId = new Map(
      exemptionCandidates.map((record, index) => [Number(record.id), exemptions[index] ?? false]),
    )
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
        resolvedPreHeatTreatmentLnkExempt: exemptionsByRowId.get(Number(record.id)),
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

async function preparePstoLineMoveRecordInTransaction({
  tx,
  record: inputRecord,
  previousStored,
  validationContext,
  processSettings,
  disposition,
  resolvedPreHeatTreatmentLnkExempt,
}: {
  tx: SystemDocumentSequenceTransaction
  record: WeldRow
  previousStored: WeldJoint
  validationContext: Awaited<ReturnType<typeof loadServerWeldValidationContext>>
  processSettings: Awaited<ReturnType<typeof loadControlProcessSettingsFromTransaction>>
  disposition?: PstoWeldLineMoveDisposition
  resolvedPreHeatTreatmentLnkExempt?: boolean
}) {
  const id = previousStored.id
  const previous = previousStored as unknown as WeldRow
  let record = inputRecord
  let validationPrevious = previousStored
  let pendingPreHeatTreatmentControls: LnkStageTransferControlWrite[] = []
  const cleanup: PstoLineMoveCleanupPlan = {
    preHeatTreatmentControlIds: [],
    preHeatTreatmentWeldJointId: null,
    unstartedRepeatCycles: [],
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
  if (identityChanged && previous.preHeatTreatmentLnkExempt !== true) {
    record.preHeatTreatmentLnkExempt = resolvedPreHeatTreatmentLnkExempt ??
      await getPreHeatTreatmentLnkExemptionForNewRow(tx, record)
  }
  if (
    (disposition === 'movePrimaryToBeforeHeatTreatment' || disposition === 'deletePrimary') &&
    !targetLineAssigned
  ) {
    throw new Error('Назначение ПСТО целевой линии изменилось. Вернитесь к форме и проверьте линию еще раз.')
  }
  const requiresPrimaryStageResolution = (
    processSettings.preHeatTreatmentLnkEnabled &&
    identityChanged &&
    targetLineAssigned &&
    record.preHeatTreatmentLnkExempt !== true &&
    requiresPrimaryStageResolutionForAssignedPstoLine(previous)
  )
  const requiresLifecycleCleanup = identityChanged && !targetLineAssigned && hasPstoLifecycleHistory(previousStored)

  if (requiresPrimaryStageResolution) {
    if (
      disposition !== 'keepPrimary' &&
      disposition !== 'movePrimaryToBeforeHeatTreatment' &&
      disposition !== 'deletePrimary'
    ) {
      throw new Error(
        `Стык ${String(previous.joint ?? '').trim() || `#${id}`}: выберите, сохранить основной комплект, ` +
        'перенести его в «До ТО» или удалить.',
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
    } else {
      record = buildClearedPrimaryLnkStageRows({
        rows: [moveRow],
        positions,
      })[0]!
    }
  }

  if (requiresLifecycleCleanup) {
    if (disposition !== 'keepPrimary' && disposition !== 'promoteBeforeHeatTreatment') {
      throw new Error(
        `Стык ${String(previous.joint ?? '').trim() || `#${id}`}: выберите, какой комплект НК сохранить ` +
        'при переносе на линию без ПСТО.',
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
    if (
      disposition === 'promoteBeforeHeatTreatment' &&
      (preservesPerformedHistory || getCompletedPreHeatTreatmentMethodCodes(controls).length === 0)
    ) {
      throw new Error(
        `Стык ${String(previous.joint ?? '').trim() || `#${id}`}: ` +
        'для переноса в основной комплект нет завершенного НК до ТО.',
      )
    }
    const moveRow = {
      ...record,
      duplicateControls: previous.duplicateControls ?? [],
    } as WeldRow
    const cleanedRecord = targetLineCancelled
      ? buildPstoCancelledRow({
          row: moveRow,
          controls,
          disposition,
          cancellationDate: targetLineState?.cancellationDate ?? '',
          cancellationBasis: targetLineState?.cancellationBasis ?? '',
        })
      : buildPstoMovedToUnassignedLineRow({ row: moveRow, controls, disposition })
    const unstartedRepeatCycles = (previous.pstoRepeatCycles ?? [])
      .filter((cycle) => !hasPstoCycleExecutionHistory(cycle))
    cleanedRecord.preHeatTreatmentControls = preservesPerformedHistory ? controls : []
    cleanedRecord.finalStatus = calculateFinalStatus(cleanedRecord)
    record = cleanedRecord

    validationPrevious = {
      ...cleanedRecord,
      projectTitle: previous.projectTitle,
      subtitleCode: previous.subtitleCode,
      line: previous.line,
    } as unknown as WeldJoint

    if (!preservesPerformedHistory && controls.length > 0) {
      cleanup.preHeatTreatmentControlIds = controls.map((control) => control.id)
      cleanup.preHeatTreatmentWeldJointId = id
    }
    if (unstartedRepeatCycles.length > 0) {
      cleanup.unstartedRepeatCycles = unstartedRepeatCycles
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

type PstoLineMoveCleanupPlan = {
  preHeatTreatmentControlIds: number[]
  preHeatTreatmentWeldJointId: number | null
  unstartedRepeatCycles: NonNullable<WeldRow['pstoRepeatCycles']>
}

async function applyPstoLineMoveCleanupInTransaction(
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
      .where(inArray(preHeatTreatmentControls.weldJointId, preHeatTreatmentWeldJointIds))
  }

  const unstartedRepeatCycles = [...new Map(
    plans
      .flatMap((plan) => plan.unstartedRepeatCycles)
      .map((cycle) => [cycle.id, cycle]),
  ).values()]
  if (unstartedRepeatCycles.length === 0) return
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
  await deletePstoRepeatCyclesInTransaction(
    tx,
    unstartedRepeatCycles.map((cycle) => cycle.id),
  )
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
    'deletePrimary',
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

function buildWeldLineIdentityWhere(identity: ReturnType<typeof normalizePstoLineIdentity>) {
  return and(
    sql`btrim(coalesce(${weldJoints.projectTitle}, '')) = ${identity.projectTitle}`,
    sql`btrim(coalesce(${weldJoints.subtitleCode}, '')) = ${identity.subtitleCode}`,
    sql`btrim(coalesce(${weldJoints.line}, '')) = ${identity.line}`,
  )
}

export const createWeldJoints = createServerFn({ method: 'POST' })
  .validator((data: { records: WeldPayload[] }) => data)
  .handler(async ({ data }) => {
    await assertSecurityScope('edit')
    if (data.records.length === 0) return []
    const db = requireDb()
    return db.transaction(async (tx) => {
      const validationContext = await loadServerWeldValidationContext(tx)
      prepareServerWeldRecords({
        records: data.records,
        previousRows: new Map(),
        context: validationContext,
      })
      validateServerWeldRecords({
        records: data.records,
        previousRows: new Map(),
        context: validationContext,
        allowSystemJointNames: true,
      })
      const created = await insertWeldJointsInBatches(tx, data.records)
      await syncSystemDocumentsForWeldChangesInTransaction(tx, created, new Map())
      await markDispatcherTaskIndexDirty(tx, { scopes: getDispatcherDirtyScopes(data.records, new Map()) })
      return created
    })
  })

export async function updateWeldJointRows(data: WeldBatchUpdateData, importMode = false) {
    if (data.records.length === 0) return []
    if (data.records.some((record) => !record.id)) throw new Error('Не передан id одной из записей')
    assertUniqueWeldMutationTargets(data.records)
    const db = requireDb()
    return db.transaction(async (tx) => {
      await loadControlProcessSettingsFromTransaction(tx)
      let records = data.records
      const previousRows = await loadPreviousWeldRows(tx, records)
      const systemDocumentSequences = [
        ...(data.systemDocumentSequence ? [data.systemDocumentSequence] : []),
        ...(data.systemDocumentSequences ?? []),
      ]
      const systemDocumentReservations = []
      for (const systemDocumentSequence of systemDocumentSequences) {
        const targetRecords = data.records.filter((record) =>
          systemDocumentSequence.fieldKeys.some(
            (fieldKey) =>
              String(record[fieldKey] ?? '').trim() ===
              String(systemDocumentSequence.provisionalName ?? '').trim(),
          ),
        )
        if (targetRecords.length === 0) {
          throw new Error('Не найдены строки с предварительным именем системного документа.')
        }
        const reserved = await reserveSystemDocumentName(tx, systemDocumentSequence, targetRecords)
        systemDocumentReservations.push(reserved)
      }
      records = applyReservedSystemDocumentNames(data.records, systemDocumentReservations)
      const validationContext = await loadServerWeldValidationContext(tx)
      if (importMode) {
        assertExistingRowsImportPayload({
          records,
          previousRows,
          mode: 'massFill',
          otherSettings: validationContext.otherSettings,
        })
      }
      const mutationScope = data.mutationScope ?? 'welding'
      records = mergeWeldRecordsWithPrevious(
        records.map((record) => restrictWeldMutationRecord(record, mutationScope)),
        previousRows,
      )
      const inheritedPreHeatTreatmentExemptions = await getPreHeatTreatmentLnkExemptionsForNewRows(
        tx,
        records,
      )
      records.forEach((record, index) => {
        const previous = record.id ? previousRows.get(Number(record.id)) : undefined
        if (
          previous?.preHeatTreatmentLnkExempt === true ||
          inheritedPreHeatTreatmentExemptions[index] === true
        ) {
          const weldRecord = record as WeldRow
          weldRecord.preHeatTreatmentLnkExempt = true
        }
      })
      if (data.requireFullyAssignedPstoLines) {
        await assertPstoWorkflowLinesFullyAssigned(tx, records)
      }
      await assertJointChainIdentityChangesUseDedicatedMove(
        tx,
        records,
        previousRows,
        validationContext.systemIndexSettings,
      )
      await assertEarlyCoilDecisionSourcesRemainValid(tx, records, previousRows)
      prepareServerWeldRecords({
        records,
        previousRows,
        context: validationContext,
        importMode,
      })
      validateServerWeldRecords({
        records,
        previousRows,
        context: validationContext,
        importMode,
      })
      const updated = await updateWeldJointsInBatches(tx, records, previousRows)
      await syncSystemDocumentsForWeldChangesInTransaction(tx, updated, previousRows)
      await markDispatcherTaskIndexDirty(tx, { scopes: getDispatcherDirtyScopes(records, previousRows) })
      return updated
    })
}

export const updateWeldJoints = createServerFn({ method: 'POST' })
  .validator((data: WeldBatchUpdateData) => data)
  .handler(async ({ data }) => {
    await assertSecurityScope('edit')
    return updateWeldJointRows(data)
  })

export const extendLnkRequest = createServerFn({ method: 'POST' })
  .validator((data: LnkRequestExtensionRequest) => normalizeLnkRequestExtensionRequest(data))
  .handler(async ({ data }) => {
    await assertSecurityScope('edit')
    const db = requireDb()

    return db.transaction(async (tx) => {
      const targetIds = [...new Set(data.targets.map((target) => target.rowId))]
      const lockedRows = await tx
        .select()
        .from(weldJoints)
        .where(or(
          inArray(weldJoints.id, targetIds),
          buildLnkRequestIdentityWhere(data.requestName, data.requestDate),
        ))
        .for('update')

      const requestDisabledReason = getLnkRequestExtensionDisabledReason(lockedRows, {
        name: data.requestName,
        date: data.requestDate,
      })
      if (requestDisabledReason) throw new Error(requestDisabledReason)

      const targetIdSet = new Set(targetIds)
      const targetRows = lockedRows.filter((row) => targetIdSet.has(row.id))
      if (targetRows.length !== targetIds.length) {
        throw new Error('Один или несколько выбранных стыков больше не существуют. Обновите отчет ЛНК.')
      }

      let records = buildLnkRequestExtensionRows({
        rows: targetRows,
        targets: data.targets,
        requestName: data.requestName,
        requestDate: data.requestDate,
      })
      const previousRows = new Map(targetRows.map((row) => [row.id, row]))
      const validationContext = await loadServerWeldValidationContext(tx)
      records = mergeWeldRecordsWithPrevious(records, previousRows)
      prepareServerWeldRecords({ records, previousRows, context: validationContext })
      validateServerWeldRecords({ records, previousRows, context: validationContext })

      const updated = await updateWeldJointsInBatches(tx, records, previousRows)
      await syncSystemDocumentsForWeldChangesInTransaction(tx, updated, previousRows)
      await markDispatcherTaskIndexDirty(tx, {
        scopes: getDispatcherDirtyScopes(records, previousRows),
      })
      return updated
    })
  })

export const clearLnkRequestPosition = createServerFn({ method: 'POST' })
  .validator((data: {
    rowId: number
    methodKey: WeldFieldKey
    requestName: string
    requestDate: string
  }) => ({
    rowId: Number(data?.rowId),
    methodKey: String(data?.methodKey ?? '') as WeldFieldKey,
    requestName: String(data?.requestName ?? '').trim(),
    requestDate: normalizeDateLikeForStorage(data?.requestDate) ?? String(data?.requestDate ?? '').trim(),
  }))
  .handler(async ({ data }) => {
    await assertSecurityScope('edit')
    if (!Number.isInteger(data.rowId) || data.rowId <= 0 || !data.requestName) {
      throw new Error('Некорректная позиция заявки ЛНК.')
    }
    const method = getLnkMethodByRequestKey(data.methodKey)
    if (!method) throw new Error('Выберите вид контроля')

    const db = requireDb()
    return db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(weldJoints)
        .where(eq(weldJoints.id, data.rowId))
        .limit(1)
        .for('update')
      if (!row) throw new Error('Стык больше не существует. Обновите отчет ЛНК.')
      if (!isSameRequestDocument(row[method.requestKey], row[method.requestDateKey], {
        name: data.requestName,
        date: data.requestDate,
      })) {
        throw new Error('Позиция заявки уже изменилась. Обновите отчет ЛНК и повторите действие.')
      }

      const record = buildLnkRequestPositionRemovalRow(row as WeldRow, method.requestKey)
      const previousRows = new Map([[row.id, row]])
      const validationContext = await loadServerWeldValidationContext(tx)
      prepareServerWeldRecords({ records: [record], previousRows, context: validationContext })
      validateServerWeldRecords({ records: [record], previousRows, context: validationContext })
      const [updated] = await updateWeldJointsInBatches(tx, [record], previousRows)
      await syncSystemDocumentsForWeldChangesInTransaction(tx, [updated], previousRows)
      await markDispatcherTaskIndexDirty(tx, {
        scopes: getDispatcherDirtyScopes([record], previousRows),
      })
      return updated
    })
  })

export const deleteLnkRequestDocument = createServerFn({ method: 'POST' })
  .validator((data: { requestName: string; requestDate: string }) => ({
    requestName: String(data?.requestName ?? '').trim(),
    requestDate: normalizeDateLikeForStorage(data?.requestDate) ?? String(data?.requestDate ?? '').trim(),
  }))
  .handler(async ({ data }) => {
    await assertSecurityScope('edit')
    if (!data.requestName) throw new Error('Выберите заявку ЛНК')
    const db = requireDb()

    return db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(weldJoints)
        .where(buildLnkRequestIdentityWhere(data.requestName, data.requestDate))
        .for('update')
      if (rows.length === 0) throw new Error('Заявка ЛНК не найдена')

      const records = buildLnkRequestManagerRows({
        records: rows as WeldRow[],
        requestName: data.requestName,
        requestDate: data.requestDate,
        nextRequestName: '',
        action: 'delete',
      })
      const previousRows = new Map(rows.map((row) => [row.id, row]))
      const validationContext = await loadServerWeldValidationContext(tx)
      prepareServerWeldRecords({ records, previousRows, context: validationContext })
      validateServerWeldRecords({ records, previousRows, context: validationContext })
      const updated = await updateWeldJointsInBatches(tx, records, previousRows)
      await syncSystemDocumentsForWeldChangesInTransaction(tx, updated, previousRows)
      await markDispatcherTaskIndexDirty(tx, {
        scopes: getDispatcherDirtyScopes(records, previousRows),
      })
      return updated
    })
  })

export function buildLnkRequestIdentityWhere(requestName: string, requestDate: string) {
  return or(
    ...LNK_METHODS.map((method) => and(
      sql`trim(coalesce(${weldJoints[method.requestKey]}, '')) = ${requestName}`,
      requestDate
        ? eq(weldJoints[method.requestDateKey], requestDate)
        : isNull(weldJoints[method.requestDateKey]),
    )),
  ) ?? sql`false`
}

export const deleteWeldJoint = createServerFn({ method: 'POST' })
  .validator((data: { id: number }) => data)
  .handler(async ({ data }) => {
    await assertSecurityScope('delete')
    const db = requireDb()

    await db.transaction(async (tx) => {
      const [previousRow] = await tx.select().from(weldJoints).where(eq(weldJoints.id, data.id)).limit(1)
      await assertEarlyCoilDecisionRowsCanBeDeleted(tx, previousRow ? [previousRow] : [])
      await removeHeatTreatmentSourcedDocumentPositionsForWeldsInTransaction({
        tx,
        weldJointIds: [data.id],
      })
      await tx.delete(weldJoints).where(eq(weldJoints.id, data.id))
      if (previousRow) {
        await syncSystemDocumentsForWeldChangesInTransaction(
          tx,
          [],
          new Map([[previousRow.id, previousRow]]),
        )
      }
      await tx
        .delete(generatedDocuments)
        .where(
          notExists(
            tx
              .select({ value: sql`1` })
              .from(generatedDocumentWeldJoints)
              .where(eq(generatedDocumentWeldJoints.documentId, generatedDocuments.id)),
          ),
        )
      await markDispatcherTaskIndexDirty(tx, {
        scopes: previousRow ? getDispatcherDirtyScopes([], new Map([[previousRow.id, previousRow]])) : [],
      })
    })
    return { ok: true }
  })

export const deleteWeldJoints = createServerFn({ method: 'POST' })
  .validator((data: { ids: number[] }) => ({
    ids: [...new Set((data?.ids ?? []).map(Number).filter((id) => Number.isInteger(id) && id > 0))],
  }))
  .handler(async ({ data }) => {
    await assertSecurityScope('delete')
    if (data.ids.length === 0) return { deleted: 0 }
    const db = requireDb()
    return db.transaction(async (tx) => {
      const previousRows = []
      for (const ids of splitNumberBatches(data.ids, 1000)) {
        previousRows.push(...await tx.select().from(weldJoints).where(inArray(weldJoints.id, ids)))
      }
      if (previousRows.length !== data.ids.length) {
        const foundIds = new Set(previousRows.map((row) => row.id))
        const missingIds = data.ids.filter((id) => !foundIds.has(id))
        throw new Error(`Не найдены стыки: ${missingIds.join(', ')}`)
      }

      await assertEarlyCoilDecisionRowsCanBeDeleted(tx, previousRows)

      await removeHeatTreatmentSourcedDocumentPositionsForWeldsInTransaction({
        tx,
        weldJointIds: data.ids,
      })
      for (const ids of splitNumberBatches(data.ids, 1000)) {
        await tx.delete(weldJoints).where(inArray(weldJoints.id, ids))
      }
      const previousRowsById = new Map(previousRows.map((row) => [row.id, row]))
      await syncSystemDocumentsForWeldChangesInTransaction(tx, [], previousRowsById)
      await deleteEmptyGeneratedDocuments(tx)
      await markDispatcherTaskIndexDirty(tx, {
        scopes: getDispatcherDirtyScopes([], previousRowsById),
      })
      return { deleted: previousRows.length }
    })
  })

export async function deleteEmptyGeneratedDocuments(tx: Parameters<Parameters<ReturnType<typeof requireDb>['transaction']>[0]>[0]) {
  await tx
    .delete(generatedDocuments)
    .where(
      notExists(
        tx
          .select({ value: sql`1` })
          .from(generatedDocumentWeldJoints)
          .where(eq(generatedDocumentWeldJoints.documentId, generatedDocuments.id)),
      ),
    )
}

export async function insertWeldJointsInBatches(
  tx: SystemDocumentSequenceTransaction,
  records: readonly WeldInput[],
) {
  const inserted: WeldJoint[] = []
  const preHeatTreatmentLnkExemptions = await getPreHeatTreatmentLnkExemptionsForNewRows(tx, records)
  let offset = 0
  for (const batch of splitWeldImportInsertBatches(records)) {
    const rows = await tx
      .insert(weldJoints)
      .values(batch.map((record, index) => ({
        ...toDbInsert(record, true),
        preHeatTreatmentLnkExempt: preHeatTreatmentLnkExemptions[offset + index] ?? false,
      })))
      .returning()
    inserted.push(...rows)
    offset += batch.length
  }
  return inserted
}

export function getDispatcherDirtyScopes(
  records: WeldInput[],
  previousRows: ReadonlyMap<number, WeldJoint>,
) {
  const scopes = new Map<string, DispatcherDirtyScope>()
  const addScope = (record: Partial<Pick<WeldInput, 'projectTitle' | 'subtitleCode' | 'line'>>) => {
    const scope = {
      projectTitle: String(record.projectTitle ?? '').trim(),
      subtitleCode: String(record.subtitleCode ?? '').trim(),
      line: String(record.line ?? '').trim(),
    }
    scopes.set(JSON.stringify(scope), scope)
  }
  records.forEach(addScope)
  previousRows.forEach((record) => addScope(record))
  return [...scopes.values()]
}

export type { WeldMutationScope } from '@/server/weld-contracts'
