import { createServerFn } from '@tanstack/react-start'
import { and, asc, eq, inArray, notInArray, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm'

import { requireDb } from '@/db'
import { appSettings, generatedDocuments, generatedDocumentWeldJoints, weldJoints } from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import { LNK_METHODS } from '@/lib/lnk-report-config'
import { matchSystemDocumentIdentityIds } from '@/lib/system-document-identity'
import {
  buildSystemDocumentSummaries,
  isSystemDocumentType,
  type SystemDocumentReference,
  type SystemDocumentSummary,
  type SystemDocumentType,
} from '@/lib/system-document-types'
import {
  SYSTEM_DOCUMENT_TEMPLATE_PROFILES,
  getSystemDocumentTemplateId,
} from '@/lib/system-document-template-types'
import type { SystemDocumentSequenceTransaction } from '@/server/system-document-sequences'
import { assertSecurityScope } from '@/server/security-functions'

const BASE_HISTORY_SELECT = {
  id: weldJoints.id,
  weldDate: weldJoints.weldDate,
  projectTitle: weldJoints.projectTitle,
  subtitleCode: weldJoints.subtitleCode,
  line: weldJoints.line,
  updatedAt: weldJoints.updatedAt,
}

const SYSTEM_DOCUMENT_INDEX_VERSION = '2'

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

export const listSystemDocuments = createServerFn({ method: 'GET' })
  .validator((data: { type: SystemDocumentType }) => ({
    type: requireSystemDocumentType(data?.type),
  }))
  .handler(async ({ data }): Promise<SystemDocumentSummary[]> => {
    await assertSecurityScope('entry')
    const db = requireDb()
    return db.transaction(async (tx) => {
      await lockSystemDocumentIndex(tx, data.type)
      if (await isSystemDocumentIndexInitialized(tx, data.type)) {
        return loadIndexedSystemDocumentSummaries(tx, data.type)
      }
      const rows = await loadSystemDocumentHistoryRows(tx, data.type)
      const summaries = buildSystemDocumentSummaries(
        rows as unknown as Array<Partial<WeldRow> & Pick<WeldRow, 'id'>>,
        data.type,
      )
      const indexed = await indexSystemDocumentSummariesInTransaction(tx, data.type, summaries)
      await markSystemDocumentIndexInitialized(tx, data.type)
      return indexed
    })
  })

export const getSystemDocumentRows = createServerFn({ method: 'GET' })
  .validator(normalizeSystemDocumentReference)
  .handler(async ({ data }): Promise<WeldRow[]> => {
    await assertSecurityScope('entry')
    const db = requireDb()
    const expectedStorageType = systemDocumentStorageType(getSystemDocumentTemplateId(data))
    const rows = data.documentId
      ? await db
          .select({ weld: weldJoints })
          .from(generatedDocumentWeldJoints)
          .innerJoin(
            generatedDocuments,
            and(
              eq(generatedDocuments.id, generatedDocumentWeldJoints.documentId),
              eq(generatedDocuments.type, expectedStorageType),
            ),
          )
          .innerJoin(weldJoints, eq(weldJoints.id, generatedDocumentWeldJoints.weldJointId))
          .where(eq(generatedDocumentWeldJoints.documentId, data.documentId))
          .orderBy(
            asc(weldJoints.projectTitle),
            asc(weldJoints.subtitleCode),
            asc(weldJoints.line),
            asc(weldJoints.joint),
          )
          .then((records) => records.map((record) => record.weld))
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

    return rows.map(compactSystemDocumentRow)
  })

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
    const existingDocuments = storageTypes.length
      ? await tx.select().from(generatedDocuments).where(inArray(generatedDocuments.type, storageTypes))
      : []
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
      documents: existingDocuments,
      targets: summaries.map((summary) => ({
        type: systemDocumentStorageType(getSystemDocumentTemplateId(summary)),
        title: summary.title,
        date: summary.date,
        rowIds: summary.rowIds,
      })),
      assignedRowsByDocument,
    })
    const existingDocumentsById = new Map(existingDocuments.map((document) => [document.id, document]))
    const targetDocumentIds: number[] = []
    const indexedSummaries: SystemDocumentSummary[] = []

    for (const [summaryIndex, summary] of summaries.entries()) {
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
  const existingDocuments = candidateWhere
    ? await tx.select().from(generatedDocuments).where(candidateWhere)
    : []
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
    documents: existingDocuments,
    targets: summaries.map((summary) => ({
      type: systemDocumentStorageType(getSystemDocumentTemplateId(summary)),
      title: summary.title,
      date: summary.date,
      rowIds: summary.rowIds,
    })),
    assignedRowsByDocument,
  })
  const existingDocumentsById = new Map(existingDocuments.map((document) => [document.id, document]))
  const usedDocumentIds = new Set<number>()
  for (const [summaryIndex, summary] of summaries.entries()) {
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
  }
}

