import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LNK_METHODS } from '@/lib/report-config'
import { getLnkMethodByRequestKey } from '@/lib/lnk-status'
import { getLnkRequestPositionHighlightFields } from '@/lib/lnk-report-mutation-highlight-fields'
import { buildLnkRequestCorrectionRow } from '@/lib/lnk-report-mutation-updates'
import { invalidateWeldJoints } from '@/lib/weld-query-utils'
import { updateWeldRowOrThrow } from '@/lib/weld-save-utils'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { RowWithId, UseLnkReportMutationsOptions } from '@/lib/lnk-report-mutation-types'

export function useLnkRequestCorrectionMutation({
  lnkRows,
  setMessage,
  highlightChangedRows,
  setManagedLnkRequestName,
  setManagedLnkRequestNameDraft,
}: UseLnkReportMutationsOptions) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      record,
      methodKey,
      requestName,
    }: {
      record: RowWithId
      methodKey: WeldFieldKey
      requestName: string | null
    }) => {
      const updatedRecord = buildLnkRequestCorrectionRow({ record, methodKey, requestName })
      const saved = await updateWeldRowOrThrow(updatedRecord)
      return saved as unknown as WeldRow
    },
    onSuccess: async (saved, variables) => {
      const method = getLnkMethodByRequestKey(variables.methodKey)
      highlightChangedRows(saved ? [saved] : [], getLnkRequestPositionHighlightFields(variables.methodKey))
      if (!variables.requestName && method) {
        const removedRequestName = String(variables.record[method.requestKey] ?? '').trim()
        const hasRemainingRequestPositions = lnkRows.some((row) =>
          LNK_METHODS.some((candidateMethod) => {
            const isRemovedPosition = row.id === variables.record.id && candidateMethod.requestKey === method.requestKey
            return !isRemovedPosition && String(row[candidateMethod.requestKey] ?? '').trim() === removedRequestName
          }),
        )
        if (removedRequestName && !hasRemainingRequestPositions) {
          setManagedLnkRequestName('')
          setManagedLnkRequestNameDraft('')
          setMessage(`Заявка ${removedRequestName} удалена, так как в ней не осталось позиций`)
        } else {
          setMessage('Позиция заявки ЛНК удалена')
        }
      } else {
        setMessage(variables.requestName ? 'Заявка ЛНК заменена' : 'Заявка ЛНК удалена')
      }
      await invalidateWeldJoints(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })
}
