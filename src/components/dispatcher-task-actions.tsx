import { type ComponentProps, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import {
  dispatcherActionButtonClass,
  dispatcherDangerActionButtonClass,
  dispatcherPrimaryActionButtonClass,
  dispatcherStandaloneActionButtonClass,
} from '@/components/dispatcher-task-ui'
import type {
  DispatcherTask,
  PercentageLineControlTask,
  RepeatedJointCoilTask,
  RepeatedJointCreateTask,
  RepeatedJointDeleteTask,
  RepeatedJointRenameTask,
} from '@/lib/dispatcher-types'
import { isUnofficialJoint } from '@/lib/joint-display'
import {
  canOpenDispatcherTaskPicture,
  getDispatcherTaskActionSpecs,
  type DispatcherTaskActionSpec,
} from '@/lib/dispatcher-task-actions-model'

export type RepeatedJointTaskActionsProps = {
  task: DispatcherTask
  className?: string
  workspace?: boolean
  hideViewActions?: boolean
  onShowTask: (task: DispatcherTask) => void
  onOpenTaskPicture: (task: Exclude<DispatcherTask, { kind: 'welder-stamp-expiry' }>) => void
  onOpenTaskOfficiality: (task: DispatcherTask) => void
  onCreateTask: (task: RepeatedJointCreateTask | RepeatedJointCoilTask) => void
  onCreateEarlyCoil: (task: RepeatedJointCreateTask) => void
  onDeleteTask: (task: RepeatedJointDeleteTask) => void
  onRenameTask: (task: RepeatedJointRenameTask) => void
  onAcceptPercentageLineTask: (task: PercentageLineControlTask) => void
  onEditPercentageLineTaskStamp: (task: PercentageLineControlTask) => void
  onSuspendPercentageLineWelder: (task: PercentageLineControlTask) => void
  onSkipPercentageLineWelderSuspension: (task: PercentageLineControlTask) => void
  onRunTaskAction: (
    task: Exclude<DispatcherTask, { kind: 'welder-stamp-expiry' }>,
    action: DispatcherTaskActionSpec,
  ) => void
  canRunDispatcherMutation: boolean
  canCreateEarlyCoil: boolean
  isEarlyCoilPending: boolean
  isCreatePending: boolean
  isDeletePending: boolean
  isRenamePending: boolean
}

export function RepeatedJointTaskActions({
  task,
  className,
  workspace = false,
  hideViewActions = false,
  onShowTask,
  onOpenTaskPicture,
  onOpenTaskOfficiality,
  onCreateTask,
  onCreateEarlyCoil,
  onDeleteTask,
  onRenameTask,
  onAcceptPercentageLineTask,
  onEditPercentageLineTaskStamp,
  onSuspendPercentageLineWelder,
  onSkipPercentageLineWelderSuspension,
  onRunTaskAction,
  canRunDispatcherMutation,
  canCreateEarlyCoil,
  isEarlyCoilPending,
  isCreatePending,
  isDeletePending,
  isRenamePending,
}: RepeatedJointTaskActionsProps) {
  if (task.kind === 'welder-stamp-expiry') return null

  return (
    <div data-dispatcher-task-actions className={`${workspace ? 'flex w-full min-w-0 flex-wrap items-center gap-1.5 [&_button]:h-auto [&_button]:min-h-7 [&_button]:max-w-full [&_button]:whitespace-normal [&_button]:py-1 [&_button]:text-left [&_button]:leading-4' : 'flex shrink-0 items-center gap-1.5 px-2 py-1.5'} ${className ?? ''}`}>
      <div data-dispatcher-workflow-actions={workspace ? '' : undefined} className="contents">
      {(task.kind === 'create' || task.kind === 'coil') && canRunDispatcherMutation ? (
        <>
          <Button type="button" size="sm" onClick={() => onCreateTask(task)} disabled={isCreatePending} className={dispatcherPrimaryActionButtonClass}>
            {workspace
              ? task.kind === 'coil' ? `Создать катушку ${task.targetJoints.join(' + ')}` : `Создать ${task.targetJoint}`
              : task.kind === 'coil' ? 'Катушка' : 'Создать'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onOpenTaskOfficiality(task)}
            className={workspace ? dispatcherPrimaryActionButtonClass : dispatcherActionButtonClass}
            aria-label={isUnofficialJoint(task.row)
              ? `Сделать ${String(task.row.joint ?? '-')} официальным`
              : `Сделать ${String(task.row.joint ?? '-')} неофициальным`}
          >
            {workspace
              ? isUnofficialJoint(task.row) ? 'Сделать официальным' : 'Сделать неофициальным'
              : isUnofficialJoint(task.row) ? 'Официальный' : 'Неофициальный'}
          </Button>
          {task.kind === 'create' && canCreateEarlyCoil && !isUnofficialJoint(task.row) ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onCreateEarlyCoil(task)}
              disabled={isEarlyCoilPending}
              className={workspace ? dispatcherPrimaryActionButtonClass : dispatcherActionButtonClass}
            >
              {workspace ? 'Врезать катушку досрочно' : 'Катушка досрочно'}
            </Button>
          ) : null}
        </>
      ) : task.kind === 'delete' && canRunDispatcherMutation ? (
        <>
          <Button type="button" size="sm" variant="outline" onClick={() => onDeleteTask(task)} disabled={isDeletePending} className={dispatcherDangerActionButtonClass}>
            {workspace ? `Удалить ${task.targetJoint}` : 'Удалить'}
          </Button>
        </>
      ) : task.kind === 'rename' && canRunDispatcherMutation ? (
        <>
          <Button type="button" size="sm" onClick={() => onRenameTask(task)} disabled={isRenamePending} className={dispatcherPrimaryActionButtonClass}>
            {workspace ? `Переименовать в ${task.targetJoint}` : 'Переименовать'}
          </Button>
        </>
      ) : task.kind === 'percentage-line-control' && task.issue === 'rejected-primary' ? (
        <WorkspaceOrMenuActions workspace={workspace} items={[
            {
              label: 'Принять',
              onClick: () => onAcceptPercentageLineTask(task),
            },
            {
              label: 'Сменить официальность',
              onClick: () => onOpenTaskOfficiality(task),
            },
          ]} />
      ) : task.kind === 'percentage-line-control' && task.issue === 'excess' ? (
        <WorkspaceOrMenuActions workspace={workspace} items={[
            {
              label: 'Принять',
              onClick: () => onAcceptPercentageLineTask(task),
            },
          ]} />
      ) : task.kind === 'percentage-line-control' && task.issue === 'new-welder' ? (
        <WorkspaceOrMenuActions workspace={workspace} items={[
            {
              label: 'Исправить клеймо',
              onClick: () => onEditPercentageLineTaskStamp(task),
            },
            {
              label: 'Принять',
              onClick: () => onAcceptPercentageLineTask(task),
            },
          ]} />
      ) : task.kind === 'percentage-line-control' && task.issue === 'suspend-welder' ? (
        <WorkspaceOrMenuActions workspace={workspace} items={[
            {
              label: 'Отстранить',
              onClick: () => onSuspendPercentageLineWelder(task),
            },
            {
              label: 'Не отстранять',
              onClick: () => onSkipPercentageLineWelderSuspension(task),
            },
          ]} />
      ) : task.kind === 'percentage-line-control' && task.issue === 'missing' ? (
        <ModeledDispatcherActions
          task={task}
          actions={getDispatcherTaskActionSpecs(task)}
          onRunTaskAction={onRunTaskAction}
          onShowTask={onShowTask}
          workspace={workspace}
        />
      ) : task.kind === 'line-consistency' && task.fieldKey === 'pstoPresence' ? (
        <ModeledDispatcherActions
          task={task}
          actions={getDispatcherTaskActionSpecs(task)}
          onRunTaskAction={onRunTaskAction}
          onShowTask={onShowTask}
          workspace={workspace}
        />
      ) : task.kind === 'check' ? (
        <ModeledDispatcherActions
          task={task}
          actions={getDispatcherTaskActionSpecs(task)}
          onRunTaskAction={onRunTaskAction}
          onShowTask={onShowTask}
          workspace={workspace}
        />
      ) : null}
      </div>
      {hideViewActions ? null : (
        <DispatcherTaskViewActions
          task={task}
          onShowTask={onShowTask}
          onOpenTaskPicture={onOpenTaskPicture}
          workspace={workspace}
        />
      )}
    </div>
  )
}

