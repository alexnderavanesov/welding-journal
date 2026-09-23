import { useEffect, useMemo, useState } from 'react'
import { BellRing, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DispatcherTaskCodeGroup,
  type DispatcherTaskCardHandlers,
} from '@/components/dispatcher-task-card'
import { DispatcherIncrementalListControls } from '@/components/dispatcher-task-ui'
import { buildDispatcherTaskCodeGroups } from '@/lib/dispatcher-code-groups'
import {
  type RepeatedJointTask,
  type RepeatedJointTaskGroup,
} from '@/lib/dispatcher-types'
import { formatTaskCount } from '@/lib/dispatcher-format'
import { getReportViewportWidth } from '@/lib/report-layout'
import { DISPATCHER_CODE_BATCH_SIZE, useIncrementalDispatcherGroups } from '@/lib/use-incremental-dispatcher-groups'

type DispatcherTaskPanelProps = {
  tasks: RepeatedJointTask[]
  groups: RepeatedJointTaskGroup[]
  totalTaskCount?: number
  hasMoreTasks?: boolean
  onLoadMoreTasks?: () => void
  isTaskBatchLoading?: boolean
  taskBatchError?: string
  onRetryTaskBatch?: () => void
  isRefreshing?: boolean
  onWorkspaceOpenChange?: (open: boolean) => void
  stickyLeft: number
  handlers: DispatcherTaskCardHandlers
  onCollapseTaskDetails?: () => void
  defaultExpanded?: boolean
}

export function DispatcherTaskPanel({
  tasks,
  groups,
  totalTaskCount = tasks.length,
  hasMoreTasks = false,
  onLoadMoreTasks,
  isTaskBatchLoading = false,
  taskBatchError,
  onRetryTaskBatch,
  isRefreshing = false,
  onWorkspaceOpenChange,
  stickyLeft,
  handlers,
  onCollapseTaskDetails,
  defaultExpanded = true,
}: DispatcherTaskPanelProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)
  const codeGroups = useMemo(() => buildDispatcherTaskCodeGroups(groups), [groups])
  const {
    visibleGroups: visibleCodeGroups,
    visibleCount: visibleCodeCount,
    hasMore: hasMoreCodes,
    canCollapse: canCollapseCodes,
    loadMore: loadMoreCodes,
    collapseList: collapseCodeList,
  } = useIncrementalDispatcherGroups(codeGroups, DISPATCHER_CODE_BATCH_SIZE)

  useEffect(() => {
    setIsExpanded(defaultExpanded)
  }, [defaultExpanded])
  if (tasks.length === 0 && totalTaskCount === 0 && !isRefreshing && !taskBatchError) return null

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
                {formatTaskCount(totalTaskCount)}
              </span>
              <span className="hidden min-w-0 text-xs leading-snug text-slate-500 2xl:inline">
                {isRefreshing ? 'Выполняется фоновый пересчёт…' : 'Изменения выполняются только после подтверждения.'}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {totalTaskCount > 0 ? (
              <Button type="button" variant="outline" size="sm" className="h-8 border-sky-200 bg-white px-3 text-xs text-sky-800 hover:bg-sky-50" onClick={() => onWorkspaceOpenChange?.(true)}>
                Открыть диспетчер
              </Button>
            ) : null}
            {tasks.length > 0 ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  if (isExpanded) {
                    collapseCodeList()
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
        </div>
        {taskBatchError ? (
          <div className="flex items-center gap-2 text-xs text-red-700" role="alert">
            <span>{taskBatchError}</span>
            {onRetryTaskBatch ? <Button type="button" variant="outline" size="sm" onClick={onRetryTaskBatch}>Повторить загрузку</Button> : null}
          </div>
        ) : null}
        {isExpanded && groups.length > 0 ? (
          <div className="overflow-hidden rounded-md border border-sky-100 bg-[#f8fcfe]">
            {visibleCodeGroups.map((group) => (
              <DispatcherTaskCodeGroup key={group.code} group={group} {...handlers} />
            ))}
          </div>
        ) : null}
        {isExpanded ? (
          <DispatcherIncrementalListControls
            visibleCount={visibleCodeCount}
            totalCount={codeGroups.length}
            itemLabel="типов ДЗ"
            hasMore={hasMoreCodes}
            canCollapse={canCollapseCodes}
            onLoadMore={loadMoreCodes}
            onCollapse={collapseCodeList}
          />
        ) : null}
        {isExpanded && hasMoreTasks ? (
          <Button type="button" variant="outline" size="sm" disabled={isTaskBatchLoading || isRefreshing} onClick={onLoadMoreTasks}>
            {isTaskBatchLoading ? 'Загружаем задачи…' : `Загрузить ещё задачи (${tasks.length} из ${totalTaskCount})`}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
