import { type InfiniteData, QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { WeldPageResult } from '@/server/weld-contracts'
import {
  DISPATCHER_TASK_REFRESH_QUERY_KEY,
  DISPATCHER_TASK_SNAPSHOT_QUERY_KEY,
  DUPLICATE_CONTROL_CANDIDATES_QUERY_KEY,
  DUPLICATE_CONTROL_REGISTRY_QUERY_KEY,
  GENERATED_DOCUMENT_HISTORY_QUERY_KEY,
  invalidateWeldJoints,
  LNK_WORKFLOW_QUERY_KEY,
  LNK_WORKFLOW_ROWS_QUERY_KEY,
  STATISTICS_SERVER_QUERY_KEY,
  WELD_COMPLETE_SNAPSHOT_QUERY_KEY,
  WELD_DATA_USAGE_QUERY_KEY,
  WELD_DOCUMENT_GENERATION_QUERY_KEY,
  WELD_FINAL_STATUS_CONTEXT_QUERY_KEY,
  WELD_FORM_SUGGESTIONS_QUERY_KEY,
  WELD_JOINT_PAGES_QUERY_KEY,
  WELD_LINE_AUTOFILL_QUERY_KEY,
  WELD_REPORT_CONTEXT_QUERY_KEY,
  WELD_ROWS_BY_IDS_QUERY_KEY,
} from '@/lib/weld-query-utils'

describe('weld query cache updates', () => {
  it('keeps an active dispatcher refresh outside snapshot invalidation', async () => {
    const queryClient = createQueryClient()
    const refreshKey = [...DISPATCHER_TASK_REFRESH_QUERY_KEY, 7]
    queryClient.setQueryData(refreshKey, { isFresh: false })

    await queryClient.invalidateQueries({ queryKey: DISPATCHER_TASK_SNAPSHOT_QUERY_KEY })

    expect(queryClient.getQueryState(refreshKey)?.isInvalidated).toBe(false)
  })

  it('merges saved rows into the complete snapshot without refetching it', async () => {
    const queryClient = createQueryClient()
    queryClient.setQueryData(WELD_COMPLETE_SNAPSHOT_QUERY_KEY, [
      { id: 1, joint: '1', createdAt: '2026-01-01' },
      { id: 2, joint: '2', createdAt: '2026-01-02' },
    ] as WeldRow[])
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    await invalidateWeldJoints(queryClient, {
      upsertRows: [
        { id: 1, joint: '1A', createdAt: '2026-01-01' },
        { id: 3, joint: '3', createdAt: '2026-01-03' },
      ],
    })

    expect(queryClient.getQueryData<WeldRow[]>(WELD_COMPLETE_SNAPSHOT_QUERY_KEY)?.map((row) => [row.id, row.joint])).toEqual([
      [3, '3'],
      [2, '2'],
      [1, '1A'],
    ])
    expect(invalidateSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: WELD_COMPLETE_SNAPSHOT_QUERY_KEY }),
    )
    expect(invalidateSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: WELD_JOINT_PAGES_QUERY_KEY }),
    )
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: WELD_REPORT_CONTEXT_QUERY_KEY })
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: LNK_WORKFLOW_QUERY_KEY,
      refetchType: 'none',
    })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: DISPATCHER_TASK_SNAPSHOT_QUERY_KEY })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: STATISTICS_SERVER_QUERY_KEY })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: WELD_DOCUMENT_GENERATION_QUERY_KEY })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: WELD_ROWS_BY_IDS_QUERY_KEY })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: WELD_DATA_USAGE_QUERY_KEY })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: WELD_FINAL_STATUS_CONTEXT_QUERY_KEY })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: WELD_FORM_SUGGESTIONS_QUERY_KEY })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: WELD_LINE_AUTOFILL_QUERY_KEY })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: DUPLICATE_CONTROL_CANDIDATES_QUERY_KEY })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: DUPLICATE_CONTROL_REGISTRY_QUERY_KEY })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: GENERATED_DOCUMENT_HISTORY_QUERY_KEY })
  })

  it('removes deleted rows from an existing complete snapshot', async () => {
    const queryClient = createQueryClient()
    queryClient.setQueryData(WELD_COMPLETE_SNAPSHOT_QUERY_KEY, [{ id: 1 }, { id: 2 }] as WeldRow[])

    await invalidateWeldJoints(queryClient, { deleteIds: [1] })

    expect(queryClient.getQueryData<WeldRow[]>(WELD_COMPLETE_SNAPSHOT_QUERY_KEY)?.map((row) => row.id)).toEqual([2])
  })

  it('patches only rows that are already loaded in paged reports', () => {
    const queryClient = createQueryClient()
    const queryKey = [...WELD_JOINT_PAGES_QUERY_KEY, 'weldingJournal', {}, 100]
    const cachedData: InfiniteData<WeldPageResult> = {
      pages: [{
        rows: [{ id: 1, joint: 'S1' }, { id: 2, joint: 'S2' }] as WeldRow[],
        total: 2,
        page: 1,
        pageSize: 100,
        hasMore: false,
      }, {
        rows: [{ id: 4, joint: 'S4' }] as WeldRow[],
        page: 2,
        pageSize: 100,
        hasMore: false,
      }],
      pageParams: [1, 2],
    }
    const unchangedPage = cachedData.pages[1]
    const unchangedRows = unchangedPage.rows
    queryClient.setQueryData<InfiniteData<WeldPageResult>>(queryKey, cachedData)

    invalidateWeldJoints(queryClient, {
      upsertRows: [{ id: 1, joint: 'S1R1' }, { id: 3, joint: 'S3' }],
      deleteIds: [2],
    })

    const result = queryClient.getQueryData<InfiniteData<WeldPageResult>>(queryKey)
    const page = result?.pages[0]
    expect(page?.rows.map((row) => [row.id, row.joint])).toEqual([[1, 'S1R1']])
    expect(page?.total).toBe(1)
    expect(result?.pages[1]).toBe(unchangedPage)
    expect(result?.pages[1].rows).toBe(unchangedRows)
    expect(result?.pages[1].total).toBeUndefined()
  })

  it('patches loaded report contexts immediately after a workflow correction', () => {
    const queryClient = createQueryClient()
    const lnkContextKey = [...WELD_REPORT_CONTEXT_QUERY_KEY, 'lnk']
    const pstoContextKey = [...WELD_REPORT_CONTEXT_QUERY_KEY, 'heatTreatment']
    queryClient.setQueryData<WeldRow[]>(lnkContextKey, [
      { id: 1, joint: 'F1', preHeatTreatmentControls: [{ id: 10, result: 'годен' }] },
      { id: 2, joint: 'F2' },
    ] as WeldRow[])
    queryClient.setQueryData<WeldRow[]>(pstoContextKey, [{ id: 1, joint: 'F1' }] as WeldRow[])

    invalidateWeldJoints(queryClient, {
      upsertRows: [{ id: 1, preHeatTreatmentControls: [{ id: 10, result: null }] } as unknown as WeldRow],
      deleteIds: [2],
    })

    expect(queryClient.getQueryData<WeldRow[]>(lnkContextKey)).toEqual([expect.objectContaining({
      id: 1,
      preHeatTreatmentControls: [{ id: 10, result: null }],
    })])
    expect(queryClient.getQueryData<WeldRow[]>(pstoContextKey)?.[0]).toEqual(expect.objectContaining({
      id: 1,
      preHeatTreatmentControls: [{ id: 10, result: null }],
    }))
  })

  it('patches only rows already loaded by scoped LNK workflows', () => {
    const queryClient = createQueryClient()
    const requestRegistryKey = [
      ...LNK_WORKFLOW_ROWS_QUERY_KEY,
      { scope: 'requestRegistry', rowIds: null },
    ]
    const resultRegistryKey = [
      ...LNK_WORKFLOW_ROWS_QUERY_KEY,
      { scope: 'resultRegistry', rowIds: null },
    ]
    queryClient.setQueryData<WeldRow[]>(requestRegistryKey, [
      { id: 1, joint: 'F1', rkRequest: 'Заявка 1' },
      { id: 2, joint: 'F2', rkRequest: 'Заявка 2' },
    ] as WeldRow[])
    queryClient.setQueryData<WeldRow[]>(resultRegistryKey, [
      { id: 1, joint: 'F1', rkResult: 'годен' },
    ] as WeldRow[])

    invalidateWeldJoints(queryClient, {
      upsertRows: [
        { id: 1, joint: 'F1R1' },
        { id: 3, joint: 'F3' },
      ],
      deleteIds: [2],
    })

    expect(queryClient.getQueryData<WeldRow[]>(requestRegistryKey)).toEqual([
      expect.objectContaining({ id: 1, joint: 'F1R1', rkRequest: 'Заявка 1' }),
    ])
    expect(queryClient.getQueryData<WeldRow[]>(resultRegistryKey)).toEqual([
      expect.objectContaining({ id: 1, joint: 'F1R1', rkResult: 'годен' }),
    ])
  })

  it('can explicitly refresh an active LNK manager after a correction', () => {
    const queryClient = createQueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    invalidateWeldJoints(
      queryClient,
      { upsertRows: [{ id: 1, joint: 'F1' }] },
      { refetchLnkWorkflow: true },
    )

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: LNK_WORKFLOW_QUERY_KEY,
      refetchType: 'active',
    })
  })

  it('marks an unpatched snapshot stale without starting an active refetch', async () => {
    const queryClient = createQueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    await invalidateWeldJoints(queryClient)

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: WELD_COMPLETE_SNAPSHOT_QUERY_KEY,
      refetchType: 'none',
    })
  })
})

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })
}
