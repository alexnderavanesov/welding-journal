import { useMutation, useQueryClient } from '@tanstack/react-query'
import { acceptDispatcherWarning } from '@/server/dispatcher-warnings'
import type { DispatcherTask } from '@/lib/dispatcher-types'
import {
  DISPATCHER_TASK_SNAPSHOT_QUERY_KEY,
  invalidateWeldPageQueries,
} from '@/lib/weld-query-utils'

type UseDispatcherAcceptedWarningsInput = {
  setMessage: (message: string | null) => void
}

export function useDispatcherAcceptedWarnings({ setMessage }: UseDispatcherAcceptedWarningsInput) {
  const queryClient = useQueryClient()

  const acceptWarningMutation = useMutation({
    mutationFn: async (task: DispatcherTask) =>
      acceptDispatcherWarning({
        data: { key: task.key },
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: DISPATCHER_TASK_SNAPSHOT_QUERY_KEY }),
        invalidateWeldPageQueries(queryClient),
      ])
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  async function acceptDispatcherTaskWarning(task: DispatcherTask) {
    await acceptWarningMutation.mutateAsync(task)
  }

  return {
    acceptDispatcherTaskWarning,
    isAcceptingDispatcherWarning: acceptWarningMutation.isPending,
  }
}
