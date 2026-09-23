import { createServerFn } from '@tanstack/react-start'
import { asc, eq, sql } from 'drizzle-orm'

import { requireDb } from '@/db'
import {
  generatedDocuments,
  generatedDocumentWeldJoints,
  preHeatTreatmentControls,
  weldJoints,
} from '@/db/schema'
import { isControlEnabledValue } from '@/lib/control-availability-values'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { WeldRowVersionTarget } from '@/lib/weld-row-version'
import {
  getPrimaryLnkStageAccess,
  getPreHeatTreatmentControl,
  isPreHeatTreatmentLnkMethodCode,
  requiresPreHeatTreatmentLnk,
  type PreHeatTreatmentControlRecord,
  type PreHeatTreatmentLnkMethodCode,
} from '@/lib/lnk-control-stage'
import type { ControlProcessSettings } from '@/lib/control-process-settings'
import {
  buildPreHeatTreatmentToPrimaryTransfer,
  buildPrimaryToPreHeatTreatmentTransfer,
  findBlockingLnkStageTransferChronologyIssue,
  hasPrimaryLnkStageTrace,
  isLnkStageTransferResult,
  type LnkDocumentStageTransferPreview,
  type LnkStageTransferPackageSnapshot,
  type LnkStageTransferPosition,
  type LnkStageTransferPositionPreview,
} from '@/lib/lnk-stage-transfer'
import { ALL_LNK_FIELD_METHODS } from '@/lib/lnk-report-config'
import {
  type SystemDocumentReference,
  type SystemDocumentSourceKind,
  type SystemDocumentSourcePosition,
} from '@/lib/system-document-types'
import { getSystemDocumentTemplateId } from '@/lib/system-document-template-types'
import { calculateFinalStatus } from '@/lib/weld-status'
import { attachPreHeatTreatmentReportValues } from '@/lib/pre-heat-treatment-report-fields'
import { splitWeldImportInsertBatches } from '@/lib/weld-import-limits'
import {
  getDispatcherDirtyScopes,
  markDispatcherTaskIndexDirty,
} from '@/server/dispatcher-task-index-dirty'
import { loadControlProcessSettingsFromTransaction } from '@/server/control-process-settings'
import { attachDuplicateControlRelations } from '@/server/duplicate-control-relations'
import { assertStoredEarlyCoilDecisionSourcesRemainValid } from '@/server/early-coil-decision-guard'
import { attachHeatTreatmentControlRelations } from '@/server/heat-treatment-control-relations'
import { lockLayeredControlDocumentsForWeldChange } from '@/server/layered-control-documents'
import {
  haveSameWeldLineMemberships,
  lockWeldLineMembershipsForWeldIds,
} from '@/server/weld-line-membership-lock'
import { syncPreHeatTreatmentDocumentsInTransaction } from '@/server/pre-heat-treatment-system-documents'
import { assertPstoWorkflowLinesFullyAssigned } from '@/server/psto-workflow-line-guard'
import { assertSecurityScope } from '@/server/security-functions'
import {
  loadSourcedSystemDocumentPositionsInTransaction,
  lockSystemDocumentIndexes,
  removeSourcedSystemDocumentPositionsInTransaction,
  systemDocumentStorageType,
  syncSystemDocumentsForWeldChangesInTransaction,
} from '@/server/system-document-index'
import type { SystemDocumentSequenceTransaction } from '@/server/system-document-sequences'
import { WELD_TABLE_RETURNING } from '@/server/weld-server-shared'
import {
  assertExpectedInteractiveWeldVersions,
  lockInteractiveWeldRows,
} from '@/server/weld-row-version'
import { buildNumberArrayMatch } from '@/server/weld-request-utils'
import { attachSystemDocumentIds } from '@/server/generated-document-row-fields'
import { buildPrimaryLnkStageDebtSystemWarnings } from '@/lib/repeated-joint-check-tasks'

type LnkDocumentStageTransferRequest = SystemDocumentReference & {
  expectedVersions?: WeldRowVersionTarget[]
  positions?: LnkStageTransferPosition[]
}

