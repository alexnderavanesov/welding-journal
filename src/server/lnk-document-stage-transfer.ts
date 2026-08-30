import { createServerFn } from '@tanstack/react-start'
import { eq, inArray } from 'drizzle-orm'

import { requireDb } from '@/db'
import {
  duplicateControls,
  generatedDocuments,
  generatedDocumentWeldJoints,
  preHeatTreatmentControls,
  weldJoints,
} from '@/db/schema'
import { isControlEnabledValue } from '@/lib/control-availability-values'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { DuplicateControlRecord } from '@/lib/duplicate-control-types'
import { getDispatcherLnkChronologyIssues } from '@/lib/lnk-chronology-checks'
import {
  isPreHeatTreatmentLnkMethodCode,
  type PreHeatTreatmentControlRecord,
  type PreHeatTreatmentLnkMethodCode,
} from '@/lib/lnk-control-stage'
import {
  buildPreHeatTreatmentToPrimaryTransfer,
  buildPrimaryToPreHeatTreatmentTransfer,
  type LnkDocumentStageTransferPreview,
  type LnkStageTransferPosition,
} from '@/lib/lnk-stage-transfer'
import { ALL_LNK_FIELD_METHODS } from '@/lib/lnk-report-config'
import {
  type SystemDocumentReference,
  type SystemDocumentSourceKind,
} from '@/lib/system-document-types'
import { getSystemDocumentTemplateId } from '@/lib/system-document-template-types'
import { calculateFinalStatus } from '@/lib/weld-status'
import { markDispatcherTaskIndexDirty } from '@/server/dispatcher-task-index-dirty'
import { attachHeatTreatmentControlRelations } from '@/server/heat-treatment-control-relations'
import { syncPreHeatTreatmentDocumentsInTransaction } from '@/server/pre-heat-treatment-system-documents'
import { assertPstoWorkflowLinesFullyAssigned } from '@/server/psto-workflow-line-guard'
import { assertSecurityScope } from '@/server/security-functions'
import {
  loadSourcedSystemDocumentPositionsInTransaction,
  removeSourcedSystemDocumentPositionsInTransaction,
  systemDocumentStorageType,
  syncSystemDocumentsForWeldChangesInTransaction,
} from '@/server/system-document-index'
import type { SystemDocumentSequenceTransaction } from '@/server/system-document-sequences'

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
      const context = await loadTransferContext(tx, data, true)
      const rowIds = context.rows.map((row) => row.id)
      const duplicateRecords = rowIds.length > 0
        ? await tx
            .select()
            .from(duplicateControls)
            .where(inArray(duplicateControls.weldJointId, rowIds))
        : []
      const duplicatesByRowId = groupByRowId(duplicateRecords)
      const rowsWithDuplicates = context.rows.map((row) => ({
        ...row,
        duplicateControls: (duplicatesByRowId.get(row.id) ?? []) as unknown as DuplicateControlRecord[],
      })) as WeldRow[]
      const previousRows = new Map(rowsWithDuplicates.map((row) => [row.id, row]))
      let nextRows: WeldRow[]

      if (context.sourceStage === 'primary') {
        const transfer = buildPrimaryToPreHeatTreatmentTransfer({
          rows: rowsWithDuplicates,
          positions: context.positions,
        })
        const savedControls = await tx
          .insert(preHeatTreatmentControls)
          .values(transfer.controls)
          .returning()
        nextRows = attachSavedControls(transfer.rows, savedControls)
        assertNoNewChronologyIssues(rowsWithDuplicates, nextRows)
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
        assertNoNewChronologyIssues(rowsWithDuplicates, nextRows)
        nextRows = nextRows.map(withRecalculatedFinalStatus)
        await removeSourcedSystemDocumentPositionsInTransaction({
          tx,
          sourceKind: 'beforeHeatTreatment',
          relationIds: context.controls.map((control) => control.id),
        })
        await tx
          .delete(preHeatTreatmentControls)
          .where(inArray(preHeatTreatmentControls.id, context.controls.map((control) => control.id)))
        const updatedRows = await persistPrimaryStageRows(tx, nextRows)
        nextRows = mergeAttachedRelations(updatedRows, nextRows)
        await syncSystemDocumentsForWeldChangesInTransaction(tx, nextRows, previousRows)
      }

      await markDispatcherTaskIndexDirty(tx)
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
  let rowsQuery = tx.select().from(weldJoints).where(inArray(weldJoints.id, rowIds))
  const storedRows = lock ? await rowsQuery.for('update') : await rowsQuery
  if (storedRows.length !== rowIds.length) {
    throw new Error('Часть стыков документа больше не существует. Обновите раздел «Документы».')
  }
  if (lock) {
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
      .for('update')
    const lockedRowIds = [...new Set(lockedAssignments.map((assignment) => assignment.weldJointId))]
    if (lockedSourceStage !== sourceStage || !haveSameIds(rowIds, lockedRowIds)) {
      throw new Error('Состав или этап системного документа уже изменился. Обновите раздел «Документы».')
    }
  }
  await assertPstoWorkflowLinesFullyAssigned(tx, storedRows)
  const rows = await attachHeatTreatmentControlRelations(storedRows as WeldRow[], tx)
  if (rows.some((row) => !isControlEnabledValue(row.pstoRequired))) {
    throw new Error('Перенос этапа доступен только для стыков на линиях с назначенным ПСТО.')
  }

  let positions: LnkStageTransferPosition[]
  let controls: PreHeatTreatmentControlRecord[] = []
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
    assertNoNewChronologyIssues(rows, attachSavedControls(transfer.rows, previewControls))
  } else {
    const sourcePositions = await loadSourcedSystemDocumentPositionsInTransaction({
      tx,
      documentId: reference.documentId,
      sourceKind: 'beforeHeatTreatment',
    })
    const relationIds = [...new Set(sourcePositions.map((position) => position.relationId))]
    if (relationIds.length > 0) {
      const controlsQuery = tx
        .select()
        .from(preHeatTreatmentControls)
        .where(inArray(preHeatTreatmentControls.id, relationIds))
      controls = lock ? await controlsQuery.for('update') : await controlsQuery
    }
    if (controls.length !== relationIds.length) {
      throw new Error('Часть позиций НК до ТО уже изменена. Обновите раздел «Документы».')
    }
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
    assertNoNewChronologyIssues(rows, transferredRows)
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

async function persistPrimaryStageRows(
  tx: SystemDocumentSequenceTransaction,
  rows: WeldRow[],
) {
  const now = new Date()
  const updatedRows = []
  for (const row of rows) {
    const [updated] = await tx
      .update(weldJoints)
      .set({
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
        finalStatus: textOrNull(row.finalStatus),
        lnkUpdatedAt: now,
        updatedAt: now,
      })
      .where(eq(weldJoints.id, row.id))
      .returning()
    if (!updated) throw new Error(`Стык #${row.id} уже изменен. Обновите отчет.`)
    updatedRows.push(updated)
  }
  return updatedRows as WeldRow[]
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

function assertNoNewChronologyIssues(previousRows: WeldRow[], nextRows: WeldRow[]) {
  const previousKeys = new Set(getDispatcherLnkChronologyIssues(previousRows).map(issueKey))
  const issue = getDispatcherLnkChronologyIssues(nextRows).find((candidate) =>
    !previousKeys.has(issueKey(candidate)),
  )
  if (issue) throw new Error(`Перенос этапа невозможен: ${issue.message}`)
}

function issueKey(issue: ReturnType<typeof getDispatcherLnkChronologyIssues>[number]) {
  return [issue.row.id ?? '', issue.kind, issue.methodCode, issue.reason].join(':')
}

function normalizeReference(value: SystemDocumentReference) {
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
  } as SystemDocumentReference & { documentId: number }
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
