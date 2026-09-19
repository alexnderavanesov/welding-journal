import { useState } from 'react'
import { ChevronDown, ChevronUp, ListTodo } from 'lucide-react'

import {
  JointDispatcherTaskItem,
  type JointDispatcherTaskActionHandler,
} from '@/components/joint-dispatcher-tasks-panel'
import { Button } from '@/components/ui/button'
import { getDispatcherTaskCode } from '@/lib/dispatcher-settings'
import {
  compareDispatcherTaskCodes,
  getDispatcherTasksForLinePicture,
} from '@/lib/dispatcher-task-row-codes'
import { getRepeatedJointTaskTitle } from '@/lib/dispatcher-text'
import type { RepeatedJointTask, WeldRow } from '@/lib/dispatcher-types'

type LinePictureOverviewProps = {
  row: WeldRow
  tasks: readonly RepeatedJointTask[]
  onRunAction: JointDispatcherTaskActionHandler
}

type LineTaskGroup = {
  key: string
  code: string
  title: string
  tasks: RepeatedJointTask[]
}

const LINE_TASK_PREVIEW_LIMIT = 3

export function LinePictureOverview({
  row,
  tasks,
  onRunAction,
}: LinePictureOverviewProps) {
  const lineTasks = getDispatcherTasksForLinePicture(tasks, row)
  const groups = buildLineTaskGroups(lineTasks)

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="flex items-center gap-2.5">
          <ListTodo className="h-4 w-4 text-sky-700" />
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Активные задачи линии</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Задач: {lineTasks.length} · типов проблем: {groups.length}
            </p>
          </div>
        </div>
      </div>

      {groups.length > 0 ? (
        <div className="divide-y divide-slate-200">
          {groups.map((group) => (
            <LinePictureTaskGroup
              key={group.key}
              group={group}
              onRunAction={onRunAction}
            />
          ))}
        </div>
      ) : (
        <p className="py-8 text-center text-sm text-slate-400">На линии нет активных задач.</p>
      )}
    </div>
  )
}

function LinePictureTaskGroup({
  group,
  onRunAction,
}: {
  group: LineTaskGroup
  onRunAction: JointDispatcherTaskActionHandler
}) {
  const [expanded, setExpanded] = useState(true)
  const [showAll, setShowAll] = useState(false)
  const visibleTasks = showAll ? group.tasks : group.tasks.slice(0, LINE_TASK_PREVIEW_LIMIT)
  const hiddenTaskCount = group.tasks.length - visibleTasks.length

  return (
    <section className="py-1" aria-label={`${group.code} ${group.title}`}>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-1 py-3 text-left hover:bg-slate-50"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-xs font-semibold text-violet-700">
            {group.code}
          </span>
          <span className="text-sm font-semibold text-slate-900">{group.title}</span>
          <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">
            {group.tasks.length}
          </span>
        </span>
        {expanded ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-slate-500" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
        )}
      </button>

      {expanded ? (
        <div className="divide-y divide-slate-200 border-t border-slate-200 pl-3">
          {visibleTasks.map((task) => (
            <JointDispatcherTaskItem
              key={task.key}
              row={task.row}
              task={task}
              presentation="line"
              onRunAction={onRunAction}
            />
          ))}
          {hiddenTaskCount > 0 ? (
            <div className="py-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs font-semibold text-sky-700 hover:bg-sky-50 hover:text-sky-800"
                onClick={() => setShowAll(true)}
              >
                Показать ещё {hiddenTaskCount}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

function buildLineTaskGroups(tasks: readonly RepeatedJointTask[]) {
  const groups = new Map<string, LineTaskGroup>()

  for (const task of tasks) {
    const code = getDispatcherTaskCode(task)
    const title = getRepeatedJointTaskTitle(task).type
    const key = `${code}\u0000${title}`
    const group = groups.get(key)
    if (group) group.tasks.push(task)
    else groups.set(key, { key, code, title, tasks: [task] })
  }

  return [...groups.values()]
    .map((group) => ({ ...group, tasks: [...group.tasks].sort(compareTasks) }))
    .sort(
      (left, right) =>
        compareDispatcherTaskCodes(left.code, right.code) ||
        left.title.localeCompare(right.title, 'ru'),
    )
}

function compareTasks(left: RepeatedJointTask, right: RepeatedJointTask) {
  const leftJoint = String(left.row.joint ?? '')
  const rightJoint = String(right.row.joint ?? '')
  if (left.kind === 'percentage-line-control' && right.kind === 'percentage-line-control') {
    return (
      left.stamp.localeCompare(right.stamp, 'ru', { numeric: true }) ||
      leftJoint.localeCompare(rightJoint, 'ru', { numeric: true }) ||
      left.key.localeCompare(right.key, 'ru')
    )
  }
  return (
    leftJoint.localeCompare(rightJoint, 'ru', { numeric: true }) ||
    left.key.localeCompare(right.key, 'ru')
  )
}
