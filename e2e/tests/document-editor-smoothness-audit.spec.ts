import { expect, test } from '@playwright/test'
import * as XLSX from 'xlsx'
import { createSmoothnessProbe } from '../smoothness-probe'
import { withLineProgramFixture } from '../line-program-fixtures'
import { seedSmoothnessFixture, cleanupSmoothnessFixture, SMOOTHNESS_PROJECT } from '../smoothness-fixture'
import { createDocumentTemplateFileStore, resolveDocumentTemplateStorageDirectory } from '../../src/server/document-template-files'
import { documentGridRow } from '../document-grid'
import { previewSheetText } from '../document-sheet'

const enabled = !!process.env.SMOOTHNESS_LABEL
test.skip(!enabled, 'Explicit local performance comparison')
test.use({ trace: 'off', video: 'off', actionTimeout: 10000 })

test('template constructor and generated document preview with 500 positions', async ({ page }, info) => {
  test.setTimeout(240000)
  expect(process.env.DOCUMENT_TEMPLATE_STORAGE_PATH).toContain('welding-e2e-templates-')
  const store = createDocumentTemplateFileStore(resolveDocumentTemplateStorageDirectory())
  const key = 'e2e-smoothness-template/template.xlsx'
  const probe = await createSmoothnessProbe(page, info)
  try {
    await seedSmoothnessFixture()
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(Array.from({ length: 60 }, (_, row) => Array.from({ length: 12 }, (_, col) => row === 0 ? `Колонка ${col + 1}` : row === 59 ? 'Подпись' : ''))), 'Бланк')
    const bytes = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    await store.set(key, bytes)
    await withLineProgramFixture(async db => {
      expect((await db.query("select id from document_templates where id='weldingJournal'")).rows).toHaveLength(0)
      await db.query(`insert into document_templates(id,blob_key,file_name,file_type,file_size,metadata,constructor_config)
        values('weldingJournal',$1,'smoothness.xlsx','xlsx',$2,$3,$4)`, [key, bytes.byteLength, JSON.stringify({ sheetNames: ['Бланк'], fields: [], markerCount: 0, locations: [], warnings: [] }), JSON.stringify({ version: 1, sheetName: 'Бланк', repeatRow: 2, bindings: [{ cell: 'A2', mode: 'row', field: 'joint' }, { cell: 'B2', mode: 'row', field: 'line' }] })])
      const id = (await db.query(`insert into generated_documents(type,title,file_name,mime_type,row_count) values('weldingJournal','SM-EDITOR-DOCUMENT','preview.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',500) returning id`)).rows[0].id
      await db.query(`insert into generated_document_weld_joints(document_id,weld_joint_id) select $1,id from weld_joints where project_title=$2 order by id limit 500`, [id, SMOOTHNESS_PROJECT])
    })
    await page.goto('/settings')
    for (let n = 0; n < 3; n++) {
      await probe.measure(`template:open:${n}`, async () => { await page.getByRole('button', { name: 'Открыть конструктор', exact: true }).click(); await expect(page.getByRole('cell', { name: 'Ячейка A2', exact: true })).toBeVisible() })
      const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Конструктор шаблона', exact: true }) })
      await probe.measure(`template:cell:${n}`, async () => { await dialog.getByRole('cell', { name: 'Ячейка A2', exact: true }).click() })
      if (n === 0) { await probe.scroll('template:vertical', dialog.getByRole('table')); await probe.scroll('template:horizontal', dialog.getByRole('table'), true) }
      await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click()
    }
    await page.goto('/documents')
    const row = await documentGridRow(page, 'SM-EDITOR-DOCUMENT')
    for (let n = 0; n < 3; n++) {
      const modal = page.getByRole('dialog', { name: 'Предпросмотр документа', exact: true })
      await probe.measure(`document:preview-500:${n}`, async () => { await row.titleCell.getByRole('button', { name: 'SM-EDITOR-DOCUMENT', exact: true }).click(); await expect.poll(() => previewSheetText(modal), { timeout: 60000 }).toContain('Колонка 1') })
      if (n === 0) {
        const sheet = modal.frameLocator('iframe').locator('body')
        await probe.measure('document:preview-next-page', async () => {
          const before = await previewSheetText(modal)
          await modal.getByRole('button', { name: 'Далее', exact: true }).click()
          await expect.poll(() => previewSheetText(modal)).not.toBe(before)
        })
        await probe.measure('document:preview-previous-page', async () => {
          await modal.getByRole('button', { name: 'Назад', exact: true }).click()
          await expect.poll(() => previewSheetText(modal)).toContain('Колонка 1')
        })
        await probe.measure('document:preview-zoom-200', async () => { await modal.getByLabel('Масштаб листа').selectOption('200') })
        await probe.scroll('document:preview-vertical', sheet)
        await probe.scroll('document:preview-horizontal', sheet, true)
      }
      await page.keyboard.press('Escape'); await expect(modal).toBeHidden()
    }
  } finally {
    try { await probe.finish(); await page.close().catch(() => {}) }
    finally {
      await withLineProgramFixture(async db => { await db.query('delete from document_templates where blob_key=$1', [key]); await db.query("delete from generated_documents where title='SM-EDITOR-DOCUMENT'") })
      await cleanupSmoothnessFixture(); await store.delete(key)
    }
  }
})
