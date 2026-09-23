import {
  and,
  exists,
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
import {
  buildNormalizedControlAvailabilityWhere,
  buildNullableControlEnabledWhere,
} from '@/server/control-availability-sql'
import { attachSystemDocumentIds } from '@/server/generated-document-row-fields'
import { attachHeatTreatmentControlRelations } from '@/server/heat-treatment-control-relations'
import { buildNoRejectedPreHeatTreatmentWhere, buildPreHeatTreatmentAvailableWhere } from '@/server/pre-heat-treatment-policy'
import { assertSecurityScope } from '@/server/security-functions'
import type {
  LnkWorkflowRequestSummary,
  LnkWorkflowRequestSummaryRequest,
  LnkWorkflowRowsRequest,
  LnkWorkflowSummary,
} from '@/server/weld-contracts'
import {
  normalizeLnkWorkflowRequestSummaryRequest,
  normalizeLnkWorkflowRowsRequest,
} from '@/server/weld-contracts'
import {
  buildAvailableLnkRequestWhere,
  buildLnkRequestCandidateWhere,
  buildPrimaryLnkStageReadyWhere,
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
import {
  buildIncludedRowsFirstOrder,
  buildNumberArrayMatch,
  compactWeldRowsForTransport,
} from '@/server/weld-request-utils'

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
  const db = requireDb()
  const selectedRowsOrder = request.limit && request.includeRowIds?.length
    ? [buildIncludedRowsFirstOrder(weldJoints.id, request.includeRowIds)]
    : []
  const readyCandidates = request.scope === 'requestCandidates' || request.scope === 'resultCandidates'
    ? buildLnkCandidateMethodWhere(request, true)
    : undefined
  const readyRowsOrder = readyCandidates
    ? [sql`case when ${readyCandidates} then 0 else 1 end`]
    : []
  const sourceQuery = db
    .select(LNK_WORKFLOW_ROW_SELECT)
    .from(weldJoints)
    .where(buildLnkWorkflowRowsWhere(request))
    .orderBy(...selectedRowsOrder, ...readyRowsOrder, ...getReportOrderBy('lnk'))
  const sourceRows = request.limit
    ? await sourceQuery.limit(request.limit + (request.includeRowIds?.length ?? 0))
    : await sourceQuery
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
  const rowsWithSystemDocumentIds = isLnkDocumentRegistryScope(request.scope)
    ? await attachSystemDocumentIds(rows, db)
    : rows
  return compactWeldRowsForTransport(rowsWithSystemDocumentIds)
}

function isLnkDocumentRegistryScope(scope: LnkWorkflowRowsRequest['scope']) {
  return scope === 'requestRegistry' ||
    scope === 'resultRegistry' ||
    scope === 'preHeatTreatmentRequestRegistry' ||
    scope === 'preHeatTreatmentResultRegistry'
}

export async function getLnkWorkflowSummary(): Promise<LnkWorkflowSummary> {
  await assertSecurityScope('entry')
  const db = requireDb()
  const reportWhere = buildReportKindWhere('lnk')
  const countRows = await db
    .select({
      pendingPrimaryResultRowCount: filteredCount(buildPendingPrimaryLnkResultWhere()),
      primaryResultRowCount: filteredCount(buildFinalPrimaryLnkResultWhere()),
      preHeatTreatmentRequestRowCount: filteredCount(buildPreHeatTreatmentRequestWhere()),
      preHeatTreatmentResultRowCount: filteredCount(buildPreHeatTreatmentFinalResultWhere()),
    })
    .from(weldJoints)
    .where(reportWhere)
  const counts = countRows[0]
  return {
    pendingPrimaryResultRowCount: Number(counts?.pendingPrimaryResultRowCount) || 0,
    primaryResultRowCount: Number(counts?.primaryResultRowCount) || 0,
    preHeatTreatmentRequestRowCount: Number(counts?.preHeatTreatmentRequestRowCount) || 0,
    preHeatTreatmentResultRowCount: Number(counts?.preHeatTreatmentResultRowCount) || 0,
  }
}

export async function getLnkWorkflowRequestSummary(
  input?: LnkWorkflowRequestSummaryRequest,
): Promise<LnkWorkflowRequestSummary> {
  await assertSecurityScope('entry')
  const request = normalizeLnkWorkflowRequestSummaryRequest(input)
  const requestRowsResult = await requireDb().execute<LnkWorkflowRequestSummaryRow>(
    buildLnkWorkflowRequestSummaryQuery(sql`true`, request),
  )
  const hasMore = requestRowsResult.rows.length > request.limit
  return {
    ...buildLnkWorkflowRequestDocumentSummary(requestRowsResult.rows.slice(0, request.limit)),
    hasMore,
  }
}

export function buildLnkWorkflowRequestSummaryQuery(
  additionalWhere: SQL = sql`true`,
  options?: LnkWorkflowRequestSummaryRequest,
) {
  const request = options ? normalizeLnkWorkflowRequestSummaryRequest(options) : null
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
  const searchPattern = request?.search ? `%${request.search.toLocaleLowerCase('ru-RU')}%` : ''
  const resultLimit = request ? request.limit + 1 : null
  const selectedPositionsCtes = request ? sql`,
    selected_request_identities as (
      select name, request_date
      from request_positions
      where is_primary
        ${searchPattern ? sql`
          and lower(concat_ws(
            ' ',
            name,
            request_date,
            project_title,
            subtitle_code,
            line,
            spool,
            joint,
            method_code
          )) like ${searchPattern}
        ` : sql``}
      group by name, request_date
      order by request_date desc, name asc
      limit ${request.limit + 1}
    ),
    selected_request_positions as (
      select positions.*
      from request_positions positions
      inner join selected_request_identities selected
        on selected.name = positions.name
        and selected.request_date = positions.request_date
    )
  ` : sql``
  const positionsSource = request ? sql`selected_request_positions` : sql`request_positions`
  return sql`
    with request_positions as (
      ${sql.join(positionQueries, sql` union all `)}
    )
    ${selectedPositionsCtes},
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
      from ${positionsSource}
      group by name, request_date
    ),
    completed_positions as (
      select distinct on (name, request_date)
        name,
        request_date,
        row_id,
        joint,
        method_code
      from ${positionsSource}
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
    ${resultLimit ? sql`limit ${resultLimit}` : sql``}
  `
}

export function buildLnkWorkflowRequestDocumentSummary(
  rows: readonly LnkWorkflowRequestSummaryRow[],
): LnkWorkflowRequestSummary {
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
  return { requestNames, requestOptions, hasMore: false }
}

export function buildLnkWorkflowRowsWhere(
  input: LnkWorkflowRowsRequest,
): SQL {
  const request = normalizeLnkWorkflowRowsRequest(input)
  const baseWhere = request.scope === 'requestRegistry'
    ? request.requestName
      ? buildExactLnkRequestWhere(request.requestName, request.requestDate ?? '')
      : sql`false`
    : getScopeWhere(request.scope)
  const rowIdsWhere = request.rowIds === null
    ? null
    : request.rowIds.length > 0
      ? buildNumberArrayMatch(weldJoints.id, request.rowIds)
      : sql`false`
  const candidatesIncludeSelected = request.scope.endsWith('Candidates')
  const scopedWhere = !rowIdsWhere
    ? baseWhere
    : candidatesIncludeSelected
      ? or(baseWhere, rowIdsWhere) ?? sql`false`
      : and(baseWhere, rowIdsWhere) ?? sql`false`
  const searchWhere = request.search ? buildLnkWorkflowSearchWhere(request.search) : undefined
  const candidateMethodWhere = buildLnkCandidateMethodWhere(request)
  const resultFilterWhere = request.scope === 'resultRegistry' && request.resultFilter
    ? or(...LNK_METHODS.map((method) => sql`
        lower(btrim(coalesce(${weldJoints[method.resultKey]}::text, ''))) = ${request.resultFilter}
      `)) ?? sql`false`
    : undefined
  const filteredWhere = and(
    scopedWhere,
    searchWhere,
    candidateMethodWhere,
    resultFilterWhere,
  ) ?? sql`false`
  const includedRowsWhere = request.includeRowIds?.length
    ? buildNumberArrayMatch(weldJoints.id, request.includeRowIds)
    : undefined
  return and(
    buildReportKindWhere('lnk'),
    includedRowsWhere ? or(filteredWhere, includedRowsWhere) : filteredWhere,
  ) ?? sql`false`
}

function buildLnkCandidateMethodWhere(
  request: ReturnType<typeof normalizeLnkWorkflowRowsRequest>,
  requireReady = false,
) {
  if (!new Set([
    'requestCandidates',
    'resultCandidates',
    'preHeatTreatmentRequestCandidates',
    'preHeatTreatmentResultCandidates',
  ]).has(request.scope)) {
    return undefined
  }
  const selectedMethods = request.methodKeys?.length
    ? LNK_METHODS.filter((method) => request.methodKeys?.includes(method.requestKey))
    : LNK_METHODS
  if (
    (request.scope === 'requestCandidates' || request.scope === 'preHeatTreatmentRequestCandidates') &&
    !request.methodKeys?.length && !requireReady
  ) return undefined

  if (request.scope === 'preHeatTreatmentRequestCandidates') {
    return or(...selectedMethods.flatMap((method) => {
      const preMethod = PRE_HEAT_TREATMENT_LNK_METHODS.find((candidate) => candidate.code === method.code)
      if (!preMethod) return []
      return [and(
        buildEnabledTextWhere(weldJoints[preMethod.enabledKey]),
        notExists(
          SQL_QUERY_BUILDER
            .select({ value: sql`1` })
            .from(preHeatTreatmentControls)
            .where(and(
              sql`${preHeatTreatmentControls.weldJointId} = ${weldJoints.id}`,
              sql`${preHeatTreatmentControls.method} = ${preMethod.code}`,
              or(
                hasTextWhere(preHeatTreatmentControls.requestName),
                finalResultWhere(preHeatTreatmentControls.result),
              ),
            )),
        ),
      ) ?? sql`false`]
    })) ?? sql`false`
  }

  if (request.scope === 'preHeatTreatmentResultCandidates') {
    if (!request.methodKeys?.length && !request.requestName) return undefined
    return or(...selectedMethods.flatMap((method) => {
      const preMethod = PRE_HEAT_TREATMENT_LNK_METHODS.find((candidate) => candidate.code === method.code)
      if (!preMethod) return []
      return [exists(
        SQL_QUERY_BUILDER
          .select({ value: sql`1` })
          .from(preHeatTreatmentControls)
          .where(and(
            sql`${preHeatTreatmentControls.weldJointId} = ${weldJoints.id}`,
            sql`${preHeatTreatmentControls.method} = ${preMethod.code}`,
            hasTextWhere(preHeatTreatmentControls.requestName),
            sql`not (${finalResultWhere(preHeatTreatmentControls.result)})`,
            request.requestName
              ? and(
                  sql`btrim(coalesce(${preHeatTreatmentControls.requestName}::text, '')) = ${request.requestName}`,
                  sql`btrim(coalesce(${preHeatTreatmentControls.requestDate}::text, '')) = ${request.requestDate ?? ''}`,
                )
              : undefined,
          )),
      )]
    })) ?? sql`false`
  }

  const stageAvailable = (method: (typeof LNK_METHODS)[number]) => (
    !requireReady || request.allowPrimaryBeforePreviousStagesComplete
      ? sql`true`
      : buildPrimaryLnkStageReadyWhere(method.code)
  )
  if (request.scope === 'requestCandidates') {
    return or(...selectedMethods.map((method) => and(
      buildEnabledTextWhere(weldJoints[method.enabledKey]),
      emptyTextWhere(weldJoints[method.requestKey]),
    ) ?? sql`false`)) ?? sql`false`
  }

  return or(...selectedMethods.map((method) => and(
    buildEnabledTextWhere(weldJoints[method.enabledKey]),
    hasTextWhere(weldJoints[method.requestKey]),
    sql`not (${finalResultWhere(weldJoints[method.resultKey])})`,
    stageAvailable(method),
    request.requestName
      ? and(
          sql`btrim(coalesce(${weldJoints[method.requestKey]}::text, '')) = ${request.requestName}`,
          sql`btrim(coalesce(${weldJoints[method.requestDateKey]}::text, '')) = ${request.requestDate ?? ''}`,
        )
      : undefined,
  ) ?? sql`false`)) ?? sql`false`
}

function buildLnkWorkflowSearchWhere(search: string) {
  const pattern = `%${search.toLocaleLowerCase('ru-RU')}%`
  return sql`lower(concat_ws(
    ' ',
    ${weldJoints.projectTitle},
    ${weldJoints.subtitleCode},
    ${weldJoints.line},
    ${weldJoints.spool},
    ${weldJoints.joint},
    ${sql.join(LNK_METHODS.flatMap((method) => [
      weldJoints[method.requestKey],
      weldJoints[method.requestDateKey],
      weldJoints[method.resultKey],
      weldJoints[method.conclusionDateKey],
      weldJoints[method.conclusionKey],
    ]).map((column) => sql`${column}`), sql`, `)}
  )) like ${pattern}`
}

function buildExactLnkRequestWhere(requestName: string, requestDate: string) {
  return or(...LNK_METHODS.map((method) => and(
    sql`btrim(coalesce(${weldJoints[method.requestKey]}::text, '')) = ${requestName}`,
    sql`btrim(coalesce(${weldJoints[method.requestDateKey]}::text, '')) = ${requestDate}`,
  ) ?? sql`false`)) ?? sql`false`
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
  if (scope === 'fieldRows') return sql`true`
  if (scope === 'requestCandidates') return buildLnkRequestCandidateWhere()
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
    buildPreHeatTreatmentAvailableWhere(),
    hasAvailableMethod,
    buildNoRejectedPreHeatTreatmentWhere(),
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
    buildPreHeatTreatmentAvailableWhere(),
    hasPendingControl,
    buildNoRejectedPreHeatTreatmentWhere(),
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
    buildNoRejectedPreHeatTreatmentWhere(),
  ) ?? sql`false`
}

function finalResultWhere(column: SQLWrapper) {
  return sql`lower(btrim(coalesce(${column}::text, ''))) in (${sql.join(FINAL_LNK_RESULTS.map((value) => sql`${value}`), sql`, `)})`
}

function hasTextWhere(column: SQLWrapper) {
  return sql`nullif(btrim(coalesce(${column}::text, '')), '') is not null`
}

function emptyTextWhere(column: SQLWrapper) {
  return sql`btrim(coalesce(${column}::text, '')) = ''`
}

function buildEnabledTextWhere(column: SQLWrapper) {
  return buildNormalizedControlAvailabilityWhere(column, ENABLED_CONTROL_REPORT_VALUES)
}

function filteredCount(where: SQL) {
  return sql<number>`count(*) filter (where ${where})::integer`
}
