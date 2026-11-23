import { createServerOnlyFn } from '@tanstack/react-start'
import { workflowDocumentStorageArea, type WorkflowDocumentArea } from '@/lib/workflow-document-area'
import { requireContextPermission } from './access-payload'

export const requireWorkflowDocumentView = createServerOnlyFn((area: WorkflowDocumentArea) => requireContextPermission(`${area}.view`))

/** Register the actual stored area for the transaction's final access recheck. */
export const requireStoredWorkflowDocumentPermission = createServerOnlyFn((storageType: string, action: 'view' | 'edit') => {
  const area = workflowDocumentStorageArea(storageType)
  requireContextPermission(`${area}.view`)
  if (action === 'edit') requireContextPermission(`${area}.edit`)
})
