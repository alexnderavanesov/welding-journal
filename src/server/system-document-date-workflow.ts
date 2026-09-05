import { createServerFn } from '@tanstack/react-start'
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm'

import { requireDb } from '@/db'
import {
  generatedDocuments,
  generatedDocumentWeldJoints,
  preHeatTreatmentControls,
  pstoRepeatCycles,
  weldJoints,
} from '@/db/schema'
import { assertNoNewLnkChronologyIssues } from '@/lib/lnk-chronology-checks'
import { assertNoNewPstoChronologyIssues } from '@/lib/psto-chronology-checks'
import {
  buildSystemDocumentDateChangePlan,
  type SystemDocumentDateChangePlan,
} from '@/lib/system-document-date-change'
import {
  isSystemDocumentSourceKind,
  isSystemDocumentType,
  type SystemDocumentReference,
  type SystemDocumentSourcePosition,
} from '@/lib/system-document-types'
import { getSystemDocumentTemplateId } from '@/lib/system-document-template-types'
import type { SystemDocumentDateChangeData } from '@/server/weld-contracts'
import { loadControlProcessSettingsFromTransaction } from '@/server/control-process-settings'
import {
  getDispatcherDirtyScopes,
  markDispatcherTaskIndexDirty,
} from '@/server/dispatcher-task-index-dirty'
import { attachDuplicateControlRelations } from '@/server/duplicate-control-relations'
import { assertStoredEarlyCoilDecisionSourcesRemainValid } from '@/server/early-coil-decision-guard'
import { attachHeatTreatmentControlRelations } from '@/server/heat-treatment-control-relations'
import { updatePstoRepeatCycleRecords } from '@/server/psto-cycle-state'
import { assertSecurityScope } from '@/server/security-functions'
import {
  matchesSourcedSystemDocumentReference,
  parseSystemDocumentMetadata,
  systemDocumentStorageType,
} from '@/server/system-document-index'
import {
  readRequestConclusionSettings,
  type SystemDocumentSequenceTransaction,
} from '@/server/system-document-sequences'
import { updateWeldJointsInBatches } from '@/server/weld-persistence'
import { WELD_TABLE_RETURNING } from '@/server/weld-server-shared'
import {
  assertExpectedInteractiveWeldVersions,
  lockInteractiveWeldRows,
} from '@/server/weld-row-version'
import { splitNumberBatches } from '@/server/weld-request-utils'
import { loadWeldWorkflowSettingsFromTransaction } from '@/server/weld-workflow-settings'
import type { WeldRow } from '@/lib/dispatcher-types'

export type SystemDocumentDateChangeResult = Pick<
  SystemDocumentDateChangePlan,
  | 'nextReference'
  | 'previousTitle'
  | 'nextTitle'
  | 'previousDate'
  | 'nextDate'
  | 'isSystemName'
  | 'rowCount'
  | 'positionCount'
> & {
  rows: WeldRow[]
}

