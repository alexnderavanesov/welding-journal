import { useMutation, useQueryClient } from '@tanstack/react-query'
import { formatRequestCreatedMessage } from '@/lib/report-naming'
import { defaultRequestNamingState } from '@/lib/request-naming-state'
import { buildPstoRequestRows } from '@/lib/psto-report-mutation-updates'
import { PSTO_REQUEST_HIGHLIGHT_FIELDS } from '@/lib/psto-report-mutation-highlight-fields'
import { invalidateWeldJoints } from '@/lib/weld-query-utils'
import { updateWeldRowsOrThrow } from '@/lib/weld-save-utils'
import type { RowWithId, UsePstoReportMutationsOptions } from '@/lib/psto-report-mutation-types'

export function usePstoRequestCreateMutation({
  setMessage,
  highlightChangedRows,
  setSelectedHeatTreatmentIds,
  setPstoRequestNaming,
  setPstoRequestSearch,
  setIsPstoRequestModalOpen,
}: UsePstoReportMutationsOptions) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      records,
      requestName,
    }: {
      records: RowWithId[]
      requestName: string
      mode?: 'create' | 'edit'
    }) => {
      const updatedRecords = buildPstoRequestRows({ records, requestName })
      const savedRows = await updateWeldRowsOrThrow(updatedRecords)
      return savedRows
    },
    onSuccess: async (_result, variables) => {
      highlightChangedRows(_result, [...PSTO_REQUEST_HIGHLIGHT_FIELDS])
      setMessage(
        variables.mode === 'edit'
          ? 'Заявка ПСТО обновлена'
          : formatRequestCreatedMessage(variables.requestName, variables.records.length),
      )
      setSelectedHeatTreatmentIds(new Set())
      setPstoRequestNaming(defaultRequestNamingState)
      setPstoRequestSearch('')
      setIsPstoRequestModalOpen(false)
      await invalidateWeldJoints(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })
}
