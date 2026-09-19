import { createServerFn } from '@tanstack/react-start'
import { and, asc, count, eq, inArray, max, min, sql } from 'drizzle-orm'

import { requireDb } from '@/db'
import { appSettings, generatedDocuments, generatedDocumentWeldJoints, weldJoints } from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import { buildGeneratedDocumentAssignmentPlan } from '@/lib/generated-document-assignment'
import { resolveGeneratedDocumentNamePattern } from '@/lib/generated-document-naming'
import {
  GENERATED_DOCUMENT_TYPES,
  getGeneratedDocumentProfile,
  isGeneratedDocumentType,
  isLayeredControlDocumentType,
  isManualGeneratedDocumentType,
  MANUAL_GENERATED_DOCUMENT_TYPES,
  type GeneratedDocumentType,
} from '@/lib/generated-document-types'
import { DEFAULT_OTHER_SETTINGS, normalizeOtherSettings, type OtherSettings } from '@/lib/other-settings'
import { PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'
import type { WeldInput } from '@/lib/weld-fields'
import type { WeldRowVersionTarget } from '@/lib/weld-row-version'
import { parseWeldColumnChoiceFilter } from '@/lib/weld-column-choice-filter'
import { calculateWdi, isSystemWdiMode, withSystemWdi } from '@/lib/wdi'
import { attachGeneratedDocumentFields } from '@/server/generated-document-row-fields'
import { attachPreHeatTreatmentControlRelations } from '@/server/heat-treatment-control-relations'
import {
  buildDocumentHistorySqlQuery,
  normalizeSqlDocumentHistoryResult,
} from '@/server/document-history-sql'
import { buildCurrentWdiSqlExpression } from '@/server/current-wdi-sql'
import { assertSecurityScope } from '@/server/security-functions'
import { getNextTimestampVersion } from '@/server/timestamp-version'
import { getLayeredControlStageLabel } from '@/lib/layered-control-documents'
import { ensureLayeredControlDocumentsInitialized } from '@/server/layered-control-documents'
import {
  lockGeneratedDocumentNumberCounter,
  lockGeneratedDocumentNumberSequence,
  readGeneratedDocumentNextNumber,
  writeGeneratedDocumentNextNumber,
  type GeneratedDocumentNumberSequence,
  type GeneratedDocumentsTransaction,
} from '@/server/generated-document-number-sequence'
import {
  lockAndAssertInteractiveWeldVersions,
  lockInteractiveWeldRows,
} from '@/server/weld-row-version'
import { splitNumberBatches } from '@/server/weld-request-utils'

export type { GeneratedDocumentType } from '@/lib/generated-document-types'

export type RemoteGeneratedDocument = {
  id: number
  type: GeneratedDocumentType
  title: string
  fileName: string
  mimeType: string
  createdAt: string
  updatedAt: string
  periodFrom?: string
  periodTo?: string
  rowCount: number
  wdiTotal?: number
  documentNumber?: number
  stage?: string
  projects: string[]
  subtitleCodes: string[]
  lines: string[]
}

export type RemoteDocumentHistoryFilterOption = {
  value: string
  label: string
  count: number
}

export type RemoteGeneratedDocumentHistoryRequest = {
  type?: GeneratedDocumentType
  types?: GeneratedDocumentType[]
  documentId?: number
  limit?: number
  columnFilters?: Record<string, string>
}

export type RemoteGeneratedDocumentHistoryResult = {
  documents: RemoteGeneratedDocument[]
  total: number
  filterOptions: Record<string, RemoteDocumentHistoryFilterOption[]>
}

export type SaveGeneratedDocumentInput = {
  type: GeneratedDocumentType
  title: string
  fileName: string
  mimeType: string
  weldJointIds: number[]
  expectedVersions: WeldRowVersionTarget[]
  periodFrom?: string
  periodTo?: string
  rowCount?: number
  wdiTotal?: number
}

export const listRemoteGeneratedDocuments = createServerFn({ method: 'GET' })
  .validator((data: { type: GeneratedDocumentType }) => ({
    type: isGeneratedDocumentType(data?.type) ? data.type : 'weldingJournal',
  }))
  .handler(async ({ data }) => {
    await assertSecurityScope('entry')
    return loadRemoteGeneratedDocuments(data.type)
  })

async function loadRemoteGeneratedDocuments(type: GeneratedDocumentType) {
  if (isLayeredControlDocumentType(type)) await ensureLayeredControlDocumentsInitialized()
  const db = requireDb()
  const records = await db
    .select({
      document: generatedDocuments,
      assignmentCount: count(generatedDocumentWeldJoints.weldJointId),
      periodFrom: min(weldJoints.weldDate),
      periodTo: max(weldJoints.weldDate),
      projects: sql<string[]>`
        coalesce(
          array_agg(distinct ${weldJoints.projectTitle} order by ${weldJoints.projectTitle})
            filter (where nullif(btrim(${weldJoints.projectTitle}), '') is not null),
          array[]::text[]
        )
      `,
      subtitleCodes: sql<string[]>`
        coalesce(
          array_agg(distinct ${weldJoints.subtitleCode} order by ${weldJoints.subtitleCode})
            filter (where nullif(btrim(${weldJoints.subtitleCode}), '') is not null),
          array[]::text[]
        )
      `,
      lines: sql<string[]>`
        coalesce(
          array_agg(distinct ${weldJoints.line} order by ${weldJoints.line})
            filter (where nullif(btrim(${weldJoints.line}), '') is not null),
          array[]::text[]
        )
      `,
    })
    .from(generatedDocuments)
    .leftJoin(generatedDocumentWeldJoints, eq(generatedDocumentWeldJoints.documentId, generatedDocuments.id))
    .leftJoin(weldJoints, eq(weldJoints.id, generatedDocumentWeldJoints.weldJointId))
    .where(eq(generatedDocuments.type, type))
    .groupBy(generatedDocuments.id)
    .orderBy(sql`${generatedDocuments.updatedAt} desc`)

  const currentWdiTotals = await calculateGeneratedDocumentWdiTotals(db, records.map(({ document }) => document.id))
  return records.map(({ document, assignmentCount, periodFrom, periodTo, projects, subtitleCodes, lines }) =>
    toRemoteGeneratedDocument({
      ...document,
      rowCount: Number(assignmentCount),
      periodFrom,
      periodTo,
      wdiTotal: currentWdiTotals.get(document.id) ?? 0,
      projects,
      subtitleCodes,
      lines,
    }),
  )
}

export const listRemoteGeneratedDocumentHistory = createServerFn({ method: 'GET' })
  .validator(normalizeGeneratedDocumentHistoryRequest)
  .handler(async ({ data }): Promise<RemoteGeneratedDocumentHistoryResult> => {
    await assertSecurityScope('entry')
    return loadRemoteGeneratedDocumentHistory(data)
  })

const GENERATED_DOCUMENT_HISTORY_FILTER_KEYS = [
  'title',
  'stage',
  'project',
  'subtitle',
  'line',
  'period',
  'rowCount',
  'wdi',
  'updatedAt',
]

async function loadRemoteGeneratedDocumentHistory(
  data: ReturnType<typeof normalizeGeneratedDocumentHistoryRequest>,
): Promise<RemoteGeneratedDocumentHistoryResult> {
  if (data.types.some(isLayeredControlDocumentType)) {
    await ensureLayeredControlDocumentsInitialized()
  }
  const db = requireDb()
  const otherSettings = await loadGeneratedDocumentOtherSettings(db)
  const currentWdi = buildCurrentWdiSqlExpression(otherSettings, {
    connectionType: weldJoints.connectionType,
    d1: weldJoints.d1,
    d2: weldJoints.d2,
    t1: weldJoints.t1,
    t2: weldJoints.t2,
    wdi: weldJoints.wdi,
  })
  const baseQuery = sql`
    select
      "document_aggregate".*,
      array["document_aggregate"."title"]::text[] as "filter_title",
      array[
        case
          when "document_aggregate"."type" in ('layeredVikEdges', 'layeredPvkEdges') then 'Кромки'
          when "document_aggregate"."type" in ('layeredVikLayers', 'layeredPvkLayers') then 'Слои'
          else ''
        end
      ]::text[] as "filter_stage",
      case
        when cardinality("document_aggregate"."projects") = 0 then array['']::text[]
        else "document_aggregate"."projects"
      end as "filter_project",
      case
        when cardinality("document_aggregate"."subtitleCodes") = 0 then array['']::text[]
        else "document_aggregate"."subtitleCodes"
      end as "filter_subtitle",
      case
        when cardinality("document_aggregate"."lines") = 0 then array['']::text[]
        else "document_aggregate"."lines"
      end as "filter_line",
      array[
        case
          when "document_aggregate"."periodFrom" is null and "document_aggregate"."periodTo" is null then ''
          else concat(
            coalesce(to_char("document_aggregate"."periodFrom", 'DD.MM.YYYY'), ''),
            ' - ',
            coalesce(to_char("document_aggregate"."periodTo", 'DD.MM.YYYY'), '')
          )
        end
      ]::text[] as "filter_period",
      array["document_aggregate"."rowCount"::text]::text[] as "filter_rowCount",
      array[
        replace(
          rtrim(
            rtrim(to_char("document_aggregate"."wdiTotal", 'FM999999999990.00'), '0'),
            '.'
          ),
          '.',
          ','
        )
      ]::text[] as "filter_wdi",
      array[
        to_char(
          "document_aggregate"."updatedAt" at time zone 'Europe/Moscow',
          'DD.MM.YYYY, HH24:MI'
        )
      ]::text[] as "filter_updatedAt"
    from (
      select
        ${generatedDocuments.id} as "id",
        ${generatedDocuments.type} as "type",
        ${generatedDocuments.title} as "title",
        ${generatedDocuments.fileName} as "fileName",
        ${generatedDocuments.mimeType} as "mimeType",
        min(${weldJoints.weldDate}) as "periodFrom",
        max(${weldJoints.weldDate}) as "periodTo",
        count(${generatedDocumentWeldJoints.weldJointId})::integer as "rowCount",
        coalesce(sum(${currentWdi}), 0)::numeric as "wdiTotal",
        ${generatedDocuments.documentNumber} as "documentNumber",
        ${generatedDocuments.createdAt} as "createdAt",
        ${generatedDocuments.updatedAt} as "updatedAt",
        coalesce(
          array_agg(distinct ${weldJoints.projectTitle} order by ${weldJoints.projectTitle})
            filter (where nullif(btrim(${weldJoints.projectTitle}), '') is not null),
          array[]::text[]
        ) as "projects",
        coalesce(
          array_agg(distinct ${weldJoints.subtitleCode} order by ${weldJoints.subtitleCode})
            filter (where nullif(btrim(${weldJoints.subtitleCode}), '') is not null),
          array[]::text[]
        ) as "subtitleCodes",
        coalesce(
          array_agg(distinct ${weldJoints.line} order by ${weldJoints.line})
            filter (where nullif(btrim(${weldJoints.line}), '') is not null),
          array[]::text[]
        ) as "lines"
      from ${generatedDocuments}
      left join ${generatedDocumentWeldJoints}
        on ${generatedDocumentWeldJoints.documentId} = ${generatedDocuments.id}
      left join ${weldJoints}
        on ${weldJoints.id} = ${generatedDocumentWeldJoints.weldJointId}
      where ${data.documentId
        ? and(
            inArray(generatedDocuments.type, data.types),
            eq(generatedDocuments.id, data.documentId),
          )
        : inArray(generatedDocuments.type, data.types)}
      group by ${generatedDocuments.id}
    ) as "document_aggregate"
  `
  const result = await db.execute(buildDocumentHistorySqlQuery({
    baseQuery,
    columnFilters: data.columnFilters,
    filterKeys: GENERATED_DOCUMENT_HISTORY_FILTER_KEYS,
    limit: data.limit,
    orderBy: sql`"updatedAt" desc, "id" desc`,
  }))
  return normalizeSqlDocumentHistoryResult(
    result.rows[0],
    GENERATED_DOCUMENT_HISTORY_FILTER_KEYS,
    toRemoteGeneratedDocumentHistoryRow,
  )
}

export function normalizeGeneratedDocumentHistoryRequest(
  data: RemoteGeneratedDocumentHistoryRequest | undefined,
) {
  const types = normalizeGeneratedDocumentHistoryTypes(data)
  const documentId = normalizeDocumentHistoryDocumentId(data?.documentId)
  return {
    type: types[0],
    types,
    ...(documentId ? { documentId } : {}),
    limit: normalizeDocumentHistoryLimit(data?.limit),
    columnFilters: normalizeDocumentHistoryColumnFilters(data?.columnFilters),
  }
}

function normalizeGeneratedDocumentHistoryTypes(
  data: RemoteGeneratedDocumentHistoryRequest | undefined,
): GeneratedDocumentType[] {
  const values = Array.isArray(data?.types) ? data.types : [data?.type]
  const types = [...new Set(values.filter(isGeneratedDocumentType))]
  return types.length > 0 ? types : ['weldingJournal']
}

export function normalizeDocumentHistoryLimit(value: unknown) {
  const numeric = Math.floor(Number(value))
  if (!Number.isFinite(numeric)) return 100
  return Math.max(1, numeric)
}

export function normalizeDocumentHistoryDocumentId(value: unknown) {
  const numeric = Number(value)
  if (!Number.isSafeInteger(numeric) || numeric <= 0) return undefined
  return numeric
}

export function normalizeDocumentHistoryColumnFilters(value: unknown) {
  if (!value || typeof value !== 'object') return {}
  const normalized: Record<string, string> = {}
  for (const [key, rawFilter] of Object.entries(value)) {
    const filter = String(rawFilter ?? '').trim()
    if (filter) normalized[key] = filter
  }
  return normalized
}

export function buildRemoteDocumentHistoryResult<TDocument>({
  documents,
  columnFilters,
  limit,
  getValues,
  filterKeys,
}: {
  documents: TDocument[]
  columnFilters: Record<string, string>
  limit: number
  getValues: (documentRecord: TDocument, key: string) => string[]
  filterKeys: string[]
}) {
  const filteredDocuments = filterRemoteDocumentHistoryItems(documents, columnFilters, getValues)
  return {
    documents: filteredDocuments.slice(0, limit),
    total: filteredDocuments.length,
    filterOptions: Object.fromEntries(
      filterKeys.map((key) => [
        key,
        getRemoteDocumentHistoryFilterOptions(documents, columnFilters, key, getValues),
      ]),
    ),
  }
}

function filterRemoteDocumentHistoryItems<TDocument>(
  documents: TDocument[],
  columnFilters: Record<string, string>,
  getValues: (documentRecord: TDocument, key: string) => string[],
) {
  return documents.filter((documentRecord) =>
    Object.entries(columnFilters).every(([key, filterValue]) => {
      const values = getValues(documentRecord, key)
      const choiceFilter = parseWeldColumnChoiceFilter(filterValue)
      if (choiceFilter?.kind === 'values') {
        const selectedValues = new Set(choiceFilter.values.map(normalizeDocumentHistoryFilterValue))
        return values.some((value) => selectedValues.has(normalizeDocumentHistoryFilterValue(value)))
      }
      const normalizedQuery = filterValue.toLocaleLowerCase('ru-RU')
      return values.some((value) => value.toLocaleLowerCase('ru-RU').includes(normalizedQuery))
    }),
  )
}

function getRemoteDocumentHistoryFilterOptions<TDocument>(
  documents: TDocument[],
  columnFilters: Record<string, string>,
  key: string,
  getValues: (documentRecord: TDocument, key: string) => string[],
) {
  const filtersWithoutCurrent = { ...columnFilters }
  delete filtersWithoutCurrent[key]
  const counts = new Map<string, number>()
  for (const documentRecord of filterRemoteDocumentHistoryItems(documents, filtersWithoutCurrent, getValues)) {
    for (const value of getValues(documentRecord, key)) {
      const normalized = String(value ?? '').trim()
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
    }
  }
  return Array.from(counts.entries())
    .map(([value, count]) => ({
      value,
      count,
      label: value || '(пусто)',
    }))
    .sort(compareRemoteDocumentHistoryFilterOptions)
}

function compareRemoteDocumentHistoryFilterOptions(
  left: RemoteDocumentHistoryFilterOption,
  right: RemoteDocumentHistoryFilterOption,
) {
  if (left.value === '') return -1
  if (right.value === '') return 1
  const leftNumber = Number(left.value.replace(',', '.'))
  const rightNumber = Number(right.value.replace(',', '.'))
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber
  return left.label.localeCompare(right.label, 'ru', { numeric: true, sensitivity: 'base' })
}

function getGeneratedDocumentHistoryFilterValues(
  documentRecord: RemoteGeneratedDocument,
  key: string,
) {
  if (key === 'title') return [documentRecord.title]
  if (key === 'stage') return [documentRecord.stage ?? '']
  if (key === 'project') return documentRecord.projects.length ? documentRecord.projects : ['']
  if (key === 'subtitle') return documentRecord.subtitleCodes.length ? documentRecord.subtitleCodes : ['']
  if (key === 'line') return documentRecord.lines.length ? documentRecord.lines : ['']
  if (key === 'period') {
    const periodFrom = formatDocumentHistoryDate(documentRecord.periodFrom)
    const periodTo = formatDocumentHistoryDate(documentRecord.periodTo)
    return [periodFrom || periodTo ? `${periodFrom} - ${periodTo}` : '']
  }
  if (key === 'updatedAt') return [formatDocumentHistoryDateTime(documentRecord.updatedAt)]
  if (key === 'rowCount') return [String(documentRecord.rowCount)]
  if (key === 'wdi') return [formatDocumentHistoryNumber(documentRecord.wdiTotal)]
  return ['']
}

function normalizeDocumentHistoryFilterValue(value: string) {
  return value.trim().toLocaleLowerCase('ru-RU')
}

function formatDocumentHistoryDate(value: unknown) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return raw
  return parsed.toLocaleDateString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function formatDocumentHistoryDateTime(value: unknown) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return raw
  return parsed.toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDocumentHistoryNumber(value: unknown) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(value) || 0)
}

