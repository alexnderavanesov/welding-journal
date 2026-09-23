import type { DispatcherTaskCardHandlers } from '@/components/dispatcher-task-card'
import type { ReportTaskPanelsProps } from '@/components/report-task-panels'
import type { DispatcherTask, RepeatedJointTask, RepeatedJointTaskGroup, WelderStampExpiryTask } from '@/lib/dispatcher-types'
import type { ActiveReport } from '@/lib/home-state'

type CreateReportTaskPanelsPropsOptions = {
  activeReport: ActiveReport
  repeatedJointTasks: RepeatedJointTask[]
  repeatedJointTaskGroups: RepeatedJointTaskGroup[]
  repeatedJointTaskCount?: number
  computedRevision?: number
  taskFilterOptions?: Array<{ value: string; count: number; label: string }>
  hasMoreTasks?: boolean
  onLoadMoreTasks?: () => void
  isTaskBatchLoading?: boolean
  taskBatchError?: string
  onRetryTaskBatch?: () => void
  onRefreshTasks?: () => Promise<number | undefined>
  dispatcherTasksRefreshing?: boolean
  dispatcherWorkspaceOpen: boolean
  onDispatcherWorkspaceOpenChange: (open: boolean) => void
  welderStampExpiryTasks: WelderStampExpiryTask[]
  welderStampNotificationGroups: RepeatedJointTaskGroup[]
  stickyLeft: number
  handlers: DispatcherTaskCardHandlers
  isTaskExpanded: (task: DispatcherTask) => boolean
  onToggleDetails: (task: DispatcherTask) => void
  onCollapseTaskDetails: () => void
  onDismissTasks: (tasks: DispatcherTask[]) => void
}

export function createReportTaskPanelsProps({
  activeReport,
  repeatedJointTasks,
  repeatedJointTaskGroups,
  repeatedJointTaskCount,
  computedRevision,
  taskFilterOptions,
  hasMoreTasks,
  onLoadMoreTasks,
  isTaskBatchLoading,
  taskBatchError,
  onRetryTaskBatch,
  onRefreshTasks,
  dispatcherTasksRefreshing,
  dispatcherWorkspaceOpen,
  onDispatcherWorkspaceOpenChange,
  welderStampExpiryTasks,
  welderStampNotificationGroups,
  stickyLeft,
  handlers,
  isTaskExpanded,
  onToggleDetails,
  onCollapseTaskDetails,
  onDismissTasks,
}: CreateReportTaskPanelsPropsOptions): ReportTaskPanelsProps {
  return {
    activeReport,
    repeatedJointTasks,
    repeatedJointTaskGroups,
    repeatedJointTaskCount,
    computedRevision,
    taskFilterOptions,
    hasMoreTasks,
    onLoadMoreTasks,
    isTaskBatchLoading,
    taskBatchError,
    onRetryTaskBatch,
    onRefreshTasks,
    dispatcherTasksRefreshing,
    dispatcherWorkspaceOpen,
    onDispatcherWorkspaceOpenChange,
    welderStampExpiryTasks,
    welderStampNotificationGroups,
    stickyLeft,
    handlers,
    isTaskExpanded,
    onToggleDetails,
    onCollapseTaskDetails,
    onDismissTasks,
  }
}
