import { expect, test } from '@playwright/test'
import * as XLSX from 'xlsx'
import { eq } from 'drizzle-orm'
import { appSettings, documentTemplates } from '../../src/db/schema'
import { requireDb } from '../../src/db'
import { simplifyStoredStampTemplates } from '../../src/server/welder-stamp-template-transition'
import { createDocumentTemplateFileStore, resolveDocumentTemplateStorageDirectory } from '../../src/server/document-template-files'

const key = 'maintenance:welder-stamp-pairs:v1', id = 'stamp-transition-fixture'

test('template conversion is idempotent, transactional and keeps original file intact on rollback', async () => {
  const db = requireDb(), store = createDocumentTemplateFileStore(resolveDocumentTemplateStorageDirectory())
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([[
    '{{Корень_1/"Корень_1"}}', '{{Заполнение_1 - факт}}', '{{Облицовка_2/"н/п"}}', '{{Клеймо_2/"Заполнение_1"}}',
  ]]), 'Шаблон')
  const original = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  const blobKey = `${id}/original.xlsx`
  await store.set(blobKey, original)
  const [marker] = await db.select().from(appSettings).where(eq(appSettings.key, key))
  const record = { id, blobKey, fileName: 'fixture.xlsx', fileType: 'xlsx', fileSize: original.byteLength, metadata: '{}',
    constructorConfig: JSON.stringify({ version: 1, sheetName: 'Шаблон', bindings: [{ cell: 'A1', mode: 'row', field: 'stamp1K' }, { cell: 'C1', mode: 'row', field: 'stamp2O' }] }) }
  try {
    await expect(db.transaction(async tx => {
      await tx.delete(appSettings).where(eq(appSettings.key, key))
      await tx.insert(documentTemplates).values(record)
      expect((await simplifyStoredStampTemplates(tx)).changed).toBeGreaterThanOrEqual(1)
      expect(await simplifyStoredStampTemplates(tx)).toEqual({ skipped: true, changed: 0 })
      throw new Error('Deliberate rollback')
    })).rejects.toThrow('Deliberate rollback')
    expect(await db.select().from(documentTemplates).where(eq(documentTemplates.id, id))).toEqual([])
    expect(new Uint8Array((await store.get(blobKey))!)).toEqual(new Uint8Array(original))
    await db.transaction(async tx => {
      await tx.delete(appSettings).where(eq(appSettings.key, key))
      await tx.insert(documentTemplates).values(record)
      await simplifyStoredStampTemplates(tx)
    })
    const [saved] = await db.select().from(documentTemplates).where(eq(documentTemplates.id, id))
    expect(saved.blobKey).not.toBe(blobKey)
    const sheet = XLSX.read(await store.get(saved.blobKey), { type: 'array' }).Sheets['Шаблон']
    expect(sheet.A1.v).toBe('{{Клеймо_1/"Корень_1"}}'); expect(sheet.B1.v).toBe('{{Клеймо_2 - факт}}'); expect(sheet.C1?.v ?? '').toBe('')
    expect(sheet.D1.v).toBe('{{Клеймо_2/"Заполнение_1"}}')
    expect(JSON.parse(saved.constructorConfig!).bindings[1]).toMatchObject({ emptyMode: 'blank' })
    // Metadata uses sorted field names, independently of the cell order.
    expect(JSON.parse(saved.metadata).fields).toEqual(['Клеймо_1', 'Клеймо_2', 'Клеймо_2 - факт'])
    expect(new Uint8Array((await store.get(blobKey))!)).toEqual(new Uint8Array(original))
    expect(await db.transaction(simplifyStoredStampTemplates)).toEqual({ skipped: true, changed: 0 })
  } finally {
    await db.delete(documentTemplates).where(eq(documentTemplates.id, id))
    await db.delete(appSettings).where(eq(appSettings.key, key))
    if (marker) await db.insert(appSettings).values(marker)
    for (const file of await store.list(id)) await store.delete(file)
  }
})
