import { and, asc, eq, inArray, notInArray, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm'

import { requireDb } from '@/db'
import {
  appSettings,
  generatedDocuments,
  generatedDocumentWeldJoints,
  preHeatTreatmentControls,
  pstoRepeatCycles,
  weldJoints,
} from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import { ALL_LNK_FIELD_METHODS as LNK_METHODS } from '@/lib/lnk-report-config'
import { matchSystemDocumentIdentityIds } from '@/lib/system-document-identity'
import { filterLegacyCycleSummariesShadowedBySourcedDocuments } from '@/lib/system-document-index-sync'
import { buildSourcedSystemDocumentMetadataSummary } from '@/lib/system-document-source-metadata'
import {
  buildSystemDocumentSummaries,
  type SystemDocumentReference,
  type SystemDocumentSourceKind,
  type SystemDocumentSourcePosition,
  type SystemDocumentSummary,
  type SystemDocumentType,
} from '@/lib/system-document-types'
import {
  SYSTEM_DOCUMENT_TEMPLATE_PROFILES,
  getSystemDocumentTemplateId,
} from '@/lib/system-document-template-types'
import {
  buildPreHeatTreatmentSystemDocumentRow,
  buildPrimaryPstoSystemDocumentRow,
  buildPstoRepeatSystemDocumentRow,
} from '@/lib/system-document-virtual-row'
import {
  buildDocumentHistorySqlQuery,
  normalizeSqlDocumentHistoryResult,
  type SqlDocumentHistoryResult,
} from '@/server/document-history-sql'
import type { SystemDocumentSequenceTransaction } from '@/server/system-document-sequences'

const BASE_HISTORY_SELECT = {
  id: weldJoints.id,
  weldDate: weldJoints.weldDate,
  projectTitle: weldJoints.projectTitle,
  subtitleCode: weldJoints.subtitleCode,
  line: weldJoints.line,
  updatedAt: weldJoints.updatedAt,
}

const SYSTEM_DOCUMENT_INDEX_VERSION = '4'

const LNK_REQUEST_HISTORY_SELECT = {
  ...BASE_HISTORY_SELECT,
  ...Object.fromEntries(
    LNK_METHODS.flatMap((method) => [
      [method.requestKey, weldJoints[method.requestKey]],
      [method.requestDateKey, weldJoints[method.requestDateKey]],
    ]),
  ),
}

const LNK_CONCLUSION_HISTORY_SELECT = {
  ...BASE_HISTORY_SELECT,
  ...Object.fromEntries(
    LNK_METHODS.flatMap((method) => [
      [method.conclusionKey, weldJoints[method.conclusionKey]],
      [method.conclusionDateKey, weldJoints[method.conclusionDateKey]],
    ]),
  ),
}

const PSTO_REQUEST_HISTORY_SELECT = {
  ...BASE_HISTORY_SELECT,
  pstoRequest: weldJoints.pstoRequest,
  pstoRequestDate: weldJoints.pstoRequestDate,
}

const PSTO_CONCLUSION_HISTORY_SELECT = {
  ...BASE_HISTORY_SELECT,
  heatTreatmentDiagram: weldJoints.heatTreatmentDiagram,
  pstoDate: weldJoints.pstoDate,
}

export async function loadSystemDocumentSummaries(type: SystemDocumentType) {
  const db = requireDb()
  return db.transaction(async (tx) => {
    await lockSystemDocumentIndex(tx, type)
    await ensureSystemDocumentIndexInitializedInTransaction(tx, type)
    return loadIndexedSystemDocumentSummaries(tx, type)
  })
}

const SYSTEM_DOCUMENT_HISTORY_FILTER_KEYS = [
  'title',
  'method',
  'stage',
  'project',
  'subtitle',
  'line',
  'rowCount',
  'date',
]

export async function loadIndexedSystemDocumentHistory({
  type,
  limit,
  columnFilters,
}: {
  type: SystemDocumentType
  limit: number
  columnFilters: Record<string, string>
}): Promise<SqlDocumentHistoryResult<SystemDocumentSummary>> {
  const db = requireDb()
  return db.transaction(async (tx) => {
    await lockSystemDocumentIndex(tx, type)
    await ensureSystemDocumentIndexInitializedInTransaction(tx, type)
    const storageTypes = SYSTEM_DOCUMENT_TEMPLATE_PROFILES
      .filter((profile) => profile.documentType === type)
      .map((profile) => systemDocumentStorageType(profile.id))
    if (storageTypes.length === 0) {
      return {
        documents: [],
        total: 0,
        filterOptions: Object.fromEntries(
          SYSTEM_DOCUMENT_HISTORY_FILTER_KEYS.map((key) => [key, []]),
        ),
      }
    }

    const baseQuery = buildIndexedSystemDocumentHistoryBaseQuery(type, storageTypes)
    const queryResult = await tx.execute(buildDocumentHistorySqlQuery({
      baseQuery,
      columnFilters,
      filterKeys: SYSTEM_DOCUMENT_HISTORY_FILTER_KEYS,
      limit,
      orderBy: sql`"date" desc, "title" desc, "documentId" desc`,
    }))
    const history = normalizeSqlDocumentHistoryResult(
      queryResult.rows[0],
      SYSTEM_DOCUMENT_HISTORY_FILTER_KEYS,
      (record) => toIndexedSystemDocumentHistorySummary(record, type),
    )
    const documentIds = history.documents.map((document) => document.documentId)
    const assignments = documentIds.length > 0
      ? await tx
          .select({
            documentId: generatedDocumentWeldJoints.documentId,
            weldJointId: generatedDocumentWeldJoints.weldJointId,
          })
          .from(generatedDocumentWeldJoints)
          .where(inArray(generatedDocumentWeldJoints.documentId, documentIds))
      : []
    const rowIdsByDocument = new Map<number, number[]>()
    for (const assignment of assignments) {
      const ids = rowIdsByDocument.get(assignment.documentId) ?? []
      ids.push(assignment.weldJointId)
      rowIdsByDocument.set(assignment.documentId, ids)
    }

    return {
      ...history,
      documents: history.documents.map((document) => {
        const rowIds = (rowIdsByDocument.get(document.documentId) ?? [])
          .sort((left, right) => left - right)
        return {
          ...document,
          rowCount: rowIds.length,
          rowIds,
        }
      }),
    }
  })
}

export async function loadSystemDocumentRows(data: SystemDocumentReference): Promise<WeldRow[]> {
  const db = requireDb()
  const expectedStorageType = systemDocumentStorageType(getSystemDocumentTemplateId(data))
  let sourceMetadata: unknown = null
  const sourcedDocumentId = !data.documentId && data.sourceKind
    ? await findSourcedSystemDocumentId(db, data, expectedStorageType)
    : undefined
  const documentId = data.documentId ?? sourcedDocumentId
  if (data.sourceKind && !documentId && data.sourceKind !== 'pstoCycle') return []
  const rows = documentId
    ? await db
        .select({ weld: weldJoints, sourceMetadata: generatedDocuments.sourceMetadata })
        .from(generatedDocumentWeldJoints)
        .innerJoin(
          generatedDocuments,
          and(
            eq(generatedDocuments.id, generatedDocumentWeldJoints.documentId),
            eq(generatedDocuments.type, expectedStorageType),
          ),
        )
        .innerJoin(weldJoints, eq(weldJoints.id, generatedDocumentWeldJoints.weldJointId))
        .where(eq(generatedDocumentWeldJoints.documentId, documentId))
        .orderBy(
          asc(weldJoints.projectTitle),
          asc(weldJoints.subtitleCode),
          asc(weldJoints.line),
          asc(weldJoints.joint),
        )
        .then((records) => {
          sourceMetadata = records[0]?.sourceMetadata ?? null
          return records.map((record) => record.weld)
        })
    : await db
        .select()
        .from(weldJoints)
        .where(buildSystemDocumentWhere(data))
        .orderBy(
          asc(weldJoints.projectTitle),
          asc(weldJoints.subtitleCode),
          asc(weldJoints.line),
          asc(weldJoints.joint),
        )

  const metadata = parseSystemDocumentMetadata(sourceMetadata)
  const hydratedRows = metadata?.sourceKind
    ? await overlaySourcedSystemDocumentRows(rows, metadata)
    : rows
  return hydratedRows.map(compactSystemDocumentRow)
}

async function findSourcedSystemDocumentId(
  db: ReturnType<typeof requireDb>,
  reference: SystemDocumentReference,
  storageType: string,
) {
  const candidates = await db
    .select({ id: generatedDocuments.id, sourceMetadata: generatedDocuments.sourceMetadata })
    .from(generatedDocuments)
    .where(and(
      eq(generatedDocuments.type, storageType),
      eq(generatedDocuments.title, reference.title),
      sql`coalesce(${generatedDocuments.periodFrom}::text, '') = ${reference.date}`,
    ))
  const exact = candidates.find((candidate) => {
    const metadata = parseSystemDocumentMetadata(candidate.sourceMetadata)
    return metadata?.sourceKind === reference.sourceKind &&
      matchesSourcedSystemDocumentReference(candidate.sourceMetadata, reference)
  })
  return exact?.id ?? candidates.find((candidate) => (
    matchesSourcedSystemDocumentReference(candidate.sourceMetadata, reference)
  ))?.id
}

export function matchesSourcedSystemDocumentReference(
  sourceMetadata: unknown,
  reference: Pick<SystemDocumentReference, 'methodCode' | 'sourceKind' | 'cycleSequences'>,
) {
  const metadata = parseSystemDocumentMetadata(sourceMetadata)
  const sourceKindMatches = metadata?.sourceKind === reference.sourceKind || (
    reference.sourceKind === 'pstoCycle' && metadata?.sourceKind === 'pstoRepeat'
  )
  const cyclesMatch = reference.sourceKind === 'pstoCycle'
    ? includesCycleSequences(metadata?.cycleSequences, reference.cycleSequences)
    : sameCycleSequences(metadata?.cycleSequences, reference.cycleSequences)
  return (
    sourceKindMatches &&
    String(metadata?.methodCode ?? '') === String(reference.methodCode ?? '') &&
    cyclesMatch
  )
}

export async function upsertSourcedSystemDocumentInTransaction({
  tx,
  summary,
  sourcePositions,
}: {
  tx: SystemDocumentSequenceTransaction
  summary: SystemDocumentSummary & { sourceKind: SystemDocumentSourceKind }
  sourcePositions: SystemDocumentSourcePosition[]
}) {
  const storageType = systemDocumentStorageType(getSystemDocumentTemplateId(summary))
  const candidates = await tx
    .select()
    .from(generatedDocuments)
    .where(and(
      eq(generatedDocuments.type, storageType),
      eq(generatedDocuments.title, summary.title),
      sql`coalesce(${generatedDocuments.periodFrom}::text, '') = ${summary.date}`,
    ))
  const sourcedExisting = candidates.find((document) => {
    const metadata = parseSystemDocumentMetadata(document.sourceMetadata)
    return (
      metadata?.sourceKind === summary.sourceKind &&
      String(metadata.methodCode ?? '') === String(summary.methodCode ?? '') &&
      (summary.sourceKind === 'pstoCycle' || sameCycleSequences(metadata.cycleSequences, summary.cycleSequences))
    )
  })
  const legacyPrimaryDocuments = summary.sourceKind === 'pstoCycle' &&
    (summary.cycleSequences ?? []).includes(1)
    ? candidates.filter((document) => isCompatibleLegacyPrimaryDocument(document, summary))
    : []
  const existing = sourcedExisting ?? legacyPrimaryDocuments[0]
  const mergedDocuments = [
    ...(sourcedExisting ? [sourcedExisting] : []),
    ...legacyPrimaryDocuments.filter((document) => document.id !== sourcedExisting?.id),
  ]
  const existingMetadata = parseSystemDocumentMetadata(existing?.sourceMetadata)
  const existingAssignments = mergedDocuments.length > 0
    ? await tx
        .select({
          documentId: generatedDocumentWeldJoints.documentId,
          weldJointId: generatedDocumentWeldJoints.weldJointId,
        })
        .from(generatedDocumentWeldJoints)
        .where(inArray(generatedDocumentWeldJoints.documentId, mergedDocuments.map((document) => document.id)))
    : []
  const rowIds = [...new Set([
    ...existingAssignments.map((assignment) => assignment.weldJointId),
    ...summary.rowIds,
  ])].sort((left, right) => left - right)
  const mergedSourcePositions = normalizeSystemDocumentSourcePositions([
    ...(existingMetadata?.sourcePositions ?? []),
    ...legacyPrimaryDocuments.flatMap((document) => {
      const metadata = parseSystemDocumentMetadata(document.sourceMetadata)
      const methodCode = summary.methodCode === 'ТВМТ' ? 'ТВМТ' : undefined
      return existingAssignments
        .filter((assignment) => assignment.documentId === document.id)
        .map((assignment) => ({
          kind: 'pstoCycle' as const,
          weldJointId: assignment.weldJointId,
          relationId: assignment.weldJointId,
          sequence: 1,
          ...(methodCode ? { methodCode } : {}),
        }))
    }),
    ...sourcePositions,
  ])
  const mergedSummary: SystemDocumentSummary & { sourceKind: SystemDocumentSourceKind } = {
    ...summary,
    sourceKind: summary.sourceKind,
    rowIds,
    rowCount: rowIds.length,
    positionCount: mergedSourcePositions.length,
    cycleSequences: normalizeCycleSequences(mergedSourcePositions.map((position) => position.sequence)),
    methodCodes: mergeStringArrays(existingMetadata?.methodCodes, summary.methodCodes),
    projects: mergeStringArrays(existingMetadata?.projects, summary.projects),
    subtitleCodes: mergeStringArrays(existingMetadata?.subtitleCodes, summary.subtitleCodes),
    lines: mergeStringArrays(existingMetadata?.lines, summary.lines),
    periodFrom: minText(existingMetadata?.periodFrom, summary.periodFrom),
    periodTo: maxText(existingMetadata?.periodTo, summary.periodTo),
  }

  let documentId = existing?.id ?? 0
  if (existing) {
    await tx
      .update(generatedDocuments)
      .set({
        fileName: mergedSummary.fileName,
        rowCount: mergedSummary.rowCount,
        sourceMetadata: serializeSystemDocumentSummary(mergedSummary, mergedSourcePositions),
        updatedAt: new Date(),
      })
      .where(eq(generatedDocuments.id, existing.id))
    await tx
      .delete(generatedDocumentWeldJoints)
      .where(eq(generatedDocumentWeldJoints.documentId, existing.id))
    const redundantDocumentIds = mergedDocuments
      .map((document) => document.id)
      .filter((documentId) => documentId !== existing.id)
    if (redundantDocumentIds.length > 0) {
      await tx.delete(generatedDocuments).where(inArray(generatedDocuments.id, redundantDocumentIds))
    }
  } else {
    const [created] = await tx
      .insert(generatedDocuments)
      .values({
        type: storageType,
        title: mergedSummary.title,
        fileName: mergedSummary.fileName,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        periodFrom: mergedSummary.date || null,
        periodTo: mergedSummary.date || null,
        rowCount: mergedSummary.rowCount,
        sourceMetadata: serializeSystemDocumentSummary(mergedSummary, mergedSourcePositions),
      })
      .returning({ id: generatedDocuments.id })
    documentId = created.id
  }
  if (rowIds.length > 0) {
    await tx
      .insert(generatedDocumentWeldJoints)
      .values(rowIds.map((weldJointId) => ({ documentId, weldJointId })))
      .onConflictDoNothing()
  }
  return documentId
}

export async function removeSourcedSystemDocumentPositionsInTransaction({
  tx,
  sourceKind,
  relationIds = [],
  sourcePositions = [],
  weldJointIds = [],
}: {
  tx: SystemDocumentSequenceTransaction
  sourceKind: SystemDocumentSourceKind
  relationIds?: readonly number[]
  sourcePositions?: readonly Pick<SystemDocumentSourcePosition, 'weldJointId' | 'relationId' | 'sequence' | 'methodCode'>[]
  weldJointIds?: readonly number[]
}) {
  const removedIds = new Set(relationIds.map(Number).filter((value) => Number.isInteger(value) && value > 0))
  const removedPositionKeys = new Set(sourcePositions.map(getSourcePositionMatchKey))
  const removedWeldJointIds = new Set(weldJointIds.map(Number).filter((value) => Number.isInteger(value) && value > 0))
  if (removedIds.size === 0 && removedPositionKeys.size === 0 && removedWeldJointIds.size === 0) return

  const documents = await tx.select().from(generatedDocuments)
  for (const document of documents) {
    const metadata = parseSystemDocumentMetadata(document.sourceMetadata)
    if (metadata?.sourceKind !== sourceKind) continue
    const remainingPositions = metadata.sourcePositions.filter((position) => {
      if (position.kind !== sourceKind) return true
      if (removedWeldJointIds.has(position.weldJointId)) return false
      if (removedPositionKeys.has(getSourcePositionMatchKey(position))) return false
      return !removedIds.has(position.relationId)
    })
    if (remainingPositions.length === metadata.sourcePositions.length) continue
    if (remainingPositions.length === 0) {
      await tx.delete(generatedDocuments).where(eq(generatedDocuments.id, document.id))
      continue
    }

    const rowIds = [...new Set(remainingPositions.map((position) => position.weldJointId))]
      .sort((left, right) => left - right)
    const rows = await tx
      .select({
        id: weldJoints.id,
        projectTitle: weldJoints.projectTitle,
        subtitleCode: weldJoints.subtitleCode,
        line: weldJoints.line,
        weldDate: weldJoints.weldDate,
      })
      .from(weldJoints)
      .where(inArray(weldJoints.id, rowIds))
    const methodCodes = normalizeStringArray(
      remainingPositions.map((position) => position.methodCode).filter(Boolean),
    )
    const weldDates = rows.map((row) => String(row.weldDate ?? '').trim()).filter(Boolean).sort()
    const nextMetadata: SystemDocumentMetadata = {
      ...metadata,
      methodCodes,
      cycleSequences: normalizeCycleSequences(remainingPositions.map((position) => position.sequence)),
      positionCount: remainingPositions.length,
      projects: uniqueRowValues(rows, 'projectTitle'),
      subtitleCodes: uniqueRowValues(rows, 'subtitleCode'),
      lines: uniqueRowValues(rows, 'line'),
      periodFrom: weldDates[0] ?? metadata.periodFrom,
      periodTo: weldDates.at(-1) ?? metadata.periodTo,
      sourcePositions: remainingPositions,
    }
    await tx
      .update(generatedDocuments)
      .set({
        rowCount: rowIds.length,
        sourceMetadata: JSON.stringify(nextMetadata),
        updatedAt: new Date(),
      })
      .where(eq(generatedDocuments.id, document.id))
    await tx
      .delete(generatedDocumentWeldJoints)
      .where(eq(generatedDocumentWeldJoints.documentId, document.id))
    await tx
      .insert(generatedDocumentWeldJoints)
      .values(rowIds.map((weldJointId) => ({ documentId: document.id, weldJointId })))
  }
}

function getSourcePositionMatchKey(
  position: Pick<SystemDocumentSourcePosition, 'weldJointId' | 'relationId' | 'sequence' | 'methodCode'>,
) {
  return [
    Number(position.weldJointId),
    Number(position.relationId),
    Number(position.sequence) || 1,
    String(position.methodCode ?? '').trim(),
  ].join(':')
}

export async function removeHeatTreatmentSourcedDocumentPositionsForWeldsInTransaction({
  tx,
  weldJointIds,
}: {
  tx: SystemDocumentSequenceTransaction
  weldJointIds: readonly number[]
}) {
  const rowIds = [...new Set(weldJointIds
    .map(Number)
    .filter((value) => Number.isInteger(value) && value > 0))]
  if (rowIds.length === 0) return

  const preControls = await tx
    .select({ id: preHeatTreatmentControls.id })
    .from(preHeatTreatmentControls)
    .where(inArray(preHeatTreatmentControls.weldJointId, rowIds))
  const repeatCycles = await tx
    .select({ id: pstoRepeatCycles.id })
    .from(pstoRepeatCycles)
    .where(inArray(pstoRepeatCycles.weldJointId, rowIds))

  await removeSourcedSystemDocumentPositionsInTransaction({
    tx,
    sourceKind: 'beforeHeatTreatment',
    relationIds: preControls.map((control) => control.id),
  })
  await removeSourcedSystemDocumentPositionsInTransaction({
    tx,
    sourceKind: 'pstoRepeat',
    relationIds: repeatCycles.map((cycle) => cycle.id),
  })
  await removeSourcedSystemDocumentPositionsInTransaction({
    tx,
    sourceKind: 'pstoCycle',
    weldJointIds: rowIds,
  })
}

export async function loadSourcedSystemDocumentPositionsInTransaction({
  tx,
  documentId,
  sourceKind,
}: {
  tx: SystemDocumentSequenceTransaction
  documentId: number
  sourceKind: SystemDocumentSourceKind
}) {
  const [document] = await tx
    .select()
    .from(generatedDocuments)
    .where(eq(generatedDocuments.id, documentId))
    .limit(1)
  if (!document) throw new Error('Системный документ больше не существует. Обновите раздел «Документы».')
  const metadata = parseSystemDocumentMetadata(document.sourceMetadata)
  if (metadata?.sourceKind !== sourceKind) {
    throw new Error('Этап системного документа уже изменился. Обновите раздел «Документы».')
  }
  return metadata.sourcePositions.filter((position) => position.kind === sourceKind)
}

export async function syncSystemDocumentsForWeldChangesInTransaction(
  tx: SystemDocumentSequenceTransaction,
  currentRows: Array<Partial<WeldRow> & Pick<WeldRow, 'id'>>,
  previousRows: ReadonlyMap<number, Partial<WeldRow> & Pick<WeldRow, 'id'>>,
) {
  const rowIds = new Set<number>([
    ...currentRows.map((row) => Number(row.id)),
    ...previousRows.keys(),
  ])
  if (rowIds.size === 0) return

  for (const type of ['lnkRequest', 'lnkConclusion', 'pstoRequest', 'pstoConclusion'] as const) {
    const previousReferences = collectSystemDocumentReferences([...previousRows.values()], type)
    const currentReferences = collectSystemDocumentReferences(currentRows, type)
    if (!hasSystemDocumentImpact({ currentRows, previousRows, type })) continue
    const affectedReferences = uniqueSystemDocumentReferences([
      ...previousReferences,
      ...currentReferences,
    ])
    if (affectedReferences.length === 0) continue

    await lockSystemDocumentIndex(tx, type)
    const rows = await loadSystemDocumentRowsForReferences(tx, type, affectedReferences)
    const affectedKeys = new Set(affectedReferences.map(getLogicalReferenceKey))
    const summaries = buildSystemDocumentSummaries(
      rows as unknown as Array<Partial<WeldRow> & Pick<WeldRow, 'id'>>,
      type,
    ).filter((summary) => affectedKeys.has(getLogicalReferenceKey(summary)))
    await syncAffectedSystemDocumentSummaries({
      tx,
      type,
      summaries,
      previousReferences,
      affectedRowIds: rowIds,
    })
  }
  await refreshSourcedSystemDocumentMetadataInTransaction(tx, [...rowIds])
}

async function refreshSourcedSystemDocumentMetadataInTransaction(
  tx: SystemDocumentSequenceTransaction,
  changedRowIds: number[],
) {
  if (changedRowIds.length === 0) return
  const assignments = await tx
    .select({ documentId: generatedDocumentWeldJoints.documentId })
    .from(generatedDocumentWeldJoints)
    .where(inArray(generatedDocumentWeldJoints.weldJointId, changedRowIds))
  const documentIds = [...new Set(assignments.map((assignment) => assignment.documentId))]
  if (documentIds.length === 0) return

  const documents = await tx
    .select()
    .from(generatedDocuments)
    .where(inArray(generatedDocuments.id, documentIds))
  const sourcedDocuments = documents.flatMap((document) => {
    const metadata = parseSystemDocumentMetadata(document.sourceMetadata)
    return metadata?.sourceKind ? [{ document, metadata }] : []
  })
  if (sourcedDocuments.length === 0) return

  const sourceRowIds = [...new Set(sourcedDocuments.flatMap(({ metadata }) =>
    metadata.sourcePositions.map((position) => position.weldJointId),
  ))]
  const rows = sourceRowIds.length > 0
    ? await tx
        .select({
          id: weldJoints.id,
          projectTitle: weldJoints.projectTitle,
          subtitleCode: weldJoints.subtitleCode,
          line: weldJoints.line,
          weldDate: weldJoints.weldDate,
        })
        .from(weldJoints)
        .where(inArray(weldJoints.id, sourceRowIds))
    : []

  for (const { document, metadata } of sourcedDocuments) {
    const summary = buildSourcedSystemDocumentMetadataSummary({
      sourcePositions: metadata.sourcePositions,
      rows,
    })
    if (summary.sourcePositions.length === 0) {
      await tx.delete(generatedDocuments).where(eq(generatedDocuments.id, document.id))
      continue
    }
    const nextMetadata: SystemDocumentMetadata = {
      ...metadata,
      ...summary,
    }
    await tx
      .update(generatedDocuments)
      .set({
        rowCount: summary.rowIds.length,
        sourceMetadata: JSON.stringify(nextMetadata),
        updatedAt: new Date(),
      })
      .where(eq(generatedDocuments.id, document.id))
    await tx
      .delete(generatedDocumentWeldJoints)
      .where(eq(generatedDocumentWeldJoints.documentId, document.id))
    await tx
      .insert(generatedDocumentWeldJoints)
      .values(summary.rowIds.map((weldJointId) => ({ documentId: document.id, weldJointId })))
  }
}

function hasSystemDocumentImpact({
  currentRows,
  previousRows,
  type,
}: {
  currentRows: Array<Partial<WeldRow> & Pick<WeldRow, 'id'>>
  previousRows: ReadonlyMap<number, Partial<WeldRow> & Pick<WeldRow, 'id'>>
  type: SystemDocumentType
}) {
  const currentSignatures = getSystemDocumentImpactSignatures(currentRows, type)
  const previousSignatures = getSystemDocumentImpactSignatures([...previousRows.values()], type)
  if (currentSignatures.length !== previousSignatures.length) return true
  return currentSignatures.some((signature, index) => signature !== previousSignatures[index])
}

function getSystemDocumentImpactSignatures(
  rows: Array<Partial<WeldRow> & Pick<WeldRow, 'id'>>,
  type: SystemDocumentType,
) {
  return rows
    .flatMap((row) =>
      collectSystemDocumentReferences([row], type).map((reference) => JSON.stringify([
        row.id,
        getLogicalReferenceKey(reference),
        String(row.projectTitle ?? '').trim(),
        String(row.subtitleCode ?? '').trim(),
        String(row.line ?? '').trim(),
        String(row.weldDate ?? '').trim(),
        String((row as Record<string, unknown>).updatedAt ?? '').trim(),
      ])),
    )
    .sort()
}

async function indexSystemDocumentSummariesInTransaction(
  tx: SystemDocumentSequenceTransaction,
  type: SystemDocumentType,
  summaries: SystemDocumentSummary[],
): Promise<SystemDocumentSummary[]> {
    const storageTypes = SYSTEM_DOCUMENT_TEMPLATE_PROFILES
      .filter((profile) => profile.documentType === type)
      .map((profile) => systemDocumentStorageType(profile.id))
    const allExistingDocuments = storageTypes.length
      ? await tx.select().from(generatedDocuments).where(inArray(generatedDocuments.type, storageTypes))
      : []
    const effectiveSummaries = filterLegacyCycleSummariesShadowedBySourcedDocuments(
      summaries,
      allExistingDocuments.map((document) => toIndexedSourceDocumentIdentity(document, type)),
    )
    const existingDocuments = allExistingDocuments.filter(isPrimaryIndexedDocument)
    const existingDocumentIds = existingDocuments.map((document) => document.id)
    const existingAssignments = existingDocumentIds.length
      ? await tx
          .select()
          .from(generatedDocumentWeldJoints)
          .where(inArray(generatedDocumentWeldJoints.documentId, existingDocumentIds))
      : []
    const assignedRowsByDocument = new Map<number, Set<number>>()
    existingAssignments.forEach((assignment) => {
      const rowIds = assignedRowsByDocument.get(assignment.documentId) ?? new Set<number>()
      rowIds.add(assignment.weldJointId)
      assignedRowsByDocument.set(assignment.documentId, rowIds)
    })
    const matchedDocumentIds = matchSystemDocumentIdentityIds({
      documents: existingDocuments.map(toStoredSystemDocumentIdentity),
      targets: effectiveSummaries.map((summary) => ({
        type: systemDocumentStorageType(getSystemDocumentTemplateId(summary)),
        title: summary.title,
        date: summary.date,
        rowIds: summary.rowIds,
        ...(getSystemDocumentIdentityScope(summary)
          ? { identityScope: getSystemDocumentIdentityScope(summary) }
          : {}),
      })),
      assignedRowsByDocument,
    })
    const existingDocumentsById = new Map(existingDocuments.map((document) => [document.id, document]))
    const targetDocumentIds: number[] = []
    const indexedSummaries: SystemDocumentSummary[] = []

    for (const [summaryIndex, summary] of effectiveSummaries.entries()) {
      const storageType = systemDocumentStorageType(getSystemDocumentTemplateId(summary))
      let document = existingDocumentsById.get(matchedDocumentIds.get(summaryIndex) ?? -1)
      if (!document) {
        ;[document] = await tx
          .insert(generatedDocuments)
          .values({
            type: storageType,
            title: summary.title,
            fileName: summary.fileName,
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            periodFrom: summary.date || null,
            periodTo: summary.date || null,
            rowCount: summary.rowCount,
            sourceMetadata: serializeSystemDocumentSummary(summary),
          })
          .returning()
        existingDocuments.push(document)
      } else {
        ;[document] = await tx
          .update(generatedDocuments)
          .set({
            title: summary.title,
            fileName: summary.fileName,
            periodFrom: summary.date || null,
            periodTo: summary.date || null,
            rowCount: summary.rowCount,
            sourceMetadata: serializeSystemDocumentSummary(summary),
            updatedAt: summary.updatedAt ? new Date(summary.updatedAt) : new Date(),
          })
          .where(eq(generatedDocuments.id, document.id))
          .returning()
      }
      targetDocumentIds.push(document.id)
      indexedSummaries.push({
        ...summary,
        documentId: document.id,
        id: `system-document:${document.id}`,
      })
    }

    const currentDocumentIds = existingDocuments.map((document) => document.id)
    if (currentDocumentIds.length > 0) {
      await tx
        .delete(generatedDocumentWeldJoints)
        .where(inArray(generatedDocumentWeldJoints.documentId, currentDocumentIds))
    }
    const assignments = indexedSummaries.flatMap((summary) =>
      summary.rowIds.map((weldJointId) => ({ documentId: summary.documentId, weldJointId })),
    )
    if (assignments.length > 0) {
      await tx.insert(generatedDocumentWeldJoints).values(assignments).onConflictDoNothing()
    }
    if (currentDocumentIds.length > 0) {
      const staleWhere = targetDocumentIds.length > 0
        ? and(
            inArray(generatedDocuments.id, currentDocumentIds),
            notInArray(generatedDocuments.id, targetDocumentIds),
          )
        : inArray(generatedDocuments.id, currentDocumentIds)
      await tx.delete(generatedDocuments).where(staleWhere)
    }

    return indexedSummaries
}

async function syncAffectedSystemDocumentSummaries({
  tx,
  type,
  summaries,
  previousReferences,
  affectedRowIds,
}: {
  tx: SystemDocumentSequenceTransaction
  type: SystemDocumentType
  summaries: SystemDocumentSummary[]
  previousReferences: SystemDocumentReference[]
  affectedRowIds: ReadonlySet<number>
}) {
  const candidateReferences = uniqueSystemDocumentReferences([
    ...previousReferences,
    ...summaries,
  ])
  const candidateWhere = buildGeneratedDocumentReferenceWhere(candidateReferences)
  const allCandidateDocuments = candidateWhere
    ? await tx.select().from(generatedDocuments).where(candidateWhere)
    : []
  const effectiveSummaries = filterLegacyCycleSummariesShadowedBySourcedDocuments(
    summaries,
    allCandidateDocuments.map((document) => toIndexedSourceDocumentIdentity(document, type)),
  )
  const existingDocuments = allCandidateDocuments.filter(isPrimaryIndexedDocument)
  const existingDocumentIds = existingDocuments.map((document) => document.id)
  const existingAssignments = existingDocumentIds.length > 0
    ? await tx
        .select()
        .from(generatedDocumentWeldJoints)
        .where(inArray(generatedDocumentWeldJoints.documentId, existingDocumentIds))
    : []
  const assignedRowsByDocument = new Map<number, Set<number>>()
  for (const assignment of existingAssignments) {
    const ids = assignedRowsByDocument.get(assignment.documentId) ?? new Set<number>()
    ids.add(assignment.weldJointId)
    assignedRowsByDocument.set(assignment.documentId, ids)
  }

  const matchedDocumentIds = matchSystemDocumentIdentityIds({
    documents: existingDocuments.map(toStoredSystemDocumentIdentity),
    targets: effectiveSummaries.map((summary) => ({
      type: systemDocumentStorageType(getSystemDocumentTemplateId(summary)),
      title: summary.title,
      date: summary.date,
      rowIds: summary.rowIds,
      ...(getSystemDocumentIdentityScope(summary)
        ? { identityScope: getSystemDocumentIdentityScope(summary) }
        : {}),
    })),
    assignedRowsByDocument,
  })
  const existingDocumentsById = new Map(existingDocuments.map((document) => [document.id, document]))
  const usedDocumentIds = new Set<number>()
  for (const [summaryIndex, summary] of effectiveSummaries.entries()) {
    const storageType = systemDocumentStorageType(getSystemDocumentTemplateId(summary))
    let document = existingDocumentsById.get(matchedDocumentIds.get(summaryIndex) ?? -1)
    if (!document) {
      ;[document] = await tx
        .insert(generatedDocuments)
        .values({
          type: storageType,
          title: summary.title,
          fileName: summary.fileName,
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          periodFrom: summary.date || null,
          periodTo: summary.date || null,
          rowCount: summary.rowCount,
          sourceMetadata: serializeSystemDocumentSummary(summary),
        })
        .returning()
    } else {
      ;[document] = await tx
        .update(generatedDocuments)
        .set({
          title: summary.title,
          fileName: summary.fileName,
          periodFrom: summary.date || null,
          periodTo: summary.date || null,
          rowCount: summary.rowCount,
          sourceMetadata: serializeSystemDocumentSummary(summary),
          updatedAt: summary.updatedAt ? new Date(summary.updatedAt) : new Date(),
        })
        .where(eq(generatedDocuments.id, document.id))
        .returning()
    }
    usedDocumentIds.add(document.id)
    await tx
      .delete(generatedDocumentWeldJoints)
      .where(eq(generatedDocumentWeldJoints.documentId, document.id))
    if (summary.rowIds.length > 0) {
      await tx
        .insert(generatedDocumentWeldJoints)
        .values(summary.rowIds.map((weldJointId) => ({ documentId: document.id, weldJointId })))
        .onConflictDoNothing()
    }
  }

  const previousKeys = new Set(previousReferences.map(getLogicalReferenceKey))
  const staleDocumentIds = existingDocuments
    .filter((document) => {
      if (usedDocumentIds.has(document.id)) return false
      if (!previousKeys.has(getStoredDocumentLogicalKey(document, type))) return false
      return [...(assignedRowsByDocument.get(document.id) ?? [])]
        .some((rowId) => affectedRowIds.has(rowId))
    })
    .map((document) => document.id)
  if (staleDocumentIds.length > 0) {
    await tx.delete(generatedDocuments).where(inArray(generatedDocuments.id, staleDocumentIds))
  }
}

function collectSystemDocumentReferences(
  rows: Array<Partial<WeldRow> & Pick<WeldRow, 'id'>>,
  type: SystemDocumentType,
) {
  return buildSystemDocumentSummaries(rows, type).map(toSystemDocumentReference)
}

function uniqueSystemDocumentReferences(
  references: Array<SystemDocumentReference | SystemDocumentSummary>,
) {
  const unique = new Map<string, SystemDocumentReference>()
  for (const reference of references) {
    unique.set(getLogicalReferenceKey(reference), toSystemDocumentReference(reference))
  }
  return [...unique.values()]
}

function toSystemDocumentReference(
  reference: SystemDocumentReference | SystemDocumentSummary,
): SystemDocumentReference {
  return {
    type: reference.type,
    title: reference.title,
    date: reference.date,
    ...(reference.methodCode ? { methodCode: reference.methodCode } : {}),
    ...(reference.sourceKind ? { sourceKind: reference.sourceKind } : {}),
  }
}

function getLogicalReferenceKey(
  reference: Pick<SystemDocumentReference, 'type' | 'title' | 'date' | 'methodCode' | 'sourceKind'>,
) {
  return JSON.stringify([
    reference.type,
    reference.title,
    reference.date,
    reference.methodCode ?? '',
    reference.sourceKind ?? '',
  ])
}

function getStoredDocumentLogicalKey(
  document: typeof generatedDocuments.$inferSelect,
  type: SystemDocumentType,
) {
  const metadata = parseSystemDocumentMetadata(document.sourceMetadata)
  return getLogicalReferenceKey({
    type,
    title: document.title,
    date: document.periodFrom ?? '',
    methodCode: metadata?.methodCode,
    sourceKind: metadata?.sourceKind,
  })
}

function buildGeneratedDocumentReferenceWhere(references: SystemDocumentReference[]) {
  const clauses = references.map((reference) =>
    and(
      eq(
        generatedDocuments.type,
        systemDocumentStorageType(getSystemDocumentTemplateId(reference)),
      ),
      eq(generatedDocuments.title, reference.title),
      sql`coalesce(${generatedDocuments.periodFrom}::text, '') = ${reference.date}`,
    ),
  )
  return clauses.length > 0 ? or(...clauses) : undefined
}

async function loadSystemDocumentRowsForReferences(
  db: Pick<SystemDocumentSequenceTransaction, 'select'>,
  type: SystemDocumentType,
  references: SystemDocumentReference[],
) {
  const where = or(...references.map(buildSystemDocumentWhere)) ?? sql`false`
  if (type === 'lnkRequest') {
    return db.select(LNK_REQUEST_HISTORY_SELECT).from(weldJoints).where(where)
  }
  if (type === 'lnkConclusion') {
    return db.select(LNK_CONCLUSION_HISTORY_SELECT).from(weldJoints).where(where)
  }
  if (type === 'pstoRequest') {
    return db.select(PSTO_REQUEST_HISTORY_SELECT).from(weldJoints).where(where)
  }
  return db.select(PSTO_CONCLUSION_HISTORY_SELECT).from(weldJoints).where(where)
}

async function isSystemDocumentIndexInitialized(
  db: Pick<SystemDocumentSequenceTransaction, 'select'>,
  type: SystemDocumentType,
) {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, getSystemDocumentIndexStateKey(type)))
    .limit(1)
  return row?.value === SYSTEM_DOCUMENT_INDEX_VERSION
}