export const getRemoteGeneratedDocument = createServerFn({ method: 'GET' })
  .validator((data: { id: number }) => ({ id: requirePositiveId(data?.id, 'документа') }))
  .handler(async ({ data }): Promise<RemoteGeneratedDocument | null> => {
    await assertSecurityScope('entry')
    const db = requireDb()
    const [record] = await db
      .select()
      .from(generatedDocuments)
      .where(
        and(
          eq(generatedDocuments.id, data.id),
          inArray(generatedDocuments.type, [...GENERATED_DOCUMENT_TYPES]),
        ),
      )
      .limit(1)
    if (!record) return null
    const currentWdiTotals = await calculateGeneratedDocumentWdiTotals(db, [record.id])
    return toRemoteGeneratedDocument({
      ...record,
      wdiTotal: currentWdiTotals.get(record.id) ?? record.wdiTotal,
    })
  })

export const saveRemoteGeneratedDocuments = createServerFn({ method: 'POST' })
  .validator(normalizeSaveGeneratedDocumentBatch)
  .handler(async ({ data }): Promise<RemoteGeneratedDocument[]> => {
    await assertSecurityScope('documentGeneration')
    const db = requireDb()
    return db.transaction(async (tx) => {
      const numberSequence = await lockGeneratedDocumentNumberSequence(tx, data[0].type)
      const otherSettings = await loadGeneratedDocumentOtherSettings(tx)
      const savedDocuments = await saveGeneratedDocumentBatchInTransaction(
        tx,
        data,
        numberSequence,
        otherSettings,
      )
      await numberSequence.persist()
      return savedDocuments
    })
  })

