import { useMutation, useQueryClient } from '@tanstack/react-query'
import { PSTO_EMPTY_RESULT_VALUE } from '@/lib/report-config'
import {
  createDefaultPstoResultDraft,
} from '@/lib/report-draft-state'
import {
  type PstoResultCorrectionAction,
} from '@/lib/psto-field-updates'
import {
  buildHeatTreatmentFieldRow,
  buildPstoResultCorrectionRow,
  buildPstoResultRows,
} from '@/lib/psto-report-mutation-updates'
import {
  getPstoFieldHighlightFields,
  PSTO_RESULT_HIGHLIGHT_FIELDS,
} from '@/lib/psto-report-mutation-highlight-fields'
import { invalidateWeldJoints } from '@/lib/weld-query-utils'
import { updateWeldRowOrThrow, updateWeldRowsOrThrow } from '@/lib/weld-save-utils'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { RowWithId, UsePstoReportMutationsOptions } from '@/lib/psto-report-mutation-types'

export function usePstoResultMutations({
  setMessage,
  highlightChangedRows,
  setIsPstoResultModalOpen,
  setPstoResultDraft,
  setHeatTreatmentFieldEditing,
}: UsePstoReportMutationsOptions) {
  const queryClient = useQueryClient()

  const pstoResultMutation = useMutation({
    mutationFn: async ({
      records,
      pstoDate,
      result,
      diagramName,
      rows,
    }: {
      records: RowWithId[]
      pstoDate: string
      result: string
      diagramName: string
      rows: RowWithId[]
    }) => {
      const updatedRecords = buildPstoResultRows({ records, pstoDate, result, diagramName, rows })
      const savedRows = await updateWeldRowsOrThrow(updatedRecords)
      return savedRows as unknown as WeldRow[]
    },
    onSuccess: async (savedRows, variables) => {
      highlightChangedRows(savedRows, [...PSTO_RESULT_HIGHLIGHT_FIELDS])
      setMessage(
        variables.result === PSTO_EMPTY_RESULT_VALUE
          ? `Результат ПСТО аннулирован для стыков: ${savedRows.length}`
          : `Результат ПСТО внесен для стыков: ${savedRows.length}`,
      )
      setIsPstoResultModalOpen(false)
      setPstoResultDraft(createDefaultPstoResultDraft())
      await invalidateWeldJoints(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const pstoResultCorrectionMutation = useMutation({
    mutationFn: async ({
      record,
      action,
      diagramName,
    }: {
      record: RowWithId
      action: PstoResultCorrectionAction
      diagramName?: string
    }) => {
      const updatedRecord = buildPstoResultCorrectionRow({ record, action, diagramName })

      const saved = await updateWeldRowOrThrow(updatedRecord)
      return saved as unknown as WeldRow
    },
    onSuccess: async (saved, variables) => {
      highlightChangedRows(saved ? [saved] : [], [...PSTO_RESULT_HIGHLIGHT_FIELDS])
      setMessage(variables.action === 'deleteResult' ? 'Результат ПСТО удален' : 'Диаграмма ПСТО переименована')
      await invalidateWeldJoints(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const heatTreatmentFieldMutation = useMutation({
    mutationFn: async ({
      record,
      fieldKey,
      value,
      rows,
    }: {
      record: RowWithId
      fieldKey: WeldFieldKey
      value: string | null
      rows: RowWithId[]
    }) => {
      const updatedRecord = buildHeatTreatmentFieldRow({ record, fieldKey, value, rows })
      const saved = await updateWeldRowOrThrow(updatedRecord)
      return saved as unknown as WeldRow
    },
    onSuccess: async (saved, variables) => {
      highlightChangedRows(saved ? [saved] : [], getPstoFieldHighlightFields(variables.fieldKey))
      setMessage(`${variables.fieldKey === 'pstoDate' ? 'Дата ПСТО' : 'Поле ПСТО'} обновлено`)
      setHeatTreatmentFieldEditing(null)
      await invalidateWeldJoints(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  return {
    pstoResultMutation,
    pstoResultCorrectionMutation,
    heatTreatmentFieldMutation,
  }
}
