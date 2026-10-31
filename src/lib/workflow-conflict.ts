/** Stable diagnostics without field values, names or other private context. */
export type WorkflowConflictCode =
  | 'DOCUMENT_NAME_OCCUPIED'
  | 'DOCUMENT_NUMBER_CHANGED'
  | 'DOCUMENT_SETTINGS_CHANGED'
  | 'DOCUMENT_CONTEXT_CHANGED'
  | 'DOCUMENT_PREVIEW_CHANGED'
  | 'ROW_VERSION_STALE'
  | 'ROW_VERSION_MISSING'
  | 'ROW_MISSING'

export class WorkflowConflictError extends Error {
  constructor(readonly code: WorkflowConflictCode, message: string) {
    super(message)
    this.name = 'WorkflowConflictError'
  }
}
