import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import * as XLSX from 'xlsx'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { asE2eOwner } from '../with-owner-access'
import { loadDocumentTemplateParticipants } from '../../src/server/document-participants'
import { documentGridRow } from '../document-grid'
import { createDocumentTemplateFileStore, resolveDocumentTemplateStorageDirectory } from '../../src/server/document-template-files'

const project = 'E2E participant template', label = 'Пользовательский 1'
const load = asE2eOwner(loadDocumentTemplateParticipants, 'documents.view')
const store = createDocumentTemplateFileStore(resolveDocumentTemplateStorageDirectory())

test('participant template config, exact roster, historic performers, categories and fresh Excel downloads', async ({ page }, info) => {
  test.setTimeout(120_000)
  page.setDefaultTimeout(15_000)
  const docs: number[] = [], stamps: number[] = []
  const ids = await withLineProgramFixture(async db => {
    expect((await db.query("select id from document_templates where id='custom1'")).rows).toEqual([])
    const rows = (await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,connection_type,stamp_1_k,stamp_1_z,stamp_1_k_fact)
      values($1,'PEOPLE','PEOPLE-L','F1','2026-11-04','С17','E2E-A','E2E-A','E2E-FACT'),
      ($1,'PEOPLE','PEOPLE-L','F2','2026-11-04','С17','E2E-11','E2E-B','E2E-FACT'),
      ($1,'PEOPLE','OTHER-L','F3','2026-11-05','С17',null,null,null) returning id`, [project])).rows.map(row => row.id as number)
    for (const [name, code, internal] of [['Иванов', 'E2E-A', 'E2E-11'], ['Иванов', 'E2E-B', 'E2E-12'], ['Фактический сварщик', 'E2E-FACT', 'E2E-13']]) {
      stamps.push((await db.query('insert into welder_stamps(welder_name,naks_stamp,internal_stamp,archived) values($1,$2,$3,true) returning id', [name, code, internal])).rows[0].id)
    }
    const second = { id: 500, name: 'Подписант — не включать', certificate: 'SIGN' }
    const inspector = { id: 501, name: 'Петров', certificate: 'OLD' }
    for (const [type, first, members, source] of [
      ['system:lnkConclusionVik', inspector, rows.slice(0, 2), 'primary'],
      ['system:lnkConclusionRk', inspector, [rows[0]], 'beforeHeatTreatment'],
      ['system:tvmtConclusion', { ...inspector, certificate: 'NEW' }, [rows[1]], 'repeat'],
      ['system:pstoConclusion', { id: 502, name: 'Сидоров', certificate: 'THERM' }, [rows[0]], 'repeat'],
      ['system:lnkRequest', second, [rows[0]], 'primary'],
      ['system:lnkConclusionUzk', { ...second, name: 'Чужой стык' }, [rows[2]], 'primary'],
    ] as const) {
      const id = (await db.query(`insert into generated_documents(type,title,file_name,mime_type,period_from,row_count,specialists,source_metadata)
        values($1,$2,'fixture.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','2026-11-04',$3,$4,$5) returning id`, [type, `${project}-${docs.length}`, members.length, JSON.stringify({ first, second }), JSON.stringify({ sourceKind: source })])).rows[0].id
      docs.push(id)
      for (const rowId of members) await db.query('insert into generated_document_weld_joints(document_id,weld_joint_id) values($1,$2)', [id, rowId])
    }
    return rows
  })
  try {
    const selected = ids.slice(0, 2)
    const participants = await load({ rowIds: selected, kinds: ['welder', 'thermist', 'inspector'] })
    expect(participants.map(person => [person.kind, person.name, person.certificate, person.stamp])).toEqual([
      ['welder', 'Иванов', '', 'E2E-A'], ['welder', 'Иванов', '', 'E2E-B'], ['thermist', 'Сидоров', 'THERM', ''],
      ['inspector', 'Петров', 'NEW', ''], ['inspector', 'Петров', 'OLD', ''],
    ])
    expect(await load({ rowIds: selected, kinds: ['thermist'] })).toEqual(participants.filter(person => person.kind === 'thermist'))
    await page.goto('/settings')
    await page.getByRole('tab', { name: 'Пользовательские', exact: true }).click()
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['СПИСОК'], ['№', 'ФИО', 'Специальность', 'Разряд', 'Удостоверение', 'Клеймо'], ['', '', '', '', '', ''], ['Подпись руководителя']]), 'Список')
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Загрузить первый шаблон', exact: true }).click()
    await (await chooser).setFiles({ name: 'participants.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer })
    await page.getByRole('button', { name: 'Открыть конструктор', exact: true }).click()
    const builder = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Конструктор шаблона', exact: true }) })
    for (const [cell, field] of [['A3', '__index'], ['B3', '__participantName'], ['C3', '__participantKind'], ['E3', '__participantCertificate'], ['F3', '__participantStamp']]) {
      await builder.getByRole('cell', { name: `Ячейка ${cell}`, exact: true }).click()
      await builder.getByRole('button', { name: 'Назначить данные', exact: true }).click()
      if (cell === 'A3') await builder.getByLabel('Создавать блок для', { exact: true }).selectOption('participants')
      await builder.getByRole('combobox', { name: 'Поле для заполнения ячейки', exact: true }).selectOption(field)
    }
    // Document summaries expose the full field catalogue, including group search.
    await builder.getByRole('cell', { name: 'Ячейка B1', exact: true }).click()
    await builder.getByRole('button', { name: 'Назначить данные', exact: true }).click()
    await builder.getByRole('combobox', { name: 'Поле для заполнения ячейки', exact: true }).selectOption('projectTitle')
    const fieldPicker = builder.getByRole('combobox', { name: 'Поле части 1', exact: true })
    const initialField = await fieldPicker.inputValue()
    await fieldPicker.click()
    const fieldSearch = page.getByRole('combobox', { name: 'Поиск: Поле части 1', exact: true })
    await expect(fieldSearch).toBeFocused()
    const popup = page.locator('[data-select-listbox]')
    const popupBounds = (await popup.boundingBox())!, fieldBounds = (await fieldPicker.boundingBox())!
    expect(popupBounds.width).toBeGreaterThan(fieldBounds.width)
    expect(popupBounds.width).toBeLessThanOrEqual(page.viewportSize()!.width - 16)
    expect(popupBounds.x).toBeGreaterThanOrEqual(8)
    expect(popupBounds.x + popupBounds.width).toBeLessThanOrEqual(page.viewportSize()!.width - 8)
    await fieldSearch.fill('официальному клейму')
    await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(6)
    await expect(fieldPicker).toHaveValue(initialField)
    await popup.screenshot({ path: info.outputPath('field-search.png') })
    await fieldSearch.fill('поле которого нет')
    await expect(popup.getByText('Ничего не найдено', { exact: true })).toBeVisible()
    await fieldSearch.press('Escape')
    await expect(builder).toBeVisible()
    await expect(fieldPicker).toHaveValue(initialField)
    await fieldPicker.click()
    await fieldSearch.fill('Проект')
    await fieldSearch.press('Enter')
    await expect(builder.getByRole('combobox', { name: 'Поле части 1', exact: true })).toHaveValue('projectTitle')
    await builder.getByRole('cell', { name: 'Ячейка F3', exact: true }).click()
    await expect(builder.getByRole('checkbox', { name: 'Сварщики', exact: true })).toBeChecked()
    await expect(builder.getByRole('checkbox', { name: 'Операторы-термисты', exact: true })).toBeChecked()
    await expect(builder.getByText('Данные участника работ', { exact: true })).toBeVisible()
    await builder.getByLabel('Создавать блок для', { exact: true }).scrollIntoViewIfNeeded()
    await builder.screenshot({ path: info.outputPath('participant-constructor.png') })
    await builder.getByRole('button', { name: 'Сохранить конструктор', exact: true }).click()
    await expect(builder).toBeHidden()
    await page.getByRole('button', { name: 'Открыть конструктор', exact: true }).click()
    await expect(builder.getByLabel('Создавать блок для', { exact: true })).toHaveValue('participants')
    await builder.getByRole('button', { name: 'Закрыть', exact: true }).click()
    await page.goto('/documents')
    await page.getByRole('button', { name: label, exact: true }).click()
    await page.getByRole('tab', { name: 'Формирование', exact: true }).click()
    await page.getByLabel('Период с', { exact: true }).fill('2026-11-04')
    await page.getByLabel('по', { exact: true }).fill('2026-11-04')
    await page.getByRole('button', { name: 'Сформировать', exact: true }).click()
    await expect(page.getByText(/сформирован и добавлен в историю/)).toBeVisible()
    const saved = await withE2eDatabase(async db => (await db.query("select * from generated_documents where type='custom1'")).rows)
    expect(saved).toHaveLength(1)
    const downloadSheet = async (page: Page) => {
      const row = await documentGridRow(page, saved[0].title)
      const pending = page.waitForEvent('download')
      await row.actions.getByTitle('Скачать Excel', { exact: true }).click()
      return XLSX.read(await readFile((await (await pending).path())!), { type: 'buffer' }).Sheets['Список']
    }
    await page.getByRole('tab', { name: 'История', exact: true }).click()
    const sheet = await downloadSheet(page)
    expect(Array.from({ length: 5 }, (_, i) => [sheet[`A${i + 3}`].v, sheet[`B${i + 3}`].v, sheet[`E${i + 3}`]?.v ?? ''])).toEqual([
      [1, 'Иванов', ''], [2, 'Иванов', ''], [3, 'Сидоров', 'THERM'], [4, 'Петров', 'NEW'], [5, 'Петров', 'OLD'],
    ])
    expect(sheet.A8.v).toBe('Подпись руководителя')
    expect(sheet.D3?.v ?? '').toBe('')
    await withE2eDatabase(db => db.query("update generated_documents set specialists=jsonb_set(specialists,'{first,name}',to_jsonb('Исправленный термист'::text)) where id=$1", [docs[3]]))
    expect((await downloadSheet(page)).B5.v).toBe('Исправленный термист')
    expect((await withE2eDatabase(db => db.query("select * from generated_documents where type='custom1'"))).rows).toEqual(saved)
  } finally {
    await page.close()
    await withE2eDatabase(async db => {
      await db.query("delete from document_templates where id='custom1'")
      await db.query('delete from generated_documents where id=any($1::int[])', [docs])
      await db.query('delete from welder_stamps where id=any($1::int[])', [stamps])
    })
    await cleanupLineProgramProjects([project])
    for (const key of await store.list('custom1/')) await store.delete(key)
  }
})
