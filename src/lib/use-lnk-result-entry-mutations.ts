import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  LNK_EMPTY_RESULT_VALUE,
  LNK_METHODS,
} from '@/lib/report-config'
import { getLnkResultHighlightFields } from '@/lib/lnk-report-mutation-highlight-fields'
import { buildLnkResultRows } from '@/lib/lnk-report-mutation-updates'
import { createDefaultLnkResultDraft } from '@/lib/report-draft-state'
import { invalidateWeldJoints } from '@/lib/weld-query-utils'
import { updateWeldRowsOrThrow } from '@/lib/weld-save-utils'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { RowWithId, UseLnkReportMutationsOptions } from '@/lib/lnk-report-mutation-types'
import type { SystemDocumentCreationGroup } from '@/lib/system-document-creation-plan'

export function useLnkResultEntryMutations({
  controlProcessSettings,
  setMessage,
  setLnkNotice,
  highlightChangedRows,
  setIsLnkResultModalOpen,
  setLnkResultDraft,
  defaultLnkConclusionNaming,
  onWorkflowCorrectionSaved,
}: UseLnkReportMutationsOptions) {
  const queryClient = useQueryClient()

  const lnkResultMutation = useMutation({
    mutationFn: async ({
      records,
      methodKey,
      controlDate,
      resultById,
      conclusionName,
      useSystemName,
      documentGroups,
    }: {
      records: RowWithId[]
      methodKey: WeldFieldKey
      controlDate: string
      resultById: Record<number, string>
      conclusionName: string
      useSystemName?: boolean
      documentGroups?: SystemDocumentCreationGroup[]
    }) => {
      const method = LNK_METHODS.find((candidate) => candidate.requestKey === methodKey)
      const hasConclusion = Object.values(resultById).some((result) => result !== LNK_EMPTY_RESULT_VALUE)
      const groups = documentGroups ?? (hasConclusion ? [{
        key: 'legacy',
        label: 'Все выбранные позиции',
        rowIds: records.map((record) => record.id),
        rows: records as WeldRow[],
        name: conclusionName,
        useSystemName: Boolean(useSystemName),
        isMissingValueFallback: false,
      }] : [])
      const groupedRowIds = new Set(groups.flatMap((group) => group.rowIds))
      const updatedRecords = [
        ...groups.flatMap((group) =>
          buildLnkResultRows({
            records: group.rows,
            methodKey,
            controlDate,
            resultById,
            conclusionName: group.name,
            controlProcessSettings,
          }),
        ),
        ...buildLnkResultRows({
          records: records.filter((record) => !groupedRowIds.has(record.id)),
          methodKey,
          controlDate,
          resultById,
          conclusionName: '',
          controlProcessSettings,
        }),
      ]
      const savedRows = await updateWeldRowsOrThrow(
        updatedRecords,
        'Не удалось сохранить часть записей',
        {
          mutationScope: 'lnk',
          systemDocumentSequences: method
            ? groups.filter((group) => group.useSystemName).map((group) => ({
                type: 'lnkConclusion',
                date: controlDate,
                methodCode: method.code,
                fieldKeys: [method.conclusionKey],
                provisionalName: group.name,
              }))
            : [],
        },
      )
      return savedRows as unknown as WeldRow[]
    },
    onSuccess: async (savedRows, variables) => {
      highlightChangedRows(savedRows, getLnkResultHighlightFields(variables.methodKey))
      const changedResults = Object.values(variables.resultById)
      setLnkNotice(
        changedResults.every((result) => result === LNK_EMPTY_RESULT_VALUE)
          ? `Результат ЛНК очищен для стыков: ${savedRows.length}`
          : `Результат ЛНК внесен для стыков: ${savedRows.length}`,
      )
      setIsLnkResultModalOpen(false)
      setLnkResultDraft(createDefaultLnkResultDraft(defaultLnkConclusionNaming))
      await invalidateWeldJoints(queryClient, { upsertRows: savedRows })
      await queryClient.invalidateQueries({ queryKey: ['system-document-sequences'] })
      onWorkflowCorrectionSaved?.()
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  return {
    lnkResultMutation,
  }
}
