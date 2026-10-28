import { createHash } from 'node:crypto'
import { getReportOutputBuilder } from '@/lib/report-output-definition'
import { REPORT_PREVIEW_ROW_LIMIT } from '@/lib/report-preview-limit'
import type { TabularReportData } from '@/lib/tabular-report'
import type { PrintableReport } from '@/lib/printable-report'
import { prepareJournalPageRows } from '@/lib/use-report-rows'
import { splitReportQuickSearch } from '@/lib/report-quick-search'
import type { ReportOutputRequest, ReportOutputSnapshot } from './weld-contracts'
import { buildCalculatedReportValueSql } from './report-calculated-values-sql'
import { buildCalculatedFilterWhere, reportTextSql } from './report-filter-text-sql'
// This module is intentionally domain-scoped. Keep cross-domain rules in weld-server-shared.

import { requireDb } from '@/db'
import { attachJournalGroupContext } from './journal-group-context'
import { getReportTaskPublicationCacheIdentity } from './report-task-publication-cache-key'
import { getJournalDerivedFilters, getWeldColumnFilterOptionSourceFilters, buildJournalCalculatedWhere } from './journal-filter-source'
import { buildPstoCurrentReportValueSql, PSTO_CURRENT_SQL_FIELD_KEYS } from './psto-report-current-values'
export { getWeldColumnFilterOptionSourceFilters } from './journal-filter-source'
import { buildNormalizedLnkResultText, buildOwnLnkBackfillWhere } from './lnk-system-order-sql'
import { loadProgramRuleContext } from './line-program-rule-context'
import { loadProgramSystemIndexSettings } from './line-program'
import { parseRepeatedJointName } from '@/lib/joint-chain'
import { buildProgramRepairRequirements } from '@/lib/line-program-repair-requirements'
import {
appSettings,
dispatcherAcceptedWarnings,
dispatcherBackgroundRowTasks,
dispatcherRowTasks,
dispatcherTaskIndexState,
duplicateControls,
generatedDocuments,
generatedDocumentWeldJoints,
preHeatTreatmentControls,
pstoRepeatCycles,
weldJoints,
type DuplicateControl,
type WeldJoint
} from '@/db/schema'
import {
withControlBasisSummary
} from '@/lib/control-assignment-basis'
import {
CONTROL_ASSIGNMENT_FIELD_KEYS,
CONTROL_ENABLED_NORMALIZED_STORAGE_VALUES,
normalizeControlAvailabilityFilterValue
} from '@/lib/control-availability-values'
import { buildDerivedCalculationCacheKey } from '@/lib/derived-calculation-cache-key'
import { buildNoRejectedPreHeatTreatmentWhere, buildPreHeatTreatmentEnabledWhere, buildPstoExecutionHistoryWhere, buildPstoDocumentHistoryWhere, buildRelevantPstoRepeatWhere } from '@/server/pre-heat-treatment-policy'
export { buildPstoExecutionHistoryWhere } from '@/server/pre-heat-treatment-policy'
import {
buildMergedDispatcherTaskCodes,
DISPATCHER_TASK_FILTER_KEY,
DISPATCHER_TASKS_FIELD_KEY,
parseDispatcherTaskServerFilter,
} from '@/lib/dispatcher-task-row-codes'
import type { JointChainContinuation, WeldRow } from '@/lib/dispatcher-types'
import { parseDispatcherTaskIndexPayload } from '@/lib/dispatcher-task-index-payload'
import type { DuplicateControlRecord } from '@/lib/duplicate-control-types'
import {
isPreHeatTreatmentLnkMethodCode,
PRE_HEAT_TREATMENT_LNK_METHODS,
} from '@/lib/lnk-control-stage'
import {
DEFAULT_OTHER_SETTINGS
} from '@/lib/other-settings'
import { PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'
import { getJointChainRows } from '@/lib/repeated-joint-row-utils'
import {
  EARLY_COIL_DECISION_KIND,
  getEarlyCoilDecisionKey,
  getEarlyCoilDecisionSourceRowIds,
} from '@/lib/early-coil-decision'
import { evaluateEarlyCoilCandidate } from '@/lib/early-coil-candidate'
import { buildJointCoilTransitions } from '@/lib/joint-chain-transitions'
import {
ALL_LNK_FIELD_METHODS,
HEAT_TREATMENT_EDITABLE_FIELD_KEYS,
HEAT_TREATMENT_HIDDEN_FIELD_KEYS,
LNK_HIDDEN_FIELD_KEYS,
LNK_METHODS,
LNK_REPORT_FIELD_KEYS,
PSTO_SECTION_FIELD_KEYS,
} from '@/lib/report-config'
import {
isHiddenReportFilterKey,
JOINT_CHAIN_FILTER_KEY,
parseJointChainFilter,
parsePercentageLineStampFilter,
parseRowIdListFilter,
PERCENTAGE_LINE_STAMP_FILTER_KEY,
ROW_ID_LIST_FILTER_KEY
} from '@/lib/report-hidden-filters'
import { buildHeatTreatmentReportRows,buildLnkReportRows } from '@/lib/report-row-utils'
import { hasWeldDate } from '@/lib/report-value-utils'
import {
DEFAULT_SYSTEM_INDEX_SETTINGS,
normalizeSystemIndexSettings,
} from '@/lib/system-index-settings'
import { isSystemWdiMode } from '@/lib/wdi'
import { parseWeldColumnChoiceFilter } from '@/lib/weld-column-choice-filter'
import {
buildFinalStatusRowsContext,
FIELD_BY_KEY,
migrateLegacyWeldFieldKey,
migrateLegacyWeldFieldRecordKeys,
type WeldFieldKey,
type WeldInput
} from '@/lib/weld-fields'
import {
canSuggestWeldFormField,
type WeldFormSuggestion,
} from '@/lib/weld-form-suggestions'
import {
buildNormalizedControlAvailabilityWhere,
buildNullableControlEnabledWhere
} from '@/server/control-availability-sql'
import {
getOrComputeDerivedCalculation,
} from '@/server/derived-calculation-cache'
import { buildAcceptedWdiTotalQuery } from '@/server/wdi-aggregate-sql'
import {
buildWeldFormSuggestionsQuery,
normalizeWeldFormSuggestionRows,
} from '@/server/weld-form-suggestions-sql'
import {
ensureDispatcherTaskIndexFresh,
isDispatcherTaskIndexFresh,
readDispatcherTaskIndexState,
} from '@/server/dispatcher-task-index'
import {
applyGeneratedDocumentFields,
attachGeneratedDocumentFields,
loadGeneratedDocumentAssignments,
} from '@/server/generated-document-row-fields'
import {
attachHeatTreatmentControlRelations,
attachPreHeatTreatmentControlRelations,
attachPstoRepeatCycleRelations,
} from '@/server/heat-treatment-control-relations'
import { assertSecurityScope } from '@/server/security-functions'
import {
WELD_PAGE_ALL_SIZE,
WELD_PAGE_SIZE_OPTIONS,
WELD_SNAPSHOT_BATCH_SIZE,
type DocumentGenerationDataRequest,
type DocumentGenerationDataResult,
type WeldColumnFilterOption,
type WeldColumnFilterOptionsRequest,
type WeldDataUsageSummary,
type WeldFilters,
type WeldFormSuggestionsRequest,
type WeldJointChainResult,
type WeldPageRequest,
type WeldPageResult,
type WeldReportSummaryRequest,
type WeldReportSummaryResult,
type WeldPageSize,
type WeldReportContextKind,
type WeldReportKind,
type WeldSort,
type WeldRowsByIdsRequest,
type WeldSnapshotPageRequest
} from '@/server/weld-contracts'
import { and,asc,count,countDistinct,desc,eq,exists,gt,gte,inArray,lte,notExists,or,sql,type SQL,type SQLWrapper } from 'drizzle-orm'
import { QueryBuilder } from 'drizzle-orm/pg-core'

import {
addBaseFilterClauses,
applyCurrentSystemWdi,
buildColumnChoiceWhere,
buildColumnTextEqualsWhere,
buildControlAvailabilityColumnWhere,
buildDispatcherTaskWhere,
buildFinalStatusColumnWhere,
buildGeneratedDocumentColumnWhere,
buildGeneratedDocumentMissingValue,
buildJointChainWhere,
buildPercentageLineStampWhere,
buildRowIdListWhere,
buildWhere,
GENERATED_DOCUMENT_FIELD_TYPES,
getColumnFilterOptionFilters,
getWeldColumn,
hasDispatcherTaskServerFilter,
loadServerOtherSettings,
normalizedTextEquals,
WELD_EFFECTIVE_OFFICIALITY,
WELD_TABLE_RETURNING,
WELD_TABLE_SELECT,
WELDING_JOURNAL_ORDER_BY,
} from '@/server/weld-server-shared'

const SQL_QUERY_BUILDER = new QueryBuilder()
import {
  buildNumberArrayMatch,
  buildTextArrayMatch,
  compactWeldRowsForTransport,
  type DuplicateControlCarrier,
} from '@/server/weld-request-utils'

export type WeldDataUsageRow = {
  joint?: unknown
  weldingMethod?: unknown
  connectionType?: unknown
  materialGroup?: unknown
  testTypes?: unknown
}

export const ENABLED_CONTROL_REPORT_VALUES = CONTROL_ENABLED_NORMALIZED_STORAGE_VALUES

export const CONTROL_REPORT_VALUES = [...ENABLED_CONTROL_REPORT_VALUES, 'отменен'] as const

export const LNK_REPORT_CONTEXT_REQUIRED_FIELD_KEYS = new Set<WeldFieldKey>([
  ...LNK_REPORT_FIELD_KEYS,
  ...PSTO_SECTION_FIELD_KEYS,
  'rkExposureConfirmedDiameter',
])

export const HEAT_TREATMENT_CONTEXT_REQUIRED_FIELD_KEYS = new Set<WeldFieldKey>([
  ...HEAT_TREATMENT_EDITABLE_FIELD_KEYS,
  ...ALL_LNK_FIELD_METHODS.flatMap((method) => [
    method.enabledKey,
    method.requestKey,
    method.requestDateKey,
    method.resultKey,
    method.conclusionDateKey,
    method.conclusionKey,
  ]),
])

export const REPORT_SOURCE_COLUMN_FILTER_KEYS = new Set<WeldFieldKey>([
  ...Object.keys(GENERATED_DOCUMENT_FIELD_TYPES) as WeldFieldKey[],
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
  'officiality',
  'finalStatus',
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
  'elementLength1',
  'elementLength2',
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
  'vikDefectDescription',
  'uzkDefectDescription',
  'pvkDefectDescription',
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
  'weldingUpdatedAt',
  'pstoCreatedAt',
  'pstoUpdatedAt',
  'lnkCreatedAt',
  'lnkUpdatedAt',
])

export async function listWeldJointSnapshotPage({
  data: input,
}: {
  data?: WeldSnapshotPageRequest
}) {
  const data = normalizeWeldSnapshotPageRequest(input)
  await assertSecurityScope('entry')
  const db = requireDb()
  const rows = await db
    .select(WELD_TABLE_SELECT)
    .from(weldJoints)
    .where(data.afterId > 0 ? gt(weldJoints.id, data.afterId) : undefined)
    .orderBy(asc(weldJoints.id))
    .limit(data.batchSize)
  const lastId = rows.length > 0 ? Number(rows[rows.length - 1].id) : data.afterId

  return {
    rows: compactWeldRowsForTransport(await attachHeatTreatmentControlRelations(rows)),
    nextAfterId: rows.length === data.batchSize ? lastId : null,
    hasMore: rows.length === data.batchSize,
  }
}

export async function listWeldReportContextRows({
  data: input,
}: {
  data: { report: WeldReportContextKind }
}): Promise<WeldRow[]> {
  const data = {
    report: input?.report === 'heatTreatment' ? 'heatTreatment' : 'lnk',
  } as const
  await assertSecurityScope('entry')
  await assertReportOutputWithinLimit(buildReportKindWhere(data.report))
  const rows = await requireDb()
    .select(getReportContextSelect(data.report))
    .from(weldJoints)
    .where(buildReportKindWhere(data.report))
    .orderBy(...getReportOrderBy(data.report))
  const reportRows = applyCurrentSystemWdi(
    buildServerReportRows(rows as unknown as WeldJoint[], data.report),
    await loadServerOtherSettings(),
  )
  return compactWeldRowsForTransport(
    await attachHeatTreatmentControlRelations(await attachDuplicateControlsToPage(reportRows)),
  )
}

export async function listWeldFinalStatusContextKeys(): Promise<string[]> {
  await assertSecurityScope('entry')
  const context = await loadCurrentFinalStatusRowsContext()
  return [...context.rejectedUnofficialSameNameRepairKeys]
}

export async function listWeldFormSuggestions({
  data: input,
}: {
  data: WeldFormSuggestionsRequest
}): Promise<WeldFormSuggestion[]> {
  const data = {
    fieldKey: input?.fieldKey,
    draft: input?.draft ?? {},
  }
  await assertSecurityScope('entry')
  if (!FIELD_BY_KEY.has(data.fieldKey) || !canSuggestWeldFormField(data.fieldKey)) return []
  const query = buildWeldFormSuggestionsQuery({
    fieldKey: data.fieldKey,
    draft: data.draft,
  })
  if (!query) return []
  const result = await requireDb().execute<{
    value: string
    context: string
    count: number | string
    score: number | string
  }>(query)
  return normalizeWeldFormSuggestionRows(result.rows)
}

export async function listWeldJointChain({
  data,
}: {
  data: { id: number }
}): Promise<WeldJointChainResult> {
  await assertSecurityScope('entry')
  const db = requireDb()
  const [record] = await db
    .select(WELD_TABLE_RETURNING)
    .from(weldJoints)
    .where(eq(weldJoints.id, data.id))
    .limit(1)
  if (!record) return { record: null, rows: [], transitions: [], earlyCoilCandidates: [] }

  const candidates = await db
    .select(WELD_TABLE_RETURNING)
    .from(weldJoints)
    .where(
      and(
        normalizedTextEquals(weldJoints.projectTitle, record.projectTitle),
        normalizedTextEquals(weldJoints.subtitleCode, record.subtitleCode),
        normalizedTextEquals(weldJoints.line, record.line),
      ),
    )
  const otherSettings = await loadServerOtherSettings()
  const [weldRecord] = applyCurrentSystemWdi([record as unknown as WeldRow], otherSettings)
  const weldCandidates = applyCurrentSystemWdi(candidates as unknown as WeldRow[], otherSettings)
  const [systemIndexRow] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, PROJECT_SETTING_KEYS.systemIndex))
    .limit(1)
  const systemIndexSettings = normalizeSystemIndexSettings(
    parseStoredJson(systemIndexRow?.value) ?? DEFAULT_SYSTEM_INDEX_SETTINGS,
  )

  const chainRows = getJointChainRows(weldCandidates, weldRecord, systemIndexSettings)
  const hydratedRows = await attachReportPageMetadata(chainRows)
  const earlyCoilDecisionSourceRowIds = new Set(
    hydratedRows
      .filter((row) => row.earlyCoilDecisionAccepted)
      .map((row) => row.id),
  )
  const documentLinks = await db
    .select({ weldJointId: generatedDocumentWeldJoints.weldJointId })
    .from(generatedDocumentWeldJoints)
    .where(buildNumberArrayMatch(
      generatedDocumentWeldJoints.weldJointId,
      hydratedRows.map((row) => row.id),
    ))
  const documentedRowIds = new Set(documentLinks.map((link) => link.weldJointId))
  const typedRows = hydratedRows as WeldRow[]
  const transitions = buildJointCoilTransitions(typedRows, {
    earlyCoilDecisionSourceRowIds,
    systemIndexSettings,
  })
  const earlyCoilCandidates = typedRows.flatMap((row) => {
    const evaluation = evaluateEarlyCoilCandidate(typedRows, row, {
      documentedRowIds,
      earlyCoilDecisionSourceRowIds,
      systemIndexSettings,
    })
    return evaluation.candidate
      ? [{
          replacementJoint: String(evaluation.candidate.replacementRow?.joint ?? '').trim() || null,
          replacementRowId: evaluation.candidate.replacementRow?.id ?? null,
          sourceJoint: evaluation.candidate.sourceJoint,
          sourceRowId: evaluation.candidate.sourceRow.id,
          targetJoints: evaluation.candidate.targetJoints,
        }]
      : []
  })

  return {
    record: hydratedRows.find((row) => row.id === weldRecord.id) ?? weldRecord,
    rows: typedRows,
    transitions,
    earlyCoilCandidates,
  }
}

