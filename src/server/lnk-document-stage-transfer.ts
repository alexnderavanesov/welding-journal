import { createServerFn } from '@tanstack/react-start'
import { asc, eq, inArray, sql } from 'drizzle-orm'

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
  isPreHeatTreatmentLnkMethodCode,
  type PreHeatTreatmentControlRecord,
  type PreHeatTreatmentLnkMethodCode,
} from '@/lib/lnk-control-stage'
import {
  buildPreHeatTreatmentToPrimaryTransfer,
  buildPrimaryToPreHeatTreatmentTransfer,
  findBlockingLnkStageTransferChronologyIssue,
  type LnkDocumentStageTransferPreview,
  type LnkStageTransferPosition,
} from '@/lib/lnk-stage-transfer'
import { ALL_LNK_FIELD_METHODS } from '@/lib/lnk-report-config'
import {
  type SystemDocumentReference,
  type SystemDocumentSourceKind,
  type SystemDocumentSourcePosition,
} from '@/lib/system-document-types'
import { getSystemDocumentTemplateId } from '@/lib/system-document-template-types'
import { calculateFinalStatus } from '@/lib/weld-status'
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
import { splitNumberBatches } from '@/server/weld-request-utils'

type LnkDocumentStageTransferRequest = SystemDocumentReference & {
  expectedVersions?: WeldRowVersionTarget[]
}

type TransferContext = {
  reference: SystemDocumentReference & { documentId: number }
  sourceStage: 'primary' | 'beforeHeatTreatment'
  targetStage: 'primary' | 'beforeHeatTreatment'
  rows: WeldRow[]
  positions: LnkStageTransferPosition[]
  controls: PreHeatTreatmentControlRecord[]
  preview: LnkDocumentStageTransferPreview
}

export const previewLnkDocumentStageTransfer = createServerFn({ method: 'POST' })
  .validator(normalizeReference)
  .handler(async ({ data }) => {
    await assertSecurityScope('entry')
    const db = requireDb()
    return db.transaction(async (tx) => (await loadTransferContext(tx, data)).preview)
  })

export const transferLnkDocumentStage = createServerFn({ method: 'POST' })
  .validator(normalizeReference)
  .handler(async ({ data }) => {
    await assertSecurityScope('edit')
    const db = requireDb()
    return db.transaction(async (tx) => {
      const processSettings = await loadControlProcessSettingsFromTransaction(tx)
      if (!processSettings.preHeatTreatmentLnkEnabled) {
        throw new Error('НК до ТО выключен в настройках проекта. Перенос документов этого этапа недоступен.')
      }
      const context = await loadTransferContext(tx, data, true)
      const rowIds = context.rows.map((row) => row.id)
      assertExpectedInteractiveWeldVersions(rowIds, data.expectedVersions, context.rows)
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
        assertNoNewChronologyIssues(rowsWithDuplicates, nextRows, 'beforeHeatTreatment')
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
        }))
        assertNoNewChronologyIssues(rowsWithDuplicates, nextRows, 'primary')
        nextRows = nextRows.map(withRecalculatedFinalStatus)
        await removeSourcedSystemDocumentPositionsInTransaction({
          tx,
          sourceKind: 'beforeHeatTreatment',
          relationIds: context.controls.map((control) => control.id),
        })
        for (const idBatch of splitNumberBatches(context.controls.map((control) => control.id), 1000)) {
          await tx
            .delete(preHeatTreatmentControls)
            .where(inArray(preHeatTreatmentControls.id, idBatch))
        }
        const updatedRows = await persistPrimaryStageRows(tx, nextRows)
        nextRows = mergeAttachedRelations(updatedRows, nextRows)
        await syncSystemDocumentsForWeldChangesInTransaction(tx, nextRows, previousRows)
      }

      await assertStoredEarlyCoilDecisionSourcesRemainValid(tx, rowIds)
      await markDispatcherTaskIndexDirty(tx, {
        scopes: getDispatcherDirtyScopes(nextRows, previousRows),
      })
      return { preview: context.preview, rows: nextRows }
    })
  })

