import { useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useConfirmAction } from '@/lib/confirm-action-context'
import type { WeldRow } from '@/lib/dispatcher-types'
import { useSecurityGuard } from '@/lib/security-context'
import { scheduleWeldDataRefresh } from '@/lib/weld-query-utils'
import { getExpectedWeldRowVersions } from '@/lib/weld-save-utils'
import { changeLayeredControl } from '@/server/line-program-control'

export type LayeredControlRemovalFeedback = {
  rowId: number
  tone: 'success' | 'error'
  message: string
}

export function useLayeredControlRemoval() {
  const queryClient = useQueryClient()
  const confirmAction = useConfirmAction()
  const { requireEditPassword } = useSecurityGuard()
  const inFlight = useRef(false)
  const mutation = useMutation({
    retry: false,
    mutationFn: async (row: WeldRow) => {
      if (!await confirmAction({
        title: 'Убрать послойный контроль?',
        itemName: `${row.line || 'Без линии'} · ${row.joint || row.id}`,
        description: 'Будут сняты послойная отметка и четыре заключения: ВИК и ПВК кромок и слоёв. Обычный результат ПВК, его дата, заявка и заключение сохранятся.',
        warning: 'Действие применяется сразу после подтверждения, только к этому стыку.',
        confirmLabel: 'Убрать послойный контроль',
        tone: 'warning',
      })) return null
      if (!await requireEditPassword('удаление послойного комплекта')) return null
      return changeLayeredControl({ data: {
        targets: getExpectedWeldRowVersions([row]),
        assigned: false,
        confirmedRemoval: true,
      } })
    },
    onSuccess: (rows) => {
      if (rows) scheduleWeldDataRefresh(queryClient, { upsertRows: rows })
    },
    onSettled: () => { inFlight.current = false },
  })
  const feedback: LayeredControlRemovalFeedback | null = mutation.variables && mutation.error
    ? { rowId: mutation.variables.id, tone: 'error', message: mutation.error.message }
    : mutation.variables && mutation.data
      ? { rowId: mutation.variables.id, tone: 'success', message: 'Послойный контроль убран. Обычный результат ПВК, его заявка и заключение сохранены.' }
      : null

  return {
    isPending: mutation.isPending,
    feedback,
    remove: (row: WeldRow) => {
      if (inFlight.current || !row.layeredControlAssigned) return
      inFlight.current = true
      mutation.mutate(row)
    },
  }
}
