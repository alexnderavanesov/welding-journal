import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { requireDb } from '@/db'
import { documentOperationReceipts } from '@/db/schema'
import { assertPermission, type Permission } from '@/lib/access-permissions'
import type { PendingDocumentSave } from '@/lib/document-save-recovery'
import { requireIdentity } from './access-context'
import { documentSaveReceiptKey, type DocumentSaveReceipt } from './document-save-receipt'

export const checkDocumentSave = createServerFn({ method: 'POST' }).validator((input: PendingDocumentSave) => {
  documentSaveReceiptKey('validation', input?.operation, input?.id)
  return { operation: input.operation, id: input.id }
}).handler(async ({ data }) => {
  const identity = await requireIdentity()
  const key = documentSaveReceiptKey(identity.id, data.operation, data.id)
  const [stored] = await requireDb().select({ result: documentOperationReceipts.result }).from(documentOperationReceipts).where(eq(documentOperationReceipts.id, key))
  if (!stored) return { confirmed: false as const }
  const result = JSON.parse(stored.result) as DocumentSaveReceipt
  for (const permission of result.permissions) assertPermission(identity, permission.replace(/\.(edit|generate|delete)$/, '.view') as Permission)
  return { confirmed: true as const, completedAt: result.completedAt, references: result.references }
})