type TransferContext = {
  reference: LnkDocumentStageTransferRequest & { documentId: number }
  sourceStage: 'primary' | 'beforeHeatTreatment'
  targetStage: 'primary' | 'beforeHeatTreatment'
  rows: WeldRow[]
  positions: LnkStageTransferPosition[]
  controls: PreHeatTreatmentControlRecord[]
  preview: LnkDocumentStageTransferPreview
}

export const previewLnkDocumentStageTransfer = createServerFn({ method: 'POST' })
  .validator(normalizeLnkDocumentStageTransferReference)
  .handler(async ({ data }) => {
    await assertSecurityScope('entry')
    const db = requireDb()
    return db.transaction(async (tx) => {
      const processSettings = await loadControlProcessSettingsFromTransaction(tx)
      assertStageTransferEnabled(processSettings)
      return (await loadTransferContext(tx, data, processSettings)).preview
    })
  })

export const transferLnkDocumentStage = createServerFn({ method: 'POST' })
  .validator(normalizeLnkDocumentStageTransferReference)
  .handler(async ({ data }) => {
    await assertSecurityScope('edit')
    const db = requireDb()
    return db.transaction(async (tx) => {
      const processSettings = await loadControlProcessSettingsFromTransaction(tx)
      assertStageTransferEnabled(processSettings)
      const context = await loadTransferContext(tx, data, processSettings, true)
      if (context.positions.length === 0) throw new Error('Выберите хотя бы одну позицию для переноса этапа.')
      const allRowIds = context.rows.map((row) => row.id)
      const affectedRowIds = [...new Set(context.positions.map((position) => position.rowId))]
      const affectedRowIdSet = new Set(affectedRowIds)
      assertExpectedInteractiveWeldVersions(allRowIds, data.expectedVersions, context.rows)
      const rowsWithDuplicates = await attachDuplicateControlRelations(context.rows, tx)
      const previousRows = new Map(rowsWithDuplicates.map((row) => [row.id, row]))
      let nextRows: WeldRow[]

      if (context.sourceStage === 'primary') {
        const transfer = buildPrimaryToPreHeatTreatmentTransfer({
          rows: rowsWithDuplicates,
          positions: context.positions,
        })
        const savedControls: PreHeatTreatmentControlRecord[] = []
        for (const batch of splitWeldImportInsertBatches(transfer.controls)) {
          savedControls.push(...await tx
            .insert(preHeatTreatmentControls)
            .values(batch)
            .returning())
        }
        if (savedControls.length !== transfer.controls.length) {
          throw new Error('Не удалось перенести все позиции НК до ТО. Ничего не сохранено.')
        }
        nextRows = attachSavedControls(transfer.rows, savedControls)
          .filter((row) => affectedRowIdSet.has(row.id))
        assertNoNewChronologyIssues(
          rowsWithDuplicates.filter((row) => affectedRowIdSet.has(row.id)),
          nextRows,
          'beforeHeatTreatment',
          processSettings,
        )
        nextRows = nextRows.map(withRecalculatedFinalStatus)
        const updatedRows = await persistPrimaryStageRows(tx, nextRows)
        nextRows = mergeAttachedRelations(updatedRows, nextRows)
        await syncSystemDocumentsForWeldChangesInTransaction(tx, nextRows, previousRows)
        await syncPreHeatTreatmentDocumentsInTransaction(tx, nextRows, savedControls)
      } else {
        nextRows = buildPreHeatTreatmentToPrimaryTransfer({
          rows: rowsWithDuplicates,
          controls: context.controls,
        }).map((row) => ({
          ...row,
          preHeatTreatmentControls: (row.preHeatTreatmentControls ?? []).filter((control) =>
            !context.controls.some((moved) => moved.id === control.id),
          ),
        })).filter((row) => affectedRowIdSet.has(row.id))
        assertNoNewChronologyIssues(
          rowsWithDuplicates.filter((row) => affectedRowIdSet.has(row.id)),
          nextRows,
          'primary',
          processSettings,
        )
        nextRows = nextRows.map(withRecalculatedFinalStatus)
        await removeSourcedSystemDocumentPositionsInTransaction({
          tx,
          sourceKind: 'beforeHeatTreatment',
          relationIds: context.controls.map((control) => control.id),
        })
        await tx
          .delete(preHeatTreatmentControls)
          .where(buildNumberArrayMatch(
            preHeatTreatmentControls.id,
            context.controls.map((control) => control.id),
          ))
        const updatedRows = await persistPrimaryStageRows(tx, nextRows)
        nextRows = mergeAttachedRelations(updatedRows, nextRows)
        await syncSystemDocumentsForWeldChangesInTransaction(tx, nextRows, previousRows)
      }

      await assertStoredEarlyCoilDecisionSourcesRemainValid(tx, affectedRowIds)
      await markDispatcherTaskIndexDirty(tx, {
        scopes: getDispatcherDirtyScopes(nextRows, previousRows),
      })
      nextRows = nextRows.map((row) => attachPreHeatTreatmentReportValues(
        row,
        row.preHeatTreatmentControls ?? [],
      ) as WeldRow)
      nextRows = await attachSystemDocumentIds(nextRows, tx) as WeldRow[]
      return { preview: context.preview, rows: nextRows }
    })
  })

