import { useMutation, useQueryClient } from '@tanstack/react-query'
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
import type { SystemDocumentCreationGroup } from '@/lib/system-document-creation-plan'

export function usePstoResultMutations({
  setMessage,
  highlightChangedRows,
  setIsPstoResultModalOpen,
  setPstoResultDraft,
  setHeatTreatmentFieldEditing,
  defaultPstoConclusionNaming,
  onWorkflowCorrectionSaved,
}: UsePstoReportMutationsOptions) {
  const queryClient = useQueryClient()

  const pstoResultMutation = useMutation({
    mutationFn: async ({
      records,
      pstoDate,
      result,
      diagramName,
      rows,
      useSystemName,
      documentGroups,
    }: {
      records: RowWithId[]
      pstoDate: string
      result: string
      diagramName: string
      rows: RowWithId[]
      useSystemName?: boolean
      documentGroups?: SystemDocumentCreationGroup[]
    }) => {
      const groups = documentGroups ?? [{
        key: 'legacy',
        label: 'Все выбранные позиции',
        rowIds: records.map((record) => record.id),
        rows: records as WeldRow[],
        name: diagramName,
        useSystemName: Boolean(useSystemName),
        isMissingValueFallback: false,
      }]
      const updatedRecords = groups.flatMap((group) =>
        buildPstoResultRows({
          records: group.rows,
          pstoDate,
          result,
          diagramName: group.name,
          rows,
        }),
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
                type: 'pstoConclusion',
                date: pstoDate,
                fieldKeys: ['heatTreatmentDiagram'],
                provisionalName: group.name,
              })),
        },
      )
      return savedRows as unknown as WeldRow[]
    },
    onSuccess: async (savedRows) => {
      highlightChangedRows(savedRows, [...PSTO_RESULT_HIGHLIGHT_FIELDS])
      setMessage(`Результат ПСТО внесен для стыков: ${savedRows.length}`)
      setIsPstoResultModalOpen(false)
      setPstoResultDraft(createDefaultPstoResultDraft(defaultPstoConclusionNaming))
      await invalidateWeldJoints(queryClient, { upsertRows: savedRows })
      await queryClient.invalidateQueries({ queryKey: ['system-document-sequences'] })
      onWorkflowCorrectionSaved?.()
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

      const saved = await updateWeldRowOrThrow(
        updatedRecord,
        'Не удалось изменить результат ПСТО',
        { mutationScope: 'psto' },
      )
      return saved as unknown as WeldRow
    },
    onSuccess: async (saved, variables) => {
      highlightChangedRows(saved ? [saved] : [], [...PSTO_RESULT_HIGHLIGHT_FIELDS])
      setMessage(variables.action === 'deleteResult' ? 'Результат ПСТО удален' : 'Диаграмма ПСТО переименована')
      await invalidateWeldJoints(queryClient, { upsertRows: [saved] })
      onWorkflowCorrectionSaved?.()
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
      const saved = await updateWeldRowOrThrow(
        updatedRecord,
        'Не удалось обновить поле ПСТО',
        { mutationScope: 'psto' },
      )
      return saved as unknown as WeldRow
    },
    onSuccess: async (saved, variables) => {
      highlightChangedRows(saved ? [saved] : [], getPstoFieldHighlightFields(variables.fieldKey))
      setMessage(`${variables.fieldKey === 'pstoDate' ? 'Дата ПСТО' : 'Поле ПСТО'} обновлено`)
      setHeatTreatmentFieldEditing(null)
      await invalidateWeldJoints(queryClient, { upsertRows: [saved] })
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