async function markSystemDocumentIndexInitialized(
  tx: SystemDocumentSequenceTransaction,
  type: SystemDocumentType,
) {
  await tx
    .insert(appSettings)
    .values({ key: getSystemDocumentIndexStateKey(type), value: SYSTEM_DOCUMENT_INDEX_VERSION })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: SYSTEM_DOCUMENT_INDEX_VERSION, updatedAt: new Date() },
    })
}

function getSystemDocumentIndexStateKey(type: SystemDocumentType) {
  return `systemDocumentIndex:${type}`
}

async function ensureSystemDocumentIndexInitializedInTransaction(
  tx: SystemDocumentSequenceTransaction,
  type: SystemDocumentType,
) {
  if (await isSystemDocumentIndexInitialized(tx, type)) return
  const rows = await loadSystemDocumentHistoryRows(tx, type)
  const summaries = buildSystemDocumentSummaries(
    rows as unknown as Array<Partial<WeldRow> & Pick<WeldRow, 'id'>>,
    type,
  )
  await indexSystemDocumentSummariesInTransaction(tx, type, summaries)
  await markSystemDocumentIndexInitialized(tx, type)
}

function buildIndexedSystemDocumentHistoryBaseQuery(
  type: SystemDocumentType,
  storageTypes: string[],
) {
  const metadataArray = (key: string) => sql`
    case
      when jsonb_typeof("document_source"."metadata" -> ${key}) = 'array'
        and jsonb_array_length("document_source"."metadata" -> ${key}) > 0
      then array(
        select jsonb_array_elements_text("document_source"."metadata" -> ${key})
      )
      else array['']::text[]
    end
  `
  const cycleSequences = sql`
    coalesce(
      case
        when jsonb_typeof("document_source"."metadata" -> 'cycleSequences') = 'array'
          and jsonb_array_length("document_source"."metadata" -> 'cycleSequences') > 0
        then "document_source"."metadata" -> 'cycleSequences'
        else null
      end,
      (
        select coalesce(jsonb_agg("cycle_sequence" order by "cycle_sequence"), '[]'::jsonb)
        from (
          select distinct ("position" ->> 'sequence')::integer as "cycle_sequence"
          from jsonb_array_elements(
            case
              when jsonb_typeof("document_source"."metadata" -> 'sourcePositions') = 'array'
              then "document_source"."metadata" -> 'sourcePositions'
              else '[]'::jsonb
            end
          ) as "position"
          where nullif("position" ->> 'sequence', '') is not null
        ) as "cycle_sequences"
      ),
      '[]'::jsonb
    )
  `
  return sql`
    select
      "document_source".*,
      array["document_source"."title"]::text[] as "filter_title",
      ${metadataArray('methodCodes')} as "filter_method",
      array[
        case
          when "document_source"."metadata" ->> 'sourceKind' = 'beforeHeatTreatment' then 'До ТО'
          when "document_source"."metadata" ->> 'sourceKind' in ('pstoRepeat', 'pstoCycle')
            and jsonb_array_length(${cycleSequences}) = 1
          then 'Цикл ' || (${cycleSequences} ->> 0)
          when "document_source"."metadata" ->> 'sourceKind' in ('pstoRepeat', 'pstoCycle')
            and jsonb_array_length(${cycleSequences}) > 1
          then 'Циклы ' || array_to_string(array(
            select jsonb_array_elements_text(${cycleSequences})
          ), ', ')
          when "document_source"."metadata" ->> 'sourceKind' = 'pstoRepeat' then 'Повторный цикл'
          when "document_source"."metadata" ->> 'sourceKind' = 'pstoCycle' then 'Цикл ПСТО'
          when "document_source"."type" in ('lnkRequest', 'lnkConclusion')
            and jsonb_typeof("document_source"."metadata" -> 'methodCodes') = 'array'
            and jsonb_array_length("document_source"."metadata" -> 'methodCodes') = 1
            and "document_source"."metadata" -> 'methodCodes' @> '["ТВМТ"]'::jsonb
          then 'Цикл 1'
          when "document_source"."type" in ('lnkRequest', 'lnkConclusion') then 'Основной'
          else 'Цикл 1'
        end
      ]::text[] as "filter_stage",
      ${metadataArray('projects')} as "filter_project",
      ${metadataArray('subtitleCodes')} as "filter_subtitle",
      ${metadataArray('lines')} as "filter_line",
      array["document_source"."rowCount"::text]::text[] as "filter_rowCount",
      array[
        case
          when "document_source"."date" = '' then ''
          else to_char("document_source"."date"::date, 'DD.MM.YYYY')
        end
      ]::text[] as "filter_date"
    from (
      select
        "document_record".*,
        coalesce(nullif("document_record"."sourceMetadata", ''), '{}')::jsonb as "metadata"
      from (
        select
          ${generatedDocuments.id} as "documentId",
          ${type}::text as "type",
          ${generatedDocuments.title} as "title",
          coalesce(${generatedDocuments.periodFrom}::text, '') as "date",
          ${generatedDocuments.fileName} as "fileName",
          ${generatedDocuments.rowCount} as "rowCount",
          ${generatedDocuments.sourceMetadata} as "sourceMetadata",
          ${generatedDocuments.updatedAt} as "updatedAt"
        from ${generatedDocuments}
        where ${inArray(generatedDocuments.type, storageTypes)}
      ) as "document_record"
    ) as "document_source"
  `
}

