import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { acceptDispatcherWarning, listDispatcherAcceptedWarnings } from '@/server/dispatcher-warnings'
import type { DispatcherTask } from '@/lib/dispatcher-types'

type UseDispatcherAcceptedWarningsInput = {
  setMessage: (message: string | null) => void
}

export function useDispatcherAcceptedWarnings({ setMessage }: UseDispatcherAcceptedWarningsInput) {
  const queryClient = useQueryClient()
  const acceptedWarningsQuery = useQuery({
    queryKey: ['dispatcher-accepted-warnings'],
    queryFn: async () => listDispatcherAcceptedWarnings(),
  })

  const acceptedDispatcherWarningKeys = useMemo(
    () => new Set((acceptedWarningsQuery.data ?? []).map((warning) => warning.key)),
    [acceptedWarningsQuery.data],
  )

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
      await queryClient.invalidateQueries({ queryKey: ['dispatcher-accepted-warnings'] })
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  async function acceptDispatcherTaskWarning(task: DispatcherTask) {
    await acceptWarningMutation.mutateAsync(task)
  }

  return {
    acceptedDispatcherWarningKeys,
    acceptDispatcherTaskWarning,
    isAcceptingDispatcherWarning: acceptWarningMutation.isPending,
  }
}

function getDispatcherTaskTitle(task: DispatcherTask) {
  if ('title' in task) return task.title
  if (task.kind === 'welder-stamp-expiry') return `Клеймо ${task.naksStamp}: срок НАКС`
  return task.kind
}
