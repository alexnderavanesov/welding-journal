import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createDefaultLnkRequestDraft } from '@/lib/report-draft-state'
import { formatRequestCreatedMessage } from '@/lib/report-naming'
import { LNK_METHODS } from '@/lib/report-config'
import { buildLnkRequestRows } from '@/lib/lnk-report-mutation-updates'
import { invalidateWeldJoints } from '@/lib/weld-query-utils'
import { updateWeldRowsOrThrow } from '@/lib/weld-save-utils'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { RowWithId, UseLnkReportMutationsOptions } from '@/lib/lnk-report-mutation-types'

export function useLnkRequestCreateMutation({
  setMessage,
  setLnkNotice,
  highlightChangedRows,
  setSelectedLnkIds,
  setLnkRequestDraft,
  setLnkRequestNaming,
  setIsLnkRequestModalOpen,
  defaultLnkRequestNaming,
}: UseLnkReportMutationsOptions) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      records,
      methodKeys,
      requestName,
      requestDate,
    }: {
      records: RowWithId[]
      methodKeys: WeldFieldKey[]
      requestName: string
      requestDate: string
    }) => {
      const updatedRecords = buildLnkRequestRows({ records, methodKeys, requestName, requestDate })

      if (updatedRecords.length === 0) {
        throw new Error('Нет доступных стыков или видов контроля для новой заявки ЛНК')
      }

      const savedRows = await updateWeldRowsOrThrow(updatedRecords)
      return savedRows as unknown as WeldRow[]
    },
    onSuccess: async (savedRows, variables) => {
      const requestDateFields = variables.methodKeys.flatMap((methodKey) => {
        const method = LNK_METHODS.find((candidate) => candidate.requestKey === methodKey)
        return method ? [method.requestDateKey] : []
      })
      highlightChangedRows(savedRows, [...variables.methodKeys, ...requestDateFields, 'lnkCreatedAt'])
      setLnkNotice(formatRequestCreatedMessage(variables.requestName, savedRows.length))
      setSelectedLnkIds(new Set())
      setLnkRequestDraft(createDefaultLnkRequestDraft())
      setLnkRequestNaming(defaultLnkRequestNaming)
      setIsLnkRequestModalOpen(false)
      await invalidateWeldJoints(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })
}