function toIndexedSystemDocumentHistorySummary(
  record: Record<string, unknown>,
  type: SystemDocumentType,
): SystemDocumentSummary {
  const documentId = Number(record.documentId)
  const title = String(record.title ?? '')
  const date = String(record.date ?? '')
  const metadata = parseSystemDocumentMetadata(record.metadata)
  const rowCount = Math.max(0, Number(record.rowCount) || 0)
  return {
    documentId,
    id: `system-document:${documentId}`,
    type,
    title,
    date,
    ...(metadata?.methodCode ? { methodCode: metadata.methodCode } : {}),
    ...(metadata?.sourceKind ? { sourceKind: metadata.sourceKind } : {}),
    ...(metadata?.cycleSequences?.length ? { cycleSequences: metadata.cycleSequences } : {}),
    label: metadata?.label || title,
    fileName: String(record.fileName ?? ''),
    methodCodes: metadata?.methodCodes ?? [],
    rowCount,
    positionCount: metadata?.positionCount ?? rowCount,
    projects: metadata?.projects ?? [],
    subtitleCodes: metadata?.subtitleCodes ?? [],
    lines: metadata?.lines ?? [],
    periodFrom: metadata?.periodFrom ?? '',
    periodTo: metadata?.periodTo ?? '',
    updatedAt: String(record.updatedAt ?? ''),
    rowIds: [],
  }
}