export function DispatcherTaskViewActions({
  task,
  onShowTask,
  onOpenTaskPicture,
  workspace = false,
  className,
}: Pick<RepeatedJointTaskActionsProps, 'task' | 'onShowTask' | 'onOpenTaskPicture' | 'workspace' | 'className'>) {
  if (task.kind === 'welder-stamp-expiry') return null

  return (
    <div
      data-dispatcher-view-actions={workspace ? '' : undefined}
      className={workspace ? `flex shrink-0 flex-wrap items-center gap-1 ${className ?? ''}` : 'contents'}
    >
      <Button
        type="button"
        size="sm"
        variant={workspace ? 'ghost' : 'outline'}
        onClick={() => onShowTask(task)}
        className={workspace ? 'h-7 rounded-md px-2 text-xs font-medium text-slate-600 shadow-none hover:bg-slate-100 hover:text-slate-900' : dispatcherActionButtonClass}
        title="Показать связанные строки в текущем отчете"
      >
        Показать
      </Button>
      {canOpenDispatcherTaskPicture(task) ? (
        <Button
          type="button"
          size="sm"
          variant={workspace ? 'ghost' : 'outline'}
          onClick={() => onOpenTaskPicture(task)}
          className={workspace ? 'h-7 rounded-md px-2 text-xs font-medium text-slate-600 shadow-none hover:bg-slate-100 hover:text-slate-900' : dispatcherActionButtonClass}
          title={task.kind === 'line-consistency' || task.kind === 'percentage-line-control'
            ? `Открыть картину линии ${String(task.row.line ?? '-').trim() || '-'}`
            : `Открыть картину стыка ${String(task.row.joint ?? '-').trim() || '-'}`}
        >
          Картина
        </Button>
      ) : null}
    </div>
  )
}

