import { Button } from '@/components/ui/button'
import { DispatcherTaskGroup, type DispatcherTaskCardHandlers } from '@/components/dispatcher-task-card'
import type { DispatcherTask, RepeatedJointTask, RepeatedJointTaskGroup } from '@/lib/dispatcher-types'
import {
  DISPATCHER_TASKS_FIELD_KEY,
  DISPATCHER_TASKS_WITH_FILTER,
  DISPATCHER_TASKS_WITHOUT_FILTER,
  getDispatcherTaskFilterMode,
} from '@/lib/dispatcher-task-row-codes'
import { useIncrementalDispatcherGroups } from '@/lib/use-incremental-dispatcher-groups'

type DispatcherTaskPanelProps = {
  tasks: RepeatedJointTask[]
  groups: RepeatedJointTaskGroup[]
  stickyLeft: number
  handlers: DispatcherTaskCardHandlers
  onDismissAll: (tasks: DispatcherTask[]) => void
  columnFilters: Record<string, string>
  onColumnFiltersChange: (filters: Record<string, string>) => void
}

export function DispatcherTaskPanel({
  tasks,
  groups,
  stickyLeft,
  handlers,
  onDismissAll,
  columnFilters,
  onColumnFiltersChange,
}: DispatcherTaskPanelProps) {
  const { visibleGroups, visibleCount, hasMore, loadMore, loadMoreRef } = useIncrementalDispatcherGroups(groups)
  const dispatcherFilterMode = getDispatcherTaskFilterMode(columnFilters[DISPATCHER_TASKS_FIELD_KEY])

  if (tasks.length === 0 && dispatcherFilterMode === 'all') return null

  return (
    <div
      className="sticky z-30 max-w-[calc(100vw-2rem)] overflow-x-auto rounded-md border border-amber-200 bg-amber-50/90 px-3 py-2 shadow-sm shadow-amber-100"
      style={{ left: stickyLeft, width: `calc(100vw - ${stickyLeft + 24}px)` }}
    >
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 leading-snug">
              <span className="shrink-0 text-sm font-semibold text-amber-950">Диспетчер задач</span>
              <span className="min-w-0 text-xs leading-snug text-amber-800">
                Найдено: {tasks.length}. Действие только после подтверждения.
              </span>
            </div>
            <DispatcherTaskQuickFilter
              mode={dispatcherFilterMode}
              columnFilters={columnFilters}
              onColumnFiltersChange={onColumnFiltersChange}
            />
          </div>
          {tasks.length > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onDismissAll(tasks)}
              className="h-8 border-amber-300 bg-white px-3 text-xs text-amber-900 hover:bg-amber-100"
            >
              Скрыть все
            </Button>
          ) : null}
        </div>
        {visibleGroups.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {visibleGroups.map((group) => (
              <DispatcherTaskGroup key={group.key} group={group} {...handlers} />
            ))}
          </div>
        ) : null}
        {hasMore ? (
          <div ref={loadMoreRef} className="flex items-center justify-between gap-3 border-t border-amber-200/70 pt-2">
            <span className="text-xs text-amber-800">
              Показано групп: {visibleCount} из {groups.length}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={loadMore}
              className="h-7 border-amber-300 bg-white px-3 text-xs text-amber-900 hover:bg-amber-100"
            >
              Показать ещё
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function DispatcherTaskQuickFilter({
  mode,
  columnFilters,
  onColumnFiltersChange,
}: {
  mode: ReturnType<typeof getDispatcherTaskFilterMode>
  columnFilters: Record<string, string>
  onColumnFiltersChange: (filters: Record<string, string>) => void
}) {
  const setFilter = (value: string) => {
    const nextFilters = { ...columnFilters }
    if (value) nextFilters[DISPATCHER_TASKS_FIELD_KEY] = value
    else delete nextFilters[DISPATCHER_TASKS_FIELD_KEY]
    onColumnFiltersChange(nextFilters)
  }

  return (
    <div
      className="inline-flex h-7 items-center overflow-hidden rounded border border-amber-300 bg-white shadow-sm shadow-amber-100/70"
      aria-label="Фильтр строк по задачам диспетчера"
    >
      <DispatcherFilterButton label="Все" active={mode === 'all'} onClick={() => setFilter('')} />
      <DispatcherFilterButton
        label="С задачами"
        active={mode === 'with' || mode === 'codes'}
        onClick={() => setFilter(DISPATCHER_TASKS_WITH_FILTER)}
      />
      <DispatcherFilterButton
        label="Без задач"
        active={mode === 'without'}
        onClick={() => setFilter(DISPATCHER_TASKS_WITHOUT_FILTER)}
      />
    </div>
  )
}

function DispatcherFilterButton({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`h-full border-r border-amber-200 px-2.5 text-[12px] font-medium leading-none transition-colors last:border-r-0 ${
        active
          ? 'bg-amber-100 text-amber-950'
          : 'bg-white text-amber-800 hover:bg-amber-50 hover:text-amber-950'
      }`}
    >
      {label}
    </button>
  )
}
