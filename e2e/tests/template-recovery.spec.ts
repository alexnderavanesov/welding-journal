import { expect, test, type Page } from '@playwright/test'
import * as XLSX from 'xlsx'
import { withE2eDatabase } from '../database'
import { rpcName } from '../rpc'
import { getRemoteDocumentTemplate, getRemoteDocumentTemplateInventory, saveRemoteDocumentTemplate, updateRemoteDocumentTemplate } from '../../src/server/document-templates'
import { createDocumentTemplateFileStore, resolveDocumentTemplateStorageDirectory } from '../../src/server/document-template-files'

const config = { version: 1 as const, sheetName: 'Бланк', repeatRow: 2, bindings: [{ cell: 'A2', mode: 'row' as const, field: 'joint' as const }] }
const options = { weldingJournal: { officialOnly: true, goodOnly: false, actualOnly: true, splitMode: 'line' } }
const store = createDocumentTemplateFileStore(resolveDocumentTemplateStorageDirectory())
function file(sheetName = 'Бланк') {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Стык', 'Линия'], ['', ''], ['Подпись', '']]), sheetName)
  return { name: 'recovered.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer }
}
const stored = () => withE2eDatabase(async db => (await db.query("select * from document_templates where id='weldingJournal'")).rows[0])
test.beforeEach(async () => {
  // A database fixture must never share the user's template directory.
  expect(process.env.DOCUMENT_TEMPLATE_STORAGE_PATH).toContain('welding-e2e-templates-')
  await withE2eDatabase(async db => {
    expect((await db.query("select id from document_templates where id='weldingJournal'")).rows).toHaveLength(0)
    await db.query(`insert into document_templates(id,blob_key,file_name,file_type,file_size,metadata,options,constructor_config)
      values('weldingJournal','missing-recovery/file.xlsx','original.xlsx','xlsx',100,$1,$2,$3)`, [JSON.stringify({ sheetNames: ['Бланк'], fields: [], markerCount: 0, locations: [], warnings: [] }), JSON.stringify(options), JSON.stringify(config)])
  })
})
test.afterEach(async ({ page }) => {
  await page.close()
  await withE2eDatabase(async db => {
    await db.query('drop trigger if exists e2e_template_write_failure on document_templates')
    await db.query('drop function if exists e2e_template_write_failure()')
    await db.query("delete from document_templates where id='weldingJournal'")
  })
  for (const key of await store.list('weldingJournal/')) await store.delete(key)
})
async function upload(page: Page, sheet = 'Бланк') {
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Восстановить файл шаблона', exact: true }).click()
  await (await chooser).setFiles(file(sheet))
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: /^Восстановить файл шаблона/ }) })
  await expect(dialog).toBeVisible()
  return dialog
}

