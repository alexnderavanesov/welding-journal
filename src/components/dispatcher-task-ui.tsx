import type { ReactNode } from 'react'

import { formatReminderCount, formatTaskCount } from '@/lib/dispatcher-format'
import { getRepeatedJointTaskDetails, getRepeatedJointTaskDetailsHeading } from '@/lib/dispatcher-text'
import type { DispatcherTask, RepeatedJointTaskGroup } from '@/lib/dispatcher-types'

export const dispatcherActionButtonClass =
  'h-6 rounded-none border-0 border-l border-slate-200 bg-slate-50 px-2.5 text-xs font-medium text-slate-700 shadow-none hover:bg-slate-100 hover:text-slate-900'
export const dispatcherStandaloneActionButtonClass =
  'h-6 rounded-none border-0 bg-slate-50 px-2.5 text-xs font-medium text-slate-700 shadow-none hover:bg-slate-100 hover:text-slate-900'
export const dispatcherPrimaryActionButtonClass =
  'h-6 rounded-none border-0 bg-slate-100 px-2.5 text-xs font-semibold text-slate-800 shadow-none hover:bg-slate-200 hover:text-slate-950'
export const dispatcherDangerActionButtonClass =
  'h-6 rounded-none border-0 bg-rose-50 px-2.5 text-xs font-semibold text-rose-700 shadow-none hover:bg-rose-100 hover:text-rose-800'

type DispatcherTaskDetailsProps = {
  task: DispatcherTask
}

export function DispatcherTaskDetails({ task }: DispatcherTaskDetailsProps) {
  return (
    <div className="max-w-[min(760px,calc(100vw-5rem))] rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs leading-5 text-slate-600">
      <div className="mb-1 font-semibold text-slate-800">{getRepeatedJointTaskDetailsHeading(task)}</div>
      <div>{getRepeatedJointTaskDetails(task)}</div>
    </div>
  )
}

type DispatcherTaskGroupFrameProps = {
  group: RepeatedJointTaskGroup
  reminder?: boolean
  children: ReactNode
}

export function DispatcherTaskGroupFrame({ group, reminder = false, children }: DispatcherTaskGroupFrameProps) {
  return (
    <details key={group.key} className="group w-fit max-w-full rounded-md border border-amber-200 bg-white/95 open:shadow-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2 py-1.5 text-sm marker:hidden">
        <span className="font-semibold text-slate-900">{group.baseJoint}</span>
        <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-xs font-semibold text-amber-800">
          {reminder ? formatReminderCount(group.tasks.length) : formatTaskCount(group.tasks.length)}
        </span>
        <span className="ml-auto rounded border border-sky-100 bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-800 group-open:hidden">
          раскрыть
        </span>
        <span className="ml-auto hidden rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-600 group-open:inline">
          свернуть
        </span>
      </summary>
      <div className="flex max-w-full flex-col gap-1 border-t border-amber-100 p-1.5">{children}</div>
    </details>
  )
}
