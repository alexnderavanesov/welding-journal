import { Button } from '@/components/ui/button'
import {
  DispatcherTaskDetails,
  DispatcherTaskGroupFrame,
  dispatcherActionButtonClass,
  dispatcherDangerActionButtonClass,
  dispatcherPrimaryActionButtonClass,
  dispatcherStandaloneActionButtonClass,
} from '@/components/dispatcher-task-ui'
import {
  getRepeatedJointTaskTitle,
} from '@/lib/dispatcher-text'
import type {
  DispatcherTask,
  RepeatedJointCoilTask,
  RepeatedJointCreateTask,
  RepeatedJointDeleteTask,
  RepeatedJointRenameTask,
  RepeatedJointTaskGroup,
  WelderStampExpiryTask,
} from '@/lib/dispatcher-types'
import { getLnkResultBadgeClass } from '@/lib/report-badges'
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

function RepeatedJointTaskContent({ task, nested = false }: { task: DispatcherTask; nested?: boolean }) {
  const title = getRepeatedJointTaskTitle(task)
  if (task.kind === 'welder-stamp-expiry') {
    return (
      <>
        <span className="text-slate-800">{nested ? formatWelderStampTaskLabel(task) : title.joint}</span>
        <span className={task.expired ? 'text-rose-700' : 'text-slate-700'}>{title.type}</span>
        <span
          className={`rounded border px-1.5 py-0.5 text-xs font-semibold ${
            task.expired ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-amber-200 bg-amber-50 text-amber-800'
          }`}
        >
          {task.expired ? 'просрочено' : `${task.daysLeft} дн.`}
        </span>
      </>
    )
  }
  if (task.kind === 'create') {
    return (
      <>
        <span className="text-slate-800">{title.joint}</span>
        <span className="text-slate-700">{title.type}</span>
        <span className="text-slate-400">·</span>
        <span className="text-amber-700">→</span>
        <span className="text-slate-800">{task.targetJoint}</span>
        <span className="text-slate-400">·</span>
        <span className={`inline-flex min-h-6 items-center rounded border px-1.5 text-xs font-semibold leading-none ${getLnkResultBadgeClass(task.result)}`}>
          {task.methodCode} - {task.result}
        </span>
      </>
    )
  }
  if (task.kind === 'coil') {
    return (
      <>
        <span className="text-slate-800">{title.joint}</span>
        <span className="text-slate-700">{title.type}</span>
        <span className="text-slate-400">·</span>
        <span className={`inline-flex min-h-6 items-center rounded border px-1.5 text-xs font-semibold leading-none ${getLnkResultBadgeClass(task.result)}`}>
          {task.methodCode} - {task.result}
        </span>
        <span className="text-slate-400">·</span>
        <span className="text-slate-800">катушка {task.targetJoints.join(' + ')}</span>
      </>
    )
  }
  if (task.kind === 'delete') {
    return (
      <>
        <span className="text-slate-800">{title.joint}</span>
        <span className="text-slate-700">{title.type}</span>
      </>
    )
  }
  if (task.kind === 'rename') {
    return (
      <>
        <span className="text-slate-800">{title.joint}</span>
        <span className="text-slate-700">{title.type}</span>
        <span className="text-slate-400">·</span>
        <span className="text-slate-500">ожидается {task.targetJoint}</span>
      </>
    )
  }
  if (task.kind === 'check') {
    return (
      <>
        <span className="text-slate-800">{title.joint}</span>
        <span className="text-slate-700">{title.type}</span>
      </>
    )
  }
  return (
    <>
      <span className="text-slate-800">{title.joint}</span>
      <span className="text-slate-700">{title.type}</span>
      <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-xs font-semibold text-amber-800">{task.count}</span>
    </>
  )
}

function RepeatedJointTaskActions({
  task,
  isTaskExpanded,
  onToggleDetails,
  onShowTask,
  onCreateTask,
  onDeleteTask,
  onRenameTask,
  canRunDispatcherMutation,
  isCreatePending,
  isDeletePending,
  isRenamePending,
}: DispatcherTaskCardProps) {
  const isExpanded = isTaskExpanded(task)

  if (task.kind === 'welder-stamp-expiry') {
    return (
      <div className="flex shrink-0 items-center overflow-hidden rounded-md border border-slate-200 bg-slate-50/80">
        <Button type="button" variant="ghost" size="sm" onClick={() => onToggleDetails(task)} className={dispatcherActionButtonClass}>
          {isExpanded ? 'Свернуть' : 'Подробнее'}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex shrink-0 items-center overflow-hidden rounded-md border border-slate-200 bg-slate-50/80">
      {(task.kind === 'create' || task.kind === 'coil') && canRunDispatcherMutation ? (
        <>
          <Button type="button" size="sm" onClick={() => onCreateTask(task)} disabled={isCreatePending} className={dispatcherPrimaryActionButtonClass}>
            {task.kind === 'coil' ? 'Катушка' : 'Создать'}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => onShowTask(task)} className={dispatcherActionButtonClass}>
            Цепочка
          </Button>
        </>
      ) : task.kind === 'delete' && canRunDispatcherMutation ? (
        <>
          <Button type="button" size="sm" variant="outline" onClick={() => onDeleteTask(task)} disabled={isDeletePending} className={dispatcherDangerActionButtonClass}>
            Удалить
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => onShowTask(task)} className={dispatcherActionButtonClass}>
            Цепочка
          </Button>
        </>
      ) : task.kind === 'rename' && canRunDispatcherMutation ? (
        <>
          <Button type="button" size="sm" onClick={() => onRenameTask(task)} disabled={isRenamePending} className={dispatcherPrimaryActionButtonClass}>
            Переименовать
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => onShowTask(task)} className={dispatcherActionButtonClass}>
            Цепочка
          </Button>
        </>
      ) : (
        <Button type="button" size="sm" variant="outline" onClick={() => onShowTask(task)} className={dispatcherStandaloneActionButtonClass}>
          Цепочка
        </Button>
      )}
      <Button type="button" variant="ghost" size="sm" onClick={() => onToggleDetails(task)} className={dispatcherActionButtonClass}>
        {isExpanded ? 'Свернуть' : 'Подробнее'}
      </Button>
    </div>
  )
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
        <RepeatedJointTaskActions task={task} nested={nested} {...handlers} />
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
  const title = getRepeatedJointTaskTitle(task)

  return (
    <div key={task.key} className="flex w-fit max-w-full flex-col gap-1 rounded-md border border-amber-200 bg-white/95 px-2 py-1.5">
      <div className="flex max-w-full items-center gap-1.5">
        <div className="flex min-w-0 items-center gap-1.5 text-sm">
          <span className="text-slate-800">{formatWelderStampTaskLabel(task)}</span>
          <span className={task.expired ? 'text-rose-700' : 'text-slate-700'}>{title.type}</span>
          <span
            className={`rounded border px-1.5 py-0.5 text-xs font-semibold ${
              task.expired ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-amber-200 bg-amber-50 text-amber-800'
            }`}
          >
            {task.expired ? 'просрочено' : `${task.daysLeft} дн.`}
          </span>
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
