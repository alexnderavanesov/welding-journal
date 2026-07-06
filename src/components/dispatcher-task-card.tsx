import { RepeatedJointTaskActions } from '@/components/dispatcher-task-actions'
import { RepeatedJointTaskContent } from '@/components/dispatcher-task-content'
import {
  DispatcherTaskDetails,
  DispatcherTaskGroupFrame,
} from '@/components/dispatcher-task-ui'
import type {
  DispatcherTask,
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
}

export function DispatcherTaskCard({ task, nested = false, ...handlers }: DispatcherTaskCardProps) {
  const isExpanded = handlers.isTaskExpanded(task)
  return (
    <div
      key={task.key}
      className={`flex w-fit max-w-full flex-col gap-1 rounded-md border px-2 py-1.5 ${
        nested ? 'border-slate-200 bg-white' : 'border-amber-200 bg-white/95'
      }`}
    >
      <div className="flex max-w-full items-center gap-1.5">
        <div className="flex min-w-0 items-center gap-1.5 text-sm">
          <RepeatedJointTaskContent task={task} nested={nested} />
        </div>
        <RepeatedJointTaskActions task={task} {...handlers} />
      </div>
      {isExpanded ? (
        <DispatcherTaskDetails task={task} />
      ) : null}
    </div>
  )
}

export function DispatcherTaskGroup({ group, ...handlers }: DispatcherTaskGroupProps) {
  const isReminderGroup = group.tasks.every((task) => task.kind === 'welder-stamp-expiry')
  return (
    <DispatcherTaskGroupFrame group={group} reminder={isReminderGroup}>
      {group.tasks.map((task) => (
        <DispatcherTaskCard key={task.key} task={task} nested {...handlers} />
      ))}
    </DispatcherTaskGroupFrame>
  )
}
