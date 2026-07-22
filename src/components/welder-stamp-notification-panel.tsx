import { WelderStampNotificationGroup } from '@/components/welder-stamp-notification-card'
import { Button } from '@/components/ui/button'
import type { DispatcherTask, RepeatedJointTaskGroup, WelderStampExpiryTask } from '@/lib/dispatcher-types'

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
              Найдено: {tasks.length} · Напоминания по сроку действия НАКС и ДЛС
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
