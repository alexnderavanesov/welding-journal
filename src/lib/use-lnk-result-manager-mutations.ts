import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useConfirmAction } from './confirm-action-context'
import { withSpecialistCorrectionConfirmation } from './specialist-correction-confirmation'
import {
  getLnkConclusionHighlightFields,
  getLnkResultReplacementHighlightFields,
} from '@/lib/lnk-report-mutation-highlight-fields'
import {
  buildLnkConclusionCorrectionRows,
  buildLnkResultReplacementRows,
} from '@/lib/lnk-report-mutation-updates'
import { getManagedLnkResultChangeKey } from '@/lib/lnk-result-draft'
import { scheduleWeldDataRefresh } from '@/lib/weld-query-utils'
import { updateWeldRowsOrThrow } from '@/lib/weld-save-utils'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { RowWithId, UseLnkReportMutationsOptions } from '@/lib/lnk-report-mutation-types'

export function useLnkResultManagerMutations({
  setMessage,
  highlightChangedRows,
  setManagedLnkPendingResultChanges,
  setManagedLnkResultChangeHint,
  onWorkflowCorrectionSaved,
}: UseLnkReportMutationsOptions) {
  const queryClient = useQueryClient()
  const confirm = useConfirmAction()

  const lnkResultReplacementMutation = useMutation({
    mutationFn: async ({
      updates,
    }: {
      updates: Array<{ record: RowWithId; methodKey: WeldFieldKey; result: string | null }>
    }) => {
      const updatedRecords = buildLnkResultReplacementRows({ updates })

      const savedRows = await withSpecialistCorrectionConfirmation(confirmation => updateWeldRowsOrThrow(
        updatedRecords,
        'Не удалось сохранить изменения результатов ЛНК',
        { mutationScope: 'lnk', specialistCorrectionConfirmation: confirmation },
      ), confirm)
      return savedRows as unknown as WeldRow[]
    },
    onSuccess: async (savedRows, variables) => {
      highlightChangedRows(savedRows, getLnkResultReplacementHighlightFields(variables.updates))
      const savedKeys = new Set(variables.updates.map(({ record, methodKey }) => getManagedLnkResultChangeKey(record.id, methodKey)))
      setManagedLnkPendingResultChanges((current) =>
        Object.fromEntries(Object.entries(current).filter(([changeKey]) => !savedKeys.has(changeKey))),
      )
      setManagedLnkResultChangeHint(null)
      setMessage(`Результат ЛНК изменен для стыков: ${savedRows.length}`)
      scheduleWeldDataRefresh(queryClient, { upsertRows: savedRows })
      onWorkflowCorrectionSaved?.()
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
      conclusionDate,
    }: {
      records: RowWithId[]
      methodKey: WeldFieldKey
      conclusionName: string
      conclusionDate?: string
    }) => {
      const updatedRecords = buildLnkConclusionCorrectionRows({ records, methodKey, conclusionName, conclusionDate })

      if (updatedRecords.length === 0) throw new Error('Нет результатов для переименования заключения')

      const savedRows = await withSpecialistCorrectionConfirmation(confirmation => updateWeldRowsOrThrow(
        updatedRecords,
        'Не удалось переименовать заключение ЛНК',
        { mutationScope: 'lnk', specialistCorrectionConfirmation: confirmation },
      ), confirm)
      return savedRows as unknown as WeldRow[]
    },
    onSuccess: async (savedRows, variables) => {
      highlightChangedRows(savedRows, getLnkConclusionHighlightFields(variables.methodKey))
      setMessage(`Реквизиты заключения сохранены для позиций: ${savedRows.length}`)
      scheduleWeldDataRefresh(queryClient, { upsertRows: savedRows })
      onWorkflowCorrectionSaved?.()
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  return {
    lnkResultReplacementMutation,
    lnkConclusionCorrectionMutation,
  }
}