export const getRemoteGeneratedDocumentSequence = createServerFn({ method: 'GET' })
  .validator((data: { type: GeneratedDocumentType }) => ({ type: requireGeneratedDocumentType(data?.type) }))
  .handler(async ({ data }) => {
    await assertSecurityScope('entry')
    if (isLayeredControlDocumentType(data.type)) await ensureLayeredControlDocumentsInitialized()
    const db = requireDb()
    return {
      type: data.type,
      nextNumber: await readGeneratedDocumentNextNumber(db, data.type),
    }
  })

export const resetRemoteGeneratedDocumentSequence = createServerFn({ method: 'POST' })
  .validator((data: { type: GeneratedDocumentType }) => ({ type: requireGeneratedDocumentType(data?.type) }))
  .handler(async ({ data }) => {
    await assertSecurityScope('settings')
    const db = requireDb()
    await db.transaction(async (tx) => {
      await lockGeneratedDocumentNumberCounter(tx, data.type)
      await writeGeneratedDocumentNextNumber(tx, data.type, 1)
    })
    return { type: data.type, nextNumber: 1 }
  })

type ExistingGeneratedDocumentAssignment = {
  documentId: number
  weldJointId: number
  documentNumber: number | null
  documentUpdatedAt: Date
}

type GeneratedDocumentBatchRecord = {
  inputIndex: number
  type: GeneratedDocumentType
  title: string
  fileName: string
  mimeType: string
  periodFrom: string | null
  periodTo: string | null
  rowCount: number
  wdiTotal: number
  documentNumber: number
  targetDocumentId: number | null
  updatedAt: Date
}

