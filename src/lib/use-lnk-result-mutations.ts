import { useMutation, useQueryClient } from '@tanstack/react-query'
import { clearLnkGeneratedWeldData } from '@/server/welds'
import {
  LNK_EMPTY_RESULT_VALUE,
  LNK_GENERATED_FIELD_KEYS as lnkGeneratedFieldKeys,
} from '@/lib/report-config'
import {
  getLnkConclusionHighlightFields,
  getLnkResultHighlightFields,
  getLnkResultReplacementHighlightFields,
} from '@/lib/lnk-report-mutation-highlight-fields'
import {
  buildClearLnkGeneratedRows,
  buildLnkConclusionCorrectionRows,
  buildLnkFieldRow,
  buildLnkOfficialityRows,
  buildLnkResultCorrectionRow,
  buildLnkResultReplacementRows,
  buildLnkResultRows,
} from '@/lib/lnk-report-mutation-updates'
import { getManagedLnkResultChangeKey } from '@/lib/lnk-result-draft'
import {
  createDefaultLnkOfficialityDraft,
  createDefaultLnkResultDraft,
} from '@/lib/report-draft-state'
import { invalidateWeldJoints } from '@/lib/weld-query-utils'
import { updateWeldRowOrThrow, updateWeldRowsOrThrow } from '@/lib/weld-save-utils'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { RowWithId, UseLnkReportMutationsOptions } from '@/lib/lnk-report-mutation-types'

export function useLnkResultMutations({
  lnkRequestOptions,
  setMessage,
  highlightChangedRows,
  setSelectedLnkIds,
  setIsLnkResultModalOpen,
  setLnkResultDraft,
  setLnkOfficialityDraft,
  setIsLnkOfficialityModalOpen,
  resetDismissedRepeatedJointTasks,
  setManagedLnkPendingResultChanges,
  setManagedLnkResultChangeHint,
  setManagedLnkResultPreview,
  setHeatTreatmentFieldEditing,
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
      setMessage(
        changedResults.every((result) => result === LNK_EMPTY_RESULT_VALUE)
          ? `Результат ЛНК очищен для стыков: ${savedRows.length}`
          : `Результат ЛНК внесен для стыков: ${savedRows.length}`,
      )
      setIsLnkResultModalOpen(false)
      setLnkResultDraft(createDefaultLnkResultDraft())
      await invalidateWeldJoints(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const lnkOfficialityMutation = useMutation({
    mutationFn: async ({
      records,
      status,
    }: {
      records: RowWithId[]
      status: 'official' | 'unofficial'
    }) => {
      const updatedRecords = buildLnkOfficialityRows({ records, status })

      if (updatedRecords.length === 0) throw new Error('Выбранные стыки уже имеют такой статус')

      const savedRows = await updateWeldRowsOrThrow(updatedRecords)
      return savedRows as unknown as WeldRow[]
    },
    onSuccess: async (savedRows, variables) => {
      highlightChangedRows(savedRows, ['status'])
      resetDismissedRepeatedJointTasks()
      setMessage(
        variables.status === 'unofficial'
          ? `Статус "неофициальный" установлен для стыков: ${savedRows.length}`
          : `Статус "официальный" установлен для стыков: ${savedRows.length}`,
      )
      setLnkOfficialityDraft(createDefaultLnkOfficialityDraft())
      setIsLnkOfficialityModalOpen(false)
      await invalidateWeldJoints(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const lnkResultCorrectionMutation = useMutation({
    mutationFn: async ({
      record,
      methodKey,
      result,
    }: {
      record: RowWithId
      methodKey: WeldFieldKey
      result: string | null
    }) => {
      const updatedRecord = buildLnkResultCorrectionRow({ record, methodKey, result })
      const saved = await updateWeldRowOrThrow(updatedRecord)
      return saved as unknown as WeldRow
    },
    onSuccess: async (saved, variables) => {
      highlightChangedRows(saved ? [saved] : [], getLnkResultHighlightFields(variables.methodKey))
      setMessage(variables.result ? 'Результат ЛНК изменен' : 'Результат ЛНК удален')
      await invalidateWeldJoints(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const lnkResultReplacementMutation = useMutation({
    mutationFn: async ({
      updates,
    }: {
      updates: Array<{ record: RowWithId; methodKey: WeldFieldKey; result: string }>
    }) => {
      const updatedRecords = buildLnkResultReplacementRows({ updates })

      const savedRows = await updateWeldRowsOrThrow(updatedRecords)
      return savedRows as unknown as WeldRow[]
    },
    onSuccess: async (savedRows, variables) => {
      highlightChangedRows(savedRows, getLnkResultReplacementHighlightFields(variables.updates))
      const savedKeys = new Set(variables.updates.map(({ record, methodKey }) => getManagedLnkResultChangeKey(record.id, methodKey)))
      setManagedLnkPendingResultChanges((current) =>
        Object.fromEntries(Object.entries(current).filter(([changeKey]) => !savedKeys.has(changeKey))),
      )
      setManagedLnkResultChangeHint(null)
      setManagedLnkResultPreview(null)
      setMessage(`Результат ЛНК изменен для стыков: ${savedRows.length}`)
      await invalidateWeldJoints(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const lnkConclusionCorrectionMutation = useMutation({
    mutationFn: async ({
      records,
      methodKey,
      conclusionName,
    }: {
      records: RowWithId[]
      methodKey: WeldFieldKey
      conclusionName: string
    }) => {
      const updatedRecords = buildLnkConclusionCorrectionRows({ records, methodKey, conclusionName })

      if (updatedRecords.length === 0) throw new Error('Нет результатов для переименования заключения')

      const savedRows = await updateWeldRowsOrThrow(updatedRecords)
      return savedRows as unknown as WeldRow[]
    },
    onSuccess: async (savedRows, variables) => {
      highlightChangedRows(savedRows, getLnkConclusionHighlightFields(variables.methodKey))
      setMessage(`Заключение переименовано для позиций: ${savedRows.length}`)
      await invalidateWeldJoints(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

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
      setLnkResultDraft(createDefaultLnkResultDraft())
      setMessage(savedRows.length > 0 ? `Очищены результаты и заключения ЛНК: ${savedRows.length} строк` : 'В ЛНК нечего очищать')
      await invalidateWeldJoints(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  return {
    lnkResultMutation,
    lnkOfficialityMutation,
    lnkResultCorrectionMutation,
    lnkResultReplacementMutation,
    lnkConclusionCorrectionMutation,
    lnkFieldMutation,
    clearLnkGeneratedDataMutation,
  }
}
