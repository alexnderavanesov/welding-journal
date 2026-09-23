import { createServerFn } from '@tanstack/react-start'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { WeldFormSuggestion } from '@/lib/weld-form-suggestions'
import type {
  DocumentGenerationDataRequest,
  DocumentGenerationDataResult,
  WeldColumnFilterOption,
  WeldColumnFilterOptionsRequest,
  WeldDataUsageSummary,
  WeldFormSuggestionsRequest,
  WeldJointChainResult,
  LnkWorkflowRequestSummary,
  LnkWorkflowRequestSummaryRequest,
  LnkWorkflowRowsRequest,
  LnkWorkflowSummary,
  PstoWorkflowRowsRequest,
  PstoWorkflowRequestOptionsRequest,
  PstoWorkflowRequestOptionsResult,
  PstoWorkflowSummary,
  WeldPageRequest,
  WeldPageResult,
  WeldReportContextKind,
  WeldSort,
  WeldSortDirection,
  WeldRowsByIdsRequest,
  WeldSnapshotPageRequest,
  WeldSnapshotPageResult,
} from '@/server/weld-contracts'
import {
  normalizeLnkWorkflowRowsRequest,
  normalizePstoWorkflowRowsRequest,
} from '@/server/weld-contracts'

export const getLnkWorkflowSummary = createServerFn({ method: 'GET' })
  .handler(async (): Promise<LnkWorkflowSummary> => {
    const server = await import('@/server/lnk-workflow-context')
    return server.getLnkWorkflowSummary()
  })

export const getLnkWorkflowRequestSummary = createServerFn({ method: 'POST' })
  .validator((data: LnkWorkflowRequestSummaryRequest | undefined) => data)
  .handler(async ({ data }): Promise<LnkWorkflowRequestSummary> => {
    const server = await import('@/server/lnk-workflow-context')
    return server.getLnkWorkflowRequestSummary(data)
  })

export const listLnkWorkflowRows = createServerFn({ method: 'POST' })
  .validator((data: LnkWorkflowRowsRequest) => normalizeLnkWorkflowRowsRequest(data))
  .handler(async ({ data }): Promise<WeldRow[]> => {
    const server = await import('@/server/lnk-workflow-context')
    return server.listLnkWorkflowRows(data)
  })

export const getPstoWorkflowSummary = createServerFn({ method: 'GET' })
  .handler(async (): Promise<PstoWorkflowSummary> => {
    const server = await import('@/server/psto-workflow-context')
    return server.getPstoWorkflowSummary()
  })

export const getPstoWorkflowRequestOptions = createServerFn({ method: 'POST' })
  .validator((data: PstoWorkflowRequestOptionsRequest | undefined) => data)
  .handler(async ({ data }): Promise<PstoWorkflowRequestOptionsResult> => {
    const server = await import('@/server/psto-workflow-context')
    return server.getPstoWorkflowRequestOptions(data)
  })

export const listPstoWorkflowRows = createServerFn({ method: 'POST' })
  .validator((data: PstoWorkflowRowsRequest) => normalizePstoWorkflowRowsRequest(data))
  .handler(async ({ data }): Promise<WeldRow[]> => {
    const server = await import('@/server/psto-workflow-context')
    return server.listPstoWorkflowRows(data)
  })

export const listWeldJointSnapshotPage = createServerFn({ method: 'GET' })
  .validator((data: WeldSnapshotPageRequest | undefined) => data)
  .handler(async ({ data }): Promise<WeldSnapshotPageResult> => {
    const server = await import('@/server/weld-read')
    return server.listWeldJointSnapshotPage({ data })
  })

export const listWeldReportContextRows = createServerFn({ method: 'GET' })
  .validator((data: { report: WeldReportContextKind }) => data)
  .handler(async ({ data }): Promise<WeldRow[]> => {
    const server = await import('@/server/weld-read')
    return server.listWeldReportContextRows({ data })
  })

export const listWeldFinalStatusContextKeys = createServerFn({ method: 'GET' })
  .handler(async (): Promise<string[]> => {
    const server = await import('@/server/weld-read')
    return server.listWeldFinalStatusContextKeys()
  })

