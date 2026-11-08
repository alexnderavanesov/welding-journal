import type { QueryClient } from '@tanstack/react-query'
import { getDispatcherTaskContext, type DispatcherTaskContextResult } from '@/server/dispatcher-task-context'
import type { RepeatedJointTask } from './dispatcher-types'

/** A revision owns both completed and in-flight portions. A growing grid or
 * an overlapping joint card must not download the same IDs while a portion is
 * still arriving. React observers only select the current result; this loader
 * owns coverage, bounded reads and cancellation between portions. */
export async function loadDispatcherTaskContext(client: QueryClient, ids: readonly number[], revision: number, signal: AbortSignal) {
  signal.throwIfAborted()
  const tasks = new Map<string, RepeatedJointTask>()
  const missing = new Set(ids)
  const reuse = (covered: readonly number[], cached: readonly RepeatedJointTask[] | undefined) => {
    if (!cached || !covered.some(id => missing.has(id))) return
    for (const id of covered) missing.delete(id)
    for (const task of cached) tasks.set(task.key, task)
  }
  // Server order can interleave IDs across pages. Reuse exact coverage rather
  // than re-slicing all rows into new portions on every append.
  for (const [key, cached] of client.getQueriesData<RepeatedJointTask[]>({ queryKey: ['dispatcher-task-context', revision] })) {
    reuse(key[2] as number[], cached)
  }
  while (missing.size) {
    signal.throwIfAborted()
    const pending: Promise<void>[] = []
    for (const query of client.getQueryCache().findAll({ queryKey: ['dispatcher-task-context-portion', revision] })) {
      const covered = query.queryKey[2] as number[]
      reuse(covered, (query.state.data as DispatcherTaskContextResult | undefined)?.tasks)
      if (!covered.some(id => missing.has(id)) || query.state.fetchStatus === 'idle' || !query.promise) continue
      // Join only existing overlapping reads, never start parallel portions.
      // A failed old portion leaves IDs missing so the current query can retry
      // them normally; it cannot turn a failure into a completed empty context.
      pending.push(query.promise.then(value => reuse(covered, (value as DispatcherTaskContextResult).tasks), () => {}))
    }
    if (pending.length) {
      await Promise.all(pending)
      // Another consumer may have started the next portion while we waited.
      // Check coverage again before claiming any remaining IDs.
      continue
    }
    if (!missing.size) break
    const rowIds = [...missing].slice(0, 500)
    const result = await client.fetchQuery({
      queryKey: ['dispatcher-task-context-portion', revision, rowIds],
      queryFn: () => getDispatcherTaskContext({ data: { rowIds, computedRevision: revision, mode: 'rows' } }),
      staleTime: Infinity, gcTime: 60_000, retry: false,
    })
    reuse(rowIds, result.tasks)
  }
  signal.throwIfAborted()
  return [...tasks.values()]
}