async function loadTransferContext(
  tx: SystemDocumentSequenceTransaction,
  reference: LnkDocumentStageTransferRequest & { documentId: number },
  processSettings: ControlProcessSettings,
  lock = false,
): Promise<TransferContext> {
  const [document] = await tx
    .select()
    .from(generatedDocuments)
    .where(eq(generatedDocuments.id, reference.documentId))
    .limit(1)
  const sourceStage = getValidatedSourceStage(document, reference)

  const assignments = await tx
    .select({ weldJointId: generatedDocumentWeldJoints.weldJointId })
    .from(generatedDocumentWeldJoints)
    .where(eq(generatedDocumentWeldJoints.documentId, reference.documentId))
  const rowIds = [...new Set(assignments.map((assignment) => assignment.weldJointId))]
  if (rowIds.length === 0) throw new Error('В документе больше нет стыков. Обновите раздел «Документы».')
  const lineMembershipSnapshot = lock
    ? await lockWeldLineMembershipsForWeldIds(tx, rowIds)
    : []
  if (lock && lineMembershipSnapshot.length !== rowIds.length) {
    throw new Error('Часть стыков документа больше не существует. Обновите раздел «Документы».')
  }
  const storedRows = lock
    ? await lockInteractiveWeldRows(tx, rowIds)
    : await loadWeldRowsByIds(tx, rowIds)
  if (storedRows.length !== rowIds.length) {
    throw new Error('Часть стыков документа больше не существует. Обновите раздел «Документы».')
  }
  if (lock && !haveSameWeldLineMemberships(lineMembershipSnapshot, storedRows)) {
    throw new Error('Часть стыков документа уже перенесена на другую линию. Обновите раздел «Документы».')
  }
  let sourcePositions: Awaited<ReturnType<typeof loadSourcedSystemDocumentPositionsInTransaction>> = []
  let controls: PreHeatTreatmentControlRecord[] = []
  if (sourceStage === 'beforeHeatTreatment') {
    sourcePositions = await loadSourcedSystemDocumentPositionsInTransaction({
      tx,
      documentId: reference.documentId,
      sourceKind: 'beforeHeatTreatment',
    })
    const relationIds = [...new Set(sourcePositions.map((position) => position.relationId))]
    if (relationIds.length > 0) {
      const controlsQuery = tx
        .select()
        .from(preHeatTreatmentControls)
        .where(buildNumberArrayMatch(
          preHeatTreatmentControls.id,
          [...relationIds].sort((left, right) => left - right),
        ))
        .orderBy(asc(preHeatTreatmentControls.id))
      controls = lock ? await controlsQuery.for('update') : await controlsQuery
    }
    if (controls.length !== relationIds.length) {
      throw new Error('Часть позиций НК до ТО уже изменена. Обновите раздел «Документы».')
    }
  }
  if (lock) {
    await lockLayeredControlDocumentsForWeldChange(tx)
    await lockSystemDocumentIndexes(tx)
    const [lockedDocument] = await tx
      .select()
      .from(generatedDocuments)
      .where(eq(generatedDocuments.id, reference.documentId))
      .limit(1)
      .for('update')
    const lockedSourceStage = getValidatedSourceStage(lockedDocument, reference)
    const lockedAssignments = await tx
      .select({ weldJointId: generatedDocumentWeldJoints.weldJointId })
      .from(generatedDocumentWeldJoints)
      .where(eq(generatedDocumentWeldJoints.documentId, reference.documentId))
      .orderBy(asc(generatedDocumentWeldJoints.weldJointId))
      .for('update')
    const lockedRowIds = [...new Set(lockedAssignments.map((assignment) => assignment.weldJointId))]
    if (lockedSourceStage !== sourceStage || !haveSameIds(rowIds, lockedRowIds)) {
      throw new Error('Состав или этап системного документа уже изменился. Обновите раздел «Документы».')
    }
    if (sourceStage === 'beforeHeatTreatment') {
      const lockedSourcePositions = await loadSourcedSystemDocumentPositionsInTransaction({
        tx,
        documentId: reference.documentId,
        sourceKind: 'beforeHeatTreatment',
      })
      if (!haveSameSourcePositions(sourcePositions, lockedSourcePositions)) {
        throw new Error('Позиции системного документа уже изменились. Обновите раздел «Документы».')
      }
    }
  }
  const rows = await attachHeatTreatmentControlRelations(storedRows as WeldRow[], tx)
  const pstoRows = rows.filter((row) => isControlEnabledValue(row.pstoRequired))
  if (pstoRows.length > 0) {
    await assertPstoWorkflowLinesFullyAssigned(tx, pstoRows)
  }

  let allPositions: LnkStageTransferPosition[]
  if (sourceStage === 'primary') {
    allPositions = collectPrimaryPositions(rows, reference)
  } else {
    allPositions = controls.map((control) => ({
      rowId: control.weldJointId,
      methodCode: requirePreMethod(control.method),
    }))
  }
  allPositions = uniquePositions(allPositions)
  if (allPositions.length === 0) {
    throw new Error('В документе нет позиций, которые можно перенести между этапами.')
  }

  const targetStage = sourceStage === 'primary' ? 'beforeHeatTreatment' : 'primary'
  const rowsById = new Map(rows.map((row) => [row.id, row]))
  const controlsByPosition = new Map(controls.map((control) => [
    positionKey({ rowId: control.weldJointId, methodCode: String(control.method) }),
    control,
  ]))
  const positionPreviews = allPositions.map((position) => {
    const row = rowsById.get(position.rowId)
    if (!row) throw new Error(`Стык #${position.rowId} больше не существует. Обновите раздел «Документы».`)
    const control = controlsByPosition.get(positionKey(position))
    return buildPositionPreview({
      row,
      position,
      control,
      sourceStage,
      processSettings,
    })
  })
  const positionPreviewsByKey = new Map(
    positionPreviews.map((position) => [positionKey(position), position]),
  )
  const requestedPositions = reference.positions === undefined
    ? positionPreviews.filter((position) => !position.disabledReason)
    : uniquePositions(reference.positions).map((position) => {
        const preview = positionPreviewsByKey.get(positionKey(position))
        if (!preview) {
          throw new Error(`Позиция #${position.rowId} · ${position.methodCode} больше не входит в документ.`)
        }
        if (preview.disabledReason) {
          throw new Error(`Стык ${preview.joint}, ${preview.methodCode}: ${preview.disabledReason}`)
        }
        return preview
      })
  const positions = requestedPositions.map(({ rowId, methodCode }) => ({ rowId, methodCode }))
  const selectedKeys = new Set(positions.map(positionKey))
  const selectedControls = controls.filter((control) => selectedKeys.has(positionKey({
    rowId: control.weldJointId,
    methodCode: String(control.method),
  })))
  if (sourceStage === 'beforeHeatTreatment' && selectedControls.length !== positions.length) {
    throw new Error('Часть выбранных позиций НК до ТО уже изменилась. Обновите раздел «Документы».')
  }

  const simulatedRows = positions.length > 0
    ? simulateStageTransfer({ rows, positions, controls: selectedControls, sourceStage })
    : rows
  if (positions.length > 0 && reference.positions !== undefined) {
    assertNoNewChronologyIssues(rows, simulatedRows, targetStage, processSettings)
  }

  const methodCodes = [...new Set(positions.map((position) => position.methodCode))]
    .sort(comparePreMethods)
  const completedResultCount = requestedPositions.filter(
    (position) => isLnkStageTransferResult(position.source.result),
  ).length
  const affectedRowIds = new Set(positions.map((position) => position.rowId))
  const resultingSystemWarningCount = positions.length > 0
    ? buildPrimaryLnkStageDebtSystemWarnings(
        simulatedRows.filter((row) => affectedRowIds.has(row.id)),
      ).length
    : 0
  const preview: LnkDocumentStageTransferPreview = {
    documentId: reference.documentId,
    expectedVersions: rows.map((row) => ({
      id: row.id,
      version: String(row.rowVersion ?? '').trim(),
    })),
    sourceStage,
    targetStage,
    rowCount: new Set(positions.map((position) => position.rowId)).size,
    positionCount: positions.length,
    completedResultCount,
    methodCodes,
    transferablePositionCount: positionPreviews.filter((position) => !position.disabledReason).length,
    blockedPositionCount: positionPreviews.filter((position) => Boolean(position.disabledReason)).length,
    resultingSystemWarningCount,
    positions: positionPreviews,
  }
  return {
    reference,
    sourceStage,
    targetStage: preview.targetStage,
    rows,
    positions,
    controls: selectedControls,
    preview,
  }
}

