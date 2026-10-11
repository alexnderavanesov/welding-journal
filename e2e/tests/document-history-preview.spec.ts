import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { requireDb } from '../../src/db'
import { weldJoints } from '../../src/db/schema'
import { loadSystemDocumentSummaries, syncSystemDocumentsForWeldChangesInTransaction } from '../../src/server/system-document-index'
import { readFile } from 'node:fs/promises'
import { expect, test, type Page, type Request } from '@playwright/test'
import * as XLSX from 'xlsx'
import { withE2eDatabase } from '../database'
import { captureFullReportPrint } from '../report-print-capture'
import { rpcName } from '../rpc'
import { createDocumentTemplateFileStore, resolveDocumentTemplateStorageDirectory } from '../../src/server/document-template-files'

const project = 'E2E history preview'
const manualTitle = 'E2E-PREVIEW-JSR', systemTitle = 'E2E-PREVIEW-LNK'
const store = createDocumentTemplateFileStore(resolveDocumentTemplateStorageDirectory())
let fileKey = ''

// Reproduce a populated application whose document index is already initialized.
test.beforeAll(async () => { await loadSystemDocumentSummaries('lnkRequest') })

test.beforeEach(async () => {
  const book = XLSX.utils.book_new(), sheet = XLSX.utils.aoa_to_sheet([
    ['Шаблон — готовый документ', '', ''], ['Стык', 'Линия', 'Проект'], ['', '', ''],
  ])
  sheet['!merges'] = [XLSX.utils.decode_range('A1:C1')]
  sheet['!cols'] = [{ wpx: 160 }, { wpx: 200 }, { wpx: 280 }]
  sheet['!rows'] = [{ hpt: 30 }]
  XLSX.utils.book_append_sheet(book, sheet, 'Бланк')
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Подписи — конец документа']]), 'Подписи')
  const data = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  fileKey = `e2e-history-preview/${randomUUID()}.xlsx`
  await store.set(fileKey, data)
  await withE2eDatabase(async db => {
    // Never overwrite another scenario's templates.
    expect((await db.query("select id from document_templates where id in ('weldingJournal','lnkRequest')")).rows).toHaveLength(0)
    for (const id of ['weldingJournal', 'lnkRequest']) await db.query(`insert into document_templates(id,blob_key,file_name,file_type,file_size,metadata,constructor_config)
      values ($1,$2,'preview.xlsx','xlsx',$3,$4,$5)`, [id, fileKey, data.byteLength, JSON.stringify({ fields: [], markerCount: 0, locations: [], warnings: [] }), JSON.stringify({ version: 1, sheetName: 'Бланк', repeatRow: 3, bindings: [
        { cell: 'A3', mode: 'row', field: 'joint' }, { cell: 'B3', mode: 'row', field: 'line' }, { cell: 'C3', mode: 'row', field: 'projectTitle' },
      ] })])
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,officiality,revision_actuality,has_vik,vik_request,vik_request_date)
      select $1,'PREVIEW','LINE','F'||lpad(n::text,3,'0'),'2026-10-01','действующий','актуальная','да',$2,'2026-10-02' from generate_series(1,125) n`, [project, systemTitle])
    for (let n = 0; n < 25; n++) {
      const title = n === 0 ? manualTitle : `${manualTitle}-${n}`
      const id = (await db.query(`insert into generated_documents(type,title,file_name,mime_type,row_count) values ('weldingJournal',$1,'preview.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',125) returning id`, [title])).rows[0].id
      await db.query('insert into generated_document_weld_joints(document_id,weld_joint_id) select $1,id from weld_joints where project_title=$2', [id, project])
    }
  })
  // SQL fixtures bypass the normal save workflow: explicitly index this project's
  // new documents even when an earlier scenario already initialized the index.
  await requireDb().transaction(async tx => {
    const rows = await tx.select().from(weldJoints).where(eq(weldJoints.projectTitle, project))
    await syncSystemDocumentsForWeldChangesInTransaction(tx, rows, new Map())
  })
})
test.afterEach(async () => {
  await withE2eDatabase(async db => {
    await db.query("delete from document_templates where blob_key=$1", [fileKey])
    await db.query('delete from generated_documents where title like $1', ['E2E-PREVIEW-%'])
    await db.query('delete from weld_joints where project_title=$1', [project])
  })
  if (fileKey) await store.delete(fileKey)
})

async function chooseProject(page: Page) {
  await page.getByTitle('Фильтр: Проект', { exact: true }).click()
  const filter = page.getByRole('dialog', { name: 'Фильтр: Проект', exact: true })
  await filter.getByRole('button', { name: new RegExp(project) }).click()
  await page.keyboard.press('Escape')
  await expect(filter).toBeHidden()
}

test('history preview: manual and system documents, all sheets, full print/download, bounded reads, Escape order', async ({ page }, info) => {
  const errors: string[] = [], calls: string[] = []
  const pending = new Set<Request>()
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/_serverFn/')) { calls.push(rpcName(request.url())); pending.add(request) } })
  page.on('requestfinished', request => pending.delete(request))
  page.on('requestfailed', request => pending.delete(request))
  await page.goto('/documents')
  for (const [view, title, rowRpc] of [['ЖСР', manualTitle, 'getRemoteGeneratedDocumentRows'], ['Заявка ЛНК', systemTitle, 'getSystemDocumentRows']]) {
    await page.getByRole('button', { name: view, exact: true }).click()
    await chooseProject(page)
    const titleButton = page.getByRole('button', { name: title, exact: true })
    await expect(titleButton).toBeVisible()
    await expect(page.getByTitle('Открыть актуальный Excel', { exact: true })).toHaveCount(0)
    await expect(page.getByTitle('Открыть Excel', { exact: true })).toHaveCount(0)
    const checkbox = page.getByRole('button', { name: `Выбрать документ «${title}»`, exact: true })
    await checkbox.click()
    const beforeOpen = calls.length
    if (view === 'ЖСР') await titleButton.click()
    else {
      await titleButton.click({ button: 'right' })
      await page.getByRole('button', { name: 'Предпросмотр', exact: true }).click()
    }
    const modal = page.getByRole('dialog', { name: 'Предпросмотр документа', exact: true })
    const frame = modal.frameLocator('iframe')
    await expect(frame.getByText('Шаблон — готовый документ')).toBeVisible()
    const heading = frame.locator('td').filter({ hasText: 'Шаблон — готовый документ' })
    await expect(heading).toHaveAttribute('colspan', '3')
    await expect.poll(() => heading.locator('..').evaluate(row => row.getBoundingClientRect().height)).toBeGreaterThanOrEqual(39)
    expect(calls.slice(beforeOpen).filter(name => name.startsWith(rowRpc))).toHaveLength(1)
    await expect.poll(() => pending.size).toBe(0)
    const localStart = calls.length
    await modal.getByRole('button', { name: 'Далее', exact: true }).click()
    await expect(frame.getByText('F125', { exact: true })).toBeVisible()
    await modal.getByLabel('Лист документа').selectOption('1')
    await expect(frame.getByText('Подписи — конец документа')).toBeVisible()
    await modal.getByLabel('Масштаб документа').selectOption('75')
    await captureFullReportPrint(page)
    await modal.getByRole('button', { name: 'Печать / Сохранить PDF' }).click()
    await expect.poll(() => page.evaluate(() => JSON.parse(document.body.dataset.fullPrint ?? '{}').lastRow)).toBe('Подписи — конец документа')
    const downloadEvent = page.waitForEvent('download')
    await modal.getByRole('button', { name: 'Скачать Excel' }).click()
    const download = await downloadEvent
    const book = XLSX.read(await readFile((await download.path())!), { type: 'buffer' })
    expect(book.SheetNames).toEqual(['Бланк', 'Подписи'])
    expect(book.Sheets['Бланк'].A127.v).toBe('F125')
    await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')) })
    await expect.poll(() => pending.size).toBe(0)
    expect(calls.slice(localStart).filter(name => !name.startsWith('getDispatcherTaskVersion'))).toEqual([])
    await modal.getByLabel('Лист документа').selectOption('0')
    // The iframe is rewritten asynchronously on a sheet change. A screenshot
    // taken before it is ready only captures the empty loading surface.
    await expect(frame.getByText('Шаблон — готовый документ')).toBeVisible()
    await expect(modal.getByRole('button', { name: 'Печать / Сохранить PDF' })).toBeEnabled()
    await page.screenshot({ path: info.outputPath(`${view === 'ЖСР' ? 'manual' : 'system'}-preview.png`) })
    await frame.locator('body').press('Escape')
    await expect(modal).toBeHidden()
    await expect(checkbox).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTitle(/^Проект: /)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(checkbox).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByTitle(/^Проект: /)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTitle('Фильтр: Проект', { exact: true })).toBeVisible()
  }
  expect(errors).toEqual([])
})

test('navigation stays visible and clickable when scrolling history; Formation preview stays inline', async ({ page }, info) => {
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.goto('/documents')
  await expect(page.getByRole('button', { name: manualTitle, exact: true })).toBeVisible()
  await page.mouse.move(700, 650); await page.mouse.wheel(0, 900)
  const navigation = page.locator('[data-documents-navigation]')
  await expect.poll(() => navigation.evaluate(element => Math.round(element.getBoundingClientRect().top))).toBe(0)
  await expect(page.getByRole('button', { name: 'ЖСР', exact: true })).toBeInViewport()
  await expect(page.getByRole('tab', { name: 'Формирование', exact: true })).toBeInViewport()
  await page.screenshot({ path: info.outputPath('sticky-documents.png') })
  await page.getByRole('tab', { name: 'Формирование', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Открыть на весь экран', exact: true })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