export async function loadIndexedSystemDocumentSummaries(
  tx: SystemDocumentSequenceTransaction,
  type: SystemDocumentType,
): Promise<SystemDocumentSummary[]> {
  const storageTypes = SYSTEM_DOCUMENT_TEMPLATE_PROFILES
    .filter((profile) => profile.documentType === type)
    .map((profile) => systemDocumentStorageType(profile.id))
  if (storageTypes.length === 0) return []
  const documents = await tx
    .select()
    .from(generatedDocuments)
    .where(inArray(generatedDocuments.type, storageTypes))
  if (documents.length === 0) return []
  const documentIds = documents.map((document) => document.id)
  const assignments = await tx
    .select({
      documentId: generatedDocumentWeldJoints.documentId,
      weldJointId: generatedDocumentWeldJoints.weldJointId,
    })
    .from(generatedDocumentWeldJoints)
    .where(inArray(generatedDocumentWeldJoints.documentId, documentIds))
  const rowIdsByDocument = new Map<number, number[]>()
  for (const assignment of assignments) {
    const ids = rowIdsByDocument.get(assignment.documentId) ?? []
    ids.push(assignment.weldJointId)
    rowIdsByDocument.set(assignment.documentId, ids)
  }

  return documents
    .map((document) => {
      const metadata = parseSystemDocumentMetadata(document.sourceMetadata)
      const rowIds = (rowIdsByDocument.get(document.id) ?? []).sort((left, right) => left - right)
      return {
        documentId: document.id,
        id: `system-document:${document.id}`,
        type,
        title: document.title,
        date: document.periodFrom ?? '',
        ...(metadata?.methodCode ? { methodCode: metadata.methodCode } : {}),
        ...(metadata?.sourceKind ? { sourceKind: metadata.sourceKind } : {}),
        ...(metadata?.cycleSequences?.length ? { cycleSequences: metadata.cycleSequences } : {}),
        label: metadata?.label ?? document.title,
        fileName: document.fileName,
        methodCodes: metadata?.methodCodes ?? [],
        rowCount: rowIds.length,
        positionCount: metadata?.positionCount ?? rowIds.length,
        projects: metadata?.projects ?? [],
        subtitleCodes: metadata?.subtitleCodes ?? [],
        lines: metadata?.lines ?? [],
        periodFrom: metadata?.periodFrom ?? '',
        periodTo: metadata?.periodTo ?? '',
        updatedAt: document.updatedAt.toISOString(),
        rowIds,
      } satisfies SystemDocumentSummary
    })
    .sort((left, right) => {
      const dateDelta = right.date.localeCompare(left.date, 'ru', { numeric: true })
      return dateDelta || right.title.localeCompare(left.title, 'ru', { numeric: true })
    })
}

