import { createServerFn } from '@tanstack/react-start'
import { and, asc, count, desc, eq, exists, getTableColumns, gt, gte, ilike, inArray, lte, notExists, notInArray, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm'
import { requireDb } from '@/db'
import {
  appSettings,
  duplicateControls,
  dispatcherRowTasks,
  generatedDocuments,
  generatedDocumentWeldJoints,
  weldJoints,
  type DuplicateControl,
  type NewWeldJoint,
  type WeldJoint,
} from '@/db/schema'
import {
  clearCancelledRejectedLnkGeneratedData,
  clearDisabledLnkRequests,
  clearLnkGeneratedData,
  hasLnkGeneratedDataChanged,
  restoreActiveLnkCancelledResults,
  withLnkFinalStatus,
} from '@/lib/lnk-field-updates'
import {
  clearCancelledPstoRequestWithoutResult,
  restoreActivePstoCancelledResult,
  withPendingPstoResultStatus,
} from '@/lib/psto-field-updates'
import { LNK_GENERATED_FIELD_KEYS, LNK_METHODS } from '@/lib/report-config'
import { LEGACY_CONTROL_REPLACEMENT_VALUE } from '@/lib/control-availability-values'
import { hasAnyLnkGeneratedData, hasLnkReportEntry, withPendingLnkResults } from '@/lib/report-control-state'
import { hasWeldDate, isYesText, normalizeControlAvailabilityValue } from '@/lib/report-value-utils'
import {
  FIELD_BY_KEY,
  WELD_FIELDS,
  type WeldFieldKey,
  type WeldInput,
} from '@/lib/weld-fields'
import { normalizeWeldInput } from '@/lib/weld-import-export'
import type { WeldDraft, WeldRow } from '@/lib/dispatcher-types'
import type { DuplicateControlRecord } from '@/lib/duplicate-control-types'
import { parseWeldColumnChoiceFilter } from '@/lib/weld-column-choice-filter'
import {
  DISPATCHER_TASK_FILTER_KEY,
  parseDispatcherTaskServerFilter,
} from '@/lib/dispatcher-task-row-codes'
import { filterWeldRowsByColumns, getWeldColumnFilterRowText } from '@/lib/weld-table-filtering'
import { buildHeatTreatmentReportRows, buildLnkReportRows } from '@/lib/report-row-utils'
import { getJointChainRows } from '@/lib/repeated-joint-row-utils'
import {
  PERCENTAGE_LINE_STAMP_FILTER_KEY,
  ROW_ID_LIST_FILTER_KEY,
  isHiddenReportFilterKey,
  parsePercentageLineStampFilter,
  parseRowIdListFilter,
} from '@/lib/report-hidden-filters'
import { attachGeneratedDocumentFields } from '@/server/generated-document-row-fields'
import { normalizeOtherSettings, type RkExposureTableSettings } from '@/lib/other-settings'
import { PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'
import { getRkExposureSchemeState } from '@/lib/rk-exposure'
import {
  ensureDispatcherTaskIndexFresh,
} from '@/server/dispatcher-task-index'
import {
  markDispatcherTaskIndexDirty,
  type DispatcherDirtyScope,
} from '@/server/dispatcher-task-index-dirty'
import {
  reserveSystemDocumentName,
  type SystemDocumentSequenceTransaction,
  type SystemDocumentSequenceUpdate,
} from '@/server/system-document-sequences'
import { syncSystemDocumentsForWeldChangesInTransaction } from '@/server/system-documents'
import { assertSecurityScope } from '@/server/security-functions'
import { buildDerivedCalculationCacheKey } from '@/lib/derived-calculation-cache-key'
import {
  getOrComputeDerivedCalculation,
} from '@/server/derived-calculation-cache'
import {
  loadPreviousWeldRows,
  loadServerWeldValidationContext,
  prepareServerWeldRecords,
  validateServerWeldRecords,
} from '@/server/weld-save-validation'
import {
  assertUniqueWeldMutationTargets,
  assertWeldImportRowLimit,
  splitWeldImportInsertBatches,
} from '@/lib/weld-import-limits'

export type WeldFilters = {
  search?: string
  projectTitle?: string
  line?: string
  groupName?: string
  category?: string
  pstoRequired?: string
  weldingMethod?: string
  materialGroup?: string
  status?: string
  finalStatus?: string
  controlMethod?: string
}

export const WELD_PAGE_SIZE_OPTIONS = [100, 300, 500, 1000] as const
export const WELD_PAGE_ALL_SIZE = 'all'
export const WELD_SNAPSHOT_BATCH_SIZE = 1000

export type WeldPageSize = (typeof WELD_PAGE_SIZE_OPTIONS)[number] | typeof WELD_PAGE_ALL_SIZE

export type WeldPageRequest = WeldFilters & {
  report?: WeldReportKind
  page?: number
  pageSize?: WeldPageSize
  columnFilters?: Record<string, string>
}

export type WeldReportKind = 'weldingJournal' | 'lnk' | 'heatTreatment'

export type WeldPageResult = {
  rows: WeldRow[]
  total: number
  acceptedWdiTotal?: number
  page: number
  pageSize: WeldPageSize
  hasMore: boolean
}

export type WeldColumnFilterOption = {
  value: string
  count: number
  label: string
}

export type WeldColumnFilterOptionsRequest = WeldPageRequest & {
  fieldKey: WeldFieldKey
}

export type WeldJointChainResult = {
  record: WeldRow | null
  rows: WeldRow[]
}

export type WeldRowsByIdsRequest = {
  ids: number[]
}

export type WeldSnapshotPageRequest = {
  afterId?: number
  batchSize?: number
}

export type WeldSnapshotPageResult = {
  rows: WeldRow[]
  nextAfterId: number | null
  hasMore: boolean
}

export type DocumentGenerationDataRequest = {
  periodFrom?: string
  periodTo?: string
  projects?: string[]
  subtitles?: string[]
  lines?: string[]
}

export type DocumentGenerationScopeOptions = {
  projects: string[]
  subtitles: string[]
  lines: string[]
}

export type DocumentGenerationDataResult = {
  rows: WeldRow[]
  scopeOptions: DocumentGenerationScopeOptions
}

export type WeldDataUsageSummary = {
  rowsCount: number
  weldingTypes: Array<[string, number]>
  connectionTypes: Array<[string, number]>
  materialGroups: Array<[string, number]>
  testTypes: Array<[string, number]>
}

type WeldDataUsageRow = {
  weldingMethod?: unknown
  connectionType?: unknown
  materialGroup?: unknown
  testTypes?: unknown
}

export type WeldPayload = WeldDraft

const filterKeys = [
  'projectTitle',
  'line',
  'groupName',
  'category',
  'pstoRequired',
  'weldingMethod',
  'materialGroup',
  'status',
  'finalStatus',
] as const

const controlColumns = {
  ВИК: weldJoints.hasVik,
  РК: weldJoints.hasRk,
  ПВК: weldJoints.hasPvk,
  УЗК: weldJoints.hasUzk,
  ТВМТ: weldJoints.hasTvmt,
  РФА: weldJoints.hasRfa,
  СТЛС: weldJoints.hasStls,
  МКК: weldJoints.hasMkk,
} as const
const SYSTEM_FIELD_KEYS = new Set([
  'id',
  'dispatcherTasks',
  'jsrDocument',
  'checklistDocument',
  'zniDocument',
  'rkExposureScheme',
  'createdAt',
  'updatedAt',
])
const GENERATED_DOCUMENT_FIELD_TYPES = {
  jsrDocument: 'weldingJournal',
  checklistDocument: 'checklist',
  zniDocument: 'zni',
} as const satisfies Partial<Record<WeldFieldKey, string>>
const WELDING_JOURNAL_ORDER_BY = [
  sql`${weldJoints.createdAt} desc nulls last`,
  sql`${weldJoints.weldDate} desc nulls last`,
  asc(weldJoints.line),
  asc(weldJoints.joint),
]
const WELD_TABLE_COLUMNS = getTableColumns(weldJoints)
const { updatedAt: OMITTED_UPDATED_AT_COLUMN, ...WELD_TABLE_SELECT } = WELD_TABLE_COLUMNS
void OMITTED_UPDATED_AT_COLUMN
const REPORT_DERIVED_FILTER_SELECT = {
  id: weldJoints.id,
  weldDate: weldJoints.weldDate,
  projectTitle: weldJoints.projectTitle,
  subtitleCode: weldJoints.subtitleCode,
  line: weldJoints.line,
  connectionType: weldJoints.connectionType,
  d1: weldJoints.d1,
  d2: weldJoints.d2,
  spool: weldJoints.spool,
  joint: weldJoints.joint,
  status: weldJoints.status,
  finalStatus: weldJoints.finalStatus,
  pstoRequired: weldJoints.pstoRequired,
  pstoRequest: weldJoints.pstoRequest,
  pstoRequestDate: weldJoints.pstoRequestDate,
  pstoDate: weldJoints.pstoDate,
  pstoResult: weldJoints.pstoResult,
  pstoCreatedAt: weldJoints.pstoCreatedAt,
  lnkCreatedAt: weldJoints.lnkCreatedAt,
  hasVik: weldJoints.hasVik,
  hasRk: weldJoints.hasRk,
  hasPvk: weldJoints.hasPvk,
  hasUzk: weldJoints.hasUzk,
  hasTvmt: weldJoints.hasTvmt,
  hasRfa: weldJoints.hasRfa,
  hasStls: weldJoints.hasStls,
  hasMkk: weldJoints.hasMkk,
  vikRequest: weldJoints.vikRequest,
  rkRequest: weldJoints.rkRequest,
  pvkRequest: weldJoints.pvkRequest,
  uzkRequest: weldJoints.uzkRequest,
  tvmtRequest: weldJoints.tvmtRequest,
  rfaRequest: weldJoints.rfaRequest,
  stlsRequest: weldJoints.stlsRequest,
  mkkRequest: weldJoints.mkkRequest,
  vikResult: weldJoints.vikResult,
  rkResult: weldJoints.rkResult,
  pvkResult: weldJoints.pvkResult,
  uzkResult: weldJoints.uzkResult,
  tvmtResult: weldJoints.tvmtResult,
  rfaResult: weldJoints.rfaResult,
  stlsResult: weldJoints.stlsResult,
  mkkResult: weldJoints.mkkResult,
  vikConclusionDate: weldJoints.vikConclusionDate,
  rkConclusionDate: weldJoints.rkConclusionDate,
  pvkConclusionDate: weldJoints.pvkConclusionDate,
  uzkConclusionDate: weldJoints.uzkConclusionDate,
  tvmtConclusionDate: weldJoints.tvmtConclusionDate,
  rfaConclusionDate: weldJoints.rfaConclusionDate,
  stlsConclusionDate: weldJoints.stlsConclusionDate,
  mkkConclusionDate: weldJoints.mkkConclusionDate,
  vikConclusion: weldJoints.vikConclusion,
  rkConclusion: weldJoints.rkConclusion,
  pvkConclusion: weldJoints.pvkConclusion,
  uzkConclusion: weldJoints.uzkConclusion,
  tvmtConclusion: weldJoints.tvmtConclusion,
  rfaConclusion: weldJoints.rfaConclusion,
  stlsConclusion: weldJoints.stlsConclusion,
  mkkConclusion: weldJoints.mkkConclusion,
  lnkDefectDescription: weldJoints.lnkDefectDescription,
  rkExposureConfirmedDiameter: weldJoints.rkExposureConfirmedDiameter,
}
const REPORT_SOURCE_COLUMN_FILTER_KEYS = new Set<WeldFieldKey>([
  'id',
  'weldDate',
  'projectTitle',
  'subtitleCode',
  'line',
  'groupName',
  'category',
  'pstoRequired',
  'weldControlPercent',
  'spool',
  'spoolId',
  'joint',
  'isometry',
  'sheet',
  'revisionNumber',
  'status',
  'revisionActuality',
  'orderCode1',
  'orderCode2',
  'materialUniqueNumber1',
  'materialUniqueNumber2',
  'element1',
  'element2',
  'materialId1',
  'materialId2',
  'material1',
  'material2',
  'materialFullName1',
  'materialFullName2',
  'materialNormativeDocument1',
  'materialNormativeDocument2',
  'materialCertificateNumber1',
  'materialCertificateNumber2',
  'weldingMethod',
  'connectionType',
  'materialGroup',
  'd1',
  'd2',
  't1',
  't2',
  'wdi',
  'responsible',
  'technologyCardNumber',
  'weldingElectrodes',
  'weldingElectrodesCertificateNumber',
  'fillerWire',
  'fillerWireCertificateNumber',
  'shieldingGas',
  'shieldingGasCertificateNumber',
  'stamp1K',
  'stamp1Z',
  'stamp1O',
  'stamp1KFact',
  'stamp1ZFact',
  'stamp1OFact',
  'stamp2K',
  'stamp2Z',
  'stamp2O',
  'stamp2KFact',
  'stamp2ZFact',
  'stamp2OFact',
  'hasVik',
  'hasRk',
  'hasUzk',
  'hasPvk',
  'hasTvmt',
  'hasRfa',
  'hasStls',
  'hasMkk',
  'pstoNote',
  'lnkNote',
  'testTypes',
  'testContour',
  'testDate',
  'piDate',
  'boq',
  'testBoq',
  'piBoq',
  'ks3',
  'testKs3',
  'piKs3',
  'createdAt',
])

export const listWeldJointSnapshotPage = createServerFn({ method: 'GET' })
  .validator((data: WeldSnapshotPageRequest | undefined) => normalizeWeldSnapshotPageRequest(data))
  .handler(async ({ data }) => {
    const db = requireDb()
    const rows = await db
      .select()
      .from(weldJoints)
      .where(data.afterId > 0 ? gt(weldJoints.id, data.afterId) : undefined)
      .orderBy(asc(weldJoints.id))
      .limit(data.batchSize)
    const lastId = rows.length > 0 ? Number(rows[rows.length - 1].id) : data.afterId

    return {
      rows: compactWeldRowsForTransport(rows),
      nextAfterId: rows.length === data.batchSize ? lastId : null,
      hasMore: rows.length === data.batchSize,
    }
  })

export const listWeldJointChain = createServerFn({ method: 'GET' })
  .validator((data: { id: number }) => data)
  .handler(async ({ data }): Promise<WeldJointChainResult> => {
    const db = requireDb()
    const [record] = await db.select().from(weldJoints).where(eq(weldJoints.id, data.id)).limit(1)
    if (!record) return { record: null, rows: [] }

    const candidates = await db
      .select()
      .from(weldJoints)
      .where(
        and(
          normalizedTextEquals(weldJoints.projectTitle, record.projectTitle),
          normalizedTextEquals(weldJoints.subtitleCode, record.subtitleCode),
          normalizedTextEquals(weldJoints.line, record.line),
        ),
      )
    const weldRecord = record as unknown as WeldRow
    const weldCandidates = candidates as unknown as WeldRow[]

    return {
      record: weldRecord,
      rows: getJointChainRows(weldCandidates, weldRecord),
    }
  })

export const getWeldJointById = createServerFn({ method: 'GET' })
  .validator((data: { id: number }) => ({ id: Math.max(0, Math.floor(Number(data?.id) || 0)) }))
  .handler(async ({ data }): Promise<WeldRow | null> => {
    if (!data.id) return null
    const db = requireDb()
    const [record] = await db.select().from(weldJoints).where(eq(weldJoints.id, data.id)).limit(1)
    if (!record) return null
    const [recordWithDuplicateControls] = await attachGeneratedDocumentFields(
      await attachDuplicateControlsToPage([record]),
    )
    return recordWithDuplicateControls as unknown as WeldRow
  })

export const listWeldingJournalPage = createServerFn({ method: 'GET' })
  .validator((data: WeldPageRequest | undefined) => normalizeWeldPageRequest(data))
  .handler(async ({ data }): Promise<WeldPageResult> => listReportPage('weldingJournal', data))

export const listLnkReportPage = createServerFn({ method: 'GET' })
  .validator((data: WeldPageRequest | undefined) => normalizeWeldPageRequest(data))
  .handler(async ({ data }): Promise<WeldPageResult> => listReportPage('lnk', data))

export const listHeatTreatmentReportPage = createServerFn({ method: 'GET' })
  .validator((data: WeldPageRequest | undefined) => normalizeWeldPageRequest(data))
  .handler(async ({ data }): Promise<WeldPageResult> => listReportPage('heatTreatment', data))

export const listWeldColumnFilterOptions = createServerFn({ method: 'GET' })
  .validator((data: WeldColumnFilterOptionsRequest | undefined) => normalizeWeldColumnFilterOptionsRequest(data))
  .handler(async ({ data }): Promise<WeldColumnFilterOption[]> => listColumnFilterOptions(data))

export const getDocumentGenerationData = createServerFn({ method: 'POST' })
  .validator((data: DocumentGenerationDataRequest | undefined) => normalizeDocumentGenerationDataRequest(data))
  .handler(async ({ data }): Promise<DocumentGenerationDataResult> => {
    const db = requireDb()
    const clauses: SQL[] = [sql`${weldJoints.weldDate} is not null`]
    if (data.periodFrom) clauses.push(gte(weldJoints.weldDate, data.periodFrom))
    if (data.periodTo) clauses.push(lte(weldJoints.weldDate, data.periodTo))
    if (data.projects.length > 0) clauses.push(inArray(weldJoints.projectTitle, data.projects))
    if (data.subtitles.length > 0) clauses.push(inArray(weldJoints.subtitleCode, data.subtitles))
    if (data.lines.length > 0) clauses.push(inArray(weldJoints.line, data.lines))

    const [rows, projectRows, subtitleRows, lineRows] = await Promise.all([
      db
        .select(WELD_TABLE_SELECT)
        .from(weldJoints)
        .where(and(...clauses))
        .orderBy(asc(weldJoints.weldDate), asc(weldJoints.line), asc(weldJoints.joint)),
      db.selectDistinct({ value: weldJoints.projectTitle }).from(weldJoints),
      db.selectDistinct({ value: weldJoints.subtitleCode }).from(weldJoints),
      db.selectDistinct({ value: weldJoints.line }).from(weldJoints),
    ])

    return {
      rows: compactWeldRowsForTransport(
        await attachGeneratedDocumentFields(await attachDuplicateControlsToPage(rows)),
      ),
      scopeOptions: {
        projects: getUniqueSortedTexts(projectRows.map((row) => row.value)),
        subtitles: getUniqueSortedTexts(subtitleRows.map((row) => row.value)),
        lines: getUniqueSortedTexts(lineRows.map((row) => row.value)),
      },
    }
  })

export const getWeldDataUsageSummary = createServerFn({ method: 'GET' })
  .handler(async (): Promise<WeldDataUsageSummary> => {
    const db = requireDb()
    const [[{ total }], weldingTypes, connectionTypes, materialGroups, testTypes] = await Promise.all([
      db.select({ total: count() }).from(weldJoints),
      listMultiValueUsage(weldJoints.weldingMethod, '[+,;]+'),
      listSingleValueUsage(weldJoints.connectionType),
      listSingleValueUsage(weldJoints.materialGroup),
      listMultiValueUsage(weldJoints.testTypes, '[,;+]+'),
    ])

    return {
      rowsCount: Number(total) || 0,
      weldingTypes,
      connectionTypes,
      materialGroups,
      testTypes,
    }
  })

type UsageAggregateRow = {
  value: string
  count: number | string
}

async function listSingleValueUsage(column: SQLWrapper): Promise<Array<[string, number]>> {
  const result = await requireDb().execute<UsageAggregateRow>(sql`
    select btrim(coalesce(${column}::text, '')) as "value", count(*)::int as "count"
    from ${weldJoints}
    where btrim(coalesce(${column}::text, '')) <> ''
    group by btrim(coalesce(${column}::text, ''))
  `)
  return sortUsageAggregateRows(result.rows)
}

async function listMultiValueUsage(
  column: SQLWrapper,
  separatorPattern: string,
): Promise<Array<[string, number]>> {
  const result = await requireDb().execute<UsageAggregateRow>(sql`
    select "value", count(*)::int as "count"
    from (
      select distinct ${weldJoints.id} as "weld_joint_id", btrim("part") as "value"
      from ${weldJoints}
      cross join lateral regexp_split_to_table(
        coalesce(${column}::text, ''),
        ${separatorPattern}
      ) as "part"
    ) as "usage_values"
    where "value" <> ''
    group by "value"
  `)
  return sortUsageAggregateRows(result.rows)
}

function sortUsageAggregateRows(rows: UsageAggregateRow[]): Array<[string, number]> {
  return rows
    .map((row): [string, number] => [String(row.value ?? '').trim(), Number(row.count) || 0])
    .filter(([value]) => Boolean(value))
    .sort(([left], [right]) => left.localeCompare(right, 'ru', { numeric: true, sensitivity: 'base' }))
}

async function listReportPage(report: WeldReportKind, data: ReturnType<typeof normalizeWeldPageRequest>) {
  await ensureDispatcherTaskIndexFresh()
  const db = requireDb()
  if (report !== 'weldingJournal') {
    const where = and(buildReportKindWhere(report), buildReportSourceWhere(data)) ?? sql`true`
    if (canPaginateReportSource(data.columnFilters)) {
      const query = db
        .select()
        .from(weldJoints)
        .where(where)
        .orderBy(...getReportOrderBy(report))
      const countQuery = db.select({ total: count() }).from(weldJoints).where(where)
      const rowsQuery =
        data.pageSize === WELD_PAGE_ALL_SIZE
          ? query
          : query.limit(data.pageSize).offset((data.page - 1) * data.pageSize)
      const [[{ total }], rows] = await Promise.all([countQuery, rowsQuery])
      const reportRows = buildServerReportRows(rows, report)
      const rowsWithDuplicateControls = compactWeldRowsForTransport(
        await attachDispatcherTaskCodesToPage(
          await attachGeneratedDocumentFields(
            await attachDuplicateControlsToPage(reportRows),
          ),
        ),
      )

      return {
        rows: rowsWithDuplicateControls,
        total,
        page: data.page,
        pageSize: data.pageSize,
        hasMore: data.pageSize !== WELD_PAGE_ALL_SIZE && data.page * data.pageSize < total,
      }
    }

    const filteredIds = await listDerivedReportRowIds(report, data, where)
    const total = filteredIds.length
    const pageIds =
      data.pageSize === WELD_PAGE_ALL_SIZE
        ? filteredIds
        : filteredIds.slice((data.page - 1) * data.pageSize, data.page * data.pageSize)
    const rows = await attachDispatcherTaskCodesToPage(
      await getFullReportRowsByIds(pageIds, report),
    )

    return {
      rows,
      total,
      page: data.page,
      pageSize: data.pageSize,
      hasMore: data.pageSize !== WELD_PAGE_ALL_SIZE && data.page * data.pageSize < total,
    }
  }

  const where = buildWhere(data)
  const query = db
    .select(WELD_TABLE_SELECT)
    .from(weldJoints)
    .where(where)
    .orderBy(...WELDING_JOURNAL_ORDER_BY)

  const countQuery = db.select({ total: count() }).from(weldJoints).where(where)
  const acceptedWdiTotalQuery = db
    .select({
      total: sql<number>`coalesce(sum(case when lower(trim(coalesce(${weldJoints.finalStatus}, ''))) = 'годен' then coalesce(${weldJoints.wdi}, 0) else 0 end), 0)::float`,
    })
    .from(weldJoints)
    .where(where)
  const rowsQuery =
    data.pageSize === WELD_PAGE_ALL_SIZE
      ? query
      : query.limit(data.pageSize).offset((data.page - 1) * data.pageSize)
  const [[{ total }], [{ total: acceptedWdiTotal }], rows] = await Promise.all([countQuery, acceptedWdiTotalQuery, rowsQuery])
  const rowsWithDuplicateControls = compactWeldRowsForTransport(
    await attachDispatcherTaskCodesToPage(
      await attachGeneratedDocumentFields(await attachDuplicateControlsToPage(rows)),
    ),
  )

  return {
    rows: rowsWithDuplicateControls,
    total,
    acceptedWdiTotal,
    page: data.page,
    pageSize: data.pageSize,
    hasMore: data.pageSize !== WELD_PAGE_ALL_SIZE && data.page * data.pageSize < total,
  }
}

type DuplicateControlCarrier = {
  id: number
  duplicateControls?: DuplicateControlRecord[]
}

async function attachDuplicateControlsToPage<Row extends DuplicateControlCarrier>(rows: Row[]) {
  if (rows.length === 0) return rows
  const ids = [...new Set(rows.map((row) => Number(row.id)).filter(Number.isFinite))]
  if (ids.length === 0) return rows

  const db = requireDb()
  const idChunks = Array.from({ length: Math.ceil(ids.length / 1000) }, (_, index) =>
    ids.slice(index * 1000, (index + 1) * 1000),
  )
  const controls = (
    await Promise.all(
      idChunks.map((idChunk) =>
        db
          .select()
          .from(duplicateControls)
          .where(inArray(duplicateControls.weldJointId, idChunk))
          .orderBy(asc(duplicateControls.weldJointId), asc(duplicateControls.id)),
      ),
    )
  ).flat()

  return mergeDuplicateControlsIntoRows(rows, controls.map(toDuplicateControlRecord))
}

export function mergeDuplicateControlsIntoRows<Row extends DuplicateControlCarrier>(
  rows: Row[],
  controls: DuplicateControlRecord[],
) {
  const byWeldId = new Map<number, DuplicateControlRecord[]>()
  for (const control of controls) {
    const current = byWeldId.get(control.weldJointId) ?? []
    current.push(control)
    byWeldId.set(control.weldJointId, current)
  }
  return rows.map((row) => ({ ...row, duplicateControls: byWeldId.get(row.id) ?? [] }))
}

async function attachDispatcherTaskCodesToPage<Row extends { id: number }>(
  rows: Row[],
) {
  if (rows.length === 0) return rows
  const ids = [...new Set(rows.map((row) => Number(row.id)).filter(Number.isFinite))]
  if (ids.length === 0) return rows
  const clauses: SQL[] = [inArray(dispatcherRowTasks.weldJointId, ids)]
  const taskRows = await requireDb()
    .select({
      rowId: dispatcherRowTasks.weldJointId,
      code: dispatcherRowTasks.code,
    })
    .from(dispatcherRowTasks)
    .where(and(...clauses))
    .orderBy(asc(dispatcherRowTasks.weldJointId), asc(dispatcherRowTasks.code))
  const codesByRowId = new Map<number, Set<string>>()
  for (const taskRow of taskRows) {
    const codes = codesByRowId.get(taskRow.rowId) ?? new Set<string>()
    codes.add(taskRow.code)
    codesByRowId.set(taskRow.rowId, codes)
  }

  return rows.map((row) => ({
    ...row,
    dispatcherTasks: [...(codesByRowId.get(row.id) ?? [])].join(', '),
  }))
}

export function compactWeldRowsForTransport<Row extends DuplicateControlCarrier>(rows: Row[]): WeldRow[] {
  return rows.map((row) => {
    const compact = Object.fromEntries(
      Object.entries(row as Record<string, unknown>).filter(
        ([, value]) => value !== null && value !== undefined && value !== '',
      ),
    ) as WeldRow
    if (Array.isArray(compact.duplicateControls) && compact.duplicateControls.length === 0) {
      delete compact.duplicateControls
    }
    return compact
  })
}

function toDuplicateControlRecord(row: DuplicateControl): DuplicateControlRecord {
  return {
    id: row.id,
    weldJointId: row.weldJointId,
    method: row.method as DuplicateControlRecord['method'],
    result: row.result as DuplicateControlRecord['result'],
    controlDate: row.controlDate ?? '',
    conclusion: row.conclusion ?? '',
    conclusionDate: row.conclusionDate ?? '',
  }
}

export function buildWeldReportPageFromRows(
  sourceRows: WeldJoint[],
  request: Required<Pick<WeldPageRequest, 'page' | 'pageSize' | 'columnFilters'>>,
  report: WeldReportKind,
): WeldPageResult {
  const reportRows = buildServerReportRows(sourceRows, report)
  const filteredRows = filterWeldRowsByColumns(reportRows, request.columnFilters)
  const rows =
    request.pageSize === WELD_PAGE_ALL_SIZE
      ? filteredRows
      : filteredRows.slice((request.page - 1) * request.pageSize, request.page * request.pageSize)

  return {
    rows,
    total: filteredRows.length,
    page: request.page,
    pageSize: request.pageSize,
    hasMore: request.pageSize !== WELD_PAGE_ALL_SIZE && request.page * request.pageSize < filteredRows.length,
  }
}

function buildServerReportRows(sourceRows: WeldJoint[], report: WeldReportKind) {
  if (report === 'weldingJournal') return sourceRows
  const weldedRows = sourceRows.filter(hasWeldDate) as WeldRow[]
  if (report === 'heatTreatment') return buildHeatTreatmentReportRows(weldedRows) as WeldJoint[]
  return buildLnkReportRows(weldedRows) as WeldJoint[]
}

async function attachRkExposureSchemeFilterValuesIfNeeded<Row extends WeldRow>(
  rows: Row[],
  columnFilters: Record<string, string>,
  optionFieldKey?: WeldFieldKey,
) {
  const needsRkExposureScheme =
    optionFieldKey === 'rkExposureScheme' || Boolean(columnFilters.rkExposureScheme?.trim())
  if (!needsRkExposureScheme) return rows

  return attachRkExposureSchemeFilterValues(rows, await loadServerRkExposureTable())
}

export function attachRkExposureSchemeFilterValues<Row extends WeldRow>(
  rows: Row[],
  table: RkExposureTableSettings | null,
): Row[] {
  return rows.map((row) => ({
    ...row,
    rkExposureScheme: getRkExposureSchemeState(row, table).label,
  }))
}

async function loadServerRkExposureTable() {
  const [storedSettings] = await requireDb()
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, PROJECT_SETTING_KEYS.other))
    .limit(1)
  if (!storedSettings) return null

  try {
    return normalizeOtherSettings(JSON.parse(storedSettings.value)).rkExposureTable
  } catch {
    return null
  }
}

