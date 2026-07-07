import { useState } from 'react'
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

export type RepeatedJointTaskActionsProps = {
  task: DispatcherTask
  isTaskExpanded: (task: DispatcherTask) => boolean
  onToggleDetails: (task: DispatcherTask) => void
  onShowTask: (task: DispatcherTask) => void
  onOpenTaskOfficiality: (task: DispatcherTask) => void
  onCreateTask: (task: RepeatedJointCreateTask | RepeatedJointCoilTask) => void
  onDeleteTask: (task: RepeatedJointDeleteTask) => void
  onRenameTask: (task: RepeatedJointRenameTask) => void
  onAcceptPercentageLineTask: (task: PercentageLineControlTask) => void
  onEditPercentageLineTaskStamp: (task: PercentageLineControlTask) => void
  onSuspendPercentageLineWelder: (task: PercentageLineControlTask) => void
  onSkipPercentageLineWelderSuspension: (task: PercentageLineControlTask) => void
  canRunDispatcherMutation: boolean
  isCreatePending: boolean
  isDeletePending: boolean
  isRenamePending: boolean
}

export function RepeatedJointTaskActions({
  task,
  isTaskExpanded,
  onToggleDetails,
  onShowTask,
  onOpenTaskOfficiality,
  onCreateTask,
  onDeleteTask,
  onRenameTask,
  onAcceptPercentageLineTask,
  onEditPercentageLineTaskStamp,
  onSuspendPercentageLineWelder,
  onSkipPercentageLineWelderSuspension,
  canRunDispatcherMutation,
  isCreatePending,
  isDeletePending,
  isRenamePending,
}: RepeatedJointTaskActionsProps) {
  const isExpanded = isTaskExpanded(task)

  if (task.kind === 'welder-stamp-expiry') {
    return (
      <div className="flex shrink-0 items-center overflow-hidden rounded-md border border-slate-200 bg-slate-50/80">
        <Button type="button" variant="ghost" size="sm" onClick={() => onToggleDetails(task)} className={dispatcherActionButtonClass}>
          {isExpanded ? 'Свернуть' : 'Подробнее'}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex shrink-0 items-center overflow-visible rounded-md border border-slate-200 bg-slate-50/80">
      {(task.kind === 'create' || task.kind === 'coil') && canRunDispatcherMutation ? (
        <>
          <Button type="button" size="sm" onClick={() => onCreateTask(task)} disabled={isCreatePending} className={dispatcherPrimaryActionButtonClass}>
            {task.kind === 'coil' ? 'Катушка' : 'Создать'}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => onShowTask(task)} className={dispatcherActionButtonClass}>
            Цепочка
          </Button>
        </>
      ) : task.kind === 'delete' && canRunDispatcherMutation ? (
        <>
          <Button type="button" size="sm" variant="outline" onClick={() => onDeleteTask(task)} disabled={isDeletePending} className={dispatcherDangerActionButtonClass}>
            Удалить
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => onShowTask(task)} className={dispatcherActionButtonClass}>
            Цепочка
          </Button>
        </>
      ) : task.kind === 'rename' && canRunDispatcherMutation ? (
        <>
          <Button type="button" size="sm" onClick={() => onRenameTask(task)} disabled={isRenamePending} className={dispatcherPrimaryActionButtonClass}>
            Переименовать
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => onShowTask(task)} className={dispatcherActionButtonClass}>
            Цепочка
          </Button>
        </>
      ) : task.kind === 'percentage-line-control' && task.issue === 'rejected-primary' ? (
        <>
          <DispatcherActionMenu
            items={[
              {
                label: 'Принять',
                onClick: () => onAcceptPercentageLineTask(task),
              },
              {
                label: 'Сменить официальность',
                onClick: () => onOpenTaskOfficiality(task),
              },
            ]}
          />
          <Button type="button" size="sm" variant="outline" onClick={() => onShowTask(task)} className={dispatcherActionButtonClass}>
            Показать
          </Button>
        </>
      ) : task.kind === 'percentage-line-control' && task.issue === 'excess' ? (
        <>
          <DispatcherActionMenu
            items={[
              {
                label: 'Принять',
                onClick: () => onAcceptPercentageLineTask(task),
              },
            ]}
          />
          <Button type="button" size="sm" variant="outline" onClick={() => onShowTask(task)} className={dispatcherActionButtonClass}>
            Показать
          </Button>
        </>
      ) : task.kind === 'percentage-line-control' && task.issue === 'new-welder' ? (
        <>
          <DispatcherActionMenu
            items={[
              {
                label: 'Изменить клеймо',
                onClick: () => onEditPercentageLineTaskStamp(task),
              },
              {
                label: 'Принять',
                onClick: () => onAcceptPercentageLineTask(task),
              },
            ]}
          />
          <Button type="button" size="sm" variant="outline" onClick={() => onShowTask(task)} className={dispatcherActionButtonClass}>
            Показать
          </Button>
        </>
      ) : task.kind === 'percentage-line-control' && task.issue === 'suspend-welder' ? (
        <>
          <DispatcherActionMenu
            items={[
              {
                label: 'Отстранить',
                onClick: () => onSuspendPercentageLineWelder(task),
              },
              {
                label: 'Не отстранять',
                onClick: () => onSkipPercentageLineWelderSuspension(task),
              },
            ]}
          />
          <Button type="button" size="sm" variant="outline" onClick={() => onShowTask(task)} className={dispatcherActionButtonClass}>
            Показать
          </Button>
        </>
      ) : task.kind === 'line-consistency' || task.kind === 'percentage-line-control' ? (
        <Button type="button" size="sm" variant="outline" onClick={() => onShowTask(task)} className={dispatcherStandaloneActionButtonClass}>
          Показать
        </Button>
      ) : (
        <Button type="button" size="sm" variant="outline" onClick={() => onShowTask(task)} className={dispatcherStandaloneActionButtonClass}>
          Цепочка
        </Button>
      )}
      <Button type="button" variant="ghost" size="sm" onClick={() => onToggleDetails(task)} className={dispatcherActionButtonClass}>
        {isExpanded ? 'Свернуть' : 'Описание'}
      </Button>
    </div>
  )
}

type DispatcherActionMenuItem = {
  label: string
  onClick: () => void
}

function DispatcherActionMenu({ items }: { items: DispatcherActionMenuItem[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setOpen((current) => !current)}
        className={dispatcherActionButtonClass}
      >
        Действия
      </Button>
      {open ? (
        <div className="absolute right-0 top-full z-30 mt-1 min-w-44 overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-lg">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              className="block w-full px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50"
              onClick={() => {
                setOpen(false)
                item.onClick()
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
