import { DispatcherTaskPanel } from '@/components/dispatcher-panels'
import type { DispatcherTaskCardHandlers } from '@/components/dispatcher-task-card'
import { WelderStampNotificationPanel } from '@/components/welder-stamp-notification-panel'
import type { ActiveReport } from '@/lib/home-state'
import type { DispatcherTask, RepeatedJointTask, RepeatedJointTaskGroup, WelderStampExpiryTask } from '@/lib/dispatcher-types'

export type ReportTaskPanelsProps = {
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

export function ReportTaskPanels({
  activeReport,
  repeatedJointTasks,
  repeatedJointTaskGroups,
  repeatedJointTaskCount,
  hasMoreTasks,
  onLoadMoreTasks,
  isTaskBatchLoading,
  taskBatchError,
  onRetryTaskBatch,
  dispatcherTasksRefreshing,
  onDispatcherWorkspaceOpenChange,
  welderStampExpiryTasks,
  welderStampNotificationGroups,
  stickyLeft,
  handlers,
  isTaskExpanded,
  onToggleDetails,
  onCollapseTaskDetails,
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

  return (
    <DispatcherTaskPanel
      key={activeReport}
      tasks={repeatedJointTasks}
      groups={repeatedJointTaskGroups}
      totalTaskCount={repeatedJointTaskCount}
      hasMoreTasks={hasMoreTasks}
      onLoadMoreTasks={onLoadMoreTasks}
      isTaskBatchLoading={isTaskBatchLoading}
      taskBatchError={taskBatchError}
      onRetryTaskBatch={onRetryTaskBatch}
      isRefreshing={dispatcherTasksRefreshing}
      onWorkspaceOpenChange={onDispatcherWorkspaceOpenChange}
      stickyLeft={stickyLeft}
      handlers={handlers}
      onCollapseTaskDetails={onCollapseTaskDetails}
      defaultExpanded={activeReport !== 'heatTreatment'}
    />
  )
}
