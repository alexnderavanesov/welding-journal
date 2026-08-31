import { JointNextActionTableCell } from '@/components/joint-next-action-table-cell'
import type { RepeatedJointTask, WeldRow } from '@/lib/dispatcher-types'
import type { ActiveReport } from '@/lib/home-state'
import type { JointNextAction } from '@/lib/joint-next-actions'
import type { WeldTableExtraColumn } from '@/lib/weld-table-extra-columns'

export function getJointNextActionTableColumns({
  activeReport,
  dispatcherTasks,
  onRunNextAction,
  onOpenOverview,
}: {
  activeReport: ActiveReport
  dispatcherTasks: readonly RepeatedJointTask[]
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
    insertBeforeSection: 'Материалы',
    collapsible: true,
    renderCell: (row) => (
      <JointNextActionTableCell
        row={row}
        dispatcherTasks={dispatcherTasks}
        onRun={onRunNextAction}
        onOpenOverview={onOpenOverview}
      />
    ),
  }]
}
