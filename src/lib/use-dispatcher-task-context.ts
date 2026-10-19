import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { RepeatedJointTask, WeldRow } from './dispatcher-types'
import { getDispatcherTaskContext, type DispatcherTaskContextResult } from '@/server/dispatcher-task-context'

const EMPTY_TASKS: RepeatedJointTask[] = []

export function useDispatcherTaskContext(rows: readonly WeldRow[], revision: number | null, needed: boolean) {
  const client = useQueryClient()
  const ids = useMemo(() => [...new Set(rows.map(row => row.id))].sort((a, b) => a - b), [rows])
  const query = useQuery({
    queryKey: ['dispatcher-task-context', revision, ids],
    enabled: needed && revision !== null && ids.length > 0,
    queryFn: async ({ signal }) => {
      const tasks = new Map<string, RepeatedJointTask>()
      const missing = new Set(ids)
      const reuse = (covered: readonly number[], cached: readonly RepeatedJointTask[] | undefined) => {
        if (!cached || !covered.some(id => missing.has(id))) return
        for (const id of covered) missing.delete(id)
        for (const task of cached) tasks.set(task.key, task)
      }
      // Server order is not ID order. Appending a page can interleave IDs with
      // every previous portion; reuse covered IDs rather than re-slicing and
      // downloading the old rows again. Query GC bounds inactive cache lifetime.
      for (const [key, cached] of client.getQueriesData<RepeatedJointTask[]>({ queryKey: ['dispatcher-task-context', revision] })) {
        reuse(key[2] as number[], cached)
      }
      for (const [key, cached] of client.getQueriesData<DispatcherTaskContextResult>({ queryKey: ['dispatcher-task-context-portion', revision] })) {
        reuse(key[2] as number[], cached?.tasks)
      }
      const remaining = [...missing]
      // No row-level requests or unbounded fan-out. Obsolete queries stop before
      // starting another portion; cells stay explicitly pending until completion.
      for (let offset = 0; offset < remaining.length; offset += 500) {
        signal.throwIfAborted()
        const rowIds = remaining.slice(offset, offset + 500)
        const result = await client.fetchQuery({
          queryKey: ['dispatcher-task-context-portion', revision, rowIds],
          queryFn: () => getDispatcherTaskContext({ data: { rowIds, computedRevision: revision!, mode: 'rows' } }),
          staleTime: Infinity, gcTime: 60_000, retry: false,
        })
        for (const task of result.tasks) tasks.set(task.key, task)
      }
      signal.throwIfAborted()
      return [...tasks.values()]
    },
    staleTime: Infinity, gcTime: 60_000, retry: false,
    refetchOnWindowFocus: false, refetchOnReconnect: false,
  })
  const tasks = needed && revision !== null ? query.data ?? EMPTY_TASKS : EMPTY_TASKS
  return { tasks, pending: needed && ids.length > 0 && !query.data && !query.error,
    error: needed ? query.error : null, refetch: query.refetch }
}

/** Index once per published context, not a scan of 5000 cards in every cell. */
export function useDispatcherTasksByRow(rows: readonly WeldRow[], tasks: readonly RepeatedJointTask[]) {
  return useMemo(() => {
    const result = new Map<number, RepeatedJointTask[]>()
    const ids = new Set(rows.map(row => row.id))
    const duplicateIds = new Map<string, number[]>()
    const identity = (row: WeldRow) => JSON.stringify([row.projectTitle, row.subtitleCode, row.line, row.joint].map(value => String(value ?? '').trim().toLowerCase()))
    for (const row of rows) {
      const key = identity(row)
      const group = duplicateIds.get(key) ?? []
      group.push(row.id); duplicateIds.set(key, group)
    }
    for (const task of tasks) {
      if (task.kind === 'percentage-line-control' || task.kind === 'line-consistency' && task.systemWarningCode !== 'СП-08') continue
      const related = task.kind === 'rename' ? [task.sourceRow.id, ...task.changes.map(change => change.rowId)]
        : task.kind === 'check' || task.kind === 'delete' ? [task.row.id, task.sourceRow.id, ...(task.kind === 'check' ? task.actualityRowIds ?? [] : [])]
        : task.kind === 'duplicate-check' ? duplicateIds.get(identity(task.row)) ?? [] : [task.row.id]
      for (const id of new Set(related)) {
        if (!ids.has(id)) continue
        const group = result.get(id) ?? []
        group.push(task); result.set(id, group)
      }
    }
    return result
  }, [rows, tasks])
}
