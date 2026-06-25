import { Button } from '@/components/ui/button'
import {
  DispatcherTaskGroup,
  type DispatcherTaskCardHandlers,
  WelderStampNotificationGroup,
} from '@/components/dispatcher-task-card'
import type { DispatcherTask, RepeatedJointTask, RepeatedJointTaskGroup, WelderStampExpiryTask } from '@/lib/dispatcher-types'

type DispatcherTaskPanelProps = {
  tasks: RepeatedJointTask[]
  groups: RepeatedJointTaskGroup[]
  stickyLeft: number
  handlers: DispatcherTaskCardHandlers
  onDismissAll: (tasks: DispatcherTask[]) => void
}

export function DispatcherTaskPanel({ tasks, groups, stickyLeft, handlers, onDismissAll }: DispatcherTaskPanelProps) {
  if (tasks.length === 0) return null

  return (
    <div
      className="sticky z-30 max-w-[calc(100vw-2rem)] overflow-x-auto rounded-md border border-amber-200 bg-amber-50/90 px-3 py-2 shadow-sm shadow-amber-100"
      style={{ left: stickyLeft, width: `calc(100vw - ${stickyLeft + 24}px)` }}
    >
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 leading-snug">
            <span className="shrink-0 text-sm font-semibold text-amber-950">Диспетчер задач</span>
            <span className="min-w-0 text-xs leading-snug text-amber-800">
              Найдено: {tasks.length}. Действие только после подтверждения.
            </span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onDismissAll(tasks)}
            className="h-8 border-amber-300 bg-white px-3 text-xs text-amber-900 hover:bg-amber-100"
          >
            Скрыть все
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {groups.map((group) => (
            <DispatcherTaskGroup key={group.key} group={group} {...handlers} />
          ))}
        </div>
      </div>
    </div>
  )
}

type WelderStampNotificationPanelProps = {
  tasks: WelderStampExpiryTask[]
  groups: RepeatedJointTaskGroup[]
  isTaskExpanded: (task: DispatcherTask) => boolean
  onToggleDetails: (task: DispatcherTask) => void
  onDismissAll: (tasks: DispatcherTask[]) => void
}

export function WelderStampNotificationPanel({
  tasks,
  groups,
  isTaskExpanded,
  onToggleDetails,
  onDismissAll,
}: WelderStampNotificationPanelProps) {
  if (tasks.length === 0) return null

  return (
    <div className="relative z-30 w-full max-w-full overflow-x-auto rounded-md border border-amber-200 bg-amber-50/90 px-3 py-2 shadow-sm shadow-amber-100">
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 leading-snug">
            <span className="shrink-0 text-sm font-semibold text-amber-950">Диспетчер оповещений клейм</span>
            <span className="min-w-0 text-xs leading-snug text-amber-800">
              Найдено: {tasks.length} · Напоминания по сроку действия НАКС
            </span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onDismissAll(tasks)}
            className="h-8 border-amber-300 bg-white px-3 text-xs text-amber-900 hover:bg-amber-100"
          >
            Скрыть все
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {groups.map((group) => (
            <WelderStampNotificationGroup
              key={group.key}
              group={group}
              isTaskExpanded={isTaskExpanded}
              onToggleDetails={onToggleDetails}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
