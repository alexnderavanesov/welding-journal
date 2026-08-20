import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

import { formatDisplayDate } from '@/lib/date-format'
import { formatDaysLeft, formatReminderCount, formatTaskCount } from '@/lib/dispatcher-format'
import {
  getDispatcherSettingTaskTypeLabel,
  getDispatcherTaskCode,
  getDispatcherTaskSettingId,
} from '@/lib/dispatcher-settings'
import { compareDispatcherTaskCodes } from '@/lib/dispatcher-task-row-codes'
import { getRepeatedJointTaskDetails, getRepeatedJointTaskDetailsHeading } from '@/lib/dispatcher-text'
import type { DispatcherTask, RepeatedJointTaskGroup } from '@/lib/dispatcher-types'

export const dispatcherActionButtonClass =
  'h-8 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 shadow-none hover:bg-slate-100 hover:text-slate-900'
export const dispatcherStandaloneActionButtonClass =
  'h-8 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 shadow-none hover:bg-slate-100 hover:text-slate-900'
export const dispatcherPrimaryActionButtonClass =
  'h-8 rounded-md border border-sky-200 bg-sky-50 px-2.5 text-xs font-semibold text-sky-800 shadow-none hover:bg-sky-100 hover:text-sky-950'
export const dispatcherDangerActionButtonClass =
  'h-8 rounded-md border border-rose-200 bg-rose-50 px-2.5 text-xs font-semibold text-rose-700 shadow-none hover:bg-rose-100 hover:text-rose-800'

type DispatcherTaskDetailsProps = {
  task: DispatcherTask
}

