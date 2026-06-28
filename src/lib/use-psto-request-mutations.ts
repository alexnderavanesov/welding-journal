import { useMutation, useQueryClient } from '@tanstack/react-query'
import { formatRequestCreatedMessage } from '@/lib/report-naming'
import { defaultRequestNamingState } from '@/lib/request-naming-state'
import {
  type PstoRequestManagerAction,
} from '@/lib/psto-field-updates'
import {
  buildPstoRequestCorrectionRow,
  buildPstoRequestManagerRows,
  buildPstoRequestRows,
} from '@/lib/psto-report-mutation-updates'
import {
  PSTO_GENERATED_HIGHLIGHT_FIELDS,
  PSTO_REQUEST_HIGHLIGHT_FIELDS,
} from '@/lib/psto-report-mutation-highlight-fields'
import { invalidateWeldJoints } from '@/lib/weld-query-utils'
import { updateWeldRowOrThrow, updateWeldRowsOrThrow } from '@/lib/weld-save-utils'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { RowWithId, UsePstoReportMutationsOptions } from '@/lib/psto-report-mutation-types'

export function usePstoRequestMutations({
  heatTreatmentRows,
  pstoRequestOptions,
  setMessage,
  highlightChangedRows,
  setSelectedHeatTreatmentIds,
  setPstoRequestNaming,
  setPstoRequestSearch,
  setIsPstoRequestModalOpen,
  setManagedPstoRequestName,
  setManagedPstoRequestNameDraft,
  setIsPstoRequestManagerOpen,
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
      highlightChangedRows(_result, [...PSTO_REQUEST_HIGHLIGHT_FIELDS])
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
      highlightChangedRows(savedRows, [...PSTO_GENERATED_HIGHLIGHT_FIELDS])
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
      highlightChangedRows(saved ? [saved] : [], [...PSTO_GENERATED_HIGHLIGHT_FIELDS])
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

  return {
    pstoRequestMutation,
    pstoRequestManagerMutation,
    pstoRequestCorrectionMutation,
  }
}