function getLogicalReferenceKey(
  reference: Pick<SystemDocumentReference, 'type' | 'title' | 'date' | 'methodCode'>,
) {
  return JSON.stringify([
    reference.type,
    reference.title,
    reference.date,
    reference.methodCode ?? '',
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

async function loadIndexedSystemDocumentSummaries(
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
>

function serializeSystemDocumentSummary(summary: SystemDocumentSummary) {
  return JSON.stringify({
    label: summary.label,
    ...(summary.methodCode ? { methodCode: summary.methodCode } : {}),
    methodCodes: summary.methodCodes,
    positionCount: summary.positionCount,
    projects: summary.projects,
    subtitleCodes: summary.subtitleCodes,
    lines: summary.lines,
    periodFrom: summary.periodFrom,
    periodTo: summary.periodTo,
  } satisfies SystemDocumentMetadata)
}

function parseSystemDocumentMetadata(value: unknown): SystemDocumentMetadata | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const parsed = JSON.parse(value) as Partial<SystemDocumentMetadata>
    return {
      label: String(parsed.label ?? ''),
      ...(parsed.methodCode ? { methodCode: String(parsed.methodCode) } : {}),
      methodCodes: normalizeStringArray(parsed.methodCodes),
      positionCount: Math.max(0, Number(parsed.positionCount) || 0),
      projects: normalizeStringArray(parsed.projects),
      subtitleCodes: normalizeStringArray(parsed.subtitleCodes),
      lines: normalizeStringArray(parsed.lines),
      periodFrom: String(parsed.periodFrom ?? ''),
      periodTo: String(parsed.periodTo ?? ''),
    }
  } catch {
    return null
  }
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : []
}

async function lockSystemDocumentIndex(
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

function systemDocumentStorageType(templateId: string) {
  return `system:${templateId}`
}

function buildSystemDocumentWhere(reference: SystemDocumentReference): SQL {
  if (reference.type === 'lnkRequest') {
    const conditions = LNK_METHODS.map((method) =>
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

function requireSystemDocumentType(value: unknown): SystemDocumentType {
  if (!isSystemDocumentType(value)) throw new Error('Неизвестный тип системного документа.')
  return value
}

function normalizeSystemDocumentReference(data: SystemDocumentReference): SystemDocumentReference {
  const type = requireSystemDocumentType(data?.type)
  const title = String(data?.title ?? '').trim()
  const date = String(data?.date ?? '').trim().slice(0, 10)
  const methodCode = String(data?.methodCode ?? '').trim()
  if (!title) throw new Error('Не указано наименование системного документа.')
  if (type === 'lnkConclusion' && !LNK_METHODS.some((method) => method.code === methodCode)) {
    throw new Error('Не указан вид контроля заключения ЛНК.')
  }
  return {
    ...(Number(data?.documentId) > 0 ? { documentId: Math.floor(Number(data.documentId)) } : {}),
    type,
    title,
    date,
    ...(methodCode ? { methodCode } : {}),
  }
}

function compactSystemDocumentRow(row: typeof weldJoints.$inferSelect): WeldRow {
  return Object.fromEntries(
    Object.entries(row).filter(([, value]) => value !== null && value !== undefined && value !== ''),
  ) as unknown as WeldRow
}
