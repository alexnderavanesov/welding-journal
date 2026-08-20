import { useMutation, useQueryClient } from '@tanstack/react-query'
import { buildLnkFieldRow } from '@/lib/lnk-report-mutation-updates'
import { getLnkMethodByRequestKey } from '@/lib/lnk-status'
import { invalidateWeldJoints } from '@/lib/weld-query-utils'
import { updateWeldRowOrThrow } from '@/lib/weld-save-utils'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { RowWithId, UseLnkReportMutationsOptions } from '@/lib/lnk-report-mutation-types'
import { clearLnkRequestPosition } from '@/server/welds'

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
      const requestMethod = getLnkMethodByRequestKey(fieldKey)
      if (requestMethod && !value) {
        const requestName = String(record[requestMethod.requestKey] ?? '').trim()
        if (!requestName) throw new Error('Позиция уже не входит в заявку ЛНК')
        const saved = await clearLnkRequestPosition({
          data: {
            rowId: record.id,
            methodKey: fieldKey,
            requestName,
            requestDate: String(record[requestMethod.requestDateKey] ?? '').trim(),
          },
        })
        return saved as unknown as WeldRow
      }
      const updatedRecord = buildLnkFieldRow({ record, fieldKey, value, lnkRequestOptions })
      const saved = await updateWeldRowOrThrow(updatedRecord)
      return saved as unknown as WeldRow
    },
    onSuccess: async (saved, variables) => {
      highlightChangedRows(saved ? [saved] : [], [variables.fieldKey, 'lnkCreatedAt', 'finalStatus'])
      setMessage('Поле ЛНК обновлено')
      setHeatTreatmentFieldEditing(null)
      await invalidateWeldJoints(queryClient, { upsertRows: [saved] })
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  return { lnkFieldMutation }
}
