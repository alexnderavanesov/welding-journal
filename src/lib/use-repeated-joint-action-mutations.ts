import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createEarlyCoilDecision, deleteObsoleteRepeatedJoint } from '@/server/weld-mutations-api'
import { getWeldJointById } from '@/server/weld-read-api'
import { invalidateWeldJoints } from '@/lib/weld-query-utils'
import { createWeldRowsOrThrow, updateSystemWeldRowOrThrow } from '@/lib/weld-save-utils'
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

  const earlyCoilMutation = useMutation({
    mutationFn: async ({
      sourceRowId,
      expectedVersion,
    }: {
      sourceRowId: number
      expectedVersion: string
      task?: RepeatedJointCreateTask
    }) => createEarlyCoilDecision({ data: { sourceRowId, expectedVersion } }),
    onSuccess: async (result, variables) => {
      const createdRows = result.createdRows as WeldRow[]
      highlightChangedRows(createdRows, ['joint', 'weldDate', 'finalStatus'])
      if (variables.task) dismissRepeatedJointTask(variables.task)
      setMessage(
        `Созданы стыки катушки ${result.targetJoints.join(', ')} для ${result.sourceJoint}. Решение сохранено в принятых исключениях.`,
      )
      await Promise.all([
        invalidateWeldJoints(queryClient, {
          deleteIds: result.deletedRowIds,
          upsertRows: createdRows,
        }),
        queryClient.invalidateQueries({ queryKey: ['dispatcher-accepted-warnings'] }),
        queryClient.invalidateQueries({ queryKey: ['weld-joint-chain'] }),
      ])
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const repeatedJointMutation = useMutation({
    mutationFn: async (task: RepeatedJointCreateTask | RepeatedJointCoilTask) => {
      const sourceRow = await getWeldJointById({ data: { id: task.row.id } })
      if (!sourceRow) throw new Error('Исходный стык не найден')
      const targetJoints = task.kind === 'coil' ? task.targetJoints : [task.targetJoint]
      const savedRows = await createWeldRowsOrThrow(
        sourceRow as WeldRow,
        targetJoints,
        'Не удалось создать повторный стык',
      )
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
      await invalidateWeldJoints(queryClient, { upsertRows: createdRows })
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const obsoleteRepeatedJointMutation = useMutation({
    mutationFn: async (task: RepeatedJointDeleteTask) => {
      const result = await deleteObsoleteRepeatedJoint({
        data: {
          taskKey: task.key,
          target: { id: task.row.id, version: String(task.row.rowVersion ?? '').trim() },
        },
      })
      if (!result) throw new Error('Запись не найдена')
      return result
    },
    onSuccess: async (_result, task) => {
      dismissRepeatedJointTask(task)
      setMessage(`Удален лишний повторный стык ${task.targetJoint}`)
      await invalidateWeldJoints(queryClient, { deleteIds: [task.row.id] })
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const renameRepeatedJointMutation = useMutation({
    mutationFn: async (task: RepeatedJointRenameTask) => {
      return updateSystemWeldRowOrThrow(task)
    },
    onSuccess: async (savedRows, task) => {
      highlightChangedRows(savedRows.length > 0 ? savedRows : [task.row], ['joint'])
      dismissRepeatedJointTask(task)
      setMessage(
        task.changes.length > 1
          ? `Цепочка исправлена: переименовано стыков - ${task.changes.length}`
          : `Стык ${task.currentJoint} переименован в ${task.targetJoint}`,
      )
      await Promise.all([
        invalidateWeldJoints(queryClient, { upsertRows: savedRows }),
        queryClient.invalidateQueries({ queryKey: ['weld-joint-chain'] }),
      ])
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  return {
    earlyCoilMutation,
    obsoleteRepeatedJointMutation,
    renameRepeatedJointMutation,
    repeatedJointMutation,
  }
}
