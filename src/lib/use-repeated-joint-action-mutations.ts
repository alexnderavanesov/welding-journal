import { useMutation, useQueryClient } from '@tanstack/react-query'
import { deleteWeldJoint } from '@/server/welds'
import {
  buildRenamedRepeatedJointRow,
  buildRepeatedJointRows,
} from '@/lib/weld-journal-mutation-updates'
import { invalidateWeldJoints } from '@/lib/weld-query-utils'
import { createWeldRowsOrThrow, updateWeldRowOrThrow } from '@/lib/weld-save-utils'
import type {
  RepeatedJointCoilTask,
  RepeatedJointCreateTask,
  RepeatedJointDeleteTask,
  RepeatedJointRenameTask,
  WeldRow,
} from '@/lib/dispatcher-types'
import type { UseWeldJournalMutationsOptions } from '@/lib/weld-journal-mutation-types'

export function useRepeatedJointActionMutations({
  setMessage,
  highlightChangedRows,
  dismissRepeatedJointTask,
}: UseWeldJournalMutationsOptions) {
  const queryClient = useQueryClient()

  const repeatedJointMutation = useMutation({
    mutationFn: async (task: RepeatedJointCreateTask | RepeatedJointCoilTask) => {
      const drafts = buildRepeatedJointRows(task)
      const savedRows = await createWeldRowsOrThrow(drafts, 'Не удалось создать повторный стык')
      return savedRows as WeldRow[]
    },
    onSuccess: async (createdRows, task) => {
      highlightChangedRows(createdRows, ['joint', 'weldDate', 'finalStatus'])
      dismissRepeatedJointTask(task)
      setMessage(
        task.kind === 'coil'
          ? `Созданы стыки катушки ${task.targetJoints.join(', ')} для ${task.sourceJoint}`
          : `Создан повторный стык ${task.targetJoint} для ${task.sourceJoint}`,
      )
      await invalidateWeldJoints(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const obsoleteRepeatedJointMutation = useMutation({
    mutationFn: async (task: RepeatedJointDeleteTask) => {
      const result = await deleteWeldJoint({ data: { id: task.row.id } })
      if (!result) throw new Error('Запись не найдена')
      return result
    },
    onSuccess: async (_result, task) => {
      dismissRepeatedJointTask(task)
      setMessage(`Удален лишний повторный стык ${task.targetJoint}`)
      await invalidateWeldJoints(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const renameRepeatedJointMutation = useMutation({
    mutationFn: async (task: RepeatedJointRenameTask) => {
      const updatedRecord = buildRenamedRepeatedJointRow(task)
      return updateWeldRowOrThrow(updatedRecord)
    },
    onSuccess: async (saved, task) => {
      highlightChangedRows(saved ? [saved] : [task.row], ['joint'])
      dismissRepeatedJointTask(task)
      setMessage(`Стык ${task.currentJoint} переименован в ${task.targetJoint}`)
      await invalidateWeldJoints(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  return {
    obsoleteRepeatedJointMutation,
    renameRepeatedJointMutation,
    repeatedJointMutation,
  }
}
