import { useMutation, useQueryClient } from '@tanstack/react-query'
import { acceptDispatcherWarning } from '@/server/dispatcher-warnings'
import type { DispatcherTask } from '@/lib/dispatcher-types'
import {
  DISPATCHER_TASK_SNAPSHOT_QUERY_KEY,
  WELD_JOINT_PAGES_QUERY_KEY,
} from '@/lib/weld-query-utils'

type UseDispatcherAcceptedWarningsInput = {
  setMessage: (message: string | null) => void
}

export function useDispatcherAcceptedWarnings({ setMessage }: UseDispatcherAcceptedWarningsInput) {
  const queryClient = useQueryClient()

  const acceptWarningMutation = useMutation({
    mutationFn: async (task: DispatcherTask) =>
      acceptDispatcherWarning({
        data: {
          key: task.key,
          kind: task.kind,
          title: getDispatcherTaskTitle(task),
        },
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: DISPATCHER_TASK_SNAPSHOT_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: WELD_JOINT_PAGES_QUERY_KEY }),
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

function getDispatcherTaskTitle(task: DispatcherTask) {
  if ('title' in task) return task.title
  if (task.kind === 'welder-stamp-expiry') return `Клеймо ${task.naksStamp}: срок ${task.permitKind === 'dls' ? 'ДЛС' : 'НАКС'}`
  return task.kind
}
