import { expect, test, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import * as XLSX from 'xlsx'
import { eq, inArray } from 'drizzle-orm'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { requireDb } from '../../src/db'
import { preHeatTreatmentControls, weldJoints } from '../../src/db/schema'
import { syncSystemDocumentsForWeldChangesInTransaction } from '../../src/server/system-document-index'
import { syncPreHeatTreatmentDocumentsInTransaction } from '../../src/server/pre-heat-treatment-system-documents'
import { createDocumentTemplateFileStore, resolveDocumentTemplateStorageDirectory } from '../../src/server/document-template-files'
import { previewSheetText } from '../document-sheet'
import { rpcName } from '../rpc'

const project = 'E2E template control stage'
const store = createDocumentTemplateFileStore(resolveDocumentTemplateStorageDirectory())
let fileKey = ''
const ids = ['weldingJournal', 'lnkRequest', 'lnkConclusionVik', 'lnkConclusionRk']
const stored = (id: string) => withE2eDatabase(async db => (await db.query('select constructor_config,updated_at from document_templates where id=$1', [id])).rows[0])
const title = (before: boolean, suffix: string) => `E2E-STAGE-${before ? 'PRE' : 'MAIN'}-${suffix}`

test.beforeEach(async () => {
  expect(process.env.DOCUMENT_TEMPLATE_STORAGE_PATH).toContain('welding-e2e-templates-')
  const book = XLSX.utils.book_new(), sheet = XLSX.utils.aoa_to_sheet([Array.from({ length: 12 }, (_, i) => `Поле ${i + 1}`), Array(12).fill('')])
  // The sheet preview follows Excel column widths: reserve space for the full fixture titles
  // and defects so this stage test does not accidentally test clipped cells.
  sheet['!cols'] = Array.from({ length: 12 }, () => ({ wpx: 330 }))
  XLSX.utils.book_append_sheet(book, sheet, 'Бланк')
  const data = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  fileKey = `e2e-stage-template/${randomUUID()}.xlsx`
  await store.set(fileKey, data)
  await withE2eDatabase(async db => {
    expect((await db.query('select id from document_templates where id=any($1::text[])', [ids])).rows).toHaveLength(0)
    for (const id of ids) {
      const rk = id === 'lnkConclusionRk'
      const fields = id === 'weldingJournal' ? ['vikDefectDescription', 'preVikDefectDescription', 'lnkDefectDescription', 'preRkDefectDescription']
        : [rk ? 'preRkDefectDescription' : 'preVikDefectDescription', rk ? 'lnkDefectDescription' : 'vikDefectDescription',
          rk ? 'rkRequest' : 'vikRequest', rk ? 'rkRequestDate' : 'vikRequestDate', rk ? 'rkResult' : 'vikResult',
          rk ? 'rkConclusion' : 'vikConclusion', rk ? 'rkConclusionDate' : 'vikConclusionDate', '__systemDocumentTitle',
          ...(id === 'lnkRequest' ? ['preRkDefectDescription', 'preUzkDefectDescription', 'prePvkDefectDescription'] : [])]
      const config = { version: 1, sheetName: 'Бланк', repeatRow: 2, bindings: fields.map((field, i) => ({ cell: `${String.fromCharCode(65 + i)}2`, mode: 'row', parts: [{ field }], emptyMode: 'custom', emptyText: 'нет' })),
        ...(id === 'weldingJournal' ? { nameConfig: { parts: [{ type: 'text', text: 'Общий документ' }] } } : {}) }
      await db.query(`insert into document_templates(id,blob_key,file_name,file_type,file_size,metadata,constructor_config) values($1,$2,'stages.xlsx','xlsx',$3,$4,$5)`,
        [id, fileKey, data.byteLength, JSON.stringify({ sheetNames: ['Бланк'], fields: [], markerCount: 0, locations: [], warnings: [] }), JSON.stringify(config)])
    }
    const rowId = (await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,officiality,revision_actuality,
      has_vik,has_rk,has_uzk,has_pvk,vik_result,rk_result,uzk_result,pvk_result,
      vik_defect_description,lnk_defect_description,uzk_defect_description,pvk_defect_description,
      vik_request,vik_request_date,rk_request,rk_request_date,vik_conclusion,vik_conclusion_date,rk_conclusion,rk_conclusion_date)
      values($1,'STAGE','L1','F-STAGE','2026-10-01','действующий','актуальная',
      'да','да','да','да','ремонт','ремонт','ремонт','ремонт',
      'основной ВИК','0-100: основной РК','основной УЗК','основной ПВК',
      $2,'2026-10-05',$2,'2026-10-05',$3,'2026-10-06',$4,'2026-10-06') returning id`, [project, title(false, 'REQ'), title(false, 'VIK'), title(false, 'RK')])).rows[0].id
    for (const method of ['ВИК', 'РК', 'УЗК', 'ПВК']) await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,result,conclusion_name,conclusion_date,defect_description)
      values($1,$2,$3,'2026-10-02','вырез',$4,'2026-10-03',$5)`, [rowId, method, title(true, 'REQ'), title(true, method === 'ВИК' ? 'VIK' : method === 'РК' ? 'RK' : method), `${method === 'РК' ? '0-100: ' : ''}до ТО ${method}`])
    const docId = (await db.query(`insert into generated_documents(type,title,file_name,mime_type,row_count) values('weldingJournal','E2E-STAGE-GENERAL','stages.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',1) returning id`)).rows[0].id
    await db.query('insert into generated_document_weld_joints(document_id,weld_joint_id) values($1,$2)', [docId, rowId])
  })
  await requireDb().transaction(async tx => {
    const rows = await tx.select().from(weldJoints).where(eq(weldJoints.projectTitle, project))
    await syncSystemDocumentsForWeldChangesInTransaction(tx, rows, new Map())
    const controls = await tx.select().from(preHeatTreatmentControls).where(inArray(preHeatTreatmentControls.weldJointId, rows.map(row => row.id)))
    await syncPreHeatTreatmentDocumentsInTransaction(tx, rows, controls)
  })
})
test.afterEach(async ({ page }) => {
  await page.close()
  await withE2eDatabase(async db => {
    await db.query('delete from document_templates where blob_key=$1', [fileKey])
    await db.query("delete from generated_documents where title like 'E2E-STAGE-%'")
  })
  await cleanupLineProgramProjects([project])
  await store.delete(fileKey)
})
async function builder(page: Page, category: string) {
  await page.getByRole('button', { name: new RegExp(`^${category} `) }).click()
  await page.getByRole('button', { name: 'Открыть конструктор', exact: true }).click()
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Конструктор шаблона', exact: true }) })
  await expect(dialog.getByRole('cell', { name: 'Ячейка A2', exact: true })).toBeVisible()
  return dialog
}

