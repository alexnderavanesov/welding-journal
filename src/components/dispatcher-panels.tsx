import { useEffect, useMemo, useState } from 'react'
import { BellRing, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DispatcherTaskCodeGroup,
  DispatcherTaskGroup,
  type DispatcherTaskCardHandlers,
} from '@/components/dispatcher-task-card'
import { DispatcherIncrementalListControls } from '@/components/dispatcher-task-ui'
import { buildDispatcherTaskCodeGroups } from '@/lib/dispatcher-code-groups'
import {
  type RepeatedJointTask,
  type RepeatedJointTaskGroup,
} from '@/lib/dispatcher-types'
import {
  DISPATCHER_TASKS_FIELD_KEY,
  DISPATCHER_TASKS_WITH_FILTER,
  DISPATCHER_TASKS_WITHOUT_FILTER,
  getDispatcherTaskFilterMode,
} from '@/lib/dispatcher-task-row-codes'
import { formatTaskCount } from '@/lib/dispatcher-format'
import { getReportViewportWidth } from '@/lib/report-layout'
import { useIncrementalDispatcherGroups } from '@/lib/use-incremental-dispatcher-groups'

type DispatcherTaskPanelProps = {
  tasks: RepeatedJointTask[]
  groups: RepeatedJointTaskGroup[]
  stickyLeft: number
  handlers: DispatcherTaskCardHandlers
  columnFilters: Record<string, string>
  onColumnFiltersChange: (filters: Record<string, string>) => void
  onCollapseTaskDetails?: () => void
  defaultExpanded?: boolean
}

export function DispatcherTaskPanel({
  tasks,
  groups,
  stickyLeft,
  handlers,
  columnFilters,
  onColumnFiltersChange,
  onCollapseTaskDetails,
  defaultExpanded = true,
}: DispatcherTaskPanelProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)
  const [groupingMode, setGroupingMode] = useState<DispatcherGroupingMode>(readDispatcherGroupingMode)
  const {
    visibleGroups,
    visibleCount,
    hasMore,
    canCollapse,
    loadMore,
    collapseList,
  } = useIncrementalDispatcherGroups(groups)
  const codeGroups = useMemo(() => buildDispatcherTaskCodeGroups(groups), [groups])
  const dispatcherFilterMode = getDispatcherTaskFilterMode(columnFilters[DISPATCHER_TASKS_FIELD_KEY])

  useEffect(() => {
    setIsExpanded(defaultExpanded)
  }, [defaultExpanded])

  if (tasks.length === 0 && dispatcherFilterMode === 'all') return null

  const viewportWidth = getReportViewportWidth(stickyLeft)

  return (
    <div
      className="sticky z-20 overflow-x-auto rounded-md border border-sky-200/80 bg-[#eef7fb]/95 px-3 py-2 shadow-sm shadow-sky-100/70 backdrop-blur"
      style={{
        left: stickyLeft,
        width: '100%',
        maxWidth: viewportWidth,
      }}
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
            <DispatcherGroupingControl mode={groupingMode} onChange={setGroupingMode} />
          </div>
          {tasks.length > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                if (isExpanded) {
                  collapseList()
                  onCollapseTaskDetails?.()
                }
                setIsExpanded(!isExpanded)
              }}
              aria-expanded={isExpanded}
              className="h-8 shrink-0 border-slate-200 bg-white px-3 text-xs text-slate-700 hover:bg-slate-50"
            >
              {isExpanded ? <ChevronUp className="mr-1.5 h-3.5 w-3.5" /> : <ChevronDown className="mr-1.5 h-3.5 w-3.5" />}
              {isExpanded ? 'Свернуть' : 'Развернуть'}
            </Button>
          ) : null}
        </div>
        {isExpanded && groups.length > 0 ? (
          <div className="overflow-hidden rounded-md border border-sky-100 bg-[#f8fcfe]">
            {groupingMode === 'codes'
              ? codeGroups.map((group) => (
                  <DispatcherTaskCodeGroup key={group.code} group={group} {...handlers} />
                ))
              : visibleGroups.map((group) => (
                  <DispatcherTaskGroup key={group.key} group={group} {...handlers} />
                ))}
          </div>
        ) : null}
        {isExpanded && groupingMode === 'objects' ? (
          <DispatcherIncrementalListControls
            visibleCount={visibleCount}
            totalCount={groups.length}
            itemLabel="групп"
            hasMore={hasMore}
            canCollapse={canCollapse}
            onLoadMore={loadMore}
            onCollapse={collapseList}
          />
        ) : null}
      </div>
    </div>
  )
}

type DispatcherGroupingMode = 'codes' | 'objects'

const DISPATCHER_GROUPING_STORAGE_KEY = 'welding-dispatcher-grouping-mode'

function readDispatcherGroupingMode(): DispatcherGroupingMode {
  if (typeof window === 'undefined') return 'codes'
  try {
    return window.localStorage.getItem(DISPATCHER_GROUPING_STORAGE_KEY) === 'objects' ? 'objects' : 'codes'
  } catch {
    return 'codes'
  }
}

function DispatcherGroupingControl({
  mode,
  onChange,
}: {
  mode: DispatcherGroupingMode
  onChange: (mode: DispatcherGroupingMode) => void
}) {
  const setMode = (nextMode: DispatcherGroupingMode) => {
    onChange(nextMode)
    try {
      window.localStorage.setItem(DISPATCHER_GROUPING_STORAGE_KEY, nextMode)
    } catch {
      // The view still works when browser storage is unavailable.
    }
  }

  return (
    <div
      className="inline-flex h-7 items-center overflow-hidden rounded border border-slate-200 bg-white"
      aria-label="Группировка задач диспетчера"
    >
      <DispatcherFilterButton label="По ДЗ" active={mode === 'codes'} onClick={() => setMode('codes')} />
      <DispatcherFilterButton label="По объектам" active={mode === 'objects'} onClick={() => setMode('objects')} />
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
