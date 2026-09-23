import type { WeldDraft, WeldRow } from '@/lib/dispatcher-types'
import type {
  PstoWeldLineMoveDisposition,
  WeldChainLineMovePlan,
} from '@/lib/psto-line-assignment'
import { DATA_IMPORT_SECURITY_SCOPE } from '@/lib/security-scopes'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'
import type { SystemDocumentSequenceUpdate } from '@/server/system-document-sequences'
import type { JointCoilTransition } from '@/lib/joint-chain-transitions'
import type { WeldRowVersionTarget } from '@/lib/weld-row-version'
import type {
  PercentageLineControlAction,
  PercentageLineControlScope,
} from '@/lib/percentage-line-control-update'
import type { PercentageControlMethod } from '@/lib/percentage-line-summary'
import type { LnkRequestExtensionOption } from '@/lib/lnk-request-extension'
import type { SystemDocumentReference } from '@/lib/system-document-types'
import type { RequestDocumentIdentity } from '@/lib/request-document-identity'
import { assertWorkflowSelectionLimit } from '@/lib/workflow-selection-limit'

export type WeldFilters = {
  search?: string
  projectTitle?: string
  line?: string
  groupName?: string
  category?: string
  pstoRequired?: string
  weldingMethod?: string
  materialGroup?: string
  officiality?: string
  finalStatus?: string
  controlMethod?: string
}

export const WELD_PAGE_SIZE_OPTIONS = [100, 300, 500, 1000] as const
export const WELD_PAGE_ALL_SIZE = 'all'
export const WELD_SNAPSHOT_BATCH_SIZE = 1000
export const WORKFLOW_REGISTRY_PAGE_SIZE = 500
export const WORKFLOW_REGISTRY_MAX_LOADED_ROWS = 5000
export const WORKFLOW_CANDIDATE_PAGE_SIZE = 500

export type WeldPageSize = (typeof WELD_PAGE_SIZE_OPTIONS)[number] | typeof WELD_PAGE_ALL_SIZE
export type WeldReportKind = 'weldingJournal' | 'lnk' | 'heatTreatment'
export type WeldReportContextKind = Exclude<WeldReportKind, 'weldingJournal'>

export const LNK_WORKFLOW_ROW_SCOPES = [
  'requestCandidates',
  'requestRegistry',
  'resultCandidates',
  'resultRegistry',
  'officialityCandidates',
  'preHeatTreatmentRequestCandidates',
  'preHeatTreatmentResultCandidates',
  'preHeatTreatmentRequestRegistry',
  'preHeatTreatmentResultRegistry',
  'fieldRows',
] as const

export type LnkWorkflowRowScope = (typeof LNK_WORKFLOW_ROW_SCOPES)[number]

export type LnkWorkflowRowsRequest = {
  scope: LnkWorkflowRowScope
  rowIds?: number[] | null
  includeRowIds?: number[] | null
  methodKeys?: WeldFieldKey[] | null
  allowPrimaryBeforePreviousStagesComplete?: boolean | null
  requestName?: string | null
  requestDate?: string | null
  search?: string | null
  resultFilter?: 'годен' | 'ремонт' | 'вырез' | null
  limit?: number | null
}

export type LnkWorkflowSummary = {
  pendingPrimaryResultRowCount: number
  primaryResultRowCount: number
  preHeatTreatmentRequestRowCount: number
  preHeatTreatmentResultRowCount: number
}

export type LnkWorkflowRequestSummary = {
  requestNames: string[]
  requestOptions: LnkRequestExtensionOption[]
  hasMore: boolean
}

export const LNK_WORKFLOW_REQUEST_OPTION_LIMIT = 200

export type LnkWorkflowRequestSummaryRequest = {
  search?: string
  limit?: number
}

export function normalizeLnkWorkflowRequestSummaryRequest(
  value?: LnkWorkflowRequestSummaryRequest,
): Required<LnkWorkflowRequestSummaryRequest> {
  const requestedLimit = Number(value?.limit ?? LNK_WORKFLOW_REQUEST_OPTION_LIMIT)
  return {
    search: String(value?.search ?? '').trim().slice(0, 200),
    limit: Number.isInteger(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, LNK_WORKFLOW_REQUEST_OPTION_LIMIT)
      : LNK_WORKFLOW_REQUEST_OPTION_LIMIT,
  }
}

