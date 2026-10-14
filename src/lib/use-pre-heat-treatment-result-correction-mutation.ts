import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useConfirmAction } from './confirm-action-context'
import { withSpecialistCorrectionConfirmation } from './specialist-correction-confirmation'

import type { WeldRow } from '@/lib/dispatcher-types'
import { scheduleWeldDataRefresh } from '@/lib/weld-query-utils'
import {
  correctPreHeatTreatmentLnkResult,
  type CorrectPreHeatTreatmentLnkResultPayload,
} from '@/server/pre-heat-treatment-lnk-workflow'

export function usePreHeatTreatmentResultCorrectionMutation({
  setMessage,
  onSaved,
}: {
  setMessage: (message: string) => void
  onSaved: (row: WeldRow) => void
}) {
  const queryClient = useQueryClient()
  const confirm = useConfirmAction()
  return useMutation({
    mutationFn: async (payload: CorrectPreHeatTreatmentLnkResultPayload) =>
      withSpecialistCorrectionConfirmation(confirmation => correctPreHeatTreatmentLnkResult({ data: { ...payload, specialistCorrectionConfirmation: confirmation } }) as Promise<WeldRow>, confirm),
    onSuccess: async (row, variables) => {
      scheduleWeldDataRefresh(queryClient, { upsertRows: [row] })
      onSaved(row)
      setMessage(variables.stage === 'request'
        ? variables.action === 'delete'
          ? 'Заявка НК до ТО удалена.'
          : 'Заявка НК до ТО обновлена.'
        : variables.action === 'delete'
          ? 'Результат НК до ТО удален; заявка сохранена.'
          : 'Результат НК до ТО обновлен.')
    },
    onError: (error) => setMessage((error as Error).message),
  })
}
