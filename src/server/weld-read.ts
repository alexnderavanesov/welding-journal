// This module is intentionally domain-scoped. Keep cross-domain rules in weld-server-shared.

import { requireDb } from '@/db'
import {
appSettings,
dispatcherAcceptedWarnings,
dispatcherBackgroundRowTasks,
dispatcherRowTasks,
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
CONTROL_BASIS_SUMMARY_FIELD_KEY,
withControlBasisSummary
} from '@/lib/control-assignment-basis'
import { LEGACY_CONTROL_REPLACEMENT_VALUE } from '@/lib/control-availability-values'
import { buildDerivedCalculationCacheKey } from '@/lib/derived-calculation-cache-key'
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
type RkExposureTableSettings
} from '@/lib/other-settings'
import { PRE_HEAT_TREATMENT_REPORT_FIELD_KEYS } from '@/lib/pre-heat-treatment-report-fields'
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
import { getRkExposureSchemeState } from '@/lib/rk-exposure'
import {
DEFAULT_SYSTEM_INDEX_SETTINGS,
normalizeSystemIndexSettings,
} from '@/lib/system-index-settings'
import { isSystemWdiMode } from '@/lib/wdi'
import { parseWeldColumnChoiceFilter } from '@/lib/weld-column-choice-filter'
import {
buildFinalStatusRowsContext,
calculateFinalStatusInRows,
FIELD_BY_KEY,
migrateLegacyWeldFieldKey,
migrateLegacyWeldFieldRecordKeys,
type WeldFieldKey,
type WeldInput
} from '@/lib/weld-fields'
import {
canSuggestWeldFormField,
getWeldFormSuggestionQueryFieldKeys,
getWeldFormSuggestions,
type WeldFormSuggestion,
} from '@/lib/weld-form-suggestions'
import { filterWeldRowsByColumns,getWeldColumnFilterRowText } from '@/lib/weld-table-filtering'
import { buildNullableControlEnabledWhere } from '@/server/control-availability-sql'
import {
getOrComputeDerivedCalculation,
} from '@/server/derived-calculation-cache'
import {
ensureDispatcherTaskIndexFresh,
} from '@/server/dispatcher-task-index'
import { attachGeneratedDocumentFields } from '@/server/generated-document-row-fields'
import {
attachHeatTreatmentControlRelations,
attachPreHeatTreatmentControlRelations,
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
type WeldPageSize,
type WeldReportContextKind,
type WeldReportKind,
type WeldSort,
type WeldRowsByIdsRequest,
type WeldSnapshotPageRequest
} from '@/server/weld-contracts'
import { and,asc,count,desc,eq,exists,gt,gte,inArray,lte,notExists,or,sql,type SQL,type SQLWrapper } from 'drizzle-orm'
import { QueryBuilder } from 'drizzle-orm/pg-core'

import {
addBaseFilterClauses,
applyCurrentSystemWdi,
buildColumnChoiceWhere,
buildColumnTextEqualsWhere,
buildDispatcherTaskWhere,
buildGeneratedDocumentColumnWhere,
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
WELD_TABLE_COLUMNS,
WELD_EFFECTIVE_OFFICIALITY,
WELD_TABLE_RETURNING,
WELD_TABLE_SELECT,
WELDING_JOURNAL_ORDER_BY,
} from '@/server/weld-server-shared'

const SQL_QUERY_BUILDER = new QueryBuilder()
import {
  compactWeldRowsForTransport,
  splitNumberBatches,
  type DuplicateControlCarrier,
} from '@/server/weld-request-utils'

export type WeldDataUsageRow = {
  joint?: unknown
  weldingMethod?: unknown
  connectionType?: unknown
  materialGroup?: unknown
  testTypes?: unknown
}

export const ENABLED_CONTROL_REPORT_VALUES = ['да', 'Да', 'дополнительный', LEGACY_CONTROL_REPLACEMENT_VALUE] as const

export const CONTROL_REPORT_VALUES = [...ENABLED_CONTROL_REPORT_VALUES, 'отменен'] as const

export const LNK_REQUEST_DATE_DERIVED_FILTER_SELECT = Object.fromEntries(
  ALL_LNK_FIELD_METHODS.map((method) => [method.requestDateKey, WELD_TABLE_COLUMNS[method.requestDateKey]]),
)

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