function WorkspaceOrMenuActions({ workspace, items }: { workspace: boolean; items: DispatcherActionMenuItem[] }) {
  if (!workspace) return <DispatcherActionMenu items={items} />
  return <>{items.map((item) => (
    <Button
      key={item.key ?? item.label}
      type="button"
      size="sm"
      variant="outline"
      className={item.tone === 'danger' ? dispatcherDangerActionButtonClass : dispatcherPrimaryActionButtonClass}
      onClick={item.onClick}
    >
      {item.label}
    </Button>
  ))}</>
}

function ModeledDispatcherActions({
  task,
  actions,
  onRunTaskAction,
  onShowTask,
  workspace = false,
}: {
  task: Exclude<DispatcherTask, { kind: 'welder-stamp-expiry' }>
  actions: DispatcherTaskActionSpec[]
  onRunTaskAction: RepeatedJointTaskActionsProps['onRunTaskAction']
  onShowTask: RepeatedJointTaskActionsProps['onShowTask']
  workspace?: boolean
}) {
  const workflowActions = actions.filter((action) => action.id !== 'show-task')
  const hasMultipleRootCauseActions = workflowActions.length > 1 &&
    workflowActions.every((action) => action.id === 'open-root-cause')
  const [primaryAction, ...secondaryActions] = workflowActions
  if (!primaryAction) return null
  const run = (action: DispatcherTaskActionSpec) => {
    if (action.id === 'show-task') onShowTask(task)
    else onRunTaskAction(task, action)
  }

  if (workspace) {
    return <>{workflowActions.map((action) => (
      <Button
        key={action.key ?? `${action.id}:${action.label}`}
        type="button"
        size="sm"
        variant="outline"
        className={action.tone === 'danger' ? dispatcherDangerActionButtonClass : dispatcherPrimaryActionButtonClass}
        onClick={() => run(action)}
      >
        {action.label}
      </Button>
    ))}</>
  }

  if (hasMultipleRootCauseActions) {
    return (
      <DispatcherActionMenu
        triggerLabel="Исправить"
        items={workflowActions.map((action) => ({
          label: action.label,
          onClick: () => run(action),
        }))}
      />
    )
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant={primaryAction.tone === 'primary' ? 'default' : 'outline'}
        onClick={() => run(primaryAction)}
        className={primaryAction.tone === 'primary'
          ? dispatcherPrimaryActionButtonClass
          : dispatcherStandaloneActionButtonClass}
      >
        {primaryAction.label}
      </Button>
      {secondaryActions.length > 0 ? (
        <DispatcherActionMenu
          items={secondaryActions.map((action) => ({
            label: action.label,
            onClick: () => run(action),
          }))}
        />
      ) : null}
    </>
  )
}

