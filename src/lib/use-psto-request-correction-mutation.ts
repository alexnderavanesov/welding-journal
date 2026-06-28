import { useMutation, useQueryClient } from '@tanstack/react-query'
import { buildPstoRequestCorrectionRow } from '@/lib/psto-report-mutation-updates'
import { PSTO_GENERATED_HIGHLIGHT_FIELDS } from '@/lib/psto-report-mutation-highlight-fields'
import { invalidateWeldJoints } from '@/lib/weld-query-utils'
import { updateWeldRowOrThrow } from '@/lib/weld-save-utils'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { RowWithId, UsePstoReportMutationsOptions } from '@/lib/psto-report-mutation-types'

export function usePstoRequestCorrectionMutation({
  heatTreatmentRows,
  setMessage,
  highlightChangedRows,
  setManagedPstoRequestName,
  setManagedPstoRequestNameDraft,
}: UsePstoReportMutationsOptions) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ record }: { record: RowWithId }) => {
      const updatedRecord = buildPstoRequestCorrectionRow(record)

      const saved = await updateWeldRowOrThrow(updatedRecord)
      return saved as unknown as WeldRow
    },
    onSuccess: async (saved, variables) => {
      const removedRequestName = String(variables.record.pstoRequest ?? '').trim()
      highlightChangedRows(saved ? [saved] : [], [...PSTO_GENERATED_HIGHLIGHT_FIELDS])
      const hasRemainingRequestPositions = heatTreatmentRows.some(
        (row) => row.id !== variables.record.id && String(row.pstoRequest ?? '').trim() === removedRequestName,
      )
      if (removedRequestName && !hasRemainingRequestPositions) {
        setManagedPstoRequestName('')
        setManagedPstoRequestNameDraft('')
        setMessage(`Заявка ${removedRequestName} удалена, так как в ней не осталось стыков`)
      } else {
        setMessage('Позиция заявки ПСТО удалена')
      }
      await invalidateWeldJoints(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })
}
