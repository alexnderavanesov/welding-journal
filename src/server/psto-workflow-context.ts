import {
  and,
  count,
  eq,
  exists,
  gt,
  not,
  notExists,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from 'drizzle-orm'
import { alias, QueryBuilder } from 'drizzle-orm/pg-core'

import { requireDb } from '@/db'
import {
  preHeatTreatmentControls,
  pstoRepeatCycles,
  weldJoints,
  type WeldJoint,
} from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import { PRE_HEAT_TREATMENT_LNK_METHODS } from '@/lib/lnk-control-stage'
import { ALL_LNK_FIELD_METHODS } from '@/lib/lnk-report-config'
import { hasPstoResultData } from '@/lib/psto-result-derived-utils'
import { createRequestDocumentIdentity } from '@/lib/request-document-identity'
import {
  canAddPstoWorkflowResult,
  canCreatePstoWorkflowRequest,
} from '@/lib/psto-status'
import { canAddTvmtResult, canCreateTvmtRequest } from '@/lib/tvmt-field-updates'
import { buildNullableControlEnabledWhere } from '@/server/control-availability-sql'
import {
  normalizePstoWorkflowRequestOptionsRequest,
  normalizePstoWorkflowRowsRequest,
  type PstoWorkflowRequestOptionsRequest,
  type PstoWorkflowRequestOptionsResult,
  type PstoWorkflowRowsRequest,
  type PstoWorkflowSummary,
} from '@/server/weld-contracts'
import { attachHeatTreatmentControlRelations } from '@/server/heat-treatment-control-relations'
import { assertSecurityScope } from '@/server/security-functions'
import {
  buildReportKindWhere,
  buildServerReportRows,
  getReportOrderBy,
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
import { ENABLED_CONTROL_REPORT_VALUES } from '@/server/weld-read'

const SQL_QUERY_BUILDER = new QueryBuilder()
const CURRENT_REPEAT_CYCLE = alias(pstoRepeatCycles, 'current_psto_repeat_cycle')
const NEWER_REPEAT_CYCLE = alias(pstoRepeatCycles, 'newer_psto_repeat_cycle')

const PSTO_WORKFLOW_FIELD_KEYS = new Set<string>([
  'id',
  'rowVersion',
  'weldDate',
  'projectTitle',
  'subtitleCode',
  'line',
  'groupName',
  'category',
  'isometry',
  'sheet',
  'revisionNumber',
  'spool',
  'spoolId',
  'joint',
  'connectionType',
  'd1',
  'd2',
  't1',
  't2',
  'wdi',
  'officiality',
  'finalStatus',
  'pstoCreatedAt',
  'pstoUpdatedAt',
  'lnkCreatedAt',
  'lnkUpdatedAt',
  'preHeatTreatmentLnkExempt',
  'pstoRequired',
  'pstoControlBasis',
  'pstoCancellationDate',
  'pstoRequest',
  'pstoRequestDate',
  'pstoDate',
  'heatTreatmentDiagram',
  'pstoResult',
  'pstoNote',
  'tvmtRequest',
  'tvmtRequestDate',
  'tvmtResult',
  'tvmtConclusionDate',
  'tvmtConclusion',
  'pstoBoq',
  'pstoKs3',
  ...(ALL_LNK_FIELD_METHODS
    .flatMap((method) => [
      method.enabledKey,
      method.requestKey,
      method.requestDateKey,
      method.resultKey,
      method.conclusionDateKey,
      method.conclusionKey,
      method.defectDescriptionKey,
    ])
    .filter((fieldKey) => fieldKey !== null) as string[]),
])

export const PSTO_WORKFLOW_ROW_SELECT = Object.fromEntries(
  Object.entries(WELD_TABLE_SELECT).filter(([fieldKey]) => PSTO_WORKFLOW_FIELD_KEYS.has(fieldKey)),
) as typeof WELD_TABLE_SELECT

export async function listPstoWorkflowRows(
  input: PstoWorkflowRowsRequest,
): Promise<WeldRow[]> {
  await assertSecurityScope('entry')
  const request = normalizePstoWorkflowRowsRequest(input)
  if (request.rowIds?.length === 0) return []

  const selectedRowsOrder = request.limit && request.includeRowIds?.length
    ? [buildIncludedRowsFirstOrder(weldJoints.id, request.includeRowIds)]
    : []
  const sourceQuery = requireDb()
    .select(PSTO_WORKFLOW_ROW_SELECT)
    .from(weldJoints)
    .where(buildPstoWorkflowRowsWhere(request))
    .orderBy(...selectedRowsOrder, ...getReportOrderBy('heatTreatment'))
  const sourceRows = request.limit
    ? await sourceQuery.limit(request.limit + (request.includeRowIds?.length ?? 0))
    : await sourceQuery
  const relatedRows = await attachHeatTreatmentControlRelations(sourceRows)
  const reportRows = applyCurrentSystemWdi(
    buildServerReportRows(relatedRows as unknown as WeldJoint[], 'heatTreatment'),
    await loadServerOtherSettings(),
  )
  const scopedRows = filterPstoWorkflowRows(reportRows, request.scope, request.includeRowIds)
  return compactWeldRowsForTransport(scopedRows)
}

export async function getPstoWorkflowSummary(): Promise<PstoWorkflowSummary> {
  await assertSecurityScope('entry')
  const [row] = await requireDb()
    .select({
      requestCandidateCount: countFiltered(buildPstoScopeWhere('requestCandidates')),
      requestRegistryCount: countFiltered(buildPstoScopeWhere('requestRegistry')),
      resultCandidateCount: countFiltered(buildPstoScopeWhere('resultCandidates')),
      resultRegistryCount: countFiltered(buildPstoScopeWhere('resultRegistry')),
      tvmtRequestCandidateCount: countFiltered(buildPstoScopeWhere('tvmtRequestCandidates')),
      tvmtResultCandidateCount: countFiltered(buildPstoScopeWhere('tvmtResultCandidates')),
    })
    .from(weldJoints)
    .where(buildReportKindWhere('heatTreatment'))

  return {
    requestCandidateCount: Number(row?.requestCandidateCount) || 0,
    requestRegistryCount: Number(row?.requestRegistryCount) || 0,
    resultCandidateCount: Number(row?.resultCandidateCount) || 0,
    resultRegistryCount: Number(row?.resultRegistryCount) || 0,
    tvmtRequestCandidateCount: Number(row?.tvmtRequestCandidateCount) || 0,
    tvmtResultCandidateCount: Number(row?.tvmtResultCandidateCount) || 0,
  }
}

type PstoWorkflowRequestOptionRow = {
  name: string
  date: string
}

export async function getPstoWorkflowRequestOptions(
  input?: PstoWorkflowRequestOptionsRequest,
): Promise<PstoWorkflowRequestOptionsResult> {
  await assertSecurityScope('entry')
  const request = normalizePstoWorkflowRequestOptionsRequest(input)
  const result = await requireDb().execute<PstoWorkflowRequestOptionRow>(
    buildPstoWorkflowRequestOptionsQuery(request),
  )
  const hasMore = result.rows.length > request.limit
  return {
    options: result.rows
      .slice(0, request.limit)
      .flatMap((row) => {
        const identity = createRequestDocumentIdentity(row.name, row.date)
        return identity ? [identity] : []
      }),
    hasMore,
  }
}

export function buildPstoWorkflowRequestOptionsQuery(
  input?: PstoWorkflowRequestOptionsRequest,
) {
  const request = normalizePstoWorkflowRequestOptionsRequest(input)
  const searchWhere = request.search
    ? buildPstoWorkflowSearchWhere(request.search)
    : undefined
  return sql`
    select
      btrim(coalesce(${weldJoints.pstoRequest}::text, '')) as name,
      btrim(coalesce(${weldJoints.pstoRequestDate}::text, '')) as date
    from ${weldJoints}
    where ${and(
      buildReportKindWhere('heatTreatment'),
      hasTextWhere(weldJoints.pstoRequest),
      searchWhere,
    )}
    group by
      btrim(coalesce(${weldJoints.pstoRequest}::text, '')),
      btrim(coalesce(${weldJoints.pstoRequestDate}::text, ''))
    order by date desc, name asc
    limit ${request.limit + 1}
  `
}

export function buildPstoWorkflowRowsWhere(input: PstoWorkflowRowsRequest) {
  const request = normalizePstoWorkflowRowsRequest(input)
  const reportWhere = buildReportKindWhere('heatTreatment')
  const searchWhere = request.search ? buildPstoWorkflowSearchWhere(request.search) : undefined
  if (request.rowIds) {
    return and(reportWhere, buildNumberArrayMatch(weldJoints.id, request.rowIds), searchWhere) ?? sql`false`
  }
  const requestIdentityWhere = request.scope === 'requestRegistry' && request.requestName
    ? and(
        sql`btrim(coalesce(${weldJoints.pstoRequest}::text, '')) = ${request.requestName}`,
        sql`btrim(coalesce(${weldJoints.pstoRequestDate}::text, '')) = ${request.requestDate ?? ''}`,
      )
    : undefined
  const candidateRequestIdentityWhere = request.requestName
    ? request.scope === 'resultCandidates'
      ? buildCurrentPstoCycleDocumentIdentityWhere(
          weldJoints.pstoRequest,
          weldJoints.pstoRequestDate,
          CURRENT_REPEAT_CYCLE.pstoRequest,
          CURRENT_REPEAT_CYCLE.pstoRequestDate,
          request.requestName,
          request.requestDate ?? '',
        )
      : request.scope === 'tvmtResultCandidates'
        ? buildCurrentPstoCycleDocumentIdentityWhere(
            weldJoints.tvmtRequest,
            weldJoints.tvmtRequestDate,
            CURRENT_REPEAT_CYCLE.tvmtRequest,
            CURRENT_REPEAT_CYCLE.tvmtRequestDate,
            request.requestName,
            request.requestDate ?? '',
          )
        : undefined
    : undefined
  const filteredWhere = and(
    buildPstoScopeWhere(request.scope),
    requestIdentityWhere,
    candidateRequestIdentityWhere,
    searchWhere,
  ) ?? sql`false`
  const includedRowsWhere = request.includeRowIds?.length
    ? buildNumberArrayMatch(weldJoints.id, request.includeRowIds)
    : undefined
  return and(
    reportWhere,
    includedRowsWhere ? or(filteredWhere, includedRowsWhere) : filteredWhere,
  ) ?? sql`false`
}

function buildCurrentPstoCycleDocumentIdentityWhere(
  primaryName: SQLWrapper,
  primaryDate: SQLWrapper,
  repeatName: SQLWrapper,
  repeatDate: SQLWrapper,
  requestName: string,
  requestDate: string,
) {
  return buildCurrentPstoCycleWhere(
    and(
      sql`btrim(coalesce(${primaryName}::text, '')) = ${requestName}`,
      sql`btrim(coalesce(${primaryDate}::text, '')) = ${requestDate}`,
    ) ?? sql`false`,
    and(
      sql`btrim(coalesce(${repeatName}::text, '')) = ${requestName}`,
      sql`btrim(coalesce(${repeatDate}::text, '')) = ${requestDate}`,
    ) ?? sql`false`,
  )
}

function buildPstoWorkflowSearchWhere(search: string) {
  const pattern = `%${search.toLocaleLowerCase('ru-RU')}%`
  return sql`lower(concat_ws(
    ' ',
    ${weldJoints.projectTitle},
    ${weldJoints.subtitleCode},
    ${weldJoints.line},
    ${weldJoints.spool},
    ${weldJoints.joint},
    ${weldJoints.pstoRequest},
    ${weldJoints.pstoRequestDate},
    ${weldJoints.pstoResult},
    ${weldJoints.pstoDate},
    ${weldJoints.heatTreatmentDiagram},
    ${weldJoints.tvmtRequest},
    ${weldJoints.tvmtRequestDate},
    ${weldJoints.tvmtResult},
    ${weldJoints.tvmtConclusionDate},
    ${weldJoints.tvmtConclusion}
  )) like ${pattern}`
}

export function filterPstoWorkflowRows(
  rows: WeldRow[],
  scope: PstoWorkflowRowsRequest['scope'],
  includeRowIds: readonly number[] = [],
) {
  const includedIds = new Set(includeRowIds)
  const keepIncluded = (row: WeldRow) => includedIds.has(row.id)
  if (scope === 'requestCandidates') return rows.filter((row) => keepIncluded(row) || canCreatePstoWorkflowRequest(row))
  if (scope === 'requestRegistry') {
    return rows.filter((row) => keepIncluded(row) || hasText(row.pstoRequest))
  }
  if (scope === 'resultCandidates') return rows.filter((row) => keepIncluded(row) || canAddPstoWorkflowResult(row))
  if (scope === 'resultRegistry') return rows.filter((row) => keepIncluded(row) || hasPstoResultData(row))
  if (scope === 'tvmtRequestCandidates') return rows.filter((row) => keepIncluded(row) || canCreateTvmtRequest(row))
  if (scope === 'tvmtResultCandidates') return rows.filter((row) => keepIncluded(row) || canAddTvmtResult(row))
  return rows
}

function buildPstoScopeWhere(scope: PstoWorkflowRowsRequest['scope']): SQL {
  const activePsto = buildNullableControlEnabledWhere(
    weldJoints.pstoRequired,
    ENABLED_CONTROL_REPORT_VALUES,
  )
  const noRejectedPreControls = buildNoRejectedPreHeatTreatmentControlsWhere()

  if (scope === 'requestCandidates') {
    const primaryRequestAvailable = and(
      activePsto,
      emptyText(weldJoints.pstoRequest),
      buildPrimaryPstoPrerequisitesReadyWhere(),
    )
    const repeatRequestAvailable = and(
      activePsto,
      buildCurrentPstoCycleWhere(
        and(
          hasTextWhere(weldJoints.pstoRequest),
          completedPstoResult(weldJoints.pstoResult),
          hasTextWhere(weldJoints.tvmtRequest),
          failedTvmtResult(weldJoints.tvmtResult),
        ) ?? sql`false`,
        and(
          hasTextWhere(CURRENT_REPEAT_CYCLE.pstoRequest),
          completedPstoResult(CURRENT_REPEAT_CYCLE.pstoResult),
          hasTextWhere(CURRENT_REPEAT_CYCLE.tvmtRequest),
          failedTvmtResult(CURRENT_REPEAT_CYCLE.tvmtResult),
        ) ?? sql`false`,
      ),
    )
    return and(
      noRejectedPreControls,
      or(primaryRequestAvailable, repeatRequestAvailable),
    ) ?? sql`false`
  }
  if (scope === 'requestRegistry') return hasTextWhere(weldJoints.pstoRequest)
  if (scope === 'resultCandidates') {
    return and(
      noRejectedPreControls,
      buildPstoWorkflowActiveWhere(activePsto),
      buildCurrentPstoCycleWhere(
        and(
          hasTextWhere(weldJoints.pstoRequest),
          not(completedPstoResult(weldJoints.pstoResult)),
        ) ?? sql`false`,
        and(
          hasTextWhere(CURRENT_REPEAT_CYCLE.pstoRequest),
          not(completedPstoResult(CURRENT_REPEAT_CYCLE.pstoResult)),
        ) ?? sql`false`,
      ),
    ) ?? sql`false`
  }
  if (scope === 'resultRegistry') {
    return or(
      completedPstoResult(weldJoints.pstoResult),
      hasTextWhere(weldJoints.pstoDate),
      hasTextWhere(weldJoints.heatTreatmentDiagram),
    ) ?? sql`false`
  }
  if (scope === 'tvmtRequestCandidates') {
    return and(
      noRejectedPreControls,
      buildPstoWorkflowActiveWhere(activePsto),
      buildCurrentPstoCycleWhere(
        and(
          hasTextWhere(weldJoints.pstoRequest),
          completedPstoResult(weldJoints.pstoResult),
          emptyText(weldJoints.tvmtRequest),
        ) ?? sql`false`,
        and(
          hasTextWhere(CURRENT_REPEAT_CYCLE.pstoRequest),
          completedPstoResult(CURRENT_REPEAT_CYCLE.pstoResult),
          emptyText(CURRENT_REPEAT_CYCLE.tvmtRequest),
        ) ?? sql`false`,
      ),
    ) ?? sql`false`
  }
  if (scope === 'tvmtResultCandidates') {
    return and(
      noRejectedPreControls,
      buildPstoWorkflowActiveWhere(activePsto),
      buildCurrentPstoCycleWhere(
        and(
          hasTextWhere(weldJoints.pstoRequest),
          completedPstoResult(weldJoints.pstoResult),
          hasTextWhere(weldJoints.tvmtRequest),
          not(finalTvmtResult(weldJoints.tvmtResult)),
        ) ?? sql`false`,
        and(
          hasTextWhere(CURRENT_REPEAT_CYCLE.pstoRequest),
          completedPstoResult(CURRENT_REPEAT_CYCLE.pstoResult),
          hasTextWhere(CURRENT_REPEAT_CYCLE.tvmtRequest),
          not(finalTvmtResult(CURRENT_REPEAT_CYCLE.tvmtResult)),
        ) ?? sql`false`,
      ),
    ) ?? sql`false`
  }
  return sql`true`
}

function buildPstoWorkflowActiveWhere(activePsto: SQL) {
  return or(activePsto, buildPstoExecutionHistoryWhere()) ?? sql`false`
}

function buildPstoExecutionHistoryWhere() {
  const primaryHistory = or(
    completedPstoResult(weldJoints.pstoResult),
    hasTextWhere(weldJoints.pstoDate),
    hasTextWhere(weldJoints.heatTreatmentDiagram),
    hasTextWhere(weldJoints.tvmtRequest),
    hasTextWhere(weldJoints.tvmtRequestDate),
    finalTvmtResult(weldJoints.tvmtResult),
    hasTextWhere(weldJoints.tvmtConclusionDate),
    hasTextWhere(weldJoints.tvmtConclusion),
  ) ?? sql`false`
  const repeatHistory = repeatExists(or(
    completedPstoResult(pstoRepeatCycles.pstoResult),
    hasTextWhere(pstoRepeatCycles.pstoDate),
    hasTextWhere(pstoRepeatCycles.heatTreatmentDiagram),
    hasTextWhere(pstoRepeatCycles.tvmtRequest),
    hasTextWhere(pstoRepeatCycles.tvmtRequestDate),
    finalTvmtResult(pstoRepeatCycles.tvmtResult),
    hasTextWhere(pstoRepeatCycles.tvmtConclusionDate),
    hasTextWhere(pstoRepeatCycles.tvmtConclusion),
  ) ?? sql`false`)
  return or(primaryHistory, repeatHistory) ?? sql`false`
}

function buildCurrentPstoCycleWhere(primaryCondition: SQL, repeatCondition: SQL) {
  return or(
    and(not(repeatExists(sql`true`)), primaryCondition),
    exists(
      SQL_QUERY_BUILDER
        .select({ value: sql`1` })
        .from(CURRENT_REPEAT_CYCLE)
        .where(and(
          eq(CURRENT_REPEAT_CYCLE.weldJointId, weldJoints.id),
          repeatCondition,
          notExists(
            SQL_QUERY_BUILDER
              .select({ value: sql`1` })
              .from(NEWER_REPEAT_CYCLE)
              .where(and(
                eq(NEWER_REPEAT_CYCLE.weldJointId, CURRENT_REPEAT_CYCLE.weldJointId),
                gt(NEWER_REPEAT_CYCLE.sequence, CURRENT_REPEAT_CYCLE.sequence),
              )),
          ),
        )),
    ),
  ) ?? sql`false`
}

function buildNoRejectedPreHeatTreatmentControlsWhere() {
  const rejectedEnabledMethod = or(...PRE_HEAT_TREATMENT_LNK_METHODS.map((method) => and(
    eq(preHeatTreatmentControls.method, method.code),
    buildNullableControlEnabledWhere(
      weldJoints[method.enabledKey],
      ENABLED_CONTROL_REPORT_VALUES,
    ),
  ) ?? sql`false`)) ?? sql`false`
  return or(
    eq(weldJoints.preHeatTreatmentLnkExempt, true),
    notExists(
      SQL_QUERY_BUILDER
        .select({ value: sql`1` })
        .from(preHeatTreatmentControls)
        .where(and(
          eq(preHeatTreatmentControls.weldJointId, weldJoints.id),
          rejectedEnabledMethod,
          sql`lower(btrim(coalesce(${preHeatTreatmentControls.result}::text, ''))) in ('ремонт', 'вырез')`,
        )),
    ),
  ) ?? sql`false`
}

function buildPrimaryPstoPrerequisitesReadyWhere() {
  const requiredMethodsReady = and(...PRE_HEAT_TREATMENT_LNK_METHODS.map((method) => or(
    not(buildNullableControlEnabledWhere(
      weldJoints[method.enabledKey],
      ENABLED_CONTROL_REPORT_VALUES,
    )),
    exists(
      SQL_QUERY_BUILDER
        .select({ value: sql`1` })
        .from(preHeatTreatmentControls)
        .where(and(
          eq(preHeatTreatmentControls.weldJointId, weldJoints.id),
          eq(preHeatTreatmentControls.method, method.code),
          hasTextWhere(preHeatTreatmentControls.requestName),
          sql`lower(btrim(coalesce(${preHeatTreatmentControls.result}::text, ''))) = 'годен'`,
        )),
    ),
  ) ?? sql`false`)) ?? sql`true`
  return or(
    eq(weldJoints.preHeatTreatmentLnkExempt, true),
    requiredMethodsReady,
  ) ?? sql`false`
}

function repeatExists(condition: SQL) {
  return exists(
    SQL_QUERY_BUILDER
      .select({ value: sql`1` })
      .from(pstoRepeatCycles)
      .where(and(
        eq(pstoRepeatCycles.weldJointId, weldJoints.id),
        condition,
      )),
  )
}

function countFiltered(condition: SQL) {
  return sql<number>`count(*) filter (where ${condition})::integer`
}

function hasText(value: unknown) {
  return String(value ?? '').trim().length > 0
}

function hasTextWhere(column: SQLWrapper) {
  return sql`nullif(btrim(coalesce(${column}::text, '')), '') is not null`
}

function emptyText(column: SQLWrapper) {
  return sql`btrim(coalesce(${column}::text, '')) = ''`
}

function completedPstoResult(column: SQLWrapper) {
  return sql`lower(btrim(coalesce(${column}::text, ''))) in ('проведено', 'проведено (отменен)', 'да')`
}

function finalTvmtResult(column: SQLWrapper) {
  return sql`lower(btrim(coalesce(${column}::text, ''))) in ('годен', 'да', 'не годен', 'негоден', 'ремонт', 'вырез')`
}

function failedTvmtResult(column: SQLWrapper) {
  return sql`lower(btrim(coalesce(${column}::text, ''))) in ('не годен', 'негоден', 'ремонт', 'вырез')`
}