async function getFullReportRowsByIds(ids: number[], report: Exclude<WeldReportKind, 'weldingJournal'>) {
  if (ids.length === 0) return []
  const db = requireDb()
  const chunks = Array.from({ length: Math.ceil(ids.length / 1000) }, (_, index) =>
    ids.slice(index * 1000, (index + 1) * 1000),
  )
  const rows = (
    await Promise.all(
      chunks.map((idChunk) =>
        db
          .select()
          .from(weldJoints)
          .where(inArray(weldJoints.id, idChunk)),
      ),
    )
  ).flat()
  const reportRows = buildServerReportRows(rows, report)
  const orderById = new Map(ids.map((id, index) => [id, index]))
  reportRows.sort(
    (left, right) =>
      (orderById.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
      (orderById.get(right.id) ?? Number.MAX_SAFE_INTEGER),
  )
  return compactWeldRowsForTransport(
    await attachGeneratedDocumentFields(await attachDuplicateControlsToPage(reportRows)),
  )
}

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
      const [created] = await tx.insert(weldJoints).values(toDbInsert(data)).returning()
      await syncSystemDocumentsForWeldChangesInTransaction(tx, [created], new Map())
      await markDispatcherTaskIndexDirty(tx, { scopes: getDispatcherDirtyScopes([data], new Map()) })
      return created
    })
  })

