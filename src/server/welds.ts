import { createServerFn } from '@tanstack/react-start'
import { and, asc, count, desc, eq, exists, getTableColumns, gt, gte, ilike, inArray, isNull, lte, notExists, notInArray, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm'
import { requireDb } from '@/db'
import {
  appSettings,
  duplicateControls,
  dispatcherBackgroundRowTasks,
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
import {
  HEAT_TREATMENT_EDITABLE_FIELD_KEYS,
  HEAT_TREATMENT_HIDDEN_FIELD_KEYS,
  LNK_GENERATED_FIELD_KEYS,
  LNK_HIDDEN_FIELD_KEYS,
  LNK_METHODS,
  LNK_REPORT_FIELD_KEYS,
  PSTO_SECTION_FIELD_KEYS,
} from '@/lib/report-config'
import { LEGACY_CONTROL_REPLACEMENT_VALUE } from '@/lib/control-availability-values'
import { hasHeatTreatmentReportState, hasLnkReportEntry, withPendingLnkResults } from '@/lib/report-control-state'
import { hasWeldDate, isYesText, normalizeControlAvailabilityValue } from '@/lib/report-value-utils'
import {
  FIELD_BY_KEY,
  WELD_FIELDS,
  buildFinalStatusRowsContext,
  isVirtualWeldField,
  type WeldFieldKey,
  type WeldInput,
} from '@/lib/weld-fields'
import {
  canSuggestWeldFormField,
  getWeldFormSuggestionQueryFieldKeys,
  getWeldFormSuggestions,
  type WeldFormSuggestion,
} from '@/lib/weld-form-suggestions'
import { getWeldLineAutofillState, LINE_AUTOFILL_FIELD_KEYS, type WeldLineAutofillState } from '@/lib/weld-line-autofill'
import { normalizeWeldInput } from '@/lib/weld-import-export'
import type { WeldDraft, WeldRow } from '@/lib/dispatcher-types'
import type { DuplicateControlRecord } from '@/lib/duplicate-control-types'
import { parseWeldColumnChoiceFilter } from '@/lib/weld-column-choice-filter'
import {
  buildMergedDispatcherTaskCodes,
  DISPATCHER_TASK_FILTER_KEY,
  DISPATCHER_TASKS_FIELD_KEY,
  parseDispatcherTaskServerFilter,
} from '@/lib/dispatcher-task-row-codes'
import { filterWeldRowsByColumns, getWeldColumnFilterRowText } from '@/lib/weld-table-filtering'
import { buildHeatTreatmentReportRows, buildLnkReportRows } from '@/lib/report-row-utils'
import { getJointChainRows } from '@/lib/repeated-joint-row-utils'
import {
  PERCENTAGE_LINE_STAMP_FILTER_KEY,
  ROW_ID_LIST_FILTER_KEY,
  JOINT_CHAIN_FILTER_KEY,
  getJointChainFilterPattern,
  isHiddenReportFilterKey,
  parsePercentageLineStampFilter,
  parseRowIdListFilter,
  parseJointChainFilter,
} from '@/lib/report-hidden-filters'
import { attachGeneratedDocumentFields } from '@/server/generated-document-row-fields'
import {
  DEFAULT_OTHER_SETTINGS,
  normalizeOtherSettings,
  type OtherSettings,
  type RkExposureTableSettings,
} from '@/lib/other-settings'
import { PROJECT_SETTING_KEYS } from '@/lib/project-settings-remote'
import { getRkExposureSchemeState } from '@/lib/rk-exposure'
import { calculateWdi, isSystemWdiMode, withSystemWdi } from '@/lib/wdi'
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
import { DATA_IMPORT_SECURITY_SCOPE } from '@/lib/security-scopes'
import { buildDerivedCalculationCacheKey } from '@/lib/derived-calculation-cache-key'
import {
  getOrComputeDerivedCalculation,
} from '@/server/derived-calculation-cache'
import {
  loadPreviousWeldRows,
  loadServerWeldValidationContext,
  mergeWeldRecordsWithPrevious,
  prepareServerWeldRecords,
  validateServerWeldRecords,
} from '@/server/weld-save-validation'
import {
  assertUniqueWeldMutationTargets,
  assertWeldImportRowLimit,
  WELD_IMPORT_MAX_ROWS,
  splitWeldImportInsertBatches,
} from '@/lib/weld-import-limits'
import {
  assertExistingRowsImportPayload,
} from '@/lib/existing-row-import-validation'
import {
  isAuthorizedSystemRepeatedJointRename,
  type SystemRepeatedJointRenameRequest,
} from '@/lib/repeated-joint-system-rename'
import {
  DEFAULT_SYSTEM_INDEX_SETTINGS,
  normalizeSystemIndexSettings,
} from '@/lib/system-index-settings'
import {
  assertCurrentWeldRowVersions,
  type WeldRowVersionTarget,
} from '@/lib/weld-row-version'

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
export type WeldReportContextKind = Exclude<WeldReportKind, 'weldingJournal'>

export type WeldImportSecurityAction = 'newRecords' | 'massFill' | 'replaceData'

export function getWeldImportSecurityScope(_action: WeldImportSecurityAction) {
  return DATA_IMPORT_SECURITY_SCOPE
}

export type WeldPageResult = {
  rows: WeldRow[]
  total?: number
  acceptedWdiTotal?: number
  availableRequestCount?: number
  page: number
  pageSize: WeldPageSize
  hasMore: boolean
}

export type WeldImportScopeRequest = {
  columnFilters?: Record<string, string>
}

export type WeldImportScopeResult = {
  rows: WeldRow[]
  total: number
  limitExceeded: boolean
}

export type WeldColumnFilterOption = {
  value: string
  count: number
  label: string
}

export type WeldColumnFilterOptionsRequest = WeldPageRequest & {
  fieldKey: WeldFieldKey
}

export type WeldFormSuggestionsRequest = {
  fieldKey: WeldFieldKey
  draft: WeldInput
}

export type WeldLineAutofillRequest = {
  draft: WeldInput
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
  leadingLetterIndexedRowsCount: number
  weldingTypes: Array<[string, number]>
  connectionTypes: Array<[string, number]>
  materialGroups: Array<[string, number]>
  testTypes: Array<[string, number]>
}

type WeldDataUsageRow = {
  joint?: unknown
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
const ENABLED_CONTROL_REPORT_VALUES = ['да', 'Да', 'дополнительный', LEGACY_CONTROL_REPLACEMENT_VALUE] as const
const CONTROL_REPORT_VALUES = [...ENABLED_CONTROL_REPORT_VALUES, 'отменен'] as const
const SYSTEM_FIELD_KEYS = new Set([
  'id',
  'dispatcherTasks',
  'jsrDocument',
  'checklistDocument',
  'zniDocument',
  'rkExposureScheme',
  'createdAt',
  'weldingUpdatedAt',
  'pstoCreatedAt',
  'pstoUpdatedAt',
  'lnkCreatedAt',
  'lnkUpdatedAt',
  'updatedAt',
])
const LNK_PROFILE_FIELD_KEYS = new Set<WeldFieldKey>([
  ...LNK_METHODS.flatMap((method) => [
    method.enabledKey,
    method.requestKey,
    method.requestDateKey,
    method.resultKey,
    method.conclusionDateKey,
    method.conclusionKey,
  ]),
  ...[...LNK_REPORT_FIELD_KEYS].filter((fieldKey) => fieldKey !== 'lnkCreatedAt' && fieldKey !== 'lnkUpdatedAt'),
  'lnkDefectDescription',
  'rkExposureConfirmedDiameter',
  'lnkNote',
  'status',
])
const PSTO_PROFILE_FIELD_KEYS = new Set<WeldFieldKey>([
  'pstoRequired',
  'pstoRequest',
  'pstoRequestDate',
  'pstoDate',
  'pstoResult',
  'heatTreatmentDiagram',
  'pstoNote',
  'pstoBoq',
  'pstoKs3',
])
const NON_WELDING_LNK_FIELD_KEYS = new Set<WeldFieldKey>([
  ...LNK_PROFILE_FIELD_KEYS,
  ...LNK_METHODS.map((method) => method.enabledKey),
])
for (const method of LNK_METHODS) NON_WELDING_LNK_FIELD_KEYS.delete(method.enabledKey)
const NON_WELDING_PSTO_FIELD_KEYS = new Set(PSTO_PROFILE_FIELD_KEYS)
NON_WELDING_PSTO_FIELD_KEYS.delete('pstoRequired')
const WELDING_PROFILE_FIELD_KEYS = WELD_FIELDS
  .map((field) => field.key)
  .filter((fieldKey): fieldKey is WeldFieldKey =>
    !SYSTEM_FIELD_KEYS.has(fieldKey) &&
    !NON_WELDING_LNK_FIELD_KEYS.has(fieldKey) &&
    !NON_WELDING_PSTO_FIELD_KEYS.has(fieldKey) &&
    fieldKey !== 'finalStatus',
  )
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
const LNK_REPORT_CONTEXT_REQUIRED_FIELD_KEYS = new Set<WeldFieldKey>([
  ...LNK_REPORT_FIELD_KEYS,
  ...PSTO_SECTION_FIELD_KEYS,
  'rkExposureConfirmedDiameter',
])
const HEAT_TREATMENT_CONTEXT_REQUIRED_FIELD_KEYS = new Set<WeldFieldKey>([
  ...HEAT_TREATMENT_EDITABLE_FIELD_KEYS,
  ...LNK_METHODS.flatMap((method) => [
    method.enabledKey,
    method.requestKey,
    method.requestDateKey,
    method.resultKey,
    method.conclusionDateKey,
    method.conclusionKey,
  ]),
])
const WELD_BATCH_PROFILE_TIMESTAMP_KEYS = [
  'weldingUpdatedAt',
  'pstoCreatedAt',
  'pstoUpdatedAt',
  'lnkCreatedAt',
  'lnkUpdatedAt',
  'updatedAt',
] as const satisfies readonly (keyof NewWeldJoint)[]
const WELD_BATCH_UPDATE_FIELD_KEYS = [
  ...WELD_FIELDS
    .filter((field) => !isVirtualWeldField(field) && !SYSTEM_FIELD_KEYS.has(field.key))
    .map((field) => field.key),
  ...WELD_BATCH_PROFILE_TIMESTAMP_KEYS,
] as readonly (keyof NewWeldJoint)[]
const WELD_BATCH_UPDATE_COLUMNS = WELD_BATCH_UPDATE_FIELD_KEYS.map((fieldKey) => [
  fieldKey,
  WELD_TABLE_COLUMNS[fieldKey],
] as const)
const WELD_BATCH_UPDATE_SET = Object.fromEntries(
  WELD_BATCH_UPDATE_COLUMNS.map(([fieldKey, column]) => [fieldKey, sql.raw(`excluded."${column.name}"`)]),
) as Partial<Record<keyof NewWeldJoint, SQL>>
const WELD_IMPORT_SCOPE_SELECT = {
  ...WELD_TABLE_SELECT,
  rowVersion: sql<string>`xmin::text`.as('row_version'),
}
const REPORT_DERIVED_FILTER_SELECT = {
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
  status: weldJoints.status,
  finalStatus: weldJoints.finalStatus,
  pstoRequired: weldJoints.pstoRequired,
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
  'weldingUpdatedAt',
  'pstoCreatedAt',
  'pstoUpdatedAt',
  'lnkCreatedAt',
  'lnkUpdatedAt',
])

export const listWeldJointSnapshotPage = createServerFn({ method: 'GET' })
  .validator((data: WeldSnapshotPageRequest | undefined) => normalizeWeldSnapshotPageRequest(data))
  .handler(async ({ data }) => {
    await assertSecurityScope('entry')
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

export const listWeldReportContextRows = createServerFn({ method: 'GET' })
  .validator((data: { report: WeldReportContextKind }) => ({
    report: data?.report === 'heatTreatment' ? 'heatTreatment' : 'lnk',
  } as const))
  .handler(async ({ data }): Promise<WeldRow[]> => {
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
    return compactWeldRowsForTransport(await attachDuplicateControlsToPage(reportRows))
  })

export const listWeldFinalStatusContextKeys = createServerFn({ method: 'GET' })
  .handler(async (): Promise<string[]> => {
    await assertSecurityScope('entry')
    const rows = await requireDb()
      .select({
        id: weldJoints.id,
        projectTitle: weldJoints.projectTitle,
        subtitleCode: weldJoints.subtitleCode,
        line: weldJoints.line,
        joint: weldJoints.joint,
        status: weldJoints.status,
        vikResult: weldJoints.vikResult,
        rkResult: weldJoints.rkResult,
        uzkResult: weldJoints.uzkResult,
        pvkResult: weldJoints.pvkResult,
        tvmtResult: weldJoints.tvmtResult,
        rfaResult: weldJoints.rfaResult,
        stlsResult: weldJoints.stlsResult,
        mkkResult: weldJoints.mkkResult,
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
      .where(eq(weldJoints.status, 'неофициальный'))
    const context = buildFinalStatusRowsContext(
      rows.map(({ rejectedDuplicateMethod, ...row }) => rejectedDuplicateMethod
        ? {
            ...row,
            duplicateControls: [{
              id: 0,
              weldJointId: row.id,
              method: rejectedDuplicateMethod,
              result: 'ремонт',
              controlDate: '',
              conclusion: '',
              conclusionDate: '',
            }],
          }
        : row) as WeldRow[],
    )
    return [...context.rejectedUnofficialSameNameRepairKeys]
  })

export const listWeldFormSuggestions = createServerFn({ method: 'POST' })
  .validator((data: WeldFormSuggestionsRequest) => ({
    fieldKey: data?.fieldKey,
    draft: data?.draft ?? {},
  }))
  .handler(async ({ data }): Promise<WeldFormSuggestion[]> => {
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
  })

export const getWeldLineAutofill = createServerFn({ method: 'POST' })
  .validator((data: WeldLineAutofillRequest) => ({ draft: data?.draft ?? {} }))
  .handler(async ({ data }): Promise<WeldLineAutofillState> => {
    await assertSecurityScope('entry')
    const line = String(data.draft.line ?? '').trim()
    if (!line) return getWeldLineAutofillState(data.draft, [])
    const selectedFieldKeys = [
      'id',
      'line',
      'projectTitle',
      'subtitleCode',
      ...LINE_AUTOFILL_FIELD_KEYS,
    ] as const
    const selectedColumns = Object.fromEntries(
      [...new Set(selectedFieldKeys)]
        .map((fieldKey) => [fieldKey, getWeldColumn(fieldKey)] as const)
        .filter((entry): entry is [WeldFieldKey, NonNullable<ReturnType<typeof getWeldColumn>>] => Boolean(entry[1])),
    )
    const rows = await requireDb()
      .select(selectedColumns)
      .from(weldJoints)
      .where(normalizedTextEquals(weldJoints.line, line))
    return getWeldLineAutofillState(data.draft, rows as WeldInput[])
  })

export const listWeldJointChain = createServerFn({ method: 'GET' })
  .validator((data: { id: number }) => data)
  .handler(async ({ data }): Promise<WeldJointChainResult> => {
    await assertSecurityScope('entry')
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

    return {
      record: weldRecord,
      rows: getJointChainRows(weldCandidates, weldRecord, systemIndexSettings),
    }
  })

export const getWeldJointById = createServerFn({ method: 'GET' })
  .validator((data: { id: number }) => ({ id: Math.max(0, Math.floor(Number(data?.id) || 0)) }))
  .handler(async ({ data }): Promise<WeldRow | null> => {
    await assertSecurityScope('entry')
    if (!data.id) return null
    const db = requireDb()
    const [record] = await db.select().from(weldJoints).where(eq(weldJoints.id, data.id)).limit(1)
    if (!record) return null
    const [recordWithDuplicateControls] = await attachGeneratedDocumentFields(
      await attachDuplicateControlsToPage(
        applyCurrentSystemWdi([record], await loadServerOtherSettings()),
      ),
    )
    return recordWithDuplicateControls as unknown as WeldRow
  })

export const listWeldingJournalPage = createServerFn({ method: 'GET' })
  .validator((data: WeldPageRequest | undefined) => normalizeWeldPageRequest(data))
  .handler(async ({ data }): Promise<WeldPageResult> => {
    await assertSecurityScope('entry')
    return listReportPage('weldingJournal', data)
  })

export const listLnkReportPage = createServerFn({ method: 'GET' })
  .validator((data: WeldPageRequest | undefined) => normalizeWeldPageRequest(data))
  .handler(async ({ data }): Promise<WeldPageResult> => {
    await assertSecurityScope('entry')
    return listReportPage('lnk', data)
  })

export const listHeatTreatmentReportPage = createServerFn({ method: 'GET' })
  .validator((data: WeldPageRequest | undefined) => normalizeWeldPageRequest(data))
  .handler(async ({ data }): Promise<WeldPageResult> => {
    await assertSecurityScope('entry')
    return listReportPage('heatTreatment', data)
  })

export const listWeldingJournalImportScope = createServerFn({ method: 'GET' })
  .validator((data: WeldImportScopeRequest | undefined) => normalizeWeldImportScopeRequest(data))
  .handler(async ({ data }): Promise<WeldImportScopeResult> => {
    await assertSecurityScope('entry')
    if (hasDispatcherTaskServerFilter(data.columnFilters)) await ensureDispatcherTaskIndexFresh()
    const db = requireDb()
    const otherSettings = await loadServerOtherSettings()
    const hasCurrentSystemWdiFilter = isSystemWdiMode(otherSettings) && Boolean(data.columnFilters.wdi?.trim())
    const sourceFilterData = hasCurrentSystemWdiFilter
      ? { ...data, columnFilters: getColumnFilterOptionFilters(data.columnFilters, 'wdi') }
      : data
    const where = buildWhere(sourceFilterData)

    if (hasCurrentSystemWdiFilter) {
      const sourceRows = await db
        .select(WELD_IMPORT_SCOPE_SELECT)
        .from(weldJoints)
        .where(where)
        .orderBy(...WELDING_JOURNAL_ORDER_BY)
      const rows = filterWeldRowsByColumns(
        applyCurrentSystemWdi(sourceRows, otherSettings),
        { wdi: data.columnFilters.wdi },
      )
      return rows.length > WELD_IMPORT_MAX_ROWS
        ? { rows: [], total: rows.length, limitExceeded: true }
        : { rows: compactWeldRowsForTransport(rows), total: rows.length, limitExceeded: false }
    }

    const [{ total }] = await db.select({ total: count() }).from(weldJoints).where(where)
    const normalizedTotal = Number(total) || 0

    if (normalizedTotal > WELD_IMPORT_MAX_ROWS) {
      return { rows: [], total: normalizedTotal, limitExceeded: true }
    }

    const rows = await db
      .select(WELD_IMPORT_SCOPE_SELECT)
      .from(weldJoints)
      .where(where)
      .orderBy(...WELDING_JOURNAL_ORDER_BY)

    return {
      rows: compactWeldRowsForTransport(rows),
      total: normalizedTotal,
      limitExceeded: false,
    }
  })

export const listWeldColumnFilterOptions = createServerFn({ method: 'GET' })
  .validator((data: WeldColumnFilterOptionsRequest | undefined) => normalizeWeldColumnFilterOptionsRequest(data))
  .handler(async ({ data }): Promise<WeldColumnFilterOption[]> => {
    await assertSecurityScope('entry')
    return listColumnFilterOptions(data)
  })

export const getDocumentGenerationData = createServerFn({ method: 'POST' })
  .validator((data: DocumentGenerationDataRequest | undefined) => normalizeDocumentGenerationDataRequest(data))
  .handler(async ({ data }): Promise<DocumentGenerationDataResult> => {
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
            applyCurrentSystemWdi(rows, await loadServerOtherSettings()),
          ),
        ),
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
  const db = requireDb()
  const [, otherSettings] = await Promise.all([
    ensureDispatcherTaskIndexFresh(),
    loadServerOtherSettings(),
  ])
  const hasCurrentSystemWdiFilter = isSystemWdiMode(otherSettings) && Boolean(data.columnFilters.wdi?.trim())
  const sourceFilterData = hasCurrentSystemWdiFilter
    ? { ...data, columnFilters: getColumnFilterOptionFilters(data.columnFilters, 'wdi') }
    : data
  if (report !== 'weldingJournal') {
    const where = and(buildReportKindWhere(report), buildReportSourceWhere(sourceFilterData)) ?? sql`true`
    if (canPaginateReportSource(data.columnFilters) && !hasCurrentSystemWdiFilter) {
      const query = db
        .select()
        .from(weldJoints)
        .where(where)
        .orderBy(...getReportOrderBy(report))
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
        await attachReportPageMetadata(reportRows),
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
    const rows = applyCurrentSystemWdi(await getFullReportRowsByIds(pageIds, report), otherSettings)

    return {
      rows,
      total,
      availableRequestCount,
      page: data.page,
      pageSize: data.pageSize,
      hasMore: data.pageSize !== WELD_PAGE_ALL_SIZE && data.page * data.pageSize < total,
    }
  }

  if (hasCurrentSystemWdiFilter) {
    const currentRows = applyCurrentSystemWdi(
      await db
        .select(WELD_TABLE_SELECT)
        .from(weldJoints)
        .where(buildWhere(sourceFilterData))
        .orderBy(...WELDING_JOURNAL_ORDER_BY),
      otherSettings,
    )
    const filteredRows = filterWeldRowsByColumns(currentRows, { wdi: data.columnFilters.wdi })
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
      await attachReportPageMetadata(pageRows),
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
    .orderBy(...WELDING_JOURNAL_ORDER_BY)

  const shouldCount = data.page === 1 && data.pageSize !== WELD_PAGE_ALL_SIZE
  const countQuery = shouldCount
    ? db.select({ total: count() }).from(weldJoints).where(where)
    : Promise.resolve([])
  const acceptedWdiRowsQuery = data.page === 1
    ? db
        .select({
          connectionType: weldJoints.connectionType,
          d1: weldJoints.d1,
          d2: weldJoints.d2,
          t1: weldJoints.t1,
          t2: weldJoints.t2,
          wdi: weldJoints.wdi,
        })
        .from(weldJoints)
        .where(
          and(
            where,
            eq(weldJoints.finalStatus, 'годен'),
          ),
        )
    : Promise.resolve([])
  const fetchExtraRow = data.page > 1 && data.pageSize !== WELD_PAGE_ALL_SIZE
  const rowsQuery =
    data.pageSize === WELD_PAGE_ALL_SIZE
      ? query
      : query.limit(data.pageSize + (fetchExtraRow ? 1 : 0)).offset((data.page - 1) * data.pageSize)
  const [[countRow], acceptedWdiRows, fetchedRows] = await Promise.all([countQuery, acceptedWdiRowsQuery, rowsQuery])
  const rows = fetchExtraRow ? fetchedRows.slice(0, data.pageSize as number) : fetchedRows
  const total = data.pageSize === WELD_PAGE_ALL_SIZE
    ? rows.length
    : countRow
      ? Number(countRow.total) || 0
      : undefined
  const acceptedWdiTotal = acceptedWdiRows.reduce(
    (sum, row) => sum + (calculateWdi(row, otherSettings) ?? 0),
    0,
  )
  const rowsWithMetadata = compactWeldRowsForTransport(
    await attachReportPageMetadata(applyCurrentSystemWdi(rows, otherSettings)),
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

async function countAvailableLnkRequestRows(where: SQL) {
  const [{ total }] = await requireDb()
    .select({ total: count() })
    .from(weldJoints)
    .where(and(where, buildAvailableLnkRequestWhere()))
  return Number(total) || 0
}

async function countAvailableLnkRequestRowsByIds(ids: number[]) {
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

function buildAvailableLnkRequestWhere() {
  const hasAvailableMethod = or(
    ...LNK_METHODS.map((method) => {
      const enabledColumn = getWeldColumn(method.enabledKey)
      const requestColumn = getWeldColumn(method.requestKey)
      if (!enabledColumn || !requestColumn) return sql`false`
      return and(
        buildEnabledControlValueWhere(enabledColumn),
        sql`btrim(coalesce(${requestColumn}::text, '')) = ''`,
      ) ?? sql`false`
    }),
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
    requireDb()
      .select({ value: sql`1` })
      .from(duplicateControls)
      .where(
        and(
          eq(duplicateControls.weldJointId, weldJoints.id),
          inArray(duplicateControls.result, ['ремонт', 'вырез']),
        ),
      ),
  )
  return and(hasAvailableMethod, hasNoRejectedResult, hasNoRejectedDuplicate) ?? sql`false`
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
  const result = await requireDb().execute<DispatcherTaskCodeRow & { source: 'active' | 'background' }>(sql`
    select ${dispatcherRowTasks.weldJointId} as "rowId", ${dispatcherRowTasks.code} as "code", 'active' as "source"
    from ${dispatcherRowTasks}
    where ${inArray(dispatcherRowTasks.weldJointId, ids)}
    union all
    select ${dispatcherBackgroundRowTasks.weldJointId} as "rowId", ${dispatcherBackgroundRowTasks.code} as "code", 'background' as "source"
    from ${dispatcherBackgroundRowTasks}
    where ${inArray(dispatcherBackgroundRowTasks.weldJointId, ids)}
  `)
  const activeTaskRows = result.rows.filter((row) => row.source === 'active')
  const backgroundTaskRows = result.rows.filter((row) => row.source === 'background')
  return mergeDispatcherTaskCodesIntoRows(rows, activeTaskRows, backgroundTaskRows)
}

async function attachReportPageMetadata<Row extends DuplicateControlCarrier>(rows: Row[]) {
  const [rowsWithDuplicateControls, rowsWithGeneratedDocuments, rowsWithDispatcherTasks] = await Promise.all([
    attachDuplicateControlsToPage(rows),
    attachGeneratedDocumentFields(rows),
    attachDispatcherTaskCodesToPage(rows),
  ])
  return rows.map((row, index) => ({
    ...row,
    ...rowsWithDuplicateControls[index],
    ...rowsWithGeneratedDocuments[index],
    ...rowsWithDispatcherTasks[index],
  }))
}

type DispatcherTaskCodeRow = { rowId: number; code: string }

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
  return (await loadServerOtherSettings()).rkExposureTable
}

async function loadServerOtherSettings() {
  const [storedSettings] = await requireDb()
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, PROJECT_SETTING_KEYS.other))
    .limit(1)
  if (!storedSettings) return DEFAULT_OTHER_SETTINGS

  try {
    return normalizeOtherSettings(JSON.parse(storedSettings.value))
  } catch {
    return DEFAULT_OTHER_SETTINGS
  }
}

function applyCurrentSystemWdi<Row extends WeldInput>(rows: Row[], settings: OtherSettings): Row[] {
  return isSystemWdiMode(settings) ? rows.map((row) => withSystemWdi(row, settings)) : rows
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
    await attachReportPageMetadata(reportRows),
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
      const [created] = await tx.insert(weldJoints).values(toDbInsert(data, true)).returning()
      await syncSystemDocumentsForWeldChangesInTransaction(tx, [created], new Map())
      await markDispatcherTaskIndexDirty(tx, { scopes: getDispatcherDirtyScopes([data], new Map()) })
      return created
    })
  })

export const updateWeldJoint = createServerFn({ method: 'POST' })
  .validator((data: WeldPayload) => data)
  .handler(async ({ data }) => updateWeldJointRecord(data, false))

export const updateSystemWeldJoint = createServerFn({ method: 'POST' })
  .validator((data: SystemRepeatedJointRenameRequest) => ({
    id: Number(data.id),
    currentJoint: String(data.currentJoint ?? '').trim(),
    targetJoint: String(data.targetJoint ?? '').trim(),
  }))
  .handler(async ({ data }) => {
    await assertSecurityScope('edit')
    if (!Number.isInteger(data.id) || data.id <= 0 || !data.currentJoint || !data.targetJoint) {
      throw new Error('Некорректные данные системного переименования стыка.')
    }
    const db = requireDb()
    return db.transaction(async (tx) => {
      const [previous] = await tx.select().from(weldJoints).where(eq(weldJoints.id, data.id)).limit(1)
      if (!previous) throw new Error('Стык для переименования не найден.')
      if (String(previous.joint ?? '').trim().toUpperCase() !== data.currentJoint.toUpperCase()) {
        throw new Error('Название стыка уже изменилось. Обновите диспетчер задач.')
      }

      const projectClause = previous.projectTitle === null
        ? or(isNull(weldJoints.projectTitle), eq(weldJoints.projectTitle, ''))!
        : eq(weldJoints.projectTitle, previous.projectTitle)
      const subtitleClause = previous.subtitleCode === null
        ? or(isNull(weldJoints.subtitleCode), eq(weldJoints.subtitleCode, ''))!
        : eq(weldJoints.subtitleCode, previous.subtitleCode)
      const lineClause = previous.line === null
        ? or(isNull(weldJoints.line), eq(weldJoints.line, ''))!
        : eq(weldJoints.line, previous.line)
      const rows = await tx
        .select()
        .from(weldJoints)
        .where(and(projectClause, subtitleClause, lineClause))
      const validationContext = await loadServerWeldValidationContext(tx)
      if (!isAuthorizedSystemRepeatedJointRename(
        rows as WeldRow[],
        data,
        validationContext.systemIndexSettings,
      )) {
        throw new Error('Системное переименование больше не соответствует текущим правилам цепочки.')
      }

      const record = { ...previous, joint: data.targetJoint }
      validateServerWeldRecords({
        records: [record],
        previousRows: new Map([[previous.id, previous]]),
        context: validationContext,
        allowSystemJointNames: true,
      })
      const [updated] = await tx
        .update(weldJoints)
        .set({ joint: data.targetJoint, weldingUpdatedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(weldJoints.id, data.id), eq(weldJoints.joint, data.currentJoint)))
        .returning()
      if (!updated) throw new Error('Название стыка уже изменилось. Обновите диспетчер задач.')
      await syncSystemDocumentsForWeldChangesInTransaction(
        tx,
        [updated],
        new Map([[previous.id, previous]]),
      )
      await markDispatcherTaskIndexDirty(tx, {
        scopes: getDispatcherDirtyScopes([record], new Map([[previous.id, previous]])),
      })
      return updated
    })
  })

async function updateWeldJointRecord(data: WeldPayload, allowSystemJointNames: boolean) {
  await assertSecurityScope('edit')
  if (!data.id) throw new Error('Не передан id записи')
  const id = data.id
  const db = requireDb()

  return db.transaction(async (tx) => {
    const previousRows = await loadPreviousWeldRows(tx, [data])
    if (!previousRows.has(id)) throw new Error(`Запись ${id} не найдена`)
    const [record] = mergeWeldRecordsWithPrevious([data], previousRows)
    const validationContext = await loadServerWeldValidationContext(tx)
    prepareServerWeldRecords({ records: [record], previousRows, context: validationContext })
    validateServerWeldRecords({
      records: [record],
      previousRows,
      context: validationContext,
      allowSystemJointNames,
    })
    const insertData = toDbInsert(record)
    const timestampUpdates = getProfileTimestampUpdates(record, previousRows.get(id), new Date())
    const [updated] = await tx
      .update(weldJoints)
      .set({ ...insertData, ...timestampUpdates, updatedAt: new Date() })
      .where(eq(weldJoints.id, id))
      .returning()
    if (!updated) throw new Error(`Запись ${id} не найдена`)
    await syncSystemDocumentsForWeldChangesInTransaction(tx, [updated], previousRows)
    await markDispatcherTaskIndexDirty(tx, { scopes: getDispatcherDirtyScopes([record], previousRows) })
    return updated
  })
}

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
        allowSystemJointNames: true,
      })
      const created = await insertWeldJointsInBatches(tx, data.records)
      await syncSystemDocumentsForWeldChangesInTransaction(tx, created, new Map())
      await markDispatcherTaskIndexDirty(tx, { scopes: getDispatcherDirtyScopes(data.records, new Map()) })
      return created
    })
  })