export function buildGeneratedDocumentBatchAssignmentPlans({
  selectedWeldJointIdGroups,
  existingAssignments,
  documentAssignmentCounts,
}: {
  selectedWeldJointIdGroups: readonly (readonly number[])[]
  existingAssignments: readonly Pick<ExistingGeneratedDocumentAssignment, 'documentId' | 'weldJointId'>[]
  documentAssignmentCounts: ReadonlyMap<number, number>
}) {
  let simulatedAssignments = existingAssignments.map((assignment) => ({ ...assignment }))
  const simulatedCounts = new Map(documentAssignmentCounts)
  let nextVirtualDocumentId = -1

  return selectedWeldJointIdGroups.map((selectedWeldJointIds) => {
    const assignmentPlan = buildGeneratedDocumentAssignmentPlan({
      selectedWeldJointIds,
      existingAssignments: simulatedAssignments,
      documentAssignmentCounts: simulatedCounts,
    })
    const selectedIds = new Set(selectedWeldJointIds)
    const removedAssignments = simulatedAssignments.filter((assignment) =>
      selectedIds.has(assignment.weldJointId),
    )
    simulatedAssignments = simulatedAssignments.filter((assignment) =>
      !selectedIds.has(assignment.weldJointId),
    )
    for (const assignment of removedAssignments) {
      simulatedCounts.set(
        assignment.documentId,
        Math.max(0, (simulatedCounts.get(assignment.documentId) ?? 0) - 1),
      )
    }

    const simulatedTargetId = assignmentPlan.targetDocumentId ?? nextVirtualDocumentId--
    simulatedAssignments.push(...selectedWeldJointIds.map((weldJointId) => ({
      documentId: simulatedTargetId,
      weldJointId,
    })))
    simulatedCounts.set(
      simulatedTargetId,
      (simulatedCounts.get(simulatedTargetId) ?? 0) + selectedWeldJointIds.length,
    )
    return assignmentPlan
  })
}

