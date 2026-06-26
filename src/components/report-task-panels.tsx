import { DispatcherTaskPanel, WelderStampNotificationPanel } from '@/components/dispatcher-panels'
import type { DispatcherTaskCardHandlers } from '@/components/dispatcher-task-card'
import type { ActiveReport } from '@/lib/home-state'
import type { DispatcherTask, RepeatedJointTask, RepeatedJointTaskGroup, WelderStampExpiryTask } from '@/lib/dispatcher-types'

type ReportTaskPanelsProps = {
  activeReport: ActiveReport
  repeatedJointTasks: RepeatedJointTask[]
  repeatedJointTaskGroups: RepeatedJointTaskGroup[]
  welderStampExpiryTasks: WelderStampExpiryTask[]
  welderStampNotificationGroups: RepeatedJointTaskGroup[]
  stickyLeft: number
  handlers: DispatcherTaskCardHandlers
  isTaskExpanded: (task: DispatcherTask) => boolean
  onToggleDetails: (task: DispatcherTask) => void
  onDismissTasks: (tasks: DispatcherTask[]) => void
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
  onDismissTasks,
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

  if (activeReport === 'heatTreatment') return null

  return (
    <DispatcherTaskPanel
      tasks={repeatedJointTasks}
      groups={repeatedJointTaskGroups}
      stickyLeft={stickyLeft}
      handlers={handlers}
      onDismissAll={onDismissTasks}
    />
  )
}