type WeldBatchUpdateData = {
  records: WeldPayload[]
  systemDocumentSequence?: SystemDocumentSequenceUpdate
}

async function updateWeldJointRows(data: WeldBatchUpdateData, importMode = false) {
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
      if (importMode) {
        assertExistingRowsImportPayload({
          records,
          previousRows,
          mode: 'massFill',
          otherSettings: validationContext.otherSettings,
        })
      }
      records = mergeWeldRecordsWithPrevious(records, previousRows)
      prepareServerWeldRecords({
        records,
        previousRows,
        context: validationContext,
        importMode,
      })
      validateServerWeldRecords({
        records,
        previousRows,
        context: validationContext,
        importMode,
      })
      const updated = await updateWeldJointsInBatches(tx, records, previousRows)
      await syncSystemDocumentsForWeldChangesInTransaction(tx, updated, previousRows)
      await markDispatcherTaskIndexDirty(tx, { scopes: getDispatcherDirtyScopes(records, previousRows) })
      return updated
    })
}

export const updateWeldJoints = createServerFn({ method: 'POST' })
  .validator((data: WeldBatchUpdateData) => data)
  .handler(async ({ data }) => {
    await assertSecurityScope('edit')
    return updateWeldJointRows(data)
  })

export const massFillWeldJoints = createServerFn({ method: 'POST' })
  .validator((data: { records: WeldPayload[] }) => data)
  .handler(async ({ data }) => {
    await assertSecurityScope(getWeldImportSecurityScope('massFill'))
    assertWeldImportRowLimit(data.records.length)
    const updated = await updateWeldJointRows(data, true)
    return updated.map((row) => ({ id: row.id }))
  })

