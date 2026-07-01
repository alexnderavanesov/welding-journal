import { Button } from '@/components/ui/button'
import {
  dispatcherActionButtonClass,
  dispatcherDangerActionButtonClass,
  dispatcherPrimaryActionButtonClass,
  dispatcherStandaloneActionButtonClass,
} from '@/components/dispatcher-task-ui'
import type {
  DispatcherTask,
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
  onCreateTask: (task: RepeatedJointCreateTask | RepeatedJointCoilTask) => void
  onDeleteTask: (task: RepeatedJointDeleteTask) => void
  onRenameTask: (task: RepeatedJointRenameTask) => void
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
  onCreateTask,
  onDeleteTask,
  onRenameTask,
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
    <div className="flex shrink-0 items-center overflow-hidden rounded-md border border-slate-200 bg-slate-50/80">
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
      ) : task.kind === 'line-consistency' ? (
        <Button type="button" size="sm" variant="outline" onClick={() => onShowTask(task)} className={dispatcherStandaloneActionButtonClass}>
          Показать
        </Button>
      ) : (
        <Button type="button" size="sm" variant="outline" onClick={() => onShowTask(task)} className={dispatcherStandaloneActionButtonClass}>
          Цепочка
        </Button>
      )}
      <Button type="button" variant="ghost" size="sm" onClick={() => onToggleDetails(task)} className={dispatcherActionButtonClass}>
        {isExpanded ? 'Свернуть' : 'Подробнее'}
      </Button>
    </div>
  )
}