export function DispatcherTaskDetails({ task }: DispatcherTaskDetailsProps) {
  const metrics = getDispatcherTaskMetrics(task)

  return (
    <div className="border-t border-slate-100 bg-slate-50/70 px-3 py-2 text-xs leading-5 text-slate-600">
      <div className="mx-auto w-full max-w-[1600px]">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="font-semibold text-slate-800">{getRepeatedJointTaskDetailsHeading(task)}</div>
          {metrics.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5" aria-label="Показатели задачи">
              {metrics.map((metric) => (
                <span
                  key={metric.label}
                  className={`inline-flex min-h-6 items-center gap-1 rounded border px-2 leading-none ${
                    metric.emphasis
                      ? 'border-amber-200 bg-amber-50 font-semibold text-amber-800'
                      : 'border-slate-200 bg-white text-slate-600'
                  }`}
                >
                  <span className="text-slate-400">{metric.label}</span>
                  <strong className="font-semibold text-slate-800">{metric.value}</strong>
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="mt-1.5 max-w-none text-[13px] leading-5 text-slate-600">
          {getRepeatedJointTaskDetails(task)}
        </div>
      </div>
    </div>
  )
}

function getDispatcherTaskMetrics(task: DispatcherTask) {
  if (task.kind !== 'percentage-line-control') return []

  const percent = String(task.row.weldControlPercent ?? '').trim()
  const issueLabel = task.issue === 'missing'
    ? 'Осталось'
    : task.issue === 'excess'
    ? 'Лишних'
    : task.issue === 'new-welder'
    ? 'Стыков'
    : 'Негодных'

  return [
    { label: 'Контроль', value: percent ? (percent.endsWith('%') ? percent : `${percent}%`) : '-' },
    { label: 'Клеймо', value: task.stamp },
    { label: 'Требуется', value: task.requiredControls },
    { label: 'Закрыто', value: task.coveredControls },
    { label: 'Назначено', value: task.assignedControls },
    { label: issueLabel, value: task.count, emphasis: true },
  ]
}

type DispatcherTaskGroupFrameProps = {
  group: RepeatedJointTaskGroup
  reminder?: boolean
  children: ReactNode | (() => ReactNode)
}

export function DispatcherTaskGroupFrame({ group, reminder = false, children }: DispatcherTaskGroupFrameProps) {
  const [isOpen, setIsOpen] = useState(false)
  const summaries = getDispatcherTaskGroupSummaries(group.tasks)
  const visibleSummaries = summaries.slice(0, 2)
  const hiddenSummaryCount = Math.max(0, summaries.length - visibleSummaries.length)
  const metric = getDispatcherTaskGroupMetric(group.tasks)

  return (
    <details
      className="group w-full border-b border-slate-200 bg-white last:border-b-0"
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
    >
      <summary className="min-h-10 cursor-pointer list-none px-3 py-2 text-sm marker:hidden hover:bg-slate-50">
        <span className="mx-auto flex w-full max-w-[1600px] items-center gap-2">
          <span className="font-semibold text-slate-900">{group.baseJoint}</span>
          <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-xs font-semibold text-amber-800">
            {reminder ? formatReminderCount(group.tasks.length) : formatTaskCount(group.tasks.length)}
          </span>
          <span
            className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden"
            aria-label={`Краткое описание задач ${group.baseJoint}`}
          >
            {visibleSummaries.map((summary) => (
              <span
                key={summary.code}
                className={`inline-flex min-w-0 items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs ${
                  visibleSummaries.length === 1 ? 'max-w-[440px]' : 'max-w-[280px]'
                }`}
                title={`${summary.code} · ${summary.label}`}
              >
                <strong className="shrink-0 font-semibold text-violet-700">{summary.code}</strong>
                <span className="truncate text-slate-600">· {summary.label}</span>
              </span>
            ))}
            {hiddenSummaryCount > 0 ? (
              <span
                className="shrink-0 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs font-semibold text-slate-500"
                title={summaries.slice(visibleSummaries.length).map((summary) => `${summary.code} · ${summary.label}`).join('; ')}
              >
                +{hiddenSummaryCount}
              </span>
            ) : null}
          </span>
          {metric ? (
            <span
              className="hidden max-w-[280px] shrink-0 items-center truncate rounded border border-sky-100 bg-sky-50/70 px-2 py-0.5 text-xs font-medium text-sky-800 md:inline-flex"
              title={metric}
            >
              {metric}
            </span>
          ) : null}
          {isOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />}
          <span className="sr-only">{isOpen ? 'Свернуть' : 'Открыть'}</span>
        </span>
      </summary>
      {isOpen ? (
        <div className="divide-y divide-slate-100 border-t border-slate-100">
          {typeof children === 'function' ? children() : children}
        </div>
      ) : null}
    </details>
  )
}

function getDispatcherTaskGroupSummaries(tasks: DispatcherTask[]) {
  const summaries = new Map<string, { code: string; label: string }>()
  for (const task of tasks) {
    const code = getDispatcherTaskCode(task)
    if (summaries.has(code)) continue
    summaries.set(code, {
      code,
      label: getDispatcherSettingTaskTypeLabel(getDispatcherTaskSettingId(task)),
    })
  }
  return [...summaries.values()].sort((left, right) => compareDispatcherTaskCodes(left.code, right.code))
}

function getDispatcherTaskGroupMetric(tasks: DispatcherTask[]) {
  if (tasks.length !== 1) return null
  const task = tasks[0]

  if (task.kind === 'percentage-line-control') {
    const issueLabel = task.issue === 'missing'
      ? 'осталось'
      : task.issue === 'excess'
      ? 'лишних'
      : task.issue === 'new-welder'
      ? 'стыков'
      : task.issue === 'suspend-welder'
      ? 'негодных'
      : 'проблем'
    return `Клеймо ${task.stamp} · ${issueLabel} ${task.count}`
  }
  if (task.kind === 'welder-stamp-expiry') {
    const permitName = task.permitKind === 'dls' ? 'ДЛС' : 'НАКС'
    return task.expired
      ? `${permitName} просрочен ${formatDisplayDate(task.validTo)}`
      : `${permitName} до ${formatDisplayDate(task.validTo)} · ${formatDaysLeft(task.daysLeft)}`
  }
  if (task.kind === 'duplicate-check') return `Дублей ${task.count}`
  if (task.kind === 'create') return `Создать ${task.targetJoint}`
  if (task.kind === 'coil') return `Создать ${task.targetJoints.join(' + ')}`
  if (task.kind === 'delete') return `Удалить ${task.targetJoint}`
  if (task.kind === 'rename') return `${task.currentJoint} → ${task.targetJoint}`
  return null
}
