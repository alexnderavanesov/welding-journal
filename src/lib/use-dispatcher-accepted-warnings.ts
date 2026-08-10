import { useMutation, useQueryClient } from '@tanstack/react-query'
import { acceptDispatcherWarning } from '@/server/dispatcher-warnings'
import type { DispatcherTask } from '@/lib/dispatcher-types'
import { getDispatcherTaskCode } from '@/lib/dispatcher-settings'
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
          code: getDispatcherTaskCode(task),
          title: getDispatcherTaskTitle(task),
          context: getDispatcherTaskContext(task),
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

function getDispatcherTaskContext(task: DispatcherTask) {
  if (task.kind === 'welder-stamp-expiry') {
    return [
      `Клеймо: ${task.naksStamp}`,
      `Допуск: ${task.permitKind === 'dls' ? 'ДЛС' : 'НАКС'}`,
      `Действует до: ${task.validTo || 'без даты'}`,
    ].join(' · ')
  }
  if (task.kind === 'percentage-line-control') {
    return [
      task.projectTitle ? `Проект: ${task.projectTitle}` : '',
      task.subtitleCode ? `Шифр: ${task.subtitleCode}` : '',
      task.line ? `Линия: ${task.line}` : '',
      task.stamp ? `Клеймо: ${task.stamp}` : '',
    ].filter(Boolean).join(' · ')
  }
  if (task.kind === 'line-consistency') {
    return [
      task.projectTitle ? `Проект: ${task.projectTitle}` : '',
      task.subtitleCode ? `Шифр: ${task.subtitleCode}` : '',
      task.line ? `Линия: ${task.line}` : '',
      task.fieldLabel ? `Проверка: ${task.fieldLabel}` : '',
    ].filter(Boolean).join(' · ')
  }
  const row = task.row
  return [
    row.projectTitle ? `Проект: ${row.projectTitle}` : '',
    row.subtitleCode ? `Шифр: ${row.subtitleCode}` : '',
    row.line ? `Линия: ${row.line}` : '',
    row.joint ? `Стык: ${row.joint}` : '',
  ].filter(Boolean).join(' · ')
}

function getDispatcherTaskTitle(task: DispatcherTask) {
  if ('title' in task) return task.title
  if (task.kind === 'welder-stamp-expiry') return `Клеймо ${task.naksStamp}: срок ${task.permitKind === 'dls' ? 'ДЛС' : 'НАКС'}`
  return task.kind
}
