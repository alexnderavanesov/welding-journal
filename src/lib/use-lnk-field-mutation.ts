import { useMutation, useQueryClient } from '@tanstack/react-query'
import { buildLnkFieldRow } from '@/lib/lnk-report-mutation-updates'
import { invalidateWeldJoints } from '@/lib/weld-query-utils'
import { updateWeldRowOrThrow } from '@/lib/weld-save-utils'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { RowWithId, UseLnkReportMutationsOptions } from '@/lib/lnk-report-mutation-types'

export function useLnkFieldMutation({
  lnkRequestOptions,
  setMessage,
  highlightChangedRows,
  setHeatTreatmentFieldEditing,
}: UseLnkReportMutationsOptions) {
  const queryClient = useQueryClient()

  const lnkFieldMutation = useMutation({
    mutationFn: async ({
      record,
      fieldKey,
      value,
    }: {
      record: RowWithId
      fieldKey: WeldFieldKey
      value: string | null
    }) => {
      const updatedRecord = buildLnkFieldRow({ record, fieldKey, value, lnkRequestOptions })
      const saved = await updateWeldRowOrThrow(updatedRecord)
      return saved as unknown as WeldRow
    },
    onSuccess: async (saved, variables) => {
      highlightChangedRows(saved ? [saved] : [], [variables.fieldKey, 'lnkCreatedAt', 'finalStatus'])
      setMessage('Поле ЛНК обновлено')
      setHeatTreatmentFieldEditing(null)
      await invalidateWeldJoints(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  return { lnkFieldMutation }
}
