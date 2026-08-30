import { useMutation, useQueryClient } from '@tanstack/react-query'

import type { WeldRow } from '@/lib/dispatcher-types'
import { invalidateWeldJoints } from '@/lib/weld-query-utils'
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
  return useMutation({
    mutationFn: async (payload: CorrectPreHeatTreatmentLnkResultPayload) =>
      correctPreHeatTreatmentLnkResult({ data: payload }) as Promise<WeldRow>,
    onSuccess: async (row, variables) => {
      await invalidateWeldJoints(queryClient, { upsertRows: [row] })
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