async function saveGeneratedDocumentBatchInTransaction(
  tx: GeneratedDocumentsTransaction,
  data: readonly SaveGeneratedDocumentInput[],
  numberSequence: GeneratedDocumentNumberSequence,
  otherSettings: OtherSettings,
): Promise<RemoteGeneratedDocument[]> {
  const selectedIds = data.flatMap((input) => input.weldJointIds)
  const currentRows = await lockAndAssertInteractiveWeldVersions(
    tx,
    selectedIds,
    data.flatMap((input) => input.expectedVersions),
  )
  const currentRowsById = new Map(currentRows.map((row) => [row.id, row]))
  const existingAssignments: ExistingGeneratedDocumentAssignment[] = []
  for (const selectedIdBatch of splitNumberBatches(selectedIds, 1000)) {
    existingAssignments.push(...await tx
      .select({
        documentId: generatedDocumentWeldJoints.documentId,
        weldJointId: generatedDocumentWeldJoints.weldJointId,
        documentNumber: generatedDocuments.documentNumber,
        documentUpdatedAt: generatedDocuments.updatedAt,
      })
      .from(generatedDocumentWeldJoints)
      .innerJoin(generatedDocuments, eq(generatedDocuments.id, generatedDocumentWeldJoints.documentId))
      .where(
        and(
          inArray(generatedDocumentWeldJoints.weldJointId, selectedIdBatch),
          eq(generatedDocuments.type, data[0].type),
        ),
      ))
  }
  const existingDocumentIds = [...new Set(existingAssignments.map((assignment) => assignment.documentId))]
  const documentAssignmentCounts = new Map<number, number>()
  for (const documentIdBatch of splitNumberBatches(existingDocumentIds, 1000)) {
    const documentCounts = await tx
        .select({
          documentId: generatedDocumentWeldJoints.documentId,
          total: count(),
        })
        .from(generatedDocumentWeldJoints)
        .where(inArray(generatedDocumentWeldJoints.documentId, documentIdBatch))
        .groupBy(generatedDocumentWeldJoints.documentId)
    documentCounts.forEach((record) => {
      documentAssignmentCounts.set(record.documentId, Number(record.total))
    })
  }
  const assignmentPlans = buildGeneratedDocumentBatchAssignmentPlans({
    selectedWeldJointIdGroups: data.map((input) => input.weldJointIds),
    existingAssignments,
    documentAssignmentCounts,
  })
  const now = new Date()
  const existingDocumentById = new Map(existingAssignments.map((assignment) => [
    assignment.documentId,
    {
      documentNumber: assignment.documentNumber,
      updatedAt: assignment.documentUpdatedAt,
    },
  ]))
  const records: GeneratedDocumentBatchRecord[] = data.map((input, inputIndex) => {
    const targetDocumentId = assignmentPlans[inputIndex].targetDocumentId
    const existingDocument = targetDocumentId == null
      ? undefined
      : existingDocumentById.get(targetDocumentId)
    const documentNumber = existingDocument?.documentNumber ?? numberSequence.take()
    const currentWdiTotal = input.weldJointIds.reduce((total, weldJointId) => {
      const row = currentRowsById.get(weldJointId)
      return total + (row ? calculateWdi(row as unknown as WeldInput, otherSettings) ?? 0 : 0)
    }, 0)
    return {
      inputIndex,
      type: input.type,
      title: resolveGeneratedDocumentNamePattern(input.title, { documentNumber }),
      fileName: resolveGeneratedDocumentNamePattern(input.fileName, { documentNumber }),
      mimeType: input.mimeType,
      periodFrom: input.periodFrom || null,
      periodTo: input.periodTo || null,
      rowCount: input.weldJointIds.length,
      wdiTotal: currentWdiTotal,
      documentNumber,
      targetDocumentId,
      updatedAt: existingDocument?.updatedAt
        ? getNextTimestampVersion(existingDocument.updatedAt, now)
        : now,
    }
  })
  const resolvedDocumentIds = await persistGeneratedDocumentBatchRecordsInTransaction(tx, records)

  if (existingDocumentIds.length > 0) {
    for (const selectedIdBatch of splitNumberBatches(selectedIds, 1000)) {
      const idValues = sql.join(selectedIdBatch.map((id) => sql`${id}`), sql`, `)
      await tx.execute(sql`
        delete from "generated_document_weld_joints" as assignment
        using "generated_documents" as document
        where assignment."document_id" = document."id"
          and document."type" = ${data[0].type}
          and assignment."weld_joint_id" in (${idValues})
      `)
    }
  }
  const nextAssignments = data.flatMap((input, inputIndex) => {
    const documentId = resolvedDocumentIds.get(inputIndex)
    if (!documentId) throw new Error('Не удалось сохранить сформированный документ.')
    return input.weldJointIds.map((weldJointId) => ({ documentId, weldJointId }))
  })
  for (let offset = 0; offset < nextAssignments.length; offset += 1000) {
    await tx
      .insert(generatedDocumentWeldJoints)
      .values(nextAssignments.slice(offset, offset + 1000))
      .onConflictDoNothing()
  }

  const targetDocumentIds = new Set(resolvedDocumentIds.values())
  const staleDocumentIds = assignmentPlans
    .flatMap((assignmentPlan) => assignmentPlan.affectedDocumentIds)
    .filter((documentId) => !targetDocumentIds.has(documentId))
  await refreshStaleGeneratedDocumentsInTransaction({
    tx,
    staleDocumentIds,
    documentUpdatedAtById: new Map(
      existingAssignments.map((assignment) => [assignment.documentId, assignment.documentUpdatedAt]),
    ),
    otherSettings,
    now,
  })

  await touchWeldingProfile(tx, selectedIds, now)
  const savedDocumentsById = new Map<number, typeof generatedDocuments.$inferSelect>()
  for (const documentIdBatch of splitNumberBatches([...targetDocumentIds], 1000)) {
    const savedDocuments = await tx
      .select()
      .from(generatedDocuments)
      .where(inArray(generatedDocuments.id, documentIdBatch))
    savedDocuments.forEach((document) => savedDocumentsById.set(document.id, document))
  }

  return data.map((_, inputIndex) => {
    const documentId = resolvedDocumentIds.get(inputIndex)
    const document = documentId ? savedDocumentsById.get(documentId) : undefined
    if (!document) throw new Error('Не удалось загрузить сформированный документ после сохранения.')
    return toRemoteGeneratedDocument(document)
  })
}