export const REPORT_DERIVED_FILTER_SELECT = {
  id: weldJoints.id,
  weldDate: weldJoints.weldDate,
  projectTitle: weldJoints.projectTitle,
  subtitleCode: weldJoints.subtitleCode,
  line: weldJoints.line,
  connectionType: weldJoints.connectionType,
  d1: weldJoints.d1,
  d2: weldJoints.d2,
  t1: weldJoints.t1,
  t2: weldJoints.t2,
  wdi: weldJoints.wdi,
  spool: weldJoints.spool,
  joint: weldJoints.joint,
  officiality: WELD_EFFECTIVE_OFFICIALITY,
  finalStatus: weldJoints.finalStatus,
  pstoRequired: weldJoints.pstoRequired,
  pstoCancellationDate: weldJoints.pstoCancellationDate,
  pstoRequest: weldJoints.pstoRequest,
  pstoRequestDate: weldJoints.pstoRequestDate,
  pstoDate: weldJoints.pstoDate,
  pstoResult: weldJoints.pstoResult,
  pstoCreatedAt: weldJoints.pstoCreatedAt,
  pstoUpdatedAt: weldJoints.pstoUpdatedAt,
  lnkCreatedAt: weldJoints.lnkCreatedAt,
  lnkUpdatedAt: weldJoints.lnkUpdatedAt,
  hasVik: weldJoints.hasVik,
  hasRk: weldJoints.hasRk,
  hasPvk: weldJoints.hasPvk,
  hasUzk: weldJoints.hasUzk,
  hasTvmt: weldJoints.hasTvmt,
  vikRequest: weldJoints.vikRequest,
  rkRequest: weldJoints.rkRequest,
  pvkRequest: weldJoints.pvkRequest,
  uzkRequest: weldJoints.uzkRequest,
  tvmtRequest: weldJoints.tvmtRequest,
  ...LNK_REQUEST_DATE_DERIVED_FILTER_SELECT,
  vikResult: weldJoints.vikResult,
  rkResult: weldJoints.rkResult,
  pvkResult: weldJoints.pvkResult,
  uzkResult: weldJoints.uzkResult,
  tvmtResult: weldJoints.tvmtResult,
  vikControlBasis: weldJoints.vikControlBasis,
  rkControlBasis: weldJoints.rkControlBasis,
  uzkControlBasis: weldJoints.uzkControlBasis,
  pvkControlBasis: weldJoints.pvkControlBasis,
  tvmtControlBasis: weldJoints.tvmtControlBasis,
  pstoControlBasis: weldJoints.pstoControlBasis,
  vikConclusionDate: weldJoints.vikConclusionDate,
  rkConclusionDate: weldJoints.rkConclusionDate,
  pvkConclusionDate: weldJoints.pvkConclusionDate,
  uzkConclusionDate: weldJoints.uzkConclusionDate,
  tvmtConclusionDate: weldJoints.tvmtConclusionDate,
  vikConclusion: weldJoints.vikConclusion,
  rkConclusion: weldJoints.rkConclusion,
  pvkConclusion: weldJoints.pvkConclusion,
  uzkConclusion: weldJoints.uzkConclusion,
  tvmtConclusion: weldJoints.tvmtConclusion,
  lnkDefectDescription: weldJoints.lnkDefectDescription,
  rkExposureConfirmedDiameter: weldJoints.rkExposureConfirmedDiameter,
}

export function getReportDerivedFilterSelect(fieldKey?: WeldFieldKey) {
  const fieldColumn = fieldKey ? getWeldColumn(fieldKey) : undefined
  if (!fieldKey || !fieldColumn || Object.hasOwn(REPORT_DERIVED_FILTER_SELECT, fieldKey)) {
    return REPORT_DERIVED_FILTER_SELECT
  }
  return { ...REPORT_DERIVED_FILTER_SELECT, [fieldKey]: fieldColumn }
}

export function getDerivedReportFilterSelectedFieldKeys(fieldKey?: WeldFieldKey): Set<WeldFieldKey> {
  return new Set(Object.keys(getReportDerivedFilterSelect(fieldKey)) as WeldFieldKey[])
}

export const REPORT_SOURCE_COLUMN_FILTER_KEYS = new Set<WeldFieldKey>([
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
  const selectedColumns = Object.fromEntries(
    getWeldFormSuggestionQueryFieldKeys(data.fieldKey)
      .map((fieldKey) => [fieldKey, getWeldColumn(fieldKey)] as const)
      .filter((entry): entry is [WeldFieldKey, NonNullable<ReturnType<typeof getWeldColumn>>] => Boolean(entry[1])),
  )
  const rows = await requireDb()
    .select(selectedColumns)
    .from(weldJoints)
    .orderBy(desc(weldJoints.createdAt))
  return getWeldFormSuggestions({
    fieldKey: data.fieldKey,
    value: data.draft[data.fieldKey],
    draft: data.draft,
    rows: rows as WeldInput[],
  })
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
  const documentLinks: Array<{ weldJointId: number }> = []
  for (const idBatch of splitNumberBatches(hydratedRows.map((row) => row.id), 1000)) {
    documentLinks.push(...await db
      .select({ weldJointId: generatedDocumentWeldJoints.weldJointId })
      .from(generatedDocumentWeldJoints)
      .where(inArray(generatedDocumentWeldJoints.weldJointId, idBatch)))
  }
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
  return recordWithDuplicateControls as unknown as WeldRow
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
      await attachGeneratedDocumentFields(
        await attachDuplicateControlsToPage(
          await attachPreHeatTreatmentControlRelations(
            applyCurrentSystemWdi(rows, await loadServerOtherSettings()),
            db,
          ),
        ),
      ),
    ),
    scopeOptions: {
      projects: getUniqueSortedTexts(projectRows.map((row) => row.value)),
      subtitles: getUniqueSortedTexts(subtitleRows.map((row) => row.value)),
      lines: getUniqueSortedTexts(lineRows.map((row) => row.value)),
    },
  }
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
    listSingleValueUsage(weldJoints.materialGroup),
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

