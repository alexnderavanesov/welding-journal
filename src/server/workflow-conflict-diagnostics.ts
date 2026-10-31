import { createServerOnlyFn } from '@tanstack/react-start'
import { WorkflowConflictError } from '@/lib/workflow-conflict'
import { accessContext } from './access-store'

/** Expected rejection, not a stack dump: never log payloads or error messages. */
export const reportWorkflowConflict = createServerOnlyFn((error: unknown) => {
  if (!(error instanceof WorkflowConflictError)) return
  const context = accessContext.getStore()
  if (!context) return
  console.warn(JSON.stringify({ event: 'workflow-conflict', code: error.code,
    operation: context.operation, operationId: context.operationId }))
})