export const replaceWeldJoints = createServerFn({ method: 'POST' })
  .validator((data: { records: WeldPayload[]; deleteIds: number[]; expectedVersions: WeldRowVersionTarget[] }) => ({
    records: Array.isArray(data?.records) ? data.records : [],
    deleteIds: [...new Set((data?.deleteIds ?? [])
      .map(Number)
      .filter((id) => Number.isInteger(id) && id > 0))],
    expectedVersions: Array.isArray(data?.expectedVersions)
      ? data.expectedVersions.map((entry) => ({
          id: Number(entry?.id),
          version: String(entry?.version ?? '').trim(),
        }))
      : [],
  }))
  .handler(async ({ data }) => {
    await assertSecurityScope(getWeldImportSecurityScope('replaceData'))
    assertWeldImportRowLimit(data.records.length + data.deleteIds.length)
    const db = requireDb()
    return db.transaction(async (tx) => {
      if (data.records.some((record) => !record.id)) {
        throw new Error('Не передан id одной из заменяемых записей')
      }
      assertUniqueWeldMutationTargets(data.records, data.deleteIds)
      const targetIds = [
        ...data.records.map((record) => Number(record.id)),
        ...data.deleteIds,
      ].sort((left, right) => left - right)
      await lockAndAssertWeldRowVersions(tx, targetIds, data.expectedVersions)

      const previousRows = await loadPreviousWeldRows(tx, data.records)
      const deletedRows = data.deleteIds.length > 0
        ? await tx.select().from(weldJoints).where(inArray(weldJoints.id, data.deleteIds))
        : []
      if (deletedRows.length !== data.deleteIds.length) {
        throw new Error('Одна или несколько удаляемых записей больше не существуют. Скачайте свежий шаблон.')
      }
      const deletedRowsById = new Map(deletedRows.map((row) => [row.id, row]))
      let records = data.records

      if (records.length > 0) {
        const validationContext = await loadServerWeldValidationContext(tx)
        assertExistingRowsImportPayload({
          records,
          previousRows,
          mode: 'replaceData',
          otherSettings: validationContext.otherSettings,
        })
        records = mergeWeldRecordsWithPrevious(records, previousRows)
        prepareServerWeldRecords({
          records,
          previousRows,
          context: validationContext,
          importMode: true,
        })
        validateServerWeldRecords({
          records,
          previousRows,
          context: validationContext,
          importMode: true,
        })
      }

      const updated = await updateWeldJointsInBatches(tx, records, previousRows)

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
        records,
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

async function lockAndAssertWeldRowVersions(
  tx: SystemDocumentSequenceTransaction,
  targetIds: readonly number[],
  expectedVersions: readonly WeldRowVersionTarget[],
) {
  const currentVersions = targetIds.length > 0
    ? await tx
        .select({
          id: weldJoints.id,
          line: weldJoints.line,
          joint: weldJoints.joint,
          version: sql<string>`xmin::text`.as('row_version'),
        })
        .from(weldJoints)
        .where(inArray(weldJoints.id, [...targetIds]))
        .orderBy(asc(weldJoints.id))
        .for('update')
    : []

  assertCurrentWeldRowVersions({
    targetIds,
    expectedVersions,
    currentVersions,
  })
}

export const listWeldJointRowsByIds = createServerFn({ method: 'POST' })
  .validator((data: WeldRowsByIdsRequest) => ({
    ids: Array.from(new Set((data?.ids ?? []).map(Number).filter(Number.isFinite))),
  }))
  .handler(async ({ data }): Promise<WeldRow[]> => {
    await assertSecurityScope('entry')
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
      await attachGeneratedDocumentFields(
        await attachDuplicateControlsToPage(
          applyCurrentSystemWdi(rows, await loadServerOtherSettings()),
        ),
      ),
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

export const deleteWeldJoints = createServerFn({ method: 'POST' })
  .validator((data: { ids: number[] }) => ({
    ids: [...new Set((data?.ids ?? []).map(Number).filter((id) => Number.isInteger(id) && id > 0))],
  }))
  .handler(async ({ data }) => {
    await assertSecurityScope('delete')
    if (data.ids.length === 0) return { deleted: 0 }
    const db = requireDb()
    return db.transaction(async (tx) => {
      const previousRows = (
        await Promise.all(
          splitNumberBatches(data.ids, 1000).map((ids) =>
            tx.select().from(weldJoints).where(inArray(weldJoints.id, ids)),
          ),
        )
      ).flat()
      if (previousRows.length !== data.ids.length) {
        const foundIds = new Set(previousRows.map((row) => row.id))
        const missingIds = data.ids.filter((id) => !foundIds.has(id))
        throw new Error(`Не найдены стыки: ${missingIds.join(', ')}`)
      }

      for (const ids of splitNumberBatches(data.ids, 1000)) {
        await tx.delete(weldJoints).where(inArray(weldJoints.id, ids))
      }
      const previousRowsById = new Map(previousRows.map((row) => [row.id, row]))
      await syncSystemDocumentsForWeldChangesInTransaction(tx, [], previousRowsById)
      await deleteEmptyGeneratedDocuments(tx)
      await markDispatcherTaskIndexDirty(tx, {
        scopes: getDispatcherDirtyScopes([], previousRowsById),
      })
      return { deleted: previousRows.length }
    })
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
    await assertSecurityScope(getWeldImportSecurityScope('newRecords'))
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
  return db.transaction(async (tx) => {
    const updatedRows = []
    const batchSize = 1000
    let lastProcessedId = 0
    while (true) {
      const rows = await tx
        .select()
        .from(weldJoints)
        .where(gt(weldJoints.id, lastProcessedId))
        .orderBy(asc(weldJoints.id))
        .limit(batchSize)
      if (rows.length === 0) break

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
        const now = new Date()
        const [updated] = await tx
          .update(weldJoints)
          .set({
            ...updateData,
            finalStatus,
            lnkCreatedAt: sql`coalesce(${weldJoints.lnkCreatedAt}, ${now})`,
            lnkUpdatedAt: now,
            updatedAt: now,
          })
          .where(eq(weldJoints.id, row.id))
          .returning()
        if (updated) changedRows.push(updated)
      }
      if (changedRows.length > 0) {
        await syncSystemDocumentsForWeldChangesInTransaction(tx, changedRows, previousRows)
      }
      updatedRows.push(...changedRows)
      lastProcessedId = rows[rows.length - 1].id
    }
    if (updatedRows.length > 0) await markDispatcherTaskIndexDirty(tx)
    return updatedRows
  })
})

function splitNumberBatches(values: readonly number[], batchSize: number) {
  return Array.from({ length: Math.ceil(values.length / batchSize) }, (_, index) =>
    values.slice(index * batchSize, (index + 1) * batchSize),
  )
}

function parseStoredJson(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

function toDbInsert(input: WeldInput, isCreate = false): NewWeldJoint {
  const normalized = prepareServerWeldInput(normalizeWeldInput(input))
  const data: Record<string, unknown> = {}

  for (const field of WELD_FIELDS) {
    if (SYSTEM_FIELD_KEYS.has(field.key)) continue
    if (field.kind === 'boolean') {
      data[field.key] = normalizeControlAvailabilityValue(normalized[field.key])
      continue
    }
    data[field.key] = normalized[field.key] ?? null
  }
  if (isCreate) {
    const now = new Date()
    data.weldingUpdatedAt = now
    if (hasPstoReportEntry(normalized)) {
      data.pstoCreatedAt = now
      data.pstoUpdatedAt = now
    }
    if (hasLnkReportEntry(normalized)) {
      data.lnkCreatedAt = now
      data.lnkUpdatedAt = now
    }
  }

  return data as NewWeldJoint
}

export function getProfileTimestampUpdates(
  record: WeldInput,
  previous: WeldJoint | undefined,
  now: Date,
): Partial<NewWeldJoint> {
  const lnkTouched = hasProfileChanged(record, previous, LNK_PROFILE_FIELD_KEYS)
  const pstoTouched = hasProfileChanged(record, previous, PSTO_PROFILE_FIELD_KEYS)
  const weldingTouched = hasProfileChanged(record, previous, WELDING_PROFILE_FIELD_KEYS)
  const lnkEntered = !hasLnkReportEntry(previous ?? {}) && hasLnkReportEntry(record)
  const pstoEntered = !hasPstoReportEntry(previous ?? {}) && hasPstoReportEntry(record)
  const updates: Partial<NewWeldJoint> = {}

  if (weldingTouched) updates.weldingUpdatedAt = now
  if (lnkTouched || lnkEntered) {
    if (!previous?.lnkCreatedAt && (lnkEntered || hasLnkReportEntry(previous ?? {}))) updates.lnkCreatedAt = now
    updates.lnkUpdatedAt = now
  }
  if (pstoTouched || pstoEntered) {
    if (!previous?.pstoCreatedAt && (pstoEntered || hasPstoReportEntry(previous ?? {}))) updates.pstoCreatedAt = now
    updates.pstoUpdatedAt = now
  }

  return updates
}

function hasPstoReportEntry(record: WeldInput) {
  return hasWeldDate(record) && hasHeatTreatmentReportState(record)
}

function hasProfileChanged(
  record: WeldInput,
  previous: WeldJoint | undefined,
  fieldKeys: ReadonlySet<WeldFieldKey> | readonly WeldFieldKey[],
) {
  if (!previous) return true
  return [...fieldKeys].some(
    (fieldKey) => normalizeProfileValue(record[fieldKey]) !== normalizeProfileValue(previous[fieldKey as keyof WeldJoint]),
  )
}

function normalizeProfileValue(value: unknown) {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  return String(value).trim()
}

async function insertWeldJointsInBatches(
  tx: SystemDocumentSequenceTransaction,
  records: readonly WeldInput[],
) {
  const inserted: WeldJoint[] = []
  for (const batch of splitWeldImportInsertBatches(records)) {
    const rows = await tx.insert(weldJoints).values(batch.map((record) => toDbInsert(record, true))).returning()
    inserted.push(...rows)
  }
  return inserted
}

export async function updateWeldJointsInBatches(
  tx: SystemDocumentSequenceTransaction,
  records: readonly WeldInput[],
  previousRows: ReadonlyMap<number, WeldJoint>,
) {
  if (records.length === 0) return []
  const now = new Date()
  const payloads = records.map((record) => buildWeldBatchUpdatePayload(record, previousRows, now))
  const ids = records.map((record) => Number(record.id))
  const lockedRows = await tx
    .select({ id: weldJoints.id })
    .from(weldJoints)
    .where(inArray(weldJoints.id, ids))
    .for('update')
  if (lockedRows.length !== ids.length) {
    throw new Error('Одна или несколько обновляемых записей больше не существуют.')
  }
  const updatedRows: WeldJoint[] = []

  for (const batch of splitWeldImportInsertBatches(payloads)) {
    const rows = await tx
      .insert(weldJoints)
      .values(batch)
      .onConflictDoUpdate({ target: weldJoints.id, set: WELD_BATCH_UPDATE_SET })
      .returning()
    if (rows.length !== batch.length) {
      throw new Error('Одна или несколько обновляемых записей больше не существуют.')
    }
    updatedRows.push(...rows)
  }

  const updatedRowsById = new Map(updatedRows.map((row) => [row.id, row]))
  return ids.map((id) => {
    const row = updatedRowsById.get(id)
    if (!row) throw new Error(`Запись ${id} не найдена`)
    return row
  })
}

function buildWeldBatchUpdatePayload(
  record: WeldInput,
  previousRows: ReadonlyMap<number, WeldJoint>,
  now: Date,
) {
  const id = Number(record.id)
  const previous = previousRows.get(id)
  if (!previous) throw new Error(`Запись ${id} не найдена`)
  const timestampUpdates = getProfileTimestampUpdates(record, previous, now)
  const values: Record<string, unknown> = {
    id,
    ...toDbInsert(record),
    weldingUpdatedAt: timestampUpdates.weldingUpdatedAt ?? previous.weldingUpdatedAt,
    pstoCreatedAt: timestampUpdates.pstoCreatedAt ?? previous.pstoCreatedAt,
    pstoUpdatedAt: timestampUpdates.pstoUpdatedAt ?? previous.pstoUpdatedAt,
    lnkCreatedAt: timestampUpdates.lnkCreatedAt ?? previous.lnkCreatedAt,
    lnkUpdatedAt: timestampUpdates.lnkUpdatedAt ?? previous.lnkUpdatedAt,
    updatedAt: now,
  }

  return Object.fromEntries([
    ['id', id],
    ...WELD_BATCH_UPDATE_COLUMNS.map(([fieldKey]) => [fieldKey, values[fieldKey] ?? null]),
  ]) as NewWeldJoint
}

async function listColumnFilterOptions(data: ReturnType<typeof normalizeWeldColumnFilterOptionsRequest>) {
  if (!FIELD_BY_KEY.has(data.fieldKey)) return []
  const columnFilters = getColumnFilterOptionFilters(data.columnFilters, data.fieldKey)
  if (shouldEnsureDispatcherTaskIndexForColumnFilter(data.fieldKey, columnFilters)) {
    await ensureDispatcherTaskIndexFresh()
  }
  const currentWdiSettings = data.fieldKey === 'wdi' ? await loadServerOtherSettings() : null
  const useCurrentSystemWdi = Boolean(currentWdiSettings && isSystemWdiMode(currentWdiSettings))
  if (data.fieldKey === DISPATCHER_TASKS_FIELD_KEY) {
    return listDispatcherTaskColumnFilterOptions({ ...data, columnFilters })
  }
  if (data.report !== 'weldingJournal') {
    const column = getWeldColumn(data.fieldKey)
    if (column && REPORT_SOURCE_COLUMN_FILTER_KEYS.has(data.fieldKey) && canPaginateReportSource(columnFilters) && !useCurrentSystemWdi) {
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
  if (generatedDocumentType) {
    return listGeneratedDocumentColumnFilterOptions({ ...data, columnFilters }, generatedDocumentType)
  }
  if (data.fieldKey === 'finalStatus') {
    return listFinalStatusColumnFilterOptions({ ...data, columnFilters })
  }

  if (currentWdiSettings && useCurrentSystemWdi) {
    const rows = await requireDb()
      .select(WELD_TABLE_SELECT)
      .from(weldJoints)
      .where(buildWhere({ ...data, columnFilters }))
    return buildWeldColumnFilterOptionsFromRows(
      applyCurrentSystemWdi(rows, currentWdiSettings),
      data.fieldKey,
    )
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

async function listDispatcherTaskColumnFilterOptions(
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

async function listDispatcherTaskColumnFilterOptionsByWhere(where: SQL) {
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

async function listDispatcherTaskColumnFilterOptionsByIds(rowIds: number[]) {
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
      const reportRows = applyCurrentSystemWdi(
        buildServerReportRows(sourceRowsWithControls as unknown as WeldJoint[], report),
        await loadServerOtherSettings(),
      )
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

export function normalizeWeldImportScopeRequest(
  data: WeldImportScopeRequest | undefined,
): Required<WeldImportScopeRequest> {
  return {
    columnFilters: Object.fromEntries(
      Object.entries(data?.columnFilters ?? {})
        .map(([key, value]) => [key, String(value ?? '').trim()] as const)
        .filter(([, value]) => value.length > 0),
    ),
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
    leadingLetterIndexedRowsCount: rows.filter((row) => /^[A-Z][A-Z]\d/i.test(String(row.joint ?? '').replace(/\s+/g, ''))).length,
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
  return inArray(column, CONTROL_REPORT_VALUES)
}

function buildEnabledControlValueWhere(column: SQLWrapper) {
  return inArray(column, ENABLED_CONTROL_REPORT_VALUES)
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

function getWeldColumn(fieldKey: WeldFieldKey) {
  return WELD_TABLE_COLUMNS[fieldKey as keyof typeof WELD_TABLE_COLUMNS]
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

function buildJointChainWhere(filter: NonNullable<ReturnType<typeof parseJointChainFilter>>) {
  const pattern = getJointChainFilterPattern(filter)
  return sql`regexp_replace(coalesce(${weldJoints.joint}::text, ''), '\\s+', '', 'g') ~* ${pattern}`
}

function buildDispatcherTaskWhere(filter: NonNullable<ReturnType<typeof parseDispatcherTaskServerFilter>>) {
  if (filter.mode === 'all') return sql`true`

  if (filter.mode === 'codes' && filter.codes.length === 0) return sql`false`
  const activeTaskClauses: SQL[] = [eq(dispatcherRowTasks.weldJointId, weldJoints.id)]
  const backgroundTaskClauses: SQL[] = [eq(dispatcherBackgroundRowTasks.weldJointId, weldJoints.id)]
  if (filter.mode === 'codes') {
    activeTaskClauses.push(inArray(dispatcherRowTasks.code, filter.codes))
    backgroundTaskClauses.push(inArray(dispatcherBackgroundRowTasks.code, filter.codes))
  }
  const matchingActiveTask = requireDb()
    .select({ value: sql`1` })
    .from(dispatcherRowTasks)
    .where(and(...activeTaskClauses))
  const matchingBackgroundTask = requireDb()
    .select({ value: sql`1` })
    .from(dispatcherBackgroundRowTasks)
    .where(and(...backgroundTaskClauses))

  return filter.mode === 'without'
    ? and(notExists(matchingActiveTask), notExists(matchingBackgroundTask)) ?? sql`false`
    : or(exists(matchingActiveTask), exists(matchingBackgroundTask)) ?? sql`false`
}

function normalizedTextEquals(column: SQLWrapper, value: unknown) {
  const normalizedValue = String(value ?? '').replace(/\s+/g, '').trim().toLowerCase()
  return sql`lower(regexp_replace(coalesce(${column}::text, ''), '\\s+', '', 'g')) = ${normalizedValue}`
}

function getColumnFilterOptionFilters(columnFilters: Record<string, string>, fieldKey: WeldFieldKey) {
  const filters = { ...columnFilters }
  delete filters[fieldKey]
  return filters
}

export function shouldEnsureDispatcherTaskIndexForColumnFilter(
  fieldKey: WeldFieldKey,
  columnFilters: Record<string, string>,
) {
  return fieldKey === DISPATCHER_TASKS_FIELD_KEY || hasDispatcherTaskServerFilter(columnFilters)
}

function hasDispatcherTaskServerFilter(columnFilters: Record<string, string>) {
  return Boolean(parseDispatcherTaskServerFilter(columnFilters[DISPATCHER_TASK_FILTER_KEY]))
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