export async function listReportPage(report: WeldReportKind, data: ReturnType<typeof normalizeWeldPageRequest>) {
  const db = requireDb()
  const [dispatcherState, otherSettings] = await Promise.all([
    ensureDispatcherTaskIndexFresh(),
    loadServerOtherSettings(),
  ])
  const hasCurrentSystemWdiFilter = isSystemWdiMode(otherSettings) && Boolean(data.columnFilters.wdi?.trim())
  const sourceColumnFilters = getWeldColumnFilterOptionSourceFilters(
    data.columnFilters,
    isSystemWdiMode(otherSettings),
  )
  const hasDerivedColumnFilters = Object.keys(sourceColumnFilters).length !== Object.keys(data.columnFilters).length
  const sourceFilterData = sourceColumnFilters === data.columnFilters
    ? data
    : { ...data, columnFilters: sourceColumnFilters }
  if (report !== 'weldingJournal') {
    const where = and(buildReportKindWhere(report), buildReportSourceWhere(sourceFilterData)) ?? sql`true`
    if (canPaginateReportSource(data.columnFilters) && !hasCurrentSystemWdiFilter) {
      const query = db
        .select(WELD_TABLE_SELECT)
        .from(weldJoints)
        .where(where)
        .orderBy(...getReportOrderBy(report, data.sort))
      const shouldCount = data.page === 1 && data.pageSize !== WELD_PAGE_ALL_SIZE
      const countQuery = shouldCount
        ? db.select({ total: count() }).from(weldJoints).where(where)
        : Promise.resolve([])
      const availableRequestCountQuery = data.page === 1 && report === 'lnk'
        ? countAvailableLnkRequestRows(where)
        : Promise.resolve(undefined)
      const fetchExtraRow = data.page > 1 && data.pageSize !== WELD_PAGE_ALL_SIZE
      const rowsQuery =
        data.pageSize === WELD_PAGE_ALL_SIZE
          ? query
          : query.limit(data.pageSize + (fetchExtraRow ? 1 : 0)).offset((data.page - 1) * data.pageSize)
      const [[countRow], availableRequestCount, fetchedRows] = await Promise.all([
        countQuery,
        availableRequestCountQuery,
        rowsQuery,
      ])
      const rows = fetchExtraRow ? fetchedRows.slice(0, data.pageSize as number) : fetchedRows
      const total = data.pageSize === WELD_PAGE_ALL_SIZE
        ? rows.length
        : countRow
          ? Number(countRow.total) || 0
          : undefined
      const reportRows = applyCurrentSystemWdi(buildServerReportRows(rows, report), otherSettings)
      const rowsWithMetadata = compactWeldRowsForTransport(
        await attachReportPageMetadata(reportRows, { dispatcherState }),
      )

      return {
        rows: rowsWithMetadata,
        ...(total === undefined ? {} : { total }),
        availableRequestCount,
        page: data.page,
        pageSize: data.pageSize,
        hasMore: data.pageSize !== WELD_PAGE_ALL_SIZE && (
          total === undefined ? fetchedRows.length > data.pageSize : data.page * data.pageSize < total
        ),
      }
    }

    const filteredIds = await listDerivedReportRowIds(report, data, where)
    const total = filteredIds.length
    const availableRequestCount = data.page === 1 && report === 'lnk'
      ? await countAvailableLnkRequestRowsByIds(filteredIds)
      : undefined
    const pageIds =
      data.pageSize === WELD_PAGE_ALL_SIZE
        ? filteredIds
        : filteredIds.slice((data.page - 1) * data.pageSize, data.page * data.pageSize)
    const rows = applyCurrentSystemWdi(
      await getFullReportRowsByIds(pageIds, report, dispatcherState),
      otherSettings,
    )

    return {
      rows,
      total,
      availableRequestCount,
      page: data.page,
      pageSize: data.pageSize,
      hasMore: data.pageSize !== WELD_PAGE_ALL_SIZE && data.page * data.pageSize < total,
    }
  }

  if (hasDerivedColumnFilters) {
    const currentRows = buildServerReportRows(applyCurrentSystemWdi(
      await db
        .select(WELD_TABLE_SELECT)
        .from(weldJoints)
        .where(buildWhere(sourceFilterData))
        .orderBy(...getReportOrderBy('weldingJournal', data.sort)),
      otherSettings,
    ), 'weldingJournal')
    const rowsWithDerivedValues = await attachRkExposureSchemeFilterValuesIfNeeded(
      await attachCurrentFinalStatuses(currentRows),
      data.columnFilters,
    )
    const filteredRows = filterWeldRowsByColumns(rowsWithDerivedValues, data.columnFilters)
    const total = filteredRows.length
    const pageRows = data.pageSize === WELD_PAGE_ALL_SIZE
      ? filteredRows
      : filteredRows.slice((data.page - 1) * data.pageSize, data.page * data.pageSize)
    const acceptedWdiTotal = filteredRows.reduce(
      (sum, row) => String(row.finalStatus ?? '').trim().toLocaleLowerCase('ru') === 'годен'
        ? sum + (Number(row.wdi) || 0)
        : sum,
      0,
    )
    const rows = compactWeldRowsForTransport(
      await attachReportPageMetadata(pageRows, { dispatcherState }),
    )
    return {
      rows,
      total,
      acceptedWdiTotal,
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
    .orderBy(...getReportOrderBy('weldingJournal', data.sort))

  const shouldCount = data.page === 1 && data.pageSize !== WELD_PAGE_ALL_SIZE
  const countQuery = shouldCount
    ? db.select({ total: count() }).from(weldJoints).where(where)
    : Promise.resolve([])
  const acceptedWdiTotalQuery = data.page === 1
    ? getCurrentAcceptedWdiTotal(data, where, otherSettings)
    : Promise.resolve(0)
  const fetchExtraRow = data.page > 1 && data.pageSize !== WELD_PAGE_ALL_SIZE
  const rowsQuery =
    data.pageSize === WELD_PAGE_ALL_SIZE
      ? query
      : query.limit(data.pageSize + (fetchExtraRow ? 1 : 0)).offset((data.page - 1) * data.pageSize)
  const [[countRow], acceptedWdiTotal, fetchedRows] = await Promise.all([countQuery, acceptedWdiTotalQuery, rowsQuery])
  const rows = fetchExtraRow ? fetchedRows.slice(0, data.pageSize as number) : fetchedRows
  const total = data.pageSize === WELD_PAGE_ALL_SIZE
    ? rows.length
    : countRow
      ? Number(countRow.total) || 0
      : undefined
  const rowsWithMetadata = compactWeldRowsForTransport(
    await attachReportPageMetadata(
      buildServerReportRows(applyCurrentSystemWdi(rows, otherSettings), 'weldingJournal'),
      { dispatcherState },
    ),
  )

  return {
    rows: rowsWithMetadata,
    ...(total === undefined ? {} : { total }),
    acceptedWdiTotal,
    page: data.page,
    pageSize: data.pageSize,
    hasMore: data.pageSize !== WELD_PAGE_ALL_SIZE && (
      total === undefined ? fetchedRows.length > data.pageSize : data.page * data.pageSize < total
    ),
  }
}

export async function getCurrentAcceptedWdiTotal(
  data: ReturnType<typeof normalizeWeldPageRequest>,
  where: SQL | undefined,
  otherSettings: Awaited<ReturnType<typeof loadServerOtherSettings>>,
) {
  return getOrComputeDerivedCalculation(
    buildDerivedReportCacheKey(
      'welding-journal-accepted-wdi:v2',
      'weldingJournal',
      data,
    ),
    async () => {
      const sourceRows = await requireDb()
        .select(REPORT_DERIVED_FILTER_SELECT)
        .from(weldJoints)
        .where(where)
      const currentRows = await attachCurrentFinalStatuses(
        buildServerReportRows(applyCurrentSystemWdi(sourceRows, otherSettings), 'weldingJournal'),
      )
      return currentRows.reduce(
        (sum, row) => String(row.finalStatus ?? '').trim().toLocaleLowerCase('ru') === 'годен'
          ? sum + (Number(row.wdi) || 0)
          : sum,
        0,
      )
    },
  )
}

export async function countAvailableLnkRequestRows(where: SQL) {
  const [{ total }] = await requireDb()
    .select({ total: count() })
    .from(weldJoints)
    .where(and(where, buildAvailableLnkRequestWhere()))
  return Number(total) || 0
}

export async function countAvailableLnkRequestRowsByIds(ids: number[]) {
  let total = 0
  for (const idChunk of splitNumberBatches(ids, 1000)) {
    const [row] = await requireDb()
      .select({ total: count() })
      .from(weldJoints)
      .where(and(inArray(weldJoints.id, idChunk), buildAvailableLnkRequestWhere()))
    total += Number(row?.total) || 0
  }
  return total
}

export function buildAvailableLnkRequestWhere() {
  const buildAvailableMethodWhere = (method: (typeof LNK_METHODS)[number]) => {
    const enabledColumn = getWeldColumn(method.enabledKey)
    const requestColumn = getWeldColumn(method.requestKey)
    if (!enabledColumn || !requestColumn) return sql`false`
    return and(
      buildEnabledControlValueWhere(enabledColumn),
      sql`btrim(coalesce(${requestColumn}::text, '')) = ''`,
    ) ?? sql`false`
  }
  const stagedMethods = LNK_METHODS.filter((method) => isPreHeatTreatmentLnkMethodCode(method.code))
  const immediateMethods = LNK_METHODS.filter((method) => !isPreHeatTreatmentLnkMethodCode(method.code))
  const hasAvailableStagedMethod = or(
    ...stagedMethods.map(buildAvailableMethodWhere),
  ) ?? sql`false`
  const hasAvailableImmediateMethod = or(
    ...immediateMethods.map(buildAvailableMethodWhere),
  ) ?? sql`false`
  const hasAvailableMethod = or(
    hasAvailableImmediateMethod,
    and(hasAvailableStagedMethod, buildHeatTreatmentStagedLnkReadyWhere()),
  ) ?? sql`false`
  const hasNoRejectedResult = and(
    ...LNK_METHODS.map((method) => {
      const resultColumn = getWeldColumn(method.resultKey)
      return resultColumn
        ? sql`lower(btrim(coalesce(${resultColumn}::text, ''))) not in ('ремонт', 'вырез')`
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
  const hasNoRejectedPreHeatTreatmentControl = notExists(
    SQL_QUERY_BUILDER
      .select({ value: sql`1` })
      .from(preHeatTreatmentControls)
      .where(and(
        eq(preHeatTreatmentControls.weldJointId, weldJoints.id),
        sql`lower(btrim(coalesce(${preHeatTreatmentControls.result}, ''))) in ('ремонт', 'вырез')`,
      )),
  )
  return and(
    hasAvailableMethod,
    hasNoRejectedResult,
    hasNoRejectedDuplicate,
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
    eq(weldJoints.preHeatTreatmentLnkExempt, false),
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
      .where(eq(pstoRepeatCycles.weldJointId, weldJoints.id)),
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
    order by ${pstoRepeatCycles.sequence} desc
    limit 1
  ), false)`
  const currentCycleComplete = or(
    and(sql`not (${hasRepeatCycle})`, primaryCycleComplete),
    and(hasRepeatCycle, latestRepeatCycleComplete),
  ) ?? sql`false`

  return or(
    and(sql`not (${pstoRequired})`, sql`not (${hasExecutionHistory})`),
    and(
      currentCycleComplete,
      or(sql`not (${preHeatTreatmentRequired})`, allPreHeatTreatmentControlsGood),
    ),
  ) ?? sql`false`
}

export async function attachDuplicateControlsToPage<Row extends DuplicateControlCarrier>(rows: Row[]) {
  if (rows.length === 0) return rows
  const ids = [...new Set(rows.map((row) => Number(row.id)).filter(Number.isFinite))]
  if (ids.length === 0) return rows

  const db = requireDb()
  const controls: DuplicateControl[] = []
  for (const idChunk of splitNumberBatches(ids, 1000)) {
    controls.push(...await db
      .select()
      .from(duplicateControls)
      .where(inArray(duplicateControls.weldJointId, idChunk))
      .orderBy(asc(duplicateControls.weldJointId), asc(duplicateControls.id)))
  }

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
) {
  if (rows.length === 0) return rows
  const ids = [...new Set(rows.map((row) => Number(row.id)).filter(Number.isFinite))]
  if (ids.length === 0) return rows
  const taskRows: Array<DispatcherTaskCodeRow & { source: 'active' | 'background' }> = []
  for (const idChunk of splitNumberBatches(ids, 1000)) {
    const result = await requireDb().execute<DispatcherTaskCodeRow & { source: 'active' | 'background' }>(sql`
      select ${dispatcherRowTasks.weldJointId} as "rowId", ${dispatcherRowTasks.code} as "code", 'active' as "source"
      from ${dispatcherRowTasks}
      where ${inArray(dispatcherRowTasks.weldJointId, idChunk)}
      union all
      select ${dispatcherBackgroundRowTasks.weldJointId} as "rowId", ${dispatcherBackgroundRowTasks.code} as "code", 'background' as "source"
      from ${dispatcherBackgroundRowTasks}
      where ${inArray(dispatcherBackgroundRowTasks.weldJointId, idChunk)}
    `)
    taskRows.push(...result.rows)
  }
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
  } = {},
) {
  const includeJointWorkflowMetadata = options.includeJointWorkflowMetadata ?? true
  const dispatcherState = rows.length > 0 && includeJointWorkflowMetadata
    ? options.dispatcherState ?? await ensureDispatcherTaskIndexFresh()
    : null
  const [
    rowsWithDuplicateControls,
    rowsWithGeneratedDocuments,
    rowsWithDispatcherTasks,
    rowsWithHeatTreatmentControls,
    rowsWithEarlyCoilDecisions,
  ] = await Promise.all([
    attachDuplicateControlsToPage(rows),
    attachGeneratedDocumentFields(rows),
    attachDispatcherTaskCodesToPage(rows),
    attachHeatTreatmentControlRelations(rows),
    includeJointWorkflowMetadata ? attachEarlyCoilDecisionMetadataToPage(rows) : Promise.resolve(rows),
  ])
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

export async function attachEarlyCoilDecisionMetadataToPage<Row extends { id: number }>(rows: Row[]) {
  if (rows.length === 0) return rows as Array<Row & EarlyCoilDecisionMetadata>
  const ids = [...new Set(rows.map((row) => Number(row.id)).filter((id) => Number.isInteger(id) && id > 0))]
  if (ids.length === 0) return rows as Array<Row & EarlyCoilDecisionMetadata>
  const warnings: Array<{ key: string }> = []
  for (const idChunk of splitNumberBatches(ids, 1000)) {
    warnings.push(...await requireDb()
      .select({ key: dispatcherAcceptedWarnings.key })
      .from(dispatcherAcceptedWarnings)
      .where(and(
        eq(dispatcherAcceptedWarnings.kind, EARLY_COIL_DECISION_KIND),
        inArray(dispatcherAcceptedWarnings.key, idChunk.map(getEarlyCoilDecisionKey)),
      )))
  }
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

export function buildWeldReportPageFromRows(
  sourceRows: WeldJoint[],
  request: ReturnType<typeof normalizeWeldPageRequest>,
  report: WeldReportKind,
): WeldPageResult {
  const reportRows = buildServerReportRows(sourceRows, report)
  const filteredRows = sortReportRows(
    filterWeldRowsByColumns(reportRows, request.columnFilters),
    request.sort,
  )
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

export function buildServerReportRows<Row extends WeldInput & { id: number }>(sourceRows: Row[], report: WeldReportKind): WeldRow[] {
  if (report === 'weldingJournal') return sourceRows.map((row) => withControlBasisSummary(row, 'all')) as WeldRow[]
  const weldedRows = sourceRows.filter(hasWeldDate) as WeldRow[]
  if (report === 'heatTreatment') {
    return buildHeatTreatmentReportRows(weldedRows).map((row) => withControlBasisSummary(row, 'psto'))
  }
  return buildLnkReportRows(weldedRows).map((row) => withControlBasisSummary(row, 'lnk'))
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

export function withCurrentFinalStatuses(
  rows: WeldRow[],
  context: Awaited<ReturnType<typeof loadCurrentFinalStatusRowsContext>>,
) {
  return rows.map((row) => ({
    ...row,
    finalStatus: calculateFinalStatusInRows(row, rows, context),
  }))
}

export async function attachCurrentFinalStatuses(rows: WeldRow[]) {
  const [hydratedRows, context] = await Promise.all([
    attachHeatTreatmentControlRelations(await attachDuplicateControlsToPage(rows)),
    loadCurrentFinalStatusRowsContext(),
  ])
  return withCurrentFinalStatuses(hydratedRows, context)
}

export async function attachRkExposureSchemeFilterValuesIfNeeded<Row extends WeldRow>(
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

export async function loadServerRkExposureTable() {
  return (await loadServerOtherSettings()).rkExposureTable
}

export async function getFullReportRowsByIds(
  ids: number[],
  report: Exclude<WeldReportKind, 'weldingJournal'>,
  dispatcherState?: DispatcherTaskIndexState,
) {
  if (ids.length === 0) return []
  const db = requireDb()
  const rows = await loadWeldRowsByIdsInBatches(db, ids)
  const reportRows = buildServerReportRows(rows, report)
  const orderById = new Map(ids.map((id, index) => [id, index]))
  reportRows.sort(
    (left, right) =>
      (orderById.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
      (orderById.get(right.id) ?? Number.MAX_SAFE_INTEGER),
  )
  return compactWeldRowsForTransport(
    await attachReportPageMetadata(reportRows, { dispatcherState }),
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
  const rows: WeldRow[] = []
  for (const idBatch of splitNumberBatches(ids, 1000)) {
    rows.push(...await db
      .select(WELD_TABLE_SELECT)
      .from(weldJoints)
      .where(inArray(weldJoints.id, idBatch)))
  }
  return rows
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
  if (shouldEnsureDispatcherTaskIndexForColumnFilter(data.fieldKey, columnFilters)) {
    await ensureDispatcherTaskIndexFresh()
  }
  const currentWdiSettings = data.fieldKey === 'wdi' || Boolean(columnFilters.wdi?.trim())
    ? await loadServerOtherSettings()
    : null
  const useCurrentSystemWdi = Boolean(currentWdiSettings && isSystemWdiMode(currentWdiSettings))
  const sourceColumnFilters = getWeldColumnFilterOptionSourceFilters(columnFilters, useCurrentSystemWdi)
  const derivedColumnFilters = Object.fromEntries(
    Object.entries(columnFilters).filter(([key]) => !Object.hasOwn(sourceColumnFilters, key)),
  )
  const hasDerivedColumnFilters = Object.keys(derivedColumnFilters).length > 0
  if (data.report !== 'weldingJournal') {
    if (data.fieldKey === DISPATCHER_TASKS_FIELD_KEY && !hasDerivedColumnFilters) {
      return listDispatcherTaskColumnFilterOptions({ ...data, columnFilters })
    }
    const column = getWeldColumn(data.fieldKey)
    if (column && REPORT_SOURCE_COLUMN_FILTER_KEYS.has(data.fieldKey) && canPaginateReportSource(columnFilters) && !useCurrentSystemWdi) {
      return listSourceColumnFilterOptions(data.report, data.fieldKey, { ...data, columnFilters })
    }

    const where = and(
      buildReportKindWhere(data.report),
      buildReportSourceWhere({ ...data, columnFilters: sourceColumnFilters }),
    ) ?? sql`true`
    return getOrComputeDerivedCalculation(
      buildDerivedReportCacheKey(
        'report-column-options:v3',
        data.report,
        { ...data, columnFilters },
        { fieldKey: data.fieldKey },
      ),
      async () => {
        const sourceRows = await requireDb()
          .select(getReportDerivedFilterSelect(data.fieldKey))
          .from(weldJoints)
          .where(where)
          .orderBy(desc(weldJoints.weldDate), asc(weldJoints.line), asc(weldJoints.joint))
        const sourceRowsWithMetadata = data.fieldKey === DISPATCHER_TASKS_FIELD_KEY
          ? await attachReportPageMetadata(sourceRows, { includeJointWorkflowMetadata: false })
          : await attachHeatTreatmentControlRelations(
              await attachDuplicateControlsToPage(sourceRows),
            )
        const derivedRows = withCurrentFinalStatuses(
          buildServerReportRows(sourceRowsWithMetadata as unknown as WeldJoint[], data.report),
          await loadCurrentFinalStatusRowsContext(),
        )
        const currentRows = currentWdiSettings
          ? applyCurrentSystemWdi(derivedRows, currentWdiSettings)
          : derivedRows
        const reportRows = filterWeldRowsByColumns(
          await attachRkExposureSchemeFilterValuesIfNeeded(currentRows, columnFilters, data.fieldKey),
          columnFilters,
        )
        return buildWeldColumnFilterOptionsFromRows(reportRows, data.fieldKey)
      },
    )
  }

  const generatedDocumentType = GENERATED_DOCUMENT_FIELD_TYPES[data.fieldKey as keyof typeof GENERATED_DOCUMENT_FIELD_TYPES]
  const isDerivedField =
    data.fieldKey === CONTROL_BASIS_SUMMARY_FIELD_KEY ||
    data.fieldKey === 'finalStatus' ||
    data.fieldKey === 'rkExposureScheme' ||
    (data.fieldKey === 'wdi' && useCurrentSystemWdi)
  if (isDerivedField || hasDerivedColumnFilters) {
    const sourceRows = await requireDb()
      .select(WELD_TABLE_SELECT)
      .from(weldJoints)
      .where(buildWhere({ ...data, columnFilters: sourceColumnFilters }))
    const currentRows = buildServerReportRows(
      currentWdiSettings ? applyCurrentSystemWdi(sourceRows, currentWdiSettings) : sourceRows,
      'weldingJournal',
    )
    const rowsWithExposureScheme = await attachRkExposureSchemeFilterValuesIfNeeded(
      await attachCurrentFinalStatuses(currentRows),
      derivedColumnFilters,
      data.fieldKey,
    )
    const rowsWithMetadata = generatedDocumentType || data.fieldKey === 'finalStatus' || data.fieldKey === DISPATCHER_TASKS_FIELD_KEY
      ? await attachReportPageMetadata(rowsWithExposureScheme, { includeJointWorkflowMetadata: false })
      : rowsWithExposureScheme
    return buildWeldColumnFilterOptionsFromRows(
      filterWeldRowsByColumns(rowsWithMetadata, derivedColumnFilters),
      data.fieldKey,
    )
  }

  if (data.fieldKey === DISPATCHER_TASKS_FIELD_KEY) {
    return listDispatcherTaskColumnFilterOptions({ ...data, columnFilters })
  }
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

export async function listDispatcherTaskColumnFilterOptions(
  data: ReturnType<typeof normalizeWeldColumnFilterOptionsRequest>,
) {
  if (data.report === 'weldingJournal') {
    return listDispatcherTaskColumnFilterOptionsByWhere(buildWhere(data) ?? sql`true`)
  }

  const sourceWhere = and(
    buildReportKindWhere(data.report),
    buildReportSourceWhere(data),
  ) ?? sql`true`
  if (canPaginateReportSource(data.columnFilters)) {
    return listDispatcherTaskColumnFilterOptionsByWhere(sourceWhere)
  }

  const rowIds = await listDerivedReportRowIds(data.report, data, sourceWhere)
  return listDispatcherTaskColumnFilterOptionsByIds(rowIds)
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

export async function listDispatcherTaskColumnFilterOptionsByIds(rowIds: number[]) {
  const rowIdsByCode = new Map<string, Set<number>>()
  for (const ids of splitNumberBatches(rowIds, 1000)) {
    const [activeRows, backgroundRows] = await Promise.all([
      requireDb()
        .select({ rowId: dispatcherRowTasks.weldJointId, code: dispatcherRowTasks.code })
        .from(dispatcherRowTasks)
        .where(inArray(dispatcherRowTasks.weldJointId, ids)),
      requireDb()
        .select({ rowId: dispatcherBackgroundRowTasks.weldJointId, code: dispatcherBackgroundRowTasks.code })
        .from(dispatcherBackgroundRowTasks)
        .where(inArray(dispatcherBackgroundRowTasks.weldJointId, ids)),
    ])
    for (const row of [...activeRows, ...backgroundRows]) {
      const code = String(row.code ?? '').trim()
      if (!code) continue
      const matchingRowIds = rowIdsByCode.get(code) ?? new Set<number>()
      matchingRowIds.add(row.rowId)
      rowIdsByCode.set(code, matchingRowIds)
    }
  }

  return sortColumnFilterOptions(
    [...rowIdsByCode.entries()].map(([value, matchingRowIds]) => ({
      value,
      count: matchingRowIds.size,
      label: value,
    })),
  )
}

export async function listDerivedReportRowIds(
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
        .orderBy(...getReportOrderBy(report, filters.sort))
      const [sourceRowsWithControls, finalStatusContext, otherSettings] = await Promise.all([
        attachHeatTreatmentControlRelations(await attachDuplicateControlsToPage(sourceRows)),
        loadCurrentFinalStatusRowsContext(),
        loadServerOtherSettings(),
      ])
      const reportRows = applyCurrentSystemWdi(
        withCurrentFinalStatuses(
          buildServerReportRows(sourceRowsWithControls as unknown as WeldJoint[], report),
          finalStatusContext,
        ),
        otherSettings,
      )
      return filterWeldRowsByColumns(
        await attachRkExposureSchemeFilterValuesIfNeeded(reportRows, columnFilters),
        columnFilters,
      ).map((row) => row.id)
    },
  )
}

export async function listFinalStatusColumnFilterOptions(
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

export async function listGeneratedDocumentColumnFilterOptions(
  data: ReturnType<typeof normalizeWeldColumnFilterOptionsRequest>,
  documentType: string | readonly string[],
) {
  const documentTypes = Array.isArray(documentType) ? [...documentType] : [documentType]
  const typeWhere = documentTypes.length === 1
    ? eq(generatedDocuments.type, documentTypes[0])
    : inArray(generatedDocuments.type, documentTypes)
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
        typeWhere,
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

export async function listSourceColumnFilterOptions(
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
    materialGroups: Array.from(countSingleValueUsage(rows.map((row) => row.materialGroup))),
    testTypes: Array.from(countMultiValueUsage(rows.map((row) => row.testTypes), /[,;+]+/)),
  }
}

export function buildReportSourceWhere(filters: WeldFilters & { columnFilters?: Record<string, string> }) {
  const clauses: SQL[] = []
  addBaseFilterClauses(clauses, filters)
  addReportSourceColumnFilterClauses(clauses, filters.columnFilters ?? {})
  return clauses.length ? and(...clauses) : sql`true`
}

export function buildDerivedReportCacheKey(
  namespace: string,
  report: WeldReportKind,
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
    officiality: filters.officiality ?? '',
    finalStatus: filters.finalStatus ?? '',
    controlMethod: filters.controlMethod ?? '',
    columnFilters: filters.columnFilters ?? {},
    ...extra,
  })
}

export function buildReportKindWhere(report: Exclude<WeldReportKind, 'weldingJournal'>) {
  const hasWeldingDate = sql`${weldJoints.weldDate} is not null`
  if (report === 'heatTreatment') {
    return and(
      hasWeldingDate,
      or(
        buildControlReportValueWhere(weldJoints.pstoRequired),
        buildPstoExecutionHistoryWhere(),
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

export function buildPstoExecutionHistoryWhere() {
  const hasValue = (column: SQLWrapper) => sql`nullif(btrim(coalesce(${column}::text, '')), '') is not null`
  return or(
    sql`lower(btrim(coalesce(${weldJoints.pstoResult}, ''))) in ('проведено', 'проведено (отменен)', 'да')`,
    hasValue(weldJoints.pstoDate),
    hasValue(weldJoints.heatTreatmentDiagram),
    hasValue(weldJoints.tvmtRequest),
    hasValue(weldJoints.tvmtRequestDate),
    hasValue(weldJoints.tvmtResult),
    hasValue(weldJoints.tvmtConclusionDate),
    hasValue(weldJoints.tvmtConclusion),
    exists(
      SQL_QUERY_BUILDER
        .select({ value: sql`1` })
        .from(pstoRepeatCycles)
        .where(eq(pstoRepeatCycles.weldJointId, weldJoints.id)),
    ),
  ) ?? sql`false`
}

export function buildControlReportValueWhere(column: SQLWrapper) {
  return inArray(column, CONTROL_REPORT_VALUES)
}

export function buildEnabledControlValueWhere(column: SQLWrapper) {
  return inArray(column, ENABLED_CONTROL_REPORT_VALUES)
}

export function addReportSourceColumnFilterClauses(clauses: SQL[], columnFilters: Record<string, string>) {
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

export function getWeldColumnFilterOptionSourceFilters(
  columnFilters: Record<string, string>,
  useCurrentSystemWdi: boolean,
) {
  const derivedFieldKeys = [
    CONTROL_BASIS_SUMMARY_FIELD_KEY,
    'finalStatus',
    'rkExposureScheme',
    ...PRE_HEAT_TREATMENT_REPORT_FIELD_KEYS,
  ] as const
  const hasSystemWdiFilter = useCurrentSystemWdi && Boolean(columnFilters.wdi?.trim())
  const hasOtherDerivedFilter = derivedFieldKeys.some((fieldKey) => Boolean(columnFilters[fieldKey]?.trim()))
  if (!hasSystemWdiFilter && !hasOtherDerivedFilter) return columnFilters

  const sourceFilters = { ...columnFilters }
  if (hasSystemWdiFilter) delete sourceFilters.wdi
  for (const fieldKey of derivedFieldKeys) delete sourceFilters[fieldKey]
  return sourceFilters
}

export function shouldEnsureDispatcherTaskIndexForColumnFilter(
  fieldKey: WeldFieldKey,
  columnFilters: Record<string, string>,
) {
  return fieldKey === DISPATCHER_TASKS_FIELD_KEY || hasDispatcherTaskServerFilter(columnFilters)
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

export function sortColumnFilterOptions(options: WeldColumnFilterOption[]) {
  return [...options].sort((left, right) => {
    if (left.value === '') return -1
    if (right.value === '') return 1
    return left.label.localeCompare(right.label, 'ru', { numeric: true, sensitivity: 'base' })
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

export function getReportOrderBy(report: WeldReportKind, sort?: WeldSort) {
  const sortColumn = sort ? getWeldColumn(sort.fieldKey) : undefined
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

export function sortReportRows(rows: WeldRow[], sort?: WeldSort) {
  if (!sort) return rows
  const field = FIELD_BY_KEY.get(sort.fieldKey)
  if (!field) return rows
  const direction = sort.direction === 'desc' ? -1 : 1
  return [...rows].sort((left, right) => {
    const leftValue = left[sort.fieldKey]
    const rightValue = right[sort.fieldKey]
    const leftEmpty = leftValue === null || leftValue === undefined || String(leftValue).trim() === ''
    const rightEmpty = rightValue === null || rightValue === undefined || String(rightValue).trim() === ''
    if (leftEmpty || rightEmpty) {
      if (leftEmpty && rightEmpty) return left.id - right.id
      return leftEmpty ? 1 : -1
    }
    const comparison = field.kind === 'number'
      ? (Number(leftValue) || 0) - (Number(rightValue) || 0)
      : String(leftValue).localeCompare(String(rightValue), 'ru', { numeric: true, sensitivity: 'base' })
    return comparison === 0 ? left.id - right.id : comparison * direction
  })
}

export * from '@/server/weld-contracts'
