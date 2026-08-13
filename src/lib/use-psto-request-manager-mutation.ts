import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type PstoRequestManagerAction } from '@/lib/psto-field-updates'
import { buildPstoRequestManagerRows } from '@/lib/psto-report-mutation-updates'
import { PSTO_GENERATED_HIGHLIGHT_FIELDS } from '@/lib/psto-report-mutation-highlight-fields'
import { loadRequestConclusionSettings } from '@/lib/request-conclusion-settings'
import { isSystemDocumentNameForRows } from '@/lib/system-document-types'
import { invalidateWeldJoints } from '@/lib/weld-query-utils'
import { updateWeldRowsOrThrow } from '@/lib/weld-save-utils'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { UsePstoReportMutationsOptions } from '@/lib/psto-report-mutation-types'
import { isSameRequestDocument } from '@/lib/request-document-identity'

export function usePstoRequestManagerMutation({
  heatTreatmentRows,
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
      requestDate,
      nextRequestName,
      action,
    }: {
      requestName: string
      requestDate: string
      nextRequestName?: string
      action: PstoRequestManagerAction
    }) => {
      const currentName = requestName.trim()
      const renamedName = nextRequestName?.trim() ?? ''
      if (!currentName) throw new Error('Выберите заявку ПСТО')
      if (action === 'rename') {
        if (
          isSystemDocumentNameForRows(
            heatTreatmentRows,
            'pstoRequest',
            currentName,
            loadRequestConclusionSettings(),
          )
        ) {
          throw new Error('Системную заявку ПСТО нельзя переименовать')
        }
        if (!renamedName) throw new Error('Введите новое наименование заявки')
        if (renamedName === currentName) throw new Error('Новое наименование совпадает с текущим')
        if (
          heatTreatmentRows.some((row) =>
            isSameRequestDocument(row.pstoRequest, row.pstoRequestDate, {
              name: renamedName,
              date: requestDate,
            }),
          )
        ) {
          throw new Error('Заявка с таким наименованием и датой уже существует')
        }
      }

      const updatedRecords = buildPstoRequestManagerRows({
        heatTreatmentRows,
        requestName: currentName,
        requestDate,
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
      await invalidateWeldJoints(queryClient, { upsertRows: savedRows })
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })
}
