import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { RepeatedJointTask, WeldRow } from './dispatcher-types'
import { loadDispatcherTaskContext } from './dispatcher-task-context-loader'

const EMPTY_TASKS: RepeatedJointTask[] = []

export function useDispatcherTaskContext(rows: readonly WeldRow[], revision: number | null, needed: boolean) {
  const client = useQueryClient()
  const ids = useMemo(() => [...new Set(rows.map(row => row.id))].sort((a, b) => a - b), [rows])
  const query = useQuery({
    queryKey: ['dispatcher-task-context', revision, ids],
    enabled: needed && revision !== null && ids.length > 0,
    queryFn: ({ signal }) => loadDispatcherTaskContext(client, ids, revision!, signal),
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
