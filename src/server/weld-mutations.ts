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
import type { WeldRow } from '@/lib/dispatcher-types'
import type { DuplicateControlRecord } from '@/lib/duplicate-control-types'
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
} from '@/lib/psto-line-assignment'
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
    id: Number(data.id),
    currentJoint: String(data.currentJoint ?? '').trim(),
    targetJoint: String(data.targetJoint ?? '').trim(),
  }))
  .handler(async ({ data }) => {
    await assertSecurityScope('edit')
    if (!Number.isInteger(data.id) || data.id <= 0 || !data.currentJoint || !data.targetJoint) {
      throw new Error('Некорректные данные системного переименования стыка.')
    }
    const db = requireDb()
    return db.transaction(async (tx) => {
      const [previous] = await tx.select().from(weldJoints).where(eq(weldJoints.id, data.id)).limit(1)
      if (!previous) throw new Error('Стык для переименования не найден.')
      if (String(previous.joint ?? '').trim().toUpperCase() !== data.currentJoint.toUpperCase()) {
        throw new Error('Название стыка уже изменилось. Обновите диспетчер задач.')
      }

      const projectClause = previous.projectTitle === null
        ? or(isNull(weldJoints.projectTitle), eq(weldJoints.projectTitle, ''))!
        : eq(weldJoints.projectTitle, previous.projectTitle)
      const subtitleClause = previous.subtitleCode === null
        ? or(isNull(weldJoints.subtitleCode), eq(weldJoints.subtitleCode, ''))!
        : eq(weldJoints.subtitleCode, previous.subtitleCode)
      const lineClause = previous.line === null
        ? or(isNull(weldJoints.line), eq(weldJoints.line, ''))!
        : eq(weldJoints.line, previous.line)
      const rows = await tx
        .select()
        .from(weldJoints)
        .where(and(projectClause, subtitleClause, lineClause))
      const validationContext = await loadServerWeldValidationContext(tx)
      if (!isAuthorizedSystemRepeatedJointRename(
        rows as WeldRow[],
        data,
        validationContext.systemIndexSettings,
      )) {
        throw new Error('Системное переименование больше не соответствует текущим правилам цепочки.')
      }

      const record = { ...previous, joint: data.targetJoint }
      await assertEarlyCoilDecisionSourcesRemainValid(
        tx,
        [record],
        new Map([[previous.id, previous]]),
      )
      validateServerWeldRecords({
        records: [record],
        previousRows: new Map([[previous.id, previous]]),
        context: validationContext,
        allowSystemJointNames: true,
      })
      const [updated] = await tx
        .update(weldJoints)
        .set({ joint: data.targetJoint, weldingUpdatedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(weldJoints.id, data.id), eq(weldJoints.joint, data.currentJoint)))
        .returning()
      if (!updated) throw new Error('Название стыка уже изменилось. Обновите диспетчер задач.')
      await syncSystemDocumentsForWeldChangesInTransaction(
        tx,
        [updated],
        new Map([[previous.id, previous]]),
      )
      await markDispatcherTaskIndexDirty(tx, {
        scopes: getDispatcherDirtyScopes([record], new Map([[previous.id, previous]])),
      })
      return updated
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
    const previous = previousStored as unknown as WeldRow
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
      record.preHeatTreatmentLnkExempt = await getPreHeatTreatmentLnkExemptionForNewRow(tx, record)
    }
    if (
      (data.pstoLineMoveDisposition === 'movePrimaryToBeforeHeatTreatment' ||
        data.pstoLineMoveDisposition === 'deletePrimary') &&
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
    let validationPreviousRows = previousRows
    let pendingPreHeatTreatmentControls: LnkStageTransferControlWrite[] = []

    if (requiresPrimaryStageResolution) {
      const disposition = data.pstoLineMoveDisposition
      if (
        disposition !== 'keepPrimary' &&
        disposition !== 'movePrimaryToBeforeHeatTreatment' &&
        disposition !== 'deletePrimary'
      ) {
        throw new Error('Выберите: сохранить основной комплект, перенести его в «До ТО» или удалить.')
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
        validationPreviousRows = new Map([[
          id,
          buildPstoAssignedKeepPrimaryValidationRow(previous) as unknown as WeldJoint,
        ]])
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
            id: -(index + 1),
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
      const disposition = data.pstoLineMoveDisposition
      if (disposition !== 'keepPrimary' && disposition !== 'promoteBeforeHeatTreatment') {
        throw new Error('Выберите, какой комплект НК сохранить при переносе стыка на линию без ПСТО.')
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
        throw new Error('Для переноса в основной комплект нет завершенного НК до ТО.')
      }
      const duplicateRecords = await tx
        .select()
        .from(duplicateControls)
        .where(eq(duplicateControls.weldJointId, id))
      const previousWithDuplicates = {
        ...previous,
        duplicateControls: duplicateRecords as unknown as DuplicateControlRecord[],
      } as WeldRow
      const moveRow = {
        ...record,
        duplicateControls: previousWithDuplicates.duplicateControls,
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

      const sanitizedPrevious = {
        ...cleanedRecord,
        projectTitle: previous.projectTitle,
        subtitleCode: previous.subtitleCode,
        line: previous.line,
      } as WeldRow
      validationPreviousRows = new Map([[id, sanitizedPrevious as unknown as WeldJoint]])

      if (!preservesPerformedHistory && controls.length > 0) {
        await removeSourcedSystemDocumentPositionsInTransaction({
          tx,
          sourceKind: 'beforeHeatTreatment',
          relationIds: controls.map((control) => control.id),
        })
        await tx
          .delete(preHeatTreatmentControls)
          .where(eq(preHeatTreatmentControls.weldJointId, id))
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
        await deletePstoRepeatCyclesInTransaction(
          tx,
          unstartedRepeatCycles.map((cycle) => cycle.id),
        )
      }
    }

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
