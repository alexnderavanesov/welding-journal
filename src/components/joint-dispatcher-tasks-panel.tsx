import { useState } from 'react'
import { ArrowRight, Info, MoreHorizontal, ShieldAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  getDispatcherTaskActionSpecs,
  getDispatcherTaskScopeLabel,
  type DispatcherTaskActionId,
  type DispatcherTaskActionSpec,
} from '@/lib/dispatcher-task-actions-model'
import { getDispatcherTaskCode } from '@/lib/dispatcher-settings'
import { getDispatcherTasksForRow } from '@/lib/dispatcher-task-row-codes'
import { getRepeatedJointTaskDetails, getRepeatedJointTaskTitle } from '@/lib/dispatcher-text'
import type { RepeatedJointTask, WeldRow } from '@/lib/dispatcher-types'
import { cn } from '@/lib/utils'

export type JointDispatcherTaskActionHandler = (
  row: WeldRow,
  task: RepeatedJointTask,
  actionId: DispatcherTaskActionId,
) => Promise<unknown> | unknown

type JointDispatcherTasksPanelProps = {
  row: WeldRow
  tasks: readonly RepeatedJointTask[]
  fallbackCodes?: string
  excludedTaskKeys?: readonly string[]
  onRunAction?: JointDispatcherTaskActionHandler
}

export function JointDispatcherTasksPanel({
  row,
  tasks,
  fallbackCodes = '',
  excludedTaskKeys = [],
  onRunAction,
}: JointDispatcherTasksPanelProps) {
  const allRelatedTasks = getDispatcherTasksForRow(tasks, row)
  const excludedKeys = new Set(excludedTaskKeys)
  const hiddenTaskCodes = new Set(
    allRelatedTasks
      .filter((task) => isChainStructureTask(task) || excludedKeys.has(task.key))
      .map(getDispatcherTaskCode),
  )
  const relatedTasks = allRelatedTasks
    .filter((task) => !isChainStructureTask(task) && !excludedKeys.has(task.key))
    .sort(compareTasks)
  const relatedTaskCodes = new Set(relatedTasks.map(getDispatcherTaskCode))
  const codes = parseCodes(fallbackCodes).filter(
    (code) => !hiddenTaskCodes.has(code) && !relatedTaskCodes.has(code),
  )
  if (relatedTasks.length === 0 && codes.length === 0) return null

  return (
    <section className="py-3" aria-label="Активные задачи диспетчера">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-semibold uppercase text-slate-500">Активные ДЗ</h3>
        <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">
          {relatedTasks.length + codes.length}
        </span>
      </div>

      {relatedTasks.length > 0 ? (
        <div className="mt-2 divide-y divide-slate-200 border-y border-slate-200">
          {relatedTasks.map((task) => (
            <JointDispatcherTaskRow
              key={task.key}
              row={row}
              task={task}
              onRunAction={onRunAction}
            />
          ))}
        </div>
      ) : null}
      {codes.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 py-1">
          {codes.map((code) => (
            <span key={code} className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">
              {code}
            </span>
          ))}
          <span className="text-xs text-slate-500">Описание действий обновляется.</span>
        </div>
      ) : null}
    </section>
  )
}

function JointDispatcherTaskRow({
  row,
  task,
  onRunAction,
}: {
  row: WeldRow
  task: RepeatedJointTask
  onRunAction?: JointDispatcherTaskActionHandler
}) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState<DispatcherTaskActionId | null>(null)
  const actions = getDispatcherTaskActionSpecs(task, { canCreateEarlyCoil: true })
  const primaryAction = actions[0]
  const secondaryActions = actions.slice(1)
  const code = getDispatcherTaskCode(task)
  const title = getRepeatedJointTaskTitle(task)

  const runAction = async (action: DispatcherTaskActionSpec) => {
    if (!onRunAction || pendingAction) return
    setMenuOpen(false)
    setPendingAction(action.id)
    try {
      await onRunAction(row, task, action.id)
    } finally {
      setPendingAction(null)
    }
  }

  return (
    <div className="bg-white px-1 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-2.5">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-xs font-semibold text-violet-700">
                {code}
              </span>
              <span className="text-sm font-semibold text-slate-900">{title.type}</span>
              <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                {getDispatcherTaskScopeLabel(task)}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {title.joint ? `${title.joint} · ` : ''}{getTaskContext(task)}
            </p>
            {detailsOpen ? (
              <p className="mt-2 max-w-3xl text-xs leading-5 text-slate-600">{getRepeatedJointTaskDetails(task)}</p>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {primaryAction && onRunAction ? (
            <Button
              type="button"
              size="sm"
              variant={primaryAction.tone === 'primary' ? 'default' : 'outline'}
              className={cn(
                'h-8 gap-1.5 text-xs',
                primaryAction.tone === 'danger' && 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100',
              )}
              disabled={Boolean(pendingAction)}
              onClick={() => void runAction(primaryAction)}
            >
              {primaryAction.label}
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          ) : null}

          {secondaryActions.length > 0 && onRunAction ? (
            <div className="relative">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={Boolean(pendingAction)}
                aria-label={`Другие действия ${code}`}
                title="Другие действия"
                onClick={() => setMenuOpen((current) => !current)}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
              {menuOpen ? (
                <div className="absolute right-0 top-full z-30 mt-1 min-w-56 overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-lg">
                  {secondaryActions.map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      className={cn(
                        'block w-full px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50',
                        action.tone === 'danger' && 'text-rose-700 hover:bg-rose-50',
                      )}
                      onClick={() => void runAction(action)}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-slate-500"
            aria-label={detailsOpen ? `Скрыть описание ${code}` : `Показать описание ${code}`}
            title={detailsOpen ? 'Скрыть описание' : 'Показать описание'}
            onClick={() => setDetailsOpen((current) => !current)}
          >
            <Info className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

function compareTasks(left: RepeatedJointTask, right: RepeatedJointTask) {
  return (
    getDispatcherTaskCode(left).localeCompare(getDispatcherTaskCode(right), 'ru', { numeric: true }) ||
    left.key.localeCompare(right.key, 'ru')
  )
}

function getTaskContext(task: RepeatedJointTask) {
  if (task.kind === 'percentage-line-control') return `линия ${task.line}, клеймо ${task.stamp}`
  if (task.kind === 'line-consistency') return `линия ${task.line}`
  return `линия ${String(task.row.line ?? '-').trim() || '-'}`
}

function parseCodes(value: string) {
  return [...new Set(value.split(/[,;]+/).map((code) => code.trim()).filter(Boolean))]
}

function isChainStructureTask(task: RepeatedJointTask) {
  return task.kind === 'create' || task.kind === 'coil' || task.kind === 'delete' || task.kind === 'rename'
}