export const updateWeldJoint = createServerFn({ method: 'POST' })
  .validator((data: WeldPayload) => data)
  .handler(async ({ data }) => {
    await assertSecurityScope('edit')
    if (!data.id) throw new Error('Не передан id записи')
    const id = data.id
    const db = requireDb()

    return db.transaction(async (tx) => {
      const previousRows = await loadPreviousWeldRows(tx, [data])
      const validationContext = await loadServerWeldValidationContext(tx)
      prepareServerWeldRecords({ records: [data], previousRows, context: validationContext })
      validateServerWeldRecords({ records: [data], previousRows, context: validationContext })
      const insertData = toDbInsert(data)
      const [updated] = await tx
        .update(weldJoints)
        .set({ ...insertData, updatedAt: new Date() })
        .where(eq(weldJoints.id, id))
        .returning()
      await syncSystemDocumentsForWeldChangesInTransaction(tx, [updated], previousRows)
      await markDispatcherTaskIndexDirty(tx, { scopes: getDispatcherDirtyScopes([data], previousRows) })
      return updated
    })
  })

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
      })
      const created = await insertWeldJointsInBatches(tx, data.records)
      await syncSystemDocumentsForWeldChangesInTransaction(tx, created, new Map())
      await markDispatcherTaskIndexDirty(tx, { scopes: getDispatcherDirtyScopes(data.records, new Map()) })
      return created
    })
  })

