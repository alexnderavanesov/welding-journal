import { useEffect, useRef, useState } from 'react'
import { ArrowRight, ChevronDown, ChevronRight, MoreHorizontal, ShieldAlert } from 'lucide-react'

import { DispatcherActionMenu } from '@/components/dispatcher-task-actions'
import { Button } from '@/components/ui/button'
import {
  getDispatcherTaskActionSpecs,
  getDispatcherTaskScopeLabel,
  type DispatcherTaskActionSpec,
} from '@/lib/dispatcher-task-actions-model'
import { getDispatcherTaskCode } from '@/lib/dispatcher-settings'
import { getRepeatedJointTaskDetails, getRepeatedJointTaskTitle } from '@/lib/dispatcher-text'
import { buildJointPictureTaskCollection } from '@/lib/joint-picture-tasks'
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
  onRunAction?: JointDispatcherTaskActionHandler
  highlightedTaskKey?: string | null
}

export function JointDispatcherTasksPanel({
  row,
  tasks,
  fallbackCodes = '',
  onRunAction,
  highlightedTaskKey,
}: JointDispatcherTasksPanelProps) {
  const collection = buildJointPictureTaskCollection({ row, tasks, fallbackCodes })
  const { relatedTasks, codes, systemWarningCount, dispatcherTaskCount } = collection

  return (
    <section className="min-w-0" aria-label="Требует действия">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-900">
              Задачи по стыку {String(row.joint ?? '-').trim() || '-'}
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Активные предупреждения и задачи диспетчера
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
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
      </div>

      {relatedTasks.length > 0 ? (
        <div className="divide-y divide-slate-200">
          {relatedTasks.map((task) => (
            <JointDispatcherTaskItem
              key={task.key}
              row={row}
              task={task}
              onRunAction={onRunAction}
              isHighlighted={task.key === highlightedTaskKey}
            />
          ))}
        </div>
      ) : null}
      {codes.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-200 py-3">
          {codes.map((code) => (
            <span key={code} className={cn(
              'rounded border px-2 py-1 text-xs font-semibold',
              code.startsWith('СП-')
                ? 'border-amber-200 bg-amber-50 text-amber-800'
                : 'border-violet-200 bg-violet-50 text-violet-700',
            )}>
              {code}
            </span>
          ))}
          <span className="text-xs text-slate-500">Описание действий обновляется.</span>
        </div>
      ) : null}
      {relatedTasks.length === 0 && codes.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-400">По этому стыку нет активных СП или ДЗ.</p>
      ) : null}
    </section>
  )
}

export function JointDispatcherTasksSummary({
  row,
  tasks,
  fallbackCodes = '',
  onOpen,
}: {
  row: WeldRow
  tasks: readonly RepeatedJointTask[]
  fallbackCodes?: string
  onOpen: () => void
}) {
  const collection = buildJointPictureTaskCollection({ row, tasks, fallbackCodes })
  if (collection.totalCount === 0) return null

  return (
    <section className="py-3" aria-label="Кратко о задачах стыка">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50/60 px-3.5 py-3 text-left transition-colors hover:border-amber-300 hover:bg-amber-50"
        onClick={onOpen}
        aria-label={`Открыть задачи по стыку: ${collection.totalCount}`}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600" />
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-slate-900">Требует действия</span>
            <span className="mt-0.5 block text-xs text-slate-600">
              {formatTaskSummary(collection.systemWarningCount, collection.dispatcherTaskCount)}
            </span>
          </span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />
      </button>
    </section>
  )
}

