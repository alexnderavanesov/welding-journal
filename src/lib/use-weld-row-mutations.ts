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
import type { WeldRowVersionTarget } from '@/lib/weld-row-version'
import type { UseWeldJournalMutationsOptions } from '@/lib/weld-journal-mutation-types'

export function useWeldRowMutations({
  rows,
  editingRecord,
  welderStamps,
  welderStampSuspensions,
  editingFocusField,
  setEditing,
  setMessage,
  onWeldRowSaved,
  onWorkflowCorrectionSaved,
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
      const savedEditedRow = variables.id
        ? savedRows.find((row) => Number(row.id) === Number(variables.id))
        : undefined
      if (editingRecord && savedEditedRow) {
        onWeldRowSaved?.(editingRecord, savedEditedRow as WeldRow)
      }
      setEditing(null)
      onWorkflowCorrectionSaved?.()
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (target: WeldRowVersionTarget) => {
      const result = await deleteWeldJoint({
        data: target,
      })
      if (!result) throw new Error('Запись не найдена')
      return result
    },
    onSuccess: async (_result, target) => {
      setMessage('Запись удалена')
      invalidateWeldJoints(queryClient, { deleteIds: [target.id] })
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const deleteManyMutation = useMutation({
    mutationFn: async (targets: WeldRowVersionTarget[]) => {
      return deleteWeldJoints({
        data: { targets },
      })
    },
    onSuccess: async (_result, targets) => {
      invalidateWeldJoints(queryClient, { deleteIds: targets.map((target) => target.id) })
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