export async function persistGeneratedDocumentBatchRecordsInTransaction(
  tx: GeneratedDocumentsTransaction,
  records: readonly GeneratedDocumentBatchRecord[],
) {
  const resolvedDocumentIds = new Map<number, number>()
  const existingRecords = records.filter((record) => record.targetDocumentId != null)
  for (let offset = 0; offset < existingRecords.length; offset += 250) {
    const batch = existingRecords.slice(offset, offset + 250)
    const values = sql.join(batch.map((record) => sql`(
      ${record.targetDocumentId!}::integer,
      ${record.title}::text,
      ${record.fileName}::text,
      ${record.mimeType}::text,
      ${record.periodFrom}::date,
      ${record.periodTo}::date,
      ${record.rowCount}::integer,
      ${record.wdiTotal}::numeric,
      ${record.documentNumber}::integer,
      ${record.updatedAt}::timestamptz
    )`), sql`, `)
    await tx.execute(sql`
      update "generated_documents" as document
      set
        "title" = refreshed.title,
        "file_name" = refreshed.file_name,
        "mime_type" = refreshed.mime_type,
        "period_from" = refreshed.period_from,
        "period_to" = refreshed.period_to,
        "row_count" = refreshed.row_count,
        "wdi_total" = refreshed.wdi_total,
        "document_number" = refreshed.document_number,
        "updated_at" = refreshed.updated_at
      from (values ${values}) as refreshed(
        id,
        title,
        file_name,
        mime_type,
        period_from,
        period_to,
        row_count,
        wdi_total,
        document_number,
        updated_at
      )
      where document."id" = refreshed.id
    `)
    batch.forEach((record) => resolvedDocumentIds.set(record.inputIndex, record.targetDocumentId!))
  }

  const newRecords = records.filter((record) => record.targetDocumentId == null)
  for (let offset = 0; offset < newRecords.length; offset += 250) {
    const batch = newRecords.slice(offset, offset + 250)
    const inserted = await tx
      .insert(generatedDocuments)
      .values(batch.map((record) => ({
        type: record.type,
        title: record.title,
        fileName: record.fileName,
        mimeType: record.mimeType,
        periodFrom: record.periodFrom,
        periodTo: record.periodTo,
        rowCount: record.rowCount,
        wdiTotal: record.wdiTotal,
        documentNumber: record.documentNumber,
      })))
      .returning({
        id: generatedDocuments.id,
        documentNumber: generatedDocuments.documentNumber,
      })
    const insertedByNumber = new Map(inserted.map((document) => [document.documentNumber, document.id]))
    for (const record of batch) {
      const documentId = insertedByNumber.get(record.documentNumber)
      if (!documentId) throw new Error('Не удалось определить номер сформированного документа.')
      resolvedDocumentIds.set(record.inputIndex, documentId)
    }
  }
  return resolvedDocumentIds
}

export const getRemoteGeneratedDocumentRows = createServerFn({ method: 'GET' })
  .validator((data: { id: number }) => ({ id: requirePositiveId(data?.id, 'документа') }))
  .handler(async ({ data }): Promise<WeldRow[]> => {
    await assertSecurityScope('entry')
    const db = requireDb()
    const rows = await db
      .select({ weld: weldJoints })
      .from(generatedDocumentWeldJoints)
      .innerJoin(
        generatedDocuments,
        and(
          eq(generatedDocuments.id, generatedDocumentWeldJoints.documentId),
          inArray(generatedDocuments.type, [...GENERATED_DOCUMENT_TYPES]),
        ),
      )
      .innerJoin(weldJoints, eq(weldJoints.id, generatedDocumentWeldJoints.weldJointId))
      .where(eq(generatedDocumentWeldJoints.documentId, data.id))
      .orderBy(asc(weldJoints.weldDate), asc(weldJoints.line), asc(weldJoints.joint))
    const otherSettings = await loadGeneratedDocumentOtherSettings(db)
    const currentRows = rows.map(({ weld }) => weld as unknown as WeldRow)
    return attachGeneratedDocumentFields(
      await attachPreHeatTreatmentControlRelations(
        isSystemWdiMode(otherSettings)
          ? currentRows.map((row) => withSystemWdi(row, otherSettings))
          : currentRows,
        db,
      ),
    )
  })

export const deleteRemoteGeneratedDocument = createServerFn({ method: 'POST' })
  .validator((data: { id: number; expectedUpdatedAt: string }) => ({
    id: requirePositiveId(data?.id, 'документа'),
    expectedUpdatedAt: String(data?.expectedUpdatedAt ?? '').trim(),
  }))
  .handler(async ({ data }) => {
    await assertSecurityScope('delete')
    const db = requireDb()
    const [documentReference] = await db
      .select({ type: generatedDocuments.type })
      .from(generatedDocuments)
      .where(and(
        eq(generatedDocuments.id, data.id),
        inArray(generatedDocuments.type, [...MANUAL_GENERATED_DOCUMENT_TYPES]),
      ))
      .limit(1)
    if (!documentReference) throw new Error('Документ больше не существует. Обновите историю документов.')
    await db.transaction(async (tx) => {
      const type = requireGeneratedDocumentType(documentReference.type)
      await lockGeneratedDocumentNumberCounter(tx, type)
      const assignedBeforeLock = await tx
        .select({ weldJointId: generatedDocumentWeldJoints.weldJointId })
        .from(generatedDocumentWeldJoints)
        .where(eq(generatedDocumentWeldJoints.documentId, data.id))
      await lockInteractiveWeldRows(
        tx,
        assignedBeforeLock.map((row) => row.weldJointId),
      )
      const [currentDocument] = await tx
        .select({ updatedAt: generatedDocuments.updatedAt })
        .from(generatedDocuments)
        .where(and(
          eq(generatedDocuments.id, data.id),
          eq(generatedDocuments.type, type),
        ))
        .for('update')
        .limit(1)
      if (!currentDocument) throw new Error('Документ больше не существует. Обновите историю документов.')
      if (
        !data.expectedUpdatedAt ||
        currentDocument.updatedAt.toISOString() !== data.expectedUpdatedAt
      ) {
        throw new Error(
          'Документ уже изменен другим пользователем или в другом окне. Ничего не удалено. Обновите историю документов.',
        )
      }
      const assignedRows = await tx
        .select({ weldJointId: generatedDocumentWeldJoints.weldJointId })
        .from(generatedDocumentWeldJoints)
        .where(eq(generatedDocumentWeldJoints.documentId, data.id))
      const [deleted] = await tx
        .delete(generatedDocuments)
        .where(
          and(
            eq(generatedDocuments.id, data.id),
            inArray(generatedDocuments.type, [...MANUAL_GENERATED_DOCUMENT_TYPES]),
          ),
        )
        .returning({ id: generatedDocuments.id })
      if (deleted) {
        await touchWeldingProfile(tx, assignedRows.map((row) => row.weldJointId))
      }
    })
    return { ok: true }
  })