export function JointDispatcherTaskItem({
  row,
  task,
  onRunAction,
  presentation = 'joint',
  isCurrentRow = false,
  isHighlighted = false,
}: {
  row: WeldRow
  task: RepeatedJointTask
  onRunAction?: JointDispatcherTaskActionHandler
  presentation?: 'joint' | 'line'
  isCurrentRow?: boolean
  isHighlighted?: boolean
}) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const itemRef = useRef<HTMLDivElement>(null)
  const actions = getDispatcherTaskActionSpecs(task, { canCreateEarlyCoil: true })
  const primaryAction = actions[0]
  const secondaryActions = actions.slice(1)
  const code = getDispatcherTaskCode(task)
  const title = getRepeatedJointTaskTitle(task)
  const lineLabel = getLineTaskLabel(task)
  const scopeLabel = getDispatcherTaskScopeLabel(task)
  const showScopeLabel = presentation !== 'line' || scopeLabel !== 'Этот стык'
  const taskContext = presentation === 'line'
    ? getLineTaskContext(task)
    : `${title.joint ? `${title.joint} · ` : ''}${getTaskContext(task)}`

  useEffect(() => {
    if (!isHighlighted) return
    itemRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [isHighlighted])

  const runAction = async (action: DispatcherTaskActionSpec) => {
    if (!onRunAction || pendingAction) return
    setPendingAction(action.key ?? action.id)
    try {
      await onRunAction(row, task, action)
    } finally {
      setPendingAction(null)
    }
  }

  return (
    <div
      ref={itemRef}
      className={cn(
        'px-2 py-3 transition-colors hover:bg-sky-50/70',
        isCurrentRow && 'border-l-2 border-sky-400 bg-sky-50/40 pl-2.5',
        isHighlighted && 'bg-sky-50 ring-1 ring-inset ring-sky-200',
      )}
      data-highlighted={isHighlighted ? 'true' : undefined}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch sm:justify-between">
        <button
          type="button"
          className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-300"
          aria-expanded={detailsOpen}
          aria-label={detailsOpen ? `Скрыть описание ${code}` : `Показать описание ${code}`}
          title={detailsOpen ? 'Свернуть описание задачи' : 'Открыть описание задачи'}
          onClick={() => setDetailsOpen((current) => !current)}
        >
          <span
            className={cn(
              'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center',
              detailsOpen ? 'text-sky-700' : 'text-slate-400',
            )}
            data-joint-task-toggle-indicator
            data-expanded={detailsOpen ? 'true' : 'false'}
            aria-hidden="true"
          >
            {detailsOpen
              ? <ChevronDown className="h-4 w-4" />
              : <ChevronRight className="h-4 w-4" />}
          </span>
          <div className="min-w-0 flex-1">
            {presentation === 'line' ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm font-semibold text-slate-900">{lineLabel}</span>
                {showScopeLabel ? (
                  <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                    {scopeLabel}
                  </span>
                ) : null}
                {isCurrentRow ? (
                  <span className="rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[11px] font-semibold text-sky-800">
                    Этот стык
                  </span>
                ) : null}
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
                  {scopeLabel}
                </span>
              </div>
            )}
            {taskContext ? <p className="mt-1 text-xs text-slate-500">{taskContext}</p> : null}
            {detailsOpen ? (
              <p className="mt-2 max-w-3xl text-xs leading-5 text-slate-600">{getRepeatedJointTaskDetails(task)}</p>
            ) : null}
          </div>
        </button>

        <div className="flex shrink-0 items-center gap-1.5">
          {primaryAction && onRunAction ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={cn(
                'h-auto min-h-8 gap-1.5 whitespace-normal border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-900 hover:bg-sky-100',
                primaryAction.tone !== 'primary' && primaryAction.tone !== 'danger' &&
                  'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
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
            <DispatcherActionMenu
              items={secondaryActions.map((action) => ({
                key: action.key ?? action.id,
                label: action.label,
                tone: action.tone,
                onClick: () => void runAction(action),
              }))}
              triggerContent={<MoreHorizontal className="h-4 w-4" />}
              triggerAriaLabel={`Другие действия ${code}`}
              triggerTitle="Другие действия"
              triggerClassName="h-8 w-8 bg-white"
              triggerSize="icon"
              disabled={Boolean(pendingAction)}
            />
          ) : null}
        </div>
      </div>
    </div>
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
  return ''
}

function formatTaskSummary(systemWarningCount: number, dispatcherTaskCount: number) {
  const parts = []
  if (systemWarningCount > 0) parts.push(`СП: ${systemWarningCount}`)
  if (dispatcherTaskCount > 0) parts.push(`ДЗ: ${dispatcherTaskCount}`)
  return parts.join(' · ')
}