export const changeSystemDocumentDate = createServerFn({ method: 'POST' })
  .validator(normalizeSystemDocumentDateChangeData)
  .handler(async ({ data }) => {
    await assertSecurityScope('edit')
    const db = requireDb()
    return db.transaction(async (tx) => {
      await loadControlProcessSettingsFromTransaction(tx)
      const workflowSettings = await loadWeldWorkflowSettingsFromTransaction(tx)
      const requestConclusionSettings = await readRequestConclusionSettings(tx)
      const document = await lockSystemDocument(tx, data.reference)
      const metadata = parseSystemDocumentMetadata(document.sourceMetadata)
      const assignments = await tx
        .select({ weldJointId: generatedDocumentWeldJoints.weldJointId })
        .from(generatedDocumentWeldJoints)
        .where(eq(generatedDocumentWeldJoints.documentId, document.id))
        .orderBy(asc(generatedDocumentWeldJoints.weldJointId))
        .for('update')
      const rowIds = [...new Set(assignments.map((assignment) => assignment.weldJointId))]
      if (rowIds.length === 0) throw new Error('В документе больше нет позиций. Обновите данные.')

      const storedRows = await lockInteractiveWeldRows(tx, rowIds)
      if (storedRows.length !== rowIds.length) {
        throw new Error('Один или несколько стыков документа больше не существуют. Ничего не сохранено.')
      }
      assertExpectedInteractiveWeldVersions(rowIds, data.expectedVersions, storedRows)
      await lockSourceRelations(tx, metadata?.sourcePositions ?? [])

      const currentRows = await attachDuplicateControlRelations(
        await attachHeatTreatmentControlRelations(storedRows as WeldRow[], tx),
        tx,
      )
      const plan = buildSystemDocumentDateChangePlan({
        reference: toStoredReference(data.reference, document.id),
        nextDate: data.nextDate,
        rows: currentRows,
        sourcePositions: metadata?.sourcePositions ?? [],
        settings: requestConclusionSettings,
      })
      assertSystemDocumentDatePlanCoversAssignments(rowIds, plan.touchedRowIds)
      assertNoNewLnkChronologyIssues(
        plan.rows,
        currentRows,
        workflowSettings.saveCheckSettings,
      )
      assertNoNewPstoChronologyIssues(
        plan.rows,
        currentRows,
        workflowSettings.saveCheckSettings,
      )

      await assertNoDocumentIdentityConflict(tx, document.id, document.type, plan.nextReference)
      await persistDateChangePlan(tx, plan, storedRows)
      await tx
        .update(generatedDocuments)
        .set({
          title: plan.nextTitle,
          fileName: `${sanitizeFileName(plan.nextTitle)}.xlsx`,
          periodFrom: plan.nextDate,
          periodTo: plan.nextDate,
          updatedAt: new Date(),
        })
        .where(eq(generatedDocuments.id, document.id))

      await assertStoredEarlyCoilDecisionSourcesRemainValid(tx, plan.touchedRowIds)
      const touchedRowIds = new Set(plan.touchedRowIds)
      await markDispatcherTaskIndexDirty(tx, {
        scopes: getDispatcherDirtyScopes(
          plan.rows.filter((row) => touchedRowIds.has(row.id)),
          new Map(storedRows.map((row) => [row.id, row])),
        ),
      })
      const savedRows = await loadSavedRows(tx, plan.touchedRowIds)
      return {
        nextReference: plan.nextReference,
        previousTitle: plan.previousTitle,
        nextTitle: plan.nextTitle,
        previousDate: plan.previousDate,
        nextDate: plan.nextDate,
        isSystemName: plan.isSystemName,
        rowCount: plan.rowCount,
        positionCount: plan.positionCount,
        rows: savedRows,
      } satisfies SystemDocumentDateChangeResult
    })
  })

export function normalizeSystemDocumentDateChangeData(
  value: SystemDocumentDateChangeData,
): SystemDocumentDateChangeData {
  const reference = normalizeReference(value?.reference)
  const nextDate = String(value?.nextDate ?? '').trim().slice(0, 10)
  const expectedVersions = (Array.isArray(value?.expectedVersions) ? value.expectedVersions : [])
    .map((entry) => ({
      id: Math.floor(Number(entry?.id)),
      version: String(entry?.version ?? '').trim(),
    }))
    .filter((entry) => entry.id > 0)
  return { reference, nextDate, expectedVersions }
}

function normalizeReference(value: SystemDocumentReference | undefined): SystemDocumentReference {
  if (!value || !isSystemDocumentType(value.type)) throw new Error('Не указан тип документа')
  const title = String(value.title ?? '').trim()
  const date = String(value.date ?? '').trim().slice(0, 10)
  if (!title) throw new Error('Не указано текущее наименование документа')
  const sourceKind = isSystemDocumentSourceKind(value.sourceKind) ? value.sourceKind : undefined
  const documentId = Math.floor(Number(value.documentId))
  return {
    ...(documentId > 0 ? { documentId } : {}),
    type: value.type,
    title,
    date,
    ...(value.methodCode ? { methodCode: String(value.methodCode).trim() } : {}),
    ...(sourceKind ? { sourceKind } : {}),
    ...(value.cycleSequences?.length
      ? {
          cycleSequences: [...new Set(value.cycleSequences
            .map((sequence) => Math.floor(Number(sequence)))
            .filter((sequence) => sequence > 0))].sort((left, right) => left - right),
        }
      : {}),
  }
}

