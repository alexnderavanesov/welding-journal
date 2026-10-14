import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useConfirmAction } from './confirm-action-context'
import { withSpecialistCorrectionConfirmation } from './specialist-correction-confirmation'

import type { WeldRow } from '@/lib/dispatcher-types'
import type { PstoCycleStage } from '@/lib/psto-cycle-corrections'
import { scheduleWeldDataRefresh } from '@/lib/weld-query-utils'
import {
  correctPstoCycleStage,
  correctPstoTvmtAndRemoveLaterCycles,
  type CorrectPstoCycleStagePayload,
  type CorrectPstoTvmtAndRemoveLaterCyclesPayload,
} from '@/server/psto-repeat-workflow'

export function usePstoCycleCorrectionMutation({
  setMessage,
  onSaved,
}: {
  setMessage: (message: string) => void
  onSaved: (row: WeldRow, stage: PstoCycleStage) => void
}) {
  const queryClient = useQueryClient()
  const confirm = useConfirmAction()
  return useMutation({
    mutationFn: async (payload: CorrectPstoCycleStagePayload) =>
      withSpecialistCorrectionConfirmation(confirmation => correctPstoCycleStage({ data: { ...payload, specialistCorrectionConfirmation: confirmation } }) as Promise<WeldRow>, confirm),
    onSuccess: async (row, variables) => {
      scheduleWeldDataRefresh(queryClient, { upsertRows: [row] })
      onSaved(row, variables.stage)
      setMessage(variables.action === 'delete'
        ? 'Последний этап цикла ПСТО/ТВМТ удален.'
        : 'Этап цикла ПСТО/ТВМТ обновлен.')
    },
    onError: (error) => setMessage((error as Error).message),
  })
}

export function usePstoTvmtCorrectionWithLaterCycleRemovalMutation({
  setMessage,
  onSaved,
}: {
  setMessage: (message: string) => void
  onSaved: (row: WeldRow) => void
}) {
  const queryClient = useQueryClient()
  const confirm = useConfirmAction()
  return useMutation({
    mutationFn: async (payload: CorrectPstoTvmtAndRemoveLaterCyclesPayload) =>
      withSpecialistCorrectionConfirmation(confirmation => correctPstoTvmtAndRemoveLaterCycles({ data: { ...payload, specialistCorrectionConfirmation: confirmation } }) as Promise<WeldRow>, confirm),
    onSuccess: async (row) => {
      scheduleWeldDataRefresh(queryClient, { upsertRows: [row] })
      onSaved(row)
      setMessage('Результат ТВМТ исправлен, последующие циклы ПСТО/ТВМТ удалены.')
    },
    onError: (error) => setMessage((error as Error).message),
  })
}
