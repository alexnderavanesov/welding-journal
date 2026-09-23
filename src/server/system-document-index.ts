import { and, asc, eq, inArray, isNull, ne, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm'

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
  type SystemDocumentDateContext,
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
  buildDocumentHistoryFilterOptionsSqlQuery,
  buildDocumentHistorySqlQuery,
  DOCUMENT_HISTORY_FILTER_OPTION_LIMIT,
  normalizeSqlDocumentHistoryFilterOptions,
  normalizeSqlDocumentHistoryResult,
  type SqlDocumentHistoryFilterOptionsResult,
  type SqlDocumentHistoryResult,
} from '@/server/document-history-sql'
import { attachDuplicateControlRelations } from '@/server/duplicate-control-relations'
import {
  attachHeatTreatmentControlRelations,
  attachPreHeatTreatmentControlRelations,
} from '@/server/heat-treatment-control-relations'
import type { SystemDocumentSequenceTransaction } from '@/server/system-document-sequences'
import {
  lockLayeredControlDocumentsForWeldChange,
  syncLayeredControlDocumentsForWeldChangesInTransaction,
} from '@/server/layered-control-documents'
import { WELD_TABLE_SELECT } from '@/server/weld-server-shared'
import { buildNumberArrayMatch } from '@/server/weld-request-utils'

const BASE_HISTORY_SELECT = {
  id: weldJoints.id,
  weldDate: weldJoints.weldDate,
  projectTitle: weldJoints.projectTitle,
  subtitleCode: weldJoints.subtitleCode,
  line: weldJoints.line,
  updatedAt: weldJoints.updatedAt,
}

const SYSTEM_DOCUMENT_INDEX_VERSION = '4'
export const SYSTEM_DOCUMENT_INDEX_LOCK_ORDER: readonly SystemDocumentType[] = [
  'lnkRequest',
  'lnkConclusion',
  'pstoRequest',
  'pstoConclusion',
]

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

export type SystemDocumentNameConflictTarget = {
  type: SystemDocumentType
  title: string
  date: string
  methodCode?: string
  excludeDocumentId?: number
}

export async function hasSystemDocumentNameConflict(
  target: SystemDocumentNameConflictTarget,
) {
  const db = requireDb()
  return db.transaction(async (tx) => {
    await lockSystemDocumentIndex(tx, target.type)
    await ensureSystemDocumentIndexInitializedInTransaction(tx, target.type)
    const [document] = await tx
      .select({ id: generatedDocuments.id })
      .from(generatedDocuments)
      .where(buildSystemDocumentNameConflictWhere(target))
      .limit(1)
    return Boolean(document)
  })
}

export function buildSystemDocumentNameConflictWhere(
  target: SystemDocumentNameConflictTarget,
) {
  const storageType = systemDocumentStorageType(getSystemDocumentTemplateId(target))
  return and(
    eq(generatedDocuments.type, storageType),
    eq(generatedDocuments.title, target.title),
    target.date
      ? eq(generatedDocuments.periodFrom, target.date)
      : isNull(generatedDocuments.periodFrom),
    target.excludeDocumentId
      ? ne(generatedDocuments.id, target.excludeDocumentId)
      : undefined,
  ) ?? sql`false`
}

export const SYSTEM_DOCUMENT_HISTORY_FILTER_KEYS = [
  'title',
  'method',
  'stage',
  'project',
  'subtitle',
  'line',
  'rowCount',
  'date',
] as const

export type SystemDocumentHistoryFilterKey = typeof SYSTEM_DOCUMENT_HISTORY_FILTER_KEYS[number]

export function isSystemDocumentHistoryFilterKey(value: unknown): value is SystemDocumentHistoryFilterKey {
  return SYSTEM_DOCUMENT_HISTORY_FILTER_KEYS.includes(value as SystemDocumentHistoryFilterKey)
}

type IndexedSystemDocumentHistoryRequest = {
  type: SystemDocumentType
  documentId?: number
  limit: number
  columnFilters: Record<string, string>
}

export async function loadIndexedSystemDocumentHistory({
  type,
  documentId,
  limit,
  columnFilters,
}: IndexedSystemDocumentHistoryRequest): Promise<SqlDocumentHistoryResult<SystemDocumentSummary>> {
  const db = requireDb()
  return db.transaction(async (tx) => {
    await lockSystemDocumentIndex(tx, type)
    await ensureSystemDocumentIndexInitializedInTransaction(tx, type)
    return queryIndexedSystemDocumentHistory(tx, { type, documentId, limit, columnFilters })
  })
}

export async function queryIndexedSystemDocumentHistory(
  tx: Pick<SystemDocumentSequenceTransaction, 'execute'>,
  { type, documentId, limit, columnFilters }: IndexedSystemDocumentHistoryRequest,
): Promise<SqlDocumentHistoryResult<SystemDocumentSummary>> {
  const storageTypes = getSystemDocumentStorageTypes(type)
  if (storageTypes.length === 0) {
    return {
      documents: [],
      total: 0,
      filterOptions: Object.fromEntries(
        SYSTEM_DOCUMENT_HISTORY_FILTER_KEYS.map((key) => [key, []]),
      ),
    }
  }

  const baseQuery = buildIndexedSystemDocumentHistoryBaseQuery(type, storageTypes, documentId)
  const queryResult = await tx.execute(buildDocumentHistorySqlQuery({
    baseQuery,
    columnFilters,
    filterKeys: [...SYSTEM_DOCUMENT_HISTORY_FILTER_KEYS],
    optionKeys: type === 'lnkConclusion' ? ['method'] : [],
    materializeFilteredDocuments: false,
    limit,
    orderBy: sql`"date" desc, "title" desc, "documentId" desc`,
  }))
  return normalizeSqlDocumentHistoryResult(
    queryResult.rows[0],
    [...SYSTEM_DOCUMENT_HISTORY_FILTER_KEYS],
    (record) => toIndexedSystemDocumentHistorySummary(record, type),
  )
}

export async function loadIndexedSystemDocumentHistoryFilterOptions({
  type,
  documentId,
  columnFilters,
  fieldKey,
  search,
}: {
  type: SystemDocumentType
  documentId?: number
  columnFilters: Record<string, string>
  fieldKey: SystemDocumentHistoryFilterKey
  search: string
}): Promise<SqlDocumentHistoryFilterOptionsResult> {
  const db = requireDb()
  return db.transaction(async (tx) => {
    await lockSystemDocumentIndex(tx, type)
    await ensureSystemDocumentIndexInitializedInTransaction(tx, type)
    const storageTypes = getSystemDocumentStorageTypes(type)
    if (storageTypes.length === 0) return { options: [], hasMore: false }

    const baseQuery = buildIndexedSystemDocumentHistoryBaseQuery(type, storageTypes, documentId)
    const result = await tx.execute(buildDocumentHistoryFilterOptionsSqlQuery({
      baseQuery,
      columnFilters,
      filterKeys: [...SYSTEM_DOCUMENT_HISTORY_FILTER_KEYS],
      key: fieldKey,
      search,
      limit: DOCUMENT_HISTORY_FILTER_OPTION_LIMIT,
    }))
    return normalizeSqlDocumentHistoryFilterOptions(
      result.rows,
      DOCUMENT_HISTORY_FILTER_OPTION_LIMIT,
    )
  })
}

