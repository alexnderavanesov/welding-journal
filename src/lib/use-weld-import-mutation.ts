import { useMutation, useQueryClient } from '@tanstack/react-query'
import { importWeldJoints } from '@/server/welds'
import { prepareImportedWeldRecords } from '@/lib/weld-journal-mutation-updates'
import { invalidateWeldJoints } from '@/lib/weld-query-utils'
import type { WeldInput } from '@/lib/weld-fields'
import type { UseWeldJournalMutationsOptions } from '@/lib/weld-journal-mutation-types'

export function useWeldImportMutation({
  welderStamps,
  welderStampSuspensions,
  weldFormStampSelectOptions,
  setMessage,
  highlightChangedRows,
}: UseWeldJournalMutationsOptions) {
  const queryClient = useQueryClient()

  const importMutation = useMutation({
    mutationFn: async (records: WeldInput[]) => {
      const preparedRecords = prepareImportedWeldRecords({
        records,
        weldFormStampSelectOptions,
        welderStamps,
        welderStampSuspensions,
      })
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

  return { importMutation }
}
