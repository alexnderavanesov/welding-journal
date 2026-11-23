import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import * as XLSX from 'xlsx'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { documentGridRow } from '../document-grid'
import { downloadPreviewExcel, previewSheetText } from '../document-sheet'
import { deserializeRpcPayload, deserializeRpcResponse, rpcName } from '../rpc'
import { chooseSpecialist } from '../specialist-helpers'
import { asE2eOwner } from '../with-owner-access'
import { requireDb } from '../../src/db'
import { weldJoints } from '../../src/db/schema'
import { syncSystemDocumentsForWeldChangesInTransaction } from '../../src/server/system-document-index'
import { changeSystemDocumentDate as rawChangeDate } from '../../src/server/system-document-date-workflow'
import { applySpecialistAssignments } from '../../src/server/specialists'
import { persistLayeredControlDocumentWrites } from '../../src/server/layered-control-documents'
import { ensureDispatcherTaskIndexFresh } from '../../src/server/dispatcher-task-index'
import { createDocumentTemplateFileStore, resolveDocumentTemplateStorageDirectory } from '../../src/server/document-template-files'

const project = 'E2E certificate validity'
const prefix = 'E2E удостоверения '
const changeDate = asE2eOwner(rawChangeDate, 'documents.edit')
const dated = { number: 'СРОК-2025', validFrom: '2025-01-01', validTo: '2025-12-31', methods: ['ВИК'] }
const fallback = { number: 'БЕЗ-ДАТ', validFrom: null, validTo: null, methods: ['ВИК'] }
const templateStore = createDocumentTemplateFileStore(resolveDocumentTemplateStorageDirectory())
let templateFileKey = ''
test.afterEach(async ({ page }) => {
  await page.close()
  await cleanupLineProgramProjects([project])
  await withE2eDatabase(async db => {
    await db.query('delete from specialists where name like $1', [prefix + '%'])
    if (templateFileKey) await db.query('delete from document_templates where blob_key=$1', [templateFileKey])
  })
  if (templateFileKey) await templateStore.delete(templateFileKey)
  templateFileKey = ''
})

