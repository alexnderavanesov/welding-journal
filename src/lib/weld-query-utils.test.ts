import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { subscribeWeldPageRefresh } from './weld-page-refresh'
import { DISPATCHER_ACCEPTED_WARNINGS_QUERY_KEY } from '@/lib/dispatcher-accepted-warning-query'
import type { WeldRow } from '@/lib/dispatcher-types'
import {
  DISPATCHER_TASK_REFRESH_QUERY_KEY,
  DISPATCHER_TASK_SNAPSHOT_QUERY_KEY,
  DUPLICATE_CONTROL_CANDIDATES_QUERY_KEY,
  DUPLICATE_CONTROL_REGISTRY_QUERY_KEY,
  GENERATED_DOCUMENT_HISTORY_QUERY_KEY,
  scheduleWeldDataRefresh,
  LNK_WORKFLOW_QUERY_KEY,
  LNK_WORKFLOW_ROWS_QUERY_KEY,
  STATISTICS_SERVER_QUERY_KEY,
  WELD_COMPLETE_SNAPSHOT_QUERY_KEY,
  WELD_DATA_USAGE_QUERY_KEY,
  WELD_DOCUMENT_GENERATION_QUERY_KEY,
  WELD_FINAL_STATUS_CONTEXT_QUERY_KEY,
  WELD_FORM_SUGGESTIONS_QUERY_KEY,
  WELD_REPORT_CONTEXT_QUERY_KEY,
  WELD_ROWS_BY_IDS_QUERY_KEY,
} from '@/lib/weld-query-utils'

describe('weld query cache updates', () => {
  it('defers stale editor suggestions until the next opening, without refetching the closing editor', async () => {
    const queryClient = createQueryClient()
    const queryKey = [...WELD_FORM_SUGGESTIONS_QUERY_KEY, 'line']
    const queryFn = vi.fn(async () => ['L1'])
    await queryClient.fetchQuery({ queryKey, queryFn, staleTime: 60_000 })
    const observer = new QueryObserver(queryClient, { queryKey, queryFn, staleTime: 60_000 })
    const close = observer.subscribe(() => {})
    scheduleWeldDataRefresh(queryClient, { upsertRows: [{ id: 1, line: 'L2' }] })
    expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(true)
    expect(queryFn).toHaveBeenCalledTimes(1)
    close()
    const reopen = observer.subscribe(() => {})
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2))
    reopen(); queryClient.clear()
  })
  it('patches saved data immediately without waiting for background requests', () => {
    const queryClient = createQueryClient()
    queryClient.setQueryData(WELD_COMPLETE_SNAPSHOT_QUERY_KEY, [{ id: 1, joint: 'F1' }] as WeldRow[])
    // A slow or disconnected dependent screen must not keep the save pending.
    const pending = new Promise<void>(() => {})
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockReturnValue(pending)

    const refreshed = vi.fn()
    const unsubscribe = subscribeWeldPageRefresh(queryClient, refreshed)
    const notification = scheduleWeldDataRefresh(queryClient, {
      upsertRows: [{ id: 1, joint: 'F2' }],
    })

    expect(notification).toBeUndefined()
    expect(queryClient.getQueryData<WeldRow[]>(WELD_COMPLETE_SNAPSHOT_QUERY_KEY)?.[0].joint).toBe('F2')
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: STATISTICS_SERVER_QUERY_KEY })
    expect(refreshed).toHaveBeenCalledOnce()
    unsubscribe()
    queryClient.clear()
  })

  it('invalidates exception names and cascaded deletions without refetching inactive pages', async () => {
    const queryClient = createQueryClient()
    const queryKey = [...DISPATCHER_ACCEPTED_WARNINGS_QUERY_KEY, { page: 1 }]
    const queryFn = vi.fn(async () => ({ items: [{ context: 'Old object' }] }))
    await queryClient.fetchQuery({ queryKey, queryFn })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    scheduleWeldDataRefresh(queryClient, { deleteIds: [1] })
    expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(true)
    expect(queryFn).toHaveBeenCalledTimes(1)
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: DISPATCHER_ACCEPTED_WARNINGS_QUERY_KEY, refetchType: 'none' })
  })
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

    scheduleWeldDataRefresh(queryClient, {
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
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: WELD_FORM_SUGGESTIONS_QUERY_KEY, refetchType: 'none' })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['line-program'], refetchType: 'active' })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: DUPLICATE_CONTROL_CANDIDATES_QUERY_KEY })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: DUPLICATE_CONTROL_REGISTRY_QUERY_KEY })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: GENERATED_DOCUMENT_HISTORY_QUERY_KEY })
  })

  it('leaves section/page ownership to the workspace without transient invalidation or refetch', async () => {
    const queryClient = createQueryClient()
    const lists = [['line-program', 'section'], ['line-program', 'section', 'lines', 'search'], ['line-program', 'page', 'lines', 'search', 0]]
    for (const key of lists) queryClient.setQueryData(key, { rows: [] })
    const detailKey = ['line-program', 'calculation', 1]
    queryClient.setQueryData(detailKey, { line: {} })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    scheduleWeldDataRefresh(queryClient, { upsertRows: [{ id: 1, hasRk: 'да' }] }, { lineProgramListsHandled: true })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['line-program'], predicate: expect.any(Function), refetchType: 'none' })
    for (const key of lists) expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false)
    expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBe(true)
  })

  it('removes deleted rows from an existing complete snapshot', async () => {
    const queryClient = createQueryClient()
    queryClient.setQueryData(WELD_COMPLETE_SNAPSHOT_QUERY_KEY, [{ id: 1 }, { id: 2 }] as WeldRow[])

    scheduleWeldDataRefresh(queryClient, { deleteIds: [1] })

    expect(queryClient.getQueryData<WeldRow[]>(WELD_COMPLETE_SNAPSHOT_QUERY_KEY)?.map((row) => row.id)).toEqual([2])
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

    scheduleWeldDataRefresh(queryClient, {
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

    scheduleWeldDataRefresh(queryClient, {
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

    scheduleWeldDataRefresh(
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

    scheduleWeldDataRefresh(queryClient)

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