export const updateWeldJoints = createServerFn({ method: 'POST' })
  .validator((data: {
    records: WeldPayload[]
    systemDocumentSequence?: SystemDocumentSequenceUpdate
    importOperation?: 'massFill'
  }) => data)
  .handler(async ({ data }) => {
    await assertSecurityScope('edit')
    if (data.importOperation === 'massFill') assertWeldImportRowLimit(data.records.length)
    if (data.records.length === 0) return []
    if (data.records.some((record) => !record.id)) throw new Error('Не передан id одной из записей')
    assertUniqueWeldMutationTargets(data.records)
    const db = requireDb()
    return db.transaction(async (tx) => {
      let records = data.records
      if (data.systemDocumentSequence) {
        const hasProvisionalName = data.records.some((record) =>
          data.systemDocumentSequence!.fieldKeys.some(
            (fieldKey) =>
              String(record[fieldKey] ?? '').trim() ===
              String(data.systemDocumentSequence!.provisionalName ?? '').trim(),
          ),
        )
        if (!hasProvisionalName) {
          throw new Error('Не найдены строки с предварительным именем системного документа.')
        }
        const reserved = await reserveSystemDocumentName(tx, data.systemDocumentSequence, data.records)
        records = data.records.map((record) => {
          let nextRecord = record
          for (const fieldKey of reserved.request.fieldKeys) {
            if (String(record[fieldKey] ?? '').trim() !== reserved.request.provisionalName) continue
            nextRecord = { ...nextRecord, [fieldKey]: reserved.name }
          }
          return nextRecord
        })
      }
      const previousRows = await loadPreviousWeldRows(tx, records)
      const validationContext = await loadServerWeldValidationContext(tx)
      prepareServerWeldRecords({ records, previousRows, context: validationContext })
      validateServerWeldRecords({ records, previousRows, context: validationContext })
      const updated = []
      for (const record of records) {
        const [row] = await tx
          .update(weldJoints)
          .set({ ...toDbInsert(record), updatedAt: new Date() })
          .where(eq(weldJoints.id, record.id!))
          .returning()
        if (!row) throw new Error(`Запись ${record.id} не найдена`)
        updated.push(row)
      }
      await syncSystemDocumentsForWeldChangesInTransaction(tx, updated, previousRows)
      await markDispatcherTaskIndexDirty(tx, { scopes: getDispatcherDirtyScopes(records, previousRows) })
      return data.importOperation === 'massFill'
        ? updated.map((row) => ({ id: row.id })) as typeof updated
        : updated
    })
  })

