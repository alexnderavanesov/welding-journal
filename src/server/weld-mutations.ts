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
import { buildPstoRequestManagerRows } from '@/lib/psto-report-mutation-updates'
import {
buildClearedPrimaryLnkStageRows,
buildPrimaryToPreHeatTreatmentTransfer,
findBlockingLnkStageTransferChronologyIssue,
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
normalizePstoLineIdentityPart,
requiresPrimaryStageResolutionForAssignedPstoLine,
type PstoWeldLineMoveDisposition,
} from '@/lib/psto-line-assignment'
import { getCoilJointNames, normalizeJointChainPart, parseJointChainName, parseRepeatedJointName } from '@/lib/joint-chain'
import { getCoilTransitionModeForSource } from '@/lib/joint-chain-transitions'
import { getDuplicateJointKey, getJointChainRows } from '@/lib/repeated-joint-row-utils'
import { buildRepeatedJointDraft } from '@/lib/repeated-joint-draft'
import { buildRepeatedJointTasks } from '@/lib/repeated-joint-tasks'
import { hasCompletedParentBranch } from '@/lib/repeated-joint-consistency-tasks'
import {
getExpectedRepeatedJointName,
getOfficialRejectedJointChainRows,
getPrimaryRejectedLnkResult,
hasRepeatedJointTarget,
} from '@/lib/repeated-joint-task-helpers'
import {
isAuthorizedSystemRepeatedJointRename,
type SystemRepeatedJointRenameRequest,
} from '@/lib/repeated-joint-system-rename'
import {
LNK_METHODS
} from '@/lib/report-config'
import { isSameRequestDocument } from '@/lib/request-document-identity'
import { isSystemDocumentNameForRows } from '@/lib/system-document-types'
import { getSystemDocumentTemplateId } from '@/lib/system-document-template-types'
import {
type WeldFieldKey,
type WeldInput
} from '@/lib/weld-fields'
import {
assertUniqueWeldMutationTargets,
splitWeldImportInsertBatches
} from '@/lib/weld-import-limits'
import { calculateFinalStatus } from '@/lib/weld-status'
import type { SystemIndexSettings } from '@/lib/system-index-settings'
import { isLnkRepairForbiddenWithSettings } from '@/lib/lnk-result-rules'
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
getDispatcherDirtyScopes,
markDispatcherTaskIndexDirty,
} from '@/server/dispatcher-task-index-dirty'
export { getDispatcherDirtyScopes } from '@/server/dispatcher-task-index-dirty'
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
reserveSystemDocumentNames,
type SystemDocumentSequenceTransaction,
} from '@/server/system-document-sequences'
import {
type WeldBatchUpdateData,
type WeldDeleteData,
type WeldDeleteManyData,
type WeldMutationScope,
type WeldPayload,
type RequestDocumentManagerData,
type RepeatedJointCreateData,
} from '@/server/weld-contracts'
import {
hasPstoLifecycleHistory,
loadPreviousWeldRows,
loadServerWeldValidationContext,
mergeWeldRecordsWithPrevious,
prepareServerWeldRecords,
validateServerWeldRecords,
} from '@/server/weld-save-validation'
import { and,asc,eq,inArray,isNull,notExists,or,sql } from 'drizzle-orm'

import {
getProfileTimestampUpdates,
toDbInsert,
updateWeldJointsInBatches,
WELD_TABLE_RETURNING,
} from '@/server/weld-persistence'
import {
assertExpectedInteractiveWeldVersions,
lockInteractiveWeldRows,
} from '@/server/weld-row-version'
import {
getChangedWeldLineMemberships,
haveSameWeldLineMemberships,
lockWeldLineMemberships,
} from '@/server/weld-line-membership-lock'
import { restrictWeldMutationRecord } from '@/server/weld-mutation-policy'
import { splitNumberBatches } from '@/server/weld-request-utils'
import {
assertEarlyCoilDecisionRowsCanBeDeleted,
assertEarlyCoilDecisionSourcesRemainValid,
hasActiveEarlyCoilDecisionForSource,
refreshEarlyCoilDecisionContextsInTransaction,
} from '@/server/early-coil-decision-guard'
import { readRequestConclusionSettings } from '@/server/system-document-sequences'

export { restrictWeldMutationRecord } from '@/server/weld-mutation-policy'

type RequestDocumentLockIdentity = {
  kind: 'lnk' | 'psto'
  name: unknown
  date: unknown
}

export function getRequestDocumentAdvisoryLockKeys(
  records: readonly WeldInput[],
  mutationScope: WeldMutationScope,
) {
  const identities: RequestDocumentLockIdentity[] = []
  if (mutationScope === 'lnk') {
    for (const record of records) {
      for (const method of LNK_METHODS) {
        identities.push({
          kind: 'lnk',
          name: record[method.requestKey],
          date: record[method.requestDateKey],
        })
      }
    }
  } else if (mutationScope === 'psto') {
    for (const record of records) {
      identities.push({ kind: 'psto', name: record.pstoRequest, date: record.pstoRequestDate })
    }
  }
  return getRequestDocumentIdentityLockKeys(identities)
}

