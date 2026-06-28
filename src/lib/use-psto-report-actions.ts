import { createPstoRequestActionHandlers } from '@/lib/psto-request-action-handlers'
import { createPstoResultActionHandlers } from '@/lib/psto-result-action-handlers'
import type { UsePstoReportActionsOptions } from '@/lib/psto-report-action-types'

export function usePstoReportActions(options: UsePstoReportActionsOptions) {
  const requestHandlers = createPstoRequestActionHandlers(options)
  const resultHandlers = createPstoResultActionHandlers(options)

  return {
    ...requestHandlers,
    ...resultHandlers,
  }
}