function normalizeSaveGeneratedDocumentInput(data: SaveGeneratedDocumentInput): SaveGeneratedDocumentInput {
  const weldJointIds = [...new Set((data?.weldJointIds ?? []).map(Number).filter((id) => Number.isInteger(id) && id > 0))]
  if (weldJointIds.length === 0) throw new Error('Для документа не выбраны стыки.')
  if (!isManualGeneratedDocumentType(data?.type)) {
    throw new Error('Неизвестный тип документа.')
  }

  const fallbackTitle = getGeneratedDocumentProfile(data.type).label
  return {
    type: data.type,
    title: String(data.title ?? '').trim() || fallbackTitle,
    fileName: String(data.fileName ?? '').trim() || `${fallbackTitle}.xlsx`,
    mimeType: String(data.mimeType ?? '').trim(),
    weldJointIds,
    expectedVersions: (Array.isArray(data?.expectedVersions) ? data.expectedVersions : []).map((entry) => ({
      id: Number(entry?.id),
      version: String(entry?.version ?? '').trim(),
    })),
    periodFrom: normalizeDate(data.periodFrom),
    periodTo: normalizeDate(data.periodTo),
    rowCount: weldJointIds.length,
    wdiTotal: Number.isFinite(Number(data.wdiTotal)) ? Number(data.wdiTotal) : undefined,
  }
}

export function normalizeSaveGeneratedDocumentBatch(data: SaveGeneratedDocumentInput[]) {
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('Для формирования не переданы документы.')
  }

  const inputs = data.map(normalizeSaveGeneratedDocumentInput)
  const firstType = inputs[0].type
  if (inputs.some((input) => input.type !== firstType)) {
    throw new Error('За одну операцию можно сформировать документы только одного типа.')
  }

  const assignedWeldJointIds = new Set<number>()
  for (const input of inputs) {
    for (const weldJointId of input.weldJointIds) {
      if (assignedWeldJointIds.has(weldJointId)) {
        throw new Error(`Стык с ID ${weldJointId} одновременно попал в несколько документов.`)
      }
      assignedWeldJointIds.add(weldJointId)
    }
  }

  return inputs
}

function toRemoteGeneratedDocument(
  record: typeof generatedDocuments.$inferSelect & Partial<Pick<RemoteGeneratedDocument, 'projects' | 'subtitleCodes' | 'lines'>>,
): RemoteGeneratedDocument {
  return {
    id: record.id,
    type: record.type as GeneratedDocumentType,
    title: record.title,
    fileName: record.fileName,
    mimeType: record.mimeType,
    periodFrom: record.periodFrom ?? undefined,
    periodTo: record.periodTo ?? undefined,
    rowCount: record.rowCount,
    wdiTotal: record.wdiTotal ?? undefined,
    documentNumber: record.documentNumber ?? undefined,
    ...(isLayeredControlDocumentType(record.type)
      ? { stage: getLayeredControlStageLabel(record.type) }
      : {}),
    projects: record.projects ?? [],
    subtitleCodes: record.subtitleCodes ?? [],
    lines: record.lines ?? [],
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}

function toRemoteGeneratedDocumentHistoryRow(
  record: Record<string, unknown>,
): RemoteGeneratedDocument {
  const periodFrom = String(record.periodFrom ?? '').trim()
  const periodTo = String(record.periodTo ?? '').trim()
  const documentNumber = Number(record.documentNumber)
  return {
    id: Number(record.id),
    type: isGeneratedDocumentType(record.type) ? record.type : 'weldingJournal',
    title: String(record.title ?? ''),
    fileName: String(record.fileName ?? ''),
    mimeType: String(record.mimeType ?? ''),
    ...(periodFrom ? { periodFrom } : {}),
    ...(periodTo ? { periodTo } : {}),
    rowCount: Math.max(0, Number(record.rowCount) || 0),
    wdiTotal: Number(record.wdiTotal) || 0,
    ...(Number.isInteger(documentNumber) && documentNumber > 0 ? { documentNumber } : {}),
    ...(isLayeredControlDocumentType(record.type)
      ? { stage: getLayeredControlStageLabel(record.type) }
      : {}),
    projects: normalizeDocumentHistoryStringArray(record.projects),
    subtitleCodes: normalizeDocumentHistoryStringArray(record.subtitleCodes),
    lines: normalizeDocumentHistoryStringArray(record.lines),
    createdAt: String(record.createdAt ?? ''),
    updatedAt: String(record.updatedAt ?? ''),
  }
}

function normalizeDocumentHistoryStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : []
}

