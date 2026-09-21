import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, ExternalLink, ListTodo } from 'lucide-react'

import {
  JointDispatcherTaskItem,
  type JointDispatcherTaskActionHandler,
} from '@/components/joint-dispatcher-tasks-panel'
import { Button } from '@/components/ui/button'
import { getDispatcherTaskCode } from '@/lib/dispatcher-settings'
import {
  compareDispatcherTaskCodes,
  getDispatcherTasksForLinePicture,
  isDispatcherTaskDirectlyRelatedToJoint,
} from '@/lib/dispatcher-task-row-codes'
import { getRepeatedJointTaskTitle } from '@/lib/dispatcher-text'
import type { RepeatedJointTask, WeldRow } from '@/lib/dispatcher-types'

type LinePictureOverviewProps = {
  row: WeldRow
  tasks: readonly RepeatedJointTask[]
  onRunAction: JointDispatcherTaskActionHandler
  onOpenInDispatcher: () => void
  highlightedTaskKey?: string | null
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
  onOpenInDispatcher,
  highlightedTaskKey,
}: LinePictureOverviewProps) {
  const lineTasks = useMemo(
    () => getDispatcherTasksForLinePicture(tasks, row),
    [row, tasks],
  )
  const groups = useMemo(() => buildLineTaskGroups(lineTasks), [lineTasks])
  const initiallyExpandedKeys = useMemo(
    () => getInitiallyExpandedGroupKeys(groups, row, highlightedTaskKey),
    [groups, highlightedTaskKey, row],
  )
  const [expandedGroupKeys, setExpandedGroupKeys] = useState(initiallyExpandedKeys)
  const allGroupsExpanded = groups.length > 0 && groups.every((group) => expandedGroupKeys.has(group.key))
  const affectedJointCount = countAffectedJoints(lineTasks)

  useEffect(() => {
    setExpandedGroupKeys(initiallyExpandedKeys)
  }, [initiallyExpandedKeys])

  const toggleAllGroups = () => {
    setExpandedGroupKeys(allGroupsExpanded ? new Set() : new Set(groups.map((group) => group.key)))
  }

  return (
    <div className="min-w-0">
      <div className="border-b border-slate-200 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <ListTodo className="h-4 w-4 text-sky-700" />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-slate-900">
                Линия {String(row.line ?? '-').trim() || '-'}
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                {getLineSubtitle(row)}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onOpenInDispatcher}
            className="h-8 gap-1.5 border-sky-200 bg-sky-50 px-3 text-xs font-semibold text-sky-900 hover:bg-sky-100"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Открыть в диспетчере
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <SummaryMetric value={lineTasks.length} labels={['активная задача', 'активные задачи', 'активных задач']} />
          <SummaryMetric value={groups.length} labels={['тип проблемы', 'типа проблем', 'типов проблем']} />
          {affectedJointCount > 0 ? (
            <SummaryMetric
              value={affectedJointCount}
              labels={['стык затронут', 'стыка затронуто', 'стыков затронуто']}
            />
          ) : null}
          {groups.length > 1 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto h-7 px-2 text-xs font-semibold text-sky-700 hover:bg-sky-50 hover:text-sky-900"
              onClick={toggleAllGroups}
            >
              {allGroupsExpanded ? 'Свернуть все' : 'Раскрыть все'}
            </Button>
          ) : null}
        </div>
      </div>

      {groups.length > 0 ? (
        <div className="mt-4 space-y-3">
          {groups.map((group) => (
            <LinePictureTaskGroup
              key={group.key}
              group={group}
              currentRow={row}
              highlightedTaskKey={highlightedTaskKey}
              expanded={expandedGroupKeys.has(group.key)}
              onToggle={() => setExpandedGroupKeys((current) => toggleSetValue(current, group.key))}
              onRunAction={onRunAction}
            />
          ))}
        </div>
      ) : (
        <div className="py-12 text-center">
          <ListTodo className="mx-auto h-5 w-5 text-slate-300" />
          <p className="mt-2 text-sm font-medium text-slate-600">На линии нет активных задач</p>
          <p className="mt-1 text-xs text-slate-400">Новые СП и ДЗ появятся здесь автоматически.</p>
        </div>
      )}
    </div>
  )
}