export async function loadSystemDocumentRows(data: SystemDocumentReference): Promise<WeldRow[]> {
  const { db, rows, metadata } = await loadSystemDocumentRowSource(data)

  if (metadata?.sourceKind === 'beforeHeatTreatment') {
    const rowsWithPreControls = await attachPreHeatTreatmentControlRelations(rows, db)
    return (await overlaySourcedSystemDocumentRows(rowsWithPreControls, metadata))
      .map(compactSystemDocumentRow)
  }

  const hydratedRows = metadata?.sourceKind
    ? await overlaySourcedSystemDocumentRows(rows, metadata)
    : rows
  return (await attachPreHeatTreatmentControlRelations(hydratedRows, db))
    .map(compactSystemDocumentRow)
}

export async function loadSystemDocumentDateContext(
  data: SystemDocumentReference,
): Promise<SystemDocumentDateContext> {
  const { db, rows, metadata } = await loadSystemDocumentRowSource(data)
  const hydratedRows = await attachDuplicateControlRelations(
    await attachHeatTreatmentControlRelations(rows, db),
    db,
  )
  return {
    rows: hydratedRows.map(compactSystemDocumentRow),
    sourcePositions: metadata?.sourcePositions ?? [],
  }
}

async function loadSystemDocumentRowSource(data: SystemDocumentReference) {
  const db = requireDb()
  const expectedStorageType = systemDocumentStorageType(getSystemDocumentTemplateId(data))
  let sourceMetadata: unknown = null
  const sourcedDocumentId = !data.documentId && data.sourceKind
    ? await findSourcedSystemDocumentId(db, data, expectedStorageType)
    : undefined
  const documentId = data.documentId ?? sourcedDocumentId
  if (data.sourceKind && !documentId && data.sourceKind !== 'pstoCycle') {
    return { db, rows: [] as WeldRow[], metadata: null }
  }
  const rows = documentId
    ? await db
        .select({ ...WELD_TABLE_SELECT, sourceMetadata: generatedDocuments.sourceMetadata })
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
          return records.map(({ sourceMetadata: _sourceMetadata, ...record }) => record)
        })
    : await db
        .select(WELD_TABLE_SELECT)
        .from(weldJoints)
        .where(buildSystemDocumentWhere(data))
        .orderBy(
          asc(weldJoints.projectTitle),
          asc(weldJoints.subtitleCode),
          asc(weldJoints.line),
          asc(weldJoints.joint),
        )

  return {
    db,
    rows: rows as WeldRow[],
    metadata: parseSystemDocumentMetadata(sourceMetadata),
  }
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
  const [documentId] = await upsertSourcedSystemDocumentsInTransaction({
    tx,
    documents: [{ summary, sourcePositions }],
  })
  return documentId
}

export type SourcedSystemDocumentUpsertInput = {
  summary: SystemDocumentSummary & { sourceKind: SystemDocumentSourceKind }
  sourcePositions: SystemDocumentSourcePosition[]
}

type SourcedSystemDocumentUpsertGroup = SourcedSystemDocumentUpsertInput & {
  inputIndexes: number[]
  scopeKey: string
  storageType: string
}

type SourcedSystemDocumentUpsertPlan = SourcedSystemDocumentUpsertGroup & {
  targetDocumentId: number | null
  redundantDocumentIds: number[]
  rowIds: number[]
  sourceMetadata: string
}

