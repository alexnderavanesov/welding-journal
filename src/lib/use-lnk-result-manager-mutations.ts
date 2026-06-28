import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getLnkConclusionHighlightFields,
  getLnkResultHighlightFields,
  getLnkResultReplacementHighlightFields,
} from '@/lib/lnk-report-mutation-highlight-fields'
import {
  buildLnkConclusionCorrectionRows,
  buildLnkResultCorrectionRow,
  buildLnkResultReplacementRows,
} from '@/lib/lnk-report-mutation-updates'
import { getManagedLnkResultChangeKey } from '@/lib/lnk-result-draft'
import { invalidateWeldJoints } from '@/lib/weld-query-utils'
import { updateWeldRowOrThrow, updateWeldRowsOrThrow } from '@/lib/weld-save-utils'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { RowWithId, UseLnkReportMutationsOptions } from '@/lib/lnk-report-mutation-types'

export function useLnkResultManagerMutations({
  setMessage,
  highlightChangedRows,
  setManagedLnkPendingResultChanges,
  setManagedLnkResultChangeHint,
  setManagedLnkResultPreview,
}: UseLnkReportMutationsOptions) {
  const queryClient = useQueryClient()

  const lnkResultCorrectionMutation = useMutation({
    mutationFn: async ({
      record,
      methodKey,
      result,
    }: {
      record: RowWithId
      methodKey: WeldFieldKey
      result: string | null
    }) => {
      const updatedRecord = buildLnkResultCorrectionRow({ record, methodKey, result })
      const saved = await updateWeldRowOrThrow(updatedRecord)
      return saved as unknown as WeldRow
    },
    onSuccess: async (saved, variables) => {
      highlightChangedRows(saved ? [saved] : [], getLnkResultHighlightFields(variables.methodKey))
      setMessage(variables.result ? 'Результат ЛНК изменен' : 'Результат ЛНК удален')
      await invalidateWeldJoints(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const lnkResultReplacementMutation = useMutation({
    mutationFn: async ({
      updates,
    }: {
      updates: Array<{ record: RowWithId; methodKey: WeldFieldKey; result: string }>
    }) => {
      const updatedRecords = buildLnkResultReplacementRows({ updates })

      const savedRows = await updateWeldRowsOrThrow(updatedRecords)
      return savedRows as unknown as WeldRow[]
    },
    onSuccess: async (savedRows, variables) => {
      highlightChangedRows(savedRows, getLnkResultReplacementHighlightFields(variables.updates))
      const savedKeys = new Set(variables.updates.map(({ record, methodKey }) => getManagedLnkResultChangeKey(record.id, methodKey)))
      setManagedLnkPendingResultChanges((current) =>
        Object.fromEntries(Object.entries(current).filter(([changeKey]) => !savedKeys.has(changeKey))),
      )
      setManagedLnkResultChangeHint(null)
      setManagedLnkResultPreview(null)
      setMessage(`Результат ЛНК изменен для стыков: ${savedRows.length}`)
      await invalidateWeldJoints(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const lnkConclusionCorrectionMutation = useMutation({
    mutationFn: async ({
      records,
      methodKey,
      conclusionName,
    }: {
      records: RowWithId[]
      methodKey: WeldFieldKey
      conclusionName: string
    }) => {
      const updatedRecords = buildLnkConclusionCorrectionRows({ records, methodKey, conclusionName })

      if (updatedRecords.length === 0) throw new Error('Нет результатов для переименования заключения')

      const savedRows = await updateWeldRowsOrThrow(updatedRecords)
      return savedRows as unknown as WeldRow[]
    },
    onSuccess: async (savedRows, variables) => {
      highlightChangedRows(savedRows, getLnkConclusionHighlightFields(variables.methodKey))
      setMessage(`Заключение переименовано для позиций: ${savedRows.length}`)
      await invalidateWeldJoints(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  return {
    lnkResultCorrectionMutation,
    lnkResultReplacementMutation,
    lnkConclusionCorrectionMutation,
  }
}
