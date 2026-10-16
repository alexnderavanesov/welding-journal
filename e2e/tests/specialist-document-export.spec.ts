import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { eq } from 'drizzle-orm'
import { expect, test, type Page } from '@playwright/test'
import * as XLSX from 'xlsx'
import { requireDb } from '../../src/db'
import { weldJoints } from '../../src/db/schema'
import { createDocumentTemplateFileStore, resolveDocumentTemplateStorageDirectory } from '../../src/server/document-template-files'
import { syncSystemDocumentsForWeldChangesInTransaction } from '../../src/server/system-document-index'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { chooseSpecialist } from '../specialist-helpers'

const project = 'E2E specialist document export'
const store = createDocumentTemplateFileStore(resolveDocumentTemplateStorageDirectory())
let fileKey = ''
let personIds: number[] = []

test.afterEach(async ({ page }) => {
  await page.close()
  await cleanupLineProgramProjects([project])
  await withE2eDatabase(async db => {
    await db.query('delete from document_templates where blob_key=$1', [fileKey])
    await db.query('delete from specialists where id=any($1::int[])', [personIds])
  })
  if (fileKey) await store.delete(fileKey)
  fileKey = ''
  personIds = []
})

async function seedDocument(thermist: boolean, title: string) {
  const book = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Провёл контроль', 'Удостоверение', 'Выдал заключение', 'Удостоверение', 'Оператор-термист', 'Удостоверение', 'Руководитель по ТО', 'Удостоверение'],
    ['', '', '', '', '', '', '', ''],
    ['Стык'],
    [''],
  ])
  sheet['!cols'] = Array.from({ length: 8 }, () => ({ wpx: 230 }))
  XLSX.utils.book_append_sheet(book, sheet, 'Подписи')
  const data = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  fileKey = `e2e-specialist-export/${randomUUID()}.xlsx`
  await store.set(fileKey, data)
  const templateId = thermist ? 'pstoConclusion' : 'lnkConclusionVik'
  // Fixture setup supplies the blank template and factual control only. No
  // specialist snapshot or template context is fabricated by this test.
  const fields = [
    '__controlPerformedName', '__controlPerformedCertificate', '__conclusionIssuedName', '__conclusionIssuedCertificate',
    '__thermistOperatorName', '__thermistOperatorCertificate', '__heatTreatmentSupervisorName', '__heatTreatmentSupervisorCertificate',
  ]
  await withE2eDatabase(async db => {
    expect((await db.query('select id from document_templates where id=$1', [templateId])).rows).toHaveLength(0)
    await db.query(`insert into document_templates(id,blob_key,file_name,file_type,file_size,metadata,constructor_config)
      values ($1,$2,'specialist-signatures.xlsx','xlsx',$3,$4,$5)`, [templateId, fileKey, data.byteLength,
      JSON.stringify({ fields: [], markerCount: 0, locations: [], warnings: [] }),
      JSON.stringify({ version: 1, sheetName: 'Подписи', repeatRow: 4, bindings: [
        ...fields.map((field, index) => ({ cell: `${String.fromCharCode(65 + index)}2`, mode: 'summary', field })),
        { cell: 'A4', mode: 'row', field: 'joint' },
      ] })])
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,officiality,revision_actuality,
      has_vik,vik_result,vik_request,vik_request_date,vik_conclusion,vik_conclusion_date,
      psto_required,psto_request,psto_request_date,psto_result,psto_date,heat_treatment_diagram)
      values ($1,'SIGNATURES','SIGNATURES-L','F-SIGNATURES','2026-10-01','действующий','актуальная',
        'да','годен','SIGNATURES-VIK-R','2026-10-01',$2,'2026-10-02',
        case when $3::boolean then 'да' else null end,
        case when $3::boolean then 'SIGNATURES-PSTO-R' else null end,
        case when $3::boolean then '2026-10-02'::date else null end,
        case when $3::boolean then 'проведено' else null end,
        case when $3::boolean then '2026-10-03'::date else null end,
        case when $3::boolean then $4 else null end)`, [project, thermist ? 'SIGNATURES-VIK-C' : title, thermist, title])
  })
  await requireDb().transaction(async tx => {
    const rows = await tx.select().from(weldJoints).where(eq(weldJoints.projectTitle, project))
    await syncSystemDocumentsForWeldChangesInTransaction(tx, rows, new Map())
  })
}

async function createPerson(page: Page, name: string, certificate: string, thermist: boolean) {
  await page.getByRole('button', { name: 'Добавить специалиста', exact: true }).click()
  await page.getByLabel('ФИО', { exact: true }).fill(name)
  if (thermist) await page.getByLabel('Тип специалиста', { exact: true }).selectOption('thermist')
  else await page.getByLabel('ВИК', { exact: true }).check()
  await page.getByLabel('№ квалификационного удостоверения', { exact: true }).fill(certificate)
  await page.getByRole('button', { name: 'Сохранить специалиста', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Добавление специалиста', exact: true })).toBeHidden()
  const id = await withE2eDatabase(async db => (await db.query<{ id: number }>('select id from specialists where name=$1', [name])).rows[0].id)
  personIds.push(id)
  return id
}

async function openDocuments(page: Page, thermist: boolean) {
  await page.goto('/documents')
  await page.getByRole('button', { name: thermist ? 'Заключение ПСТО' : 'Заключения ЛНК', exact: true }).click()
}

async function readDownloadedSignatures(page: Page, title: string, expectedNames: string[]) {
  await page.getByRole('button', { name: title, exact: true }).click({ button: 'right' })
  await page.getByRole('button', { name: 'Предпросмотр', exact: true }).click()
  const preview = page.getByRole('dialog', { name: 'Предпросмотр документа', exact: true })
  for (const value of expectedNames) await expect(preview.frameLocator('iframe').getByText(value, { exact: true })).toBeVisible()
  const downloading = page.waitForEvent('download')
  await preview.getByRole('button', { name: 'Скачать Excel', exact: true }).click()
  const download = await downloading
  expect(await download.failure()).toBeNull()
  const path = await download.path()
  expect(path).toBeTruthy()
  // Read the actual file delivered by the UI and compare fixed cell values;
  // never invoke the application workbook builder to construct the oracle.
  const workbook = XLSX.read(await readFile(path!), { type: 'buffer' })
  expect(workbook.SheetNames).toEqual(['Подписи'])
  const sheet = workbook.Sheets['Подписи']
  expect(sheet.A4?.v).toBe('F-SIGNATURES')
  const values = ['A2', 'B2', 'C2', 'D2', 'E2', 'F2', 'G2', 'H2'].map(cell => sheet[cell]?.v ?? '')
  await preview.getByRole('button', { name: 'Закрыть предпросмотр', exact: true }).click()
  return values
}

for (const thermist of [false, true]) test(`${thermist ? 'ПСТО' : 'ВИК'}: UI-назначение попадает в реальный Excel и сохраняет исторические ФИО/удостоверения после правки карточки`, async ({ page }) => {
  test.setTimeout(120_000)
  const title = thermist ? 'E2E-SIGNATURES-PSTO' : 'E2E-SIGNATURES-VIK'
  const firstName = `E2E ${thermist ? 'термист' : 'дефектоскопист'} подпись А`
  const secondName = `E2E ${thermist ? 'термист' : 'дефектоскопист'} подпись Б`
  const updatedName = `${firstName} новое ФИО`
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await seedDocument(thermist, title)
  await page.goto('/references')
  await page.getByRole('tab', { name: 'Специалисты', exact: true }).click()
  const first = await createPerson(page, firstName, 'УД-ИСТОРИЯ-А', thermist)
  const second = await createPerson(page, secondName, 'УД-ИСТОРИЯ-Б', thermist)
  await openDocuments(page, thermist)
  await page.getByRole('button', { name: `Выбрать документ «${title}»`, exact: true }).click()
  await page.getByRole('button', { name: /^Действия с документами, выбрано:/ }).click()
  await page.getByRole('button', { name: 'Назначить специалистов', exact: true }).click()
  const assignment = page.getByRole('dialog', { name: 'Назначить специалистов', exact: true })
  await chooseSpecialist(assignment.getByRole('combobox', { name: thermist ? 'Оператор-термист' : 'Провёл контроль', exact: true }), first)
  await chooseSpecialist(assignment.getByRole('combobox', { name: thermist ? 'Руководитель по ТО' : 'Выдал заключение', exact: true }), second)
  await assignment.getByRole('button', { name: 'Применить', exact: true }).click()
  await expect(assignment).toBeHidden()
  await openDocuments(page, thermist)
  const pair = [firstName, 'УД-ИСТОРИЯ-А', secondName, 'УД-ИСТОРИЯ-Б']
  const expected = thermist ? ['', '', '', '', ...pair] : [...pair, '', '', '', '']
  expect(await readDownloadedSignatures(page, title, [firstName, secondName])).toEqual(expected)

  await page.goto('/references')
  await page.getByRole('tab', { name: 'Специалисты', exact: true }).click()
  await page.getByRole('row').filter({ hasText: firstName }).getByRole('button', { name: 'Изменить', exact: true }).click()
  await page.getByLabel('ФИО', { exact: true }).fill(updatedName)
  await page.getByLabel('№ квалификационного удостоверения', { exact: true }).fill('УД-НОВОЕ')
  await page.getByRole('button', { name: 'Сохранить специалиста', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Редактирование специалиста', exact: true })).toBeHidden()
  await page.reload()
  await page.getByRole('tab', { name: 'Специалисты', exact: true }).click()
  await expect(page.getByRole('row').filter({ hasText: updatedName })).toContainText('УД-НОВОЕ')
  await openDocuments(page, thermist)
  expect(await readDownloadedSignatures(page, title, [firstName, secondName])).toEqual(expected)
  expect(errors).toEqual([])
})
