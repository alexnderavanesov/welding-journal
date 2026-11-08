import { eq, sql } from 'drizzle-orm'
import { appSettings, documentTemplates } from '@/db/schema'
import type { DocumentTemplateConstructorConfig } from '@/lib/document-template-model'
import { simplifyStampTemplateConfig, simplifyStampTemplateFile } from '@/lib/welder-stamp-template-transition'
import { parseDocumentTemplateFile } from '@/lib/document-template-workbook'
import { createDocumentTemplateFileKey, createDocumentTemplateFileStore, resolveDocumentTemplateStorageDirectory, assertPersistentDocumentTemplateStorage } from './document-template-files'
import { getNextTimestampVersion } from './timestamp-version'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'

const KEY = 'maintenance:welder-stamp-pairs:v1'

/** Explicit release preparation; original files stay available until normal cleanup.
 * File publication uses a fresh key, so a transaction rollback preserves originals. */
export async function simplifyStoredStampTemplates(tx: SystemDocumentSequenceTransaction) {
  const [done] = await tx.select().from(appSettings).where(eq(appSettings.key, KEY)).limit(1)
  if (done) return { skipped: true, changed: 0 }
  const directory = resolveDocumentTemplateStorageDirectory()
  const store = createDocumentTemplateFileStore(directory)
  const ids = await tx.select({ id: documentTemplates.id }).from(documentTemplates).orderBy(documentTemplates.id)
  let changed = 0
  for (const { id } of ids) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`document-template:${id}`}))`)
    const [record] = await tx.select().from(documentTemplates).where(eq(documentTemplates.id, id)).for('update')
    if (!record) continue
    const config = record.constructorConfig ? simplifyStampTemplateConfig(JSON.parse(record.constructorConfig) as DocumentTemplateConstructorConfig) : null
    const constructorConfig = config ? JSON.stringify(config) : null
    const original = await store.get(record.blobKey)
    const converted = original ? await simplifyStampTemplateFile(original) : null
    if (!converted && constructorConfig === record.constructorConfig) continue
    const patch: Partial<typeof documentTemplates.$inferInsert> = { constructorConfig, updatedAt: getNextTimestampVersion(record.updatedAt) }
    if (converted) {
      await assertPersistentDocumentTemplateStorage(directory)
      const blobKey = createDocumentTemplateFileKey(record.id, 'xlsx')
      await store.set(blobKey, converted)
      const { fileData: _data, uploadedAt: _time, ...metadata } = await parseDocumentTemplateFile(new File([converted], record.fileName.replace(/\.xls$/i, '.xlsx')))
      Object.assign(patch, { blobKey, fileType: 'xlsx', fileName: metadata.fileName, fileSize: converted.byteLength, metadata: JSON.stringify(metadata) })
    }
    await tx.update(documentTemplates).set(patch).where(eq(documentTemplates.id, record.id))
    changed++
  }
  await tx.insert(appSettings).values({ key: KEY, value: 'complete' })
  return { skipped: false, changed }
}