export async function getWeldJointById({
  data: input,
}: {
  data: { id: number }
}): Promise<WeldRow | null> {
  const data = { id: Math.max(0, Math.floor(Number(input?.id) || 0)) }
  await assertSecurityScope('entry')
  if (!data.id) return null
  const db = requireDb()
  const [record] = await db
    .select(WELD_TABLE_RETURNING)
    .from(weldJoints)
    .where(eq(weldJoints.id, data.id))
    .limit(1)
  if (!record) return null
  const [recordWithDuplicateControls] = await attachGeneratedDocumentFields(
    await attachHeatTreatmentControlRelations(
      await attachDuplicateControlsToPage(
        applyCurrentSystemWdi([record], await loadServerOtherSettings()),
      ),
    ),
  )
  const result = recordWithDuplicateControls as unknown as WeldRow
  // Only an explicitly opened repair card needs its full ancestor context. Report
  // pages do not load the same line once per row or query on every field change.
  const settings = result.programChainState ? undefined : await loadProgramSystemIndexSettings(db)
  if (result.programChainState?.kind === 'repair' || !result.programChainState && parseRepeatedJointName(String(result.joint ?? ''), settings).segments.length) {
    const context = await loadProgramRuleContext(db, [result], result.preHeatTreatmentLnkEnabled !== false)
    result.programRepairRequirements = buildProgramRepairRequirements(context.rows, context.approved, settings).get(result.id) ?? []
  }
  return result
}

export async function listWeldingJournalPage({
  data: input,
}: {
  data?: WeldPageRequest
}): Promise<WeldPageResult> {
  const data = normalizeWeldPageRequest(input)
  await assertSecurityScope('entry')
  return listReportPage('weldingJournal', data)
}

export async function listLnkReportPage({
  data: input,
}: {
  data?: WeldPageRequest
}): Promise<WeldPageResult> {
  const data = normalizeWeldPageRequest(input)
  await assertSecurityScope('entry')
  return listReportPage('lnk', data)
}

export async function listHeatTreatmentReportPage({
  data: input,
}: {
  data?: WeldPageRequest
}): Promise<WeldPageResult> {
  const data = normalizeWeldPageRequest(input)
  await assertSecurityScope('entry')
  return listReportPage('heatTreatment', data)
}

export async function listWeldColumnFilterOptions({
  data: input,
}: {
  data?: WeldColumnFilterOptionsRequest
}): Promise<WeldColumnFilterOption[]> {
  const data = normalizeWeldColumnFilterOptionsRequest(input)
  await assertSecurityScope('entry')
  return listColumnFilterOptions(data)
}

