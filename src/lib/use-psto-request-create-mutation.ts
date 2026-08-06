import { useMutation, useQueryClient } from '@tanstack/react-query'
import { formatRequestCreatedMessage } from '@/lib/report-naming'
import { buildPstoRequestRows } from '@/lib/psto-report-mutation-updates'
import { PSTO_REQUEST_HIGHLIGHT_FIELDS } from '@/lib/psto-report-mutation-highlight-fields'
import { invalidateWeldJoints } from '@/lib/weld-query-utils'
import { updateWeldRowsOrThrow } from '@/lib/weld-save-utils'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { RowWithId, UsePstoReportMutationsOptions } from '@/lib/psto-report-mutation-types'

export function usePstoRequestCreateMutation({
  setMessage,
  highlightChangedRows,
  setSelectedHeatTreatmentIds,
  setPstoRequestNaming,
  setPstoRequestSearch,
  setPstoRequestDate,
  setIsPstoRequestModalOpen,
  defaultPstoRequestNaming,
}: UsePstoReportMutationsOptions) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      records,
      requestName,
      requestDate,
      useSystemName,
    }: {
      records: RowWithId[]
      requestName: string
      requestDate: string
      mode?: 'create' | 'edit'
      useSystemName?: boolean
    }) => {
      const updatedRecords = buildPstoRequestRows({ records, requestName, requestDate })
      const savedRows = await updateWeldRowsOrThrow(
        updatedRecords,
        'Не удалось сохранить часть записей',
        useSystemName
          ? {
              systemDocumentSequence: {
                type: 'pstoRequest',
                date: requestDate,
                fieldKeys: ['pstoRequest'],
                provisionalName: requestName,
              },
            }
          : {},
      )
      return savedRows as unknown as WeldRow[]
    },
    onSuccess: async (_result, variables) => {
      highlightChangedRows(_result, [...PSTO_REQUEST_HIGHLIGHT_FIELDS])
      setMessage(
        variables.mode === 'edit'
          ? 'Заявка ПСТО обновлена'
          : formatRequestCreatedMessage(
              String(_result[0]?.pstoRequest ?? variables.requestName),
              variables.records.length,
            ),
      )
      setSelectedHeatTreatmentIds(new Set())
      setPstoRequestNaming(defaultPstoRequestNaming)
      setPstoRequestSearch('')
      setPstoRequestDate('')
      setIsPstoRequestModalOpen(false)
      await invalidateWeldJoints(queryClient)
      await queryClient.invalidateQueries({ queryKey: ['system-document-sequences'] })
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })
}
