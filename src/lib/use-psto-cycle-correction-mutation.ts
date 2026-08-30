import { useMutation, useQueryClient } from '@tanstack/react-query'

import type { WeldRow } from '@/lib/dispatcher-types'
import type { PstoCycleStage } from '@/lib/psto-cycle-corrections'
import { invalidateWeldJoints } from '@/lib/weld-query-utils'
import {
  correctPstoCycleStage,
  type CorrectPstoCycleStagePayload,
} from '@/server/psto-repeat-workflow'

export function usePstoCycleCorrectionMutation({
  setMessage,
  onSaved,
}: {
  setMessage: (message: string) => void
  onSaved: (row: WeldRow, stage: PstoCycleStage) => void
}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: CorrectPstoCycleStagePayload) =>
      correctPstoCycleStage({ data: payload }) as Promise<WeldRow>,
    onSuccess: async (row, variables) => {
      await invalidateWeldJoints(queryClient, { upsertRows: [row] })
      onSaved(row, variables.stage)
      setMessage(variables.action === 'delete'
        ? 'Последний этап цикла ПСТО/ТВМТ удален.'
        : 'Этап цикла ПСТО/ТВМТ обновлен.')
    },
    onError: (error) => setMessage((error as Error).message),
  })
}
