import { RepeatedJointTaskActions } from '@/components/dispatcher-task-actions'
import { RepeatedJointTaskContent, WelderStampTaskContent } from '@/components/dispatcher-task-content'
import {
  DispatcherTaskDetails,
  DispatcherTaskGroupFrame,
  dispatcherStandaloneActionButtonClass,
} from '@/components/dispatcher-task-ui'
import { Button } from '@/components/ui/button'
import type {
  DispatcherTask,
  RepeatedJointCoilTask,
  RepeatedJointCreateTask,
  RepeatedJointDeleteTask,
  RepeatedJointRenameTask,
  RepeatedJointTaskGroup,
  WelderStampExpiryTask,
} from '@/lib/dispatcher-types'
import { formatWelderStampTaskLabel } from '@/lib/welder-stamp-format'

export type DispatcherTaskCardHandlers = {
  isTaskExpanded: (task: DispatcherTask) => boolean
  onToggleDetails: (task: DispatcherTask) => void
  onShowTask: (task: DispatcherTask) => void
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

type WelderStampNotificationCardProps = {
  task: WelderStampExpiryTask
  isTaskExpanded: (task: DispatcherTask) => boolean
  onToggleDetails: (task: DispatcherTask) => void
}

type WelderStampNotificationGroupProps = {
  group: RepeatedJointTaskGroup
  isTaskExpanded: (task: DispatcherTask) => boolean
  onToggleDetails: (task: DispatcherTask) => void
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

export function WelderStampNotificationCard({ task, isTaskExpanded, onToggleDetails }: WelderStampNotificationCardProps) {
  const isExpanded = isTaskExpanded(task)

  return (
    <div key={task.key} className="flex w-fit max-w-full flex-col gap-1 rounded-md border border-amber-200 bg-white/95 px-2 py-1.5">
      <div className="flex max-w-full items-center gap-1.5">
        <div className="flex min-w-0 items-center gap-1.5 text-sm">
          <WelderStampTaskContent task={task} label={formatWelderStampTaskLabel(task)} />
        </div>
        <div className="flex shrink-0 items-center overflow-hidden rounded-md border border-slate-200 bg-slate-50/80">
          <Button type="button" variant="ghost" size="sm" onClick={() => onToggleDetails(task)} className={dispatcherStandaloneActionButtonClass}>
            {isExpanded ? 'Свернуть' : 'Подробнее'}
          </Button>
        </div>
      </div>
      {isExpanded ? (
        <DispatcherTaskDetails task={task} />
      ) : null}
    </div>
  )
}

export function WelderStampNotificationGroup({ group, isTaskExpanded, onToggleDetails }: WelderStampNotificationGroupProps) {
  return (
    <DispatcherTaskGroupFrame group={group} reminder>
      {group.tasks
        .filter((task): task is WelderStampExpiryTask => task.kind === 'welder-stamp-expiry')
        .map((task) => (
          <WelderStampNotificationCard key={task.key} task={task} isTaskExpanded={isTaskExpanded} onToggleDetails={onToggleDetails} />
        ))}
    </DispatcherTaskGroupFrame>
  )
}