async function lockSystemDocument(
  tx: SystemDocumentSequenceTransaction,
  reference: SystemDocumentReference,
) {
  const storageType = systemDocumentStorageType(getSystemDocumentTemplateId(reference))
  const candidates = reference.documentId
    ? await tx
        .select()
        .from(generatedDocuments)
        .where(and(
          eq(generatedDocuments.id, reference.documentId),
          eq(generatedDocuments.type, storageType),
        ))
        .limit(1)
        .for('update')
    : await tx
        .select()
        .from(generatedDocuments)
        .where(and(
          eq(generatedDocuments.type, storageType),
          eq(generatedDocuments.title, reference.title),
          sql`coalesce(${generatedDocuments.periodFrom}::text, '') = ${reference.date}`,
        ))
        .orderBy(asc(generatedDocuments.id))
        .for('update')
  const document = candidates.find((candidate) => {
    if (candidate.title !== reference.title || (candidate.periodFrom ?? '') !== reference.date) return false
    const metadata = parseSystemDocumentMetadata(candidate.sourceMetadata)
    return reference.sourceKind
      ? matchesSourcedSystemDocumentReference(candidate.sourceMetadata, reference)
      : !metadata?.sourceKind
  })
  if (!document) {
    throw new Error('Документ уже изменился или больше не существует. Обновите данные. Ничего не сохранено.')
  }
  return document
}

async function lockSourceRelations(
  tx: SystemDocumentSequenceTransaction,
  positions: readonly SystemDocumentSourcePosition[],
) {
  const preIds = [...new Set(positions
    .filter((position) => position.kind === 'beforeHeatTreatment')
    .map((position) => position.relationId))]
  for (const batch of splitNumberBatches(preIds.sort((left, right) => left - right), 1000)) {
    await tx
      .select({ id: preHeatTreatmentControls.id })
      .from(preHeatTreatmentControls)
      .where(inArray(preHeatTreatmentControls.id, batch))
      .orderBy(asc(preHeatTreatmentControls.id))
      .for('update')
  }
  const repeatIds = [...new Set(positions
    .filter((position) => (position.sequence ?? 1) > 1)
    .map((position) => position.relationId))]
  for (const batch of splitNumberBatches(repeatIds.sort((left, right) => left - right), 1000)) {
    await tx
      .select({ id: pstoRepeatCycles.id })
      .from(pstoRepeatCycles)
      .where(inArray(pstoRepeatCycles.id, batch))
      .orderBy(asc(pstoRepeatCycles.id))
      .for('update')
  }
}

async function assertNoDocumentIdentityConflict(
  tx: SystemDocumentSequenceTransaction,
  documentId: number,
  storageType: string,
  nextReference: SystemDocumentReference,
) {
  const conflicts = await tx
    .select({
      id: generatedDocuments.id,
      sourceMetadata: generatedDocuments.sourceMetadata,
    })
    .from(generatedDocuments)
    .where(and(
      eq(generatedDocuments.type, storageType),
      eq(generatedDocuments.title, nextReference.title),
      sql`coalesce(${generatedDocuments.periodFrom}::text, '') = ${nextReference.date}`,
      ne(generatedDocuments.id, documentId),
    ))
    .for('update')
  if (conflicts.some((conflict) => isSystemDocumentDateIdentityConflict(
    conflict.sourceMetadata,
    nextReference,
  ))) {
    throw new Error('Документ с новым сочетанием наименования и даты уже существует. Ничего не сохранено.')
  }
}

