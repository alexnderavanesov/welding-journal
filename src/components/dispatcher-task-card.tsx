import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'

import { RepeatedJointTaskActions } from '@/components/dispatcher-task-actions'
import { RepeatedJointTaskContent } from '@/components/dispatcher-task-content'
import {
  DispatcherIncrementalListControls,
  DispatcherTaskDetails,
  DispatcherTaskGroupFrame,
} from '@/components/dispatcher-task-ui'
import type { DispatcherTaskCodeGroup as DispatcherTaskCodeGroupValue } from '@/lib/dispatcher-code-groups'
import { formatTaskCount } from '@/lib/dispatcher-format'
import {
  DISPATCHER_TASK_BATCH_SIZE,
  useIncrementalDispatcherGroups,
} from '@/lib/use-incremental-dispatcher-groups'
import type {
  DispatcherTask,
  PercentageLineControlTask,
  RepeatedJointCoilTask,
  RepeatedJointCreateTask,
  RepeatedJointDeleteTask,
  RepeatedJointRenameTask,
  RepeatedJointTaskGroup,
} from '@/lib/dispatcher-types'
import type { DispatcherTaskActionSpec } from '@/lib/dispatcher-task-actions-model'

export type DispatcherTaskCardHandlers = {
  isTaskExpanded: (task: DispatcherTask) => boolean
  onToggleDetails: (task: DispatcherTask) => void
  onShowTask: (task: DispatcherTask) => void
  onOpenTaskPicture: (task: Exclude<DispatcherTask, { kind: 'welder-stamp-expiry' }>) => void
  onOpenTaskOfficiality: (task: DispatcherTask) => void
  onCreateTask: (task: RepeatedJointCreateTask | RepeatedJointCoilTask) => void
  onCreateEarlyCoil: (task: RepeatedJointCreateTask) => void
  onDeleteTask: (task: RepeatedJointDeleteTask) => void
  onRenameTask: (task: RepeatedJointRenameTask) => void
  onAcceptPercentageLineTask: (task: PercentageLineControlTask) => void
  onEditPercentageLineTaskStamp: (task: PercentageLineControlTask) => void
  onSuspendPercentageLineWelder: (task: PercentageLineControlTask) => void
  onSkipPercentageLineWelderSuspension: (task: PercentageLineControlTask) => void
  onRunTaskAction: (task: Exclude<DispatcherTask, { kind: 'welder-stamp-expiry' }>, action: DispatcherTaskActionSpec) => void
  canRunDispatcherMutation: boolean
  canCreateEarlyCoil: boolean
  isEarlyCoilPending: boolean
  isCreatePending: boolean
  isDeletePending: boolean
  isRenamePending: boolean
}

type DispatcherTaskCardProps = DispatcherTaskCardHandlers & {
  task: DispatcherTask
  nested?: boolean
}

type DispatcherTaskGroupProps = DispatcherTaskCardHandlers & {
  group: RepeatedJointTaskGroup
  hideTaskSummaries?: boolean
}

export function DispatcherTaskCard({ task, nested = false, ...handlers }: DispatcherTaskCardProps) {
  const { onToggleDetails, isTaskExpanded, ...actionHandlers } = handlers
  const isExpanded = isTaskExpanded(task)
  return (
    <div
      key={task.key}
      data-dispatcher-task-card
      data-dispatcher-hierarchy-level="2"
      data-expanded={isExpanded ? 'true' : 'false'}
      className={`${nested ? 'w-full' : 'w-full rounded-md border border-sky-100'} transition-colors ${
        isExpanded
          ? 'bg-sky-50/70'
          : nested
          ? 'bg-transparent'
          : 'bg-[#f8fcfe]'
      }`}
    >
      <div
        data-dispatcher-task-summary
        className={`grid min-h-11 w-full grid-cols-[minmax(0,1fr)_auto] items-stretch transition-colors ${
          nested ? 'shadow-[inset_2px_0_0_0_rgb(56_189_248_/_0.72)]' : ''
        } ${
          isExpanded ? 'hover:bg-sky-100/60' : 'hover:bg-sky-50/70'
        }`}
      >
        <button
          type="button"
          onClick={() => onToggleDetails(task)}
          className={`flex min-w-0 items-center gap-2 px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-300 ${
            isExpanded
              ? 'font-semibold text-slate-900'
              : ''
          }`}
          aria-expanded={isExpanded}
          title={isExpanded ? 'Свернуть описание задачи' : 'Открыть описание задачи'}
        >
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1">
            <RepeatedJointTaskContent task={task} nested={nested} />
          </span>
          <span
            data-dispatcher-task-toggle-indicator
            data-expanded={isExpanded ? 'true' : 'false'}
            className="flex h-6 w-6 shrink-0 items-center justify-center text-slate-400"
            aria-hidden="true"
          >
            {isExpanded
              ? <ChevronDown className="h-4 w-4" />
              : <ChevronRight className="h-4 w-4" />}
          </span>
        </button>
        <RepeatedJointTaskActions task={task} {...actionHandlers} />
      </div>
      {isExpanded ? (
        <DispatcherTaskDetails task={task} />
      ) : null}
    </div>
  )
}

