import { ArrowRight, CheckCircle2, Info, TriangleAlert } from 'lucide-react'
import type { MouseEvent } from 'react'

import type { ControlProcessSettings } from '@/lib/control-process-settings'
import type { RepeatedJointTask, WeldRow } from '@/lib/dispatcher-types'
import { buildJointNextActions, type JointNextAction } from '@/lib/joint-next-actions'

export function JointNextActionTableCell({
  row,
  dispatcherTasks,
  controlProcessSettings,
  onRun,
  onOpenOverview,
}: {
  row: WeldRow
  dispatcherTasks: readonly RepeatedJointTask[]
  controlProcessSettings?: Pick<ControlProcessSettings, 'preHeatTreatmentLnkEnabled' | 'allowPrimaryLnkBeforePreviousStagesComplete'>
  onRun: (row: WeldRow, action: JointNextAction) => void
  onOpenOverview: (row: WeldRow) => void
}) {
  const action = buildJointNextActions(row, dispatcherTasks, controlProcessSettings)[0]
  if (!action) return null
  const Icon = action.tone === 'success'
    ? CheckCircle2
    : action.tone === 'warning'
      ? TriangleAlert
      : ArrowRight
  const actionClass = action.tone === 'success'
    ? 'text-emerald-700'
    : action.tone === 'warning'
      ? 'text-amber-700'
      : 'text-sky-800'
  const handleOverviewClick = (event: MouseEvent) => {
    event.stopPropagation()
    onOpenOverview(row)
  }
  const handleActionClick = (event: MouseEvent) => {
    event.stopPropagation()
    if (action.buttonLabel) onRun(row, action)
    else onOpenOverview(row)
  }

  return (
    <div
      data-joint-next-action-cell="true"
      className="flex h-[52px] min-w-0 cursor-pointer items-center gap-2 px-2.5"
      title={`${action.title}\n${action.description}\nОткрыть картину стыка`}
      onClick={handleOverviewClick}
    >
      <Icon className={`h-4 w-4 shrink-0 ${actionClass}`} />
      <div className="min-w-0 flex-1 text-left">
        <span className={`block truncate text-xs font-semibold ${actionClass}`}>{action.title}</span>
        <span className="mt-0.5 block truncate text-[11px] text-slate-500">{action.description}</span>
      </div>
      <button
        type="button"
        onClick={handleOverviewClick}
        aria-label={`Открыть картину стыка ${String(row.joint ?? '').trim() || row.id}`}
        title="Картина стыка"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-slate-200 bg-white/80 text-slate-500 hover:border-sky-300 hover:bg-white hover:text-sky-800"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={handleActionClick}
        aria-label={action.buttonLabel ? `Выполнить: ${action.title}` : 'Открыть картину стыка'}
        title={action.buttonLabel ? `${action.buttonLabel}: ${action.title}` : 'Открыть картину стыка'}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-slate-200 bg-white/80 text-slate-600 hover:border-sky-300 hover:bg-white hover:text-sky-800"
      >
        <ArrowRight className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