export async function getDocumentGenerationData({
  data: input,
}: {
  data?: DocumentGenerationDataRequest
}): Promise<DocumentGenerationDataResult> {
  const data = normalizeDocumentGenerationDataRequest(input)
  await assertSecurityScope('entry')
  const db = requireDb()
  const clauses: SQL[] = [sql`${weldJoints.weldDate} is not null`]
  if (data.periodFrom) clauses.push(gte(weldJoints.weldDate, data.periodFrom))
  if (data.periodTo) clauses.push(lte(weldJoints.weldDate, data.periodTo))
  if (data.projects.length > 0) clauses.push(inArray(weldJoints.projectTitle, data.projects))
  if (data.subtitles.length > 0) clauses.push(inArray(weldJoints.subtitleCode, data.subtitles))
  if (data.lines.length > 0) clauses.push(inArray(weldJoints.line, data.lines))

  // Every relation belongs to the same source snapshot, even during edits or deletion.
  return db.transaction(async (db) => {
    const rows = await db
        .select(WELD_TABLE_SELECT)
        .from(weldJoints)
        .where(and(...clauses))
        .orderBy(asc(weldJoints.weldDate), asc(weldJoints.line), asc(weldJoints.joint))
    const projectRows = await db.selectDistinct({ value: weldJoints.projectTitle }).from(weldJoints)
    const subtitleRows = await db.selectDistinct({ value: weldJoints.subtitleCode }).from(weldJoints)
    const lineRows = await db.selectDistinct({ value: weldJoints.line }).from(weldJoints)

    return {
      rows: compactWeldRowsForTransport(
        await attachGeneratedDocumentFields(
          await attachDuplicateControlsToPage(
            await attachPstoRepeatCycleRelations(
              await attachPreHeatTreatmentControlRelations(
                applyCurrentSystemWdi(rows, await loadServerOtherSettings(db)), db,
              ), db,
            ), db,
          ), db,
        ),
      ),
      scopeOptions: {
        projects: getUniqueSortedTexts(projectRows.map((row) => row.value)),
        subtitles: getUniqueSortedTexts(subtitleRows.map((row) => row.value)),
        lines: getUniqueSortedTexts(lineRows.map((row) => row.value)),
      },
    }
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
}

export async function getWeldDataUsageSummary(): Promise<WeldDataUsageSummary> {
  await assertSecurityScope('entry')
  const db = requireDb()
  const [[{ total, leadingLetterIndexedRowsCount }], weldingTypes, connectionTypes, materialGroups, testTypes] = await Promise.all([
    db
      .select({
        total: count(),
        leadingLetterIndexedRowsCount: sql<number>`count(*) filter (
          where regexp_replace(coalesce(${weldJoints.joint}, ''), '[[:space:]]+', '', 'g') ~* '^[A-Z][A-Z][0-9]'
        )`,
      })
      .from(weldJoints),
    listMultiValueUsage(weldJoints.weldingMethod, '[+,;]+'),
    listSingleValueUsage(weldJoints.connectionType),
    listMultiValueUsage(weldJoints.materialGroup, '[+]'),
    listMultiValueUsage(weldJoints.testTypes, '[,;+]+'),
  ])

  return {
    rowsCount: Number(total) || 0,
    leadingLetterIndexedRowsCount: Number(leadingLetterIndexedRowsCount) || 0,
    weldingTypes,
    connectionTypes,
    materialGroups,
    testTypes,
  }
}

export type UsageAggregateRow = {
  value: string
  count: number | string
}

export async function listSingleValueUsage(column: SQLWrapper): Promise<Array<[string, number]>> {
  const result = await requireDb().execute<UsageAggregateRow>(sql`
    select btrim(coalesce(${column}::text, '')) as "value", count(*)::int as "count"
    from ${weldJoints}
    where btrim(coalesce(${column}::text, '')) <> ''
    group by btrim(coalesce(${column}::text, ''))
  `)
  return sortUsageAggregateRows(result.rows)
}

export async function listMultiValueUsage(
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

export function sortUsageAggregateRows(rows: UsageAggregateRow[]): Array<[string, number]> {
  return rows
    .map((row): [string, number] => [String(row.value ?? '').trim(), Number(row.count) || 0])
    .filter(([value]) => Boolean(value))
    .sort(([left], [right]) => left.localeCompare(right, 'ru', { numeric: true, sensitivity: 'base' }))
}

function assertCurrentDispatcherStatuses(state: Awaited<ReturnType<typeof readDispatcherTaskIndexState>>) {
  // A bounded refresh may return stale after concurrent writes. Waiting for the
  // promise is not proof that status-dependent selection is now safe.
  if (!isDispatcherTaskIndexFresh(state)) {
    throw new Error('Не удалось подтвердить актуальность итоговых статусов: данные менялись во время пересчёта. Повторите загрузку.')
  }
}

async function getReportReadContext(
  data: ReturnType<typeof normalizeWeldPageRequest>,
  waitForDispatcher = false,
) {
  const hasFinalStatusFilter = Boolean(
    String(data.finalStatus ?? '').trim() || String(data.columnFilters.finalStatus ?? '').trim(),
  )
  const [dispatcherState, otherSettings] = await Promise.all([
    hasFinalStatusFilter || waitForDispatcher ? ensureDispatcherTaskIndexFresh() : readDispatcherTaskIndexState(),
    loadServerOtherSettings(),
  ])
  if (hasFinalStatusFilter || waitForDispatcher) assertCurrentDispatcherStatuses(dispatcherState)
  return { dispatcherState, otherSettings }
}

export async function getWeldReportSummary({ data: input }: { data: WeldReportSummaryRequest }): Promise<WeldReportSummaryResult> {
  await assertSecurityScope('entry')
  const report = input?.report
  if (report !== 'weldingJournal' && report !== 'lnk' && report !== 'heatTreatment') {
    throw new Error('Неизвестный вид отчета.')
  }
  // Summary identity never depends on the visible portion or sort order.
  const data = normalizeWeldPageRequest({ ...input, page: 1, pageSize: 100, sort: undefined })
  const needsCurrentStatuses = report === 'weldingJournal' || Boolean(
    String(data.finalStatus ?? '').trim() || String(data.columnFilters.finalStatus ?? '').trim(),
  )
  const assertCurrent = (state: Awaited<ReturnType<typeof readDispatcherTaskIndexState>>) => {
    if (needsCurrentStatuses && !isDispatcherTaskIndexFresh(state)) {
      throw new Error('Данные изменились во время расчёта. Повторите подсчёт итогов; найденные строки остаются доступны.')
    }
  }
  // Even a cache hit must not present yesterday's/still-invalidated status totals.
  if (needsCurrentStatuses) assertCurrent(await ensureDispatcherTaskIndexFresh())
  return getOrComputeDerivedCalculation(
    buildDerivedReportCacheKey('report-summary:v4', report, data, await getReportTaskPublicationCacheIdentity(data.columnFilters)),
    async () => {
      // Read settings only after the cache captures its source revision. A
      // concurrent setting change then prevents publishing this cached result.
      const { dispatcherState, otherSettings } = await getReportReadContext(data)
      assertCurrent(dispatcherState)
      const where = buildReportQueryWhere(report, data, otherSettings)
      const [[row], availableRequestCount, acceptedWdiTotal] = await Promise.all([
        requireDb().select({ total: count() }).from(weldJoints).where(where),
        report === 'lnk' ? countAvailableLnkRequestRows(where) : Promise.resolve(undefined),
        report === 'weldingJournal' ? computeAcceptedWdiTotal(where, otherSettings) : Promise.resolve(undefined),
      ])
      return { total: Number(row?.total) || 0,
        ...(availableRequestCount === undefined ? {} : { availableRequestCount }),
        ...(acceptedWdiTotal === undefined ? {} : { acceptedWdiTotal }),
      }
    },
  )
}

/** Preview and download each own a coherent transaction. The preview keeps a
 * bounded prefix; downloading starts a new snapshot and visits every batch. */
export async function readReportOutputSnapshot(input: ReportOutputRequest): Promise<ReportOutputSnapshot> {
  const build = getReportOutputBuilder(input)
  const report: PrintableReport = build([]).report
  let kept = 0, truncated = false
  const snapshot = await visitReportOutput(input, async content => {
    for (const table of content.report.tables ?? []) {
      const remaining = REPORT_PREVIEW_ROW_LIMIT - kept
      const rows = table.rows.slice(0, remaining)
      if (rows.length) {
        if (!report.tables?.length) report.tables = [{ ...table, rows: [],
          printIdentity: table.printIdentity ? { ...table.printIdentity, rows: [] } : undefined }]
        if (table.printIdentity) report.tables[0].printIdentity!.rows.push(...table.printIdentity.rows.slice(0, rows.length))
        report.tables[0].rows.push(...rows)
        kept += rows.length
      }
      if (table.rows.length > remaining) truncated = true
    }
    return !truncated
  })
  // Current/system reports have exactly one row per source joint. Other modes
  // may expand one joint into several methods; never present source count as file rows.
  const direct = !input.kind || input.kind === 'current' || input.kind === 'system'
  const totalRows = direct ? snapshot.sourceRows : truncated ? undefined : kept
  report.generatedAt = snapshot.generatedAt
  report.meta = [{ label: totalRows === undefined ? 'Строк в предпросмотре' : 'Строк', value: String(totalRows ?? kept) }]
  report.preview = { truncated, sourceRows: snapshot.sourceRows, totalRows, freshExcel: true }
  return { ...snapshot, report, truncated }
}

export async function visitReportOutput(
  input: ReportOutputRequest,
  consume: (content: { report: PrintableReport; exportData: TabularReportData }) => Promise<boolean | void>,
  signal?: AbortSignal,
) {
  await assertSecurityScope('entry')
  const build = getReportOutputBuilder(input)
  const kind = input.kind ?? 'current'
  const report = input.report === 'weldingJournal' && (kind === 'waitingRequest' || kind === 'waitingControl') ? 'lnk' : input.report
  const filters = kind === 'current' ? input.columnFilters ?? {}
    : kind === 'waitingWeld' || kind === 'waitingRepair' ? { finalStatus: kind === 'waitingWeld' ? '=ожидает сварку' : '=ожидает ремонт' } : {}
  const data = normalizeWeldPageRequest({ ...splitReportQuickSearch(filters), sort: kind === 'current' ? input.sort ?? undefined : undefined,
    page: 1, pageSize: WELD_PAGE_ALL_SIZE, includeTotals: false })
  signal?.throwIfAborted()
  assertCurrentDispatcherStatuses(await ensureDispatcherTaskIndexFresh())
  return requireDb().transaction(async db => {
    const [state] = await db.select({ dispatcher: dispatcherTaskIndexState, generatedAt: sql<string>`transaction_timestamp()::text` })
      .from(dispatcherTaskIndexState).where(eq(dispatcherTaskIndexState.id, 1))
    assertCurrentDispatcherStatuses(state?.dispatcher)
    const settings = await loadServerOtherSettings(db)
    const where = buildReportQueryWhere(report, data, settings)
    const [countRow] = await db.select({ total: count() }).from(weldJoints).where(where)
    // A transaction-local cursor preserves order and snapshot across batches,
    // avoiding growing OFFSET scans and retaining all identifiers in JS.
    const selection = db.select({ id: weldJoints.id }).from(weldJoints).where(where)
      .orderBy(...getReportOrderBy(report, data.sort, settings))
    await db.execute(sql`declare report_output_cursor no scroll cursor for ${selection}`)
    try {
      for (;;) {
        signal?.throwIfAborted()
        const ids = (await db.execute<{ id: number }>(sql`fetch forward 1000 from report_output_cursor`)).rows.map(row => row.id)
        if (!ids.length) break
        const facts = await db.select(WELD_TABLE_SELECT).from(weldJoints).where(buildNumberArrayMatch(weldJoints.id, ids))
        const byId = new Map(facts.map(row => [row.id, row]))
        const rows = ids.map(id => byId.get(id)!)
        const hydrated = await attachReportPageMetadata(applyCurrentSystemWdi(rows, settings), { dispatcherState: state.dispatcher, db })
        const prepared = prepareJournalPageRows(buildServerReportRows(hydrated, report, { preserveSourceOrder: true }), report)
        const content = build(compactWeldRowsForTransport(await attachJournalGroupContext(prepared, settings, db)))
        signal?.throwIfAborted()
        if (await consume(content) === false) break
      }
    } finally { await db.execute(sql`close report_output_cursor`) }
    return { sourceRows: Number(countRow.total), generatedAt: new Date(state.generatedAt).toISOString() }
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
}

export async function listReportPage(report: WeldReportKind, data: ReturnType<typeof normalizeWeldPageRequest>): Promise<WeldPageResult> {
  const db = requireDb()
  const includeTotals = data.includeTotals !== false
  const { dispatcherState, otherSettings } = await getReportReadContext(data, report === 'weldingJournal' && includeTotals)
  const where = buildReportQueryWhere(report, data, otherSettings)
  if (data.pageSize === WELD_PAGE_ALL_SIZE) {
    // Legacy contextual/bulk consumers retain their operation guard. Report
    // preview and complete Excel downloads use the bounded visitor above.
    const source = { ...data, columnFilters: getWeldColumnFilterOptionSourceFilters(data.columnFilters, isSystemWdiMode(otherSettings)) }
    await assertReportOutputWithinLimit(report === 'weldingJournal' ? buildWhere(source)
      : and(buildReportKindWhere(report), buildReportSourceWhere(source, report)))
  }
  // SQL applies all predicates before the page boundary. Direct reads return
  // factual cards; cached page identities are reloaded with version checks.
  const query = db.select(WELD_TABLE_SELECT).from(weldJoints).where(where)
    .orderBy(...getReportOrderBy(report, data.sort, otherSettings))
  const derivedTotals = report === 'weldingJournal'
    ? Object.keys(getJournalDerivedFilters(data.columnFilters, isSystemWdiMode(otherSettings))).length > 0
    : !canPaginateReportSource(data.columnFilters, report) || isSystemWdiMode(otherSettings) && Boolean(data.columnFilters.wdi)
  const shouldCount = includeTotals && (data.page === 1 || derivedTotals) && data.pageSize !== WELD_PAGE_ALL_SIZE
  const fetchExtraRow = !shouldCount && data.pageSize !== WELD_PAGE_ALL_SIZE
  const readDirectPage = () => query.limit((data.pageSize as number) + (fetchExtraRow ? 1 : 0))
    .offset((data.page - 1) * (data.pageSize as number))
  const [[countRow], availableRequestCount, acceptedWdiTotal, fetchedRows] = await Promise.all([
    shouldCount ? db.select({ total: count() }).from(weldJoints).where(where) : Promise.resolve([]),
    includeTotals && data.page === 1 && report === 'lnk' ? countAvailableLnkRequestRows(where) : Promise.resolve(undefined),
    includeTotals && (data.page === 1 || derivedTotals) && report === 'weldingJournal'
      ? getCurrentAcceptedWdiTotal(data) : Promise.resolve(undefined),
    data.pageSize === WELD_PAGE_ALL_SIZE ? query
      : loadReportPageRows(report, data, where, otherSettings, fetchExtraRow, readDirectPage),
  ])
  const rows = fetchExtraRow ? fetchedRows.slice(0, data.pageSize as number) : fetchedRows
  const total = data.pageSize === WELD_PAGE_ALL_SIZE ? rows.length : countRow ? Number(countRow.total) || 0 : undefined
  // Hydrate the selected page before testing report membership: a historical
  // PSTO row may exist only through its repeat cycles, with no primary fields.
  const metadataRows = await attachReportPageMetadata(applyCurrentSystemWdi(rows, otherSettings), { dispatcherState })
  const reportRows = buildServerReportRows(metadataRows, report, { preserveSourceOrder: Boolean(data.sort) })
  return {
    rows: compactWeldRowsForTransport(await attachJournalGroupContext(reportRows, otherSettings)),
    ...(total === undefined ? {} : { total }),
    ...(availableRequestCount === undefined ? {} : { availableRequestCount }),
    ...(acceptedWdiTotal === undefined ? {} : { acceptedWdiTotal }),
    page: data.page, pageSize: data.pageSize,
    hasMore: data.pageSize !== WELD_PAGE_ALL_SIZE && (
      total === undefined ? fetchedRows.length > data.pageSize : data.page * data.pageSize < total
    ),
  }
}

/** Cache only the bounded page identity, never the complete matching set.
 * Settings-dependent selection includes its exact settings in the identity.
 * Facts are reloaded and version-checked; actions never consume cached cards. */
async function loadReportPageRows(
  report: WeldReportKind,
  data: ReturnType<typeof normalizeWeldPageRequest>,
  where: SQL,
  settings: Awaited<ReturnType<typeof loadServerOtherSettings>>,
  fetchExtraRow: boolean,
  directRead: () => PromiseLike<Awaited<ReturnType<typeof loadWeldRowsByIdsInBatches>>>,
) {
  const pageSize = data.pageSize as number
  const limit = pageSize + (fetchExtraRow ? 1 : 0)
  const offset = (data.page - 1) * pageSize
  const systemWdi = isSystemWdiMode(settings)
  const derived = report === 'weldingJournal'
    ? Object.keys(getJournalDerivedFilters(data.columnFilters, systemWdi)).length > 0
    : !canPaginateReportSource(data.columnFilters, report) || systemWdi && Boolean(data.columnFilters.wdi)
  if (!derived) return directRead()
  // The settings were read before the cache captures its revision. Include
  // their fingerprint so a concurrent setting change cannot publish an old
  // predicate under the new setting's key. Hash large tables to keep the
  // indexed cache key bounded; cards use this same captured settings object.
  const settingsIdentity = data.columnFilters.wdi || data.columnFilters.rkExposureScheme || data.sort?.fieldKey === 'wdi'
    ? createHash('sha256').update(JSON.stringify(settings)).digest('hex') : undefined
  const matches = await getOrComputeDerivedCalculation(
    buildDerivedReportCacheKey('report-page-selection:v2', report, data, {
      page: data.page, limit, sort: data.sort ?? null,
      ...(settingsIdentity ? { settingsIdentity } : {}),
      ...await getReportTaskPublicationCacheIdentity(data.columnFilters),
    }),
    () => requireDb().select({ id: weldJoints.id, rowVersion: WELD_TABLE_SELECT.rowVersion })
      .from(weldJoints).where(where).orderBy(...getReportOrderBy(report, data.sort, settings)).limit(limit).offset(offset),
  )
  if (!matches.length) return []
  const rows = await loadWeldRowsByIdsInBatches(requireDb(), matches.map(row => row.id))
  const byId = new Map(rows.map(row => [row.id, row]))
  return matches.map(match => {
    const row = byId.get(match.id)
    if (!row || row.rowVersion !== match.rowVersion) {
      throw new Error('Данные отчёта изменились во время отбора. Повторите загрузку.')
    }
    return row
  })
}

/** Shared selection contract; calculated labels never replace the stored card. */
export function buildReportQueryWhere(
  report: WeldReportKind,
  data: WeldFilters & { columnFilters: Record<string, string> },
  settings: Awaited<ReturnType<typeof loadServerOtherSettings>>,
): SQL {
  if (report === 'weldingJournal') return buildJournalCalculatedWhere(
    buildWhere({ ...data, columnFilters: getWeldColumnFilterOptionSourceFilters(data.columnFilters, isSystemWdiMode(settings)) }),
    getJournalDerivedFilters(data.columnFilters, isSystemWdiMode(settings)), settings,
  ) ?? sql`true`
  const source: Record<string, string> = {}
  const calculated: SQL[] = []
  for (const [key, filter] of Object.entries(data.columnFilters)) {
    if (isHiddenReportFilterKey(key) || isReportSourceColumnFilter(key as WeldFieldKey, report) && !(key === 'wdi' && isSystemWdiMode(settings))) {
      source[key] = filter
    } else {
      const value = buildCalculatedReportValueSql(report, key as WeldFieldKey, settings) ?? getWeldColumn(key as WeldFieldKey) ?? sql`null`
      calculated.push(buildCalculatedFilterWhere(value, filter))
    }
  }
  return and(buildReportKindWhere(report), buildReportSourceWhere({ ...data, columnFilters: source }, report), ...calculated) ?? sql`true`
}

export const MAX_REPORT_OUTPUT_ROWS = 10_000

export async function assertReportOutputWithinLimit(where: SQL | undefined, db: Pick<ReturnType<typeof requireDb>, 'select'> = requireDb()) {
  // OFFSET scans at most the fixed safety threshold and returns one tiny row;
  // do this before hydrating report rows, related controls, or browser output.
  const overflow = await db
    .select({ id: weldJoints.id })
    .from(weldJoints)
    .where(where)
    .limit(1)
    .offset(MAX_REPORT_OUTPUT_ROWS)
  if (overflow.length > 0) {
    throw new Error('Для вывода найдено более 10 000 строк. Сузьте фильтры и откройте «Текущую версию» отчета; большой полный вывод не формируется.')
  }
}

export async function getCurrentAcceptedWdiTotal(data: ReturnType<typeof normalizeWeldPageRequest>) {
  return getOrComputeDerivedCalculation(
    buildDerivedReportCacheKey('welding-journal-accepted-wdi:v4', 'weldingJournal', data,
      await getReportTaskPublicationCacheIdentity(data.columnFilters)),
    async () => {
      const settings = await loadServerOtherSettings()
      return computeAcceptedWdiTotal(buildReportQueryWhere('weldingJournal', data, settings), settings)
    },
  )
}

async function computeAcceptedWdiTotal(
  where: SQL | undefined,
  otherSettings: Awaited<ReturnType<typeof loadServerOtherSettings>>,
) {
  const result = await requireDb().execute<{ total: string | number }>(buildAcceptedWdiTotalQuery(where, otherSettings))
  return Number(result.rows[0]?.total) || 0
}

export async function countAvailableLnkRequestRows(where: SQL) {
  const [{ total }] = await requireDb()
    .select({ total: count() })
    .from(weldJoints)
    .where(and(where, buildAvailableLnkRequestWhere()))
  return Number(total) || 0
}

export function buildAvailableLnkRequestWhere() {
  return buildLnkRequestCandidateWhere()
}

export function buildLnkRequestCandidateWhere() {
  const buildAvailableMethodWhere = (method: (typeof LNK_METHODS)[number]) => {
    const enabledColumn = getWeldColumn(method.enabledKey)
    const requestColumn = getWeldColumn(method.requestKey)
    if (!enabledColumn || !requestColumn) return sql`false`
    return and(
      buildEnabledControlValueWhere(enabledColumn),
      sql`btrim(coalesce(${requestColumn}::text, '')) = ''`,
    ) ?? sql`false`
  }
  const hasAvailableMethod = or(...LNK_METHODS.map(buildAvailableMethodWhere)) ?? sql`false`
  const hasNoRejectedResult = and(
    ...LNK_METHODS.map((method) => {
      const resultColumn = getWeldColumn(method.resultKey)
      return resultColumn
        ? sql`${buildNormalizedLnkResultText(resultColumn)} not in ('ремонт', 'вырез')`
        : sql`true`
    }),
  ) ?? sql`true`
  const hasNoRejectedDuplicate = notExists(
    SQL_QUERY_BUILDER
      .select({ value: sql`1` })
      .from(duplicateControls)
      .where(
        and(
          eq(duplicateControls.weldJointId, weldJoints.id),
          inArray(duplicateControls.result, ['ремонт', 'вырез']),
        ),
      ),
  )
  const hasNoRejectedPreHeatTreatmentControl = buildNoRejectedPreHeatTreatmentWhere()
  return and(
    hasAvailableMethod,
    or(
      and(hasNoRejectedResult, hasNoRejectedDuplicate),
      or(...LNK_METHODS.map(method => and(buildAvailableMethodWhere(method),
        sql`${buildNormalizedLnkResultText(weldJoints[method.resultKey])} not in ('годен', 'да', 'проведено', 'ремонт', 'вырез', 'годен (отменен)', 'проведено (отменен)')`,
        buildOwnLnkBackfillWhere(method)))),
    ),
    hasNoRejectedPreHeatTreatmentControl,
  ) ?? sql`false`
}

export function buildPrimaryLnkStageReadyWhere(methodCode: string) {
  if (!isPreHeatTreatmentLnkMethodCode(methodCode)) return sql`true`

  return buildHeatTreatmentStagedLnkReadyWhere()
}

function buildHeatTreatmentStagedLnkReadyWhere() {
  const pstoRequired = buildNullableControlEnabledWhere(
    weldJoints.pstoRequired,
    ENABLED_CONTROL_REPORT_VALUES,
  )
  const hasExecutionHistory = buildPstoExecutionHistoryWhere()
  const heatTreatmentStagedLnkRequired = or(
    pstoRequired,
    hasExecutionHistory,
  ) ?? sql`false`
  const preHeatTreatmentRequired = and(
    heatTreatmentStagedLnkRequired,
    buildPreHeatTreatmentEnabledWhere(),
  ) ?? sql`false`
  const allPreHeatTreatmentControlsGood = and(
    ...PRE_HEAT_TREATMENT_LNK_METHODS.map((method) => {
      const enabledColumn = getWeldColumn(method.enabledKey)
      if (!enabledColumn) return sql`false`
      const methodEnabled = buildNullableControlEnabledWhere(
        enabledColumn,
        ENABLED_CONTROL_REPORT_VALUES,
      )
      const hasGoodResult = exists(
        SQL_QUERY_BUILDER
          .select({ value: sql`1` })
          .from(preHeatTreatmentControls)
          .where(and(
            eq(preHeatTreatmentControls.weldJointId, weldJoints.id),
            eq(preHeatTreatmentControls.method, method.code),
            sql`lower(btrim(coalesce(${preHeatTreatmentControls.result}, ''))) = 'годен'`,
          )),
      )
      return or(
        sql`not (${methodEnabled})`,
        hasGoodResult,
      ) ?? sql`false`
    }),
  ) ?? sql`false`
  const hasRepeatCycle = exists(
    SQL_QUERY_BUILDER
      .select({ value: sql`1` })
      .from(pstoRepeatCycles)
      .where(and(eq(pstoRepeatCycles.weldJointId, weldJoints.id), buildRelevantPstoRepeatWhere(pstoRepeatCycles))),
  )
  const primaryCycleComplete = sql`
    lower(btrim(coalesce(${weldJoints.pstoResult}, ''))) in ('проведено', 'проведено (отменен)', 'да')
    and (
      lower(btrim(coalesce(${weldJoints.tvmtResult}, ''))) in ('годен', 'да')
      or (
        not (${pstoRequired})
        and lower(btrim(coalesce(${weldJoints.tvmtResult}, ''))) in ('не годен', 'негоден', 'ремонт', 'вырез')
      )
    )
  `
  const latestRepeatCycleComplete = sql<boolean>`coalesce((
    select
      lower(btrim(coalesce(${pstoRepeatCycles.pstoResult}, ''))) in ('проведено', 'проведено (отменен)', 'да')
      and (
        lower(btrim(coalesce(${pstoRepeatCycles.tvmtResult}, ''))) in ('годен', 'да')
        or (
          not (${pstoRequired})
          and lower(btrim(coalesce(${pstoRepeatCycles.tvmtResult}, ''))) in ('не годен', 'негоден', 'ремонт', 'вырез')
        )
      )
    from ${pstoRepeatCycles}
    where ${pstoRepeatCycles.weldJointId} = ${weldJoints.id}
      and ${buildRelevantPstoRepeatWhere(pstoRepeatCycles)}
    order by ${pstoRepeatCycles.sequence} desc
    limit 1
  ), false)`
  const currentCycleComplete = or(
    and(sql`not (${hasRepeatCycle})`, primaryCycleComplete),
    and(hasRepeatCycle, latestRepeatCycleComplete),
  ) ?? sql`false`

  return and(
    buildNoRejectedPreHeatTreatmentWhere(),
    or(
      and(sql`not (${pstoRequired})`, sql`not (${hasExecutionHistory})`),
      and(
        currentCycleComplete,
        or(sql`not (${preHeatTreatmentRequired})`, allPreHeatTreatmentControlsGood),
      ),
    ),
  ) ?? sql`false`
}

export async function attachDuplicateControlsToPage<Row extends DuplicateControlCarrier>(rows: Row[], database?: Pick<ReturnType<typeof requireDb>, 'select'>) {
  if (rows.length === 0) return rows
  const ids = [...new Set(rows.map((row) => Number(row.id)).filter(Number.isFinite))]
  if (ids.length === 0) return rows

  const db = database ?? requireDb()
  const controls = await db
    .select()
    .from(duplicateControls)
    .where(buildNumberArrayMatch(duplicateControls.weldJointId, ids))
    .orderBy(asc(duplicateControls.weldJointId), asc(duplicateControls.id))

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

export async function attachDispatcherTaskCodesToPage<Row extends { id: number }>(
  rows: Row[],
  database?: Pick<ReturnType<typeof requireDb>, 'execute'>,
) {
  if (rows.length === 0) return rows
  const ids = [...new Set(rows.map((row) => Number(row.id)).filter(Number.isFinite))]
  if (ids.length === 0) return rows
  const result = await (database ?? requireDb()).execute<DispatcherTaskCodeRow & { source: 'active' | 'background' }>(sql`
    select ${dispatcherRowTasks.weldJointId} as "rowId", ${dispatcherRowTasks.code} as "code", 'active' as "source"
    from ${dispatcherRowTasks}
    where ${buildNumberArrayMatch(dispatcherRowTasks.weldJointId, ids)}
    union all
    select ${dispatcherBackgroundRowTasks.weldJointId} as "rowId", ${dispatcherBackgroundRowTasks.code} as "code", 'background' as "source"
    from ${dispatcherBackgroundRowTasks}
    where ${buildNumberArrayMatch(dispatcherBackgroundRowTasks.weldJointId, ids)}
  `)
  const taskRows = result.rows
  const activeTaskRows = taskRows.filter((row) => row.source === 'active')
  const backgroundTaskRows = taskRows.filter((row) => row.source === 'background')
  return mergeDispatcherTaskCodesIntoRows(rows, activeTaskRows, backgroundTaskRows)
}

type DispatcherTaskIndexState = Awaited<ReturnType<typeof ensureDispatcherTaskIndexFresh>>

export async function attachReportPageMetadata<Row extends DuplicateControlCarrier>(
  rows: Row[],
  options: {
    dispatcherState?: DispatcherTaskIndexState
    includeJointWorkflowMetadata?: boolean
    db?: Pick<ReturnType<typeof requireDb>, 'select' | 'execute'>
  } = {},
) {
  const includeJointWorkflowMetadata = options.includeJointWorkflowMetadata ?? true
  const dispatcherState = rows.length > 0 && includeJointWorkflowMetadata
    ? options.dispatcherState ?? await readDispatcherTaskIndexState()
    : null
  const [
    rowsWithDuplicateControls,
    generatedDocumentAssignments,
    rowsWithDispatcherTasks,
    rowsWithHeatTreatmentControls,
    rowsWithEarlyCoilDecisions,
  ] = options.db ? [
    // A snapshot transaction has a single pg connection. Keep pooled reads
    // parallel for other callers, but execute snapshot reads sequentially.
    await attachDuplicateControlsToPage(rows, options.db),
    await loadGeneratedDocumentAssignments(rows, options.db),
    await attachDispatcherTaskCodesToPage(rows, options.db),
    await attachHeatTreatmentControlRelations(rows, options.db),
    includeJointWorkflowMetadata ? await attachEarlyCoilDecisionMetadataToPage(rows, options.db) : rows,
  ] as const : await Promise.all([
    attachDuplicateControlsToPage(rows, options.db),
    loadGeneratedDocumentAssignments(rows, options.db),
    attachDispatcherTaskCodesToPage(rows, options.db),
    attachHeatTreatmentControlRelations(rows, options.db),
    includeJointWorkflowMetadata ? attachEarlyCoilDecisionMetadataToPage(rows, options.db) : Promise.resolve(rows),
  ])
  const rowsWithGeneratedDocuments = applyGeneratedDocumentFields(
    rowsWithHeatTreatmentControls,
    generatedDocumentAssignments,
  )
  const rowsWithChainContinuations = mergeJointChainContinuationMetadataIntoRows(
    rows,
    dispatcherState
      ? parseDispatcherTaskIndexPayload(dispatcherState.repeatedTasks).chainContinuations
      : [],
  )
  return rows.map((row, index) => ({
    ...row,
    ...rowsWithDuplicateControls[index],
    ...rowsWithGeneratedDocuments[index],
    ...rowsWithDispatcherTasks[index],
    ...rowsWithHeatTreatmentControls[index],
    ...rowsWithEarlyCoilDecisions[index],
    ...rowsWithChainContinuations[index],
    preHeatTreatmentLnkEnabled: rowsWithHeatTreatmentControls[index]?.preHeatTreatmentLnkEnabled,
  }))
}

export function mergeJointChainContinuationMetadataIntoRows<Row extends { id: number }>(
  rows: Row[],
  continuations: readonly JointChainContinuation[],
): Array<Row & { chainContinuation?: JointChainContinuation }> {
  const continuationByRowId = new Map(
    continuations.map((continuation) => [continuation.sourceRowId, continuation] as const),
  )
  return rows.map((row) => {
    const continuation = continuationByRowId.get(Number(row.id))
    return continuation ? { ...row, chainContinuation: continuation } : { ...row }
  })
}

type EarlyCoilDecisionMetadata = { earlyCoilDecisionAccepted?: true }

export async function attachEarlyCoilDecisionMetadataToPage<Row extends { id: number }>(rows: Row[], database?: Pick<ReturnType<typeof requireDb>, 'select'>) {
  if (rows.length === 0) return rows as Array<Row & EarlyCoilDecisionMetadata>
  const ids = [...new Set(rows.map((row) => Number(row.id)).filter((id) => Number.isInteger(id) && id > 0))]
  if (ids.length === 0) return rows as Array<Row & EarlyCoilDecisionMetadata>
  const warnings = await (database ?? requireDb())
    .select({ key: dispatcherAcceptedWarnings.key })
    .from(dispatcherAcceptedWarnings)
    .where(and(
      eq(dispatcherAcceptedWarnings.kind, EARLY_COIL_DECISION_KIND),
      buildTextArrayMatch(dispatcherAcceptedWarnings.key, ids.map(getEarlyCoilDecisionKey)),
    ))
  return mergeEarlyCoilDecisionMetadataIntoRows(
    rows,
    getEarlyCoilDecisionSourceRowIds(warnings.map((warning) => warning.key)),
  )
}

export function mergeEarlyCoilDecisionMetadataIntoRows<Row extends { id: number }>(
  rows: Row[],
  sourceRowIds: ReadonlySet<number>,
): Array<Row & EarlyCoilDecisionMetadata> {
  return rows.map((row) => sourceRowIds.has(Number(row.id))
    ? { ...row, earlyCoilDecisionAccepted: true }
    : { ...row })
}

export type DispatcherTaskCodeRow = { rowId: number; code: string }

export function mergeDispatcherTaskCodesIntoRows<Row extends { id: number }>(
  rows: Row[],
  activeTaskRows: DispatcherTaskCodeRow[],
  backgroundTaskRows: DispatcherTaskCodeRow[],
) {
  const { activeByRowId, allByRowId } = buildMergedDispatcherTaskCodes(activeTaskRows, backgroundTaskRows)
  return rows.map((row) => ({
    ...row,
    activeDispatcherTasks: activeByRowId.get(row.id) ?? '',
    dispatcherTasks: allByRowId.get(row.id) ?? '',
  }))
}

export function toDuplicateControlRecord(row: DuplicateControl): DuplicateControlRecord {
  return {
    id: row.id,
    version: row.updatedAt?.toISOString?.() ?? '',
    weldJointId: row.weldJointId,
    method: row.method as DuplicateControlRecord['method'],
    result: row.result as DuplicateControlRecord['result'],
    controlDate: row.controlDate ?? '',
    conclusion: row.conclusion ?? '',
    conclusionDate: row.conclusionDate ?? '',
  }
}

export function buildServerReportRows<Row extends WeldInput & { id: number }>(
  sourceRows: Row[],
  report: WeldReportKind,
  orderOptions: { preserveSourceOrder?: boolean } = {},
): WeldRow[] {
  if (report === 'weldingJournal') return sourceRows.map((row) => withControlBasisSummary(row, 'all')) as WeldRow[]
  const weldedRows = sourceRows.filter(hasWeldDate) as WeldRow[]
  if (report === 'heatTreatment') {
    return buildHeatTreatmentReportRows(weldedRows, orderOptions).map((row) => withControlBasisSummary(row, 'psto'))
  }
  return buildLnkReportRows(weldedRows, undefined, orderOptions).map((row) => withControlBasisSummary(row, 'lnk'))
}

export async function loadCurrentFinalStatusRowsContext() {
  const rows = await requireDb()
    .select({
      id: weldJoints.id,
      projectTitle: weldJoints.projectTitle,
      subtitleCode: weldJoints.subtitleCode,
      line: weldJoints.line,
      joint: weldJoints.joint,
      officiality: WELD_EFFECTIVE_OFFICIALITY,
      hasVik: weldJoints.hasVik,
      hasRk: weldJoints.hasRk,
      hasUzk: weldJoints.hasUzk,
      hasPvk: weldJoints.hasPvk,
      pstoRequired: weldJoints.pstoRequired,
      pstoResult: weldJoints.pstoResult,
      pstoDate: weldJoints.pstoDate,
      heatTreatmentDiagram: weldJoints.heatTreatmentDiagram,
      tvmtRequest: weldJoints.tvmtRequest,
      tvmtRequestDate: weldJoints.tvmtRequestDate,
      tvmtConclusion: weldJoints.tvmtConclusion,
      tvmtConclusionDate: weldJoints.tvmtConclusionDate,
      vikResult: weldJoints.vikResult,
      rkResult: weldJoints.rkResult,
      uzkResult: weldJoints.uzkResult,
      pvkResult: weldJoints.pvkResult,
      tvmtResult: weldJoints.tvmtResult,
      rejectedDuplicateMethod: sql<string | null>`(
        select ${duplicateControls.method}
        from ${duplicateControls}
        where ${duplicateControls.weldJointId} = ${weldJoints.id}
          and ${duplicateControls.result} in ('ремонт', 'вырез')
        order by ${duplicateControls.id}
        limit 1
      )`,
    })
    .from(weldJoints)
    .where(eq(WELD_EFFECTIVE_OFFICIALITY, 'неофициальный'))
  const rowsWithDuplicates = rows.map(({ rejectedDuplicateMethod, ...row }) => rejectedDuplicateMethod
    ? {
        ...row,
        duplicateControls: [{
          id: 0,
          weldJointId: row.id,
          method: rejectedDuplicateMethod as DuplicateControlRecord['method'],
          result: 'ремонт' as const,
          controlDate: '',
          conclusion: '',
          conclusionDate: '',
        }],
      }
    : row) as WeldRow[]
  return buildFinalStatusRowsContext(
    await attachHeatTreatmentControlRelations(rowsWithDuplicates),
  )
}

export async function listWeldJointRowsByIds({
  data: input,
}: {
  data: WeldRowsByIdsRequest
}): Promise<WeldRow[]> {
  const data = {
    ids: Array.from(new Set((input?.ids ?? []).map(Number).filter(Number.isFinite))),
  }
  await assertSecurityScope('entry')
  if (data.ids.length === 0) return []
  const db = requireDb()
  const rows = await loadWeldRowsByIdsInBatches(db, data.ids)
  const orderById = new Map(data.ids.map((id, index) => [id, index]))
  rows.sort((left, right) => (orderById.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (orderById.get(right.id) ?? Number.MAX_SAFE_INTEGER))
  return compactWeldRowsForTransport(
    await attachGeneratedDocumentFields(
      await attachHeatTreatmentControlRelations(
        await attachDuplicateControlsToPage(
          applyCurrentSystemWdi(rows, await loadServerOtherSettings()),
        ),
      ),
    ),
  )
}

export async function loadWeldRowsByIdsInBatches(
  db: Pick<ReturnType<typeof requireDb>, 'select'>,
  ids: readonly number[],
) {
  if (ids.length === 0) return []
  return db
    .select(WELD_TABLE_SELECT)
    .from(weldJoints)
    .where(buildNumberArrayMatch(weldJoints.id, ids))
}

export function parseStoredJson(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

export async function listColumnFilterOptions(data: ReturnType<typeof normalizeWeldColumnFilterOptionsRequest>) {
  if (!FIELD_BY_KEY.has(data.fieldKey)) return []
  const columnFilters = getColumnFilterOptionFilters(data.columnFilters, data.fieldKey)
  if (String(data.finalStatus ?? '').trim() || shouldEnsureDispatcherTaskIndexForColumnFilter(data.fieldKey, columnFilters)) {
    assertCurrentDispatcherStatuses(await ensureDispatcherTaskIndexFresh())
  }
  const filters = { ...data, columnFilters }
  const compute = async () => {
      // Settings are captured inside the cache's revision guard.
      const settings = data.fieldKey === 'wdi' || data.fieldKey === 'rkExposureScheme' || columnFilters.wdi || columnFilters.rkExposureScheme
        ? await loadServerOtherSettings() : DEFAULT_OTHER_SETTINGS
      const where = buildReportQueryWhere(data.report, filters, settings)
      const documentType = GENERATED_DOCUMENT_FIELD_TYPES[data.fieldKey as keyof typeof GENERATED_DOCUMENT_FIELD_TYPES]
      if (documentType) return listGeneratedDocumentColumnFilterOptions(filters, documentType, where)
      if (data.fieldKey === DISPATCHER_TASKS_FIELD_KEY) return listDispatcherTaskColumnFilterOptionsByWhere(where)
      if (data.fieldKey === 'finalStatus') return listFinalStatusColumnFilterOptions(filters, where)
      const column = buildCalculatedReportValueSql(data.report, data.fieldKey, settings) ?? getWeldColumn(data.fieldKey)
      if (!column) return []
      const value = reportTextSql(column)
      const rows = await requireDb().select({ value, count: count() }).from(weldJoints).where(where).groupBy(sql`1`)
      return normalizeWeldColumnFilterOptions(data.fieldKey,
        rows.map(row => ({ value: row.value, count: Number(row.count), label: row.value || '(пусто)' })), data.report === 'weldingJournal')
  }
  const calculated = !isReportSourceColumnFilter(data.fieldKey, data.report) ||
    !canPaginateReportSource(columnFilters, data.report) || data.fieldKey === 'wdi' || Boolean(columnFilters.wdi)
  return calculated ? getOrComputeDerivedCalculation(
    buildDerivedReportCacheKey('report-column-options:v6', data.report, filters,
      { fieldKey: data.fieldKey, ...await getReportTaskPublicationCacheIdentity(columnFilters, data.fieldKey) }), compute,
  ) : compute()
}

export async function listDispatcherTaskColumnFilterOptionsByWhere(where: SQL) {
  const result = await requireDb().execute<{ value: string; count: number | string }>(sql`
    select
      "dispatcher_task_codes"."code" as "value",
      count(distinct "dispatcher_task_codes"."weld_joint_id")::int as "count"
    from (
      select
        ${dispatcherRowTasks.weldJointId} as "weld_joint_id",
        ${dispatcherRowTasks.code} as "code"
      from ${dispatcherRowTasks}
      union
      select
        ${dispatcherBackgroundRowTasks.weldJointId} as "weld_joint_id",
        ${dispatcherBackgroundRowTasks.code} as "code"
      from ${dispatcherBackgroundRowTasks}
    ) as "dispatcher_task_codes"
    inner join ${weldJoints}
      on ${weldJoints.id} = "dispatcher_task_codes"."weld_joint_id"
    where ${where}
    group by "dispatcher_task_codes"."code"
  `)

  return sortColumnFilterOptions(
    result.rows.map((row) => ({
      value: String(row.value ?? ''),
      count: Number(row.count) || 0,
      label: String(row.value ?? ''),
    })),
  )
}

export async function listFinalStatusColumnFilterOptions(
  data: ReturnType<typeof normalizeWeldColumnFilterOptionsRequest>,
  where: SQL | undefined = buildWhere(data),
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

export async function listGeneratedDocumentColumnFilterOptions(
  data: ReturnType<typeof normalizeWeldColumnFilterOptionsRequest>,
  documentType: string | readonly string[],
  where: SQL = (data.report === 'weldingJournal'
    ? buildWhere(data)
    : and(buildReportKindWhere(data.report), buildReportSourceWhere(data, data.report))) ?? sql`true`,
) {
  const documentTypes = Array.isArray(documentType) ? [...documentType] : [documentType]
  const typeWhere = documentTypes.length === 1
    ? eq(generatedDocuments.type, documentTypes[0])
    : inArray(generatedDocuments.type, documentTypes)
  const db = requireDb()
  const valueExpression = sql<string>`coalesce(${generatedDocuments.title}, '')`
  const rows = await db
    .select({ value: valueExpression, count: countDistinct(weldJoints.id) })
    .from(weldJoints)
    .innerJoin(
      generatedDocumentWeldJoints,
      eq(generatedDocumentWeldJoints.weldJointId, weldJoints.id),
    )
    .innerJoin(
      generatedDocuments,
      and(
        eq(generatedDocuments.id, generatedDocumentWeldJoints.documentId),
        typeWhere,
      ),
    )
    .where(where)
    .groupBy(valueExpression)
  const missingValue = buildGeneratedDocumentMissingValue(data.fieldKey)
  const missingRows = await db
    .select({ count: count(), value: missingValue })
    .from(weldJoints)
    // No-document rows can be either genuinely empty or assigned and awaiting PVK.
    // This remains a single grouped SQL query, independent of the number of joints.
    .where(and(where, buildGeneratedDocumentColumnWhere('=', documentType)))
    // Group by the selected expression, without duplicating its SQL parameters.
    .groupBy(sql`2`)

  return sortColumnFilterOptions(
    [
      ...rows.map((row) => ({
        value: row.value,
        count: row.count,
        label: row.value || '(пусто)',
      })),
      ...missingRows.filter((row) => Number(row.count) > 0).map((row) => ({
        value: row.value || '', count: Number(row.count), label: row.value || '(пусто)',
      })),
    ],
  )
}

export function normalizeWeldColumnFilterOptionsRequest(data: WeldColumnFilterOptionsRequest | undefined) {
  const request = normalizeWeldPageRequest(data)
  const report = data?.report ?? 'weldingJournal'
  const fieldKey = migrateLegacyWeldFieldKey(data?.fieldKey) as WeldFieldKey

  return {
    ...request,
    report,
    fieldKey,
  }
}

export function normalizeWeldPageRequest(
  data: WeldPageRequest | undefined,
): Required<Pick<WeldPageRequest, 'page' | 'pageSize' | 'columnFilters'>> & WeldFilters & {
  report?: WeldReportKind
  sort?: WeldSort
  includeTotals?: boolean
} {
  const page = Math.max(1, Math.floor(Number(data?.page) || 1))
  const pageSize = normalizeWeldPageSize(data?.pageSize)
  const columnFilters = migrateLegacyWeldFieldRecordKeys(Object.fromEntries(
    Object.entries(data?.columnFilters ?? {}).filter(([, value]) => String(value ?? '').trim()),
  ))
  const sort = normalizeWeldSort(data?.sort)
  const source = data as (WeldPageRequest & { status?: string }) | undefined
  const { sort: _sort, status: legacyOfficiality, ...rest } = source ?? {}
  const officiality = rest.officiality ?? legacyOfficiality

  return {
    ...rest,
    ...(officiality !== undefined ? { officiality } : {}),
    page,
    pageSize,
    columnFilters,
    ...(sort ? { sort } : {}),
  }
}

export function normalizeWeldSort(value: WeldPageRequest['sort'] | undefined): WeldSort | undefined {
  if (!value || (value.direction !== 'asc' && value.direction !== 'desc')) return undefined
  const fieldKey = migrateLegacyWeldFieldKey(value.fieldKey) as WeldFieldKey
  if (!FIELD_BY_KEY.has(fieldKey) || !getWeldColumn(fieldKey)) return undefined
  return { fieldKey, direction: value.direction }
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
    leadingLetterIndexedRowsCount: rows.filter((row) => /^[A-Z][A-Z]\d/i.test(String(row.joint ?? '').replace(/\s+/g, ''))).length,
    weldingTypes: Array.from(countMultiValueUsage(rows.map((row) => row.weldingMethod), /[+,;]+/)),
    connectionTypes: Array.from(countSingleValueUsage(rows.map((row) => row.connectionType))),
    materialGroups: Array.from(countMultiValueUsage(rows.map((row) => row.materialGroup), /\+/)),
    testTypes: Array.from(countMultiValueUsage(rows.map((row) => row.testTypes), /[,;+]+/)),
  }
}

export function buildReportSourceWhere(
  filters: WeldFilters & { columnFilters?: Record<string, string> },
  report?: WeldReportKind,
) {
  const clauses: SQL[] = []
  addBaseFilterClauses(clauses, filters)
  addReportSourceColumnFilterClauses(clauses, filters.columnFilters ?? {}, report)
  return clauses.length ? and(...clauses) : sql`true`
}

export function buildDerivedReportCacheKey(
  namespace: string,
  report: WeldReportKind,
  filters: WeldFilters & { columnFilters?: Record<string, string> },
  extra: Record<string, unknown> = {},
) {
  const key = buildDerivedCalculationCacheKey(namespace, {
    report,
    search: filters.search ?? '',
    projectTitle: filters.projectTitle ?? '',
    line: filters.line ?? '',
    groupName: filters.groupName ?? '',
    category: filters.category ?? '',
    pstoRequired: filters.pstoRequired ?? '',
    weldingMethod: filters.weldingMethod ?? '',
    materialGroup: filters.materialGroup ?? '',
    officiality: filters.officiality ?? '',
    finalStatus: filters.finalStatus ?? '',
    controlMethod: filters.controlMethod ?? '',
    columnFilters: filters.columnFilters ?? {},
    ...extra,
  })
  // Report checkbox choices can contain thousands of exact values. PostgreSQL
  // indexes the cache key; keep its size independent of the selection size.
  return key.length > 512
    ? buildDerivedCalculationCacheKey(namespace, { sha256: createHash('sha256').update(key).digest('hex') }) : key
}

export function buildReportKindWhere(report: Exclude<WeldReportKind, 'weldingJournal'>) {
  const hasWeldingDate = sql`${weldJoints.weldDate} is not null`
  if (report === 'heatTreatment') {
    return and(
      hasWeldingDate,
      or(
        buildControlReportValueWhere(weldJoints.pstoRequired),
        buildPstoDocumentHistoryWhere(),
      ),
    ) ?? sql`false`
  }
  return (
    and(
      hasWeldingDate,
      or(...LNK_METHODS.map((method) => buildControlReportValueWhere(getWeldColumn(method.enabledKey) ?? sql`null`))) ??
        sql`false`,
    ) ?? sql`false`
  )
}

export function buildControlReportValueWhere(column: SQLWrapper) {
  return buildNormalizedControlAvailabilityWhere(column, CONTROL_REPORT_VALUES)
}

export function buildEnabledControlValueWhere(column: SQLWrapper) {
  return buildNormalizedControlAvailabilityWhere(column, ENABLED_CONTROL_REPORT_VALUES)
}

export function addReportSourceColumnFilterClauses(
  clauses: SQL[], columnFilters: Record<string, string>, report?: WeldReportKind,
) {
  for (const [key, value] of Object.entries(columnFilters)) {
    const query = value.trim()
    if (!query) continue

    if (key === ROW_ID_LIST_FILTER_KEY) {
      const filter = parseRowIdListFilter(query)
      if (filter) clauses.push(buildRowIdListWhere(filter))
      continue
    }

    if (key === JOINT_CHAIN_FILTER_KEY) {
      const filter = parseJointChainFilter(query)
      if (filter) clauses.push(buildJointChainWhere(filter))
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

    if (key === 'finalStatus') {
      clauses.push(buildFinalStatusColumnWhere(query))
      continue
    }

    const documentType = GENERATED_DOCUMENT_FIELD_TYPES[key as keyof typeof GENERATED_DOCUMENT_FIELD_TYPES]
    if (documentType) {
      clauses.push(buildGeneratedDocumentColumnWhere(query, documentType, key))
      continue
    }

    if (!isReportSourceColumnFilter(key as WeldFieldKey, report)) continue
    const column = (report === 'heatTreatment' ? buildPstoCurrentReportValueSql(key as WeldFieldKey) : undefined)
      ?? getWeldColumn(key as WeldFieldKey)
    if (!column) continue

    const choiceFilter = parseWeldColumnChoiceFilter(query)
    if (choiceFilter?.kind === 'values') {
      clauses.push(
        CONTROL_ASSIGNMENT_FIELD_KEYS.has(key)
          ? buildControlAvailabilityColumnWhere(column, choiceFilter.values)
          : buildColumnChoiceWhere(column, choiceFilter.values),
      )
      continue
    }

    if (query.startsWith('=')) {
      const exactValue = query.slice(1).trim().replace(/^["']|["']$/g, '')
      clauses.push(
        CONTROL_ASSIGNMENT_FIELD_KEYS.has(key)
          ? buildControlAvailabilityColumnWhere(column, [exactValue])
          : buildColumnTextEqualsWhere(column, exactValue),
      )
      continue
    }

    clauses.push(sql`coalesce(${column}::text, '') ilike ${`%${query}%`}`)
  }
}

export function getReportContextSelect(report: WeldReportContextKind) {
  const hiddenFieldKeys = report === 'lnk' ? LNK_HIDDEN_FIELD_KEYS : HEAT_TREATMENT_HIDDEN_FIELD_KEYS
  const requiredFieldKeys = report === 'lnk'
    ? LNK_REPORT_CONTEXT_REQUIRED_FIELD_KEYS
    : HEAT_TREATMENT_CONTEXT_REQUIRED_FIELD_KEYS
  return Object.fromEntries(
    Object.entries(WELD_TABLE_SELECT).filter(([fieldKey]) =>
      !hiddenFieldKeys.has(fieldKey as WeldFieldKey) || requiredFieldKeys.has(fieldKey as WeldFieldKey)),
  ) as typeof WELD_TABLE_SELECT
}

export function shouldEnsureDispatcherTaskIndexForColumnFilter(
  fieldKey: WeldFieldKey,
  columnFilters: Record<string, string>,
) {
  return (
    fieldKey === DISPATCHER_TASKS_FIELD_KEY ||
    fieldKey === 'finalStatus' ||
    Boolean(columnFilters.finalStatus?.trim()) ||
    hasDispatcherTaskServerFilter(columnFilters)
  )
}

function isReportSourceColumnFilter(fieldKey: WeldFieldKey, report?: WeldReportKind) {
  return REPORT_SOURCE_COLUMN_FILTER_KEYS.has(fieldKey) || report === 'heatTreatment' && PSTO_CURRENT_SQL_FIELD_KEYS.has(fieldKey)
}

export function canPaginateReportSource(columnFilters: Record<string, string>, report?: WeldReportKind) {
  return Object.entries(columnFilters).every(([key, value]) => {
    if (!String(value ?? '').trim()) return true
    return isHiddenReportFilterKey(key) || isReportSourceColumnFilter(key as WeldFieldKey, report)
  })
}

export function normalizeWeldColumnFilterOptions(
  fieldKey: WeldFieldKey,
  options: readonly WeldColumnFilterOption[],
  reuseLabelCollator = false,
) {
  if (!CONTROL_ASSIGNMENT_FIELD_KEYS.has(fieldKey)) return sortColumnFilterOptions([...options], reuseLabelCollator)

  const counts = new Map<string, number>()
  for (const option of options) {
    const value = normalizeControlAvailabilityFilterValue(option.value)
    counts.set(value, (counts.get(value) ?? 0) + (Number(option.count) || 0))
  }
  return sortColumnFilterOptions(
    [...counts.entries()].map(([value, count]) => ({
      value,
      count,
      label: value || '(пусто)',
    })), reuseLabelCollator,
  )
}

// Opted into only by journal scalar facets. The collation and stable tie order
// are unchanged; large option lists no longer construct a collator per compare.
const JOURNAL_FILTER_COLLATOR = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' })
export function sortColumnFilterOptions(options: WeldColumnFilterOption[], reuseLabelCollator = false) {
  return [...options].sort((left, right) => {
    if (left.value === '') return -1
    if (right.value === '') return 1
    return reuseLabelCollator ? JOURNAL_FILTER_COLLATOR.compare(left.label, right.label)
      : left.label.localeCompare(right.label, 'ru', { numeric: true, sensitivity: 'base' })
  })
}

export function getUniqueSortedTexts(values: unknown[]) {
  return Array.from(
    new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right, 'ru', { numeric: true }))
}

export function normalizeUsageValue(value: unknown) {
  return String(value ?? '').trim()
}

export function countSingleValueUsage(values: unknown[]) {
  const counts = new Map<string, number>()
  for (const rawValue of values) {
    const value = normalizeUsageValue(rawValue)
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return counts
}

export function countMultiValueUsage(values: unknown[], separator: RegExp) {
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

export function getReportOrderBy(report: WeldReportKind, sort?: WeldSort, settings = DEFAULT_OTHER_SETTINGS) {
  const currentWdi = sort?.fieldKey === 'wdi' && isSystemWdiMode(settings)
    ? buildCalculatedReportValueSql(report, 'wdi', settings) : undefined
  const currentValue = report === 'heatTreatment' && sort ? buildPstoCurrentReportValueSql(sort.fieldKey) : undefined
  const sortColumn = currentWdi ?? (currentValue ? sql`nullif(${currentValue}, '')` : sort ? getWeldColumn(sort.fieldKey) : undefined)
  const requestedOrder = sort && sortColumn
    ? sort.fieldKey === 'joint'
      ? getNaturalJointOrderBy(sortColumn, sort.direction)
      : [sort.direction === 'desc' ? sql`${sortColumn} desc nulls last` : sql`${sortColumn} asc nulls last`]
    : []
  if (report === 'weldingJournal') {
    return requestedOrder.length > 0
      ? [...requestedOrder, asc(weldJoints.line), asc(weldJoints.joint), asc(weldJoints.id)]
      : WELDING_JOURNAL_ORDER_BY
  }
  const createdAtColumn = report === 'lnk' ? weldJoints.lnkCreatedAt : weldJoints.pstoCreatedAt
  return requestedOrder.length > 0 ? [
    ...requestedOrder,
    asc(weldJoints.line),
    asc(weldJoints.spool),
    asc(weldJoints.joint),
    asc(weldJoints.id),
  ] : [
    sql`${createdAtColumn} desc nulls last`,
    asc(weldJoints.line),
    asc(weldJoints.spool),
    asc(weldJoints.joint),
    asc(weldJoints.id),
  ]
}

function getNaturalJointOrderBy(column: SQLWrapper, direction: WeldSort['direction']): SQL[] {
  const value = sql<string>`coalesce(${column}::text, '')`
  const prefix = sql<string>`lower(substring(${value} from '^[^0-9]*'))`
  const firstNumber = sql<number>`(substring(${value} from '[0-9]+'))::numeric`
  const tail = sql<string>`regexp_replace(${value}, '^[^0-9]*[0-9]+', '')`
  const tailPrefix = sql<string>`lower(substring(${tail} from '^[^0-9]*'))`
  const secondNumber = sql<number>`(substring(${tail} from '[0-9]+'))::numeric`
  const ordered = (expression: SQL, nullsFirst = false) => direction === 'desc'
    ? sql`${expression} desc nulls last`
    : nullsFirst
      ? sql`${expression} asc nulls first`
      : sql`${expression} asc nulls last`

  return [
    sql`case when ${column} is null or btrim(${column}::text) = '' then 1 else 0 end asc`,
    ordered(prefix),
    ordered(firstNumber, true),
    ordered(tailPrefix),
    ordered(secondNumber, true),
    ordered(sql`lower(${value})`),
  ]
}


export * from '@/server/weld-contracts'
