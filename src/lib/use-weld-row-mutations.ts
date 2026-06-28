import { useMutation, useQueryClient } from '@tanstack/react-query'
import { deleteWeldJoint } from '@/server/welds'
import { prepareWeldSaveValue } from '@/lib/weld-journal-mutation-updates'
import { invalidateWeldJoints } from '@/lib/weld-query-utils'
import { createWeldRowOrThrow, updateWeldRowOrThrow } from '@/lib/weld-save-utils'
import type { WeldDraft, WeldRow } from '@/lib/dispatcher-types'
import type { UseWeldJournalMutationsOptions } from '@/lib/weld-journal-mutation-types'

export function useWeldRowMutations({
  rows,
  welderStamps,
  editingFocusField,
  setEditing,
  setMessage,
  highlightChangedRows,
}: UseWeldJournalMutationsOptions) {
  const queryClient = useQueryClient()

  const saveMutation = useMutation({
    mutationFn: async (value: WeldDraft) => {
      const preparedValue = prepareWeldSaveValue({ value, rows, welderStamps })
      return preparedValue.id
        ? updateWeldRowOrThrow(preparedValue as WeldRow)
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

  return {
    deleteMutation,
    saveMutation,
  }
}
