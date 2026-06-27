import type { DispatcherTaskCardHandlers } from '@/components/dispatcher-task-card'
import type { ReportTaskPanelsProps } from '@/components/report-task-panels'
import type { DispatcherTask, RepeatedJointTask, RepeatedJointTaskGroup, WelderStampExpiryTask } from '@/lib/dispatcher-types'
import type { ActiveReport } from '@/lib/home-state'

type CreateReportTaskPanelsPropsOptions = {
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

export function createReportTaskPanelsProps({
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
}: CreateReportTaskPanelsPropsOptions): ReportTaskPanelsProps {
  return {
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
  }
}
