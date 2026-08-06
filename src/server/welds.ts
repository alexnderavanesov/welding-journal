import { createServerFn } from '@tanstack/react-start'
import { and, asc, count, desc, eq, exists, getTableColumns, gt, gte, ilike, inArray, lte, notExists, notInArray, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm'
import { requireDb } from '@/db'
import {
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
import { filterWeldRowsByColumns, getWeldColumnFilterCellText } from '@/lib/weld-table-filtering'
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
import {
  ensureDispatcherTaskIndexFresh,
} from '@/server/dispatcher-task-index'
import { markDispatcherTaskIndexDirty } from '@/server/dispatcher-task-index-dirty'
import {
  reserveSystemDocumentName,
  type SystemDocumentSequenceUpdate,
} from '@/server/system-document-sequences'

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
    const [recordWithDuplicateControls] = await attachDuplicateControlsToPage([record])
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
    const [[{ total }], rows] = await Promise.all([
      db.select({ total: count() }).from(weldJoints),
      db
        .select({
          weldingMethod: weldJoints.weldingMethod,
          connectionType: weldJoints.connectionType,
          materialGroup: weldJoints.materialGroup,
          testTypes: weldJoints.testTypes,
        })
        .from(weldJoints),
    ])

    return buildWeldDataUsageSummaryFromRows(rows, Number(total) || 0)
  })

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
          await attachDuplicateControlsToPage(reportRows),
          data.columnFilters,
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

    const sourceRows = await db
      .select(REPORT_DERIVED_FILTER_SELECT)
      .from(weldJoints)
      .where(where)
      .orderBy(...getReportOrderBy(report))
    const sourceRowsWithControls = await attachDuplicateControlsToPage(sourceRows)
    const filteredRows = filterWeldRowsByColumns(
      buildServerReportRows(sourceRowsWithControls as unknown as WeldJoint[], report),
      data.columnFilters,
    )
    const total = filteredRows.length
    const pageIds =
      data.pageSize === WELD_PAGE_ALL_SIZE
        ? filteredRows.map((row) => row.id)
        : filteredRows
            .slice((data.page - 1) * data.pageSize, data.page * data.pageSize)
            .map((row) => row.id)
    const rows = await attachDispatcherTaskCodesToPage(
      await getFullReportRowsByIds(pageIds, report),
      data.columnFilters,
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
      data.columnFilters,
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
  columnFilters: Record<string, string>,
) {
  if (rows.length === 0) return rows
  const ids = [...new Set(rows.map((row) => Number(row.id)).filter(Number.isFinite))]
  if (ids.length === 0) return rows
  const filter = parseDispatcherTaskServerFilter(columnFilters[DISPATCHER_TASK_FILTER_KEY])
  const clauses: SQL[] = [inArray(dispatcherRowTasks.weldJointId, ids)]
  if (filter?.dismissedTaskKeys.length) {
    clauses.push(notInArray(dispatcherRowTasks.taskKey, filter.dismissedTaskKeys))
  }
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
  return compactWeldRowsForTransport(await attachDuplicateControlsToPage(reportRows))
}

export const createWeldJoint = createServerFn({ method: 'POST' })
  .validator((data: WeldPayload) => data)
  .handler(async ({ data }) => {
    const db = requireDb()
    return db.transaction(async (tx) => {
      const [created] = await tx.insert(weldJoints).values(toDbInsert(data)).returning()
      await markDispatcherTaskIndexDirty(tx)
      return created
    })
  })

export const updateWeldJoint = createServerFn({ method: 'POST' })
  .validator((data: WeldPayload) => data)
  .handler(async ({ data }) => {
    if (!data.id) throw new Error('Не передан id записи')
    const id = data.id
    const insertData = toDbInsert(data)
    const db = requireDb()

    return db.transaction(async (tx) => {
      const [updated] = await tx
        .update(weldJoints)
        .set({ ...insertData, updatedAt: new Date() })
        .where(eq(weldJoints.id, id))
        .returning()
      await markDispatcherTaskIndexDirty(tx)
      return updated
    })
  })

export const createWeldJoints = createServerFn({ method: 'POST' })
  .validator((data: { records: WeldPayload[] }) => data)
  .handler(async ({ data }) => {
    if (data.records.length === 0) return []
    const db = requireDb()
    return db.transaction(async (tx) => {
      const created = await tx
        .insert(weldJoints)
        .values(data.records.map(toDbInsert))
        .returning()
      await markDispatcherTaskIndexDirty(tx)
      return created
    })
  })

