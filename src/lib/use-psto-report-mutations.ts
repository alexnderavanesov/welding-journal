import { useMutation, useQueryClient } from '@tanstack/react-query'
import { PSTO_EMPTY_RESULT_VALUE } from '@/lib/report-config'
import {
  createDefaultPstoResultDraft,
} from '@/lib/report-draft-state'
import { formatRequestCreatedMessage } from '@/lib/report-naming'
import {
  defaultRequestNamingState,
} from '@/lib/request-naming-state'
import {
  type PstoRequestManagerAction,
  type PstoResultCorrectionAction,
} from '@/lib/psto-field-updates'
import {
  buildHeatTreatmentFieldRow,
  buildPstoRequestCorrectionRow,
  buildPstoRequestManagerRows,
  buildPstoRequestRows,
  buildPstoResultCorrectionRow,
  buildPstoResultRows,
} from '@/lib/psto-report-mutation-updates'
import { invalidateWeldJoints } from '@/lib/weld-query-utils'
import { updateWeldRowOrThrow, updateWeldRowsOrThrow } from '@/lib/weld-save-utils'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { RowWithId, UsePstoReportMutationsOptions } from '@/lib/psto-report-mutation-types'

export function usePstoReportMutations({
  rows,
  heatTreatmentRows,
  pstoRequestOptions,
  setMessage,
  highlightChangedRows,
  setSelectedHeatTreatmentIds,
  setPstoRequestNaming,
  setPstoRequestSearch,
  setIsPstoRequestModalOpen,
  setIsPstoResultModalOpen,
  setPstoResultDraft,
  setManagedPstoRequestName,
  setManagedPstoRequestNameDraft,
  setIsPstoRequestManagerOpen,
  setHeatTreatmentFieldEditing,
}: UsePstoReportMutationsOptions) {
  const queryClient = useQueryClient()

  const pstoRequestMutation = useMutation({
    mutationFn: async ({
      records,
      requestName,
    }: {
      records: RowWithId[]
      requestName: string
      mode?: 'create' | 'edit'
    }) => {
      const updatedRecords = buildPstoRequestRows({ records, requestName })
      const savedRows = await updateWeldRowsOrThrow(updatedRecords)
      return savedRows
    },
    onSuccess: async (_result, variables) => {
      highlightChangedRows(_result, ['pstoRequest', 'pstoCreatedAt'])
      setMessage(
        variables.mode === 'edit'
          ? 'Заявка ПСТО обновлена'
          : formatRequestCreatedMessage(variables.requestName, variables.records.length),
      )
      setSelectedHeatTreatmentIds(new Set())
      setPstoRequestNaming(defaultRequestNamingState)
      setPstoRequestSearch('')
      setIsPstoRequestModalOpen(false)
      await invalidateWeldJoints(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

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
      highlightChangedRows(savedRows, ['pstoDate', 'pstoResult', 'heatTreatmentDiagram', 'pstoCreatedAt'])
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

  const pstoRequestManagerMutation = useMutation({
    mutationFn: async ({
      requestName,
      nextRequestName,
      action,
    }: {
      requestName: string
      nextRequestName?: string
      action: PstoRequestManagerAction
    }) => {
      const currentName = requestName.trim()
      const renamedName = nextRequestName?.trim() ?? ''
      if (!currentName) throw new Error('Выберите заявку ПСТО')
      if (action === 'rename') {
        if (!renamedName) throw new Error('Введите новое наименование заявки')
        if (renamedName === currentName) throw new Error('Новое наименование совпадает с текущим')
        if (pstoRequestOptions.includes(renamedName)) throw new Error('Заявка с таким наименованием уже существует')
      }

      const updatedRecords = buildPstoRequestManagerRows({
        heatTreatmentRows,
        requestName: currentName,
        nextRequestName: renamedName,
        action,
      })

      if (updatedRecords.length === 0) throw new Error('Заявка ПСТО не найдена')

      const savedRows = await updateWeldRowsOrThrow(updatedRecords)
      return savedRows as unknown as WeldRow[]
    },
    onSuccess: async (savedRows, variables) => {
      highlightChangedRows(savedRows, ['pstoRequest', 'pstoDate', 'pstoResult', 'heatTreatmentDiagram', 'pstoCreatedAt'])
      setMessage(
        variables.action === 'rename'
          ? `Заявка ${variables.requestName} переименована в ${variables.nextRequestName}`
          : `Заявка ${variables.requestName} удалена`,
      )
      if (variables.action === 'rename' && variables.nextRequestName) {
        setManagedPstoRequestName(variables.nextRequestName)
        setManagedPstoRequestNameDraft(variables.nextRequestName)
      } else {
        setManagedPstoRequestName('')
        setManagedPstoRequestNameDraft('')
        setIsPstoRequestManagerOpen(false)
      }
      await invalidateWeldJoints(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const pstoRequestCorrectionMutation = useMutation({
    mutationFn: async ({ record }: { record: RowWithId }) => {
      const updatedRecord = buildPstoRequestCorrectionRow(record)

      const saved = await updateWeldRowOrThrow(updatedRecord)
      return saved as unknown as WeldRow
    },
    onSuccess: async (saved, variables) => {
      const removedRequestName = String(variables.record.pstoRequest ?? '').trim()
      highlightChangedRows(saved ? [saved] : [], ['pstoRequest', 'pstoDate', 'pstoResult', 'heatTreatmentDiagram', 'pstoCreatedAt'])
      const hasRemainingRequestPositions = heatTreatmentRows.some((row) => row.id !== variables.record.id && String(row.pstoRequest ?? '').trim() === removedRequestName)
      if (removedRequestName && !hasRemainingRequestPositions) {
        setManagedPstoRequestName('')
        setManagedPstoRequestNameDraft('')
        setMessage(`Заявка ${removedRequestName} удалена, так как в ней не осталось стыков`)
      } else {
        setMessage('Позиция заявки ПСТО удалена')
      }
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
      highlightChangedRows(saved ? [saved] : [], ['pstoDate', 'pstoResult', 'heatTreatmentDiagram', 'pstoCreatedAt'])
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
      highlightChangedRows(saved ? [saved] : [], [variables.fieldKey])
      setMessage(`${variables.fieldKey === 'pstoDate' ? 'Дата ПСТО' : 'Поле ПСТО'} обновлено`)
      setHeatTreatmentFieldEditing(null)
      await invalidateWeldJoints(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  return {
    pstoRequestMutation,
    pstoResultMutation,
    pstoRequestManagerMutation,
    pstoRequestCorrectionMutation,
    pstoResultCorrectionMutation,
    heatTreatmentFieldMutation,
  }
}
