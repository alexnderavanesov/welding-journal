import { DispatcherTaskPanel } from '@/components/dispatcher-panels'
import type { DispatcherTaskCardHandlers } from '@/components/dispatcher-task-card'
import { WelderStampNotificationPanel } from '@/components/welder-stamp-notification-panel'
import type { ActiveReport } from '@/lib/home-state'
import type { DispatcherTask, RepeatedJointTask, RepeatedJointTaskGroup, WelderStampExpiryTask } from '@/lib/dispatcher-types'

export type ReportTaskPanelsProps = {
  activeReport: ActiveReport
  repeatedJointTasks: RepeatedJointTask[]
  repeatedJointTaskGroups: RepeatedJointTaskGroup[]
  welderStampExpiryTasks: WelderStampExpiryTask[]
  welderStampNotificationGroups: RepeatedJointTaskGroup[]
  stickyLeft: number
  handlers: DispatcherTaskCardHandlers
  isTaskExpanded: (task: DispatcherTask) => boolean
  onToggleDetails: (task: DispatcherTask) => void
  onCollapseTaskDetails: () => void
  onDismissTasks: (tasks: DispatcherTask[]) => void
  columnFilters: Record<string, string>
  onColumnFiltersChange: (filters: Record<string, string>) => void
}

export function ReportTaskPanels({
  activeReport,
  repeatedJointTasks,
  repeatedJointTaskGroups,
  welderStampExpiryTasks,
  welderStampNotificationGroups,
  stickyLeft,
  handlers,
  isTaskExpanded,
  onToggleDetails,
  onCollapseTaskDetails,
  onDismissTasks,
  columnFilters,
  onColumnFiltersChange,
}: ReportTaskPanelsProps) {
  if (activeReport === 'welderStamps') {
    return (
      <WelderStampNotificationPanel
        tasks={welderStampExpiryTasks}
        groups={welderStampNotificationGroups}
        isTaskExpanded={isTaskExpanded}
        onToggleDetails={onToggleDetails}
        onDismissAll={onDismissTasks}
      />
    )
  }

  return (
    <DispatcherTaskPanel
      key={activeReport}
      tasks={repeatedJointTasks}
      groups={repeatedJointTaskGroups}
      stickyLeft={stickyLeft}
      handlers={handlers}
      columnFilters={columnFilters}
      onColumnFiltersChange={onColumnFiltersChange}
      onCollapseTaskDetails={onCollapseTaskDetails}
      defaultExpanded={activeReport !== 'heatTreatment'}
    />
  )
}
