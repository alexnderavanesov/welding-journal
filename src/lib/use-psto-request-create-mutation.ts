import { useMutation, useQueryClient } from '@tanstack/react-query'
import { formatRequestCreatedMessage } from '@/lib/report-naming'
import { buildPstoRequestRows } from '@/lib/psto-report-mutation-updates'
import { PSTO_REQUEST_HIGHLIGHT_FIELDS } from '@/lib/psto-report-mutation-highlight-fields'
import { invalidateWeldJoints } from '@/lib/weld-query-utils'
import { updateWeldRowsOrThrow } from '@/lib/weld-save-utils'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { RowWithId, UsePstoReportMutationsOptions } from '@/lib/psto-report-mutation-types'
import type { SystemDocumentCreationGroup } from '@/lib/system-document-creation-plan'

export function usePstoRequestCreateMutation({
  setMessage,
  highlightChangedRows,
  setSelectedHeatTreatmentIds,
  setPstoRequestNaming,
  setPstoRequestSearch,
  setPstoRequestDate,
  setIsPstoRequestModalOpen,
  defaultPstoRequestNaming,
}: UsePstoReportMutationsOptions) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      records,
      requestName,
      requestDate,
      useSystemName,
      documentGroups,
    }: {
      records: RowWithId[]
      requestName: string
      requestDate: string
      mode?: 'create' | 'edit'
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
        buildPstoRequestRows({ records: group.rows, requestName: group.name, requestDate }),
      )
      const savedRows = await updateWeldRowsOrThrow(
        updatedRecords,
        'Не удалось сохранить часть записей',
        {
          mutationScope: 'psto',
          requireFullyAssignedPstoLines: true,
          systemDocumentSequences: groups
            .filter((group) => group.useSystemName)
            .map((group) => ({
                type: 'pstoRequest',
                date: requestDate,
                fieldKeys: ['pstoRequest'],
                provisionalName: group.name,
              })),
        },
      )
      return savedRows as unknown as WeldRow[]
    },
    onSuccess: async (_result, variables) => {
      highlightChangedRows(_result, [...PSTO_REQUEST_HIGHLIGHT_FIELDS])
      const documentCount = variables.documentGroups?.length ?? 1
      setMessage(
        variables.mode === 'edit'
          ? 'Заявка ПСТО обновлена'
          : documentCount > 1
            ? `Создано заявок ПСТО: ${documentCount} · стыков: ${_result.length}`
          : formatRequestCreatedMessage(
              String(_result[0]?.pstoRequest ?? variables.requestName),
              variables.records.length,
            ),
      )
      setSelectedHeatTreatmentIds(new Set())
      setPstoRequestNaming(defaultPstoRequestNaming)
      setPstoRequestSearch('')
      setPstoRequestDate('')
      setIsPstoRequestModalOpen(false)
      await invalidateWeldJoints(queryClient, { upsertRows: _result })
      await queryClient.invalidateQueries({ queryKey: ['system-document-sequences'] })
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })
}