test('certificate cards use shared checkboxes, validate periods and search every number', async ({ page }) => {
  await page.goto('/references')
  await page.getByRole('tab', { name: 'Специалисты', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить специалиста', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Добавление специалиста', exact: true })
  await dialog.getByLabel('ФИО', { exact: true }).fill(prefix + 'Карточка')
  const cards = dialog.locator('details')
  await cards.nth(0).getByLabel('№ квалификационного удостоверения', { exact: true }).fill('УД-ПЕРВОЕ')
  await cards.nth(0).getByLabel('Действует с', { exact: true }).fill('2025-01-01')
  await cards.nth(0).getByLabel('Действует по', { exact: true }).fill('2025-05-01')
  await cards.nth(0).getByLabel('ВИК', { exact: true }).check()
  expect(await cards.nth(0).getByLabel('ВИК', { exact: true }).evaluate(input => getComputedStyle(input).borderRadius)).toBe('5px')
  await dialog.getByRole('button', { name: 'Добавить удостоверение', exact: true }).click()
  await cards.nth(1).getByLabel('№ квалификационного удостоверения', { exact: true }).fill('УД-ВТОРОЕ')
  await cards.nth(1).getByLabel('Действует с', { exact: true }).fill('2025-05-01')
  await cards.nth(1).getByLabel('Действует по', { exact: true }).fill('2025-12-31')
  await cards.nth(1).getByLabel('ВИК', { exact: true }).check()
  await dialog.getByRole('button', { name: 'Сохранить специалиста', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('пересекаются')
  await cards.nth(1).getByLabel('Действует с', { exact: true }).fill('2025-05-02')
  await cards.nth(0).locator('summary').click()
  await dialog.screenshot({ path: '/private/tmp/specialist-certificates-desktop.png' })
  await dialog.getByRole('button', { name: 'Сохранить специалиста', exact: true }).click()
  await expect(dialog).toBeHidden()
  await page.getByRole('searchbox', { name: 'Поиск специалистов в справочнике' }).fill('УД-ВТОРОЕ')
  const row = page.getByRole('row').filter({ hasText: prefix + 'Карточка' })
  await expect(row).toBeVisible()
  await expect(row).toContainText('УД-ПЕРВОЕ; УД-ВТОРОЕ')
  await row.getByRole('button', { name: 'Изменить', exact: true }).click()
  const edit = page.getByRole('dialog', { name: 'Редактирование специалиста', exact: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await edit.screenshot({ path: '/private/tmp/specialist-certificates-mobile.png' })
  expect(await edit.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  expect(await edit.locator('form').evaluate(element => [...element.querySelectorAll('input, summary')].every(child => child.getBoundingClientRect().right <= element.getBoundingClientRect().right + 1))).toBe(true)
  await edit.getByRole('button', { name: 'Отмена', exact: true }).click()
})

test('SQL eligibility precedes pagination; batch snapshots, date changes, rollback and legacy history', async ({ page }) => {
  test.setTimeout(120000)
  const person = await withE2eDatabase(async db => {
    await db.query(`insert into specialists(name,kind,certificate,methods,certificates)
      select $1||'А истекшее '||n, 'inspector','ИСТЕКЛО',array['ВИК'],$2::jsonb from generate_series(1,105) n`,
    [prefix, JSON.stringify([{ ...dated, validFrom: '2024-01-01', validTo: '2024-12-31' }])])
    const person = (await db.query(`insert into specialists(name,kind,certificate,methods,certificates) values($1,'inspector','СРОК-2025',array['ВИК'],$2::jsonb) returning id`, [prefix + 'Я подходящий', JSON.stringify([fallback, dated])])).rows[0]
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,officiality,revision_actuality,has_vik,vik_request,vik_request_date,vik_result,vik_conclusion,vik_conclusion_date)
      select $1,'CERT','CERT-L'||n,'F-CERT-'||n,'2025-01-01','действующий','актуальная','да','CERT-request-'||n,'2025-01-01','годен','CERT-conclusion-'||n,case when n=1 then '2025-05-01'::date else '2026-01-01'::date end from generate_series(1,2) n`, [project])
    return person
  })
  await requireDb().transaction(async tx => {
    const rows = await tx.select().from(weldJoints).where(eq(weldJoints.projectTitle, project))
    await syncSystemDocumentsForWeldChangesInTransaction(tx, rows, new Map())
  })
  await page.goto('/documents')
  await page.getByRole('button', { name: 'Заключения ЛНК', exact: true }).click()
  for (const title of ['CERT-conclusion-1', 'CERT-conclusion-2']) await (await documentGridRow(page, title)).checkbox.check()
  await page.getByRole('button', { name: /^Действия с документами, выбрано:/ }).click()
  await page.getByRole('button', { name: 'Назначить специалистов', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Назначить специалистов', exact: true })
  const picker = dialog.getByRole('combobox', { name: 'Провёл контроль', exact: true })
  await picker.click()
  await page.getByRole('searchbox', { name: 'Поиск специалиста', exact: true }).fill(prefix)
  const list = page.getByRole('listbox')
  await expect(list.locator(`[data-specialist-id="${person.id}"]`)).toBeVisible()
  await expect(list.getByText(/А истекшее/)).toHaveCount(0)
  await chooseSpecialist(picker, person.id)
  await dialog.locator('summary').filter({ hasText: 'Изменения по документам' }).click()
  await expect(dialog).toContainText('СРОК-2025')
  await expect(dialog).toContainText('БЕЗ-ДАТ')
  await dialog.getByRole('button', { name: 'Применить', exact: true }).click()
  await expect(dialog).toBeHidden()
  const stored = () => withE2eDatabase(async db => (await db.query(`select d.id,d.title,d.period_from::text as date,d.specialists,w.id as row_id,w.xmin::text as version
    from generated_documents d join generated_document_weld_joints a on a.document_id=d.id join weld_joints w on w.id=a.weld_joint_id
    where w.project_title=$1 and d.type='system:lnkConclusionVik' order by d.title`, [project])).rows)
  const before = await stored()
  expect(before.map(document => document.specialists.first.certificate)).toEqual(['СРОК-2025', 'БЕЗ-ДАТ'])
  expect(before[0].specialists.first.certificateDate).toBe('2025-05-01')
  await withE2eDatabase(db => db.query('update specialists set certificates=$1::jsonb,revision=revision+1 where id=$2', [JSON.stringify([dated]), person.id]))
  const targets = await withE2eDatabase(async db => (await db.query('select id,specialists_revision as revision,updated_at,xmin::text as "documentVersion" from generated_documents where id=any($1::int[])', [before.map(document => document.id)])).rows.map(document => ({ id: document.id, revision: document.revision, documentVersion: document.documentVersion, updatedAt: document.updated_at.toISOString() })))
  await expect(applySpecialistAssignments({ documents: targets, selection: { first: person.id, second: person.id } })).rejects.toThrow('нет действующего удостоверения')
  expect(await stored()).toEqual(before)
  await withE2eDatabase(db => db.query('update specialists set certificates=$1::jsonb,revision=revision+1 where id=$2', [JSON.stringify([dated, fallback]), person.id]))
  const data = { reference: { documentId: before[0].id, type: 'lnkConclusion' as const, methodCode: 'ВИК', title: before[0].title, date: before[0].date }, nextDate: '2026-01-02', expectedVersions: [{ id: before[0].row_id, version: before[0].version }] }
  const message = await changeDate({ data }).then(() => '', error => String(error.message))
  expect(message).toContain('СРОК-2025 → № БЕЗ-ДАТ')
  expect(await stored()).toEqual(before)
  const confirmation = message.match(/specialist-confirmation:([a-f0-9]{64})/)![1]
  await changeDate({ data: { ...data, specialistCorrectionConfirmation: confirmation } })
  const changed = (await stored())[0]
  expect(changed.date).toBe('2026-01-02')
  expect(changed.specialists.first).toMatchObject({ certificate: 'БЕЗ-ДАТ', certificateDate: '2026-01-02' })
  await withE2eDatabase(db => db.query('update specialists set certificates=$1::jsonb,revision=revision+1 where id=$2', [JSON.stringify([dated]), person.id]))
  const rejected = { ...data, reference: { ...data.reference, date: changed.date }, nextDate: '2026-02-01', expectedVersions: [{ id: changed.row_id, version: changed.version }] }
  await expect(changeDate({ data: rejected })).rejects.toThrow('нет действующего удостоверения')
  expect((await stored())[0]).toEqual(changed)
  const legacy = { first: { ...changed.specialists.first } }; delete legacy.first.certificateDate
  await withE2eDatabase(db => db.query('update generated_documents set specialists=$1::jsonb where id=$2', [JSON.stringify(legacy), changed.id]))
  await changeDate({ data: rejected })
  expect((await stored())[0].specialists).toEqual(legacy)
})

test('shared conclusion browser date changes confirm certificates and preserve all three positions atomically', async ({ page }) => {
  test.setTimeout(120_000)
  const title = 'CERT-BROWSER-SHARED'
  const firstCertificate = { ...dated, number: 'УД-ЯНВАРЬ-МАЙ', validTo: '2025-05-01' }
  const nextCertificate = { ...dated, number: 'УД-ДЕКАБРЬ', validFrom: '2025-12-01' }
  const savedName = prefix + 'Общее заключение'
  const savedStamp = 'КЛЕЙМО-ИСТОРИЯ'
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))

  // The file oracle is a small real template, with no fabricated specialist
  // context. Preview/download must obtain the saved assignment themselves.
  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Провёл контроль', 'Удостоверение', 'Клеймо'], ['', '', ''],
    ['Стык', 'Заключение'], ['', ''],
  ])
  sheet['!cols'] = [{ wpx: 290 }, { wpx: 230 }, { wpx: 210 }]
  XLSX.utils.book_append_sheet(workbook, sheet, 'Удостоверения')
  const template = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  templateFileKey = `e2e-certificate-dates/${randomUUID()}.xlsx`
  await templateStore.set(templateFileKey, template)
  const person = await withLineProgramFixture(async db => {
    expect((await db.query("select id from document_templates where id='lnkConclusionVik'")).rows).toHaveLength(0)
    await db.query(`insert into document_templates(id,blob_key,file_name,file_type,file_size,metadata,constructor_config)
      values('lnkConclusionVik',$1,'certificate-dates.xlsx','xlsx',$2,$3,$4)`, [templateFileKey, template.byteLength,
      JSON.stringify({ fields: [], markerCount: 0, locations: [], warnings: [] }),
      JSON.stringify({ version: 1, sheetName: 'Удостоверения', repeatRow: 4, bindings: [
        { cell: 'A2', mode: 'summary', field: '__controlPerformedName' },
        { cell: 'B2', mode: 'summary', field: '__controlPerformedCertificate' },
        { cell: 'C2', mode: 'summary', field: '__controlPerformedStamp' },
        { cell: 'A4', mode: 'row', field: 'joint' },
        { cell: 'B4', mode: 'row', field: 'vikConclusion' },
      ] })])
    const person = (await db.query(`insert into specialists(name,kind,certificate,stamp,methods,certificates)
      values($1,'inspector',$2,$3,array['ВИК'],$4::jsonb) returning id`,
    [savedName, firstCertificate.number, savedStamp, JSON.stringify([firstCertificate, nextCertificate])])).rows[0]
    // The third joint has a later request. Moving the common conclusion before
    // that request must fail even though the first two joints allow the date.
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,officiality,revision_actuality,
      has_vik,psto_required,vik_request,vik_request_date,vik_result,vik_conclusion,vik_conclusion_date,vik_defect_description)
      select $1,'CERT-BROWSER','CERT-BROWSER-L','F-CERT-BROWSER-'||n,
        case when n=3 then '2025-04-20'::date else '2025-01-01'::date end,null,'актуальная',
        'да','нет','CERT-BROWSER-REQUEST-'||n,
        case when n=3 then '2025-04-21'::date else '2025-01-02'::date end,'годен',$2,'2025-05-01','ДНО'
      from generate_series(1,3) n`, [project, title])
    return person
  })
  await requireDb().transaction(async tx => {
    const rows = await tx.select().from(weldJoints).where(eq(weldJoints.projectTitle, project))
    await syncSystemDocumentsForWeldChangesInTransaction(tx, rows, new Map())
  })
  // Settle dispatcher-derived fields before recording xmin: a cancelled action
  // must be compared with its own initial state, not with unfinished fixture work.
  await ensureDispatcherTaskIndexFresh()
  const target = await withE2eDatabase(async db => (await db.query(`select id,specialists_revision as revision,updated_at,
    xmin::text as "documentVersion" from generated_documents where type='system:lnkConclusionVik' and title=$1`, [title])).rows[0])
  await applySpecialistAssignments({ documents: [{ id: target.id, revision: target.revision,
    updatedAt: target.updated_at.toISOString(), documentVersion: target.documentVersion }], selection: { first: person.id, second: null } })
  // Date revalidation must not silently replace the historical FIO or stamp.
  await withE2eDatabase(db => db.query('update specialists set name=$1,stamp=$2,revision=revision+1 where id=$3',
    [savedName + ' новое ФИО', 'НОВОЕ КЛЕЙМО', person.id]))
  const stored = () => withE2eDatabase(async db => ({
    rows: (await db.query(`select id,joint,weld_date::text,vik_request,vik_request_date::text,vik_result,
      vik_conclusion,vik_conclusion_date::text,vik_defect_description,updated_at,xmin::text as version
      from weld_joints where project_title=$1 order by id`, [project])).rows,
    documents: (await db.query(`select d.id,d.title,d.period_from::text,d.period_to::text,d.row_count,
      d.specialists,d.specialists_revision,d.updated_at,d.xmin::text as version,
      array(select a.weld_joint_id from generated_document_weld_joints a where a.document_id=d.id order by a.weld_joint_id) as row_ids
      from generated_documents d where d.type='system:lnkConclusionVik' and exists (
        select 1 from generated_document_weld_joints a join weld_joints w on w.id=a.weld_joint_id
        where a.document_id=d.id and w.project_title=$1) order by d.id`, [project])).rows,
  }))

  await page.goto('/lnk')
  await page.locator('header').getByRole('button', { name: 'Результат', exact: true }).click()
  await page.getByRole('button', { name: 'Все результаты ЛНК', exact: true }).click()
  const manager = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Все результаты ЛНК', exact: true }) })
  await manager.getByRole('tab', { name: 'Документы', exact: true }).click()
  const pane = manager.getByRole('tabpanel', { name: 'Документы', exact: true })
  await pane.getByPlaceholder('Поиск документов').fill(title)
  await pane.getByRole('complementary').getByRole('button').filter({ hasText: title }).click()
  for (const number of [1, 2, 3]) await expect(pane.getByRole('region', { name: 'Полный состав документа' }))
    .toContainText(`F-CERT-BROWSER-${number}`)
  await pane.getByRole('button', { name: 'Редактировать', exact: true }).click()
  const date = pane.getByLabel('Дата документа', { exact: true })
  const save = pane.getByRole('button', { name: 'Сохранить изменения документа', exact: true })
  const ordinaryConfirm = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Сохранить изменения документа', exact: true }) })
  const certificateConfirm = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Изменить удостоверения специалистов?', exact: true }) })
  const before = await stored()
  expect(before.documents).toHaveLength(1)
  expect(before.documents[0]).toMatchObject({ id: target.id, row_count: 3, row_ids: before.rows.map(row => row.id),
    specialists: { first: { id: person.id, name: savedName, stamp: savedStamp, certificate: firstCertificate.number, certificateDate: '2025-05-01' }, second: null } })
  await date.fill('2025-12-01')
  await save.click()
  await expect(ordinaryConfirm).toContainText('3 поз. в 3 ст.')
  await expect(ordinaryConfirm).toContainText('Стыки не выделяются')
  await ordinaryConfirm.getByRole('button', { name: 'Отмена', exact: true }).click()
  await expect(ordinaryConfirm).toBeHidden()
  await expect(date).toHaveValue('2025-12-01')
  expect(await stored()).toEqual(before)

  await save.click()
  await ordinaryConfirm.getByRole('button', { name: 'Сохранить изменения', exact: true }).click()
  await expect(certificateConfirm).toContainText(`${firstCertificate.number} → № ${nextCertificate.number}`)
  await expect(certificateConfirm).toContainText('Пока ничего не сохранено')
  expect(await stored()).toEqual(before)
  await certificateConfirm.getByRole('button', { name: 'Отмена', exact: true }).click()
  await expect(certificateConfirm).toBeHidden()
  await expect(date).toHaveValue('2025-12-01')
  expect(await stored()).toEqual(before)
  // Cancellation is not a validation failure. Retry the unchanged draft directly,
  // without editing a field or using the composition reload button as a workaround.
  await expect(save).toBeEnabled()
  await save.click()
  await ordinaryConfirm.getByRole('button', { name: 'Сохранить изменения', exact: true }).click()
  await expect(certificateConfirm).toContainText(`${firstCertificate.number} → № ${nextCertificate.number}`)
  await certificateConfirm.getByRole('button', { name: 'Подтвердить изменения', exact: true }).click()
  await expect.poll(async () => (await stored()).documents[0]?.period_from).toBe('2025-12-01')
  await expect(pane.getByText('Дата: 01.12.2025 · Стыков: 3', { exact: true })).toBeVisible()
  const saved = await stored()
  expect(saved.documents).toHaveLength(1)
  expect(saved.documents[0]).toMatchObject({ id: target.id, title, row_count: 3, row_ids: before.documents[0].row_ids,
    period_from: '2025-12-01', period_to: '2025-12-01',
    specialists: { first: { ...before.documents[0].specialists.first, certificate: nextCertificate.number, certificateDate: '2025-12-01' }, second: null } })
  expect(saved.rows.map(({ updated_at: _updated, version: _version, ...row }) => row))
    .toEqual(before.rows.map(({ updated_at: _updated, version: _version, ...row }) => ({ ...row, vik_conclusion_date: '2025-12-01' })))

  await pane.getByRole('button', { name: 'Редактировать', exact: true }).click()
  await date.fill('2025-06-01')
  await save.click()
  await ordinaryConfirm.getByRole('button', { name: 'Сохранить изменения', exact: true }).click()
  await expect(pane.getByText(/Сохранение заблокировано:.*нет действующего удостоверения/)).toBeVisible()
  await expect(certificateConfirm).toBeHidden()
  expect(await stored()).toEqual(saved)
  await date.fill('2025-04-15')
  await expect(save).toBeDisabled()
  await expect(pane.getByText(/Сохранение заблокировано:.*F-CERT-BROWSER-3.*раньше/)).toBeVisible()
  expect(await stored()).toEqual(saved)

  await page.goto('/documents')
  await page.getByRole('button', { name: 'Заключения ЛНК', exact: true }).click()
  // Scope the real registry to this fixture before opening its menu: other
  // workflows retain documents, and a mounted overscan row is not yet visible.
  const searched = page.waitForResponse(response => {
    const request = response.request()
    return rpcName(request.url()) === 'listSystemDocumentHistoryGrid_createServerFn_handler'
      && (deserializeRpcPayload(request.postData()!) as { data: { search?: string } }).data.search === title
  })
  const exportGrid = page.locator('[data-document-history-grid]')
  await exportGrid.getByRole('textbox', { name: 'Поиск документов', exact: true }).fill(title)
  const response = await searched
  expect(response.ok()).toBe(true)
  const searchResult = await deserializeRpcResponse(await response.text()) as {
    result?: { rowCount: number; rows: Array<{ title: string }> }; error?: unknown
  }
  expect(searchResult.error).toBeUndefined()
  expect(searchResult.result).toMatchObject({ rowCount: 1, rows: [{ title }] })
  await expect(exportGrid.locator('.ag-row [data-document-title-button]')).toHaveCount(1)
  const exported = await documentGridRow(page, title)
  await exported.titleCell.getByRole('button', { name: title, exact: true }).click({ button: 'right' })
  await page.getByRole('button', { name: 'Предпросмотр', exact: true }).click()
  const preview = page.getByRole('dialog', { name: 'Предпросмотр документа', exact: true })
  const text = await previewSheetText(preview)
  expect(text).toContain(nextCertificate.number)
  expect(text).not.toContain(firstCertificate.number)
  const file = await downloadPreviewExcel(page, preview)
  expect(file.workbook.SheetNames).toEqual(['Удостоверения'])
  const exportedSheet = file.workbook.Sheets['Удостоверения']
  expect(['A2', 'B2', 'C2'].map(cell => exportedSheet[cell]?.v)).toEqual([savedName, nextCertificate.number, savedStamp])
  expect(['A4', 'A5', 'A6'].map(cell => exportedSheet[cell]?.v).sort())
    .toEqual(['F-CERT-BROWSER-1', 'F-CERT-BROWSER-2', 'F-CERT-BROWSER-3'])
  expect(['B4', 'B5', 'B6'].map(cell => exportedSheet[cell]?.v)).toEqual([title, title, title])
  expect(errors).toEqual([])
})

test('layered conclusion date rechecks its assignment and rolls back an ineligible change', async () => {
  const seed = await withE2eDatabase(async db => {
    const person = (await db.query(`insert into specialists(name,kind,certificate,methods,certificates) values($1,'inspector','СРОК-2025',array['ВИК'],$2::jsonb) returning id`, [prefix + 'Послойный', JSON.stringify([dated, fallback])])).rows[0]
    const row = (await db.query(`insert into weld_joints(project_title,line,joint,weld_date) values($1,'CERT-LAYER','F-CERT-LAYER','2025-05-01') returning id`, [project])).rows[0]
    const doc = (await db.query(`insert into generated_documents(type,title,file_name,mime_type,period_from,period_to,row_count,document_number)
      values('layeredVikEdges','CERT-LAYER','layer.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','2025-05-01','2025-05-01',1,990001)
      returning id,specialists_revision as revision,updated_at,xmin::text as "documentVersion"`)).rows[0]
    await db.query('insert into generated_document_weld_joints(document_id,weld_joint_id) values($1,$2)', [doc.id, row.id])
    // Membership insertion changes the document version: use the stored version.
    const target = (await db.query('select id,specialists_revision as revision,updated_at,xmin::text as "documentVersion" from generated_documents where id=$1', [doc.id])).rows[0]
    return { person, row, doc: { id: target.id, revision: target.revision, documentVersion: target.documentVersion, updatedAt: target.updated_at.toISOString() } }
  })
  await applySpecialistAssignments({ documents: [seed.doc], selection: { first: seed.person.id } })
  const change = (previousDate: string, date: string) => requireDb().transaction(tx => persistLayeredControlDocumentWrites(tx, [{ rowId: seed.row.id, type: 'layeredVikEdges', targetDocumentId: seed.doc.id, title: 'CERT-LAYER', fileName: 'layer.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', previousDate, periodFrom: date, periodTo: date, rowCount: 1, wdiTotal: 0, documentNumber: 990001, shouldUpdate: true }]))
  const read = () => withE2eDatabase(async db => (await db.query('select specialists,period_from::text as date,xmin::text as version from generated_documents where id=$1', [seed.doc.id])).rows[0])
  await change('2025-05-01', '2026-01-01')
  const saved = await read()
  expect(saved).toMatchObject({ date: '2026-01-01', specialists: { first: { certificate: 'БЕЗ-ДАТ', certificateDate: '2026-01-01' } } })
  await withE2eDatabase(db => db.query('update specialists set certificates=$1::jsonb,revision=revision+1 where id=$2', [JSON.stringify([dated]), seed.person.id]))
  await expect(change('2026-01-01', '2026-02-01')).rejects.toThrow('нет действующего удостоверения')
  expect(await read()).toEqual(saved)
})