type SystemDocumentMetadata = Pick<
  SystemDocumentSummary,
  | 'label'
  | 'methodCode'
  | 'methodCodes'
  | 'positionCount'
  | 'projects'
  | 'subtitleCodes'
  | 'lines'
  | 'periodFrom'
  | 'periodTo'
  | 'sourceKind'
  | 'cycleSequences'
> & {
  sourcePositions: SystemDocumentSourcePosition[]
}

function serializeSystemDocumentSummary(
  summary: SystemDocumentSummary,
  sourcePositions: SystemDocumentSourcePosition[] = [],
) {
  return JSON.stringify({
    label: summary.label,
    ...(summary.methodCode ? { methodCode: summary.methodCode } : {}),
    ...(summary.sourceKind ? { sourceKind: summary.sourceKind } : {}),
    cycleSequences: summary.cycleSequences ?? normalizeCycleSequences(sourcePositions.map((position) => position.sequence)),
    methodCodes: summary.methodCodes,
    positionCount: summary.positionCount,
    projects: summary.projects,
    subtitleCodes: summary.subtitleCodes,
    lines: summary.lines,
    periodFrom: summary.periodFrom,
    periodTo: summary.periodTo,
    sourcePositions: normalizeSystemDocumentSourcePositions(sourcePositions),
  } satisfies SystemDocumentMetadata)
}