test('shared LNK constructor opens legacy bindings, cancels safely, saves and reopens; general stages and clipboard remain usable', async ({ page }, info) => {
  const original = await stored('lnkConclusionVik'), common = await stored('weldingJournal')
  await page.goto('/settings')
  let dialog = await builder(page, 'Заключения ЛНК')
  await expect(dialog.getByText('Поля НК заполняются по этапу текущего документа:', { exact: false })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'A2 Дефекты ВИК', exact: true })).toBeVisible()
  await dialog.getByRole('cell', { name: 'Ячейка A2', exact: true }).click()
  const fields = dialog.locator('select').filter({ has: page.locator('optgroup') }).first()
  await expect(fields.locator('option[value="preVikDefectDescription"]')).toHaveCount(0)
  await expect(fields).toHaveValue('vikDefectDescription')
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click()
  expect(await stored('lnkConclusionVik')).toEqual(original)
  dialog = await builder(page, 'ЖСР')
  await dialog.getByRole('cell', { name: 'Ячейка B2', exact: true }).click()
  const commonFields = dialog.locator('select').filter({ has: page.locator('optgroup') }).first()
  await expect(commonFields.locator('option[value="preVikDefectDescription"]')).toHaveCount(1)
  await expect(commonFields).toHaveValue('preVikDefectDescription')
  await dialog.getByRole('cell', { name: 'Ячейка B2', exact: true }).click({ button: 'right' })
  await page.getByRole('button', { name: 'Копировать содержимое', exact: true }).click()
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click()
  dialog = await builder(page, 'Заключения ЛНК')
  await dialog.getByRole('cell', { name: 'Ячейка A1', exact: true }).click({ button: 'right' })
  await page.getByRole('button', { name: 'Вставить содержимое', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'A1 Дефекты ВИК', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Сохранить конструктор', exact: true }).click()
  await expect(dialog).toBeHidden()
  const saved = JSON.parse((await stored('lnkConclusionVik')).constructor_config)
  expect(saved.bindings.find((binding: { cell: string }) => binding.cell === 'A2').parts[0].field).toBe('vikDefectDescription')
  expect(saved.bindings.find((binding: { cell: string }) => binding.cell === 'A1').parts[0].field).toBe('vikDefectDescription')
  expect(await stored('weldingJournal')).toEqual(common)
  await page.reload()
  dialog = await builder(page, 'Заключения ЛНК')
  await expect(dialog.getByRole('button', { name: 'A2 Дефекты ВИК', exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'A1 Дефекты ВИК', exact: true })).toBeVisible()
  await dialog.screenshot({ path: info.outputPath('shared-stage-fields.png') })
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click()
})

