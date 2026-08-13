import { useMutation, useQueryClient } from '@tanstack/react-query'
import { importWeldJoints } from '@/server/welds'
import { prepareImportedWeldRecords } from '@/lib/weld-journal-mutation-updates'
import { invalidateWeldJoints } from '@/lib/weld-query-utils'
import type { WeldInput } from '@/lib/weld-fields'
import type { UseWeldJournalMutationsOptions } from '@/lib/weld-journal-mutation-types'
import { assertWeldImportRowLimit, compactWeldWritePayload } from '@/lib/weld-import-limits'

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
      assertWeldImportRowLimit(records.length)
      const preparedRecords = prepareImportedWeldRecords({
        records,
        weldFormStampSelectOptions,
        welderStamps,
        welderStampSuspensions,
      })
      return importWeldJoints({
        data: { records: preparedRecords.map((record) => compactWeldWritePayload(record)) },
      })
    },
    onSuccess: (result) => {
      highlightChangedRows(result.rows)
      setMessage(`Добавлено записей: ${result.inserted}`)
      invalidateWeldJoints(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  return { importMutation }
}