export type DispatcherActionMenuItem = {
  key?: string
  label: string
  onClick: () => void
  tone?: DispatcherTaskActionSpec['tone']
}

export function DispatcherActionMenu({
  items,
  triggerLabel = 'Действия',
  triggerContent,
  triggerAriaLabel,
  triggerTitle,
  triggerClassName,
  triggerSize = 'sm',
  disabled = false,
}: {
  items: DispatcherActionMenuItem[]
  triggerLabel?: string
  triggerContent?: ReactNode
  triggerAriaLabel?: string
  triggerTitle?: string
  triggerClassName?: string
  triggerSize?: ComponentProps<typeof Button>['size']
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState<{
    left: number
    top: number
    minWidth: number
    maxHeight: number
  } | null>(null)
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    if (!open || typeof window === 'undefined') {
      setMenuPosition(null)
      return undefined
    }

    const updatePosition = () => {
      const anchor = anchorRef.current
      const menu = menuRef.current
      if (!anchor || !menu) return

      const viewportPadding = 8
      const gap = 4
      const anchorRect = anchor.getBoundingClientRect()
      const maxHeight = Math.max(96, window.innerHeight - viewportPadding * 2)
      const menuWidth = Math.min(
        Math.max(menu.offsetWidth, anchorRect.width),
        window.innerWidth - viewportPadding * 2,
      )
      const menuHeight = Math.min(menu.offsetHeight, maxHeight)
      const hasRoomBelow = anchorRect.bottom + gap + menuHeight <= window.innerHeight - viewportPadding
      const top = hasRoomBelow
        ? anchorRect.bottom + gap
        : Math.max(viewportPadding, anchorRect.top - gap - menuHeight)
      const left = Math.max(
        viewportPadding,
        Math.min(anchorRect.right - menuWidth, window.innerWidth - viewportPadding - menuWidth),
      )

      setMenuPosition({ left, top, minWidth: anchorRect.width, maxHeight })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    document.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      document.removeEventListener('scroll', updatePosition, true)
    }
  }, [items.length, open])

  useEffect(() => {
    if (!open) return undefined

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (anchorRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      setOpen(false)
    }

    document.addEventListener('mousedown', handleMouseDown)
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      window.removeEventListener('keydown', handleKeyDown, { capture: true })
    }
  }, [open])

  return (
    <div ref={anchorRef} className="relative">
      <Button
        type="button"
        size={triggerSize}
        variant="outline"
        onClick={() => setOpen((current) => !current)}
        className={triggerClassName ?? dispatcherActionButtonClass}
        disabled={disabled}
        aria-label={triggerAriaLabel}
        title={triggerTitle}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {triggerContent ?? triggerLabel}
      </Button>
      {open && typeof document !== 'undefined' ? createPortal(
        <div
          ref={menuRef}
          role="menu"
          data-dispatcher-action-menu="true"
          className="fixed z-[80] min-w-44 max-w-[calc(100vw-1rem)] overflow-x-hidden overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg"
          style={menuPosition ?? { left: 8, top: 8, visibility: 'hidden' }}
        >
          {items.map((item) => (
            <button
              key={item.key ?? item.label}
              type="button"
              role="menuitem"
              className={`block w-full px-3 py-2 text-left text-xs font-medium hover:bg-slate-50 ${
                item.tone === 'danger' ? 'text-rose-700 hover:bg-rose-50' : 'text-slate-700'
              }`}
              onClick={() => {
                setOpen(false)
                item.onClick()
              }}
            >
              {item.label}
            </button>
          ))}
        </div>,
        document.body,
      ) : null}
    </div>
  )
}
