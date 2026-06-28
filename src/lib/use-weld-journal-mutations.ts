import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  deleteWeldJoint,
  importWeldJoints,
} from '@/server/welds'
import { buildRepeatedJointDraft } from '@/lib/repeated-joint-draft'
import {
  validateManualJointNameForSave,
  validateManualJointNamesForImport,
  validateRequiredRootStampForSave,
  validateRequiredRootStampsForImport,
  validateWeldDatesForImport,
} from '@/lib/weld-validation'
import {
  normalizeWeldingMethodsForImport,
  validateOfficialStampCompatibilityForImport,
  validateOfficialStampCompatibilityForSave,
  validateWelderStampFieldsForImport,
} from '@/lib/welder-stamp-registry'
import type {
  RepeatedJointCoilTask,
  RepeatedJointCreateTask,
  RepeatedJointDeleteTask,
  RepeatedJointRenameTask,
  WeldRow,
} from '@/lib/dispatcher-types'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'
import { invalidateWeldJoints } from '@/lib/weld-query-utils'
import {
  createWeldRowOrThrow,
  createWeldRowsOrThrow,
  updateWeldRowOrThrow,
} from '@/lib/weld-save-utils'
import type { UseWeldJournalMutationsOptions } from '@/lib/weld-journal-mutation-types'

export function useWeldJournalMutations({
  rows,
  welderStamps,
  weldFormStampSelectOptions,
  editingFocusField,
  setEditing,
  setMessage,
  highlightChangedRows,
  dismissRepeatedJointTask,
}: UseWeldJournalMutationsOptions) {
  const queryClient = useQueryClient()

  const saveMutation = useMutation({
    mutationFn: async (value: WeldInput & { id?: number }) => {
      const preparedValue = value
      validateRequiredRootStampForSave(preparedValue)
      validateManualJointNameForSave(preparedValue, rows)
      validateOfficialStampCompatibilityForSave(preparedValue, welderStamps)
      return preparedValue.id
        ? updateWeldRowOrThrow(preparedValue as WeldInput & { id: number })
        : createWeldRowOrThrow(preparedValue)
    },
    onSuccess: async (saved, variables) => {
      highlightChangedRows(saved ? [saved] : [variables], variables.id && editingFocusField ? [editingFocusField] : [])
      setEditing(null)
      setMessage('Запись сохранена')
      await invalidateWeldJoints(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const repeatedJointMutation = useMutation({
    mutationFn: async (task: RepeatedJointCreateTask | RepeatedJointCoilTask) => {
      const targetJoints = task.kind === 'coil' ? task.targetJoints : [task.targetJoint]
      const drafts = targetJoints.map((targetJoint) => buildRepeatedJointDraft(task.row, targetJoint))
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
      const updatedRecord = { ...task.row, joint: task.targetJoint }
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

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const result = await deleteWeldJoint({ data: { id } })
      if (!result) throw new Error('Запись не найдена')
      return result
    },
    onSuccess: async () => {
      setMessage('Запись удалена')
      await invalidateWeldJoints(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const importMutation = useMutation({
    mutationFn: async (records: WeldInput[]) => {
      const preparedRecords = records
      validateRequiredRootStampsForImport(preparedRecords)
      validateManualJointNamesForImport(preparedRecords)
      validateWeldDatesForImport(preparedRecords)
      normalizeWeldingMethodsForImport(preparedRecords)
      validateWelderStampFieldsForImport(preparedRecords, weldFormStampSelectOptions)
      validateOfficialStampCompatibilityForImport(preparedRecords, welderStamps)
      return importWeldJoints({ data: { records: preparedRecords } })
    },
    onSuccess: async (result) => {
      highlightChangedRows(result.rows)
      setMessage(`Добавлено записей: ${result.inserted}`)
      await invalidateWeldJoints(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  return {
    deleteMutation,
    importMutation,
    obsoleteRepeatedJointMutation,
    renameRepeatedJointMutation,
    repeatedJointMutation,
    saveMutation,
  }
}
