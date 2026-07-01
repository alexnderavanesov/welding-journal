import { createPstoRequestActionHandlers } from '@/lib/psto-request-action-handlers'
import { createPstoResultActionHandlers } from '@/lib/psto-result-action-handlers'
import { useConfirmAction } from '@/lib/confirm-action-context'
import type { UsePstoReportActionsOptions } from '@/lib/psto-report-action-types'

export function usePstoReportActions(options: Omit<UsePstoReportActionsOptions, 'confirmAction'>) {
  const confirmAction = useConfirmAction()
  const actionOptions = { ...options, confirmAction }
  const requestHandlers = createPstoRequestActionHandlers(actionOptions)
  const resultHandlers = createPstoResultActionHandlers(actionOptions)

  return {
    ...requestHandlers,
    ...resultHandlers,
  }
}
