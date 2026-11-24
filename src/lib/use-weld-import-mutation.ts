import { useMutation, useQueryClient } from '@tanstack/react-query'
import { importWeldJoints } from '@/server/weld-import-api'
import { prepareImportedWeldRecords } from '@/lib/weld-journal-mutation-updates'
import { scheduleWeldDataRefresh } from '@/lib/weld-query-utils'
import type { WeldInput } from '@/lib/weld-fields'
import type { UseWeldJournalMutationsOptions } from '@/lib/weld-journal-mutation-types'
import { assertWeldImportRowLimit, compactWeldWritePayload } from '@/lib/weld-import-limits'

export function useWeldImportMutation({
  checkStampsOnServer,
  welderStamps,
  welderStampSuspensions,
  weldFormStampSelectOptions,
  setMessage,
  highlightChangedRows,
}: UseWeldJournalMutationsOptions) {
  const queryClient = useQueryClient()

  const importMutation = useMutation({
    mutationFn: async ({ records, importId }: { records: WeldInput[]; importId: string }) => {
      assertWeldImportRowLimit(records.length)
      const preparedRecords = prepareImportedWeldRecords({
        records,
        checkStampsOnServer,
        weldFormStampSelectOptions,
        welderStamps,
        welderStampSuspensions,
      })
      return importWeldJoints({
        data: { importId, records: preparedRecords.map((record) => compactWeldWritePayload(record)) },
      })
    },
    onSuccess: (result) => {
      highlightChangedRows(result.rows)
      setMessage(`Добавлено записей: ${result.inserted}`)
      scheduleWeldDataRefresh(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  return { importMutation }
}
