import { createServerFn } from '@tanstack/react-start'
import { and, asc, count, desc, eq, ilike, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm'
import { requireDb } from '@/db'
import { weldJoints, type NewWeldJoint, type WeldJoint } from '@/db/schema'
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
import { parseWeldColumnChoiceFilter } from '@/lib/weld-column-choice-filter'
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
const SYSTEM_FIELD_KEYS = new Set(['createdAt', 'updatedAt'])
const WELDING_JOURNAL_ORDER_BY = [
  sql`${weldJoints.createdAt} desc nulls last`,
  sql`${weldJoints.weldDate} desc nulls last`,
  asc(weldJoints.line),
  asc(weldJoints.joint),
]
const WELD_TABLE_SELECT = {
  id: weldJoints.id,
  ...Object.fromEntries(
    WELD_FIELDS.map((field) => [field.key, getWeldColumn(field.key as WeldFieldKey)] as const),
  ),
} as Record<'id' | WeldFieldKey, SQL>
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
  'testContour',
  'testDate',
  'boq',
  'testBoq',
  'ks3',
  'testKs3',
  'createdAt',
])

export const listWeldJoints = createServerFn({ method: 'GET' })
  .validator((data: WeldFilters | undefined) => data ?? {})
  .handler(async ({ data }) => {
    const db = requireDb()

    const where = buildWhere(data)
    return db
      .select()
      .from(weldJoints)
      .where(where)
      .orderBy(...WELDING_JOURNAL_ORDER_BY)
      .limit(5000)
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

export const listWeldJointPage = createServerFn({ method: 'GET' })
  .validator((data: WeldPageRequest | undefined) => normalizeWeldPageRequest(data))
  .handler(async ({ data }): Promise<WeldPageResult> => listReportPage(data.report ?? 'weldingJournal', data))

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

async function listReportPage(report: WeldReportKind, data: ReturnType<typeof normalizeWeldPageRequest>) {
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

      return {
        rows: buildServerReportRows(rows, report) as WeldRow[],
        total,
        page: data.page,
        pageSize: data.pageSize,
        hasMore: data.pageSize !== WELD_PAGE_ALL_SIZE && data.page * data.pageSize < total,
      }
    }

    const rows = await db
      .select()
      .from(weldJoints)
      .where(where)
      .orderBy(...getReportOrderBy(report))
    return buildWeldReportPageFromRows(rows, data, report)
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

  return {
    rows: rows as WeldRow[],
    total,
    acceptedWdiTotal,
    page: data.page,
    pageSize: data.pageSize,
    hasMore: data.pageSize !== WELD_PAGE_ALL_SIZE && data.page * data.pageSize < total,
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

export const createWeldJoint = createServerFn({ method: 'POST' })
  .validator((data: WeldPayload) => data)
  .handler(async ({ data }) => {
    const db = requireDb()
    const [created] = await db.insert(weldJoints).values(toDbInsert(data)).returning()
    return created
  })

export const updateWeldJoint = createServerFn({ method: 'POST' })
  .validator((data: WeldPayload) => data)
  .handler(async ({ data }) => {
    if (!data.id) throw new Error('Не передан id записи')
    const insertData = toDbInsert(data)
    const db = requireDb()

    const [updated] = await db
      .update(weldJoints)
      .set({ ...insertData, updatedAt: new Date() })
      .where(eq(weldJoints.id, data.id))
      .returning()
    return updated
  })

export const deleteWeldJoint = createServerFn({ method: 'POST' })
  .validator((data: { id: number }) => data)
  .handler(async ({ data }) => {
    const db = requireDb()

    await db.delete(weldJoints).where(eq(weldJoints.id, data.id))
    return { ok: true }
  })

export const importWeldJoints = createServerFn({ method: 'POST' })
  .validator((data: { records: WeldInput[] }) => data)
  .handler(async ({ data }) => {
    if (data.records.length === 0) return { inserted: 0, rows: [] }
    const values = data.records.map(toDbInsert)
    const db = requireDb()

    const rows = await db.insert(weldJoints).values(values).returning()
    return { inserted: rows.length, rows }
  })

export const clearLnkGeneratedWeldData = createServerFn({ method: 'POST' }).handler(async () => {
  const db = requireDb()
  const rows = await db.select().from(weldJoints).limit(5000)
  const updatedRows = []

  for (const row of rows) {
    const weldRow = row as unknown as WeldInput & { id: number }
    const cleanedRow = clearLnkGeneratedData(weldRow)
    if (!hasLnkGeneratedDataChanged(weldRow, cleanedRow)) continue
    const updateData = [...LNK_GENERATED_FIELD_KEYS].reduce<Record<string, null>>((data, fieldKey) => {
      data[fieldKey] = null
      return data
    }, {})
    const { finalStatus } = withLnkFinalStatus(cleanedRow)
    const [updated] = await db
      .update(weldJoints)
      .set({ ...updateData, finalStatus, updatedAt: new Date() })
      .where(eq(weldJoints.id, row.id))
      .returning()
    if (updated) updatedRows.push(updated)
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
  const columnFilters = getColumnFilterOptionFilters(data.columnFilters, data.fieldKey)
  if (data.report !== 'weldingJournal') {
    const column = getWeldColumn(data.fieldKey)
    if (column && REPORT_SOURCE_COLUMN_FILTER_KEYS.has(data.fieldKey) && canPaginateReportSource(columnFilters)) {
      return listSourceColumnFilterOptions(data.report, data.fieldKey, columnFilters)
    }

    const db = requireDb()
    const where = and(buildReportKindWhere(data.report), buildReportSourceWhere({ ...data, columnFilters })) ?? sql`true`
    const rows = await db
      .select()
      .from(weldJoints)
      .where(where)
      .orderBy(desc(weldJoints.weldDate), asc(weldJoints.line), asc(weldJoints.joint))
    const reportRows = buildWeldReportPageFromRows(rows, { page: 1, pageSize: WELD_PAGE_ALL_SIZE, columnFilters }, data.report).rows
    return buildWeldColumnFilterOptionsFromRows(reportRows, data.fieldKey)
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

function buildWhere(filters: WeldFilters & { columnFilters?: Record<string, string> }) {
  const clauses: SQL[] = []

  if (filters.search?.trim()) {
    const search = `%${filters.search.trim()}%`
    clauses.push(
      or(
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
        ilike(weldJoints.responsible, search),
      ),
    )
  }

  for (const key of filterKeys) {
    const value = filters[key]
    if (value) clauses.push(eq(weldJoints[key], value))
  }

  if (filters.controlMethod && filters.controlMethod in controlColumns) {
    const column = controlColumns[filters.controlMethod as keyof typeof controlColumns]
    clauses.push(or(eq(column, 'да'), eq(column, 'дополнительный'), eq(column, LEGACY_CONTROL_REPLACEMENT_VALUE)))
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
      if (filter) clauses.push(or(...filter.rowIds.map((id) => eq(weldJoints.id, id))) ?? sql`false`)
      continue
    }

    if (key === PERCENTAGE_LINE_STAMP_FILTER_KEY) {
      const filter = parsePercentageLineStampFilter(query)
      if (filter) clauses.push(buildPercentageLineStampWhere(filter))
      continue
    }

    if (!FIELD_BY_KEY.has(key as WeldFieldKey)) continue
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

function buildReportSourceWhere(filters: WeldFilters & { columnFilters?: Record<string, string> }) {
  const clauses: SQL[] = []
  addReportSourceColumnFilterClauses(clauses, filters.columnFilters ?? {})
  return clauses.length ? and(...clauses) : sql`true`
}

function buildReportKindWhere(report: Exclude<WeldReportKind, 'weldingJournal'>) {
  const hasWeldingDate = sql`${weldJoints.weldDate} is not null`
  if (report === 'heatTreatment') {
    return and(hasWeldingDate, buildControlReportValueWhere(weldJoints.pstoRequired as unknown as SQL)) ?? sql`false`
  }
  return (
    and(
      hasWeldingDate,
      or(...LNK_METHODS.map((method) => buildControlReportValueWhere(getWeldColumn(method.enabledKey) ?? sql`null`))) ??
        sql`false`,
    ) ?? sql`false`
  )
}

function buildControlReportValueWhere(column: SQL) {
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
      if (filter) clauses.push(or(...filter.rowIds.map((id) => eq(weldJoints.id, id))) ?? sql`false`)
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
  return (weldJoints as Record<string, unknown>)[fieldKey] as SQL | undefined
}

function buildColumnChoiceWhere(column: SQL, values: readonly string[]) {
  const normalizedValues = [...new Set(values.map((value) => String(value ?? '').trim()))]
  if (normalizedValues.length === 0) return sql`false`
  return or(...normalizedValues.map((value) => buildColumnTextEqualsWhere(column, value))) ?? sql`false`
}

function buildColumnTextEqualsWhere(column: SQL, value: string) {
  return sql`lower(trim(coalesce(${column}::text, ''))) = lower(trim(${value}))`
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
