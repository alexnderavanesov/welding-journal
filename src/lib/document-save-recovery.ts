export const DOCUMENT_SAVE_OPERATIONS = ['updateWeldJoints', 'savePstoRepeatWorkflow', 'savePreHeatTreatmentLnkWorkflow', 'savePreHeatTreatmentFill', 'savePreHeatTreatmentBatch'] as const
export type DocumentSaveOperation = typeof DOCUMENT_SAVE_OPERATIONS[number]
export const DOCUMENT_SAVE_ID_HEADER = 'x-welding-document-save-id'
export const DOCUMENT_SAVE_RECOVERY_EVENT = 'welding-document-save-recovery'
export const DOCUMENT_SAVE_RECOVERY_STORAGE = 'document-save-recovery:v1'
export type PendingDocumentSave = { id: string; operation: DocumentSaveOperation }

export function isUncertainDocumentSave(error: unknown): boolean {
  // The transport preserves the original network error as cause when adding
  // its user-facing message. Bound traversal in case an external error cycles.
  const seen = new Set<unknown>()
  for (let current = error; current != null && !seen.has(current) && seen.size < 8;) {
    seen.add(current)
    if (current instanceof TypeError || current instanceof SyntaxError || (typeof current === 'object' && 'name' in current && ['TypeError', 'SyntaxError', 'AbortError', 'TimeoutError', 'ServerFunctionResponseError'].includes(String(current.name))) || /failed to fetch|fetch failed|networkerror|network error|load failed|network request failed|unexpected end of json|timeout|timed out|bad gateway|service unavailable|gateway timeout|HTTP\s+(?:502|503|504)\b|WORKFLOW_SAVE_CONFIRMED/i.test(current instanceof Error ? current.message : String(current))) return true
    current = typeof current === 'object' && 'cause' in current ? current.cause : null
  }
  return false
}
