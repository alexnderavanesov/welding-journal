import { useState } from 'react'
import { BellRing, ChevronDown, ChevronUp, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DispatcherTaskGroup, type DispatcherTaskCardHandlers } from '@/components/dispatcher-task-card'
import type { DispatcherTask, RepeatedJointTask, RepeatedJointTaskGroup } from '@/lib/dispatcher-types'
import {
  DISPATCHER_TASKS_FIELD_KEY,
  DISPATCHER_TASKS_WITH_FILTER,
  DISPATCHER_TASKS_WITHOUT_FILTER,
  getDispatcherTaskFilterMode,
} from '@/lib/dispatcher-task-row-codes'
import { formatTaskCount } from '@/lib/dispatcher-format'
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
  const [isExpanded, setIsExpanded] = useState(true)
  const { visibleGroups, visibleCount, hasMore, loadMore, loadMoreRef } = useIncrementalDispatcherGroups(groups)
  const dispatcherFilterMode = getDispatcherTaskFilterMode(columnFilters[DISPATCHER_TASKS_FIELD_KEY])

  if (tasks.length === 0 && dispatcherFilterMode === 'all') return null

  return (
    <div
      className="sticky z-30 max-w-7xl overflow-x-auto rounded-md border border-slate-200 bg-white/95 px-3 py-2 shadow-sm shadow-slate-200/60 backdrop-blur"
      style={{ left: stickyLeft, width: `calc(100vw - ${stickyLeft + 24}px)` }}
      aria-label="Диспетчер задач"
    >
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex min-h-8 flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <div className="flex min-w-0 items-center gap-2 leading-snug">
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-amber-200 bg-amber-50 text-amber-700">
                <BellRing className="h-4 w-4" />
              </span>
              <span className="shrink-0 text-sm font-semibold text-slate-900">Диспетчер</span>
              <span className="shrink-0 rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">
                {formatTaskCount(tasks.length)}
              </span>
              <span className="hidden min-w-0 text-xs leading-snug text-slate-500 2xl:inline">
                Изменения выполняются только после подтверждения.
              </span>
            </div>
            <DispatcherTaskQuickFilter
              mode={dispatcherFilterMode}
              columnFilters={columnFilters}
              onColumnFiltersChange={onColumnFiltersChange}
            />
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {tasks.length > 0 ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsExpanded((current) => !current)}
                aria-expanded={isExpanded}
                className="h-8 border-slate-200 bg-white px-3 text-xs text-slate-700 hover:bg-slate-50"
              >
                {isExpanded ? <ChevronUp className="mr-1.5 h-3.5 w-3.5" /> : <ChevronDown className="mr-1.5 h-3.5 w-3.5" />}
                {isExpanded ? 'Свернуть' : 'Развернуть'}
              </Button>
            ) : null}
            {tasks.length > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onDismissAll(tasks)}
                title="Убрать карточки до следующего обновления интерфейса. Сами задачи сохранятся."
                aria-label="Скрыть карточки"
                className="h-8 w-8 p-0 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              >
                <EyeOff className="h-3.5 w-3.5" />
              </Button>
            ) : null}
          </div>
        </div>
        {isExpanded && visibleGroups.length > 0 ? (
          <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
            {visibleGroups.map((group) => (
              <DispatcherTaskGroup key={group.key} group={group} {...handlers} />
            ))}
          </div>
        ) : null}
        {isExpanded && hasMore ? (
          <div ref={loadMoreRef} className="flex items-center justify-between gap-3 border-t border-slate-200 pt-2">
            <span className="text-xs text-slate-500">
              Показано групп: {visibleCount} из {groups.length}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={loadMore}
              className="h-7 border-slate-200 bg-white px-3 text-xs text-slate-700 hover:bg-slate-50"
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
      className="inline-flex h-7 items-center overflow-hidden rounded border border-slate-200 bg-white"
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
      className={`h-full border-r border-slate-200 px-2.5 text-[12px] font-medium leading-none transition-colors last:border-r-0 ${
        active
          ? 'bg-slate-100 text-slate-900'
          : 'bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-800'
      }`}
    >
      {label}
    </button>
  )
}