export function isSystemDocumentDateIdentityConflict(
  sourceMetadata: unknown,
  reference: SystemDocumentReference,
) {
  const metadata = parseSystemDocumentMetadata(sourceMetadata)
  const storedScope = getSystemDocumentDateIdentityScope(metadata ?? {})
  const targetScope = getSystemDocumentDateIdentityScope(reference)
  return storedScope === undefined || storedScope === targetScope
}

export function assertSystemDocumentDatePlanCoversAssignments(
  assignedRowIds: readonly number[],
  touchedRowIds: readonly number[],
) {
  const assigned = new Set(assignedRowIds)
  const touched = new Set(touchedRowIds)
  if (assigned.size !== touched.size || [...assigned].some((rowId) => !touched.has(rowId))) {
    throw new Error(
      'Состав или реквизиты документа уже изменились. Обновите данные и повторите действие. Ничего не сохранено.',
    )
  }
}

function getSystemDocumentDateIdentityScope(
  reference: Partial<Pick<
    SystemDocumentReference,
    'methodCode' | 'sourceKind' | 'cycleSequences'
  >>,
) {
  const parts = [
    reference.methodCode,
    reference.sourceKind,
    ...(reference.sourceKind === 'pstoCycle'
      ? []
      : reference.cycleSequences?.map((sequence) => `cycle-${sequence}`) ?? []),
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(':') : undefined
}

async function persistDateChangePlan(
  tx: SystemDocumentSequenceTransaction,
  plan: SystemDocumentDateChangePlan,
  storedRows: Array<typeof weldJoints.$inferSelect>,
) {
  const previousRows = new Map(storedRows.map((row) => [row.id, row]))
  const directIds = new Set(plan.directRowIds)
  const directRows = plan.rows.filter((row) => directIds.has(row.id))
  await updateWeldJointsInBatches(tx, directRows, previousRows)

  for (const batch of splitRelationBatches(plan.preHeatTreatmentControls)) {
    const ids = batch.map((control) => control.id)
    const values = plan.nextReference.type === 'lnkRequest'
      ? { requestName: plan.nextTitle, requestDate: plan.nextDate, updatedAt: new Date() }
      : { conclusionName: plan.nextTitle, conclusionDate: plan.nextDate, updatedAt: new Date() }
    await tx.update(preHeatTreatmentControls).set(values).where(inArray(preHeatTreatmentControls.id, ids))
  }

  await updatePstoRepeatCycleRecords(tx, plan.pstoRepeatCycles)

  const childOnlyIds = plan.touchedRowIds.filter((rowId) => !directIds.has(rowId))
  const isPstoProfile = plan.nextReference.sourceKind === 'pstoCycle' ||
    plan.nextReference.sourceKind === 'pstoRepeat' ||
    plan.nextReference.type === 'pstoRequest' ||
    plan.nextReference.type === 'pstoConclusion'
  for (const batch of splitNumberBatches(childOnlyIds, 1000)) {
    const now = new Date()
    await tx
      .update(weldJoints)
      .set(isPstoProfile
        ? { pstoUpdatedAt: now, updatedAt: now }
        : { lnkUpdatedAt: now, updatedAt: now })
      .where(inArray(weldJoints.id, batch))
  }
}

async function loadSavedRows(
  tx: SystemDocumentSequenceTransaction,
  rowIds: number[],
) {
  const rows: Array<typeof weldJoints.$inferSelect> = []
  for (const batch of splitNumberBatches(rowIds, 1000)) {
    rows.push(...await tx
      .select(WELD_TABLE_RETURNING)
      .from(weldJoints)
      .where(inArray(weldJoints.id, batch))
      .orderBy(asc(weldJoints.id)))
  }
  return attachDuplicateControlRelations(
    await attachHeatTreatmentControlRelations(rows as WeldRow[], tx),
    tx,
  )
}

function toStoredReference(reference: SystemDocumentReference, documentId: number) {
  return { ...reference, documentId }
}

function splitRelationBatches<T>(relations: T[]) {
  return Array.from(
    { length: Math.ceil(relations.length / 1000) },
    (_, index) => relations.slice(index * 1000, (index + 1) * 1000),
  )
}

function sanitizeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim() || 'Документ'
}
