import { QueryClient } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
import { loadDispatcherTaskContext } from './dispatcher-task-context-loader'
import type { DispatcherTaskContextResult } from '@/server/dispatcher-task-context'
import type { RepeatedJointTask } from './dispatcher-types'

const server = vi.hoisted(() => vi.fn())
vi.mock('@/server/dispatcher-task-context', () => ({ getDispatcherTaskContext: server }))
const empty = { tasks: [], total: 0 }
const ids = (first: number, last: number) => Array.from({ length: last - first + 1 }, (_, i) => first + i)
function deferred() {
  let resolve!: (result: DispatcherTaskContextResult) => void, reject!: (error: Error) => void
  const promise = new Promise<DispatcherTaskContextResult>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

it('shares overlapping active consumers across 500-row boundaries without duplicate IDs', async () => {
  const client = new QueryClient(), held = deferred()
  const resultFor = (rowIds: number[]) => ({ tasks: [...rowIds.map(id => ({ key: `row-${id}` })), { key: 'shared' }] as RepeatedJointTask[], total: rowIds.length + 1 })
  server.mockReset().mockImplementation(async ({ data }) => resultFor(data.rowIds)).mockReturnValueOnce(held.promise)
  try {
    const first = loadDispatcherTaskContext(client, ids(1, 600), 1, new AbortController().signal)
    const second = loadDispatcherTaskContext(client, ids(300, 900), 1, new AbortController().signal)
    expect(server).toHaveBeenCalledOnce()
    held.resolve(resultFor(ids(1, 500)))
    const [firstTasks, secondTasks] = await Promise.all([first, second])
    const fetched = server.mock.calls.flatMap(([input]) => input.data.rowIds as number[])
    expect(fetched).toHaveLength(900)
    expect(new Set(fetched).size).toBe(900)
    expect(server.mock.calls.every(([input]) => input.data.rowIds.length <= 500)).toBe(true)
    expect(new Set(firstTasks.map(task => task.key))).toEqual(new Set([...ids(1, 600).map(id => `row-${id}`), 'shared']))
    expect(secondTasks.map(task => task.key)).toEqual(expect.arrayContaining(ids(300, 900).map(id => `row-${id}`)))
    expect(new Set(secondTasks.map(task => task.key)).size).toBe(secondTasks.length)
    expect(secondTasks.filter(task => task.key === 'shared')).toHaveLength(1)
  } finally { client.clear() }
})

it('does not wait for an unrelated active portion or another publication revision', async () => {
  const client = new QueryClient(), held = deferred()
  server.mockReset().mockResolvedValue(empty).mockReturnValueOnce(held.promise)
  try {
    const first = loadDispatcherTaskContext(client, [1], 1, new AbortController().signal)
    await loadDispatcherTaskContext(client, [2], 1, new AbortController().signal)
    await loadDispatcherTaskContext(client, [1], 2, new AbortController().signal)
    expect(server).toHaveBeenCalledTimes(3)
    held.resolve(empty)
    await first
  } finally { client.clear() }
})

it('retries missing coverage after a joined portion fails and exposes a current failure', async () => {
  const client = new QueryClient(), held = deferred()
  server.mockReset().mockReturnValueOnce(held.promise).mockRejectedValueOnce(new Error('current failure'))
  try {
    const first = loadDispatcherTaskContext(client, [1], 1, new AbortController().signal).catch(error => error)
    const second = loadDispatcherTaskContext(client, [1, 2], 1, new AbortController().signal).catch(error => error)
    held.reject(new Error('old failure'))
    expect((await first).message).toBe('old failure')
    expect((await second).message).toBe('current failure')
    expect(server.mock.calls.map(([input]) => input.data.rowIds)).toEqual([[1], [1, 2]])
  } finally { client.clear() }
})

it('cancels an obsolete consumer without cancelling the portion shared with another', async () => {
  const client = new QueryClient(), held = deferred(), controller = new AbortController()
  server.mockReset().mockResolvedValue(empty).mockReturnValueOnce(held.promise)
  try {
    const first = loadDispatcherTaskContext(client, [1], 1, new AbortController().signal)
    const second = loadDispatcherTaskContext(client, [1, 2], 1, controller.signal).catch(error => error)
    controller.abort()
    held.resolve(empty)
    expect(await first).toEqual([])
    expect((await second).name).toBe('AbortError')
    expect(server).toHaveBeenCalledOnce()
  } finally { client.clear() }
})
