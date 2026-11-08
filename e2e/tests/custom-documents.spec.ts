import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import * as XLSX from 'xlsx'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { documentGridRow } from '../document-grid'
import { journalRow, selectJournalJoint } from '../journal-grid'
import { createDocumentTemplateFileStore, resolveDocumentTemplateStorageDirectory } from '../../src/server/document-template-files'
import { listColumnFilterOptions, normalizeWeldColumnFilterOptionsRequest } from '../../src/server/weld-read'

const project = 'E2E custom document slots'
const store = createDocumentTemplateFileStore(resolveDocumentTemplateStorageDirectory())
const names = { custom1: 'Список сварщиков', custom2: 'Участники контроля' }
const types = ['custom1', 'custom2'] as const
const setting = () => withE2eDatabase(async db => (await db.query("select * from app_settings where key='custom-document-names'")).rows[0])
const documents = () => withE2eDatabase(async db => (await db.query("select * from generated_documents where type=any($1::text[]) order by id", [types])).rows)

async function settings(page: Page) {
  await page.goto('/settings')
  await page.getByRole('tab', { name: 'Пользовательские', exact: true }).click()
  await expect(page.getByLabel('Название пользовательского документа 1')).toBeVisible()
}

async function generate(page: Page, label: string, date: string) {
  await page.goto('/documents')
  await page.getByRole('button', { name: label, exact: true }).click()
  await page.getByRole('tab', { name: 'Формирование', exact: true }).click()
  await page.getByLabel('Период с', { exact: true }).fill(date)
  await page.getByLabel('по', { exact: true }).fill(date)
  await expect(page.getByText('Лист «Бланк»: показаны первые 1 из 1', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Сформировать', exact: true }).click()
  await expect(page.getByText(/сформирован и добавлен в историю/)).toBeVisible()
}

test('two custom templates: draft names, independent generation, rename preserves history, download and journal menus', async ({ page }, info) => {
  test.setTimeout(120_000)
  page.setDefaultTimeout(15_000)
  expect(process.env.DOCUMENT_TEMPLATE_STORAGE_PATH).toContain('welding-e2e-templates-')
  expect(await setting()).toBeUndefined()
  expect(await documents()).toEqual([])
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const ids = await withLineProgramFixture(async db => {
    expect((await db.query('select id from document_templates where id=any($1::text[])', [types])).rows).toEqual([])
    return (await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,connection_type,officiality,revision_actuality)
      values($1,'CUSTOM','CUSTOM-L','F1','2026-11-01','С17','действующий','актуальная'),
            ($1,'CUSTOM','CUSTOM-L','F2','2026-11-02','С17','действующий','актуальная') returning id`, [project])).rows.map(row => row.id as number)
  })
  try {
    await settings(page)
    await page.getByLabel('Название пользовательского документа 1').fill(names.custom1)
    await page.getByRole('button', { name: /^Пользовательский 2/ }).click()
    await page.getByLabel('Название пользовательского документа 2').fill(names.custom2)
    expect(await setting()).toBeUndefined()
    await page.getByRole('tab', { name: 'Системные', exact: true }).click()
    await expect(page.getByRole('button', { name: /Заключения ЛНК/ })).toBeVisible()
    await page.getByRole('tab', { name: 'Пользовательские', exact: true }).click()
    await expect(page.getByLabel('Название пользовательского документа 1')).toHaveValue(names.custom1)
    await page.getByRole('button', { name: 'Сохранить названия документов', exact: true }).click()
    await expect.poll(async () => JSON.parse((await setting())?.value ?? '{}')).toEqual(names)
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
    await page.screenshot({ path: info.outputPath('custom-document-names.png') })
    for (const [index, type] of types.entries()) {
      await page.getByRole('button', { name: new RegExp(`^${names[type]}`) }).click()
      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[`Бланк ${index + 1}`], ['{{joint}}']]), 'Бланк')
      const chooser = page.waitForEvent('filechooser')
      await page.getByRole('button', { name: 'Загрузить первый шаблон', exact: true }).click()
      await (await chooser).setFiles({ name: `${type}.xlsx`, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer })
      await expect(page.getByText(`${type}.xlsx`, { exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Открыть конструктор', exact: true }).click()
      const builder = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Конструктор шаблона', exact: true }) })
      await builder.getByRole('cell', { name: 'Ячейка A2', exact: true }).click()
      if (index === 0) await page.screenshot({ path: info.outputPath('custom-template-builder.png') })
      await builder.getByRole('button', { name: 'Назначить данные', exact: true }).click()
      await builder.getByRole('button', { name: 'Добавить поле в ячейку', exact: true }).click()
      await builder.locator('select').filter({ has: page.locator('optgroup') }).first().selectOption('joint')
      await builder.getByRole('button', { name: 'Сохранить конструктор', exact: true }).click()
      await expect(builder).toBeHidden()
      if (type === 'custom2') {
        await page.getByRole('checkbox', { name: /Учет только актуальных стыков/ }).check()
        await page.getByRole('button', { name: 'Сохранить параметры документа', exact: true }).click()
        await expect(page.getByText('Параметры документа сохранены.', { exact: true })).toBeVisible()
        const options = await withE2eDatabase(async db => (await db.query('select id,options from document_templates where id=any($1::text[]) order by id', [types])).rows)
        expect(options[0].options).toBeNull()
        expect(JSON.parse(options[1].options).custom2.actualOnly).toBe(true)
      }
    }
    await page.screenshot({ path: info.outputPath('custom-template-settings.png') })
    for (const type of types) await generate(page, names[type], '2026-11-01')
    const beforeRename = await documents()
    expect(beforeRename.map(row => row.type)).toEqual(types)
    expect(beforeRename.map(row => row.title)).toEqual(types.map(type => `${names[type]} - CUSTOM - 01.11.26 - 01.11.26`))
    const newName = 'Исполнители сварки'
    await settings(page)
    await page.getByLabel('Название пользовательского документа 1').fill('Не сохранять')
    await page.getByRole('button', { name: 'Сбросить изменения', exact: true }).click()
    await expect(page.getByLabel('Название пользовательского документа 1')).toHaveValue(names.custom1)
    await page.getByLabel('Название пользовательского документа 1').fill(newName)
    await page.getByRole('button', { name: 'Сохранить названия документов', exact: true }).click()
    await expect.poll(async () => JSON.parse((await setting()).value).custom1).toBe(newName)
    expect(await documents()).toEqual(beforeRename)
    await page.goto('/documents')
    await page.getByRole('button', { name: newName, exact: true }).click()
    await expect(page.getByRole('button', { name: names.custom1, exact: true })).toHaveCount(0)
    const oldRow = await documentGridRow(page, beforeRename[0].title)
    const pending = page.waitForEvent('download')
    await oldRow.actions.getByTitle('Скачать Excel', { exact: true }).click()
    const file = await pending
    expect(file.suggestedFilename()).toBe(beforeRename[0].file_name)
    const sheet = XLSX.read(await readFile((await file.path())!), { type: 'buffer' }).Sheets['Бланк']
    expect(sheet.A1.v).toBe('Бланк 1')
    expect(sheet.A2.v).toBe('F1')
    expect(await documents()).toEqual(beforeRename)
    await generate(page, newName, '2026-11-02')
    const after = await documents()
    expect(after).toHaveLength(3)
    expect(after.slice(0, 2)).toEqual(beforeRename)
    expect(after[2].title).toBe(`${newName} - CUSTOM - 02.11.26 - 02.11.26`)
    const filter = await listColumnFilterOptions(normalizeWeldColumnFilterOptionsRequest({ report: 'weldingJournal', fieldKey: 'custom1Document', columnFilters: { projectTitle: `=${project}` } }))
    expect(filter.map(option => option.value).sort()).toEqual([beforeRename[0].title, after[2].title].sort())
    await page.goto('/journal')
    await selectJournalJoint(page, ids[0])
    await journalRow(page, ids[0]).locator('[col-id="joint"]').click({ button: 'right' })
    await page.getByTestId('context-action-menu').getByRole('button', { name: 'Сформировать', exact: true }).hover()
    await page.getByRole('button', { name: newName, exact: true }).click()
    const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: `Формирование: ${newName}`, exact: true }) })
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Сформировать', exact: true }).click()
    await expect(page.getByRole('button', { name: names.custom2, exact: true })).toBeVisible()
    expect(errors).toEqual([])
  } finally {
    await page.close()
    await withE2eDatabase(async db => {
      await db.query('delete from document_templates where id=any($1::text[])', [types])
      await db.query("delete from app_settings where key='custom-document-names'")
    })
    await cleanupLineProgramProjects([project])
    for (const type of types) for (const key of await store.list(`${type}/`)) await store.delete(key)
  }
})
