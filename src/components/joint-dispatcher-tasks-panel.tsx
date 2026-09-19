import { useEffect, useState } from 'react'
import { ArrowRight, Info, MoreHorizontal, ShieldAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  getDispatcherTaskActionSpecs,
  getDispatcherTaskScopeLabel,
  type DispatcherTaskActionSpec,
} from '@/lib/dispatcher-task-actions-model'
import { DISPATCHER_SETTING_CODES, getDispatcherTaskCode } from '@/lib/dispatcher-settings'
import {
  getDispatcherTasksForJointPicture,
  getDispatcherTasksForLinePicture,
} from '@/lib/dispatcher-task-row-codes'
import { getRepeatedJointTaskDetails, getRepeatedJointTaskTitle } from '@/lib/dispatcher-text'
import {
  isSystemDispatcherWarningTask,
  type RepeatedJointTask,
  type WeldRow,
} from '@/lib/dispatcher-types'
import { cn } from '@/lib/utils'

export type JointDispatcherTaskActionHandler = (
  row: WeldRow,
  task: RepeatedJointTask,
  action: DispatcherTaskActionSpec,
) => Promise<unknown> | unknown

type JointDispatcherTasksPanelProps = {
  row: WeldRow
  tasks: readonly RepeatedJointTask[]
  fallbackCodes?: string
  excludedTaskKeys?: readonly string[]
  onRunAction?: JointDispatcherTaskActionHandler
  onOpenLinePicture?: () => void
}

const JOINT_TASK_PREVIEW_LIMIT = 3
const LINE_SCOPED_TASK_CODES = new Set([
  DISPATCHER_SETTING_CODES['percentage-new-welder'],
  DISPATCHER_SETTING_CODES['percentage-excess'],
  DISPATCHER_SETTING_CODES['percentage-rejected-primary'],
  DISPATCHER_SETTING_CODES['percentage-missing'],
  DISPATCHER_SETTING_CODES['percentage-full-control'],
  DISPATCHER_SETTING_CODES['percentage-suspend-welder'],
  DISPATCHER_SETTING_CODES['line-percent'],
  DISPATCHER_SETTING_CODES['line-group'],
  DISPATCHER_SETTING_CODES['line-category'],
  DISPATCHER_SETTING_CODES['line-control-presence'],
  DISPATCHER_SETTING_CODES['line-psto-presence'],
])

export function JointDispatcherTasksPanel({
  row,
  tasks,
  fallbackCodes = '',
  excludedTaskKeys = [],
  onRunAction,
  onOpenLinePicture,
}: JointDispatcherTasksPanelProps) {
  const [showAll, setShowAll] = useState(false)
  const jointTasks = getDispatcherTasksForJointPicture(tasks, row)
  const lineTasks = getDispatcherTasksForLinePicture(tasks, row)
  const excludedKeys = new Set(excludedTaskKeys)
  const hiddenTaskCodes = new Set(
    [
      ...lineTasks.filter(isLineScopedTask),
      ...jointTasks.filter((task) => isChainStructureTask(task) || excludedKeys.has(task.key)),
    ]
      .map(getDispatcherTaskCode),
  )
  const relatedTasks = jointTasks
    .filter((task) => !isChainStructureTask(task) && !excludedKeys.has(task.key))
    .sort(compareTasks)
  const relatedTaskCodes = new Set(relatedTasks.map(getDispatcherTaskCode))
  const codes = parseCodes(fallbackCodes).filter(
    (code) =>
      !LINE_SCOPED_TASK_CODES.has(code) &&
      !hiddenTaskCodes.has(code) &&
      !relatedTaskCodes.has(code),
  )
  const visibleTasks = showAll ? relatedTasks : relatedTasks.slice(0, JOINT_TASK_PREVIEW_LIMIT)
  const hiddenTaskCount = relatedTasks.length - visibleTasks.length
  const hasLinePicture = lineTasks.length > 0 && Boolean(onOpenLinePicture)
  const systemWarningCount = relatedTasks.filter(isSystemDispatcherWarningTask).length
  const dispatcherTaskCount = relatedTasks.length - systemWarningCount + codes.length

  useEffect(() => {
    setShowAll(false)
  }, [row.id])

  if (relatedTasks.length === 0 && codes.length === 0 && !hasLinePicture) return null

  return (
    <section className="py-3" aria-label="Требует действия">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold uppercase text-slate-500">Требует действия</h3>
          {systemWarningCount > 0 ? (
            <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">
              СП · {systemWarningCount}
            </span>
          ) : null}
          {dispatcherTaskCount > 0 ? (
            <span className="rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[11px] font-semibold text-violet-700">
              ДЗ · {dispatcherTaskCount}
            </span>
          ) : null}
        </div>
        {hasLinePicture && onOpenLinePicture ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 border-sky-200 bg-sky-50 px-3 text-xs font-semibold text-sky-800 hover:bg-sky-100"
            onClick={onOpenLinePicture}
          >
            Картина линии · {lineTasks.length}
          </Button>
        ) : null}
      </div>

      {relatedTasks.length > 0 ? (
        <div className="mt-2 divide-y divide-slate-200 border-y border-slate-200">
          {visibleTasks.map((task) => (
            <JointDispatcherTaskItem
              key={task.key}
              row={row}
              task={task}
              onRunAction={onRunAction}
            />
          ))}
        </div>
      ) : null}
      {hiddenTaskCount > 0 ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-2 h-8 px-2 text-xs font-semibold text-sky-700 hover:bg-sky-50 hover:text-sky-800"
          onClick={() => setShowAll(true)}
        >
          Показать ещё {hiddenTaskCount}
        </Button>
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
      {relatedTasks.length === 0 && codes.length === 0 ? (
        <p className="mt-2 text-sm text-slate-400">Нет активных задач по стыку.</p>
      ) : null}
    </section>
  )
}

