import { getRepeatedJointTaskTitle } from '@/lib/dispatcher-text'
import type { DispatcherTask, WelderStampExpiryTask } from '@/lib/dispatcher-types'
import { getLnkResultBadgeClass } from '@/lib/report-badges'
import { formatWelderStampTaskLabel } from '@/lib/welder-stamp-format'

export function WelderStampTaskContent({ task, label }: { task: WelderStampExpiryTask; label: string }) {
  const title = getRepeatedJointTaskTitle(task)

  return (
    <>
      <span className="text-slate-800">{label}</span>
      <span className={task.expired ? 'text-rose-700' : 'text-slate-700'}>{title.type}</span>
      <span
        className={`rounded border px-1.5 py-0.5 text-xs font-semibold ${
          task.expired ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-amber-200 bg-amber-50 text-amber-800'
        }`}
      >
        {task.expired ? 'просрочено' : `${task.daysLeft} дн.`}
      </span>
    </>
  )
}

export function RepeatedJointTaskContent({ task, nested = false }: { task: DispatcherTask; nested?: boolean }) {
  const title = getRepeatedJointTaskTitle(task)
  if (task.kind === 'welder-stamp-expiry') {
    return <WelderStampTaskContent task={task} label={nested ? formatWelderStampTaskLabel(task) : title.joint} />
  }
  if (task.kind === 'create') {
    return (
      <>
        <span className="text-slate-800">{title.joint}</span>
        <span className="text-slate-700">{title.type}</span>
        <span className="text-slate-400">·</span>
        <span className="text-amber-700">→</span>
        <span className="text-slate-800">{task.targetJoint}</span>
        <span className="text-slate-400">·</span>
        <span className={`inline-flex min-h-6 items-center rounded border px-1.5 text-xs font-semibold leading-none ${getLnkResultBadgeClass(task.result)}`}>
          {task.methodCode} - {task.result}
        </span>
      </>
    )
  }
  if (task.kind === 'coil') {
    return (
      <>
        <span className="text-slate-800">{title.joint}</span>
        <span className="text-slate-700">{title.type}</span>
        <span className="text-slate-400">·</span>
        <span className={`inline-flex min-h-6 items-center rounded border px-1.5 text-xs font-semibold leading-none ${getLnkResultBadgeClass(task.result)}`}>
          {task.methodCode} - {task.result}
        </span>
        <span className="text-slate-400">·</span>
        <span className="text-slate-800">катушка {task.targetJoints.join(' + ')}</span>
      </>
    )
  }
  if (task.kind === 'delete') {
    return (
      <>
        <span className="text-slate-800">{title.joint}</span>
        <span className="text-slate-700">{title.type}</span>
      </>
    )
  }
  if (task.kind === 'rename') {
    return (
      <>
        <span className="text-slate-800">{title.joint}</span>
        <span className="text-slate-700">{title.type}</span>
        <span className="text-slate-400">·</span>
        <span className="text-slate-500">ожидается {task.targetJoint}</span>
      </>
    )
  }
  if (task.kind === 'check') {
    return (
      <>
        <span className="text-slate-800">{title.joint}</span>
        <span className="text-slate-700">{title.type}</span>
      </>
    )
  }
  if (task.kind === 'line-consistency') {
    return (
      <>
        <span className="text-slate-800">{title.joint}</span>
        <span className="text-slate-700">{title.type}</span>
      </>
    )
  }
  if (task.kind === 'percentage-line-control') {
    return (
      <>
        <span className="text-slate-800">{title.joint}</span>
        <span className="text-slate-700">{title.type}</span>
        <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-xs font-semibold text-amber-800">
          {task.count}
        </span>
      </>
    )
  }
  return (
    <>
      <span className="text-slate-800">{title.joint}</span>
      <span className="text-slate-700">{title.type}</span>
      <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-xs font-semibold text-amber-800">{task.count}</span>
    </>
  )
}
