import {
  and,
  exists,
  inArray,
  notExists,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from 'drizzle-orm'
import { QueryBuilder } from 'drizzle-orm/pg-core'

import { requireDb } from '@/db'
import {
  duplicateControls,
  preHeatTreatmentControls,
  weldJoints,
  type WeldJoint,
} from '@/db/schema'
import { getDateInputValidationReason } from '@/lib/date-format'
import type { WeldRow } from '@/lib/dispatcher-types'
import { ALL_LNK_FIELD_METHODS, LNK_METHODS } from '@/lib/lnk-report-config'
import { PRE_HEAT_TREATMENT_LNK_METHODS } from '@/lib/lnk-control-stage'
import {
  collectRequestDocumentIdentities,
  createRequestDocumentIdentity,
} from '@/lib/request-document-identity'
import { buildNullableControlEnabledWhere } from '@/server/control-availability-sql'
import { attachHeatTreatmentControlRelations } from '@/server/heat-treatment-control-relations'
import { assertSecurityScope } from '@/server/security-functions'
import type {
  LnkWorkflowRowsRequest,
  LnkWorkflowSummary,
} from '@/server/weld-contracts'
import { normalizeLnkWorkflowRowsRequest } from '@/server/weld-contracts'
import {
  buildAvailableLnkRequestWhere,
  buildPstoExecutionHistoryWhere,
  buildReportKindWhere,
  buildServerReportRows,
  getReportOrderBy,
  attachDuplicateControlsToPage,
  ENABLED_CONTROL_REPORT_VALUES,
} from '@/server/weld-read'
import {
  applyCurrentSystemWdi,
  loadServerOtherSettings,
  WELD_TABLE_SELECT,
} from '@/server/weld-server-shared'
import { compactWeldRowsForTransport } from '@/server/weld-request-utils'

const SQL_QUERY_BUILDER = new QueryBuilder()
const FINAL_LNK_RESULTS = ['годен', 'ремонт', 'вырез', 'годен (отменен)'] as const

const LNK_WORKFLOW_FIELD_KEYS = new Set<string>([
  'id',
  'rowVersion',
  'weldDate',
  'projectTitle',
  'subtitleCode',
  'line',
  'spool',
  'joint',
  'connectionType',
  'd1',
  'd2',
  't1',
  't2',
  'wdi',
  'officiality',
  'finalStatus',
  'lnkCreatedAt',
  'preHeatTreatmentLnkExempt',
  'pstoRequired',
  'pstoControlBasis',
  'pstoCancellationDate',
  'pstoRequest',
  'pstoRequestDate',
  'pstoDate',
  'heatTreatmentDiagram',
  'pstoResult',
  'hasTvmt',
  'tvmtRequest',
  'tvmtRequestDate',
  'tvmtResult',
  'tvmtConclusionDate',
  'tvmtConclusion',
  'rkExposureConfirmedDiameter',
  ...LNK_METHODS.flatMap((method) => [
    method.enabledKey,
    method.requestKey,
    method.requestDateKey,
    method.resultKey,
    method.conclusionDateKey,
    method.conclusionKey,
    method.defectDescriptionKey,
  ]),
])

export const LNK_WORKFLOW_ROW_SELECT = Object.fromEntries(
  Object.entries(WELD_TABLE_SELECT).filter(([fieldKey]) => LNK_WORKFLOW_FIELD_KEYS.has(fieldKey)),
) as typeof WELD_TABLE_SELECT

type LnkWorkflowRequestSummaryRow = {
  name: string
  date: string
  hasPrimary: boolean
  rowCount: number | string
  positionCount: number | string
  methodCodes: string[] | null
  searchText: string | null
  completedRowId: number | string | null
  completedJoint: string | null
  completedMethodCode: string | null
}

export async function listLnkWorkflowRows(
  input: LnkWorkflowRowsRequest,
): Promise<WeldRow[]> {
  await assertSecurityScope('entry')
  const request = normalizeLnkWorkflowRowsRequest(input)
  const sourceRows = await requireDb()
    .select(LNK_WORKFLOW_ROW_SELECT)
    .from(weldJoints)
    .where(buildLnkWorkflowRowsWhere(request))
    .orderBy(...getReportOrderBy('lnk'))
  const reportRows = applyCurrentSystemWdi(
    buildServerReportRows(sourceRows as unknown as WeldJoint[], 'lnk'),
    await loadServerOtherSettings(),
  )
  const [rowsWithDuplicateControls, rowsWithHeatTreatmentControls] = await Promise.all([
    attachDuplicateControlsToPage(reportRows),
    attachHeatTreatmentControlRelations(reportRows),
  ])
  const rows = reportRows.map((row, index) => ({
    ...row,
    ...rowsWithDuplicateControls[index],
    ...rowsWithHeatTreatmentControls[index],
  }))
  return compactWeldRowsForTransport(rows)
}

export async function getLnkWorkflowSummary(): Promise<LnkWorkflowSummary> {
  await assertSecurityScope('entry')
  const db = requireDb()
  const reportWhere = buildReportKindWhere('lnk')
  const [countRows, requestRowsResult] = await Promise.all([
    db
      .select({
        pendingPrimaryResultRowCount: filteredCount(buildPendingPrimaryLnkResultWhere()),
        primaryResultRowCount: filteredCount(buildFinalPrimaryLnkResultWhere()),
        preHeatTreatmentRequestRowCount: filteredCount(buildPreHeatTreatmentRequestWhere()),
        preHeatTreatmentResultRowCount: filteredCount(buildPreHeatTreatmentFinalResultWhere()),
      })
      .from(weldJoints)
      .where(reportWhere),
    db.execute<LnkWorkflowRequestSummaryRow>(buildLnkWorkflowRequestSummaryQuery()),
  ])
  const counts = countRows[0]
  return {
    ...buildLnkWorkflowRequestDocumentSummary(requestRowsResult.rows),
    pendingPrimaryResultRowCount: Number(counts?.pendingPrimaryResultRowCount) || 0,
    primaryResultRowCount: Number(counts?.primaryResultRowCount) || 0,
    preHeatTreatmentRequestRowCount: Number(counts?.preHeatTreatmentRequestRowCount) || 0,
    preHeatTreatmentResultRowCount: Number(counts?.preHeatTreatmentResultRowCount) || 0,
  }
}

export function buildLnkWorkflowRequestSummaryQuery(additionalWhere: SQL = sql`true`) {
  const primaryMethodCodes = new Set<string>(LNK_METHODS.map((method) => method.code))
  const reportWhere = and(buildReportKindWhere('lnk'), additionalWhere) ?? sql`false`
  const positionQueries = ALL_LNK_FIELD_METHODS.map((method, index) => sql`
    select
      ${weldJoints.id} as row_id,
      btrim(coalesce(${weldJoints[method.requestKey]}::text, '')) as name,
      btrim(coalesce(${weldJoints[method.requestDateKey]}::text, '')) as request_date,
      ${method.code}::text as method_code,
      ${index}::integer as method_order,
      ${primaryMethodCodes.has(method.code)}::boolean as is_primary,
      (
        (
          btrim(coalesce(${weldJoints[method.resultKey]}::text, '')) <> ''
          and lower(btrim(coalesce(${weldJoints[method.resultKey]}::text, '')))
            not in ('ожидает нк', 'ожидает', 'ожидает заявку')
        )
        or btrim(coalesce(${weldJoints[method.conclusionDateKey]}::text, '')) <> ''
        or btrim(coalesce(${weldJoints[method.conclusionKey]}::text, '')) <> ''
      ) as completed,
      ${weldJoints.projectTitle} as project_title,
      ${weldJoints.subtitleCode} as subtitle_code,
      ${weldJoints.line} as line,
      ${weldJoints.spool} as spool,
      ${weldJoints.joint} as joint
    from ${weldJoints}
    where ${reportWhere}
      and ${hasTextWhere(weldJoints[method.requestKey])}
  `)
  return sql`
    with request_positions as (
      ${sql.join(positionQueries, sql` union all `)}
    ),
    request_summaries as (
      select
        name,
        request_date,
        bool_or(is_primary) as has_primary,
        count(distinct row_id) filter (where is_primary)::integer as row_count,
        count(*) filter (where is_primary)::integer as position_count,
        array_agg(distinct method_code) filter (where is_primary) as method_codes,
        concat_ws(
          ' ',
          nullif(string_agg(distinct lower(btrim(coalesce(project_title, ''))), ' ')
            filter (where is_primary and btrim(coalesce(project_title, '')) <> ''), ''),
          nullif(string_agg(distinct lower(btrim(coalesce(subtitle_code, ''))), ' ')
            filter (where is_primary and btrim(coalesce(subtitle_code, '')) <> ''), ''),
          nullif(string_agg(distinct lower(btrim(coalesce(line, ''))), ' ')
            filter (where is_primary and btrim(coalesce(line, '')) <> ''), ''),
          nullif(string_agg(distinct lower(btrim(coalesce(spool, ''))), ' ')
            filter (where is_primary and btrim(coalesce(spool, '')) <> ''), ''),
          nullif(string_agg(distinct lower(btrim(coalesce(joint, ''))), ' ')
            filter (where is_primary and btrim(coalesce(joint, '')) <> ''), '')
        ) as search_text
      from request_positions
      group by name, request_date
    ),
    completed_positions as (
      select distinct on (name, request_date)
        name,
        request_date,
        row_id,
        joint,
        method_code
      from request_positions
      where is_primary and completed
      order by name, request_date, row_id, method_order
    )
    select
      summary.name,
      summary.request_date as date,
      summary.has_primary as "hasPrimary",
      summary.row_count as "rowCount",
      summary.position_count as "positionCount",
      summary.method_codes as "methodCodes",
      summary.search_text as "searchText",
      completed.row_id as "completedRowId",
      completed.joint as "completedJoint",
      completed.method_code as "completedMethodCode"
    from request_summaries summary
    left join completed_positions completed
      on completed.name = summary.name
      and completed.request_date = summary.request_date
    order by summary.request_date desc, summary.name asc
  `
}

export function buildLnkWorkflowRequestDocumentSummary(
  rows: readonly LnkWorkflowRequestSummaryRow[],
): Pick<LnkWorkflowSummary, 'requestNames' | 'requestOptions'> {
  const requestNames = [...new Set(rows.map((row) => String(row.name ?? '').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'ru'))
  const primaryRows = rows.filter((row) => row.hasPrimary)
  const rowsByIdentity = new Map(primaryRows.flatMap((row) => {
    const identity = createRequestDocumentIdentity(row.name, row.date)
    return identity ? [[identity.key, row] as const] : []
  }))
  const methodOrder = new Map<string, number>(LNK_METHODS.map((method, index) => [method.code, index]))
  const requestOptions = collectRequestDocumentIdentities(primaryRows.flatMap((row) => {
    const identity = createRequestDocumentIdentity(row.name, row.date)
    return identity ? [identity] : []
  })).map((identity) => {
    const row = rowsByIdentity.get(identity.key)!
    const completedRowId = Number(row.completedRowId)
    const completedJoint = String(row.completedJoint ?? '').trim()
    const completedMethodCode = String(row.completedMethodCode ?? '').trim()
    const disabledReason = getDateInputValidationReason(identity.date, 'Дата заявки ЛНК')
      ? 'У заявки отсутствует корректная дата, поэтому проверить хронологию добавляемых стыков нельзя.'
      : Number.isInteger(completedRowId) && completedRowId > 0
        ? `Заявка закрыта для дополнения: по стыку ${completedJoint || `№${completedRowId}`}, ${completedMethodCode} уже внесен результат или заключение.`
        : null
    const methodCodes = [...new Set((row.methodCodes ?? []).map((code) => String(code).trim()).filter(Boolean))]
      .sort((left, right) => (methodOrder.get(left) ?? Number.MAX_SAFE_INTEGER) - (methodOrder.get(right) ?? Number.MAX_SAFE_INTEGER))
    return {
      ...identity,
      rowCount: Number(row.rowCount) || 0,
      positionCount: Number(row.positionCount) || 0,
      methodCodes,
      searchText: String(row.searchText ?? ''),
      disabledReason,
    }
  })
  return { requestNames, requestOptions }
}

export function buildLnkWorkflowRowsWhere(
  input: LnkWorkflowRowsRequest,
): SQL {
  const request = normalizeLnkWorkflowRowsRequest(input)
  const baseWhere = getScopeWhere(request.scope)
  const rowIdsWhere = request.rowIds === null
    ? null
    : request.rowIds.length > 0
      ? inArray(weldJoints.id, request.rowIds)
      : sql`false`
  const candidatesIncludeSelected = request.scope.endsWith('Candidates')
  const scopedWhere = !rowIdsWhere
    ? baseWhere
    : candidatesIncludeSelected
      ? or(baseWhere, rowIdsWhere) ?? sql`false`
      : and(baseWhere, rowIdsWhere) ?? sql`false`
  return and(buildReportKindWhere('lnk'), scopedWhere) ?? sql`false`
}

export function buildPendingPrimaryLnkResultWhere() {
  const hasPendingMethod = or(...LNK_METHODS.map((method) => and(
    buildEnabledTextWhere(weldJoints[method.enabledKey]),
    hasTextWhere(weldJoints[method.requestKey]),
    sql`lower(btrim(coalesce(${weldJoints[method.resultKey]}::text, ''))) not in (${sql.join(FINAL_LNK_RESULTS.map((value) => sql`${value}`), sql`, `)})`,
  ) ?? sql`false`)) ?? sql`false`
  return and(hasPendingMethod, buildNoRejectedLnkResultWhere()) ?? sql`false`
}

export function buildFinalPrimaryLnkResultWhere() {
  return or(...LNK_METHODS.map((method) => finalResultWhere(weldJoints[method.resultKey]))) ?? sql`false`
}

export function buildPreHeatTreatmentRequestWhere() {
  return exists(
    SQL_QUERY_BUILDER
      .select({ value: sql`1` })
      .from(preHeatTreatmentControls)
      .where(and(
        sql`${preHeatTreatmentControls.weldJointId} = ${weldJoints.id}`,
        hasTextWhere(preHeatTreatmentControls.requestName),
      )),
  )
}

export function buildPreHeatTreatmentFinalResultWhere() {
  return exists(
    SQL_QUERY_BUILDER
      .select({ value: sql`1` })
      .from(preHeatTreatmentControls)
      .where(and(
        sql`${preHeatTreatmentControls.weldJointId} = ${weldJoints.id}`,
        finalResultWhere(preHeatTreatmentControls.result),
      )),
  )
}

function getScopeWhere(scope: LnkWorkflowRowsRequest['scope']) {
  if (scope === 'requestCandidates') return buildAvailableLnkRequestWhere()
  if (scope === 'requestRegistry') return buildAnyLnkRequestWhere(false)
  if (scope === 'resultCandidates') return buildPendingPrimaryLnkResultWhere()
  if (scope === 'resultRegistry') return buildFinalPrimaryLnkResultWhere()
  if (scope === 'officialityCandidates') return buildOfficialityCandidateWhere()
  if (scope === 'preHeatTreatmentRequestCandidates') return buildPreHeatTreatmentRequestCandidateWhere()
  if (scope === 'preHeatTreatmentResultCandidates') return buildPreHeatTreatmentResultCandidateWhere()
  if (scope === 'preHeatTreatmentRequestRegistry') return buildPreHeatTreatmentRequestWhere()
  return buildPreHeatTreatmentFinalResultWhere()
}

function buildAnyLnkRequestWhere(includeTvmt: boolean) {
  const methods = includeTvmt ? ALL_LNK_FIELD_METHODS : LNK_METHODS
  return or(...methods.map((method) => hasTextWhere(weldJoints[method.requestKey]))) ?? sql`false`
}

function buildOfficialityCandidateWhere() {
  return or(
    sql`lower(btrim(coalesce(${weldJoints.officiality}::text, ''))) = 'неофициальный'`,
    sql`not (${buildNoRejectedLnkResultWhere()})`,
  ) ?? sql`false`
}

function buildPreHeatTreatmentRequestCandidateWhere() {
  const hasAvailableMethod = or(...PRE_HEAT_TREATMENT_LNK_METHODS.map((method) => and(
    buildEnabledTextWhere(weldJoints[method.enabledKey]),
    notExists(
      SQL_QUERY_BUILDER
        .select({ value: sql`1` })
        .from(preHeatTreatmentControls)
        .where(and(
          sql`${preHeatTreatmentControls.weldJointId} = ${weldJoints.id}`,
          sql`${preHeatTreatmentControls.method} = ${method.code}`,
          or(
            hasTextWhere(preHeatTreatmentControls.requestName),
            finalResultWhere(preHeatTreatmentControls.result),
          ),
        )),
    ),
  ) ?? sql`false`)) ?? sql`false`
  return and(
    buildPreHeatTreatmentRequiredWhere(),
    hasAvailableMethod,
    buildNoRejectedPreHeatTreatmentResultWhere(),
  ) ?? sql`false`
}

function buildPreHeatTreatmentResultCandidateWhere() {
  const hasPendingControl = exists(
    SQL_QUERY_BUILDER
      .select({ value: sql`1` })
      .from(preHeatTreatmentControls)
      .where(and(
        sql`${preHeatTreatmentControls.weldJointId} = ${weldJoints.id}`,
        hasTextWhere(preHeatTreatmentControls.requestName),
        sql`not (${finalResultWhere(preHeatTreatmentControls.result)})`,
      )),
  )
  return and(
    buildPreHeatTreatmentRequiredWhere(),
    hasPendingControl,
    buildNoRejectedPreHeatTreatmentResultWhere(),
  ) ?? sql`false`
}

function buildPreHeatTreatmentRequiredWhere() {
  return and(
    or(
      buildNullableControlEnabledWhere(weldJoints.pstoRequired, ENABLED_CONTROL_REPORT_VALUES),
      buildPstoExecutionHistoryWhere(),
    ),
    sql`${weldJoints.preHeatTreatmentLnkExempt} = false`,
  ) ?? sql`false`
}

function buildNoRejectedLnkResultWhere() {
  return and(
    ...LNK_METHODS.map((method) => sql`lower(btrim(coalesce(${weldJoints[method.resultKey]}::text, ''))) not in ('ремонт', 'вырез')`),
    notExists(
      SQL_QUERY_BUILDER
        .select({ value: sql`1` })
        .from(duplicateControls)
        .where(and(
          sql`${duplicateControls.weldJointId} = ${weldJoints.id}`,
          sql`lower(btrim(coalesce(${duplicateControls.result}::text, ''))) in ('ремонт', 'вырез')`,
        )),
    ),
    buildNoRejectedPreHeatTreatmentResultWhere(),
  ) ?? sql`false`
}

function buildNoRejectedPreHeatTreatmentResultWhere() {
  return notExists(
    SQL_QUERY_BUILDER
      .select({ value: sql`1` })
      .from(preHeatTreatmentControls)
      .where(and(
        sql`${preHeatTreatmentControls.weldJointId} = ${weldJoints.id}`,
        sql`lower(btrim(coalesce(${preHeatTreatmentControls.result}::text, ''))) in ('ремонт', 'вырез')`,
      )),
  )
}

function finalResultWhere(column: SQLWrapper) {
  return sql`lower(btrim(coalesce(${column}::text, ''))) in (${sql.join(FINAL_LNK_RESULTS.map((value) => sql`${value}`), sql`, `)})`
}

function hasTextWhere(column: SQLWrapper) {
  return sql`nullif(btrim(coalesce(${column}::text, '')), '') is not null`
}

function buildEnabledTextWhere(column: SQLWrapper) {
  return inArray(column, ENABLED_CONTROL_REPORT_VALUES)
}

function filteredCount(where: SQL) {
  return sql<number>`count(*) filter (where ${where})::integer`
}
