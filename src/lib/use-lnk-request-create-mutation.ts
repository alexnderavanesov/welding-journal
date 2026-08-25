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
import type { SystemDocumentCreationGroup } from '@/lib/system-document-creation-plan'

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
      useSystemName,
      documentGroups,
    }: {
      records: RowWithId[]
      methodKeys: WeldFieldKey[]
      requestName: string
      requestDate: string
      useSystemName?: boolean
      documentGroups?: SystemDocumentCreationGroup[]
    }) => {
      const groups = documentGroups ?? [{
        key: 'legacy',
        label: 'Все выбранные позиции',
        rowIds: records.map((record) => record.id),
        rows: records as WeldRow[],
        name: requestName,
        useSystemName: Boolean(useSystemName),
        isMissingValueFallback: false,
      }]
      const updatedRecords = groups.flatMap((group) =>
        buildLnkRequestRows({
          records: group.rows,
          methodKeys,
          requestName: group.name,
          requestDate,
        }),
      )

      if (updatedRecords.length === 0) {
        throw new Error('Нет доступных стыков или видов контроля для новой заявки ЛНК')
      }

      const savedRows = await updateWeldRowsOrThrow(
        updatedRecords,
        'Не удалось сохранить часть записей',
        {
          systemDocumentSequences: groups
            .filter((group) => group.useSystemName)
            .map((group) => ({
                type: 'lnkRequest',
                date: requestDate,
                fieldKeys: methodKeys,
                provisionalName: group.name,
              })),
        },
      )
      return savedRows as unknown as WeldRow[]
    },
    onSuccess: async (savedRows, variables) => {
      const requestDateFields = variables.methodKeys.flatMap((methodKey) => {
        const method = LNK_METHODS.find((candidate) => candidate.requestKey === methodKey)
        return method ? [method.requestDateKey] : []
      })
      highlightChangedRows(savedRows, [...variables.methodKeys, ...requestDateFields, 'lnkCreatedAt'])
      const savedRequestName = variables.methodKeys
        .map((fieldKey) => String(savedRows[0]?.[fieldKey] ?? '').trim())
        .find(Boolean) ?? variables.requestName
      const documentCount = variables.documentGroups?.length ?? 1
      setLnkNotice(
        documentCount > 1
          ? `Создано заявок ЛНК: ${documentCount} · стыков: ${savedRows.length}`
          : formatRequestCreatedMessage(savedRequestName, savedRows.length),
      )
      setSelectedLnkIds(new Set())
      setLnkRequestDraft(createDefaultLnkRequestDraft())
      setLnkRequestNaming(defaultLnkRequestNaming)
      setIsLnkRequestModalOpen(false)
      await invalidateWeldJoints(queryClient, { upsertRows: savedRows })
      await queryClient.invalidateQueries({ queryKey: ['system-document-sequences'] })
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })
}
