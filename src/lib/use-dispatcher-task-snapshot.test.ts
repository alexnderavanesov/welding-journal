import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  filterDismissedDispatcherTasks,
  useDispatcherTaskSnapshot,
} from '@/lib/use-dispatcher-task-snapshot'
import type { RepeatedJointTask } from '@/lib/dispatcher-types'
import { getBusinessDateIso } from '@/lib/business-date'
import { DISPATCHER_TASK_REFRESH_QUERY_KEY } from '@/lib/weld-query-utils'
import { DISPATCHER_TASK_CALCULATION_VERSION } from '@/lib/dispatcher-task-index-payload'
import { subscribeWeldPageRefresh } from '@/lib/weld-page-refresh'

vi.mock('@/lib/business-date', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/business-date')>(),
  getBusinessDateIso: vi.fn(() => '2026-09-23'),
}))

const serverMocks = vi.hoisted(() => ({
  getDispatcherTaskSnapshot: vi.fn(),
  refreshDispatcherTaskSnapshot: vi.fn(),
  getDispatcherTaskBatch: vi.fn(),
  getDispatcherTaskVersion: vi.fn(),
}))

vi.mock('@/server/dispatcher-task-snapshot', () => serverMocks)
vi.mock('@/server/dispatcher-task-pages', () => ({ getDispatcherTaskBatch: serverMocks.getDispatcherTaskBatch }))