async function loadTransferContext(
  tx: SystemDocumentSequenceTransaction,
  reference: SystemDocumentReference & { documentId: number },
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
      for (const idBatch of splitNumberBatches([...relationIds].sort((left, right) => left - right), 1000)) {
        const controlsQuery = tx
          .select()
          .from(preHeatTreatmentControls)
          .where(inArray(preHeatTreatmentControls.id, idBatch))
          .orderBy(asc(preHeatTreatmentControls.id))
        controls.push(...(lock ? await controlsQuery.for('update') : await controlsQuery))
      }
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
  await assertPstoWorkflowLinesFullyAssigned(tx, storedRows)
  const rows = await attachHeatTreatmentControlRelations(storedRows as WeldRow[], tx)
  if (rows.some((row) => !isControlEnabledValue(row.pstoRequired))) {
    throw new Error('Перенос этапа доступен только для стыков на линиях с назначенным ПСТО.')
  }

  let positions: LnkStageTransferPosition[]
  if (sourceStage === 'primary') {
    const collected = collectPrimaryPositions(rows, reference)
    if (collected.unsupportedMethods.length > 0) {
      throw new Error(
        `Документ содержит методы, которые не выполняются до ТО: ${collected.unsupportedMethods.join(', ')}. Такой документ нельзя перенести целиком.`,
      )
    }
    positions = collected.positions
    const transfer = buildPrimaryToPreHeatTreatmentTransfer({ rows, positions })
    const previewControls = transfer.controls.map((control, index) => ({
      ...control,
      id: -(index + 1),
    }))
    assertNoNewChronologyIssues(
      rows,
      attachSavedControls(transfer.rows, previewControls),
      'beforeHeatTreatment',
    )
  } else {
    positions = controls.map((control) => ({
      rowId: control.weldJointId,
      methodCode: requirePreMethod(control.method),
    }))
    const transferredRows = buildPreHeatTreatmentToPrimaryTransfer({ rows, controls })
      .map((row) => ({
        ...row,
        preHeatTreatmentControls: (row.preHeatTreatmentControls ?? []).filter((control) =>
          !controls.some((moved) => moved.id === control.id),
        ),
      }))
    assertNoNewChronologyIssues(rows, transferredRows, 'primary')
  }
  if (positions.length === 0) throw new Error('В документе нет позиций, которые можно перенести между этапами.')

  const methodCodes = [...new Set(positions.map((position) => position.methodCode))]
    .sort(comparePreMethods)
  const completedResultCount = sourceStage === 'primary'
    ? positions.filter((position) => {
        const row = rows.find((candidate) => candidate.id === position.rowId)!
        const method = ALL_LNK_FIELD_METHODS.find((candidate) => candidate.code === position.methodCode)!
        return isFinalResult(row[method.resultKey])
      }).length
    : controls.filter((control) => isFinalResult(control.result)).length
  const preview: LnkDocumentStageTransferPreview = {
    documentId: reference.documentId,
    expectedVersions: rows.map((row) => ({
      id: row.id,
      version: String(row.rowVersion ?? '').trim(),
    })),
    sourceStage,
    targetStage: sourceStage === 'primary' ? 'beforeHeatTreatment' : 'primary',
    rowCount: new Set(positions.map((position) => position.rowId)).size,
    positionCount: positions.length,
    completedResultCount,
    methodCodes,
  }
  return {
    reference,
    sourceStage,
    targetStage: preview.targetStage,
    rows,
    positions,
    controls,
    preview,
  }
}

async function loadWeldRowsByIds(
  tx: SystemDocumentSequenceTransaction,
  rowIds: readonly number[],
) {
  const rows: Array<typeof weldJoints.$inferSelect & { rowVersion: string }> = []
  for (const idBatch of splitNumberBatches([...rowIds].sort((left, right) => left - right), 1000)) {
    rows.push(...await tx
      .select(WELD_TABLE_RETURNING)
      .from(weldJoints)
      .where(inArray(weldJoints.id, idBatch))
      .orderBy(asc(weldJoints.id)))
  }
  return rows
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
  const unsupportedMethods = new Set<string>()
  for (const row of rows) {
    for (const method of ALL_LNK_FIELD_METHODS) {
      const matches = reference.type === 'lnkRequest'
        ? text(row[method.requestKey]) === reference.title && text(row[method.requestDateKey]) === reference.date
        : reference.type === 'lnkConclusion' &&
          method.code === reference.methodCode &&
          text(row[method.conclusionKey]) === reference.title &&
          text(row[method.conclusionDateKey]) === reference.date
      if (!matches) continue
      if (!isPreHeatTreatmentLnkMethodCode(method.code)) {
        unsupportedMethods.add(method.code)
        continue
      }
      positions.push({ rowId: row.id, methodCode: method.code })
    }
  }
  return {
    positions: uniquePositions(positions),
    unsupportedMethods: [...unsupportedMethods].sort((left, right) => left.localeCompare(right, 'ru')),
  }
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
) {
  const issue = findBlockingLnkStageTransferChronologyIssue({
    previousRows,
    nextRows,
    targetStage,
  })
  if (issue) throw new Error(`Перенос этапа невозможен: ${issue.message}`)
}

function normalizeReference(value: LnkDocumentStageTransferRequest) {
  const documentId = Math.floor(Number(value?.documentId))
  const type = value?.type
  const title = text(value?.title)
  const date = text(value?.date).slice(0, 10)
  const methodCode = text(value?.methodCode).toLocaleUpperCase('ru-RU')
  const sourceKind = value?.sourceKind
  if (documentId <= 0 || (type !== 'lnkRequest' && type !== 'lnkConclusion') || !title) {
    throw new Error('Некорректный системный документ ЛНК.')
  }
  if (sourceKind && sourceKind !== 'beforeHeatTreatment') {
    throw new Error('Этот документ не относится к этапам ЛНК.')
  }
  return {
    documentId,
    type,
    title,
    date,
    ...(methodCode ? { methodCode } : {}),
    ...(sourceKind ? { sourceKind } : {}),
    expectedVersions: (Array.isArray(value?.expectedVersions) ? value.expectedVersions : []).map((entry) => ({
      id: Number(entry?.id),
      version: String(entry?.version ?? '').trim(),
    })),
  } as SystemDocumentReference & {
    documentId: number
    expectedVersions: WeldRowVersionTarget[]
  }
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

function isFinalResult(value: unknown) {
  const result = text(value).toLocaleLowerCase('ru-RU')
  return result === 'годен' || result === 'ремонт' || result === 'вырез'
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
