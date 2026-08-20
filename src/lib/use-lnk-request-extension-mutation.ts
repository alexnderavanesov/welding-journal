import { useMutation, useQueryClient } from '@tanstack/react-query'

import { createDefaultLnkRequestDraft } from '@/lib/report-draft-state'
import { LNK_METHODS } from '@/lib/report-config'
import type { LnkRequestExtensionTarget } from '@/lib/lnk-request-extension'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { UseLnkReportMutationsOptions } from '@/lib/lnk-report-mutation-types'
import { invalidateWeldJoints } from '@/lib/weld-query-utils'
import { extendLnkRequest } from '@/server/welds'

export function useLnkRequestExtensionMutation({
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
      requestName,
      requestDate,
      targets,
    }: {
      requestName: string
      requestDate: string
      targets: LnkRequestExtensionTarget[]
    }) => {
      const savedRows = await extendLnkRequest({
        data: { requestName, requestDate, targets },
      })
      return savedRows as unknown as WeldRow[]
    },
    onSuccess: async (savedRows, variables) => {
      const requestFieldKeys = [...new Set(variables.targets.flatMap((target) => {
        const method = LNK_METHODS.find((candidate) => candidate.requestKey === target.methodKey)
        return method ? [method.requestKey, method.requestDateKey, method.resultKey] : []
      }))]
      highlightChangedRows(savedRows, requestFieldKeys)
      setLnkNotice(
        `В заявку «${variables.requestName}» добавлено: ${savedRows.length} стыков, ${variables.targets.length} позиций НК.`,
      )
      setSelectedLnkIds(new Set())
      setLnkRequestDraft(createDefaultLnkRequestDraft())
      setLnkRequestNaming(defaultLnkRequestNaming)
      setIsLnkRequestModalOpen(false)
      await invalidateWeldJoints(queryClient, { upsertRows: savedRows })
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })
}
