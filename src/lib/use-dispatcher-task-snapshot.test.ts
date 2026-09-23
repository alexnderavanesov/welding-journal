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

vi.mock('@/lib/business-date', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/business-date')>(),
  getBusinessDateIso: vi.fn(() => '2026-09-23'),
}))

const serverMocks = vi.hoisted(() => ({
  getDispatcherTaskSnapshot: vi.fn(),
  refreshDispatcherTaskSnapshot: vi.fn(),
  getDispatcherTaskBatch: vi.fn(),
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
  })

  it('hides cards locally without changing the complete server task snapshot', () => {
    const snapshotTasks = [
      { key: 'task-visible', code: 'ДЗ-01' },
      { key: 'task-hidden', code: 'ДЗ-18' },
    ]

    expect(filterDismissedDispatcherTasks(snapshotTasks, new Set(['task-hidden']))).toEqual([
      { key: 'task-visible', code: 'ДЗ-01' },
    ])
    expect(snapshotTasks).toEqual([
      { key: 'task-visible', code: 'ДЗ-01' },
      { key: 'task-hidden', code: 'ДЗ-18' },
    ])
  })

  it('does not hide an obligatory system warning', () => {
    const warning = {
      kind: 'check',
      key: 'sp-01:1',
      systemWarningCode: 'СП-01',
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
