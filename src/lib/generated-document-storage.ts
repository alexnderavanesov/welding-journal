export const GENERATED_DOCUMENT_STORAGE_EVENT = 'generated-document-storage-change'

const GENERATED_DOCUMENT_DB_NAME = 'welding-generated-documents'
const GENERATED_DOCUMENT_STORE_NAME = 'documents'

export type GeneratedDocumentType = 'weldingJournal'

export type StoredGeneratedDocument = {
  id: string
  type: GeneratedDocumentType
  title: string
  fileName: string
  mimeType: string
  fileData: ArrayBuffer
  createdAt: string
  periodFrom?: string
  periodTo?: string
  rowCount?: number
  wdiTotal?: number
}

export async function saveGeneratedDocument(input: Omit<StoredGeneratedDocument, 'id' | 'createdAt'>) {
  const record: StoredGeneratedDocument = {
    id: createGeneratedDocumentId(),
    createdAt: new Date().toISOString(),
    ...input,
  }
  const db = await openGeneratedDocumentDb()
  await runGeneratedDocumentStoreRequest(db, 'readwrite', (store) => store.put(record))
  notifyGeneratedDocumentStorageChanged()
  return record
}

export async function loadGeneratedDocuments() {
  const db = await openGeneratedDocumentDb()
  const records = await runGeneratedDocumentStoreRequest<StoredGeneratedDocument[]>(db, 'readonly', (store) => store.getAll())
  return records.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
}

export async function deleteGeneratedDocument(id: string) {
  const db = await openGeneratedDocumentDb()
  await runGeneratedDocumentStoreRequest(db, 'readwrite', (store) => store.delete(id))
  notifyGeneratedDocumentStorageChanged()
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export function openGeneratedDocument(documentRecord: StoredGeneratedDocument) {
  const blob = new Blob([documentRecord.fileData], { type: documentRecord.mimeType })
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank', 'noopener,noreferrer')
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export function downloadGeneratedDocument(documentRecord: StoredGeneratedDocument) {
  const blob = new Blob([documentRecord.fileData], { type: documentRecord.mimeType })
  downloadBlob(blob, documentRecord.fileName)
}

function createGeneratedDocumentId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function openGeneratedDocumentDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(GENERATED_DOCUMENT_DB_NAME, 1)
    request.onerror = () => reject(request.error ?? new Error('Не удалось открыть хранилище документов.'))
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(GENERATED_DOCUMENT_STORE_NAME)) {
        db.createObjectStore(GENERATED_DOCUMENT_STORE_NAME, { keyPath: 'id' })
      }
    }
  })
}

function runGeneratedDocumentStoreRequest<T = void>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  createRequest: (store: IDBObjectStore) => IDBRequest,
) {
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(GENERATED_DOCUMENT_STORE_NAME, mode)
    const store = transaction.objectStore(GENERATED_DOCUMENT_STORE_NAME)
    const request = createRequest(store)
    request.onerror = () => reject(request.error ?? new Error('Не удалось выполнить операцию с документом.'))
    request.onsuccess = () => resolve(request.result as T)
    transaction.oncomplete = () => db.close()
    transaction.onerror = () => {
      db.close()
      reject(transaction.error ?? new Error('Не удалось сохранить документ.'))
    }
  })
}

function notifyGeneratedDocumentStorageChanged() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(GENERATED_DOCUMENT_STORAGE_EVENT))
}