export const updateWeldJoints = createServerFn({ method: 'POST' })
  .validator((data: { records: WeldPayload[]; systemDocumentSequence?: SystemDocumentSequenceUpdate }) => data)
  .handler(async ({ data }) => {
    if (data.records.length === 0) return []
    if (data.records.some((record) => !record.id)) throw new Error('Не передан id одной из записей')
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
      await markDispatcherTaskIndexDirty(tx)
      return updated
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
    return compactWeldRowsForTransport(await attachDuplicateControlsToPage(rows))
  })

export const deleteWeldJoint = createServerFn({ method: 'POST' })
  .validator((data: { id: number }) => data)
  .handler(async ({ data }) => {
    const db = requireDb()

    await db.transaction(async (tx) => {
      await tx.delete(weldJoints).where(eq(weldJoints.id, data.id))
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
      await markDispatcherTaskIndexDirty(tx)
    })
    return { ok: true }
  })

export const importWeldJoints = createServerFn({ method: 'POST' })
  .validator((data: { records: WeldInput[] }) => data)
  .handler(async ({ data }) => {
    if (data.records.length === 0) return { inserted: 0, rows: [] }
    const values = data.records.map(toDbInsert)
    const db = requireDb()

    return db.transaction(async (tx) => {
      const rows = await tx.insert(weldJoints).values(values).returning()
      await markDispatcherTaskIndexDirty(tx)
      return { inserted: rows.length, rows }
    })
  })

export const clearLnkGeneratedWeldData = createServerFn({ method: 'POST' }).handler(async () => {
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
      for (const row of rows) {
        const weldRow = row as unknown as WeldInput & { id: number }
        const cleanedRow = clearLnkGeneratedData(weldRow)
        if (!hasLnkGeneratedDataChanged(weldRow, cleanedRow)) continue
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
      if (changedRows.length > 0) await markDispatcherTaskIndexDirty(tx)
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

async function listColumnFilterOptions(data: ReturnType<typeof normalizeWeldColumnFilterOptionsRequest>) {
  if (!FIELD_BY_KEY.has(data.fieldKey)) return []
  await ensureDispatcherTaskIndexFresh()
  const columnFilters = getColumnFilterOptionFilters(data.columnFilters, data.fieldKey)
  if (data.report !== 'weldingJournal') {
    const column = getWeldColumn(data.fieldKey)
    if (column && REPORT_SOURCE_COLUMN_FILTER_KEYS.has(data.fieldKey) && canPaginateReportSource(columnFilters)) {
      return listSourceColumnFilterOptions(data.report, data.fieldKey, columnFilters)
    }

    const db = requireDb()
    const where = and(buildReportKindWhere(data.report), buildReportSourceWhere({ ...data, columnFilters })) ?? sql`true`
    const sourceRows = await db
      .select(REPORT_DERIVED_FILTER_SELECT)
      .from(weldJoints)
      .where(where)
      .orderBy(desc(weldJoints.weldDate), asc(weldJoints.line), asc(weldJoints.joint))
    const sourceRowsWithControls = await attachDuplicateControlsToPage(sourceRows)
    const reportRows = filterWeldRowsByColumns(
      buildServerReportRows(sourceRowsWithControls as unknown as WeldJoint[], data.report),
      columnFilters,
    )
    return buildWeldColumnFilterOptionsFromRows(reportRows, data.fieldKey)
  }

  const generatedDocumentType = GENERATED_DOCUMENT_FIELD_TYPES[data.fieldKey as keyof typeof GENERATED_DOCUMENT_FIELD_TYPES]
  if (generatedDocumentType) {
    return listGeneratedDocumentColumnFilterOptions({ ...data, columnFilters }, generatedDocumentType)
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
  columnFilters: Record<string, string>,
) {
  const column = getWeldColumn(fieldKey)
  if (!column) return []
  const db = requireDb()
  const valueExpression = sql<string>`coalesce(${column}::text, '')`
  const where = and(buildReportKindWhere(report), buildReportSourceWhere({ columnFilters })) ?? sql`true`
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

  addColumnFilterClauses(clauses, filters.columnFilters ?? {})

  return clauses.length ? and(...clauses) : sql`true`
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
  addReportSourceColumnFilterClauses(clauses, filters.columnFilters ?? {})
  return clauses.length ? and(...clauses) : sql`true`
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
  if (filter.dismissedTaskKeys.length > 0) {
    taskClauses.push(notInArray(dispatcherRowTasks.taskKey, filter.dismissedTaskKeys))
  }
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
    const value = getWeldColumnFilterCellText(row[fieldKey]).trim()
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