export async function upsertSourcedSystemDocumentsInTransaction({
  tx,
  documents,
}: {
  tx: SystemDocumentSequenceTransaction
  documents: readonly SourcedSystemDocumentUpsertInput[]
}) {
  if (documents.length === 0) return []
  await lockLayeredControlDocumentsForWeldChange(tx)
  await lockSystemDocumentIndexes(tx, documents.map(({ summary }) => summary.type))
  const groups = groupSourcedSystemDocumentUpserts(documents)
  const candidates = await loadSourcedSystemDocumentCandidates(tx, groups)
  const candidateIds = [...new Set(candidates.map((document) => document.id))]
  const existingAssignments = candidateIds.length > 0
    ? await tx
      .select({
        documentId: generatedDocumentWeldJoints.documentId,
        weldJointId: generatedDocumentWeldJoints.weldJointId,
      })
      .from(generatedDocumentWeldJoints)
      .where(buildNumberArrayMatch(generatedDocumentWeldJoints.documentId, candidateIds))
    : []
  const candidatesByLookupKey = new Map<string, typeof candidates>()
  for (const candidate of candidates) {
    const key = sourcedSystemDocumentLookupKey(candidate.type, candidate.title, candidate.periodFrom ?? '')
    const current = candidatesByLookupKey.get(key) ?? []
    current.push(candidate)
    candidatesByLookupKey.set(key, current)
  }

  const plans = groups.map((group): SourcedSystemDocumentUpsertPlan => {
    const summary = group.summary
    const matchingCandidates = candidatesByLookupKey.get(
      sourcedSystemDocumentLookupKey(group.storageType, summary.title, summary.date),
    ) ?? []
    const sourcedExisting = matchingCandidates.find((document) => {
      const metadata = parseSystemDocumentMetadata(document.sourceMetadata)
      return (
        metadata?.sourceKind === summary.sourceKind &&
        String(metadata.methodCode ?? '') === String(summary.methodCode ?? '') &&
        (summary.sourceKind === 'pstoCycle' || sameCycleSequences(metadata.cycleSequences, summary.cycleSequences))
      )
    })
    const legacyPrimaryDocuments = summary.sourceKind === 'pstoCycle' &&
      (summary.cycleSequences ?? []).includes(1)
      ? matchingCandidates.filter((document) => isCompatibleLegacyPrimaryDocument(document, summary))
      : []
    const existing = sourcedExisting ?? legacyPrimaryDocuments[0]
    const mergedDocuments = [
      ...(sourcedExisting ? [sourcedExisting] : []),
      ...legacyPrimaryDocuments.filter((document) => document.id !== sourcedExisting?.id),
    ]
    const mergedDocumentIds = new Set(mergedDocuments.map((document) => document.id))
    const assignments = existingAssignments.filter((assignment) => mergedDocumentIds.has(assignment.documentId))
    const existingMetadata = parseSystemDocumentMetadata(existing?.sourceMetadata)
    const rowIds = [...new Set([
      ...assignments.map((assignment) => assignment.weldJointId),
      ...summary.rowIds,
    ])].sort((left, right) => left - right)
    const mergedSourcePositions = normalizeSystemDocumentSourcePositions([
      ...(existingMetadata?.sourcePositions ?? []),
      ...legacyPrimaryDocuments.flatMap((document) => {
        const methodCode = summary.methodCode === 'ТВМТ' ? 'ТВМТ' : undefined
        return assignments
          .filter((assignment) => assignment.documentId === document.id)
          .map((assignment) => ({
            kind: 'pstoCycle' as const,
            weldJointId: assignment.weldJointId,
            relationId: assignment.weldJointId,
            sequence: 1,
            ...(methodCode ? { methodCode } : {}),
          }))
      }),
      ...group.sourcePositions,
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
    return {
      ...group,
      summary: mergedSummary,
      sourcePositions: mergedSourcePositions,
      targetDocumentId: existing?.id ?? null,
      redundantDocumentIds: mergedDocuments
        .map((document) => document.id)
        .filter((documentId) => documentId !== existing?.id),
      rowIds,
      sourceMetadata: serializeSystemDocumentSummary(mergedSummary, mergedSourcePositions),
    }
  })

  const documentIdsByScope = await persistSourcedSystemDocumentUpsertPlans(tx, plans)
  const result = Array<number>(documents.length)
  for (const plan of plans) {
    const documentId = documentIdsByScope.get(plan.scopeKey)
    if (!documentId) throw new Error('Не удалось сохранить системный документ.')
    plan.inputIndexes.forEach((inputIndex) => {
      result[inputIndex] = documentId
    })
  }
  return result
}

function groupSourcedSystemDocumentUpserts(
  documents: readonly SourcedSystemDocumentUpsertInput[],
): SourcedSystemDocumentUpsertGroup[] {
  const groups = new Map<string, SourcedSystemDocumentUpsertGroup>()
  documents.forEach((document, inputIndex) => {
    const storageType = systemDocumentStorageType(getSystemDocumentTemplateId(document.summary))
    const scopeKey = sourcedSystemDocumentScopeKey(storageType, document.summary)
    const sourcePositions = normalizeSystemDocumentSourcePositions(document.sourcePositions)
    const current = groups.get(scopeKey)
    if (!current) {
      groups.set(scopeKey, {
        summary: { ...document.summary },
        sourcePositions,
        inputIndexes: [inputIndex],
        scopeKey,
        storageType,
      })
      return
    }

    const mergedSourcePositions = normalizeSystemDocumentSourcePositions([
      ...current.sourcePositions,
      ...sourcePositions,
    ])
    const rowIds = [...new Set([
      ...current.summary.rowIds,
      ...document.summary.rowIds,
    ])].sort((left, right) => left - right)
    current.summary = {
      ...document.summary,
      sourceKind: document.summary.sourceKind,
      rowIds,
      rowCount: rowIds.length,
      positionCount: mergedSourcePositions.length,
      cycleSequences: normalizeCycleSequences(mergedSourcePositions.map((position) => position.sequence)),
      methodCodes: mergeStringArrays(current.summary.methodCodes, document.summary.methodCodes),
      projects: mergeStringArrays(current.summary.projects, document.summary.projects),
      subtitleCodes: mergeStringArrays(current.summary.subtitleCodes, document.summary.subtitleCodes),
      lines: mergeStringArrays(current.summary.lines, document.summary.lines),
      periodFrom: minText(current.summary.periodFrom, document.summary.periodFrom),
      periodTo: maxText(current.summary.periodTo, document.summary.periodTo),
    }
    current.sourcePositions = mergedSourcePositions
    current.inputIndexes.push(inputIndex)
  })
  return [...groups.values()]
}

async function loadSourcedSystemDocumentCandidates(
  tx: SystemDocumentSequenceTransaction,
  groups: readonly SourcedSystemDocumentUpsertGroup[],
) {
  const lookups = [...new Map(groups.map((group) => {
    const lookup = {
      storageType: group.storageType,
      date: group.summary.date,
      title: group.summary.title,
    }
    return [sourcedSystemDocumentLookupKey(lookup.storageType, lookup.title, lookup.date), lookup]
  })).values()]
  if (lookups.length === 0) return []

  return tx
    .select()
    .from(generatedDocuments)
    .where(buildSourcedSystemDocumentCandidateWhere(lookups))
}

export function buildSourcedSystemDocumentCandidateWhere(
  lookups: readonly { storageType: string; date: string; title: string }[],
) {
  if (lookups.length === 0) return sql`false`
  return sql`exists (
    select 1
    from unnest(
      ${sql.param(lookups.map((lookup) => lookup.storageType))}::text[],
      ${sql.param(lookups.map((lookup) => lookup.date))}::text[],
      ${sql.param(lookups.map((lookup) => lookup.title))}::text[]
    ) as lookup(storage_type, document_date, title)
    where ${generatedDocuments.type} = lookup.storage_type
      and coalesce(${generatedDocuments.periodFrom}::text, '') = lookup.document_date
      and ${generatedDocuments.title} = lookup.title
  )`
}

export async function persistSourcedSystemDocumentUpsertPlans(
  tx: SystemDocumentSequenceTransaction,
  plans: readonly SourcedSystemDocumentUpsertPlan[],
  now = new Date(),
) {
  const documentIdsByScope = new Map<string, number>()
  const existingPlans = plans.filter((plan) => plan.targetDocumentId != null)
  if (existingPlans.length > 0) {
    await tx.execute(sql`
      update "generated_documents" as document
      set
        "file_name" = refreshed.file_name,
        "row_count" = refreshed.row_count,
        "source_metadata" = refreshed.source_metadata,
        "updated_at" = ${now}
      from unnest(
        ${sql.param(existingPlans.map((plan) => plan.targetDocumentId!))}::integer[],
        ${sql.param(existingPlans.map((plan) => plan.summary.fileName))}::text[],
        ${sql.param(existingPlans.map((plan) => plan.rowIds.length))}::integer[],
        ${sql.param(existingPlans.map((plan) => plan.sourceMetadata))}::text[]
      ) as refreshed(id, file_name, row_count, source_metadata)
      where document."id" = refreshed.id
    `)
    existingPlans.forEach((plan) => documentIdsByScope.set(plan.scopeKey, plan.targetDocumentId!))
  }

  const newPlans = plans.filter((plan) => plan.targetDocumentId == null)
  if (newPlans.length > 0) {
    const insertedResult = await tx.execute(sql`
      insert into "generated_documents" (
        "type",
        "title",
        "file_name",
        "mime_type",
        "period_from",
        "period_to",
        "row_count",
        "source_metadata"
      )
      select
        source.type,
        source.title,
        source.file_name,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        source.period_date,
        source.period_date,
        source.row_count,
        source.source_metadata
      from unnest(
        ${sql.param(newPlans.map((plan) => plan.storageType))}::text[],
        ${sql.param(newPlans.map((plan) => plan.summary.title))}::text[],
        ${sql.param(newPlans.map((plan) => plan.summary.fileName))}::text[],
        ${sql.param(newPlans.map((plan) => plan.summary.date || null))}::date[],
        ${sql.param(newPlans.map((plan) => plan.rowIds.length))}::integer[],
        ${sql.param(newPlans.map((plan) => plan.sourceMetadata))}::text[]
      ) as source(type, title, file_name, period_date, row_count, source_metadata)
      returning
        "id",
        "type",
        "title",
        "period_from" as "periodFrom",
        "source_metadata" as "sourceMetadata"
    `)
    const inserted = insertedResult.rows as Array<Pick<
      typeof generatedDocuments.$inferSelect,
      'id' | 'type' | 'title' | 'periodFrom' | 'sourceMetadata'
    >>
    for (const document of inserted) {
      const metadata = parseSystemDocumentMetadata(document.sourceMetadata)
      if (!metadata?.sourceKind) continue
      documentIdsByScope.set(
        sourcedSystemDocumentScopeKey(document.type, {
          title: document.title,
          date: document.periodFrom ?? '',
          sourceKind: metadata.sourceKind,
          methodCode: metadata.methodCode,
          cycleSequences: metadata.cycleSequences,
        }),
        document.id,
      )
    }
    for (const plan of newPlans) {
      if (!documentIdsByScope.has(plan.scopeKey)) {
        throw new Error('Не удалось сопоставить созданный системный документ.')
      }
    }
  }

  const targetDocumentIds = new Set(documentIdsByScope.values())
  const redundantDocumentIds = [...new Set(plans
    .flatMap((plan) => plan.redundantDocumentIds)
    .filter((documentId) => !targetDocumentIds.has(documentId)))]
  if (redundantDocumentIds.length > 0) {
    await tx.delete(generatedDocuments).where(buildNumberArrayMatch(generatedDocuments.id, redundantDocumentIds))
  }

  await replaceGeneratedDocumentAssignmentsInTransaction(
    tx,
    existingPlans.map((plan) => plan.targetDocumentId!),
    plans.map((plan) => {
      const documentId = documentIdsByScope.get(plan.scopeKey)
      if (!documentId) throw new Error('Не удалось определить запись системного документа.')
      return { documentId, rowIds: plan.rowIds }
    }),
  )
  return documentIdsByScope
}

function sourcedSystemDocumentLookupKey(storageType: string, title: string, date: string) {
  return JSON.stringify([storageType, title, date])
}

function sourcedSystemDocumentScopeKey(
  storageType: string,
  reference: Pick<SystemDocumentReference, 'title' | 'date' | 'sourceKind' | 'methodCode' | 'cycleSequences'>,
) {
  return JSON.stringify([
    storageType,
    reference.title,
    reference.date,
    reference.sourceKind ?? '',
    reference.methodCode ?? '',
    ...(reference.sourceKind === 'pstoCycle'
      ? []
      : normalizeCycleSequences(reference.cycleSequences)),
  ])
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

  await lockLayeredControlDocumentsForWeldChange(tx)
  await lockSystemDocumentIndexes(tx)
  const candidateWeldJointIds = new Set([
    ...removedWeldJointIds,
    ...sourcePositions.map((position) => Number(position.weldJointId)),
  ])
  if (removedIds.size > 0 && sourceKind === 'beforeHeatTreatment') {
    const controls = await tx
      .select({ weldJointId: preHeatTreatmentControls.weldJointId })
      .from(preHeatTreatmentControls)
      .where(buildNumberArrayMatch(preHeatTreatmentControls.id, [...removedIds]))
    controls.forEach((control) => candidateWeldJointIds.add(control.weldJointId))
  }
  if (removedIds.size > 0 && (sourceKind === 'pstoRepeat' || sourceKind === 'pstoCycle')) {
    const cycles = await tx
      .select({ weldJointId: pstoRepeatCycles.weldJointId })
      .from(pstoRepeatCycles)
      .where(buildNumberArrayMatch(pstoRepeatCycles.id, [...removedIds]))
    cycles.forEach((cycle) => candidateWeldJointIds.add(cycle.weldJointId))
    if (sourceKind === 'pstoCycle') {
      removedIds.forEach((id) => candidateWeldJointIds.add(id))
    }
  }
  const candidateIds = [...candidateWeldJointIds]
    .filter((id) => Number.isInteger(id) && id > 0)
  if (candidateIds.length === 0) return
  const documentsById = new Map<number, typeof generatedDocuments.$inferSelect>()
  const documentRows = await tx
    .select({ document: generatedDocuments })
    .from(generatedDocumentWeldJoints)
    .innerJoin(
      generatedDocuments,
      eq(generatedDocuments.id, generatedDocumentWeldJoints.documentId),
    )
    .where(buildNumberArrayMatch(generatedDocumentWeldJoints.weldJointId, candidateIds))
  documentRows.forEach(({ document }) => documentsById.set(document.id, document))
  const changes = [...documentsById.values()].flatMap((document) => {
    const metadata = parseSystemDocumentMetadata(document.sourceMetadata)
    if (metadata?.sourceKind !== sourceKind) return []
    const remainingPositions = metadata.sourcePositions.filter((position) => {
      if (position.kind !== sourceKind) return true
      if (removedWeldJointIds.has(position.weldJointId)) return false
      if (removedPositionKeys.has(getSourcePositionMatchKey(position))) return false
      return !removedIds.has(position.relationId)
    })
    return remainingPositions.length === metadata.sourcePositions.length
      ? []
      : [{ document, metadata, remainingPositions }]
  })
  const remainingRowIds = [...new Set(changes.flatMap(({ remainingPositions }) =>
    remainingPositions.map((position) => position.weldJointId),
  ))]
  const rowsById = new Map<number, Pick<
    typeof weldJoints.$inferSelect,
    'id' | 'projectTitle' | 'subtitleCode' | 'line' | 'weldDate'
  >>()
  if (remainingRowIds.length > 0) {
    const rows = await tx
      .select({
        id: weldJoints.id,
        projectTitle: weldJoints.projectTitle,
        subtitleCode: weldJoints.subtitleCode,
        line: weldJoints.line,
        weldDate: weldJoints.weldDate,
      })
      .from(weldJoints)
      .where(buildNumberArrayMatch(weldJoints.id, remainingRowIds))
    rows.forEach((row) => rowsById.set(row.id, row))
  }
  const persistedChanges = changes.map(({ document, metadata, remainingPositions }) => {
    const rowIds = [...new Set(remainingPositions.map((position) => position.weldJointId))]
      .sort((left, right) => left - right)
    if (rowIds.length === 0) {
      return { documentId: document.id, rowIds, sourceMetadata: document.sourceMetadata ?? '' }
    }
    const rows = rowIds.flatMap((rowId) => {
      const row = rowsById.get(rowId)
      return row ? [row] : []
    })
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
    return {
      documentId: document.id,
      rowIds,
      sourceMetadata: JSON.stringify(nextMetadata),
    }
  })
  await persistSourcedSystemDocumentChangesInTransaction(tx, persistedChanges)
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

  const [preControls, repeatCycles] = await Promise.all([
    tx
      .select({ id: preHeatTreatmentControls.id })
      .from(preHeatTreatmentControls)
      .where(buildNumberArrayMatch(preHeatTreatmentControls.weldJointId, rowIds)),
    tx
      .select({ id: pstoRepeatCycles.id })
      .from(pstoRepeatCycles)
      .where(buildNumberArrayMatch(pstoRepeatCycles.weldJointId, rowIds)),
  ])

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

  await syncLayeredControlDocumentsForWeldChangesInTransaction(tx, currentRows, previousRows)

  const changes = SYSTEM_DOCUMENT_INDEX_LOCK_ORDER.flatMap((type) => {
    const previousReferences = collectSystemDocumentReferences([...previousRows.values()], type)
    const currentReferences = collectSystemDocumentReferences(currentRows, type)
    if (!hasSystemDocumentImpact({ currentRows, previousRows, type })) return []
    const affectedReferences = uniqueSystemDocumentReferences([
      ...previousReferences,
      ...currentReferences,
    ])
    return affectedReferences.length > 0
      ? [{ type, previousReferences, affectedReferences }]
      : []
  })
  await lockSystemDocumentIndexes(tx, changes.map((change) => change.type))

  for (const { type, previousReferences, affectedReferences } of changes) {
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
  const documentIds = new Set<number>()
  const assignments = await tx
    .select({ documentId: generatedDocumentWeldJoints.documentId })
    .from(generatedDocumentWeldJoints)
    .where(buildNumberArrayMatch(generatedDocumentWeldJoints.weldJointId, changedRowIds))
  assignments.forEach((assignment) => documentIds.add(assignment.documentId))
  if (documentIds.size === 0) return

  const documents = await tx
    .select()
    .from(generatedDocuments)
    .where(buildNumberArrayMatch(generatedDocuments.id, [...documentIds]))
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
      .where(buildNumberArrayMatch(weldJoints.id, sourceRowIds))
    : []

  const changes = sourcedDocuments.map(({ document, metadata }) => {
    const summary = buildSourcedSystemDocumentMetadataSummary({
      sourcePositions: metadata.sourcePositions,
      rows,
    })
    if (summary.sourcePositions.length === 0) {
      return { documentId: document.id, rowIds: [], sourceMetadata: document.sourceMetadata ?? '' }
    }
    const nextMetadata: SystemDocumentMetadata = {
      ...metadata,
      ...summary,
    }
    return {
      documentId: document.id,
      rowIds: summary.rowIds,
      sourceMetadata: JSON.stringify(nextMetadata),
    }
  })
  await persistSourcedSystemDocumentChangesInTransaction(tx, changes)
}

export async function persistSourcedSystemDocumentChangesInTransaction(
  tx: SystemDocumentSequenceTransaction,
  changes: readonly {
    documentId: number
    rowIds: readonly number[]
    sourceMetadata: string
  }[],
  now = new Date(),
) {
  const normalizedChanges = [...new Map(changes
    .filter((change) => Number.isInteger(change.documentId) && change.documentId > 0)
    .map((change) => [change.documentId, {
      ...change,
      rowIds: [...new Set(change.rowIds
        .map(Number)
        .filter((rowId) => Number.isInteger(rowId) && rowId > 0))]
        .sort((left, right) => left - right),
    }])).values()]
    .sort((left, right) => left.documentId - right.documentId)
  if (normalizedChanges.length === 0) return

  const emptyDocumentIds = normalizedChanges
    .filter((change) => change.rowIds.length === 0)
    .map((change) => change.documentId)
  if (emptyDocumentIds.length > 0) {
    await tx.delete(generatedDocuments).where(buildNumberArrayMatch(generatedDocuments.id, emptyDocumentIds))
  }

  const retainedChanges = normalizedChanges.filter((change) => change.rowIds.length > 0)
  if (retainedChanges.length === 0) return
  await tx.execute(sql`
    update "generated_documents" as document
    set
      "row_count" = refreshed.row_count,
      "source_metadata" = refreshed.source_metadata,
      "updated_at" = ${now}
    from unnest(
      ${sql.param(retainedChanges.map((change) => change.documentId))}::integer[],
      ${sql.param(retainedChanges.map((change) => change.rowIds.length))}::integer[],
      ${sql.param(retainedChanges.map((change) => change.sourceMetadata))}::text[]
    ) as refreshed(id, row_count, source_metadata)
    where document."id" = refreshed.id
  `)
  await replaceGeneratedDocumentAssignmentsInTransaction(
    tx,
    retainedChanges.map((change) => change.documentId),
    retainedChanges,
  )
}

export async function persistSystemDocumentSummaryRecordsInTransaction({
  tx,
  summaries,
  matchedDocumentIds,
  now = new Date(),
}: {
  tx: SystemDocumentSequenceTransaction
  summaries: readonly SystemDocumentSummary[]
  matchedDocumentIds: ReadonlyMap<number, number>
  now?: Date
}) {
  const entries = summaries.map((summary, summaryIndex) => ({ summary, summaryIndex }))
  const resolvedDocumentIds = new Map(matchedDocumentIds)
  const existingEntries = entries.filter(({ summaryIndex }) => resolvedDocumentIds.has(summaryIndex))
  if (existingEntries.length > 0) {
    await tx.execute(sql`
      update "generated_documents" as document
      set
        "title" = refreshed.title,
        "file_name" = refreshed.file_name,
        "period_from" = refreshed.period_date,
        "period_to" = refreshed.period_date,
        "row_count" = refreshed.row_count,
        "source_metadata" = refreshed.source_metadata,
        "updated_at" = refreshed.updated_at
      from unnest(
        ${sql.param(existingEntries.map(({ summaryIndex }) => resolvedDocumentIds.get(summaryIndex)!))}::integer[],
        ${sql.param(existingEntries.map(({ summary }) => summary.title))}::text[],
        ${sql.param(existingEntries.map(({ summary }) => summary.fileName))}::text[],
        ${sql.param(existingEntries.map(({ summary }) => summary.date || null))}::date[],
        ${sql.param(existingEntries.map(({ summary }) => summary.rowCount))}::integer[],
        ${sql.param(existingEntries.map(({ summary }) => serializeSystemDocumentSummary(summary)))}::text[],
        ${sql.param(existingEntries.map(({ summary }) => (
          summary.updatedAt ? new Date(summary.updatedAt).toISOString() : now.toISOString()
        )))}::timestamptz[]
      ) as refreshed(
        id,
        title,
        file_name,
        period_date,
        row_count,
        source_metadata,
        updated_at
      )
      where document."id" = refreshed.id
    `)
  }

  const newEntries = entries.filter(({ summaryIndex }) => !resolvedDocumentIds.has(summaryIndex))
  let insertedDocuments: Array<Pick<
    typeof generatedDocuments.$inferSelect,
    'id' | 'type' | 'title' | 'periodFrom' | 'sourceMetadata'
  >> = []
  if (newEntries.length > 0) {
    const insertedResult = await tx.execute(sql`
      insert into "generated_documents" (
        "type",
        "title",
        "file_name",
        "mime_type",
        "period_from",
        "period_to",
        "row_count",
        "source_metadata"
      )
      select
        source.type,
        source.title,
        source.file_name,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        source.period_date,
        source.period_date,
        source.row_count,
        source.source_metadata
      from unnest(
        ${sql.param(newEntries.map(({ summary }) => systemDocumentStorageType(getSystemDocumentTemplateId(summary))))}::text[],
        ${sql.param(newEntries.map(({ summary }) => summary.title))}::text[],
        ${sql.param(newEntries.map(({ summary }) => summary.fileName))}::text[],
        ${sql.param(newEntries.map(({ summary }) => summary.date || null))}::date[],
        ${sql.param(newEntries.map(({ summary }) => summary.rowCount))}::integer[],
        ${sql.param(newEntries.map(({ summary }) => serializeSystemDocumentSummary(summary)))}::text[]
      ) as source(type, title, file_name, period_date, row_count, source_metadata)
      returning
        "id",
        "type",
        "title",
        "period_from" as "periodFrom",
        "source_metadata" as "sourceMetadata"
    `)
    insertedDocuments = insertedResult.rows as typeof insertedDocuments
  }
  if (insertedDocuments.length !== newEntries.length) {
    throw new Error('Не удалось создать все записи системных документов.')
  }
  const insertedMatches = matchSystemDocumentIdentityIds({
    documents: insertedDocuments.map(toStoredSystemDocumentIdentity),
    targets: newEntries.map(({ summary }) => toSystemDocumentIdentityTarget(summary)),
    assignedRowsByDocument: new Map(),
  })
  for (const [newEntryIndex, { summaryIndex }] of newEntries.entries()) {
    const documentId = insertedMatches.get(newEntryIndex)
    if (!documentId) throw new Error('Не удалось сопоставить созданный системный документ.')
    resolvedDocumentIds.set(summaryIndex, documentId)
  }

  return entries.map(({ summary, summaryIndex }) => {
    const documentId = resolvedDocumentIds.get(summaryIndex)
    if (!documentId) throw new Error('Не удалось определить запись системного документа.')
    return {
      ...summary,
      documentId,
      id: `system-document:${documentId}`,
    }
  })
}

async function replaceGeneratedDocumentAssignmentsInTransaction(
  tx: SystemDocumentSequenceTransaction,
  documentIdsToClear: readonly number[],
  summaries: readonly Pick<SystemDocumentSummary, 'documentId' | 'rowIds'>[],
) {
  const documentIds = [...new Set(documentIdsToClear
    .map(Number)
    .filter((documentId) => Number.isInteger(documentId) && documentId > 0))]
    .sort((left, right) => left - right)
  if (documentIds.length > 0) {
    await tx
      .delete(generatedDocumentWeldJoints)
      .where(buildNumberArrayMatch(generatedDocumentWeldJoints.documentId, documentIds))
  }

  const assignments = [...new Map(summaries.flatMap((summary) =>
    summary.rowIds.map((weldJointId) => ({
      documentId: Number(summary.documentId),
      weldJointId: Number(weldJointId),
    })))
    .filter((assignment) => (
      Number.isInteger(assignment.documentId) && assignment.documentId > 0 &&
      Number.isInteger(assignment.weldJointId) && assignment.weldJointId > 0
    ))
    .map((assignment) => [`${assignment.documentId}:${assignment.weldJointId}`, assignment])).values()]
  if (assignments.length > 0) {
    await tx.execute(sql`
      insert into "generated_document_weld_joints" ("document_id", "weld_joint_id")
      select source.document_id, source.weld_joint_id
      from unnest(
        ${sql.param(assignments.map((assignment) => assignment.documentId))}::integer[],
        ${sql.param(assignments.map((assignment) => assignment.weldJointId))}::integer[]
      ) as source(document_id, weld_joint_id)
      on conflict do nothing
    `)
  }
}

async function insertGeneratedDocumentAssignments(
  tx: SystemDocumentSequenceTransaction,
  documentId: number,
  weldJointIds: readonly number[],
) {
  const rowIds = [...new Set(weldJointIds)]
  if (rowIds.length === 0) return
  await tx.execute(sql`
    insert into "generated_document_weld_joints" ("document_id", "weld_joint_id")
    select ${documentId}::integer, source.weld_joint_id
    from unnest(${sql.param(rowIds)}::integer[]) as source(weld_joint_id)
    on conflict do nothing
  `)
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
      .where(buildNumberArrayMatch(generatedDocumentWeldJoints.documentId, existingDocumentIds))
    : []
  const assignedRowsByDocument = new Map<number, Set<number>>()
  for (const assignment of existingAssignments) {
    const ids = assignedRowsByDocument.get(assignment.documentId) ?? new Set<number>()
    ids.add(assignment.weldJointId)
    assignedRowsByDocument.set(assignment.documentId, ids)
  }

  const matchedDocumentIds = matchSystemDocumentIdentityIds({
    documents: existingDocuments.map(toStoredSystemDocumentIdentity),
    targets: effectiveSummaries.map(toSystemDocumentIdentityTarget),
    assignedRowsByDocument,
  })
  const indexedSummaries = await persistSystemDocumentSummaryRecordsInTransaction({
    tx,
    summaries: effectiveSummaries,
    matchedDocumentIds,
  })
  const usedDocumentIds = new Set(indexedSummaries.map((summary) => summary.documentId))
  await replaceGeneratedDocumentAssignmentsInTransaction(
    tx,
    [...usedDocumentIds],
    indexedSummaries,
  )

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
    await tx.delete(generatedDocuments).where(buildNumberArrayMatch(generatedDocuments.id, staleDocumentIds))
  }
}

function collectSystemDocumentReferences(
  rows: Array<Partial<WeldRow> & Pick<WeldRow, 'id'>>,
  type: SystemDocumentType,
) {
  return buildSystemDocumentSummaries(rows, type).map(toSystemDocumentReference)
}

function toSystemDocumentIdentityTarget(summary: SystemDocumentSummary) {
  const identityScope = getSystemDocumentIdentityScope(summary)
  return {
    type: systemDocumentStorageType(getSystemDocumentTemplateId(summary)),
    title: summary.title,
    date: summary.date,
    rowIds: summary.rowIds,
    ...(identityScope ? { identityScope } : {}),
  }
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
  await rebuildSystemDocumentIndexInTransaction(tx, type)
  await markSystemDocumentIndexInitialized(tx, type)
}

export async function rebuildSystemDocumentIndexInTransaction(
  tx: SystemDocumentSequenceTransaction,
  type: SystemDocumentType,
) {
  const suffix = type.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()
  const positionsTable = sql.identifier(`system_document_positions_${suffix}`)
  const targetsTable = sql.identifier(`system_document_targets_${suffix}`)
  const matchesTable = sql.identifier(`system_document_matches_${suffix}`)
  const currentDocumentsTable = sql.identifier(`system_document_current_${suffix}`)
  const storageTypes = getSystemDocumentStorageTypes(type)
  if (storageTypes.length === 0) return

  await tx.execute(sql`
    create temporary table ${positionsTable} on commit drop as
    ${buildSystemDocumentIndexPositionsQuery(type)}
  `)
  await tx.execute(sql`
    create index on ${positionsTable} ("storageType", "documentDate", "title")
  `)
  await tx.execute(sql`
    create temporary table ${targetsTable} on commit drop as
    select
      "positions"."storageType",
      "positions"."title",
      "positions"."documentDate",
      max("positions"."label") as "label",
      max(nullif("positions"."referenceMethodCode", '')) as "methodCode",
      count(distinct "positions"."rowId")::integer as "rowCount",
      count(*)::integer as "positionCount",
      coalesce(
        to_jsonb(array_agg(distinct "positions"."methodCode" order by "positions"."methodCode")
          filter (where "positions"."methodCode" <> '')),
        '[]'::jsonb
      ) as "methodCodes",
      coalesce(
        to_jsonb(array_agg(distinct "positions"."projectTitle" order by "positions"."projectTitle")
          filter (where "positions"."projectTitle" <> '')),
        '[]'::jsonb
      ) as "projects",
      coalesce(
        to_jsonb(array_agg(distinct "positions"."subtitleCode" order by "positions"."subtitleCode")
          filter (where "positions"."subtitleCode" <> '')),
        '[]'::jsonb
      ) as "subtitleCodes",
      coalesce(
        to_jsonb(array_agg(distinct "positions"."line" order by "positions"."line")
          filter (where "positions"."line" <> '')),
        '[]'::jsonb
      ) as "lines",
      coalesce(min("positions"."weldDate"), '') as "periodFrom",
      coalesce(max("positions"."weldDate"), '') as "periodTo",
      max("positions"."updatedAt") as "updatedAt"
    from ${positionsTable} as "positions"
    group by
      "positions"."storageType",
      "positions"."title",
      "positions"."documentDate"
    having not (
      bool_or("positions"."legacyCycle")
      and exists (
        select 1
        from ${generatedDocuments} as "sourced_document"
        where "sourced_document"."type" = "positions"."storageType"
          and "sourced_document"."title" = "positions"."title"
          and coalesce("sourced_document"."period_from"::text, '') = "positions"."documentDate"
          and coalesce("sourced_document"."source_metadata", '') ~ ${'"sourceKind"\\s*:\\s*"pstoCycle"'}
      )
    )
  `)
  await tx.execute(sql`
    create unique index on ${targetsTable} ("storageType", "documentDate", "title")
  `)
  await tx.execute(sql`
    create temporary table ${matchesTable} on commit drop as
    select
      "target"."storageType",
      "target"."documentDate",
      "target"."title",
      min("document"."id")::integer as "documentId"
    from ${targetsTable} as "target"
    inner join ${generatedDocuments} as "document"
      on "document"."type" = "target"."storageType"
      and "document"."title" = "target"."title"
      and "document"."period_from" is not distinct from nullif("target"."documentDate", '')::date
      and coalesce("document"."source_metadata", '') !~ ${'"sourceKind"\\s*:'}
    group by
      "target"."storageType",
      "target"."documentDate",
      "target"."title"
  `)
  await tx.execute(sql`
    create unique index on ${matchesTable} ("storageType", "documentDate", "title")
  `)
  await tx.execute(sql`
    create unique index on ${matchesTable} ("documentId")
  `)

  await tx.execute(sql`
    update ${generatedDocuments} as "document"
    set
      "file_name" = coalesce(
        nullif(btrim(regexp_replace(regexp_replace("target"."title", ${'[\\/:*?"<>|]'}, '-', 'g'), ${'\\s+'}, ' ', 'g')), ''),
        'Документ'
      ) || '.xlsx',
      "mime_type" = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      "period_from" = nullif("target"."documentDate", '')::date,
      "period_to" = nullif("target"."documentDate", '')::date,
      "row_count" = "target"."rowCount",
      "source_metadata" = ${buildSystemDocumentTargetMetadataSql(sql`"target"`)},
      "updated_at" = "target"."updatedAt"
    from ${targetsTable} as "target"
    inner join ${matchesTable} as "match"
      on "match"."storageType" = "target"."storageType"
      and "match"."documentDate" = "target"."documentDate"
      and "match"."title" = "target"."title"
    where "document"."id" = "match"."documentId"
  `)

  await tx.execute(sql`
    insert into ${generatedDocuments} (
      "type",
      "title",
      "file_name",
      "mime_type",
      "period_from",
      "period_to",
      "row_count",
      "source_metadata",
      "updated_at"
    )
    select
      "target"."storageType",
      "target"."title",
      coalesce(
        nullif(btrim(regexp_replace(regexp_replace("target"."title", ${'[\\/:*?"<>|]'}, '-', 'g'), ${'\\s+'}, ' ', 'g')), ''),
        'Документ'
      ) || '.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      nullif("target"."documentDate", '')::date,
      nullif("target"."documentDate", '')::date,
      "target"."rowCount",
      ${buildSystemDocumentTargetMetadataSql(sql`"target"`)},
      "target"."updatedAt"
    from ${targetsTable} as "target"
    left join ${matchesTable} as "match"
      on "match"."storageType" = "target"."storageType"
      and "match"."documentDate" = "target"."documentDate"
      and "match"."title" = "target"."title"
    where "match"."documentId" is null
  `)

  await tx.execute(sql`
    create temporary table ${currentDocumentsTable} on commit drop as
    select
      "target"."storageType",
      "target"."documentDate",
      "target"."title",
      min("document"."id")::integer as "documentId"
    from ${targetsTable} as "target"
    inner join ${generatedDocuments} as "document"
      on "document"."type" = "target"."storageType"
      and "document"."title" = "target"."title"
      and "document"."period_from" is not distinct from nullif("target"."documentDate", '')::date
      and coalesce("document"."source_metadata", '') !~ ${'"sourceKind"\\s*:'}
    group by
      "target"."storageType",
      "target"."documentDate",
      "target"."title"
  `)
  await tx.execute(sql`
    create unique index on ${currentDocumentsTable} ("storageType", "documentDate", "title")
  `)
  await tx.execute(sql`
    create unique index on ${currentDocumentsTable} ("documentId")
  `)
  await tx.execute(sql`
    delete from ${generatedDocuments} as "document"
    where "document"."type" in (${sql.join(storageTypes.map((value) => sql`${value}`), sql`, `)})
      and coalesce("document"."source_metadata", '') !~ ${'"sourceKind"\\s*:'}
      and not exists (
        select 1
        from ${currentDocumentsTable} as "current_document"
        where "current_document"."documentId" = "document"."id"
      )
  `)

  await tx.execute(sql`
    delete from ${generatedDocumentWeldJoints} as "assignment"
    using ${generatedDocuments} as "document"
    where "assignment"."document_id" = "document"."id"
      and "document"."type" in (${sql.join(storageTypes.map((value) => sql`${value}`), sql`, `)})
      and coalesce("document"."source_metadata", '') !~ ${'"sourceKind"\\s*:'}
  `)
  await tx.execute(sql`
    insert into ${generatedDocumentWeldJoints} ("document_id", "weld_joint_id")
    select distinct
      "current_document"."documentId",
      "positions"."rowId"
    from ${positionsTable} as "positions"
    inner join ${currentDocumentsTable} as "current_document"
      on "current_document"."storageType" = "positions"."storageType"
      and "current_document"."title" = "positions"."title"
      and "current_document"."documentDate" = "positions"."documentDate"
    on conflict do nothing
  `)
}

function buildSystemDocumentIndexPositionsQuery(type: SystemDocumentType) {
  const entries = getSystemDocumentIndexPositionEntries(type)
  return sql`
    select
      "position"."storageType",
      "position"."rowId",
      "position"."title",
      "position"."documentDate",
      "position"."referenceMethodCode",
      "position"."methodCode",
      "position"."label",
      "position"."legacyCycle",
      btrim(coalesce(${weldJoints.projectTitle}::text, '')) as "projectTitle",
      btrim(coalesce(${weldJoints.subtitleCode}::text, '')) as "subtitleCode",
      btrim(coalesce(${weldJoints.line}::text, '')) as "line",
      coalesce(${weldJoints.weldDate}::text, '') as "weldDate",
      ${weldJoints.updatedAt} as "updatedAt"
    from ${weldJoints}
    cross join lateral (values ${sql.join(entries, sql`, `)}) as "position"(
      "storageType",
      "rowId",
      "title",
      "documentDate",
      "referenceMethodCode",
      "methodCode",
      "label",
      "legacyCycle"
    )
    where "position"."title" <> ''
  `
}

function getSystemDocumentIndexPositionEntries(type: SystemDocumentType) {
  if (type === 'lnkRequest') {
    return LNK_METHODS.map((method) => {
      const isTvmt = method.code === 'ТВМТ'
      return buildSystemDocumentIndexPositionEntry({
        storageType: systemDocumentStorageType(isTvmt ? 'tvmtRequest' : 'lnkRequest'),
        title: weldJoints[method.requestKey],
        date: weldJoints[method.requestDateKey],
        referenceMethodCode: isTvmt ? method.code : '',
        methodCode: method.code,
        label: isTvmt ? 'Заявка ТВМТ' : 'Заявка ЛНК',
        legacyCycle: isTvmt,
      })
    })
  }
  if (type === 'lnkConclusion') {
    return LNK_METHODS.map((method) => {
      const isTvmt = method.code === 'ТВМТ'
      return buildSystemDocumentIndexPositionEntry({
        storageType: systemDocumentStorageType(getSystemDocumentTemplateId({
          type: 'lnkConclusion',
          methodCode: method.code,
        })),
        title: weldJoints[method.conclusionKey],
        date: weldJoints[method.conclusionDateKey],
        referenceMethodCode: method.code,
        methodCode: method.code,
        label: isTvmt ? 'Заключение ТВМТ' : 'Заключение ЛНК',
        legacyCycle: isTvmt,
      })
    })
  }
  if (type === 'pstoRequest') {
    return [buildSystemDocumentIndexPositionEntry({
      storageType: systemDocumentStorageType('pstoRequest'),
      title: weldJoints.pstoRequest,
      date: weldJoints.pstoRequestDate,
      label: 'Заявка ПСТО',
      legacyCycle: true,
    })]
  }
  return [buildSystemDocumentIndexPositionEntry({
    storageType: systemDocumentStorageType('pstoConclusion'),
    title: weldJoints.heatTreatmentDiagram,
    date: weldJoints.pstoDate,
    label: 'Заключение ПСТО',
    legacyCycle: true,
  })]
}

function buildSystemDocumentIndexPositionEntry({
  storageType,
  title,
  date,
  referenceMethodCode = '',
  methodCode = '',
  label,
  legacyCycle,
}: {
  storageType: string
  title: SQLWrapper
  date: SQLWrapper
  referenceMethodCode?: string
  methodCode?: string
  label: string
  legacyCycle: boolean
}) {
  return sql`(
    ${storageType}::text,
    ${weldJoints.id}::integer,
    btrim(coalesce(${title}::text, '')),
    coalesce(${date}::text, ''),
    ${referenceMethodCode}::text,
    ${methodCode}::text,
    ${label}::text,
    ${legacyCycle}::boolean
  )`
}

function buildSystemDocumentTargetMetadataSql(target: SQL) {
  return sql`jsonb_strip_nulls(jsonb_build_object(
    'label', ${target}."label",
    'methodCode', ${target}."methodCode",
    'cycleSequences', '[]'::jsonb,
    'methodCodes', ${target}."methodCodes",
    'positionCount', ${target}."positionCount",
    'projects', ${target}."projects",
    'subtitleCodes', ${target}."subtitleCodes",
    'lines', ${target}."lines",
    'periodFrom', ${target}."periodFrom",
    'periodTo', ${target}."periodTo",
    'sourcePositions', '[]'::jsonb
  ))::text`
}

function buildIndexedSystemDocumentHistoryBaseQuery(
  type: SystemDocumentType,
  storageTypes: string[],
  documentId?: number,
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
        where ${documentId
          ? and(
              inArray(generatedDocuments.type, storageTypes),
              eq(generatedDocuments.id, documentId),
            )
          : inArray(generatedDocuments.type, storageTypes)}
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
  const storageTypes = getSystemDocumentStorageTypes(type)
  if (storageTypes.length === 0) return []
  const documents = await tx
    .select()
    .from(generatedDocuments)
    .where(inArray(generatedDocuments.type, storageTypes))
  if (documents.length === 0) return []
  const documentIds = documents.map((document) => document.id)
  const assignments = documentIds.length > 0
    ? await tx
      .select({
        documentId: generatedDocumentWeldJoints.documentId,
        weldJointId: generatedDocumentWeldJoints.weldJointId,
      })
      .from(generatedDocumentWeldJoints)
      .where(buildNumberArrayMatch(generatedDocumentWeldJoints.documentId, documentIds))
    : []
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

function getSystemDocumentStorageTypes(type: SystemDocumentType) {
  return SYSTEM_DOCUMENT_TEMPLATE_PROFILES
    .filter((profile) => profile.documentType === type)
    .map((profile) => systemDocumentStorageType(profile.id))
}

export type SystemDocumentMetadata = Pick<
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

export function parseSystemDocumentMetadata(value: unknown): SystemDocumentMetadata | null {
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

function toStoredSystemDocumentIdentity(document: Pick<
  typeof generatedDocuments.$inferSelect,
  'id' | 'type' | 'title' | 'periodFrom' | 'sourceMetadata'
>) {
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
  rows: Array<WeldRow & Pick<WeldRow, 'preHeatTreatmentControls'>>,
  metadata: SystemDocumentMetadata,
) {
  if (metadata.sourceKind === 'beforeHeatTreatment') {
    const relationIds = new Set(metadata.sourcePositions
      .filter((position) => position.kind === 'beforeHeatTreatment')
      .map((position) => position.relationId))
    if (relationIds.size === 0) return rows
    return rows.map((row) => buildPreHeatTreatmentSystemDocumentRow(
      row as unknown as WeldRow,
      (row.preHeatTreatmentControls ?? [])
        .filter((relation) => relationIds.has(relation.id)),
    ))
  }

  const db = requireDb()
  if (metadata.sourceKind === 'pstoCycle') {
    const repeatRelationIds = metadata.sourcePositions
      .filter((position) => position.kind === 'pstoCycle' && Number(position.sequence) >= 2)
      .map((position) => position.relationId)
    const repeatRelations = repeatRelationIds.length > 0
      ? await db
        .select()
        .from(pstoRepeatCycles)
        .where(buildNumberArrayMatch(pstoRepeatCycles.id, repeatRelationIds))
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
      .where(buildNumberArrayMatch(pstoRepeatCycles.id, relationIds))
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
  await lockSystemDocumentIndexes(tx, [type])
}

export async function lockSystemDocumentIndexes(
  tx: SystemDocumentSequenceTransaction,
  types: readonly SystemDocumentType[] = SYSTEM_DOCUMENT_INDEX_LOCK_ORDER,
) {
  const selectedTypes = [...new Set(types)]
    .sort((left, right) => (
      SYSTEM_DOCUMENT_INDEX_LOCK_ORDER.indexOf(left) - SYSTEM_DOCUMENT_INDEX_LOCK_ORDER.indexOf(right)
    ))
  if (selectedTypes.length === 0) return
  const values = sql.join(
    selectedTypes.map((type) => sql`(
      ${SYSTEM_DOCUMENT_INDEX_LOCK_ORDER.indexOf(type)},
      ${`system-document-index:${type}`}
    )`),
    sql`, `,
  )
  await tx.execute(sql`
    with "system_document_lock_keys"("lock_order", "lock_key") as materialized (
      values ${values}
    ),
    "ordered_system_document_lock_keys" as materialized (
      select "lock_order", "lock_key"
      from "system_document_lock_keys"
      order by "lock_order"
    )
    select pg_advisory_xact_lock(hashtext("lock_key"))
    from "ordered_system_document_lock_keys"
    order by "lock_order"
  `)
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