async function loadGeneratedDocumentOtherSettings(
  db: Pick<ReturnType<typeof requireDb>, 'select'>,
) {
  const [setting] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, PROJECT_SETTING_KEYS.other))
    .limit(1)
  if (!setting?.value) return DEFAULT_OTHER_SETTINGS
  try {
    return normalizeOtherSettings(JSON.parse(setting.value))
  } catch {
    return DEFAULT_OTHER_SETTINGS
  }
}

async function calculateGeneratedDocumentWdiTotals(
  db: Pick<ReturnType<typeof requireDb>, 'select'>,
  documentIds: number[],
  settings?: OtherSettings,
) {
  const uniqueDocumentIds = [...new Set(documentIds)].sort((left, right) => left - right)
  const totals = new Map(uniqueDocumentIds.map((documentId) => [documentId, 0]))
  if (uniqueDocumentIds.length === 0) return totals
  const otherSettings = settings ?? await loadGeneratedDocumentOtherSettings(db)
  for (const documentIdBatch of splitNumberBatches(uniqueDocumentIds, 1_000)) {
    const rows = await db
      .select({
        documentId: generatedDocumentWeldJoints.documentId,
        connectionType: weldJoints.connectionType,
        d1: weldJoints.d1,
        d2: weldJoints.d2,
        t1: weldJoints.t1,
        t2: weldJoints.t2,
        wdi: weldJoints.wdi,
      })
      .from(generatedDocumentWeldJoints)
      .innerJoin(weldJoints, eq(weldJoints.id, generatedDocumentWeldJoints.weldJointId))
      .where(inArray(generatedDocumentWeldJoints.documentId, documentIdBatch))

    for (const row of rows) {
      totals.set(row.documentId, (totals.get(row.documentId) ?? 0) + (calculateWdi(row as WeldInput, otherSettings) ?? 0))
    }
  }
  return totals
}

export async function refreshStaleGeneratedDocumentsInTransaction({
  tx,
  staleDocumentIds,
  documentUpdatedAtById,
  otherSettings,
  now,
}: {
  tx: GeneratedDocumentsTransaction
  staleDocumentIds: readonly number[]
  documentUpdatedAtById: ReadonlyMap<number, Date | null | undefined>
  otherSettings: OtherSettings
  now: Date
}) {
  const documentIds = [...new Set(staleDocumentIds)].sort((left, right) => left - right)
  if (documentIds.length === 0) return

  const summaries: Array<{
    documentId: number
    total: number | string
    periodFrom: string | null
    periodTo: string | null
  }> = []
  for (const documentIdBatch of splitNumberBatches(documentIds, 1_000)) {
    summaries.push(...await tx
      .select({
        documentId: generatedDocumentWeldJoints.documentId,
        total: count(),
        periodFrom: min(weldJoints.weldDate),
        periodTo: max(weldJoints.weldDate),
      })
      .from(generatedDocumentWeldJoints)
      .innerJoin(weldJoints, eq(weldJoints.id, generatedDocumentWeldJoints.weldJointId))
      .where(inArray(generatedDocumentWeldJoints.documentId, documentIdBatch))
      .groupBy(generatedDocumentWeldJoints.documentId))
  }
  const summariesById = new Map(summaries.map((summary) => [summary.documentId, summary]))
  const emptyDocumentIds = documentIds.filter((documentId) => !summariesById.has(documentId))
  const populatedDocumentIds = documentIds.filter((documentId) => summariesById.has(documentId))
  const currentWdiTotals = await calculateGeneratedDocumentWdiTotals(
    tx,
    populatedDocumentIds,
    otherSettings,
  )

  if (emptyDocumentIds.length > 0) {
    for (const documentIdBatch of splitNumberBatches(emptyDocumentIds, 1_000)) {
      await tx.delete(generatedDocuments).where(inArray(generatedDocuments.id, documentIdBatch))
    }
  }
  if (populatedDocumentIds.length === 0) return

  for (const documentIdBatch of splitNumberBatches(populatedDocumentIds, 1_000)) {
    const values = sql.join(
      documentIdBatch.map((documentId) => {
        const summary = summariesById.get(documentId)!
        const previousUpdatedAt = documentUpdatedAtById.get(documentId)
        const updatedAt = previousUpdatedAt
          ? getNextTimestampVersion(previousUpdatedAt, now)
          : now
        return sql`(
          ${documentId}::integer,
          ${Number(summary.total)}::integer,
          ${summary.periodFrom}::date,
          ${summary.periodTo}::date,
          ${currentWdiTotals.get(documentId) ?? 0}::numeric,
          ${updatedAt}::timestamptz
        )`
      }),
      sql`, `,
    )
    await tx.execute(sql`
      update "generated_documents" as document
      set
        "row_count" = refreshed.row_count,
        "period_from" = refreshed.period_from,
        "period_to" = refreshed.period_to,
        "wdi_total" = refreshed.wdi_total,
        "updated_at" = refreshed.updated_at
      from (values ${values}) as refreshed(id, row_count, period_from, period_to, wdi_total, updated_at)
      where document."id" = refreshed.id
    `)
  }
}

async function touchWeldingProfile(
  db: Pick<ReturnType<typeof requireDb>, 'update'>,
  weldJointIds: number[],
  now = new Date(),
) {
  const uniqueIds = [...new Set(weldJointIds)]
  if (uniqueIds.length === 0) return
  for (const idBatch of splitNumberBatches(uniqueIds, 1_000)) {
    await db
      .update(weldJoints)
      .set({ weldingUpdatedAt: now, updatedAt: now })
      .where(inArray(weldJoints.id, idBatch))
  }
}

function requireGeneratedDocumentType(value: unknown): GeneratedDocumentType {
  if (isGeneratedDocumentType(value)) return value
  throw new Error('Неизвестный тип документа.')
}

function normalizeDate(value: unknown) {
  const date = String(value ?? '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined
}

function requirePositiveId(value: unknown, label: string) {
  const id = Math.floor(Number(value) || 0)
  if (id <= 0) throw new Error(`Не передан ID ${label}.`)
  return id
}
