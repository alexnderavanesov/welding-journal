import { DOCUMENT_SAVE_ID_HEADER, DOCUMENT_SAVE_OPERATIONS, DOCUMENT_SAVE_RECOVERY_EVENT, DOCUMENT_SAVE_RECOVERY_STORAGE, isUncertainDocumentSave, type DocumentSaveOperation, type PendingDocumentSave } from './document-save-recovery'
import { scopedStorageKey } from './user-storage'

const fallback = new Map<string, PendingDocumentSave[]>()
export function readPendingDocumentSaves(key = scopedStorageKey(DOCUMENT_SAVE_RECOVERY_STORAGE)): PendingDocumentSave[] {
  const known = fallback.get(key) ?? []
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(key) ?? 'null')
    if (!Array.isArray(stored)) return known
    const valid = stored.filter((item): item is PendingDocumentSave => Boolean(item && typeof item.id === 'string'
      && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(item.id)
      && DOCUMENT_SAVE_OPERATIONS.includes(item.operation)))
    // Browser storage is recoverable input, not authority over operations that
    // are still known in this tab. Keep them if storage was damaged or cleared.
    return [...new Map([...valid, ...known].map(item => [item.id, { id: item.id, operation: item.operation }])).values()]
  } catch { return known }
}
function writePending(values: PendingDocumentSave[], key: string) {
  fallback.set(key, values)
  try { if (values.length) sessionStorage.setItem(key, JSON.stringify(values)); else sessionStorage.removeItem(key) } catch { /* Recovery still works in this tab when storage is disabled. */ }
}
export function dismissDocumentSave(id: string) {
  writePending(readPendingDocumentSaves().filter(item => item.id !== id), scopedStorageKey(DOCUMENT_SAVE_RECOVERY_STORAGE))
  window.dispatchEvent(new Event(DOCUMENT_SAVE_RECOVERY_EVENT))
}
export async function runDocumentSave<T>(operation: DocumentSaveOperation, save: (headers: Record<string, string>) => Promise<T>): Promise<T> {
  const pending = { id: crypto.randomUUID(), operation }
  const key = scopedStorageKey(DOCUMENT_SAVE_RECOVERY_STORAGE)
  writePending([...readPendingDocumentSaves(key), pending], key)
  try {
    const result = await save({ [DOCUMENT_SAVE_ID_HEADER]: pending.id })
    writePending(readPendingDocumentSaves(key).filter(item => item.id !== pending.id), key)
    return result
  } catch (error) {
    if (!isUncertainDocumentSave(error)) writePending(readPendingDocumentSaves(key).filter(item => item.id !== pending.id), key)
    else window.dispatchEvent(new Event(DOCUMENT_SAVE_RECOVERY_EVENT))
    throw error
  }
}