export function JointDispatcherTaskItem({
  row,
  task,
  onRunAction,
  presentation = 'joint',
}: {
  row: WeldRow
  task: RepeatedJointTask
  onRunAction?: JointDispatcherTaskActionHandler
  presentation?: 'joint' | 'line'
}) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const actions = getDispatcherTaskActionSpecs(task, { canCreateEarlyCoil: true })
  const primaryAction = actions[0]
  const secondaryActions = actions.slice(1)
  const code = getDispatcherTaskCode(task)
  const title = getRepeatedJointTaskTitle(task)
  const lineLabel = getLineTaskLabel(task)

  const runAction = async (action: DispatcherTaskActionSpec) => {
    if (!onRunAction || pendingAction) return
    setMenuOpen(false)
    setPendingAction(action.key ?? action.id)
    try {
      await onRunAction(row, task, action)
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
            {presentation === 'line' ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm font-semibold text-slate-900">{lineLabel}</span>
                <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                  {getDispatcherTaskScopeLabel(task)}
                </span>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={cn(
                  'rounded border px-1.5 py-0.5 text-xs font-semibold',
                  isSystemDispatcherWarningTask(task)
                    ? 'border-amber-200 bg-amber-50 text-amber-800'
                    : 'border-violet-200 bg-violet-50 text-violet-700',
                )}>
                  {code}
                </span>
                <span className="text-sm font-semibold text-slate-900">{title.type}</span>
                <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                  {getDispatcherTaskScopeLabel(task)}
                </span>
              </div>
            )}
            <p className="mt-1 text-xs text-slate-500">
              {presentation === 'line'
                ? getLineTaskContext(task)
                : <>{title.joint ? `${title.joint} · ` : ''}{getTaskContext(task)}</>}
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
                      key={action.key ?? action.id}
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
  const systemWarningOrder = Number(isSystemDispatcherWarningTask(right)) - Number(isSystemDispatcherWarningTask(left))
  return (
    systemWarningOrder ||
    getDispatcherTaskCode(left).localeCompare(getDispatcherTaskCode(right), 'ru', { numeric: true }) ||
    left.key.localeCompare(right.key, 'ru')
  )
}

function getTaskContext(task: RepeatedJointTask) {
  if (task.kind === 'percentage-line-control') return `линия ${task.line}, клеймо ${task.stamp}`
  if (task.kind === 'line-consistency') return `линия ${task.line}`
  return `линия ${String(task.row.line ?? '-').trim() || '-'}`
}

function getLineTaskLabel(task: RepeatedJointTask) {
  if (task.kind === 'percentage-line-control') return `Клеймо ${task.stamp}`
  if (task.kind === 'line-consistency') return 'Вся линия'
  const joint = getRepeatedJointTaskTitle(task).joint
  return joint ? `Стык ${joint}` : 'Задача линии'
}

function getLineTaskContext(task: RepeatedJointTask) {
  if (task.kind === 'percentage-line-control') {
    const joint = String(task.row.joint ?? '').trim()
    const targetCount = task.targetRowIds?.length ?? 0
    const parts = [targetCount > 0 ? `связанных стыков: ${targetCount}` : `стыков клейма: ${task.count}`]
    if (joint) parts.push(`опорный стык ${joint}`)
    return parts.join(' · ')
  }
  if (task.kind === 'line-consistency') return `Поле: ${task.fieldLabel}`
  return getTaskContext(task)
}

function parseCodes(value: string) {
  return [...new Set(value.split(/[,;]+/).map((code) => code.trim()).filter(Boolean))]
}

function isChainStructureTask(task: RepeatedJointTask) {
  return task.kind === 'create' || task.kind === 'coil' || task.kind === 'delete' || task.kind === 'rename'
}

function isLineScopedTask(task: RepeatedJointTask) {
  return task.kind === 'line-consistency' || task.kind === 'percentage-line-control'
}
