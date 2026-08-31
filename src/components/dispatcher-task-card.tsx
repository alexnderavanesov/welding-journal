import { ChevronRight } from 'lucide-react'
import { useState } from 'react'

import { RepeatedJointTaskActions } from '@/components/dispatcher-task-actions'
import { RepeatedJointTaskContent } from '@/components/dispatcher-task-content'
import {
  DispatcherTaskDetails,
  DispatcherTaskGroupFrame,
} from '@/components/dispatcher-task-ui'
import type { DispatcherTaskCodeGroup as DispatcherTaskCodeGroupValue } from '@/lib/dispatcher-code-groups'
import { formatTaskCount } from '@/lib/dispatcher-format'
import { useIncrementalDispatcherGroups } from '@/lib/use-incremental-dispatcher-groups'
import type {
  DispatcherTask,
  PercentageLineControlTask,
  RepeatedJointCoilTask,
  RepeatedJointCreateTask,
  RepeatedJointDeleteTask,
  RepeatedJointRenameTask,
  RepeatedJointTaskGroup,
} from '@/lib/dispatcher-types'

export type DispatcherTaskCardHandlers = {
  isTaskExpanded: (task: DispatcherTask) => boolean
  onToggleDetails: (task: DispatcherTask) => void
  onShowTask: (task: DispatcherTask) => void
  onOpenTaskOfficiality: (task: DispatcherTask) => void
  onCreateTask: (task: RepeatedJointCreateTask | RepeatedJointCoilTask) => void
  onDeleteTask: (task: RepeatedJointDeleteTask) => void
  onRenameTask: (task: RepeatedJointRenameTask) => void
  onAcceptPercentageLineTask: (task: PercentageLineControlTask) => void
  onEditPercentageLineTaskStamp: (task: PercentageLineControlTask) => void
  onSuspendPercentageLineWelder: (task: PercentageLineControlTask) => void
  onSkipPercentageLineWelderSuspension: (task: PercentageLineControlTask) => void
  canRunDispatcherMutation: boolean
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
  const isExpanded = handlers.isTaskExpanded(task)
  return (
    <div
      key={task.key}
      className={nested ? 'w-full bg-transparent' : 'w-full rounded-md border border-sky-100 bg-[#f8fcfe]'}
    >
      <div className="mx-auto grid min-h-11 w-full max-w-[1400px] grid-cols-[minmax(0,1fr)_auto] items-stretch">
        <button
          type="button"
          onClick={() => handlers.onToggleDetails(task)}
          className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 px-3 py-2 text-left text-sm hover:bg-sky-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-300"
          aria-expanded={isExpanded}
          title={isExpanded ? 'Свернуть описание задачи' : 'Открыть описание задачи'}
        >
          <RepeatedJointTaskContent task={task} nested={nested} />
        </button>
        <RepeatedJointTaskActions task={task} {...handlers} />
      </div>
      {isExpanded ? (
        <DispatcherTaskDetails task={task} />
      ) : null}
    </div>
  )
}

export function DispatcherTaskGroup({ group, hideTaskSummaries = false, ...handlers }: DispatcherTaskGroupProps) {
  const isReminderGroup = group.tasks.every((task) => task.kind === 'welder-stamp-expiry')
  return (
    <DispatcherTaskGroupFrame group={group} reminder={isReminderGroup} hideTaskSummaries={hideTaskSummaries}>
      {() =>
        group.tasks.map((task) => (
          <DispatcherTaskCard key={task.key} task={task} nested {...handlers} />
        ))
      }
    </DispatcherTaskGroupFrame>
  )
}

type DispatcherTaskCodeGroupProps = DispatcherTaskCardHandlers & {
  group: DispatcherTaskCodeGroupValue
}

export function DispatcherTaskCodeGroup({ group, ...handlers }: DispatcherTaskCodeGroupProps) {
  const [isOpen, setIsOpen] = useState(false)
  const { visibleGroups, visibleCount, hasMore, loadMore, loadMoreRef } =
    useIncrementalDispatcherGroups(group.objectGroups)

  if (group.tasks.length === 1) {
    return <DispatcherTaskGroup group={group.objectGroups[0]} {...handlers} />
  }

  return (
    <details
      className="group/code w-full border-b border-sky-100 bg-[#f8fcfe] last:border-b-0"
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
    >
      <summary className="min-h-11 cursor-pointer list-none px-3 py-2 text-sm marker:hidden hover:bg-white/75">
        <span className="mx-auto flex w-full max-w-[1600px] items-center gap-2">
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
            {hasMore ? (
              <div ref={loadMoreRef} className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/70 px-3 py-2">
                <span className="text-xs text-slate-500">
                  Показано объектов: {visibleCount} из {group.objectGroups.length}
                </span>
                <button
                  type="button"
                  onClick={loadMore}
                  className="h-7 rounded border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Показать ещё
                </button>
              </div>
            ) : null}
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