export const replaceWeldJoints = createServerFn({ method: 'POST' })
  .validator((data: { records: WeldPayload[]; deleteIds: number[] }) => ({
    records: Array.isArray(data?.records) ? data.records : [],
    deleteIds: [...new Set((data?.deleteIds ?? [])
      .map(Number)
      .filter((id) => Number.isInteger(id) && id > 0))],
  }))
  .handler(async ({ data }) => {
    await assertSecurityScope('importReplace')
    assertWeldImportRowLimit(data.records.length + data.deleteIds.length)
    const db = requireDb()
    return db.transaction(async (tx) => {
      if (data.records.some((record) => !record.id)) {
        throw new Error('Не передан id одной из заменяемых записей')
      }
      assertUniqueWeldMutationTargets(data.records, data.deleteIds)

      const previousRows = await loadPreviousWeldRows(tx, data.records)
      const deletedRows = data.deleteIds.length > 0
        ? await tx.select().from(weldJoints).where(inArray(weldJoints.id, data.deleteIds))
        : []
      const deletedRowsById = new Map(deletedRows.map((row) => [row.id, row]))

      if (data.records.length > 0) {
        const validationContext = await loadServerWeldValidationContext(tx)
        prepareServerWeldRecords({
          records: data.records,
          previousRows,
          context: validationContext,
          importMode: true,
        })
        validateServerWeldRecords({
          records: data.records,
          previousRows,
          context: validationContext,
          importMode: true,
        })
      }

      const updated = []
      for (const record of data.records) {
        const [row] = await tx
          .update(weldJoints)
          .set({ ...toDbInsert(record), updatedAt: new Date() })
          .where(eq(weldJoints.id, record.id!))
          .returning()
        if (!row) throw new Error(`Запись ${record.id} не найдена`)
        updated.push(row)
      }

      if (data.deleteIds.length > 0) {
        await tx.delete(weldJoints).where(inArray(weldJoints.id, data.deleteIds))
      }

      await syncSystemDocumentsForWeldChangesInTransaction(
        tx,
        updated,
        new Map([...previousRows, ...deletedRowsById]),
      )
      await deleteEmptyGeneratedDocuments(tx)

      const dirtyScopes = getDispatcherDirtyScopes(
        data.records,
        new Map([...previousRows, ...deletedRowsById]),
      )
      if (dirtyScopes.length > 0) {
        await markDispatcherTaskIndexDirty(tx, { scopes: dirtyScopes })
      }

      return {
        rows: updated.map((row) => ({ id: row.id })),
        deleted: deletedRows.length,
      }
    })
  })

