import { useMutation, useQueryClient } from '@tanstack/react-query'
import { updateWeldJoint } from '@/server/welds'
import type { HeatTreatmentFieldEditingState } from '@/lib/home-state'
import { PSTO_EMPTY_RESULT_VALUE } from '@/lib/report-config'
import {
  createDefaultPstoResultDraft,
  type PstoResultDraftState,
} from '@/lib/report-draft-state'
import { formatRequestCreatedMessage } from '@/lib/report-naming'
import {
  defaultRequestNamingState,
  type RequestNamingState,
} from '@/lib/request-naming-state'
import { hasText } from '@/lib/report-value-utils'
import {
  withAutoHeatTreatmentDiagram,
  withAutoHeatTreatmentDiagrams,
} from '@/lib/psto-status'
import { invalidateWeldJoints } from '@/lib/weld-query-utils'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'

type RowWithId = WeldInput & { id: number }

type UsePstoReportMutationsOptions = {
  rows: RowWithId[]
  heatTreatmentRows: RowWithId[]
  pstoRequestOptions: string[]
  setMessage: (value: string) => void
  highlightChangedRows: (rows: WeldRow[], fieldKeys?: WeldFieldKey[]) => void
  setSelectedHeatTreatmentIds: (value: Set<number>) => void
  setPstoRequestNaming: (value: RequestNamingState) => void
  setPstoRequestSearch: (value: string) => void
  setIsPstoRequestModalOpen: (value: boolean) => void
  setIsPstoResultModalOpen: (value: boolean) => void
  setPstoResultDraft: (value: PstoResultDraftState) => void
  setManagedPstoRequestName: (value: string) => void
  setManagedPstoRequestNameDraft: (value: string) => void
  setIsPstoRequestManagerOpen: (value: boolean) => void
  setHeatTreatmentFieldEditing: (value: HeatTreatmentFieldEditingState | null) => void
}

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
      const pstoUpdatedAt = new Date().toISOString()
      const updatedRecords = records.map((record) => ({ ...record, pstoRequest: requestName, pstoCreatedAt: pstoUpdatedAt }))
      const savedRows = await Promise.all(updatedRecords.map((record) => updateWeldJoint({ data: record })))
      if (!savedRows.every(Boolean)) throw new Error('Не удалось сохранить часть записей')
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
      const shouldClearResult = result === PSTO_EMPTY_RESULT_VALUE
      if (!shouldClearResult && result !== 'проведено') throw new Error('Выберите результат ПСТО')
      if (!shouldClearResult && !pstoDate) throw new Error('Укажите дату ПСТО')
      if (!shouldClearResult && !diagramName.trim()) throw new Error('Укажите наименование диаграммы термообработки')
      if (records.some((record) => !hasText(record.pstoRequest))) throw new Error('Сначала укажите заявку ПСТО')

      const pstoUpdatedAt = new Date().toISOString()
      const proposedRowsById = new Map<number, RowWithId>()
      for (const record of records) {
        proposedRowsById.set(record.id, {
          ...record,
          pstoDate: shouldClearResult ? null : pstoDate,
          pstoResult: shouldClearResult ? null : 'проведено',
          heatTreatmentDiagram: shouldClearResult ? null : diagramName.trim(),
          pstoCreatedAt: pstoUpdatedAt,
        })
      }
      const recalculatedRows = withAutoHeatTreatmentDiagrams(rows.map((row) => proposedRowsById.get(row.id) ?? row))
      const updatedRecords = recalculatedRows.filter((row) => proposedRowsById.has(row.id))
      const savedRows = await Promise.all(updatedRecords.map((record) => updateWeldJoint({ data: record })))
      if (!savedRows.every(Boolean)) throw new Error('Не удалось сохранить часть записей')
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
      action: 'rename' | 'delete'
    }) => {
      const currentName = requestName.trim()
      const renamedName = nextRequestName?.trim() ?? ''
      if (!currentName) throw new Error('Выберите заявку ПСТО')
      if (action === 'rename') {
        if (!renamedName) throw new Error('Введите новое наименование заявки')
        if (renamedName === currentName) throw new Error('Новое наименование совпадает с текущим')
        if (pstoRequestOptions.includes(renamedName)) throw new Error('Заявка с таким наименованием уже существует')
      }

      const pstoUpdatedAt = new Date().toISOString()
      const updatedRecords = heatTreatmentRows.flatMap((record) => {
        if (String(record.pstoRequest ?? '').trim() !== currentName) return []
        const nextRecord = {
          ...record,
          pstoRequest: action === 'rename' ? renamedName : null,
          pstoDate: action === 'rename' ? record.pstoDate : null,
          pstoResult: action === 'rename' ? record.pstoResult : null,
          heatTreatmentDiagram: action === 'rename' ? record.heatTreatmentDiagram : null,
          pstoCreatedAt: pstoUpdatedAt,
        } as RowWithId
        return [nextRecord]
      })

      if (updatedRecords.length === 0) throw new Error('Заявка ПСТО не найдена')

      const savedRows = await Promise.all(updatedRecords.map((record) => updateWeldJoint({ data: record })))
      if (!savedRows.every(Boolean)) throw new Error('Не удалось сохранить часть записей')
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
      const updatedRecord = {
        ...record,
        pstoRequest: null,
        pstoDate: null,
        pstoResult: null,
        heatTreatmentDiagram: null,
        pstoCreatedAt: new Date().toISOString(),
      } as RowWithId

      const saved = await updateWeldJoint({ data: updatedRecord })
      if (!saved) throw new Error('Запись не найдена')
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
      action: 'renameDiagram' | 'deleteResult'
      diagramName?: string
    }) => {
      const nextDiagramName = diagramName?.trim() ?? ''
      if (action === 'renameDiagram' && !nextDiagramName) throw new Error('Укажите наименование диаграммы')
      const updatedRecord = {
        ...record,
        pstoDate: action === 'deleteResult' ? null : record.pstoDate,
        pstoResult: action === 'deleteResult' ? null : record.pstoResult,
        heatTreatmentDiagram: action === 'deleteResult' ? null : nextDiagramName,
        pstoCreatedAt: new Date().toISOString(),
      } as RowWithId

      const saved = await updateWeldJoint({ data: updatedRecord })
      if (!saved) throw new Error('Запись не найдена')
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
      const updatedRecord = withAutoHeatTreatmentDiagram({ ...record, [fieldKey]: value }, rows)
      const saved = await updateWeldJoint({ data: updatedRecord })
      if (!saved) throw new Error('Запись не найдена')
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