function parseSystemDocumentMetadata(value: unknown): SystemDocumentMetadata | null {
  try {
    const parsed = (
      typeof value === 'string'
        ? value.trim()
          ? JSON.parse(value)
          : null
        : value
    ) as Partial<SystemDocumentMetadata> | null
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const sourcePositions = normalizeSystemDocumentSourcePositions(parsed.sourcePositions)
    return {
      label: String(parsed.label ?? ''),
      ...(parsed.methodCode ? { methodCode: String(parsed.methodCode) } : {}),
      ...(isSystemDocumentSourceKind(parsed.sourceKind)
        ? { sourceKind: parsed.sourceKind }
        : {}),
      cycleSequences: normalizeCycleSequences(
        Array.isArray(parsed.cycleSequences)
          ? parsed.cycleSequences
          : sourcePositions.map((position) => position.sequence),
      ),
      methodCodes: normalizeStringArray(parsed.methodCodes),
      positionCount: Math.max(0, Number(parsed.positionCount) || 0),
      projects: normalizeStringArray(parsed.projects),
      subtitleCodes: normalizeStringArray(parsed.subtitleCodes),
      lines: normalizeStringArray(parsed.lines),
      periodFrom: String(parsed.periodFrom ?? ''),
      periodTo: String(parsed.periodTo ?? ''),
      sourcePositions,
    }
  } catch {
    return null
  }
}