export const listWeldJointRowsByIds = createServerFn({ method: 'POST' })
  .validator((data: WeldRowsByIdsRequest) => ({
    ids: Array.from(new Set((data?.ids ?? []).map(Number).filter(Number.isFinite))),
  }))
  .handler(async ({ data }): Promise<WeldRow[]> => {
    if (data.ids.length === 0) return []
    const db = requireDb()
    const chunks = Array.from({ length: Math.ceil(data.ids.length / 1000) }, (_, index) =>
      data.ids.slice(index * 1000, (index + 1) * 1000),
    )
    const rows = (
      await Promise.all(
        chunks.map((ids) =>
          db
            .select(WELD_TABLE_SELECT)
            .from(weldJoints)
            .where(inArray(weldJoints.id, ids)),
        ),
      )
    ).flat()
    const orderById = new Map(data.ids.map((id, index) => [id, index]))
    rows.sort((left, right) => (orderById.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (orderById.get(right.id) ?? Number.MAX_SAFE_INTEGER))
    return compactWeldRowsForTransport(
      await attachGeneratedDocumentFields(await attachDuplicateControlsToPage(rows)),
    )
  })

export const deleteWeldJoint = createServerFn({ method: 'POST' })
  .validator((data: { id: number }) => data)
  .handler(async ({ data }) => {
    await assertSecurityScope('delete')
    const db = requireDb()

    await db.transaction(async (tx) => {
      const [previousRow] = await tx.select().from(weldJoints).where(eq(weldJoints.id, data.id)).limit(1)
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

async function deleteEmptyGeneratedDocuments(tx: Parameters<Parameters<ReturnType<typeof requireDb>['transaction']>[0]>[0]) {
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

export const importWeldJoints = createServerFn({ method: 'POST' })
  .validator((data: { records: WeldInput[] }) => data)
  .handler(async ({ data }) => {
    await assertSecurityScope('edit')
    assertWeldImportRowLimit(data.records.length)
    if (data.records.length === 0) return { inserted: 0, rows: [] }
    const db = requireDb()

    return db.transaction(async (tx) => {
      const validationContext = await loadServerWeldValidationContext(tx)
      prepareServerWeldRecords({
        records: data.records,
        previousRows: new Map(),
        context: validationContext,
        importMode: true,
      })
      validateServerWeldRecords({
        records: data.records,
        previousRows: new Map(),
        context: validationContext,
        importMode: true,
      })
      const rows = await insertWeldJointsInBatches(tx, data.records)
      await syncSystemDocumentsForWeldChangesInTransaction(tx, rows, new Map())
      await markDispatcherTaskIndexDirty(tx, { scopes: getDispatcherDirtyScopes(data.records, new Map()) })
      return { inserted: rows.length, rows: rows.map((row) => ({ id: row.id })) }
    })
  })

export const clearLnkGeneratedWeldData = createServerFn({ method: 'POST' }).handler(async () => {
  await assertSecurityScope('delete')
  const db = requireDb()
  const updatedRows = []
  const batchSize = 1000
  let lastProcessedId = 0

  while (true) {
    const rows = await db
      .select()
      .from(weldJoints)
      .where(gt(weldJoints.id, lastProcessedId))
      .orderBy(asc(weldJoints.id))
      .limit(batchSize)
    if (rows.length === 0) break

    const batchUpdatedRows = await db.transaction(async (tx) => {
      const changedRows = []
      const previousRows = new Map<number, (typeof rows)[number]>()
      for (const row of rows) {
        const weldRow = row as unknown as WeldInput & { id: number }
        const cleanedRow = clearLnkGeneratedData(weldRow)
        if (!hasLnkGeneratedDataChanged(weldRow, cleanedRow)) continue
        previousRows.set(row.id, row)
        const updateData = [...LNK_GENERATED_FIELD_KEYS].reduce<Record<string, null>>((data, fieldKey) => {
          data[fieldKey] = null
          return data
        }, {})
        const { finalStatus } = withLnkFinalStatus(cleanedRow)
        const [updated] = await tx
          .update(weldJoints)
          .set({ ...updateData, finalStatus, updatedAt: new Date() })
          .where(eq(weldJoints.id, row.id))
          .returning()
        if (updated) changedRows.push(updated)
      }
      if (changedRows.length > 0) {
        await syncSystemDocumentsForWeldChangesInTransaction(tx, changedRows, previousRows)
        await markDispatcherTaskIndexDirty(tx)
      }
      return changedRows
    })
    updatedRows.push(...batchUpdatedRows)

    lastProcessedId = rows[rows.length - 1].id
  }

  return updatedRows
})

function toDbInsert(input: WeldInput): NewWeldJoint {
  const normalized = prepareServerWeldInput(normalizeWeldInput(input))
  const data: Record<string, unknown> = {}

  for (const field of WELD_FIELDS) {
    if (SYSTEM_FIELD_KEYS.has(field.key)) continue
    if (field.key === 'pstoCreatedAt' || field.key === 'lnkCreatedAt') {
      data[field.key] = normalized[field.key] ? new Date(String(normalized[field.key])) : null
      continue
    }
    if (field.kind === 'boolean') {
      data[field.key] = normalizeControlAvailabilityValue(normalized[field.key])
      continue
    }
    data[field.key] = normalized[field.key] ?? null
  }
  if (isYesText(normalized.pstoRequired) && !normalized.pstoCreatedAt) {
    data.pstoCreatedAt = new Date()
  }
  if ((hasLnkReportEntry(normalized) || hasAnyLnkGeneratedData(normalized)) && !normalized.lnkCreatedAt) {
    data.lnkCreatedAt = new Date()
  }

  return data as NewWeldJoint
}

async function insertWeldJointsInBatches(
  tx: SystemDocumentSequenceTransaction,
  records: readonly WeldInput[],
) {
  const inserted: WeldJoint[] = []
  for (const batch of splitWeldImportInsertBatches(records)) {
    const rows = await tx.insert(weldJoints).values(batch.map(toDbInsert)).returning()
    inserted.push(...rows)
  }
  return inserted
}

async function listColumnFilterOptions(data: ReturnType<typeof normalizeWeldColumnFilterOptionsRequest>) {
  if (!FIELD_BY_KEY.has(data.fieldKey)) return []
  await ensureDispatcherTaskIndexFresh()
  const columnFilters = getColumnFilterOptionFilters(data.columnFilters, data.fieldKey)
  if (data.report !== 'weldingJournal') {
    const column = getWeldColumn(data.fieldKey)
    if (column && REPORT_SOURCE_COLUMN_FILTER_KEYS.has(data.fieldKey) && canPaginateReportSource(columnFilters)) {
      return listSourceColumnFilterOptions(data.report, data.fieldKey, { ...data, columnFilters })
    }

    const where = and(buildReportKindWhere(data.report), buildReportSourceWhere({ ...data, columnFilters })) ?? sql`true`
    return getOrComputeDerivedCalculation(
      buildDerivedReportCacheKey(
        'report-column-options:v2',
        data.report,
        { ...data, columnFilters },
        { fieldKey: data.fieldKey },
      ),
      async () => {
        const sourceRows = await requireDb()
          .select(REPORT_DERIVED_FILTER_SELECT)
          .from(weldJoints)
          .where(where)
          .orderBy(desc(weldJoints.weldDate), asc(weldJoints.line), asc(weldJoints.joint))
        const sourceRowsWithControls = await attachDuplicateControlsToPage(sourceRows)
        const derivedRows = buildServerReportRows(sourceRowsWithControls as unknown as WeldJoint[], data.report)
        const reportRows = filterWeldRowsByColumns(
          await attachRkExposureSchemeFilterValuesIfNeeded(derivedRows, columnFilters, data.fieldKey),
          columnFilters,
        )
        return buildWeldColumnFilterOptionsFromRows(reportRows, data.fieldKey)
      },
    )
  }

  const generatedDocumentType = GENERATED_DOCUMENT_FIELD_TYPES[data.fieldKey as keyof typeof GENERATED_DOCUMENT_FIELD_TYPES]
  if (generatedDocumentType) {
    return listGeneratedDocumentColumnFilterOptions({ ...data, columnFilters }, generatedDocumentType)
  }
  if (data.fieldKey === 'finalStatus') {
    return listFinalStatusColumnFilterOptions({ ...data, columnFilters })
  }

  const column = getWeldColumn(data.fieldKey)
  if (!column) return []
  const db = requireDb()
  const valueExpression = sql<string>`coalesce(${column}::text, '')`
  const where = buildWhere({ ...data, columnFilters })
  const rows = await db
    .select({ value: valueExpression, count: count() })
    .from(weldJoints)
    .where(where)
    .groupBy(valueExpression)

  return sortColumnFilterOptions(
    rows.map((row) => ({
      value: row.value,
      count: row.count,
      label: row.value || '(пусто)',
    })),
  )
}

async function listDerivedReportRowIds(
  report: Exclude<WeldReportKind, 'weldingJournal'>,
  filters: ReturnType<typeof normalizeWeldPageRequest>,
  where: SQL,
) {
  const { columnFilters } = filters
  return getOrComputeDerivedCalculation(
    buildDerivedReportCacheKey('report-derived-row-ids:v2', report, filters),
    async () => {
      const sourceRows = await requireDb()
        .select(REPORT_DERIVED_FILTER_SELECT)
        .from(weldJoints)
        .where(where)
        .orderBy(...getReportOrderBy(report))
      const sourceRowsWithControls = await attachDuplicateControlsToPage(sourceRows)
      const reportRows = buildServerReportRows(sourceRowsWithControls as unknown as WeldJoint[], report)
      return filterWeldRowsByColumns(
        await attachRkExposureSchemeFilterValuesIfNeeded(reportRows, columnFilters),
        columnFilters,
      ).map((row) => row.id)
    },
  )
}

async function listFinalStatusColumnFilterOptions(
  data: ReturnType<typeof normalizeWeldColumnFilterOptionsRequest>,
) {
  const db = requireDb()
  const rejectedDuplicateMethods = db
    .select({
      weldJointId: duplicateControls.weldJointId,
      methods: sql<string>`string_agg(
        distinct trim(${duplicateControls.method}),
        ', ' order by trim(${duplicateControls.method})
      )`.as('methods'),
    })
    .from(duplicateControls)
    .where(inArray(duplicateControls.result, ['ремонт', 'вырез']))
    .groupBy(duplicateControls.weldJointId)
    .as('rejected_duplicate_methods')
  const valueExpression = sql<string>`case
    when lower(trim(coalesce(${weldJoints.finalStatus}, ''))) = 'не годен по дублю'
      and coalesce(${rejectedDuplicateMethods.methods}, '') <> ''
      then concat(${weldJoints.finalStatus}, ' (', ${rejectedDuplicateMethods.methods}, ')')
    else coalesce(${weldJoints.finalStatus}, '')
  end`
  const rows = await db
    .select({ value: valueExpression, count: count() })
    .from(weldJoints)
    .leftJoin(rejectedDuplicateMethods, eq(rejectedDuplicateMethods.weldJointId, weldJoints.id))
    .where(buildWhere({ ...data, columnFilters: data.columnFilters }))
    .groupBy(valueExpression)

  return sortColumnFilterOptions(
    rows.map((row) => ({
      value: row.value,
      count: row.count,
      label: row.value || '(пусто)',
    })),
  )
}

async function listGeneratedDocumentColumnFilterOptions(
  data: ReturnType<typeof normalizeWeldColumnFilterOptionsRequest>,
  documentType: string,
) {
  const db = requireDb()
  const valueExpression = sql<string>`coalesce(${generatedDocuments.title}, '')`
  const where = buildWhere({ ...data, columnFilters: data.columnFilters })
  const rows = await db
    .select({ value: valueExpression, count: count() })
    .from(weldJoints)
    .innerJoin(
      generatedDocumentWeldJoints,
      eq(generatedDocumentWeldJoints.weldJointId, weldJoints.id),
    )
    .innerJoin(
      generatedDocuments,
      and(
        eq(generatedDocuments.id, generatedDocumentWeldJoints.documentId),
        eq(generatedDocuments.type, documentType),
      ),
    )
    .where(where)
    .groupBy(valueExpression)
  const [{ count: emptyCount }] = await db
    .select({ count: count() })
    .from(weldJoints)
    .where(and(where, buildGeneratedDocumentColumnWhere('=', documentType)))

  return sortColumnFilterOptions(
    [
      ...rows.map((row) => ({
        value: row.value,
        count: row.count,
        label: row.value || '(пусто)',
      })),
      ...(Number(emptyCount) > 0
        ? [{ value: '', count: Number(emptyCount), label: '(пусто)' }]
        : []),
    ],
  )
}

async function listSourceColumnFilterOptions(
  report: Exclude<WeldReportKind, 'weldingJournal'>,
  fieldKey: WeldFieldKey,
  filters: WeldFilters & { columnFilters: Record<string, string> },
) {
  const column = getWeldColumn(fieldKey)
  if (!column) return []
  const db = requireDb()
  const valueExpression = sql<string>`coalesce(${column}::text, '')`
  const where = and(buildReportKindWhere(report), buildReportSourceWhere(filters)) ?? sql`true`
  const rows = await db
    .select({ value: valueExpression, count: count() })
    .from(weldJoints)
    .where(where)
    .groupBy(valueExpression)

  return sortColumnFilterOptions(
    rows.map((row) => ({
      value: row.value,
      count: row.count,
      label: row.value || '(пусто)',
    })),
  )
}

function prepareServerWeldInput<T extends WeldInput>(record: T): T {
  return withLnkFinalStatus(
    withPendingPstoResultStatus(
      withPendingLnkResults(
        clearDisabledLnkRequests(
          restoreActiveLnkCancelledResults(
            restoreActivePstoCancelledResult(clearCancelledRejectedLnkGeneratedData(clearCancelledPstoRequestWithoutResult(record))),
          ),
        ),
      ),
    ),
  )
}

function getDispatcherDirtyScopes(
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

function normalizeWeldColumnFilterOptionsRequest(data: WeldColumnFilterOptionsRequest | undefined) {
  const request = normalizeWeldPageRequest(data)
  const report = data?.report ?? 'weldingJournal'
  const fieldKey = String(data?.fieldKey ?? '') as WeldFieldKey

  return {
    ...request,
    report,
    fieldKey,
  }
}

export function normalizeWeldPageRequest(data: WeldPageRequest | undefined): Required<Pick<WeldPageRequest, 'page' | 'pageSize' | 'columnFilters'>> & WeldFilters {
  const page = Math.max(1, Math.floor(Number(data?.page) || 1))
  const pageSize = normalizeWeldPageSize(data?.pageSize)
  const columnFilters = Object.fromEntries(
    Object.entries(data?.columnFilters ?? {}).filter(([, value]) => String(value ?? '').trim()),
  )

  return {
    ...data,
    page,
    pageSize,
    columnFilters,
  }
}

export function normalizeWeldPageSize(value: unknown): WeldPageSize {
  if (value === WELD_PAGE_ALL_SIZE) return WELD_PAGE_ALL_SIZE
  const numericValue = Number(value)
  return WELD_PAGE_SIZE_OPTIONS.includes(numericValue as (typeof WELD_PAGE_SIZE_OPTIONS)[number])
    ? (numericValue as (typeof WELD_PAGE_SIZE_OPTIONS)[number])
    : 100
}

export function normalizeWeldSnapshotPageRequest(
  data: WeldSnapshotPageRequest | undefined,
): Required<WeldSnapshotPageRequest> {
  const afterId = Math.max(0, Math.floor(Number(data?.afterId) || 0))
  const requestedBatchSize = Math.floor(Number(data?.batchSize) || WELD_SNAPSHOT_BATCH_SIZE)
  const batchSize = Math.min(WELD_SNAPSHOT_BATCH_SIZE, Math.max(1, requestedBatchSize))

  return { afterId, batchSize }
}

export function normalizeDocumentGenerationDataRequest(
  data: DocumentGenerationDataRequest | undefined,
): Required<DocumentGenerationDataRequest> {
  const normalizeList = (values: unknown) =>
    Array.from(
      new Set(
        (Array.isArray(values) ? values : [])
          .map((value) => String(value ?? '').trim())
          .filter(Boolean),
      ),
    )

  return {
    periodFrom: String(data?.periodFrom ?? '').trim(),
    periodTo: String(data?.periodTo ?? '').trim(),
    projects: normalizeList(data?.projects),
    subtitles: normalizeList(data?.subtitles),
    lines: normalizeList(data?.lines),
  }
}

export function buildWeldDataUsageSummaryFromRows(
  rows: WeldDataUsageRow[],
  rowsCount = rows.length,
): WeldDataUsageSummary {
  return {
    rowsCount,
    weldingTypes: Array.from(countMultiValueUsage(rows.map((row) => row.weldingMethod), /[+,;]+/)),
    connectionTypes: Array.from(countSingleValueUsage(rows.map((row) => row.connectionType))),
    materialGroups: Array.from(countSingleValueUsage(rows.map((row) => row.materialGroup))),
    testTypes: Array.from(countMultiValueUsage(rows.map((row) => row.testTypes), /[,;+]+/)),
  }
}

function buildWhere(filters: WeldFilters & { columnFilters?: Record<string, string> }) {
  const clauses: SQL[] = []

  addBaseFilterClauses(clauses, filters)
  addColumnFilterClauses(clauses, filters.columnFilters ?? {})

  return clauses.length ? and(...clauses) : sql`true`
}

function addBaseFilterClauses(clauses: SQL[], filters: WeldFilters) {

  if (filters.search?.trim()) {
    const search = `%${filters.search.trim()}%`
    const searchClause = or(
      ilike(weldJoints.joint, search),
      ilike(weldJoints.line, search),
      ilike(weldJoints.isometry, search),
      ilike(weldJoints.spool, search),
      ilike(weldJoints.element1, search),
      ilike(weldJoints.element2, search),
      ilike(weldJoints.material1, search),
      ilike(weldJoints.material2, search),
      ilike(weldJoints.materialUniqueNumber1, search),
      ilike(weldJoints.materialUniqueNumber2, search),
      ilike(weldJoints.materialFullName1, search),
      ilike(weldJoints.materialFullName2, search),
      ilike(weldJoints.materialNormativeDocument1, search),
      ilike(weldJoints.materialNormativeDocument2, search),
      ilike(weldJoints.materialCertificateNumber1, search),
      ilike(weldJoints.materialCertificateNumber2, search),
      ilike(weldJoints.technologyCardNumber, search),
      ilike(weldJoints.weldingElectrodes, search),
      ilike(weldJoints.weldingElectrodesCertificateNumber, search),
      ilike(weldJoints.fillerWire, search),
      ilike(weldJoints.fillerWireCertificateNumber, search),
      ilike(weldJoints.shieldingGas, search),
      ilike(weldJoints.shieldingGasCertificateNumber, search),
      ilike(weldJoints.responsible, search),
    )
    if (searchClause) clauses.push(searchClause)
  }

  for (const key of filterKeys) {
    const value = filters[key]
    if (value) clauses.push(eq(weldJoints[key], value))
  }

  if (filters.controlMethod && filters.controlMethod in controlColumns) {
    const column = controlColumns[filters.controlMethod as keyof typeof controlColumns]
    const controlClause = or(eq(column, 'да'), eq(column, 'дополнительный'), eq(column, LEGACY_CONTROL_REPLACEMENT_VALUE))
    if (controlClause) clauses.push(controlClause)
  }
}

function addColumnFilterClauses(clauses: SQL[], columnFilters: Record<string, string>) {
  for (const [key, value] of Object.entries(columnFilters)) {
    const query = value.trim()
    if (!query) continue

    if (key === ROW_ID_LIST_FILTER_KEY) {
      const filter = parseRowIdListFilter(query)
      if (filter) clauses.push(buildRowIdListWhere(filter))
      continue
    }

    if (key === DISPATCHER_TASK_FILTER_KEY) {
      const filter = parseDispatcherTaskServerFilter(query)
      if (filter) clauses.push(buildDispatcherTaskWhere(filter))
      continue
    }

    if (key === PERCENTAGE_LINE_STAMP_FILTER_KEY) {
      const filter = parsePercentageLineStampFilter(query)
      if (filter) clauses.push(buildPercentageLineStampWhere(filter))
      continue
    }

    if (!FIELD_BY_KEY.has(key as WeldFieldKey)) continue
    const generatedDocumentType = GENERATED_DOCUMENT_FIELD_TYPES[key as keyof typeof GENERATED_DOCUMENT_FIELD_TYPES]
    if (generatedDocumentType) {
      clauses.push(buildGeneratedDocumentColumnWhere(query, generatedDocumentType))
      continue
    }
    if (key === 'finalStatus') {
      clauses.push(buildFinalStatusColumnWhere(query))
      continue
    }
    const column = getWeldColumn(key as WeldFieldKey)
    if (!column) continue

    const choiceFilter = parseWeldColumnChoiceFilter(query)
    if (choiceFilter?.kind === 'values') {
      clauses.push(buildColumnChoiceWhere(column, choiceFilter.values))
      continue
    }

    if (query.startsWith('=')) {
      clauses.push(buildColumnTextEqualsWhere(column, query.slice(1).trim().replace(/^["']|["']$/g, '')))
      continue
    }

    clauses.push(sql`coalesce(${column}::text, '') ilike ${`%${query}%`}`)
  }
}

function buildGeneratedDocumentColumnWhere(query: string, documentType: string) {
  const titleMatch = (value: string) =>
    sql`exists (
      select 1
      from ${generatedDocumentWeldJoints}
      inner join ${generatedDocuments}
        on ${generatedDocuments.id} = ${generatedDocumentWeldJoints.documentId}
      where ${generatedDocumentWeldJoints.weldJointId} = ${weldJoints.id}
        and ${generatedDocuments.type} = ${documentType}
        and lower(trim(coalesce(${generatedDocuments.title}, ''))) = lower(trim(${value}))
    )`
  const withoutDocument = sql`not exists (
    select 1
    from ${generatedDocumentWeldJoints}
    inner join ${generatedDocuments}
      on ${generatedDocuments.id} = ${generatedDocumentWeldJoints.documentId}
    where ${generatedDocumentWeldJoints.weldJointId} = ${weldJoints.id}
      and ${generatedDocuments.type} = ${documentType}
  )`
  const choiceFilter = parseWeldColumnChoiceFilter(query)
  if (choiceFilter?.kind === 'values') {
    const values = [...new Set(choiceFilter.values.map((value) => String(value ?? '').trim()))]
    const choices = values.filter(Boolean).map(titleMatch)
    if (values.includes('')) choices.push(withoutDocument)
    return choices.length > 0 ? or(...choices) ?? sql`false` : sql`false`
  }
  if (query.startsWith('=')) {
    const value = query.slice(1).trim().replace(/^["']|["']$/g, '')
    return value ? titleMatch(value) : withoutDocument
  }
  return sql`exists (
    select 1
    from ${generatedDocumentWeldJoints}
    inner join ${generatedDocuments}
      on ${generatedDocuments.id} = ${generatedDocumentWeldJoints.documentId}
    where ${generatedDocumentWeldJoints.weldJointId} = ${weldJoints.id}
      and ${generatedDocuments.type} = ${documentType}
      and coalesce(${generatedDocuments.title}, '') ilike ${`%${query}%`}
  )`
}

function buildReportSourceWhere(filters: WeldFilters & { columnFilters?: Record<string, string> }) {
  const clauses: SQL[] = []
  addBaseFilterClauses(clauses, filters)
  addReportSourceColumnFilterClauses(clauses, filters.columnFilters ?? {})
  return clauses.length ? and(...clauses) : sql`true`
}

export function buildDerivedReportCacheKey(
  namespace: string,
  report: Exclude<WeldReportKind, 'weldingJournal'>,
  filters: WeldFilters & { columnFilters?: Record<string, string> },
  extra: Record<string, unknown> = {},
) {
  return buildDerivedCalculationCacheKey(namespace, {
    report,
    search: filters.search ?? '',
    projectTitle: filters.projectTitle ?? '',
    line: filters.line ?? '',
    groupName: filters.groupName ?? '',
    category: filters.category ?? '',
    pstoRequired: filters.pstoRequired ?? '',
    weldingMethod: filters.weldingMethod ?? '',
    materialGroup: filters.materialGroup ?? '',
    status: filters.status ?? '',
    finalStatus: filters.finalStatus ?? '',
    controlMethod: filters.controlMethod ?? '',
    columnFilters: filters.columnFilters ?? {},
    ...extra,
  })
}

function buildReportKindWhere(report: Exclude<WeldReportKind, 'weldingJournal'>) {
  const hasWeldingDate = sql`${weldJoints.weldDate} is not null`
  if (report === 'heatTreatment') {
    return and(hasWeldingDate, buildControlReportValueWhere(weldJoints.pstoRequired)) ?? sql`false`
  }
  return (
    and(
      hasWeldingDate,
      or(...LNK_METHODS.map((method) => buildControlReportValueWhere(getWeldColumn(method.enabledKey) ?? sql`null`))) ??
        sql`false`,
    ) ?? sql`false`
  )
}

function buildControlReportValueWhere(column: SQLWrapper) {
  return (
    or(
      buildColumnTextEqualsWhere(column, 'да'),
      buildColumnTextEqualsWhere(column, 'дополнительный'),
      buildColumnTextEqualsWhere(column, LEGACY_CONTROL_REPLACEMENT_VALUE),
      buildColumnTextEqualsWhere(column, 'отменен'),
    ) ?? sql`false`
  )
}

function addReportSourceColumnFilterClauses(clauses: SQL[], columnFilters: Record<string, string>) {
  for (const [key, value] of Object.entries(columnFilters)) {
    const query = value.trim()
    if (!query) continue

    if (key === ROW_ID_LIST_FILTER_KEY) {
      const filter = parseRowIdListFilter(query)
      if (filter) clauses.push(buildRowIdListWhere(filter))
      continue
    }

    if (key === DISPATCHER_TASK_FILTER_KEY) {
      const filter = parseDispatcherTaskServerFilter(query)
      if (filter) clauses.push(buildDispatcherTaskWhere(filter))
      continue
    }

    if (key === PERCENTAGE_LINE_STAMP_FILTER_KEY) {
      const filter = parsePercentageLineStampFilter(query)
      if (filter) clauses.push(buildPercentageLineStampWhere(filter))
      continue
    }

    if (!REPORT_SOURCE_COLUMN_FILTER_KEYS.has(key as WeldFieldKey)) continue
    const column = getWeldColumn(key as WeldFieldKey)
    if (!column) continue

    const choiceFilter = parseWeldColumnChoiceFilter(query)
    if (choiceFilter?.kind === 'values') {
      clauses.push(buildColumnChoiceWhere(column, choiceFilter.values))
      continue
    }

    if (query.startsWith('=')) {
      clauses.push(buildColumnTextEqualsWhere(column, query.slice(1).trim().replace(/^["']|["']$/g, '')))
      continue
    }

    clauses.push(sql`coalesce(${column}::text, '') ilike ${`%${query}%`}`)
  }
}

function getWeldColumn(fieldKey: WeldFieldKey) {
  return WELD_TABLE_COLUMNS[fieldKey as keyof typeof WELD_TABLE_COLUMNS]
}

function getWeldColumnFilterExpression(fieldKey: WeldFieldKey) {
  if (fieldKey !== 'finalStatus') return getWeldColumn(fieldKey)

  const rejectedDuplicateMethods = sql<string>`(
    select string_agg(
      distinct trim(${duplicateControls.method}),
      ', ' order by trim(${duplicateControls.method})
    )
    from ${duplicateControls}
    where ${duplicateControls.weldJointId} = ${weldJoints.id}
      and ${duplicateControls.result} in ('ремонт', 'вырез')
      and trim(${duplicateControls.method}) <> ''
  )`

  return sql<string>`case
    when lower(trim(coalesce(${weldJoints.finalStatus}, ''))) = 'не годен по дублю'
      then concat(
        coalesce(${weldJoints.finalStatus}, ''),
        nullif(concat(' (', ${rejectedDuplicateMethods}, ')'), ' ()')
      )
    else coalesce(${weldJoints.finalStatus}, '')
  end`
}

function buildFinalStatusColumnWhere(query: string) {
  const choiceFilter = parseWeldColumnChoiceFilter(query)
  if (choiceFilter?.kind === 'values') {
    return or(...choiceFilter.values.map(buildFinalStatusChoiceWhere)) ?? sql`false`
  }
  if (query.startsWith('=')) {
    return buildFinalStatusChoiceWhere(query.slice(1).trim().replace(/^["']|["']$/g, ''))
  }
  return sql`coalesce(${getWeldColumnFilterExpression('finalStatus')}::text, '') ilike ${`%${query}%`}`
}

function buildFinalStatusChoiceWhere(value: string) {
  const match = String(value ?? '').trim().match(/^не годен по дублю\s*\((.+)\)$/i)
  if (!match) return buildColumnTextEqualsWhere(weldJoints.finalStatus, value)

  const methods = Array.from(
    new Set(
      match[1]
        .split(',')
        .map((method) => method.trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right, 'ru', { numeric: true, sensitivity: 'base' }))
  if (methods.length === 0) return sql`false`
  const expectedMethods = methods.join(', ')

  return (
    and(
      buildColumnTextEqualsWhere(weldJoints.finalStatus, 'не годен по дублю'),
      sql`${weldJoints.id} in (
        select ${duplicateControls.weldJointId}
        from ${duplicateControls}
        where ${duplicateControls.result} in ('ремонт', 'вырез')
          and trim(${duplicateControls.method}) <> ''
        group by ${duplicateControls.weldJointId}
        having lower(string_agg(
          distinct trim(${duplicateControls.method}),
          ', ' order by trim(${duplicateControls.method})
        )) = lower(${expectedMethods})
      )`,
    ) ?? sql`false`
  )
}

function buildColumnChoiceWhere(column: SQLWrapper, values: readonly string[]) {
  const normalizedValues = [...new Set(values.map((value) => String(value ?? '').trim()))]
  if (normalizedValues.length === 0) return sql`false`
  return or(...normalizedValues.map((value) => buildColumnTextEqualsWhere(column, value))) ?? sql`false`
}

function buildColumnTextEqualsWhere(column: SQLWrapper, value: string) {
  return sql`lower(trim(coalesce(${column}::text, ''))) = lower(trim(${value}))`
}

function buildRowIdListWhere(filter: NonNullable<ReturnType<typeof parseRowIdListFilter>>) {
  if (filter.rowIds.length === 0) return filter.mode === 'exclude' ? sql`true` : sql`false`
  return filter.mode === 'exclude' ? notInArray(weldJoints.id, filter.rowIds) : inArray(weldJoints.id, filter.rowIds)
}

function buildDispatcherTaskWhere(filter: NonNullable<ReturnType<typeof parseDispatcherTaskServerFilter>>) {
  if (filter.mode === 'all') return sql`true`

  const taskClauses: SQL[] = [eq(dispatcherRowTasks.weldJointId, weldJoints.id)]
  if (filter.mode === 'codes') {
    if (filter.codes.length === 0) return sql`false`
    taskClauses.push(inArray(dispatcherRowTasks.code, filter.codes))
  }
  const matchingTask = requireDb()
    .select({ value: sql`1` })
    .from(dispatcherRowTasks)
    .where(and(...taskClauses))

  return filter.mode === 'without' ? notExists(matchingTask) : exists(matchingTask)
}

function normalizedTextEquals(column: SQLWrapper, value: unknown) {
  const normalizedValue = String(value ?? '').replace(/\s+/g, '').trim().toLowerCase()
  return sql`lower(regexp_replace(coalesce(${column}::text, ''), '\\s+', '', 'g')) = ${normalizedValue}`
}

function getColumnFilterOptionFilters(columnFilters: Record<string, string>, fieldKey: WeldFieldKey) {
  const filters = Object.fromEntries(Object.entries(columnFilters).filter(([key]) => !isHiddenReportFilterKey(key)))
  delete filters[fieldKey]
  return filters
}

export function canPaginateReportSource(columnFilters: Record<string, string>) {
  return Object.entries(columnFilters).every(([key, value]) => {
    if (!String(value ?? '').trim()) return true
    return isHiddenReportFilterKey(key) || REPORT_SOURCE_COLUMN_FILTER_KEYS.has(key as WeldFieldKey)
  })
}

export function buildWeldColumnFilterOptionsFromRows(rows: WeldRow[], fieldKey: WeldFieldKey): WeldColumnFilterOption[] {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const value = getWeldColumnFilterRowText(row, fieldKey).trim()
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }

  return sortColumnFilterOptions(
    Array.from(counts.entries()).map(([value, count]) => ({
      value,
      count,
      label: value || '(пусто)',
    })),
  )
}

function sortColumnFilterOptions(options: WeldColumnFilterOption[]) {
  return [...options].sort((left, right) => {
    if (left.value === '') return -1
    if (right.value === '') return 1
    return left.label.localeCompare(right.label, 'ru', { numeric: true, sensitivity: 'base' })
  })
}

function getUniqueSortedTexts(values: unknown[]) {
  return Array.from(
    new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right, 'ru', { numeric: true }))
}

function normalizeUsageValue(value: unknown) {
  return String(value ?? '').trim()
}

function countSingleValueUsage(values: unknown[]) {
  const counts = new Map<string, number>()
  for (const rawValue of values) {
    const value = normalizeUsageValue(rawValue)
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return counts
}

function countMultiValueUsage(values: unknown[], separator: RegExp) {
  const counts = new Map<string, number>()
  for (const rawValue of values) {
    const rowValues = new Set(
      String(rawValue ?? '')
        .split(separator)
        .map(normalizeUsageValue)
        .filter(Boolean),
    )
    rowValues.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1))
  }
  return counts
}

function getReportOrderBy(report: Exclude<WeldReportKind, 'weldingJournal'>) {
  const createdAtColumn = report === 'lnk' ? weldJoints.lnkCreatedAt : weldJoints.pstoCreatedAt
  return [
    sql`${createdAtColumn} desc nulls last`,
    asc(weldJoints.line),
    asc(weldJoints.spool),
    asc(weldJoints.joint),
  ]
}

function buildPercentageLineStampWhere(filter: NonNullable<ReturnType<typeof parsePercentageLineStampFilter>>) {
  const stamp = filter.stamp.trim()
  return and(
    buildColumnTextEqualsWhere(weldJoints.projectTitle as unknown as SQL, filter.projectTitle),
    buildColumnTextEqualsWhere(weldJoints.subtitleCode as unknown as SQL, filter.subtitleCode),
    buildColumnTextEqualsWhere(weldJoints.line as unknown as SQL, filter.line),
    or(
      eq(weldJoints.stamp1K, stamp),
      eq(weldJoints.stamp1Z, stamp),
      eq(weldJoints.stamp1O, stamp),
      eq(weldJoints.stamp2K, stamp),
      eq(weldJoints.stamp2Z, stamp),
      eq(weldJoints.stamp2O, stamp),
    ) ?? sql`false`,
  ) ?? sql`false`
}