export function normalizeLnkWorkflowRowsRequest(
  value: LnkWorkflowRowsRequest,
) {
  const scope = LNK_WORKFLOW_ROW_SCOPES.includes(value?.scope as LnkWorkflowRowScope)
    ? value.scope
    : null
  if (!scope) throw new Error('Неизвестный режим загрузки данных ЛНК.')

  if (value?.rowIds != null && !Array.isArray(value.rowIds)) {
    throw new Error('Передан некорректный список стыков ЛНК.')
  }
  const rowIds = value?.rowIds == null
    ? null
    : [...new Set(value.rowIds.map(Number))].sort((left, right) => left - right)
  if (rowIds?.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new Error('Передан некорректный список стыков ЛНК.')
  }
  if (value?.includeRowIds != null && !Array.isArray(value.includeRowIds)) {
    throw new Error('Передан некорректный список выбранных стыков ЛНК.')
  }
  const includeRowIds = value?.includeRowIds == null
    ? []
    : [...new Set(value.includeRowIds.map(Number))]
      .sort((left, right) => left - right)
  if (includeRowIds.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new Error('Передан некорректный список выбранных стыков ЛНК.')
  }
  assertWorkflowSelectionLimit(includeRowIds)
  const requestName = String(value?.requestName ?? '').trim()
  const requestDate = String(value?.requestDate ?? '').trim()
  if (value?.methodKeys != null && !Array.isArray(value.methodKeys)) {
    throw new Error('Передан некорректный список видов контроля ЛНК.')
  }
  const validMethodKeys = new Set<WeldFieldKey>([
    'vikRequest',
    'rkRequest',
    'uzkRequest',
    'pvkRequest',
  ])
  const rawMethodKeys = value?.methodKeys ?? []
  if (rawMethodKeys.some((key) => !validMethodKeys.has(key))) {
    throw new Error('Передан неизвестный вид контроля ЛНК.')
  }
  const methodKeys = [...new Set(rawMethodKeys)]
  const search = String(value?.search ?? '').trim().slice(0, 200)
  const resultFilter = new Set(['годен', 'ремонт', 'вырез']).has(String(value?.resultFilter ?? '').trim())
    ? value.resultFilter as 'годен' | 'ремонт' | 'вырез'
    : null
  const defaultLimit = scope.endsWith('Candidates') ? WORKFLOW_CANDIDATE_PAGE_SIZE : null
  const requestedLimit = value?.limit == null ? defaultLimit : Number(value.limit)
  const limit = requestedLimit !== null && Number.isInteger(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, WORKFLOW_REGISTRY_MAX_LOADED_ROWS)
    : null
  return {
    scope,
    rowIds,
    ...(includeRowIds.length > 0 ? { includeRowIds } : {}),
    ...(methodKeys.length > 0 ? { methodKeys } : {}),
    ...(value?.allowPrimaryBeforePreviousStagesComplete === true
      ? { allowPrimaryBeforePreviousStagesComplete: true }
      : {}),
    ...((scope === 'requestRegistry' || scope === 'resultCandidates' || scope === 'preHeatTreatmentResultCandidates') && requestName
      ? { requestName, requestDate }
      : {}),
    ...(search ? { search } : {}),
    ...(scope === 'resultRegistry' && resultFilter ? { resultFilter } : {}),
    ...(limit ? { limit } : {}),
  }
}

export const PSTO_WORKFLOW_ROW_SCOPES = [
  'requestCandidates',
  'requestRegistry',
  'resultCandidates',
  'resultRegistry',
  'tvmtRequestCandidates',
  'tvmtResultCandidates',
  'fieldRows',
] as const

export type PstoWorkflowRowScope = (typeof PSTO_WORKFLOW_ROW_SCOPES)[number]

export type PstoWorkflowRowsRequest = {
  scope: PstoWorkflowRowScope
  rowIds?: number[] | null
  includeRowIds?: number[] | null
  requestName?: string | null
  requestDate?: string | null
  search?: string | null
  limit?: number | null
}

export const PSTO_WORKFLOW_REQUEST_OPTION_LIMIT = 200

export type PstoWorkflowRequestOptionsRequest = {
  search?: string
  limit?: number
}

export type PstoWorkflowRequestOptionsResult = {
  options: RequestDocumentIdentity[]
  hasMore: boolean
}

export function normalizePstoWorkflowRequestOptionsRequest(
  value?: PstoWorkflowRequestOptionsRequest,
): Required<PstoWorkflowRequestOptionsRequest> {
  const requestedLimit = Number(value?.limit ?? PSTO_WORKFLOW_REQUEST_OPTION_LIMIT)
  return {
    search: String(value?.search ?? '').trim().slice(0, 200),
    limit: Number.isInteger(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, PSTO_WORKFLOW_REQUEST_OPTION_LIMIT)
      : PSTO_WORKFLOW_REQUEST_OPTION_LIMIT,
  }
}

export type PstoWorkflowSummary = {
  requestCandidateCount: number
  requestRegistryCount: number
  resultCandidateCount: number
  resultRegistryCount: number
  tvmtRequestCandidateCount: number
  tvmtResultCandidateCount: number
}

