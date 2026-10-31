import { createHash } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { documentOperationReceipts, generatedDocuments } from '@/db/schema'
import { accessContext } from './access-store'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'
import type { SystemDocumentReference } from '@/lib/system-document-types'
import { getSystemDocumentTemplateId } from '@/lib/system-document-template-types'
import { buildGeneratedDocumentReferenceWhere, matchesSourcedSystemDocumentReference } from './system-document-index'
import { DOCUMENT_SAVE_OPERATIONS, type DocumentSaveOperation } from '@/lib/document-save-recovery'
import type { Permission } from '@/lib/access-permissions'

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export function documentSaveReceiptKey(actor: string, operation: DocumentSaveOperation, id: string) {
  if (!DOCUMENT_SAVE_OPERATIONS.includes(operation) || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id)) throw new Error('Некорректный идентификатор сохранения.')
  return `document-save:${hash([actor, operation, id.toLowerCase()])}`
}
export type DocumentSaveReceipt = { permissions: Permission[]; references: SystemDocumentReference[]; completedAt: string }

export async function beginDocumentSaveReceipt(tx: SystemDocumentSequenceTransaction, input: unknown) {
  const context = accessContext.getStore()
  if (!context?.documentSaveId) return null
  const id = documentSaveReceiptKey(context.identity.id, context.operation as DocumentSaveOperation, context.documentSaveId)
  const requestHash = hash(input)
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${id}))`)
  const [existing] = await tx.select().from(documentOperationReceipts).where(eq(documentOperationReceipts.id, id))
  if (existing) {
    if (existing.requestHash !== requestHash) throw new Error('Идентификатор сохранения уже использован для другого состава. Обновите окно.')
    throw new Error('WORKFLOW_SAVE_CONFIRMED: Операция уже сохранена. Нажмите «Проверить сохранение».')
  }
  return { id, requestHash, permissions: context.permissions }
}
export async function finishDocumentSaveReceipt(tx: SystemDocumentSequenceTransaction, receipt: Awaited<ReturnType<typeof beginDocumentSaveReceipt>>, references: SystemDocumentReference[]) {
  if (!receipt) return
  const unique = [...new Map(references.filter(ref => ref.title).map(ref => [JSON.stringify([getSystemDocumentTemplateId(ref), ref.title, ref.date, ref.sourceKind ?? null, ref.cycleSequences ?? []]), ref])).values()]
  const documents = unique.length ? await tx.select({ id: generatedDocuments.id, type: generatedDocuments.type, title: generatedDocuments.title, date: generatedDocuments.periodFrom, metadata: generatedDocuments.sourceMetadata }).from(generatedDocuments).where(buildGeneratedDocumentReferenceWhere(unique)) : []
  const byIdentity = new Map<string, typeof documents>()
  for (const doc of documents) {
    const key = JSON.stringify([doc.type, doc.title, doc.date ?? ''])
    const group = byIdentity.get(key) ?? []; group.push(doc); byIdentity.set(key, group)
  }
  const resolved = unique.map(ref => {
    const matches = (byIdentity.get(JSON.stringify([`system:${getSystemDocumentTemplateId(ref)}`, ref.title, ref.date])) ?? []).filter(doc => matchesSourcedSystemDocumentReference(doc.metadata, ref))
    const stored = matches.length === 1 ? matches[0] : undefined
    return { type: ref.type, title: ref.title, date: ref.date, ...(ref.methodCode ? { methodCode: ref.methodCode } : {}), ...(ref.sourceKind ? { sourceKind: ref.sourceKind } : {}), ...(ref.cycleSequences?.length ? { cycleSequences: ref.cycleSequences } : {}), ...(stored ? { documentId: stored.id } : {}) }
  })
  const result: DocumentSaveReceipt = { permissions: receipt.permissions, references: resolved, completedAt: new Date().toISOString() }
  await tx.insert(documentOperationReceipts).values({ id: receipt.id, requestHash: receipt.requestHash, result: JSON.stringify(result) })
}
