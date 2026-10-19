import { useEffect, useMemo } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getDispatcherTaskContext } from '@/server/dispatcher-task-context'
import { LinePictureOverview } from './line-picture-overview'
import type { JointDispatcherTaskActionHandler } from './joint-dispatcher-tasks-panel'
import { Button } from './ui/button'

export function RemoteLinePicture({ row, revision, onTotal, onRunAction, onOpenInDispatcher, highlightedTaskKey, onRetry, contextError }: {
  row: WeldRow; revision: number | null; onTotal: (total: number) => void
  onRunAction: JointDispatcherTaskActionHandler; onOpenInDispatcher: () => void
  highlightedTaskKey?: string | null; onRetry: () => void; contextError?: string
}) {
  const query = useInfiniteQuery({
    queryKey: ['dispatcher-line-context', revision, row.id],
    enabled: revision !== null,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => getDispatcherTaskContext({ data: { mode: 'line', rowIds: [row.id], computedRevision: revision!, offset: pageParam } }),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((sum, page) => sum + page.tasks.length, 0)
      return last.tasks.length && loaded < last.total ? loaded : undefined
    },
    staleTime: Infinity, gcTime: 60_000, retry: false,
    refetchOnWindowFocus: false, refetchOnReconnect: false,
  })
  const tasks = useMemo(() => query.data?.pages.flatMap(page => page.tasks) ?? [], [query.data])
  const total = query.data?.pages[0]?.total
  const error = query.error?.message ?? (revision === null ? contextError : undefined)
  useEffect(() => { if (total !== undefined) onTotal(total) }, [total, onTotal])
  return <>
    {total !== undefined && <LinePictureOverview row={row} tasks={tasks} totalTaskCount={total}
      onRunAction={onRunAction} onOpenInDispatcher={onOpenInDispatcher} highlightedTaskKey={highlightedTaskKey} />}
    {error ? <div role="alert" className="py-4 text-sm text-rose-700">
      Не удалось загрузить задачи линии. {error}
      <Button variant="outline" className="ml-2" onClick={() => { onRetry(); if (revision !== null) void query.refetch() }}>Повторить загрузку задач</Button>
    </div> : total === undefined ? <p role="status" className="py-4 text-sm text-slate-500">Загружаем задачи линии…</p> : null}
    {query.hasNextPage && !error && <div className="mt-4 flex items-center gap-3 text-sm text-slate-500">
      Загружено задач: {tasks.length} из {total}
      <Button variant="outline" disabled={query.isFetchingNextPage} onClick={() => { void query.fetchNextPage() }}>
        {query.isFetchingNextPage ? 'Загружаем…' : 'Загрузить ещё задачи линии'}
      </Button>
    </div>}
  </>
}