describe('dispatcher task snapshot visibility', () => {
  afterEach(() => vi.mocked(getBusinessDateIso).mockReturnValue('2026-09-23'))
  beforeEach(() => {
    vi.clearAllMocks()
    serverMocks.getDispatcherTaskSnapshot.mockResolvedValue(snapshot(false))
    serverMocks.refreshDispatcherTaskSnapshot.mockResolvedValue(snapshot(true))
    serverMocks.getDispatcherTaskBatch.mockResolvedValue([])
    serverMocks.getDispatcherTaskVersion.mockResolvedValue({ sourceRevision: 7, computedRevision: 7, computedAt: snapshot(true).computedAt,
      businessDate: '2026-09-23', computedForBusinessDate: '2026-09-23', calculationVersion: DISPATCHER_TASK_CALCULATION_VERSION })
  })

  it('shares one pending POST across own-save revisions instead of occupying browser connections', async () => {
    let finish!: (value: ReturnType<typeof snapshot>) => void
    serverMocks.refreshDispatcherTaskSnapshot.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const { result, queryClient } = mountActivitySnapshot()
    await waitFor(() => expect(serverMocks.refreshDispatcherTaskSnapshot).toHaveBeenCalledOnce())
    for (let revision = 8; revision <= 15; revision++) {
      await act(async () => { queryClient.setQueryData(['dispatcher-task-snapshot'], snapshot(false, revision)) })
      await waitFor(() => expect(result.current.data?.sourceRevision).toBe(revision))
    }
    expect(serverMocks.refreshDispatcherTaskSnapshot).toHaveBeenCalledOnce()
    await act(async () => { finish(snapshot(true, 15)) })
    await waitFor(() => expect(result.current.data?.computedRevision).toBe(15))
  })

  it('makes one sequential catch-up when the shared response predates an already known save', async () => {
    let finish!: (value: ReturnType<typeof snapshot>) => void
    serverMocks.refreshDispatcherTaskSnapshot
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
      .mockResolvedValue(snapshot(true, 10))
    const { result, queryClient } = mountActivitySnapshot()
    await waitFor(() => expect(serverMocks.refreshDispatcherTaskSnapshot).toHaveBeenCalledOnce())
    for (const revision of [8, 9, 10]) {
      await act(async () => { queryClient.setQueryData(['dispatcher-task-snapshot'], snapshot(false, revision)) })
      await waitFor(() => expect(result.current.data?.sourceRevision).toBe(revision))
    }
    expect(serverMocks.refreshDispatcherTaskSnapshot).toHaveBeenCalledOnce()
    await act(async () => { finish(snapshot(true, 7)) })
    await waitFor(() => expect(result.current.data?.computedRevision).toBe(10))
    expect(serverMocks.refreshDispatcherTaskSnapshot).toHaveBeenCalledTimes(2)
  })

  it('hides cards locally without changing the complete server task snapshot', () => {
    const snapshotTasks = [
      { key: 'task-visible', code: 'ДЗ-01' },
      { key: 'task-hidden', code: 'СП-02' },
    ]

    expect(filterDismissedDispatcherTasks(snapshotTasks, new Set(['task-hidden']))).toEqual([
      { key: 'task-visible', code: 'ДЗ-01' },
    ])
    expect(snapshotTasks).toEqual([
      { key: 'task-visible', code: 'ДЗ-01' },
      { key: 'task-hidden', code: 'СП-02' },
    ])
  })

  it('uses only one tiny version request on an unchanged open/focus burst', async () => {
    serverMocks.getDispatcherTaskSnapshot.mockResolvedValue(snapshot(true))
    const { result, rerender } = mountActivitySnapshot()
    await waitFor(() => expect(result.current.data?.isFresh).toBe(true))
    rerender({ open: true }); window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange'))
    await waitFor(() => expect(serverMocks.getDispatcherTaskVersion).toHaveBeenCalledOnce())
    expect(serverMocks.getDispatcherTaskSnapshot).toHaveBeenCalledOnce()
    expect(serverMocks.refreshDispatcherTaskSnapshot).not.toHaveBeenCalled()
  })

  it('retains the displayed snapshot when compressed transport fails, without automatic request loops', async () => {
    serverMocks.getDispatcherTaskSnapshot.mockResolvedValueOnce(snapshot(true, 7))
      .mockResolvedValueOnce({ encoding: 'gzip-base64-v1', summary: '%not-base64%', taskChunks: [] })
      .mockResolvedValue(snapshot(true, 8))
    const { result } = mountActivitySnapshot()
    await waitFor(() => expect(result.current.data?.computedRevision).toBe(7))
    await act(async () => { await expect(result.current.refreshTasks()).rejects.toThrow() })
    expect(result.current.data?.computedRevision).toBe(7)
    expect(serverMocks.getDispatcherTaskSnapshot).toHaveBeenCalledTimes(2)
    expect(serverMocks.refreshDispatcherTaskSnapshot).not.toHaveBeenCalled()
    await act(async () => { await result.current.refreshTasks() })
    await waitFor(() => expect(result.current.data?.computedRevision).toBe(8))
    expect(serverMocks.getDispatcherTaskSnapshot).toHaveBeenCalledTimes(3)
  })

  it('notifies a closed dispatcher on changed focus with one scalar probe and no snapshot read or recalculation', async () => {
    serverMocks.getDispatcherTaskSnapshot.mockResolvedValue(snapshot(true, 7))
    const { result, queryClient } = mountActivitySnapshot()
    await waitFor(() => expect(result.current.data?.isFresh).toBe(true))
    const listener = vi.fn()
    const unsubscribe = subscribeWeldPageRefresh(queryClient, listener)
    serverMocks.getDispatcherTaskVersion.mockResolvedValue({ sourceRevision: 8, computedRevision: 7,
      businessDate: '2026-09-23', computedForBusinessDate: '2026-09-23', calculationVersion: DISPATCHER_TASK_CALCULATION_VERSION })
    act(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')) })
    await waitFor(() => expect(listener).toHaveBeenCalledWith({ reason: 'background' }))
    expect(serverMocks.getDispatcherTaskVersion).toHaveBeenCalledOnce()
    expect(serverMocks.getDispatcherTaskSnapshot).toHaveBeenCalledOnce()
    expect(serverMocks.refreshDispatcherTaskSnapshot).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('retains stale tasks after a corrupt POST and releases the shared request for explicit retry', async () => {
    serverMocks.refreshDispatcherTaskSnapshot
      .mockResolvedValueOnce({ encoding: 'gzip-base64-v1', summary: '%not-base64%', taskChunks: [] })
      .mockResolvedValue(snapshot(true, 7))
    const { result } = mountActivitySnapshot()
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error))
    expect(result.current.data).toEqual(snapshot(false, 7))
    expect(serverMocks.refreshDispatcherTaskSnapshot).toHaveBeenCalledOnce()
    await act(async () => { await result.current.refreshTasks() })
    await waitFor(() => expect(result.current.data?.isFresh).toBe(true))
    expect(result.current.error).toBeNull()
    expect(serverMocks.refreshDispatcherTaskSnapshot).toHaveBeenCalledTimes(2)
    expect(serverMocks.getDispatcherTaskSnapshot).toHaveBeenCalledTimes(2)
  })

  it.each([false, true])('updates all task types after another client changed data (already computed: %s)', async computed => {
    serverMocks.getDispatcherTaskSnapshot.mockResolvedValueOnce(snapshot(true, 7)).mockResolvedValue(snapshot(computed, 8))
    serverMocks.getDispatcherTaskVersion.mockResolvedValue({ sourceRevision: 8, computedRevision: computed ? 8 : 7, computedAt: snapshot(true).computedAt,
      businessDate: '2026-09-23', computedForBusinessDate: '2026-09-23', calculationVersion: DISPATCHER_TASK_CALCULATION_VERSION })
    // A real recalculation also changes computedAt, hence its refresh query key.
    serverMocks.refreshDispatcherTaskSnapshot.mockResolvedValue({ ...snapshot(true, 8), computedAt: '2026-09-23T12:01:00.000Z' })
    const { result, rerender, queryClient } = mountActivitySnapshot()
    const refreshRows = vi.fn()
    const unsubscribe = subscribeWeldPageRefresh(queryClient, refreshRows)
    await waitFor(() => expect(result.current.data?.sourceRevision).toBe(7))
    rerender({ open: true })
    await waitFor(() => expect(result.current.data?.computedRevision).toBe(8))
    expect(serverMocks.getDispatcherTaskVersion).toHaveBeenCalledOnce()
    expect(serverMocks.getDispatcherTaskSnapshot).toHaveBeenCalledTimes(2)
    expect(serverMocks.refreshDispatcherTaskSnapshot).toHaveBeenCalledTimes(computed ? 0 : 1)
    await waitFor(() => expect(refreshRows).toHaveBeenCalled())
    expect(refreshRows.mock.calls.length).toBeLessThanOrEqual(2) // notifications coalesce into one grid read
    unsubscribe()
  })

  it('rechecks at a business-date boundary with no source mutations', async () => {
    // Midnight invalidates freshness, not the monotonically stored revisions.
    serverMocks.getDispatcherTaskSnapshot.mockResolvedValueOnce(snapshot(true))
      .mockResolvedValue({ ...snapshot(true), isFresh: false })
    serverMocks.getDispatcherTaskVersion.mockResolvedValue({ sourceRevision: 7, computedRevision: 7, computedAt: snapshot(true).computedAt,
      businessDate: '2026-09-23', computedForBusinessDate: '2026-09-22', calculationVersion: DISPATCHER_TASK_CALCULATION_VERSION })
    const { result, rerender } = mountActivitySnapshot()
    await waitFor(() => expect(result.current.data?.isFresh).toBe(true))
    rerender({ open: true })
    await waitFor(() => expect(serverMocks.refreshDispatcherTaskSnapshot).toHaveBeenCalledOnce())
    expect(serverMocks.getDispatcherTaskSnapshot).toHaveBeenCalledTimes(2)
  })

  it('shows a probe failure with explicit retry, without dropping cached tasks or a retry loop', async () => {
    serverMocks.getDispatcherTaskSnapshot.mockResolvedValue(snapshot(true))
    serverMocks.getDispatcherTaskVersion.mockRejectedValue(new Error('Нет связи'))
    const { result, rerender } = mountActivitySnapshot()
    await waitFor(() => expect(result.current.data?.isFresh).toBe(true))
    rerender({ open: true })
    await waitFor(() => expect(result.current.taskBatchError?.message).toBe('Нет связи'))
    expect(result.current.data?.sourceRevision).toBe(7)
    await act(async () => { await result.current.retryTaskBatch() })
    expect(result.current.taskBatchError).toBeNull()
    expect(serverMocks.getDispatcherTaskVersion).toHaveBeenCalledOnce()
  })

  it('ignores a late probe older than an own-save snapshot', async () => {
    let resolve!: (value: unknown) => void
    serverMocks.getDispatcherTaskVersion.mockImplementation(() => new Promise(done => { resolve = done }))
    serverMocks.getDispatcherTaskSnapshot.mockResolvedValue(snapshot(true))
    const { result, rerender, queryClient } = mountActivitySnapshot()
    await waitFor(() => expect(result.current.data?.isFresh).toBe(true))
    rerender({ open: true })
    await waitFor(() => expect(serverMocks.getDispatcherTaskVersion).toHaveBeenCalledOnce())
    await act(async () => {
      queryClient.setQueryData(['dispatcher-task-snapshot'], snapshot(true, 9))
      resolve({ sourceRevision: 8, computedRevision: 7 })
    })
    await waitFor(() => expect(result.current.data?.sourceRevision).toBe(9))
    expect(serverMocks.getDispatcherTaskSnapshot).toHaveBeenCalledOnce()
  })

  it('bounds refreshes when other users keep saving, then allows an explicit retry', async () => {
    serverMocks.getDispatcherTaskSnapshot.mockResolvedValueOnce(snapshot(false, 7)).mockResolvedValue(snapshot(false, 9))
    serverMocks.refreshDispatcherTaskSnapshot
      .mockResolvedValueOnce(snapshot(false, 8))
      .mockResolvedValueOnce(snapshot(false, 9))
      .mockResolvedValue(snapshot(true, 10))
    const { result } = mountActivitySnapshot()
    await waitFor(() => expect(result.current.taskBatchError?.message).toContain('продолжают изменяться'))
    expect(serverMocks.refreshDispatcherTaskSnapshot).toHaveBeenCalledTimes(2)
    await act(async () => { await result.current.retryTaskBatch() })
    await waitFor(() => expect(result.current.data?.computedRevision).toBe(10))
    expect(serverMocks.refreshDispatcherTaskSnapshot).toHaveBeenCalledTimes(3)
  })

  it('does not replace an already published snapshot with a late stale response of the same source revision', async () => {
    let resolve!: (value: unknown) => void
    serverMocks.getDispatcherTaskSnapshot.mockResolvedValue(snapshot(false, 7))
    serverMocks.refreshDispatcherTaskSnapshot.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const { result, queryClient } = mountActivitySnapshot()
    await waitFor(() => expect(serverMocks.refreshDispatcherTaskSnapshot).toHaveBeenCalledOnce())
    await act(async () => { queryClient.setQueryData(['dispatcher-task-snapshot'], snapshot(true, 7)); resolve(snapshot(false, 7)) })
    await waitFor(() => expect(result.current.data?.isFresh).toBe(true))
    expect(result.current.data?.computedRevision).toBe(7)
    expect(result.current.taskBatchError).toBeNull()
  })

  it.each(['revision', 'business-date'] as const)('does not downgrade a newer %s publication when an older GET finishes later', async kind => {
    let resolve!: (value: ReturnType<typeof snapshot>) => void
    serverMocks.getDispatcherTaskSnapshot.mockResolvedValueOnce(snapshot(true, 7))
      .mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const { result, queryClient } = mountActivitySnapshot()
    await waitFor(() => expect(result.current.data?.computedRevision).toBe(7))
    let pending!: ReturnType<typeof result.current.refreshTasks>
    act(() => { pending = result.current.refreshTasks() })
    await waitFor(() => expect(serverMocks.getDispatcherTaskSnapshot).toHaveBeenCalledTimes(2))
    const newer = kind === 'revision' ? snapshot(true, 9) : { ...snapshot(true, 8), computedAt: '2026-09-23T10:00:00.000Z' }
    await act(async () => {
      queryClient.setQueryData(['dispatcher-task-snapshot'], newer)
      resolve(snapshot(true, 8))
      await pending
    })
    await waitFor(() => expect(result.current.data).toEqual(newer))
    expect(serverMocks.refreshDispatcherTaskSnapshot).not.toHaveBeenCalled()
  })

  it('does not hide an obligatory system warning', () => {
    const warning = {
      kind: 'check',
      key: 'sp-01:1',
      systemWarningCode: 'СП-06',
    }

    expect(filterDismissedDispatcherTasks([warning], new Set([warning.key]))).toEqual([warning])
  })

  it('starts one coalesced refresh for a stale revision and ignores focus or reconnect events', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children)
    const { result, rerender } = renderHook(
      () => useDispatcherTaskSnapshot({ dismissedRepeatedJointTaskKeys: new Set() }),
      { wrapper },
    )

    await waitFor(() => {
      expect(serverMocks.getDispatcherTaskSnapshot).toHaveBeenCalledTimes(1)
      expect(serverMocks.refreshDispatcherTaskSnapshot).toHaveBeenCalledTimes(1)
      expect(result.current.data?.isFresh).toBe(true)
    })

    rerender()
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('online'))
    await new Promise((resolve) => setTimeout(resolve, 25))

    expect(serverMocks.getDispatcherTaskSnapshot).toHaveBeenCalledTimes(1)
    expect(serverMocks.refreshDispatcherTaskSnapshot).toHaveBeenCalledTimes(1)
  })

  it('retries once for a newer stale revision without refetching on focus or reconnect', async () => {
    serverMocks.getDispatcherTaskSnapshot.mockResolvedValue(snapshot(false, 7))
    serverMocks.refreshDispatcherTaskSnapshot
      .mockResolvedValueOnce(snapshot(false, 8))
      .mockResolvedValueOnce(snapshot(true, 8))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children)
    const { result, rerender } = renderHook(
      () => useDispatcherTaskSnapshot({ dismissedRepeatedJointTaskKeys: new Set() }),
      { wrapper },
    )

    await waitFor(() => {
      expect(serverMocks.refreshDispatcherTaskSnapshot).toHaveBeenCalledTimes(2)
      expect(result.current.data?.sourceRevision).toBe(8)
      expect(result.current.data?.isFresh).toBe(true)
    })

    rerender()
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('online'))
    await new Promise((resolve) => setTimeout(resolve, 25))

    expect(serverMocks.getDispatcherTaskSnapshot).toHaveBeenCalledTimes(1)
    expect(serverMocks.refreshDispatcherTaskSnapshot).toHaveBeenCalledTimes(2)
  })

  it('does not issue snapshot or refresh requests while disabled', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children)
    renderHook(
      () => useDispatcherTaskSnapshot({ dismissedRepeatedJointTaskKeys: new Set(), enabled: false }),
      { wrapper },
    )
    await new Promise((resolve) => setTimeout(resolve, 25))

    expect(serverMocks.getDispatcherTaskSnapshot).not.toHaveBeenCalled()
    expect(serverMocks.refreshDispatcherTaskSnapshot).not.toHaveBeenCalled()
    expect(serverMocks.getDispatcherTaskBatch).not.toHaveBeenCalled()
  })

  it('does not reuse yesterday’s completed refresh when the same source revision becomes stale', async () => {
    const oldSnapshot = { ...snapshot(true, 7), computedAt: '2026-09-22T10:00:00.000Z' }
    serverMocks.getDispatcherTaskSnapshot.mockResolvedValue({ ...oldSnapshot, isFresh: false })
    serverMocks.refreshDispatcherTaskSnapshot.mockResolvedValue({
      ...snapshot(true, 8), computedAt: '2026-09-23T10:00:00.000Z',
    })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData([
      ...DISPATCHER_TASK_REFRESH_QUERY_KEY, 7, oldSnapshot.computedAt, '2026-09-22',
    ], oldSnapshot)
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children)
    const { result } = renderHook(
      () => useDispatcherTaskSnapshot({ dismissedRepeatedJointTaskKeys: new Set() }), { wrapper },
    )
    await waitFor(() => expect(result.current.data?.computedRevision).toBe(8))
    expect(serverMocks.refreshDispatcherTaskSnapshot).toHaveBeenCalledTimes(1)
  })

  it('exposes a failed refresh and retries it explicitly without polling or a loop', async () => {
    serverMocks.refreshDispatcherTaskSnapshot
      .mockRejectedValueOnce(new Error('Пересчёт временно недоступен'))
      .mockResolvedValueOnce(snapshot(true))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children)
    const { result, rerender } = renderHook(
      () => useDispatcherTaskSnapshot({ dismissedRepeatedJointTaskKeys: new Set() }), { wrapper },
    )
    await waitFor(() => expect(result.current.taskBatchError?.message).toBe('Пересчёт временно недоступен'))
    expect(result.current.isRefreshing).toBe(false)
    rerender()
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('online'))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)) })
    expect(serverMocks.refreshDispatcherTaskSnapshot).toHaveBeenCalledTimes(1)
    await act(async () => { await result.current.retryTaskBatch() })
    await waitFor(() => expect(result.current.data?.isFresh).toBe(true))
    expect(result.current.taskBatchError).toBeNull()
    expect(serverMocks.getDispatcherTaskSnapshot).toHaveBeenCalledTimes(2)
    expect(serverMocks.refreshDispatcherTaskSnapshot).toHaveBeenCalledTimes(2)
  })

  it('shows all tasks in a small snapshot without a page request and loads task 5,001 in one batch', async () => {
    const firstTasks = Array.from({ length: 5_000 }, (_, index) => ({
      kind: 'check',
      key: `task-${index + 1}`,
      baseJoint: `J${index + 1}`,
      row: { id: index + 1, projectTitle: 'P', subtitleCode: 'S', line: 'L', joint: `J${index + 1}` },
      sourceRow: { id: index + 1 },
    })) as unknown as RepeatedJointTask[]
    const nextTask = {
      kind: 'check', key: 'task-5001', baseJoint: 'J5001',
      row: { id: 5_001, projectTitle: 'P', subtitleCode: 'S', line: 'L', joint: 'J5001' },
      sourceRow: { id: 5_001 },
    } as unknown as RepeatedJointTask
    serverMocks.getDispatcherTaskSnapshot.mockResolvedValue({
      ...snapshot(true),
      repeatedJointTasks: firstTasks,
      repeatedJointTaskCount: 5_001,
      repeatedJointTaskPageCount: 51,
      repeatedJointTasksTruncated: true,
    })
    serverMocks.getDispatcherTaskBatch.mockResolvedValue([nextTask])
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children)
    const { result } = renderHook(
      () => useDispatcherTaskSnapshot({ dismissedRepeatedJointTaskKeys: new Set() }),
      { wrapper },
    )

    await waitFor(() => expect(result.current.repeatedJointTaskCount).toBe(5_001))
    expect(result.current.repeatedJointTasks).toHaveLength(5_000)
    expect(serverMocks.getDispatcherTaskBatch).not.toHaveBeenCalled()
    await act(async () => { await result.current.loadMoreTasks() })
    await waitFor(() => expect(result.current.repeatedJointTasks).toHaveLength(5_001))
    expect(result.current.repeatedJointTasks.at(-1)?.key).toBe('task-5001')
    expect(result.current.hasMoreTasks).toBe(false)
    expect(serverMocks.getDispatcherTaskBatch).toHaveBeenCalledOnce()
    expect(serverMocks.getDispatcherTaskBatch).toHaveBeenCalledWith({
      data: { offset: 5_000, limit: 200, computedRevision: 7 },
    })
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('online'))
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(serverMocks.getDispatcherTaskBatch).toHaveBeenCalledOnce()
  })

  it('does not duplicate a task in contextual advice when it is in both snapshot and page', async () => {
    const task = {
      kind: 'check', key: 'same-task', baseJoint: 'F1',
      row: { id: 1, projectTitle: 'P', subtitleCode: 'S', line: 'L', joint: 'F1' },
      sourceRow: { id: 1 },
    } as unknown as RepeatedJointTask
    serverMocks.getDispatcherTaskSnapshot.mockResolvedValue({
      ...snapshot(true), repeatedJointTasks: [task], repeatedJointTaskCount: 1,
      repeatedJointTaskPageCount: 1,
    })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children)
    const { result } = renderHook(
      () => useDispatcherTaskSnapshot({ dismissedRepeatedJointTaskKeys: new Set() }),
      { wrapper },
    )

    await waitFor(() => expect(result.current.repeatedJointTasks).toHaveLength(1))
    expect(result.current.adviceRepeatedJointTasks.map((candidate) => candidate.key)).toEqual(['same-task'])
    expect(serverMocks.getDispatcherTaskBatch).not.toHaveBeenCalled()
  })

  it('reloads the snapshot before retrying a batch invalidated by another user', async () => {
    serverMocks.getDispatcherTaskSnapshot
      .mockResolvedValueOnce({ ...snapshot(true, 7), repeatedJointTaskCount: 1, repeatedJointTaskPageCount: 1 })
      .mockResolvedValueOnce({ ...snapshot(true, 8), repeatedJointTaskCount: 1, repeatedJointTaskPageCount: 1 })
    serverMocks.getDispatcherTaskBatch.mockRejectedValueOnce(new Error('Расчет диспетчера изменился. Обновите список задач.'))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children)
    const { result } = renderHook(
      () => useDispatcherTaskSnapshot({ dismissedRepeatedJointTaskKeys: new Set() }),
      { wrapper },
    )

    await waitFor(() => expect(result.current.hasMoreTasks).toBe(true))
    await act(async () => { await result.current.loadMoreTasks() })
    expect(result.current.taskBatchError).toBeInstanceOf(Error)
    await act(async () => { await result.current.retryTaskBatch() })
    await waitFor(() => expect(result.current.taskBatchError).toBeNull())

    expect(serverMocks.getDispatcherTaskSnapshot).toHaveBeenCalledTimes(2)
    expect(serverMocks.getDispatcherTaskBatch).toHaveBeenCalledOnce()
    expect(result.current.data?.computedRevision).toBe(8)
  })

  it('retries the same batch after checking that the snapshot revision is unchanged', async () => {
    serverMocks.getDispatcherTaskSnapshot.mockResolvedValue({
      ...snapshot(true), repeatedJointTaskCount: 1, repeatedJointTaskPageCount: 1,
    })
    serverMocks.getDispatcherTaskBatch
      .mockRejectedValueOnce(new Error('Временная ошибка загрузки задач.'))
      .mockResolvedValueOnce([{ kind: 'check', key: 'new-task', row: { id: 1 } }])
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children)
    const { result } = renderHook(
      () => useDispatcherTaskSnapshot({ dismissedRepeatedJointTaskKeys: new Set() }),
      { wrapper },
    )

    await waitFor(() => expect(result.current.hasMoreTasks).toBe(true))
    await act(async () => { await result.current.loadMoreTasks() })
    expect(result.current.taskBatchError).toBeInstanceOf(Error)
    await act(async () => { await result.current.retryTaskBatch() })
    await waitFor(() => expect(result.current.taskBatchError).toBeNull())

    expect(serverMocks.getDispatcherTaskSnapshot).toHaveBeenCalledTimes(2)
    expect(serverMocks.getDispatcherTaskBatch).toHaveBeenCalledTimes(2)
    expect(serverMocks.getDispatcherTaskBatch).toHaveBeenLastCalledWith({
      data: { offset: 0, limit: 200, computedRevision: 7 },
    })
    expect(result.current.repeatedJointTasks.map((task) => task.key)).toEqual(['new-task'])
  })

  it('waits for the coalesced refresh when a retry observes an unfinished calculation', async () => {
    serverMocks.getDispatcherTaskSnapshot
      .mockResolvedValueOnce({ ...snapshot(true, 7), repeatedJointTaskCount: 1, repeatedJointTaskPageCount: 1 })
      .mockResolvedValueOnce({ ...snapshot(false, 8), repeatedJointTaskCount: 1, repeatedJointTaskPageCount: 1 })
    serverMocks.refreshDispatcherTaskSnapshot.mockResolvedValue({
      ...snapshot(true, 8), repeatedJointTaskCount: 1, repeatedJointTaskPageCount: 1,
    })
    serverMocks.getDispatcherTaskBatch.mockRejectedValueOnce(new Error('Расчет диспетчера изменился. Обновите список задач.'))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children)
    const { result } = renderHook(
      () => useDispatcherTaskSnapshot({ dismissedRepeatedJointTaskKeys: new Set() }),
      { wrapper },
    )

    await waitFor(() => expect(result.current.hasMoreTasks).toBe(true))
    await act(async () => { await result.current.loadMoreTasks() })
    expect(result.current.taskBatchError).toBeInstanceOf(Error)
    await act(async () => { await result.current.retryTaskBatch() })
    await waitFor(() => {
      expect(result.current.data?.computedRevision).toBe(8)
      expect(result.current.data?.isFresh).toBe(true)
      expect(result.current.taskBatchError).toBeNull()
    })

    expect(serverMocks.getDispatcherTaskSnapshot).toHaveBeenCalledTimes(2)
    expect(serverMocks.refreshDispatcherTaskSnapshot).toHaveBeenCalledTimes(1)
    expect(serverMocks.getDispatcherTaskBatch).toHaveBeenCalledOnce()
  })
})

function mountActivitySnapshot() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: queryClient }, children)
  return { ...renderHook(({ open }) => useDispatcherTaskSnapshot({ dismissedRepeatedJointTaskKeys: new Set(), workspaceOpen: open }), { wrapper, initialProps: { open: false } }), queryClient }
}

function snapshot(isFresh: boolean, sourceRevision = 7) {
  return {
    duplicateKeys: [],
    repeatedJointTasks: [],
    repeatedJointTaskCount: 0,
    repeatedJointTaskPageCount: 0,
    repeatedJointTasksTruncated: false,
    taskFilterOptions: [],
    welderStampExpiryTasks: [],
    sourceRevision,
    computedRevision: isFresh ? sourceRevision : sourceRevision - 1,
    isFresh,
    computedAt: '2026-09-22T10:00:00.000Z',
  }
}
