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
import { isSameRequestDocument } from '@/lib/request-document-identity'
import { clearLnkRequestPosition } from '@/server/welds'

export function hasRemainingLnkRequestDocumentPositions({
  rows,
  removedRowId,
  removedMethodKey,
  requestName,
  requestDate,
}: {
  rows: WeldRow[]
  removedRowId: number
  removedMethodKey: WeldFieldKey
  requestName: string
  requestDate: string
}) {
  return rows.some((row) =>
    LNK_METHODS.some((method) => {
      const isRemovedPosition = row.id === removedRowId && method.requestKey === removedMethodKey
      return !isRemovedPosition && isSameRequestDocument(row[method.requestKey], row[method.requestDateKey], {
        name: requestName,
        date: requestDate,
      })
    }),
  )
}

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
      const method = getLnkMethodByRequestKey(methodKey)
      if (!requestName) {
        if (!method) throw new Error('Выберите вид контроля')
        const currentRequestName = String(record[method.requestKey] ?? '').trim()
        if (!currentRequestName) throw new Error('Позиция уже не входит в заявку ЛНК')
        const saved = await clearLnkRequestPosition({
          data: {
            rowId: record.id,
            methodKey,
            requestName: currentRequestName,
            requestDate: String(record[method.requestDateKey] ?? '').trim(),
          },
        })
        return saved as unknown as WeldRow
      }
      const updatedRecord = buildLnkRequestCorrectionRow({ record, methodKey, requestName })
      const saved = await updateWeldRowOrThrow(updatedRecord)
      return saved as unknown as WeldRow
    },
    onSuccess: async (saved, variables) => {
      const method = getLnkMethodByRequestKey(variables.methodKey)
      highlightChangedRows(saved ? [saved] : [], getLnkRequestPositionHighlightFields(variables.methodKey))
      if (!variables.requestName && method) {
        const removedRequestName = String(variables.record[method.requestKey] ?? '').trim()
        const removedRequestDate = String(variables.record[method.requestDateKey] ?? '').trim()
        const hasRemainingRequestPositions = hasRemainingLnkRequestDocumentPositions({
          rows: lnkRows,
          removedRowId: variables.record.id,
          removedMethodKey: method.requestKey,
          requestName: removedRequestName,
          requestDate: removedRequestDate,
        })
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
      await invalidateWeldJoints(queryClient, { upsertRows: [saved] })
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })
}
