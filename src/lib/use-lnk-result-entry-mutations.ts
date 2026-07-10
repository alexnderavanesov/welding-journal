import { useMutation, useQueryClient } from '@tanstack/react-query'
import { clearLnkGeneratedWeldData } from '@/server/welds'
import {
  LNK_EMPTY_RESULT_VALUE,
  LNK_GENERATED_FIELD_KEYS as lnkGeneratedFieldKeys,
} from '@/lib/report-config'
import { getLnkResultHighlightFields } from '@/lib/lnk-report-mutation-highlight-fields'
import { buildClearLnkGeneratedRows, buildLnkResultRows } from '@/lib/lnk-report-mutation-updates'
import { createDefaultLnkResultDraft } from '@/lib/report-draft-state'
import { invalidateWeldJoints } from '@/lib/weld-query-utils'
import { updateWeldRowsOrThrow } from '@/lib/weld-save-utils'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { RowWithId, UseLnkReportMutationsOptions } from '@/lib/lnk-report-mutation-types'

export function useLnkResultEntryMutations({
  setMessage,
  setLnkNotice,
  highlightChangedRows,
  setSelectedLnkIds,
  setIsLnkResultModalOpen,
  setLnkResultDraft,
  defaultLnkConclusionNaming,
}: UseLnkReportMutationsOptions) {
  const queryClient = useQueryClient()

  const lnkResultMutation = useMutation({
    mutationFn: async ({
      records,
      methodKey,
      controlDate,
      resultById,
      conclusionName,
    }: {
      records: RowWithId[]
      methodKey: WeldFieldKey
      controlDate: string
      resultById: Record<number, string>
      conclusionName: string
    }) => {
      const updatedRecords = buildLnkResultRows({ records, methodKey, controlDate, resultById, conclusionName })

      const savedRows = await updateWeldRowsOrThrow(updatedRecords)
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
      await invalidateWeldJoints(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const clearLnkGeneratedDataMutation = useMutation({
    mutationFn: async (targetRows: WeldRow[]) => {
      const updatedRows = buildClearLnkGeneratedRows(targetRows)
      if (updatedRows.length === 0) return []

      const savedRows = await clearLnkGeneratedWeldData()
      if (!Array.isArray(savedRows)) throw new Error('Не удалось очистить данные ЛНК')
      return savedRows as unknown as WeldRow[]
    },
    onSuccess: async (savedRows) => {
      highlightChangedRows(savedRows, [...lnkGeneratedFieldKeys, 'finalStatus'])
      setSelectedLnkIds(new Set())
      setLnkResultDraft(createDefaultLnkResultDraft(defaultLnkConclusionNaming))
      setMessage(savedRows.length > 0 ? `Очищены результаты и заключения ЛНК: ${savedRows.length} строк` : 'В ЛНК нечего очищать')
      await invalidateWeldJoints(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  return {
    lnkResultMutation,
    clearLnkGeneratedDataMutation,
  }
}