export const listWeldFormSuggestions = createServerFn({ method: 'POST' })
  .validator((data: WeldFormSuggestionsRequest) => data)
  .handler(async ({ data }): Promise<WeldFormSuggestion[]> => {
    const server = await import('@/server/weld-read')
    return server.listWeldFormSuggestions({ data })
  })

export const listWeldJointChain = createServerFn({ method: 'GET' })
  .validator((data: { id: number }) => data)
  .handler(async ({ data }): Promise<WeldJointChainResult> => {
    const server = await import('@/server/weld-read')
    return server.listWeldJointChain({ data })
  })

export const getWeldJointById = createServerFn({ method: 'GET' })
  .validator((data: { id: number }) => data)
  .handler(async ({ data }): Promise<WeldRow | null> => {
    const server = await import('@/server/weld-read')
    return server.getWeldJointById({ data })
  })

export const listWeldingJournalPage = createServerFn({ method: 'GET' })
  .validator((data: WeldPageRequest | undefined) => data)
  .handler(async ({ data }): Promise<WeldPageResult> => {
    const server = await import('@/server/weld-read')
    return server.listWeldingJournalPage({ data })
  })

export const listLnkReportPage = createServerFn({ method: 'GET' })
  .validator((data: WeldPageRequest | undefined) => data)
  .handler(async ({ data }): Promise<WeldPageResult> => {
    const server = await import('@/server/weld-read')
    return server.listLnkReportPage({ data })
  })

export const listHeatTreatmentReportPage = createServerFn({ method: 'GET' })
  .validator((data: WeldPageRequest | undefined) => data)
  .handler(async ({ data }): Promise<WeldPageResult> => {
    const server = await import('@/server/weld-read')
    return server.listHeatTreatmentReportPage({ data })
  })

export const listWeldColumnFilterOptions = createServerFn({ method: 'GET' })
  .validator((data: WeldColumnFilterOptionsRequest | undefined) => data)
  .handler(async ({ data }): Promise<WeldColumnFilterOption[]> => {
    const server = await import('@/server/weld-read')
    return server.listWeldColumnFilterOptions({ data })
  })

export const getDocumentGenerationData = createServerFn({ method: 'POST' })
  .validator((data: DocumentGenerationDataRequest | undefined) => data)
  .handler(async ({ data }): Promise<DocumentGenerationDataResult> => {
    const server = await import('@/server/weld-read')
    return server.getDocumentGenerationData({ data })
  })

export const getWeldDataUsageSummary = createServerFn({ method: 'GET' })
  .handler(async (): Promise<WeldDataUsageSummary> => {
    const server = await import('@/server/weld-read')
    return server.getWeldDataUsageSummary()
  })

export const listWeldJointRowsByIds = createServerFn({ method: 'POST' })
  .validator((data: WeldRowsByIdsRequest) => data)
  .handler(async ({ data }): Promise<WeldRow[]> => {
    const server = await import('@/server/weld-read')
    return server.listWeldJointRowsByIds({ data })
  })

export {
  WELD_PAGE_ALL_SIZE,
  WELD_PAGE_SIZE_OPTIONS,
  WELD_SNAPSHOT_BATCH_SIZE,
} from '@/server/weld-contracts'
export type {
  DocumentGenerationDataRequest,
  DocumentGenerationDataResult,
  WeldColumnFilterOption,
  WeldColumnFilterOptionsRequest,
  WeldDataUsageSummary,
  WeldFilters,
  WeldFormSuggestionsRequest,
  WeldJointChainResult,
  LnkWorkflowRowsRequest,
  LnkWorkflowRowScope,
  LnkWorkflowSummary,
  PstoWorkflowRowsRequest,
  PstoWorkflowRequestOptionsRequest,
  PstoWorkflowRequestOptionsResult,
  PstoWorkflowRowScope,
  PstoWorkflowSummary,
  WeldPageRequest,
  WeldPageResult,
  WeldPageSize,
  WeldReportContextKind,
  WeldReportKind,
  WeldSort,
  WeldSortDirection,
  WeldRowsByIdsRequest,
  WeldSnapshotPageRequest,
  WeldSnapshotPageResult,
} from '@/server/weld-contracts'