function buildPositionPreview({
  row,
  position,
  control,
  sourceStage,
  processSettings,
}: {
  row: WeldRow
  position: LnkStageTransferPosition
  control?: PreHeatTreatmentControlRecord
  sourceStage: 'primary' | 'beforeHeatTreatment'
  processSettings: ControlProcessSettings
}): LnkStageTransferPositionPreview {
  const method = ALL_LNK_FIELD_METHODS.find((candidate) => candidate.code === position.methodCode)!
  let disabledReason: string | null = null
  if (sourceStage === 'primary') {
    if (!requiresPreHeatTreatmentLnk(row)) {
      disabledReason = 'для этого стыка этап «До ТО» не применяется.'
    } else if (getPreHeatTreatmentControl(row, position.methodCode)) {
      disabledReason = `целевой комплект ${position.methodCode} до ТО уже заполнен.`
    } else if (!hasPrimaryLnkStageTrace(row, position.methodCode)) {
      disabledReason = `исходный основной комплект ${position.methodCode} уже пуст.`
    }
  } else if (!control) {
    disabledReason = 'исходный комплект НК до ТО больше не существует.'
  } else if (hasPrimaryLnkStageTrace(row, position.methodCode)) {
    disabledReason = `целевой основной комплект ${position.methodCode} уже заполнен.`
  } else {
    const currentAccess = getPrimaryLnkStageAccess(row, position.methodCode, processSettings)
    if (currentAccess.status === 'blocked') {
      disabledReason = currentAccess.reason
    } else {
      const simulated = simulateStageTransfer({
        rows: [row],
        positions: [position],
        controls: [control],
        sourceStage,
      })[0]!
      const nextAccess = getPrimaryLnkStageAccess(simulated, position.methodCode, processSettings)
      if (nextAccess.status === 'blocked') disabledReason = nextAccess.reason
    }
  }

  return {
    ...position,
    projectTitle: text(row.projectTitle),
    subtitleCode: text(row.subtitleCode),
    line: text(row.line),
    joint: text(row.joint) || `ID ${row.id}`,
    disabledReason,
    source: sourceStage === 'primary'
      ? {
          requestName: text(row[method.requestKey]),
          requestDate: text(row[method.requestDateKey]),
          result: text(row[method.resultKey]),
          conclusionDate: text(row[method.conclusionDateKey]),
          conclusionName: text(row[method.conclusionKey]),
          defectDescription: method.defectDescriptionKey
            ? text(row[method.defectDescriptionKey])
            : '',
          rkExposureConfirmedDiameter: position.methodCode === 'РК'
            ? numberOrNull(row.rkExposureConfirmedDiameter)
            : null,
        }
      : buildControlSnapshot(control!),
  }
}