test('missing file: explicit recovery, cancel, preserved constructor/options and ordinary later replacement', async ({ page }) => {
  const calls: string[] = []
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url()).replace(/_createServerFn_handler$/, '')) })
  const before = await stored()
  await page.goto('/settings')
  await expect(page.getByText('Файл шаблона отсутствует', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Открыть конструктор', exact: true })).toBeHidden()
  expect(calls.filter(name => name === 'getRemoteDocumentTemplateInventory')).toHaveLength(1)
  expect(calls.filter(name => name === 'getRemoteDocumentTemplate')).toHaveLength(0)
  let dialog = await upload(page)
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(await stored()).toEqual(before)
  dialog = await upload(page)
  await dialog.getByRole('button', { name: 'Восстановить файл', exact: true }).click()
  await expect(page.getByText('Файл шаблона отсутствует', { exact: true })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Открыть конструктор', exact: true })).toBeVisible()
  const after = await stored()
  expect(after.constructor_config).toBe(before.constructor_config)
  expect(after.options).toBe(before.options)
  expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime())
  expect(Buffer.from((await store.get(after.blob_key))!)).toEqual(file().buffer)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Открыть конструктор', exact: true })).toBeVisible()
  await page.getByLabel('Управление файлом шаблона', { exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: /Заменить файл шаблона/ }).click()
  await (await chooser).setFiles(file())
  await page.getByRole('dialog').getByRole('button', { name: 'Заменить шаблон', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect.poll(async () => (await stored()).updated_at.getTime()).toBeGreaterThan(after.updated_at.getTime())
  // Ordinary replacement normalizes legacy defaults; unlike recovery it need
  // not retain byte-identical JSON. The sheet, bindings and repeat span stay the same.
  expect(JSON.parse((await stored()).constructor_config)).toEqual({ ...config, repeatRowEnd: 2, repeatMode: 'rows' })
  expect((await stored()).options).toBe(before.options)
  const remote = (await getRemoteDocumentTemplate({ data: { id: 'weldingJournal' } }))!
  const beforeRejectedRecovery = await stored()
  await expect(saveRemoteDocumentTemplate({ data: { ...remote, expectedVersion: remote.version!, recoverMissingFile: true } })).rejects.toThrow('уже доступен')
  expect(await stored()).toEqual(beforeRejectedRecovery)
})

test('missing file: incompatible upload and a real concurrent edit never overwrite saved settings', async ({ page }) => {
  const before = await stored()
  await page.goto('/settings')
  let dialog = await upload(page, 'Другой лист')
  await dialog.getByRole('button', { name: 'Восстановить файл', exact: true }).click()
  await expect(page.getByText(/Файл не подходит для сохранённых настроек конструктора/)).toBeVisible()
  expect(await stored()).toEqual(before)
  dialog = await upload(page)
  const changedConfig = { ...config, bindings: [{ cell: 'B2', mode: 'row' as const, field: 'line' as const }] }
  await updateRemoteDocumentTemplate({ data: { id: 'weldingJournal', expectedVersion: before.updated_at.toISOString(), constructorConfig: changedConfig } })
  const concurrentlyChanged = await stored()
  await dialog.getByRole('button', { name: 'Восстановить файл', exact: true }).click()
  await expect(page.getByText(/Шаблон уже изменен другим пользователем/)).toBeVisible()
  expect(await stored()).toEqual(concurrentlyChanged)
  expect(await store.get(concurrentlyChanged.blob_key)).toBeNull()
  await page.reload()
  dialog = await upload(page)
  await dialog.getByRole('button', { name: 'Восстановить файл', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Открыть конструктор', exact: true })).toBeVisible()
  expect(JSON.parse((await stored()).constructor_config)).toEqual(changedConfig)
})

test('failed database save retains the active file; restart and explicit orphan cleanup never change template settings', async ({ page }) => {
  await page.goto('/settings')
  const dialog = await upload(page)
  await dialog.getByRole('button', { name: 'Восстановить файл', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Открыть конструктор', exact: true })).toBeVisible()
  const before = await stored(), bytes = await store.get(before.blob_key)
  const remote = (await getRemoteDocumentTemplate({ data: { id: 'weldingJournal' } }))!
  await withE2eDatabase(async db => {
    await db.query("create function e2e_template_write_failure() returns trigger language plpgsql as $$ begin raise exception 'synthetic template write failure'; end $$")
    await db.query("create trigger e2e_template_write_failure before update on document_templates for each row when (old.id='weldingJournal') execute function e2e_template_write_failure()")
  })
  await expect(saveRemoteDocumentTemplate({ data: { ...remote, expectedVersion: remote.version! } })).rejects.toThrow()
  expect(await stored()).toEqual(before)
  expect(await store.list('weldingJournal/')).toEqual([before.blob_key])
  expect(await store.get(before.blob_key)).toEqual(bytes)
  // A fresh store/process sees the same persisted bytes; an interrupted upload
  // can be removed explicitly without uploading the source again.
  const reopened = createDocumentTemplateFileStore(resolveDocumentTemplateStorageDirectory())
  expect(await reopened.get(before.blob_key)).toEqual(bytes)
  await reopened.set('weldingJournal/interrupted.xlsx', new Uint8Array([1, 2]).buffer)
  await page.reload()
  await expect(page.getByText(/В хранилище остались лишние файлы/)).toBeVisible()
  await page.getByRole('button', { name: 'Повторить очистку файлов', exact: true }).click()
  await expect(page.getByText(/В хранилище остались лишние файлы/)).toBeHidden()
  expect(await stored()).toEqual(before)
  expect(await reopened.list('weldingJournal/')).toEqual([before.blob_key])
})

test('metadata and file readers wait for a concurrent replacement instead of falsely reporting a missing file', async () => {
  let readers: Promise<unknown[]> | undefined
  let completed = false
  const key = 'weldingJournal/concurrent.xlsx', bytes = file().buffer
  await withE2eDatabase(async writer => {
    await writer.query('begin')
    try {
      await writer.query("select pg_advisory_xact_lock(hashtext('document-template:weldingJournal'))")
      readers = Promise.all([
        getRemoteDocumentTemplate({ data: { id: 'weldingJournal' } }),
        getRemoteDocumentTemplateInventory(),
      ]).then(result => { completed = true; return result })
      await expect.poll(() => withE2eDatabase(async observer => Number((await observer.query("select count(*) from pg_stat_activity where datname=current_database() and wait_event='advisory' and query like '%pg_advisory_xact_lock_shared%'")).rows[0].count))).toBe(2)
      expect(completed).toBe(false)
      await store.set(key, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
      await writer.query("update document_templates set blob_key=$1 where id='weldingJournal'", [key])
      await writer.query('commit')
    } finally { await writer.query('rollback') }
  })
  const [single, inventory] = await readers! as [Awaited<ReturnType<typeof getRemoteDocumentTemplate>>, Awaited<ReturnType<typeof getRemoteDocumentTemplateInventory>>]
  expect(single?.fileDataBase64).toBe(bytes.toString('base64'))
  expect(inventory.missing).toEqual([])
  expect(inventory.templates.find(template => template.id === 'weldingJournal')?.fileDataBase64).toBe(bytes.toString('base64'))
})
