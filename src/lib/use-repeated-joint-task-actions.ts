import type { ActiveReport } from '@/lib/home-state'
import {
  buildRepeatedJointTasks,
  isUnusedRepeatedJointDraft,
} from '@/lib/repeated-joint-tasks'
import type {
  RepeatedJointCoilTask,
  RepeatedJointCreateTask,
  RepeatedJointDeleteTask,
  RepeatedJointRenameTask,
  WeldRow,
} from '@/lib/dispatcher-types'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'

type MutationLike<TValue> = {
  mutate: (value: TValue) => void
}

type UseRepeatedJointTaskActionsOptions = {
  activeReport: ActiveReport
  rows: WeldRow[]
  welderStamps: WelderStampRecord[]
  repeatedJointMutation: MutationLike<RepeatedJointCreateTask | RepeatedJointCoilTask>
  obsoleteRepeatedJointMutation: MutationLike<RepeatedJointDeleteTask>
  renameRepeatedJointMutation: MutationLike<RepeatedJointRenameTask>
  setMessage: (value: string) => void
}

export function useRepeatedJointTaskActions({
  activeReport,
  rows,
  welderStamps,
  repeatedJointMutation,
  obsoleteRepeatedJointMutation,
  renameRepeatedJointMutation,
  setMessage,
}: UseRepeatedJointTaskActionsOptions) {
  function createRepeatedJoint(task: RepeatedJointCreateTask | RepeatedJointCoilTask) {
    if (activeReport === 'lnk') {
      setMessage('В отчете ЛНК диспетчер только показывает цепочку. Создание стыков доступно из сварочного журнала.')
      return
    }

    const currentTask = buildRepeatedJointTasks(rows, welderStamps).find(
      (candidate): candidate is RepeatedJointCreateTask | RepeatedJointCoilTask =>
        (candidate.kind === 'create' || candidate.kind === 'coil') && candidate.key === task.key,
    )
    if (!currentTask) {
      setMessage('Задача уже не актуальна. Плашка обновлена по текущим данным.')
      return
    }

    repeatedJointMutation.mutate(currentTask)
  }

  function deleteObsoleteRepeatedJoint(task: RepeatedJointDeleteTask) {
    if (activeReport === 'lnk') {
      setMessage('В отчете ЛНК диспетчер только показывает цепочку. Удаление стыков доступно из сварочного журнала.')
      return
    }

    const currentTask = buildRepeatedJointTasks(rows, welderStamps).find(
      (candidate): candidate is RepeatedJointDeleteTask => candidate.kind === 'delete' && candidate.key === task.key,
    )
    if (!currentTask) {
      setMessage('Задача уже не актуальна. Плашка обновлена по текущим данным.')
      return
    }
    if (!isUnusedRepeatedJointDraft(currentTask.row)) {
      setMessage('Повторный стык уже содержит данные. Диспетчер не удаляет такие стыки автоматически, проверьте цепочку вручную.')
      return
    }

    const confirmed = window.confirm(`Удалить повторный стык ${task.targetJoint}? Исходный стык ${task.sourceJoint} больше не требует повтора.`)
    if (!confirmed) return
    obsoleteRepeatedJointMutation.mutate(currentTask)
  }

  function renameObsoleteRepeatedJoint(task: RepeatedJointRenameTask) {
    if (activeReport === 'lnk') {
      setMessage('В отчете ЛНК диспетчер только показывает цепочку. Переименование стыков доступно из сварочного журнала.')
      return
    }

    const currentTask = buildRepeatedJointTasks(rows, welderStamps).find(
      (candidate): candidate is RepeatedJointRenameTask => candidate.kind === 'rename' && candidate.key === task.key,
    )
    if (!currentTask) {
      setMessage('Задача уже не актуальна. Плашка обновлена по текущим данным.')
      return
    }

    const confirmed = window.confirm(`Переименовать повторный стык ${task.currentJoint} в ${task.targetJoint}?`)
    if (!confirmed) return
    renameRepeatedJointMutation.mutate(currentTask)
  }

  return {
    createRepeatedJoint,
    deleteObsoleteRepeatedJoint,
    renameObsoleteRepeatedJoint,
  }
}