export function normalizePstoWorkflowRowsRequest(
  value: PstoWorkflowRowsRequest,
) {
  const scope = PSTO_WORKFLOW_ROW_SCOPES.includes(value?.scope as PstoWorkflowRowScope)
    ? value.scope
    : null
  if (!scope) throw new Error('Неизвестный режим загрузки данных ПСТО/ТВМТ.')

  if (value?.rowIds != null && !Array.isArray(value.rowIds)) {
    throw new Error('Передан некорректный список стыков ПСТО/ТВМТ.')
  }
  const rowIds = value?.rowIds == null
    ? null
    : [...new Set(value.rowIds.map(Number))].sort((left, right) => left - right)
  if (rowIds?.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new Error('Передан некорректный список стыков ПСТО/ТВМТ.')
  }
  if (value?.includeRowIds != null && !Array.isArray(value.includeRowIds)) {
    throw new Error('Передан некорректный список выбранных стыков ПСТО/ТВМТ.')
  }
  const includeRowIds = value?.includeRowIds == null
    ? []
    : [...new Set(value.includeRowIds.map(Number))]
      .sort((left, right) => left - right)
  if (includeRowIds.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new Error('Передан некорректный список выбранных стыков ПСТО/ТВМТ.')
  }
  assertWorkflowSelectionLimit(includeRowIds)
  const requestName = String(value?.requestName ?? '').trim()
  const requestDate = String(value?.requestDate ?? '').trim()
  const search = String(value?.search ?? '').trim().slice(0, 200)
  const defaultLimit = scope.endsWith('Candidates') ? WORKFLOW_CANDIDATE_PAGE_SIZE : null
  const requestedLimit = value?.limit == null ? defaultLimit : Number(value.limit)
  const limit = requestedLimit !== null && Number.isInteger(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, WORKFLOW_REGISTRY_MAX_LOADED_ROWS)
    : null
  return {
    scope,
    rowIds,
    ...(includeRowIds.length > 0 ? { includeRowIds } : {}),
    ...((scope === 'requestRegistry' || scope === 'resultCandidates' || scope === 'tvmtResultCandidates') && requestName
      ? { requestName, requestDate }
      : {}),
    ...(search ? { search } : {}),
    ...(limit ? { limit } : {}),
  }
}
export type WeldSortDirection = 'asc' | 'desc'
export type WeldSort = {
  fieldKey: WeldFieldKey
  direction: WeldSortDirection
}

export type WeldPageRequest = WeldFilters & {
  report?: WeldReportKind
  page?: number
  pageSize?: WeldPageSize
  columnFilters?: Record<string, string>
  sort?: WeldSort
}

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

export type WeldImportScopeRequest = { columnFilters?: Record<string, string> }

export type WeldImportScopeResult = {
  rows: WeldRow[]
  total: number
  limitExceeded: boolean
  fullyAssignedPstoLineKeys: string[]
}

export type WeldColumnFilterOption = { value: string; count: number; label: string }
export type WeldColumnFilterOptionsRequest = WeldPageRequest & { fieldKey: WeldFieldKey }
export type WeldFormSuggestionsRequest = { fieldKey: WeldFieldKey; draft: WeldInput }
export type WeldLineAutofillRequest = { draft: WeldInput }
export type WeldJointChainEarlyCoilCandidate = {
  replacementJoint: string | null
  replacementRowId: number | null
  sourceJoint: string
  sourceRowId: number
  targetJoints: [string, string]
}

export type WeldJointChainResult = {
  record: WeldRow | null
  rows: WeldRow[]
  transitions: JointCoilTransition[]
  earlyCoilCandidates: WeldJointChainEarlyCoilCandidate[]
}
export type WeldRowsByIdsRequest = { ids: number[] }
export type WeldSnapshotPageRequest = { afterId?: number; batchSize?: number }

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

export type WeldMutationScope = 'welding' | 'lnk' | 'psto'

export type WeldPayload = WeldDraft & {
  expectedVersion?: string
  pstoLineMoveDisposition?: PstoWeldLineMoveDisposition
  weldChainLineMovePlan?: WeldChainLineMovePlan
  mutationScope?: WeldMutationScope
}

export type WeldBatchUpdateData = {
  records: WeldPayload[]
  expectedVersions: WeldRowVersionTarget[]
  mutationScope?: WeldMutationScope
  systemDocumentSequence?: SystemDocumentSequenceUpdate
  systemDocumentSequences?: SystemDocumentSequenceUpdate[]
  requireFullyAssignedPstoLines?: boolean
}

export type WeldDeleteData = WeldRowVersionTarget

export type RepeatedJointDeleteData = {
  taskKey: string
  target: WeldRowVersionTarget
}

export type WeldDeleteManyData = {
  targets: WeldRowVersionTarget[]
}

export type PercentageLineControlUpdateData = PercentageLineControlScope & {
  action: PercentageLineControlAction
  method?: PercentageControlMethod
  targets: WeldRowVersionTarget[]
}

export type RepeatedJointCreateData = {
  source: WeldRowVersionTarget
  targetJoints: string[]
}

export type RequestDocumentManagerData = {
  requestName: string
  requestDate: string
  nextRequestName?: string
  action: 'rename' | 'delete'
  expectedVersions: WeldRowVersionTarget[]
}

export type SystemDocumentDateChangeData = {
  reference: SystemDocumentReference
  nextDate: string
  expectedVersions: WeldRowVersionTarget[]
}