function buildControlSnapshot(control: PreHeatTreatmentControlRecord): LnkStageTransferPackageSnapshot {
  return {
    requestName: text(control.requestName),
    requestDate: text(control.requestDate),
    result: text(control.result),
    conclusionDate: text(control.conclusionDate),
    conclusionName: text(control.conclusionName),
    defectDescription: text(control.defectDescription),
    rkExposureConfirmedDiameter: numberOrNull(control.rkExposureConfirmedDiameter),
  }
}

function simulateStageTransfer({
  rows,
  positions,
  controls,
  sourceStage,
}: {
  rows: WeldRow[]
  positions: LnkStageTransferPosition[]
  controls: PreHeatTreatmentControlRecord[]
  sourceStage: 'primary' | 'beforeHeatTreatment'
}) {
  if (sourceStage === 'primary') {
    const transfer = buildPrimaryToPreHeatTreatmentTransfer({ rows, positions })
    const previewControls = transfer.controls.map((control, index) => ({
      ...control,
      id: -(index + 1),
    }))
    return attachSavedControls(transfer.rows, previewControls)
  }
  const movedControlIds = new Set(controls.map((control) => control.id))
  return buildPreHeatTreatmentToPrimaryTransfer({ rows, controls }).map((row) => ({
    ...row,
    preHeatTreatmentControls: (row.preHeatTreatmentControls ?? []).filter(
      (candidate) => !movedControlIds.has(candidate.id),
    ),
  }))
}