export function DispatcherTaskGroup({ group, hideTaskSummaries = false, ...handlers }: DispatcherTaskGroupProps) {
  const isReminderGroup = group.tasks.every((task) => task.kind === 'welder-stamp-expiry')
  const {
    visibleGroups: visibleTasks,
    visibleCount,
    hasMore,
    canCollapse,
    loadMore,
    collapseList,
  } = useIncrementalDispatcherGroups(group.tasks, DISPATCHER_TASK_BATCH_SIZE)

  return (
    <DispatcherTaskGroupFrame
      group={group}
      reminder={isReminderGroup}
      hideTaskSummaries={hideTaskSummaries}
      onOpenChange={(open) => {
        if (!open) collapseList()
      }}
    >
      {() => (
        <>
          {visibleTasks.map((task) => (
            <DispatcherTaskCard key={task.key} task={task} nested {...handlers} />
          ))}
          <DispatcherIncrementalListControls
            visibleCount={visibleCount}
            totalCount={group.tasks.length}
            itemLabel="задач"
            hasMore={hasMore}
            canCollapse={canCollapse}
            onLoadMore={loadMore}
            onCollapse={collapseList}
          />
        </>
      )}
    </DispatcherTaskGroupFrame>
  )
}

type DispatcherTaskCodeGroupProps = DispatcherTaskCardHandlers & {
  group: DispatcherTaskCodeGroupValue
}

export function DispatcherTaskCodeGroup({ group, ...handlers }: DispatcherTaskCodeGroupProps) {
  const [isOpen, setIsOpen] = useState(false)
  const {
    visibleGroups,
    visibleCount,
    hasMore,
    canCollapse,
    loadMore,
    collapseList,
  } = useIncrementalDispatcherGroups(group.objectGroups)

  if (group.tasks.length === 1) {
    return <DispatcherTaskGroup group={group.objectGroups[0]} {...handlers} />
  }

  return (
    <details
      className="group/code w-full border-b border-sky-100 bg-[#f8fcfe] last:border-b-0"
      onToggle={(event) => {
        const open = event.currentTarget.open
        setIsOpen(open)
        if (!open) collapseList()
      }}
    >
      <summary className="min-h-11 cursor-pointer list-none px-3 py-2 text-sm marker:hidden hover:bg-white/75">
        <span className="flex w-full items-center gap-2">
          <span className="inline-flex min-w-0 items-center gap-1 rounded border border-violet-200 bg-violet-50 px-2 py-1">
            <strong className="shrink-0 font-semibold text-violet-700">{group.code}</strong>
            <span className="truncate text-slate-700">· {group.label}</span>
          </span>
          <span className="shrink-0 rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">
            {formatTaskCount(group.tasks.length)}
          </span>
          <span className="hidden shrink-0 rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600 sm:inline-flex">
            {formatObjectCount(group.objectGroups.length)}
          </span>
          <span className="min-w-0 flex-1" />
          {group.metric ? (
            <span className="shrink-0 rounded border border-sky-100 bg-sky-50/70 px-2 py-0.5 text-xs font-medium text-sky-800">
              {group.metric}
            </span>
          ) : null}
          <ChevronRight className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open/code:rotate-90" />
          <span className="sr-only">Открыть задачи {group.code}</span>
        </span>
      </summary>
      {isOpen ? (
        <div className="border-t border-sky-100 bg-sky-50/35 pl-3">
          <div className="overflow-hidden border-l border-sky-100 bg-white/55">
            {visibleGroups.map((objectGroup) => (
              <DispatcherTaskGroup
                key={objectGroup.key}
                group={objectGroup}
                hideTaskSummaries
                {...handlers}
              />
            ))}
            <DispatcherIncrementalListControls
              visibleCount={visibleCount}
              totalCount={group.objectGroups.length}
              itemLabel="объектов"
              hasMore={hasMore}
              canCollapse={canCollapse}
              onLoadMore={loadMore}
              onCollapse={collapseList}
            />
          </div>
        </div>
      ) : null}
    </details>
  )
}

function formatObjectCount(count: number) {
  const lastTwoDigits = count % 100
  const lastDigit = count % 10
  if (lastTwoDigits >= 11 && lastTwoDigits <= 14) return `${count} объектов`
  if (lastDigit === 1) return `${count} объект`
  if (lastDigit >= 2 && lastDigit <= 4) return `${count} объекта`
  return `${count} объектов`
}
