import { JointNextActionTableCell } from '@/components/joint-next-action-table-cell'
import type { ControlProcessSettings } from '@/lib/control-process-settings'
import type { RepeatedJointTask, WeldRow } from '@/lib/dispatcher-types'
import type { ActiveReport } from '@/lib/home-state'
import type { JointNextAction } from '@/lib/joint-next-actions'
import type { WeldTableExtraColumn } from '@/lib/weld-table-extra-columns'

export function getJointNextActionTableColumns({
  activeReport,
  dispatcherTasks,
  dispatcherTasksByRow,
  dispatcherTasksPending,
  dispatcherTasksError,
  controlProcessSettings,
  onRunNextAction,
  onOpenOverview,
}: {
  activeReport: ActiveReport
  dispatcherTasks: readonly RepeatedJointTask[]
  dispatcherTasksByRow?: ReadonlyMap<number, RepeatedJointTask[]>
  dispatcherTasksPending?: boolean
  dispatcherTasksError?: string
  controlProcessSettings?: Pick<ControlProcessSettings, 'preHeatTreatmentLnkEnabled' | 'allowPrimaryLnkBeforePreviousStagesComplete'>
  onRunNextAction?: (row: WeldRow, action: JointNextAction) => void
  onOpenOverview?: (row: WeldRow) => void
}): WeldTableExtraColumn[] {
  if (
    !onRunNextAction ||
    !onOpenOverview ||
    (activeReport !== 'weldingJournal' && activeReport !== 'lnk' && activeReport !== 'heatTreatment')
  ) return []

  return [{
    key: 'jointNextAction',
    section: 'Следующий шаг',
    label: 'Следующее действие',
    width: 340,
    appearance: 'quiet',
    insertAfterSection: 'Стык',
    collapsible: true,
    renderCell: (row) => (
      <JointNextActionTableCell
        row={row}
        dispatcherTasks={dispatcherTasksByRow ? dispatcherTasksByRow.get(row.id) ?? [] : dispatcherTasks}
        tasksPending={dispatcherTasksPending}
        tasksError={dispatcherTasksError}
        controlProcessSettings={controlProcessSettings}
        onRun={onRunNextAction}
        onOpenOverview={onOpenOverview}
      />
    ),
  }]
}