function toStoredSystemDocumentIdentity(document: typeof generatedDocuments.$inferSelect) {
  const metadata = parseSystemDocumentMetadata(document.sourceMetadata)
  const identityScope = getSystemDocumentIdentityScope(metadata ?? {})
  return {
    ...document,
    ...(identityScope ? { identityScope } : {}),
  }
}

function toIndexedSourceDocumentIdentity(
  document: typeof generatedDocuments.$inferSelect,
  type: SystemDocumentType,
) {
  const metadata = parseSystemDocumentMetadata(document.sourceMetadata)
  return {
    type,
    title: document.title,
    date: document.periodFrom ?? '',
    methodCodes: metadata?.methodCodes ?? [],
    ...(metadata?.methodCode ? { methodCode: metadata.methodCode } : {}),
    ...(metadata?.sourceKind ? { sourceKind: metadata.sourceKind } : {}),
  }
}

function getSystemDocumentIdentityScope(
  reference: Partial<Pick<SystemDocumentReference, 'methodCode' | 'sourceKind' | 'cycleSequences'>>,
) {
  return [
    reference.methodCode,
    reference.sourceKind,
    ...(reference.sourceKind === 'pstoCycle'
      ? []
      : reference.cycleSequences?.map((sequence) => `cycle-${sequence}`) ?? []),
  ].filter(Boolean).join(':') || undefined
}

function isPrimaryIndexedDocument(document: typeof generatedDocuments.$inferSelect) {
  return !parseSystemDocumentMetadata(document.sourceMetadata)?.sourceKind
}

function isCompatibleLegacyPrimaryDocument(
  document: typeof generatedDocuments.$inferSelect,
  summary: Pick<SystemDocumentSummary, 'methodCode' | 'type'>,
) {
  if (!isPrimaryIndexedDocument(document)) return false
  if (summary.methodCode !== 'ТВМТ') return !summary.type.startsWith('lnk')
  const metadata = parseSystemDocumentMetadata(document.sourceMetadata)
  const methods = metadata?.methodCodes ?? []
  return methods.length > 0 && methods.every((method) => method === 'ТВМТ')
}

function isSystemDocumentSourceKind(value: unknown): value is SystemDocumentSourceKind {
  return value === 'beforeHeatTreatment' || value === 'pstoRepeat' || value === 'pstoCycle'
}

function normalizeSystemDocumentSourcePositions(value: unknown): SystemDocumentSourcePosition[] {
  if (!Array.isArray(value)) return []
  const unique = new Map<string, SystemDocumentSourcePosition>()
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    const record = candidate as Partial<SystemDocumentSourcePosition>
    const kind = record.kind
    const weldJointId = Math.floor(Number(record.weldJointId))
    const relationId = Math.floor(Number(record.relationId))
    if (!isSystemDocumentSourceKind(kind) || weldJointId <= 0 || relationId <= 0) continue
    const methodCode = String(record.methodCode ?? '').trim()
    const sequence = Math.floor(Number(record.sequence))
    const position: SystemDocumentSourcePosition = {
      kind,
      weldJointId,
      relationId,
      ...(methodCode ? { methodCode } : {}),
      ...(sequence >= (kind === 'pstoCycle' ? 1 : 2) ? { sequence } : {}),
    }
    unique.set(
      [position.kind, position.weldJointId, position.relationId, position.sequence ?? '', position.methodCode ?? ''].join(':'),
      position,
    )
  }
  return [...unique.values()].sort(
    (left, right) =>
      left.weldJointId - right.weldJointId ||
      left.relationId - right.relationId ||
      String(left.methodCode ?? '').localeCompare(String(right.methodCode ?? ''), 'ru'),
  )
}

function normalizeCycleSequences(values: readonly unknown[] | undefined) {
  return [...new Set((values ?? [])
    .map((value) => Math.floor(Number(value)))
    .filter((value) => Number.isInteger(value) && value > 0))]
    .sort((left, right) => left - right)
}

function sameCycleSequences(left: readonly unknown[] | undefined, right: readonly unknown[] | undefined) {
  const normalizedLeft = normalizeCycleSequences(left)
  const normalizedRight = normalizeCycleSequences(right)
  return normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((sequence, index) => sequence === normalizedRight[index])
}

