import type { WeldDraft, WeldRow } from '@/lib/dispatcher-types'
import type {
  PstoWeldLineMoveDisposition,
  WeldChainLineMovePlan,
} from '@/lib/psto-line-assignment'
import { DATA_IMPORT_SECURITY_SCOPE } from '@/lib/security-scopes'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'
import type { SystemDocumentSequenceUpdate } from '@/server/system-document-sequences'
import type { JointCoilTransition } from '@/lib/joint-chain-transitions'

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

export type WeldPageSize = (typeof WELD_PAGE_SIZE_OPTIONS)[number] | typeof WELD_PAGE_ALL_SIZE
export type WeldReportKind = 'weldingJournal' | 'lnk' | 'heatTreatment'
export type WeldReportContextKind = Exclude<WeldReportKind, 'weldingJournal'>
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
  pstoLineMoveDisposition?: PstoWeldLineMoveDisposition
  weldChainLineMovePlan?: WeldChainLineMovePlan
  mutationScope?: WeldMutationScope
}

export type WeldBatchUpdateData = {
  records: WeldPayload[]
  mutationScope?: WeldMutationScope
  systemDocumentSequence?: SystemDocumentSequenceUpdate
  systemDocumentSequences?: SystemDocumentSequenceUpdate[]
  requireFullyAssignedPstoLines?: boolean
}