export function getRequestDocumentIdentityLockKeys(
  identities: readonly RequestDocumentLockIdentity[],
) {
  return [...new Set(identities.flatMap(({ kind, name, date }) => {
    const normalizedName = String(name ?? '').trim()
    if (!normalizedName) return []
    const normalizedDate = normalizeDateLikeForStorage(date) ?? String(date ?? '').trim()
    return [`request-document:${kind}:${JSON.stringify([normalizedName, normalizedDate])}`]
  }))].sort()
}

async function lockRequestDocumentIdentities(
  tx: SystemDocumentSequenceTransaction,
  identities: readonly RequestDocumentLockIdentity[],
) {
  await lockRequestDocumentAdvisoryKeys(tx, getRequestDocumentIdentityLockKeys(identities))
}

async function lockSubmittedRequestDocuments(
  tx: SystemDocumentSequenceTransaction,
  records: readonly WeldInput[],
  mutationScope: WeldMutationScope,
) {
  await lockRequestDocumentAdvisoryKeys(tx, getRequestDocumentAdvisoryLockKeys(records, mutationScope))
}

export async function lockRequestDocumentAdvisoryKeys(
  tx: Pick<SystemDocumentSequenceTransaction, 'execute'>,
  rawKeys: readonly string[],
) {
  const keys = [...new Set(rawKeys.map((key) => String(key).trim()).filter(Boolean))].sort()
  if (keys.length === 0) return
  for (let offset = 0; offset < keys.length; offset += 1_000) {
    const keyBatch = keys.slice(offset, offset + 1_000)
    const values = sql.join(keyBatch.map((key, index) => sql`(${index}, ${key})`), sql`, `)
    await tx.execute(sql`
      with "request_document_lock_keys"("lock_order", "lock_key") as materialized (
        values ${values}
      ),
      "ordered_request_document_lock_keys" as materialized (
        select "lock_order", "lock_key"
        from "request_document_lock_keys"
        order by "lock_order"
      )
      select pg_advisory_xact_lock(hashtext("lock_key"))
      from "ordered_request_document_lock_keys"
      order by "lock_order"
    `)
  }
}

export async function createWeldJoint({ data }: { data: WeldPayload }) {
  await assertSecurityScope('edit')
  const db = requireDb()
  return db.transaction(async (tx) => {
    const record = restrictWeldMutationRecord(data, 'welding')
    const processSettings = await loadControlProcessSettingsFromTransaction(tx)
    await lockWeldLineMemberships(tx, [record])
    const validationContext = await loadServerWeldValidationContext(tx, [record])
    prepareServerWeldRecords({ records: [record], previousRows: new Map(), context: validationContext })
    validateServerWeldRecords({
      records: [record],
      previousRows: new Map(),
      context: validationContext,
    })
    const preHeatTreatmentLnkExempt = await getPreHeatTreatmentLnkExemptionForNewRow(
      tx,
      record,
      processSettings,
    )
    const [created] = await tx
      .insert(weldJoints)
      .values({ ...toDbInsert(record, true), preHeatTreatmentLnkExempt })
      .returning(WELD_TABLE_RETURNING)
    await syncSystemDocumentsForWeldChangesInTransaction(tx, [created], new Map())
    await markDispatcherTaskIndexDirty(tx, { scopes: getDispatcherDirtyScopes([record], new Map()) })
    return created
  })
}

export async function updateWeldJoint({ data }: { data: WeldPayload }) {
  return updateWeldJointRecord(data, false)
}

export async function updateSystemWeldJoint({
  data: input,
}: {
  data: SystemRepeatedJointRenameRequest
}) {
  const data = {
    changes: Array.isArray(input.changes)
      ? input.changes.map((change) => ({
          rowId: Number(change?.rowId),
          currentJoint: String(change?.currentJoint ?? '').trim(),
          targetJoint: String(change?.targetJoint ?? '').trim(),
        }))
      : [],
  }
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
    await loadControlProcessSettingsFromTransaction(tx)
    const firstChange = data.changes[0]!
    const [anchor] = await tx.select().from(weldJoints).where(eq(weldJoints.id, firstChange.rowId)).limit(1)
    if (!anchor) throw new Error('Стык для переименования не найден.')
    const anchorIdentity = normalizePstoLineIdentity(anchor)
    await lockWeldLineMemberships(tx, [anchorIdentity])

    const storedRows = await tx
      .select()
      .from(weldJoints)
      .where(buildWeldLineIdentityWhere(anchorIdentity))
      .orderBy(asc(weldJoints.id))
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

    const validationContext = await loadServerWeldValidationContext(tx, rows)
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
}