test('unresaved legacy templates preview and export the correct stage; the general document contains both', async ({ page }) => {
  test.setTimeout(120_000)
  const calls: string[] = [], errors: string[] = []
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  page.on('pageerror', error => errors.push(error.message))
  const originals = await Promise.all(ids.map(stored))
  await page.goto('/documents')
  for (const [view, suffix, method] of [['Заявка ЛНК', 'REQ', 'ВИК'], ['Заключения ЛНК', 'VIK', 'ВИК'], ['Заключения ЛНК', 'RK', 'РК']]) {
    await page.getByRole('button', { name: view, exact: true }).click()
    for (const before of [false, true]) {
      const start = calls.length
      await page.getByRole('button', { name: title(before, suffix), exact: true }).click()
      const modal = page.getByRole('dialog', { name: 'Предпросмотр документа', exact: true })
      const defect = `${method === 'РК' ? '0-100: ' : ''}${before ? 'до ТО' : 'основной'} ${method}`
      const text = await previewSheetText(modal)
      expect(text).toContain(defect)
      expect(text).toContain(title(before, 'REQ'))
      expect(text).toContain(before ? '02.10.2026' : '05.10.2026')
      expect(text).toContain(before ? 'вырез' : 'ремонт')
      expect(text).toContain(before ? '03.10.2026' : '06.10.2026')
      if (suffix === 'REQ' && before) for (const value of ['0-100: до ТО РК', 'до ТО УЗК', 'до ТО ПВК']) expect(text).toContain(value)
      const pendingDownload = page.waitForEvent('download')
      await modal.getByRole('button', { name: 'Скачать Excel', exact: true }).click()
      const sheet = XLSX.read(await readFile((await (await pendingDownload).path())!), { type: 'buffer' }).Sheets.Бланк
      expect(sheet.C2.v).toBe(title(before, 'REQ')); expect(sheet.D2.v).toBe(before ? '02.10.2026' : '05.10.2026'); expect(sheet.E2.v).toBe(before ? 'вырез' : 'ремонт'); expect(sheet.G2.v).toBe(before ? '03.10.2026' : '06.10.2026'); expect(sheet.A2.v).toBe(defect); expect(sheet.B2.v).toBe(defect); expect(sheet.H2.v).toBe(title(before, suffix))
      expect(calls.slice(start).filter(name => name.startsWith('getSystemDocumentRows'))).toHaveLength(1)
      await page.keyboard.press('Escape')
      await expect(modal).toBeHidden()
    }
  }
  await page.getByRole('button', { name: 'ЖСР', exact: true }).click()
  await page.getByRole('button', { name: 'E2E-STAGE-GENERAL', exact: true }).click()
  const modal = page.getByRole('dialog', { name: 'Предпросмотр документа', exact: true })
  const common = await previewSheetText(modal)
  for (const value of ['основной ВИК', 'до ТО ВИК', '0-100: основной РК', 'до ТО РК']) expect(common).toContain(value)
  await modal.getByRole('button', { name: 'Закрыть предпросмотр', exact: true }).click()
  expect(await Promise.all(ids.map(stored))).toEqual(originals)
  expect(errors).toEqual([])
})
