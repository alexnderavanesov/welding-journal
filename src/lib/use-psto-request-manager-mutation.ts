import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type PstoRequestManagerAction } from '@/lib/psto-field-updates'
import { buildPstoRequestManagerRows } from '@/lib/psto-report-mutation-updates'
import { PSTO_GENERATED_HIGHLIGHT_FIELDS } from '@/lib/psto-report-mutation-highlight-fields'
import { isSystemPstoRequestName } from '@/lib/report-request-naming'
import { invalidateWeldJoints } from '@/lib/weld-query-utils'
import { updateWeldRowsOrThrow } from '@/lib/weld-save-utils'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { UsePstoReportMutationsOptions } from '@/lib/psto-report-mutation-types'

export function usePstoRequestManagerMutation({
  heatTreatmentRows,
  pstoRequestOptions,
  setMessage,
  highlightChangedRows,
  setManagedPstoRequestName,
  setManagedPstoRequestNameDraft,
  setIsPstoRequestManagerOpen,
}: UsePstoReportMutationsOptions) {
  const queryClient = useQueryClient()

  return useMutation({
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
        if (isSystemPstoRequestName(currentName)) throw new Error('Системную заявку ПСТО нельзя переименовать')
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
}