function SummaryMetric({ value, labels }: { value: number; labels: [string, string, string] }) {
  const label = getPluralLabel(value, labels)
  return (
    <span
      aria-label={`${value} ${label}`}
      className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-slate-600"
    >
      <strong aria-hidden="true" className="font-semibold text-slate-900">
        {value}
      </strong>
      <span aria-hidden="true">{label}</span>
    </span>
  )
}

function getPluralLabel(value: number, [one, few, many]: [string, string, string]) {
  const mod100 = Math.abs(value) % 100
  const mod10 = mod100 % 10
  if (mod100 >= 11 && mod100 <= 19) return many
  if (mod10 === 1) return one
  if (mod10 >= 2 && mod10 <= 4) return few
  return many
}

function getLineSubtitle(row: WeldRow) {
  const project = String(row.projectTitle ?? '').trim() || '-'
  const subtitle = String(row.subtitleCode ?? '').trim() || '-'
  return `${project} · ${subtitle}`
}

function getInitiallyExpandedGroupKeys(
  groups: LineTaskGroup[],
  row: WeldRow,
  highlightedTaskKey?: string | null,
) {
  const highlightedGroup = highlightedTaskKey
    ? groups.find((group) => group.tasks.some((task) => task.key === highlightedTaskKey))
    : null
  if (highlightedGroup) return new Set([highlightedGroup.key])
  const currentJointGroups = groups
    .filter((group) => group.tasks.some((task) => isDispatcherTaskDirectlyRelatedToJoint(task, row)))
    .map((group) => group.key)
  return new Set(currentJointGroups.length > 0 ? currentJointGroups : groups[0] ? [groups[0].key] : [])
}

function toggleSetValue(values: Set<string>, value: string) {
  const next = new Set(values)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

function countAffectedJoints(tasks: readonly RepeatedJointTask[]) {
  const rowIds = new Set<number>()
  for (const task of tasks) {
    if (task.kind === 'line-consistency') continue
    if (task.kind === 'percentage-line-control' && task.targetRowIds?.length) {
      for (const rowId of task.targetRowIds) rowIds.add(rowId)
      continue
    }
    rowIds.add(task.row.id)
  }
  return rowIds.size
}

function getTaskCodeClass(code: string) {
  return code.startsWith('СП-')
    ? 'border-amber-200 bg-amber-50 text-amber-800'
    : 'border-violet-200 bg-violet-50 text-violet-700'
}

function LinePictureTaskGroup({
  group,
  currentRow,
  highlightedTaskKey,
  expanded,
  onToggle,
  onRunAction,
}: {
  group: LineTaskGroup
  currentRow: WeldRow
  highlightedTaskKey?: string | null
  expanded: boolean
  onToggle: () => void
  onRunAction: JointDispatcherTaskActionHandler
}) {
  const [showAll, setShowAll] = useState(false)
  const highlightedTaskIndex = highlightedTaskKey
    ? group.tasks.findIndex((task) => task.key === highlightedTaskKey)
    : -1
  const showHighlightedTask = highlightedTaskIndex >= LINE_TASK_PREVIEW_LIMIT
  const visibleTasks = showAll || showHighlightedTask
    ? group.tasks
    : group.tasks.slice(0, LINE_TASK_PREVIEW_LIMIT)
  const hiddenTaskCount = group.tasks.length - visibleTasks.length

  useEffect(() => {
    setShowAll(false)
  }, [group.key])

  return (
    <section className="overflow-hidden rounded-md border border-slate-200 bg-white" aria-label={`${group.code} ${group.title}`}>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 bg-slate-50/80 px-3.5 py-3 text-left transition-colors hover:bg-slate-100"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className={`rounded border px-1.5 py-0.5 text-xs font-semibold ${getTaskCodeClass(group.code)}`}>
            {group.code}
          </span>
          <span className="text-sm font-semibold text-slate-900">{group.title}</span>
          <span className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">
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
        <div className="divide-y divide-slate-200 border-t border-slate-200">
          {visibleTasks.map((task) => (
            <JointDispatcherTaskItem
              key={task.key}
              row={task.row}
              task={task}
              presentation="line"
              isCurrentRow={isDispatcherTaskDirectlyRelatedToJoint(task, currentRow)}
              isHighlighted={task.key === highlightedTaskKey}
              onRunAction={onRunAction}
            />
          ))}
          {hiddenTaskCount > 0 ? (
            <div className="px-2 py-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs font-semibold text-sky-700 hover:bg-sky-50 hover:text-sky-900"
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