async function loadWeldRowsByIds(
  tx: SystemDocumentSequenceTransaction,
  rowIds: readonly number[],
) {
  return tx
    .select(WELD_TABLE_RETURNING)
    .from(weldJoints)
    .where(buildNumberArrayMatch(
      weldJoints.id,
      [...rowIds].sort((left, right) => left - right),
    ))
    .orderBy(asc(weldJoints.id))
}

function getValidatedSourceStage(
  document: typeof generatedDocuments.$inferSelect | undefined,
  reference: SystemDocumentReference & { documentId: number },
) {
  if (!document) throw new Error('Системный документ больше не существует. Обновите раздел «Документы».')
  if (
    document.type !== systemDocumentStorageType(getSystemDocumentTemplateId(reference)) ||
    document.title !== reference.title ||
    String(document.periodFrom ?? '') !== reference.date
  ) {
    throw new Error('Системный документ уже изменился. Обновите раздел «Документы».')
  }
  const sourceKind = parseSourceKind(document.sourceMetadata)
  if (sourceKind === 'pstoRepeat' || sourceKind === 'pstoCycle') {
    throw new Error('Повторный цикл ПСТО не относится к этапам ЛНК.')
  }
  const sourceStage = sourceKind === 'beforeHeatTreatment' ? 'beforeHeatTreatment' : 'primary'
  if (sourceStage === 'beforeHeatTreatment' && reference.sourceKind !== 'beforeHeatTreatment') {
    throw new Error('Этап системного документа уже изменился. Обновите раздел «Документы».')
  }
  if (sourceStage === 'primary' && reference.sourceKind) {
    throw new Error('Этап системного документа уже изменился. Обновите раздел «Документы».')
  }
  return sourceStage
}

function haveSameIds(left: readonly number[], right: readonly number[]) {
  if (left.length !== right.length) return false
  const rightIds = new Set(right)
  return left.every((id) => rightIds.has(id))
}

function haveSameSourcePositions(
  left: readonly SystemDocumentSourcePosition[],
  right: readonly SystemDocumentSourcePosition[],
) {
  const toKeys = (values: readonly SystemDocumentSourcePosition[]) => values
    .map((position) => [
      position.kind,
      position.weldJointId,
      position.relationId,
      position.sequence ?? 1,
      position.methodCode ?? '',
    ].join(':'))
    .sort()
  return JSON.stringify(toKeys(left)) === JSON.stringify(toKeys(right))
}

function collectPrimaryPositions(rows: WeldRow[], reference: SystemDocumentReference) {
  const positions: LnkStageTransferPosition[] = []
  for (const row of rows) {
    for (const method of ALL_LNK_FIELD_METHODS) {
      const matches = reference.type === 'lnkRequest'
        ? text(row[method.requestKey]) === reference.title && text(row[method.requestDateKey]) === reference.date
        : reference.type === 'lnkConclusion' &&
          method.code === reference.methodCode &&
          text(row[method.conclusionKey]) === reference.title &&
          text(row[method.conclusionDateKey]) === reference.date
      if (!matches) continue
      if (!isPreHeatTreatmentLnkMethodCode(method.code)) continue
      positions.push({ rowId: row.id, methodCode: method.code })
    }
  }
  return uniquePositions(positions)
}

