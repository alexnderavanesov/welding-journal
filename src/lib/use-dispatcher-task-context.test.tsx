import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { useDispatcherTaskContext, useDispatcherTasksByRow } from './use-dispatcher-task-context'
import { getDispatcherTasksForJointPicture } from './dispatcher-task-row-codes'
import type { RepeatedJointTask, WeldRow } from './dispatcher-types'

const server = vi.hoisted(() => vi.fn())
vi.mock('@/server/dispatcher-task-context', () => ({ getDispatcherTaskContext: server }))
beforeEach(() => { server.mockReset(); server.mockResolvedValue({ tasks: [], total: 0 }) })
const rows = (count: number) => Array.from({ length: count }, (_, i) => ({ id: i + 1, joint: `S${i + 1}`, line: 'L', projectTitle: 'P' }) as WeldRow)
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}
it('reads only missing contexts, reuses portions on append and never refetches on focus/reconnect', async () => {
  const { wrapper, client } = setup()
  const { result, rerender } = renderHook(({ count, needed, revision }) => useDispatcherTaskContext(rows(count), revision, needed), {
    wrapper, initialProps: { count: 500, needed: false, revision: 1 },
  })
  expect(server).not.toHaveBeenCalled()
  rerender({ count: 500, needed: true, revision: 1 })
  await waitFor(() => expect(result.current.pending).toBe(false))
  rerender({ count: 1000, needed: true, revision: 1 })
  await waitFor(() => expect(result.current.pending).toBe(false))
  expect(server).toHaveBeenCalledTimes(2)
  expect(server.mock.calls.map(([input]) => input.data.rowIds.length)).toEqual([500, 500])
  await act(async () => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')) })
  expect(server).toHaveBeenCalledTimes(2)
  rerender({ count: 1000, needed: true, revision: 2 })
  await waitFor(() => expect(server).toHaveBeenCalledTimes(4))
  client.clear()
})
it('does not publish a late previous revision and exposes failure instead of an empty completed context', async () => {
  const { wrapper, client } = setup()
  let resolve!: (value: { tasks: RepeatedJointTask[]; total: number }) => void
  server.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const { result, rerender } = renderHook(({ revision }) => useDispatcherTaskContext(rows(1), revision, true), { wrapper, initialProps: { revision: 1 } })
  await waitFor(() => expect(server).toHaveBeenCalledOnce())
  server.mockRejectedValueOnce(new Error('Версия изменилась'))
  rerender({ revision: 2 })
  await waitFor(() => expect(result.current.error?.message).toBe('Версия изменилась'))
  await act(async () => resolve({ tasks: [{ key: 'old' } as RepeatedJointTask], total: 1 }))
  expect(result.current.tasks).toEqual([])
  expect(result.current.error).toBeTruthy()
  client.clear()
})
it('reuses rows when appended server pages interleave IDs instead of reloading every old portion', async () => {
  const { wrapper, client } = setup()
  const all = rows(1500)
  const first = all.filter(row => row.id % 2 === 0)
  const { result, rerender } = renderHook(({ source }) => useDispatcherTaskContext(source, 1, true), {
    wrapper, initialProps: { source: first },
  })
  await waitFor(() => expect(result.current.pending).toBe(false))
  expect(server).toHaveBeenCalledTimes(2)
  rerender({ source: all })
  await waitFor(() => expect(result.current.pending).toBe(false))
  const fetched = server.mock.calls.flatMap(([input]) => input.data.rowIds as number[])
  expect(fetched).toHaveLength(1500)
  expect(new Set(fetched).size).toBe(1500)
  expect(server).toHaveBeenCalledTimes(4)
  client.clear()
})
it('indexes task relations identically to the picture without scanning all cards in each rendered cell', () => {
  const source = rows(4); source[3].joint = source[0].joint
  const tasks = [
    { kind: 'rename', row: source[1], sourceRow: source[0], changes: [{ rowId: 2 }, { rowId: 3 }] },
    { kind: 'check', row: source[0], sourceRow: source[1], actualityRowIds: [3] },
    { kind: 'delete', row: source[1], sourceRow: source[0] },
    { kind: 'duplicate-check', row: source[0] },
    { kind: 'create', row: source[2] },
    { kind: 'line-consistency', row: source[0], systemWarningCode: 'СП-08' },
    { kind: 'line-consistency', row: source[0], systemWarningCode: 'СП-01' },
  ].map((task, i) => ({ ...task, key: String(i) })) as RepeatedJointTask[]
  const { result } = renderHook(() => useDispatcherTasksByRow(source, tasks))
  for (const row of source) expect(result.current.get(row.id) ?? []).toEqual(getDispatcherTasksForJointPicture(tasks, row))
})