export async function updateWeldJointRecord(data: WeldPayload, allowSystemJointNames: boolean) {
  await assertSecurityScope('edit')
  if (!data.id) throw new Error('Не передан id записи')
  const id = data.id
  const db = requireDb()

  return db.transaction(async (tx) => {
    const mutationScope = data.mutationScope ?? 'welding'
    const scopedData = restrictWeldMutationRecord(data, mutationScope)
    const [identitySnapshot] = await tx
      .select({
        id: weldJoints.id,
        projectTitle: weldJoints.projectTitle,
        subtitleCode: weldJoints.subtitleCode,
        line: weldJoints.line,
      })
      .from(weldJoints)
      .where(eq(weldJoints.id, id))
      .limit(1)
    if (!identitySnapshot) throw new Error(`Запись ${id} не найдена`)
    const identityDraft = { ...identitySnapshot, ...scopedData }
    await lockSubmittedRequestDocuments(tx, [scopedData], mutationScope)
    const processSettings = await loadControlProcessSettingsFromTransaction(tx)
    await lockWeldLineMemberships(
      tx,
      getChangedWeldLineMemberships(identitySnapshot, identityDraft),
    )
    const previousRows = await loadPreviousWeldRows(tx, [scopedData])
    if (!previousRows.has(id)) throw new Error(`Запись ${id} не найдена`)
    assertExpectedInteractiveWeldVersions(
      [id],
      [{ id, version: String(data.expectedVersion ?? '').trim() }],
      [...previousRows.values()],
    )
    const [mergedRecord] = mergeWeldRecordsWithPrevious([scopedData], previousRows)
    let record = mergedRecord as WeldRow
    const validationContext = await loadServerWeldValidationContext(tx, [
      ...previousRows.values(),
      record,
    ])
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
      .returning(WELD_TABLE_RETURNING)
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
    const exemptionCandidates = records.filter((record) => {
      const previous = previousRows.get(Number(record.id))
      if (!previous || previous.preHeatTreatmentLnkExempt === true) return false
      return getPstoLineIdentityKey(previous) !== getPstoLineIdentityKey(record)
    })
    const exemptions = exemptionCandidates.length > 0
      ? await getPreHeatTreatmentLnkExemptionsForNewRows(tx, exemptionCandidates, processSettings)
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

function assertChainLineMoveLnkStageTransfersAllowed(
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
      await getPreHeatTreatmentLnkExemptionForNewRow(tx, record, processSettings)
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
    for (const idBatch of splitNumberBatches(preHeatTreatmentWeldJointIds, 1000)) {
      await tx
        .delete(preHeatTreatmentControls)
        .where(inArray(preHeatTreatmentControls.weldJointId, idBatch))
    }
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
    sql`lower(btrim(coalesce(${weldJoints.projectTitle}, ''))) = ${normalizePstoLineIdentityPart(identity.projectTitle)}`,
    sql`lower(btrim(coalesce(${weldJoints.subtitleCode}, ''))) = ${normalizePstoLineIdentityPart(identity.subtitleCode)}`,
    sql`lower(btrim(coalesce(${weldJoints.line}, ''))) = ${normalizePstoLineIdentityPart(identity.line)}`,
  )
}

export async function createWeldJoints({
  data: input,
}: {
  data: RepeatedJointCreateData
}) {
  const data = {
    source: {
      id: Number(input?.source?.id),
      version: String(input?.source?.version ?? '').trim(),
    },
    targetJoints: [...new Set((Array.isArray(input?.targetJoints) ? input.targetJoints : [])
      .map((joint) => String(joint ?? '').trim())
      .filter(Boolean))],
  }
  await assertSecurityScope('edit')
  if (!Number.isInteger(data.source.id) || data.source.id <= 0) {
    throw new Error('Не передан исходный стык для продолжения цепочки.')
  }
  if (data.targetJoints.length === 0 || data.targetJoints.length > 2) {
    throw new Error('Некорректный состав продолжения цепочки стыка.')
  }
  const db = requireDb()
  return db.transaction(async (tx) => {
    const processSettings = await loadControlProcessSettingsFromTransaction(tx)
    const [sourceReference] = await tx
      .select(WELD_TABLE_RETURNING)
      .from(weldJoints)
      .where(eq(weldJoints.id, data.source.id))
      .limit(1)
    if (!sourceReference) throw new Error('Исходный стык больше не существует. Обновите диспетчер задач.')
    const sourceIdentity = normalizePstoLineIdentity(sourceReference)
    await lockWeldLineMemberships(tx, [sourceIdentity])
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`repeated-joint-source:${data.source.id}`}))`)
    const scopeRows = await tx
      .select(WELD_TABLE_RETURNING)
      .from(weldJoints)
      .where(buildWeldLineIdentityWhere(sourceIdentity))
      .orderBy(asc(weldJoints.id))
      .for('update')
    const sourceRow = scopeRows.find((row) => row.id === data.source.id)
    if (!sourceRow) {
      throw new Error('Исходный стык уже перенесен на другую линию. Обновите диспетчер задач.')
    }
    assertExpectedInteractiveWeldVersions(
      [sourceRow.id],
      [data.source],
      [sourceRow],
    )
    const hydratedScopeRows = await attachDuplicateControlRelations(
      await attachHeatTreatmentControlRelations(scopeRows as WeldRow[], tx),
      tx,
    )
    const hydratedSource = hydratedScopeRows.find((row) => row.id === sourceRow.id)
    if (!hydratedSource) throw new Error('Не удалось проверить исходный стык. Обновите диспетчер задач.')
    const validationContext = await loadServerWeldValidationContext(tx, scopeRows)
    const hasEarlyCoilDecision = await hasActiveEarlyCoilDecisionForSource(tx, sourceRow.id)
    const expectedTargets = getCurrentRepeatedJointTargets(
      hydratedScopeRows,
      hydratedSource,
      validationContext.systemIndexSettings,
      hasEarlyCoilDecision,
    )
    if (!sameNormalizedTextSet(data.targetJoints, expectedTargets)) {
      throw new Error(
        'Продолжение цепочки уже изменилось или больше не требуется. Обновите диспетчер задач.',
      )
    }
    const currentCreationTask = buildRepeatedJointTasks(
      hydratedScopeRows,
      validationContext.welderStamps,
      validationContext.welderStampSuspensions,
      {
        dataListSettings: validationContext.dataListSettings,
        earlyCoilDecisionSourceRowIds: hasEarlyCoilDecision
          ? new Set([sourceRow.id])
          : new Set(),
        systemIndexSettings: validationContext.systemIndexSettings,
      },
    ).find((task) => {
      if (task.row.id !== sourceRow.id || (task.kind !== 'create' && task.kind !== 'coil')) return false
      const taskTargets = task.kind === 'coil' ? task.targetJoints : [task.targetJoint]
      return sameNormalizedTextSet(data.targetJoints, taskTargets)
    })
    if (!currentCreationTask) {
      throw new Error(
        'Создание продолжения сейчас заблокировано проверкой цепочки. Обновите диспетчер задач и исправьте указанное несоответствие.',
      )
    }
    const records = data.targetJoints.map((targetJoint) =>
      buildRepeatedJointDraft(hydratedSource, targetJoint),
    )
    const targetKeys = new Set(records.map(getDuplicateJointKey).filter((key): key is string => Boolean(key)))
    const duplicate = scopeRows.find((row) => {
      const key = getDuplicateJointKey(row)
      return Boolean(key) && targetKeys.has(key!)
    })
    if (duplicate) {
      throw new Error(
        `Стык ${String(duplicate.joint ?? '').trim() || duplicate.id} уже создан. Обновите диспетчер задач.`,
      )
    }
    prepareServerWeldRecords({
      records,
      previousRows: new Map(),
      context: validationContext,
    })
    validateServerWeldRecords({
      records,
      previousRows: new Map(),
      context: validationContext,
      allowSystemJointNames: true,
    })
    const created = await insertWeldJointsInBatches(tx, records, processSettings)
    await syncSystemDocumentsForWeldChangesInTransaction(tx, created, new Map())
    await markDispatcherTaskIndexDirty(tx, { scopes: getDispatcherDirtyScopes(records, new Map()) })
    return created
  })
}

export function getCurrentRepeatedJointTargets(
  rows: WeldRow[],
  sourceRow: WeldRow,
  settings: SystemIndexSettings,
  hasEarlyCoilDecision = false,
) {
  const rejection = getPrimaryRejectedLnkResult(sourceRow)
  const sourceJoint = String(sourceRow.joint ?? '').trim()
  if (!rejection || !sourceJoint || hasCompletedParentBranch(rows, sourceRow, sourceJoint, settings)) return []
  if (rejection.result === 'ремонт' && isLnkRepairForbiddenWithSettings(sourceRow, settings)) return []

  const officialRejectedRows = getOfficialRejectedJointChainRows(rows, sourceRow, sourceJoint, settings)
  const coilTransitionMode = getCoilTransitionModeForSource({
    earlyCoilDecisionSourceRowIds: hasEarlyCoilDecision ? new Set([sourceRow.id]) : undefined,
    officialRejectedRows,
    sourceRow,
    systemIndexSettings: settings,
  })
  const targets = coilTransitionMode
    ? getCoilJointNames(parseRepeatedJointName(sourceJoint, settings).base, settings)
    : [getExpectedRepeatedJointName(sourceRow, sourceJoint, rejection.result, settings)]
  return targets.filter((targetJoint) => !hasRepeatedJointTarget(rows, sourceRow, targetJoint))
}

export function sameNormalizedTextSet(left: readonly string[], right: readonly string[]) {
  const normalizedLeft = left.map(normalizeJointChainPart)
  const normalizedRight = right.map(normalizeJointChainPart)
  if (
    normalizedLeft.length !== normalizedRight.length ||
    new Set(normalizedLeft).size !== normalizedLeft.length ||
    new Set(normalizedRight).size !== normalizedRight.length
  ) return false
  return JSON.stringify(normalizedLeft.sort()) === JSON.stringify(normalizedRight.sort())
}

export async function updateWeldJointRows(data: WeldBatchUpdateData, importMode = false) {
    if (data.records.length === 0) return []
    if (data.records.some((record) => !record.id)) throw new Error('Не передан id одной из записей')
    assertUniqueWeldMutationTargets(data.records)
    const db = requireDb()
    return db.transaction(async (tx) => {
      const mutationScope = data.mutationScope ?? 'welding'
      await lockSubmittedRequestDocuments(tx, data.records, mutationScope)
      const processSettings = await loadControlProcessSettingsFromTransaction(tx)
      let records = data.records
      const systemDocumentSequences = [
        ...(data.systemDocumentSequence ? [data.systemDocumentSequence] : []),
        ...(data.systemDocumentSequences ?? []),
      ].sort((left, right) => (
        getSystemDocumentTemplateId(left).localeCompare(getSystemDocumentTemplateId(right))
      ))
      const systemDocumentReservationInputs = systemDocumentSequences.map((systemDocumentSequence) => {
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
        return { request: systemDocumentSequence, rows: targetRecords }
      })
      const systemDocumentReservations = await reserveSystemDocumentNames(
        tx,
        systemDocumentReservationInputs,
      )
      records = applyReservedSystemDocumentNames(data.records, systemDocumentReservations)
      const identityRows = await loadWeldLineIdentityRows(
        tx,
        records.map((record) => Number(record.id)),
      )
      const identityRowsById = new Map(identityRows.map((row) => [row.id, row]))
      const identityDrafts = records.map((record) => ({
        ...identityRowsById.get(Number(record.id)),
        ...restrictWeldMutationRecord(record, mutationScope),
      }))
      const changedLineMemberships = identityDrafts.flatMap((record) => {
        const previous = identityRowsById.get(Number(record.id))
        return previous ? getChangedWeldLineMemberships(previous, record) : []
      })
      await lockWeldLineMemberships(tx, data.requireFullyAssignedPstoLines
        ? [...changedLineMemberships, ...identityRows, ...identityDrafts]
        : changedLineMemberships)
      const previousRows = await loadPreviousWeldRows(tx, records)
      if (!haveSameWeldLineMemberships(identityRows, [...previousRows.values()])) {
        throw new Error(
          'Один или несколько стыков были перенесены на другую линию другим пользователем. Ничего не сохранено. Обновите отчет и повторите действие.',
        )
      }
      assertExpectedInteractiveWeldVersions(
        records.map((record) => Number(record.id)),
        data.expectedVersions,
        [...previousRows.values()],
      )
      const validationContext = await loadServerWeldValidationContext(tx, [
        ...previousRows.values(),
        ...identityDrafts,
      ])
      if (importMode) {
        assertExistingRowsImportPayload({
          records,
          previousRows,
          mode: 'massFill',
          otherSettings: validationContext.otherSettings,
        })
      }
      records = mergeWeldRecordsWithPrevious(
        records.map((record) => restrictWeldMutationRecord(record, mutationScope)),
        previousRows,
      )
      const inheritedPreHeatTreatmentExemptions = await getPreHeatTreatmentLnkExemptionsForNewRows(
        tx,
        records,
        processSettings,
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

export async function updateWeldJoints({ data }: { data: WeldBatchUpdateData }) {
  await assertSecurityScope('edit')
  return updateWeldJointRows(data)
}

export async function extendLnkRequest({
  data: input,
}: {
  data: LnkRequestExtensionRequest
}) {
  const data = normalizeLnkRequestExtensionRequest(input)
  await assertSecurityScope('edit')
  const db = requireDb()

  return db.transaction(async (tx) => {
    await lockRequestDocumentIdentities(tx, [{
      kind: 'lnk',
      name: data.requestName,
      date: data.requestDate,
    }])
    const processSettings = await loadControlProcessSettingsFromTransaction(tx)
    const targetIds = [...new Set(data.targets.map((target) => target.rowId))]
    const lockedRows = await tx
      .select()
      .from(weldJoints)
      .where(or(
        inArray(weldJoints.id, targetIds),
        buildLnkRequestIdentityWhere(data.requestName, data.requestDate),
      ))
      .orderBy(asc(weldJoints.id))
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
      controlProcessSettings: processSettings,
    })
    const previousRows = new Map(targetRows.map((row) => [row.id, row]))
    const validationContext = await loadServerWeldValidationContext(tx, lockedRows)
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
}

export async function clearLnkRequestPosition({
  data: input,
}: {
  data: {
    rowId: number
    expectedVersion: string
    methodKey: WeldFieldKey
    requestName: string
    requestDate: string
  }
}) {
  const data = {
    rowId: Number(input?.rowId),
    expectedVersion: String(input?.expectedVersion ?? '').trim(),
    methodKey: String(input?.methodKey ?? '') as WeldFieldKey,
    requestName: String(input?.requestName ?? '').trim(),
    requestDate: normalizeDateLikeForStorage(input?.requestDate) ?? String(input?.requestDate ?? '').trim(),
  }
  await assertSecurityScope('edit')
  if (!Number.isInteger(data.rowId) || data.rowId <= 0 || !data.requestName) {
    throw new Error('Некорректная позиция заявки ЛНК.')
  }
  const method = getLnkMethodByRequestKey(data.methodKey)
  if (!method) throw new Error('Выберите вид контроля')

  const db = requireDb()
  return db.transaction(async (tx) => {
    await lockRequestDocumentIdentities(tx, [{
      kind: 'lnk',
      name: data.requestName,
      date: data.requestDate,
    }])
    await loadControlProcessSettingsFromTransaction(tx)
    const [row] = await tx
      .select(WELD_TABLE_RETURNING)
      .from(weldJoints)
      .where(eq(weldJoints.id, data.rowId))
      .limit(1)
      .for('update')
    if (!row) throw new Error('Стык больше не существует. Обновите отчет ЛНК.')
    assertExpectedInteractiveWeldVersions(
      [row.id],
      [{ id: row.id, version: data.expectedVersion }],
      [row],
    )
    if (!isSameRequestDocument(row[method.requestKey], row[method.requestDateKey], {
      name: data.requestName,
      date: data.requestDate,
    })) {
      throw new Error('Позиция заявки уже изменилась. Обновите отчет ЛНК и повторите действие.')
    }

    const record = buildLnkRequestPositionRemovalRow(row as WeldRow, method.requestKey)
    const previousRows = new Map([[row.id, row]])
    const validationContext = await loadServerWeldValidationContext(tx, [row])
    prepareServerWeldRecords({ records: [record], previousRows, context: validationContext })
    validateServerWeldRecords({ records: [record], previousRows, context: validationContext })
    const [updated] = await updateWeldJointsInBatches(tx, [record], previousRows)
    await syncSystemDocumentsForWeldChangesInTransaction(tx, [updated], previousRows)
    await markDispatcherTaskIndexDirty(tx, {
      scopes: getDispatcherDirtyScopes([record], previousRows),
    })
    return updated
  })
}

export async function manageLnkRequestDocument({
  data: input,
}: {
  data: RequestDocumentManagerData
}) {
  const data = normalizeRequestDocumentManagerData(input)
  await assertSecurityScope('edit')
  if (!data.requestName) throw new Error('Выберите заявку ЛНК')
  const db = requireDb()

  return db.transaction(async (tx) => {
    await lockRequestDocumentIdentities(tx, [
      { kind: 'lnk', name: data.requestName, date: data.requestDate },
      ...(data.action === 'rename'
        ? [{ kind: 'lnk' as const, name: data.nextRequestName, date: data.requestDate }]
        : []),
    ])
    await loadControlProcessSettingsFromTransaction(tx)
    const rows = await tx
      .select(WELD_TABLE_RETURNING)
      .from(weldJoints)
      .where(buildLnkRequestIdentityWhere(data.requestName, data.requestDate))
      .orderBy(asc(weldJoints.id))
      .for('update')
    if (rows.length === 0) throw new Error('Заявка ЛНК не найдена')
    assertExpectedInteractiveWeldVersions(
      rows.map((row) => row.id),
      data.expectedVersions,
      rows,
    )

    if (data.action === 'rename') {
      assertRequestDocumentRenameValues(data, 'ЛНК')
      const settings = await readRequestConclusionSettings(tx)
      if (isSystemDocumentNameForRows(rows as WeldRow[], 'lnkRequest', data.requestName, settings)) {
        throw new Error('Системную заявку ЛНК нельзя переименовать')
      }
      const [duplicate] = await tx
        .select({ id: weldJoints.id })
        .from(weldJoints)
        .where(buildLnkRequestIdentityWhere(data.nextRequestName, data.requestDate))
        .limit(1)
      if (duplicate) throw new Error('Заявка с таким наименованием и датой уже существует')
    }

    const records = buildLnkRequestManagerRows({
      records: rows as WeldRow[],
      requestName: data.requestName,
      requestDate: data.requestDate,
      nextRequestName: data.nextRequestName,
      action: data.action,
    })
    const previousRows = new Map(rows.map((row) => [row.id, row]))
    const validationContext = await loadServerWeldValidationContext(tx, rows)
    prepareServerWeldRecords({ records, previousRows, context: validationContext })
    validateServerWeldRecords({ records, previousRows, context: validationContext })
    const updated = await updateWeldJointsInBatches(tx, records, previousRows)
    await syncSystemDocumentsForWeldChangesInTransaction(tx, updated, previousRows)
    await markDispatcherTaskIndexDirty(tx, {
      scopes: getDispatcherDirtyScopes(records, previousRows),
    })
    return updated
  })
}

export async function managePstoRequestDocument({
  data: input,
}: {
  data: RequestDocumentManagerData
}) {
  const data = normalizeRequestDocumentManagerData(input)
  await assertSecurityScope('edit')
  if (!data.requestName) throw new Error('Выберите заявку ПСТО')
  const db = requireDb()

  return db.transaction(async (tx) => {
    await lockRequestDocumentIdentities(tx, [
      { kind: 'psto', name: data.requestName, date: data.requestDate },
      ...(data.action === 'rename'
        ? [{ kind: 'psto' as const, name: data.nextRequestName, date: data.requestDate }]
        : []),
    ])
    await loadControlProcessSettingsFromTransaction(tx)
    const rows = await tx
      .select(WELD_TABLE_RETURNING)
      .from(weldJoints)
      .where(and(
        sql`trim(coalesce(${weldJoints.pstoRequest}, '')) = ${data.requestName}`,
        data.requestDate
          ? eq(weldJoints.pstoRequestDate, data.requestDate)
          : isNull(weldJoints.pstoRequestDate),
      ))
      .orderBy(asc(weldJoints.id))
      .for('update')
    if (rows.length === 0) throw new Error('Заявка ПСТО не найдена')
    assertExpectedInteractiveWeldVersions(
      rows.map((row) => row.id),
      data.expectedVersions,
      rows,
    )

    if (data.action === 'rename') {
      assertRequestDocumentRenameValues(data, 'ПСТО')
      const settings = await readRequestConclusionSettings(tx)
      if (isSystemDocumentNameForRows(rows as WeldRow[], 'pstoRequest', data.requestName, settings)) {
        throw new Error('Системную заявку ПСТО нельзя переименовать')
      }
      const [duplicate] = await tx
        .select({ id: weldJoints.id })
        .from(weldJoints)
        .where(and(
          sql`trim(coalesce(${weldJoints.pstoRequest}, '')) = ${data.nextRequestName}`,
          data.requestDate
            ? eq(weldJoints.pstoRequestDate, data.requestDate)
            : isNull(weldJoints.pstoRequestDate),
        ))
        .limit(1)
      if (duplicate) throw new Error('Заявка с таким наименованием и датой уже существует')
    }

    const records = buildPstoRequestManagerRows({
      heatTreatmentRows: rows as WeldRow[],
      requestName: data.requestName,
      requestDate: data.requestDate,
      nextRequestName: data.nextRequestName,
      action: data.action,
    })
    const previousRows = new Map(rows.map((row) => [row.id, row]))
    const validationContext = await loadServerWeldValidationContext(tx, rows)
    prepareServerWeldRecords({ records, previousRows, context: validationContext })
    validateServerWeldRecords({ records, previousRows, context: validationContext })
    const updated = await updateWeldJointsInBatches(tx, records, previousRows)
    await syncSystemDocumentsForWeldChangesInTransaction(tx, updated, previousRows)
    await markDispatcherTaskIndexDirty(tx, {
      scopes: getDispatcherDirtyScopes(records, previousRows),
    })
    return updated
  })
}

export function normalizeRequestDocumentManagerData(
  data: RequestDocumentManagerData,
): Required<RequestDocumentManagerData> {
  const action = data?.action
  if (action !== 'rename' && action !== 'delete') throw new Error('Неизвестное действие с заявкой')
  return {
    requestName: String(data?.requestName ?? '').trim(),
    requestDate: normalizeDateLikeForStorage(data?.requestDate) ?? String(data?.requestDate ?? '').trim(),
    nextRequestName: String(data?.nextRequestName ?? '').trim(),
    action,
    expectedVersions: (Array.isArray(data?.expectedVersions) ? data.expectedVersions : []).map((entry) => ({
      id: Number(entry?.id),
      version: String(entry?.version ?? '').trim(),
    })),
  }
}

function assertRequestDocumentRenameValues(
  data: Required<RequestDocumentManagerData>,
  kind: 'ЛНК' | 'ПСТО',
) {
  if (!data.nextRequestName) throw new Error(`Введите новое наименование заявки ${kind}`)
  if (data.nextRequestName === data.requestName) {
    throw new Error('Новое наименование совпадает с текущим')
  }
}

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

export async function deleteWeldJoint({
  data: input,
}: {
  data: WeldDeleteData
}) {
  const data = {
    id: Number(input?.id),
    version: String(input?.version ?? '').trim(),
  }
  await assertSecurityScope('delete')
  const db = requireDb()

  await db.transaction(async (tx) => {
    await loadControlProcessSettingsFromTransaction(tx)
    const identityRows = await loadWeldLineIdentityRows(tx, [data.id])
    await lockWeldLineMemberships(tx, identityRows)
    const previousRows = await lockInteractiveWeldRows(tx, [data.id])
    if (!haveSameWeldLineMemberships(identityRows, previousRows)) {
      throw new Error(
        'Стык был перенесен на другую линию другим пользователем. Ничего не удалено. Обновите отчет и повторите действие.',
      )
    }
    assertExpectedInteractiveWeldVersions([data.id], [data], previousRows)
    await deleteLockedWeldRowsInTransaction(tx, previousRows)
  })
  return { ok: true }
}

export async function deleteWeldJoints({
  data: input,
}: {
  data: WeldDeleteManyData
}) {
  const data = {
    targets: Array.isArray(input?.targets)
      ? input.targets.map((target) => ({
          id: Number(target?.id),
          version: String(target?.version ?? '').trim(),
        }))
      : [],
  }
  await assertSecurityScope('delete')
  if (data.targets.length === 0) return { deleted: 0 }
  const ids = data.targets.map((target) => target.id)
  const db = requireDb()
  return db.transaction(async (tx) => {
    await loadControlProcessSettingsFromTransaction(tx)
    const identityRows = await loadWeldLineIdentityRows(tx, ids)
    await lockWeldLineMemberships(tx, identityRows)
    const previousRows = await lockInteractiveWeldRows(tx, ids)
    if (!haveSameWeldLineMemberships(identityRows, previousRows)) {
      throw new Error(
        'Один или несколько стыков были перенесены на другую линию другим пользователем. Ничего не удалено. Обновите отчет и повторите действие.',
      )
    }
    assertExpectedInteractiveWeldVersions(ids, data.targets, previousRows)
    await deleteLockedWeldRowsInTransaction(tx, previousRows)
    return { deleted: previousRows.length }
  })
}

export async function deleteLockedWeldRowsInTransaction(
  tx: Parameters<Parameters<ReturnType<typeof requireDb>['transaction']>[0]>[0],
  previousRows: WeldJoint[],
) {
  if (previousRows.length === 0) return
  const ids = previousRows.map((row) => row.id)
  const previousRowsById = new Map(previousRows.map((row) => [row.id, row]))

  await assertEarlyCoilDecisionRowsCanBeDeleted(tx, previousRows)
  await removeHeatTreatmentSourcedDocumentPositionsForWeldsInTransaction({
    tx,
    weldJointIds: ids,
  })
  for (const idBatch of splitNumberBatches(ids, 1000)) {
    await tx.delete(weldJoints).where(inArray(weldJoints.id, idBatch))
  }
  await syncSystemDocumentsForWeldChangesInTransaction(tx, [], previousRowsById)
  await deleteEmptyGeneratedDocuments(tx)
  await markDispatcherTaskIndexDirty(tx, {
    scopes: getDispatcherDirtyScopes([], previousRowsById),
  })
}

async function loadWeldLineIdentityRows(
  tx: Pick<SystemDocumentSequenceTransaction, 'select'>,
  values: readonly number[],
) {
  const ids = [...new Set(values
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0))]
    .sort((left, right) => left - right)
  const rows: Array<{
    id: number
    projectTitle: string | null
    subtitleCode: string | null
    line: string | null
  }> = []
  for (const idBatch of splitNumberBatches(ids, 1000)) {
    rows.push(...await tx
      .select({
        id: weldJoints.id,
        projectTitle: weldJoints.projectTitle,
        subtitleCode: weldJoints.subtitleCode,
        line: weldJoints.line,
      })
      .from(weldJoints)
      .where(inArray(weldJoints.id, idBatch)))
  }
  return rows
}

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
  processSettings: Awaited<ReturnType<typeof loadControlProcessSettingsFromTransaction>>,
) {
  const inserted: WeldJoint[] = []
  const preHeatTreatmentLnkExemptions = await getPreHeatTreatmentLnkExemptionsForNewRows(
    tx,
    records,
    processSettings,
  )
  let offset = 0
  for (const batch of splitWeldImportInsertBatches(records)) {
    const rows = await tx
      .insert(weldJoints)
      .values(batch.map((record, index) => ({
        ...toDbInsert(record, true),
        preHeatTreatmentLnkExempt: preHeatTreatmentLnkExemptions[offset + index] ?? false,
      })))
      .returning(WELD_TABLE_RETURNING)
    inserted.push(...rows)
    offset += batch.length
  }
  return inserted
}

export type { WeldMutationScope } from '@/server/weld-contracts'