export async function persistPrimaryStageRows(
  tx: SystemDocumentSequenceTransaction,
  rows: WeldRow[],
) {
  const now = new Date()
  const payloads = rows.map((row) => ({
    id: row.id,
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
    finalStatus: textOrNull(row.finalStatus),
    lnkUpdatedAt: now,
    updatedAt: now,
  }))
  const updatedRows: WeldRow[] = []
  for (const batch of splitWeldImportInsertBatches(payloads)) {
    const saved = await tx
      .insert(weldJoints)
      .values(batch)
      .onConflictDoUpdate({
        target: weldJoints.id,
        set: {
          vikRequest: sql`excluded."vik_request"`,
          vikRequestDate: sql`excluded."vik_request_date"`,
          vikResult: sql`excluded."vik_result"`,
          vikConclusionDate: sql`excluded."vik_conclusion_date"`,
          vikConclusion: sql`excluded."vik_conclusion"`,
          vikDefectDescription: sql`excluded."vik_defect_description"`,
          rkRequest: sql`excluded."rk_request"`,
          rkRequestDate: sql`excluded."rk_request_date"`,
          rkResult: sql`excluded."rk_result"`,
          rkConclusionDate: sql`excluded."rk_conclusion_date"`,
          rkConclusion: sql`excluded."rk_conclusion"`,
          uzkRequest: sql`excluded."uzk_request"`,
          uzkRequestDate: sql`excluded."uzk_request_date"`,
          uzkResult: sql`excluded."uzk_result"`,
          uzkConclusionDate: sql`excluded."uzk_conclusion_date"`,
          uzkConclusion: sql`excluded."uzk_conclusion"`,
          uzkDefectDescription: sql`excluded."uzk_defect_description"`,
          pvkRequest: sql`excluded."pvk_request"`,
          pvkRequestDate: sql`excluded."pvk_request_date"`,
          pvkResult: sql`excluded."pvk_result"`,
          pvkConclusionDate: sql`excluded."pvk_conclusion_date"`,
          pvkConclusion: sql`excluded."pvk_conclusion"`,
          pvkDefectDescription: sql`excluded."pvk_defect_description"`,
          lnkDefectDescription: sql`excluded."lnk_defect_description"`,
          rkExposureConfirmedDiameter: sql`excluded."rk_exposure_confirmed_diameter"`,
          finalStatus: sql`excluded."final_status"`,
          lnkUpdatedAt: sql`excluded."lnk_updated_at"`,
          updatedAt: sql`excluded."updated_at"`,
        },
      })
      .returning(WELD_TABLE_RETURNING)
    if (saved.length !== batch.length) {
      throw new Error('Не удалось сохранить все позиции переноса этапа. Ничего не сохранено.')
    }
    updatedRows.push(...saved as WeldRow[])
  }
  const updatedRowsById = new Map(updatedRows.map((row) => [row.id, row]))
  return rows.map((row) => {
    const updated = updatedRowsById.get(row.id)
    if (!updated) throw new Error(`Стык #${row.id} больше не существует. Обновите отчет.`)
    return updated
  })
}

function attachSavedControls(rows: WeldRow[], controls: PreHeatTreatmentControlRecord[]) {
  const controlsByRowId = groupByRowId(controls)
  return rows.map((row) => ({
    ...row,
    preHeatTreatmentControls: [
      ...(row.preHeatTreatmentControls ?? []),
      ...(controlsByRowId.get(row.id) ?? []),
    ],
  }))
}

function mergeAttachedRelations(storedRows: WeldRow[], sourceRows: WeldRow[]) {
  const sourceById = new Map(sourceRows.map((row) => [row.id, row]))
  return storedRows.map((row) => {
    const source = sourceById.get(row.id)
    return {
      ...row,
      preHeatTreatmentControls: source?.preHeatTreatmentControls ?? [],
      pstoRepeatCycles: source?.pstoRepeatCycles ?? [],
      duplicateControls: source?.duplicateControls ?? [],
    } as WeldRow
  })
}

function withRecalculatedFinalStatus(row: WeldRow) {
  return { ...row, finalStatus: calculateFinalStatus(row) } as WeldRow
}