function includesCycleSequences(available: readonly unknown[] | undefined, requested: readonly unknown[] | undefined) {
  const availableSet = new Set(normalizeCycleSequences(available))
  const normalizedRequested = normalizeCycleSequences(requested)
  return normalizedRequested.length === 0 || normalizedRequested.every((sequence) => availableSet.has(sequence))
}

async function overlaySourcedSystemDocumentRows(
  rows: Array<typeof weldJoints.$inferSelect>,
  metadata: SystemDocumentMetadata,
) {
  const db = requireDb()
  if (metadata.sourceKind === 'beforeHeatTreatment') {
    const relationIds = metadata.sourcePositions
      .filter((position) => position.kind === 'beforeHeatTreatment')
      .map((position) => position.relationId)
    if (relationIds.length === 0) return rows
    const relations = await db
      .select()
      .from(preHeatTreatmentControls)
      .where(inArray(preHeatTreatmentControls.id, relationIds))
    const relationsByWeldId = new Map<number, typeof relations>()
    for (const relation of relations) {
      const current = relationsByWeldId.get(relation.weldJointId) ?? []
      current.push(relation)
      relationsByWeldId.set(relation.weldJointId, current)
    }
    return rows.map((row) => buildPreHeatTreatmentSystemDocumentRow(
      row as unknown as WeldRow,
      relationsByWeldId.get(row.id) ?? [],
    ))
  }

  if (metadata.sourceKind === 'pstoCycle') {
    const repeatRelationIds = metadata.sourcePositions
      .filter((position) => position.kind === 'pstoCycle' && Number(position.sequence) >= 2)
      .map((position) => position.relationId)
    const repeatRelations = repeatRelationIds.length > 0
      ? await db
          .select()
          .from(pstoRepeatCycles)
          .where(inArray(pstoRepeatCycles.id, repeatRelationIds))
      : []
    const rowsById = new Map(rows.map((row) => [row.id, row]))
    const repeatRelationsById = new Map(repeatRelations.map((relation) => [relation.id, relation]))
    const seenPositions = new Set<string>()
    return metadata.sourcePositions.flatMap((position) => {
      if (position.kind !== 'pstoCycle') return []
      const positionKey = `${position.weldJointId}:${position.sequence ?? 1}:${position.methodCode ?? ''}`
      if (seenPositions.has(positionKey)) return []
      const row = rowsById.get(position.weldJointId)
      if (!row) return []
      seenPositions.add(positionKey)
      if ((position.sequence ?? 1) === 1) {
        return [buildPrimaryPstoSystemDocumentRow(row as unknown as WeldRow)]
      }
      const relation = repeatRelationsById.get(position.relationId)
      return relation
        ? [buildPstoRepeatSystemDocumentRow(row as unknown as WeldRow, relation)]
        : []
    })
  }

  const relationIds = metadata.sourcePositions
    .filter((position) => position.kind === 'pstoRepeat')
    .map((position) => position.relationId)
  if (relationIds.length === 0) return rows
  const relations = await db
    .select()
    .from(pstoRepeatCycles)
    .where(inArray(pstoRepeatCycles.id, relationIds))
  const rowsById = new Map(rows.map((row) => [row.id, row]))
  const relationsById = new Map(relations.map((relation) => [relation.id, relation]))
  const seenRelationIds = new Set<number>()
  return metadata.sourcePositions.flatMap((position) => {
    if (position.kind !== 'pstoRepeat' || seenRelationIds.has(position.relationId)) return []
    const relation = relationsById.get(position.relationId)
    const row = relation ? rowsById.get(relation.weldJointId) : undefined
    if (!relation || !row) return []
    seenRelationIds.add(position.relationId)
    return [buildPstoRepeatSystemDocumentRow(row as unknown as WeldRow, relation)]
  })
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => String(item).trim()).filter(Boolean))]
    : []
}

function mergeStringArrays(...values: unknown[]) {
  return [...new Set(values.flatMap(normalizeStringArray))]
    .sort((left, right) => left.localeCompare(right, 'ru', { numeric: true }))
}

function uniqueRowValues<Row extends Record<string, unknown>>(
  rows: readonly Row[],
  key: keyof Row,
) {
  return [...new Set(rows.map((row) => String(row[key] ?? '').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'ru', { numeric: true }))
}

function minText(left: unknown, right: unknown) {
  return [String(left ?? '').trim(), String(right ?? '').trim()]
    .filter(Boolean)
    .sort()[0] ?? ''
}

function maxText(left: unknown, right: unknown) {
  return [String(left ?? '').trim(), String(right ?? '').trim()]
    .filter(Boolean)
    .sort()
    .at(-1) ?? ''
}

export async function lockSystemDocumentIndex(
  tx: SystemDocumentSequenceTransaction,
  type: SystemDocumentType,
) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`system-document-index:${type}`}))`)
}

async function loadSystemDocumentHistoryRows(
  db: Pick<SystemDocumentSequenceTransaction, 'select'>,
  type: SystemDocumentType,
) {
  if (type === 'lnkRequest') {
    return db.select(LNK_REQUEST_HISTORY_SELECT).from(weldJoints).where(hasAnyLnkRequest())
  }
  if (type === 'lnkConclusion') {
    return db.select(LNK_CONCLUSION_HISTORY_SELECT).from(weldJoints).where(hasAnyLnkConclusion())
  }
  if (type === 'pstoRequest') {
    return db
      .select(PSTO_REQUEST_HISTORY_SELECT)
      .from(weldJoints)
      .where(hasText(weldJoints.pstoRequest))
  }
  return db
    .select(PSTO_CONCLUSION_HISTORY_SELECT)
    .from(weldJoints)
    .where(hasText(weldJoints.heatTreatmentDiagram))
}

export function systemDocumentStorageType(templateId: string) {
  return `system:${templateId}`
}

function buildSystemDocumentWhere(reference: SystemDocumentReference): SQL {
  if (reference.type === 'lnkRequest') {
    const requestMethods = reference.methodCode === 'ТВМТ'
      ? LNK_METHODS.filter((method) => method.code === 'ТВМТ')
      : LNK_METHODS.filter((method) => method.code !== 'ТВМТ')
    const conditions = requestMethods.map((method) =>
      and(
        textEquals(weldJoints[method.requestKey], reference.title),
        dateEquals(weldJoints[method.requestDateKey], reference.date),
      ),
    )
    return or(...conditions) ?? sql`false`
  }

  if (reference.type === 'lnkConclusion') {
    const method = LNK_METHODS.find((candidate) => candidate.code === reference.methodCode)
    if (!method) return sql`false`
    return and(
      textEquals(weldJoints[method.conclusionKey], reference.title),
      dateEquals(weldJoints[method.conclusionDateKey], reference.date),
    ) ?? sql`false`
  }

  if (reference.type === 'pstoRequest') {
    return and(
      textEquals(weldJoints.pstoRequest, reference.title),
      dateEquals(weldJoints.pstoRequestDate, reference.date),
    ) ?? sql`false`
  }

  return and(
    textEquals(weldJoints.heatTreatmentDiagram, reference.title),
    dateEquals(weldJoints.pstoDate, reference.date),
  ) ?? sql`false`
}

function hasAnyLnkRequest() {
  return or(...LNK_METHODS.map((method) => hasText(weldJoints[method.requestKey])))
}

function hasAnyLnkConclusion() {
  return or(...LNK_METHODS.map((method) => hasText(weldJoints[method.conclusionKey])))
}

function hasText(column: SQLWrapper) {
  return sql`nullif(btrim(${column}), '') is not null`
}

function textEquals(column: SQLWrapper, value: string) {
  return sql`btrim(coalesce(${column}, '')) = ${value}`
}

function dateEquals(column: SQLWrapper, value: string) {
  return sql`coalesce(${column}::text, '') = ${value}`
}

function compactSystemDocumentRow(row: typeof weldJoints.$inferSelect | WeldRow): WeldRow {
  return Object.fromEntries(
    Object.entries(row).filter(([, value]) => value !== null && value !== undefined && value !== ''),
  ) as unknown as WeldRow
}
