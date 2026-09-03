import { useMutation, useQueryClient } from '@tanstack/react-query'
import { deleteWeldJoint, deleteWeldJoints } from '@/server/weld-mutations-api'
import { prepareWeldSaveValue } from '@/lib/weld-journal-mutation-updates'
import { invalidateWeldJoints } from '@/lib/weld-query-utils'
import {
  createWeldRowOrThrow,
  moveWeldJointChainOrThrow,
  updateWeldRowOrThrow,
} from '@/lib/weld-save-utils'
import type { WeldDraft, WeldRow } from '@/lib/dispatcher-types'
import type {
  PstoWeldLineMoveDisposition,
  WeldChainLineMovePlan,
} from '@/lib/psto-line-assignment'
import type { UseWeldJournalMutationsOptions } from '@/lib/weld-journal-mutation-types'

export function useWeldRowMutations({
  rows,
  editingRecord,
  welderStamps,
  welderStampSuspensions,
  editingFocusField,
  setEditing,
  setMessage,
  highlightChangedRows,
}: UseWeldJournalMutationsOptions) {
  const queryClient = useQueryClient()

  const saveMutation = useMutation({
    mutationFn: async (value: WeldDraft & {
      pstoLineMoveDisposition?: PstoWeldLineMoveDisposition
      weldChainLineMovePlan?: WeldChainLineMovePlan
    }) => {
      const validationRows = rows.length > 0 ? rows : editingRecord ? [editingRecord] : []
      const preparedValue = prepareWeldSaveValue({ value, rows: validationRows, welderStamps, welderStampSuspensions })
      const saveValue = {
        ...preparedValue,
        ...(value.pstoLineMoveDisposition
          ? { pstoLineMoveDisposition: value.pstoLineMoveDisposition }
          : {}),
        ...(value.weldChainLineMovePlan
          ? { weldChainLineMovePlan: value.weldChainLineMovePlan }
          : {}),
      }
      if (!preparedValue.id) return [await createWeldRowOrThrow(saveValue)]
      if (value.weldChainLineMovePlan) {
        return moveWeldJointChainOrThrow(saveValue as WeldRow & {
          weldChainLineMovePlan: WeldChainLineMovePlan
        })
      }
      return [await updateWeldRowOrThrow(saveValue as WeldRow & {
        pstoLineMoveDisposition?: PstoWeldLineMoveDisposition
      })]
    },
    onSuccess: async (savedRows, variables) => {
      highlightChangedRows(savedRows.length > 0 ? savedRows : [variables], variables.id && editingFocusField ? [editingFocusField] : [])
      setMessage(variables.weldChainLineMovePlan
        ? `Цепочка стыка перенесена · записей: ${savedRows.length}`
        : 'Запись сохранена')
      invalidateWeldJoints(queryClient, { upsertRows: savedRows as WeldRow[] })
      setEditing(null)
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
    onSuccess: async (_result, id) => {
      setMessage('Запись удалена')
      invalidateWeldJoints(queryClient, { deleteIds: [id] })
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const deleteManyMutation = useMutation({
    mutationFn: async (ids: number[]) => deleteWeldJoints({ data: { ids } }),
    onSuccess: async (_result, ids) => {
      invalidateWeldJoints(queryClient, { deleteIds: ids })
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  return {
    deleteManyMutation,
    deleteMutation,
    saveMutation,
  }
}