function assertNoNewChronologyIssues(
  previousRows: WeldRow[],
  nextRows: WeldRow[],
  targetStage: 'primary' | 'beforeHeatTreatment',
  processSettings: ControlProcessSettings,
) {
  const issue = findBlockingLnkStageTransferChronologyIssue({
    previousRows,
    nextRows,
    targetStage,
    allowPrimaryStageDebt:
      targetStage === 'primary' &&
      processSettings.preHeatTreatmentLnkEnabled &&
      processSettings.allowPrimaryLnkBeforePreviousStagesComplete,
  })
  if (issue) throw new Error(`Перенос этапа невозможен: ${issue.message}`)
}

function assertStageTransferEnabled(processSettings: ControlProcessSettings) {
  if (!processSettings.preHeatTreatmentLnkEnabled) {
    throw new Error('Изменение этапа контроля недоступно: процесс «НК до ТО» выключен в настройках.')
  }
}

export function normalizeLnkDocumentStageTransferReference(value: LnkDocumentStageTransferRequest) {
  const documentId = normalizePositiveSafeInteger(value?.documentId)
  const type = value?.type
  const title = text(value?.title)
  const date = text(value?.date).slice(0, 10)
  const methodCode = text(value?.methodCode).toLocaleUpperCase('ru-RU')
  const sourceKind = value?.sourceKind
  if (documentId === null || (type !== 'lnkRequest' && type !== 'lnkConclusion') || !title) {
    throw new Error('Некорректный системный документ ЛНК.')
  }
  if (sourceKind && sourceKind !== 'beforeHeatTreatment') {
    throw new Error('Этот документ не относится к этапам ЛНК.')
  }
  if (value?.positions !== undefined && !Array.isArray(value.positions)) {
    throw new Error('Некорректный список позиций для переноса этапа.')
  }
  const positions = value?.positions === undefined
    ? undefined
    : uniquePositions(value.positions.map((position) => ({
        rowId: normalizePositiveSafeInteger(position?.rowId) ?? 0,
        methodCode: requirePreMethod(position?.methodCode),
      })))
  if (positions?.some((position) => position.rowId <= 0)) {
    throw new Error('Некорректная позиция для переноса этапа.')
  }
  return {
    documentId,
    type,
    title,
    date,
    ...(methodCode ? { methodCode } : {}),
    ...(sourceKind ? { sourceKind } : {}),
    ...(positions === undefined ? {} : { positions }),
    expectedVersions: (Array.isArray(value?.expectedVersions) ? value.expectedVersions : []).map((entry) => ({
      id: Number(entry?.id),
      version: String(entry?.version ?? '').trim(),
    })),
  } as LnkDocumentStageTransferRequest & {
    documentId: number
    expectedVersions: WeldRowVersionTarget[]
  }
}

function normalizePositiveSafeInteger(value: unknown) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : null
}

function parseSourceKind(value: unknown): SystemDocumentSourceKind | undefined {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value || '{}') : value
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const sourceKind = (parsed as { sourceKind?: unknown }).sourceKind
    return sourceKind === 'beforeHeatTreatment' || sourceKind === 'pstoRepeat' || sourceKind === 'pstoCycle'
      ? sourceKind
      : undefined
  } catch {
    return undefined
  }
}

function uniquePositions(positions: LnkStageTransferPosition[]) {
  return [...new Map(positions.map((position) => [
    `${position.rowId}:${position.methodCode}`,
    position,
  ])).values()]
}

function positionKey(position: { rowId: number; methodCode: string }) {
  return `${position.rowId}:${text(position.methodCode).toLocaleUpperCase('ru-RU')}`
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

function requirePreMethod(value: unknown): PreHeatTreatmentLnkMethodCode {
  const methodCode = text(value).toLocaleUpperCase('ru-RU')
  if (!isPreHeatTreatmentLnkMethodCode(methodCode)) {
    throw new Error(`${methodCode || 'Выбранный метод'} не поддерживает этап «До ТО».`)
  }
  return methodCode
}

function comparePreMethods(left: PreHeatTreatmentLnkMethodCode, right: PreHeatTreatmentLnkMethodCode) {
  const order: PreHeatTreatmentLnkMethodCode[] = ['ВИК', 'РК', 'УЗК', 'ПВК']
  return order.indexOf(left) - order.indexOf(right)
}

function textOrNull(value: unknown) {
  return text(value) || null
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function text(value: unknown) {
  return String(value ?? '').trim()
}
