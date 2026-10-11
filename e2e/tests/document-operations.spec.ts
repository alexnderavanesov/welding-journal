import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { rpcName } from '../rpc'
import { requireDb } from '../../src/db'
import { weldJoints } from '../../src/db/schema'
import { syncSystemDocumentsForWeldChangesInTransaction } from '../../src/server/system-document-index'
import { previewOperation, applyOperation, getOperationComposition, getOperationResult, planOperationBatches } from '../../src/server/document-operation-service'
import type { DocumentOperationRequest } from '../../src/lib/system-document-operation'
import { buildCurrentSystemDocumentName } from '../../src/lib/system-document-types'
import { REQUEST_CONCLUSION_DEFAULT_SETTINGS } from '../../src/lib/request-conclusion-settings'

const project = 'E2E selected document operations'
let originalSettings: { value: string; updated_at: Date } | undefined
const receipts: string[] = []
test.beforeEach(async () => {
  await withE2eDatabase(async db => {
    originalSettings = (await db.query("select value,updated_at from app_settings where key='request-conclusion'")).rows[0]
    await db.query("insert into app_settings(key,value) values ('request-conclusion',$1) on conflict(key) do update set value=excluded.value,updated_at=now()", [JSON.stringify(REQUEST_CONCLUSION_DEFAULT_SETTINGS)])
  })
})
test.afterEach(async () => {
  await withE2eDatabase(async db => {
    await db.query('drop trigger if exists e2e_document_atomic_failure on document_operation_receipts')
    await db.query('drop function if exists e2e_document_atomic_failure()')
    if (receipts.length) await db.query('delete from document_operation_receipts where id = any($1::text[])', [receipts.splice(0)])
    if (originalSettings) await db.query("update app_settings set value=$1,updated_at=$2 where key='request-conclusion'", [originalSettings.value, originalSettings.updated_at])
    else await db.query("delete from app_settings where key='request-conclusion'")
  })
  await cleanupLineProgramProjects([project])
})

async function seedRequests(count = 2, positions = 2, otherDate = '2026-10-09') {
  const names = Array.from({ length: count }, (_, i) => buildCurrentSystemDocumentName({ type: 'lnkRequest', title: '', date: '2026-10-09' }, [], REQUEST_CONCLUSION_DEFAULT_SETTINGS, 900 + i))
  await withE2eDatabase(db => db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,officiality,revision_actuality,has_vik,vik_request,vik_request_date,vik_result)
    select $1,'DOC', 'Л'||(n%2), 'С'||n, '2026-10-01','действующий','актуальная','да', ($2::text[])[(n-1)/$3::int+1], case when n > $3::int then $5::date else '2026-10-09'::date end,'годен' from generate_series(1,$4::int) n`, [project, names, positions, count * positions, otherDate]))
  await requireDb().transaction(async tx => {
    const rows = await tx.select().from(weldJoints).where(eq(weldJoints.projectTitle, project))
    await syncSystemDocumentsForWeldChangesInTransaction(tx, rows, new Map())
  })
  return withE2eDatabase(async db => (await db.query(`select distinct d.id,d.title from generated_documents d join generated_document_weld_joints a on a.document_id=d.id join weld_joints w on w.id=a.weld_joint_id where w.project_title=$1 and d.type='system:lnkRequest' order by d.id`, [project])).rows as Array<{ id: number; title: string }>)
}
function request(ids: number[], merge = false, mode: DocumentOperationRequest['mode'] = 'line'): DocumentOperationRequest { return { documentIds: ids, action: 'split', merge, mode } }
async function prepared(input: DocumentOperationRequest) {
  const preview = await previewOperation(input), operationId = randomUUID(); receipts.push(operationId)
  return { ...input, fingerprint: preview.fingerprint, previewHash: preview.previewHash, operationId }
}
async function state() {
  return withE2eDatabase(async db => ({
    rows: (await db.query('select * from weld_joints where project_title=$1 order by id', [project])).rows,
    documents: (await db.query('select * from generated_documents order by id')).rows,
    links: (await db.query('select * from generated_document_weld_joints order by document_id,weld_joint_id')).rows,
    settings: (await db.query('select * from app_settings order by key')).rows,
  }))
}
async function open(page: Page, documents: Array<{ id: number; title: string }>, action: 'split' | 'rename' | 'merge' = 'split') {
  await page.goto('/documents')
  await page.getByRole('button', { name: 'Заявка ЛНК', exact: true }).click()
  for (const doc of documents) {
    const checkbox = page.getByRole('button', { name: `Выбрать документ «${doc.title}»`, exact: true })
    if (await checkbox.getAttribute('aria-pressed') !== 'true') await checkbox.click()
  }
  await page.getByRole('button', { name: /^Действия с документами, выбрано:/ }).click()
  await page.getByRole('button', { name: action === 'split' ? 'Изменить разделение' : action === 'merge' ? 'Объединить' : 'Переименовать', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: action === 'split' ? 'Изменить разделение' : action === 'merge' ? 'Объединить документы' : 'Переименовать документы' })
  await expect(dialog.getByRole('button', { name: 'Подтвердить и применить' })).toBeEnabled()
  return dialog
}

test('selected scope: 4 without merge / 2 with merge / 1 without split; never changes a hidden document', async () => {
  const docs = await seedRequests(3)
  const ids = docs.slice(0, 2).map(d => d.id)
  expect((await previewOperation(request(ids))).groups).toHaveLength(4)
  expect((await previewOperation(request(ids, true))).groups).toHaveLength(2)
  expect((await previewOperation(request(ids, true, 'none'))).groups).toHaveLength(1)
  const before = await state()
  const data = await prepared(request(ids, true)), result = await applyOperation(data)
  expect(result).toEqual({ changedDocumentCount: 2, resultingDocumentCount: 2, affectedRowCount: 4 })
  expect(await applyOperation(data)).toEqual(result)
  expect(await getOperationResult(data.operationId)).toEqual(result)
  const after = await state()
  expect(after.documents.find(d => d.id === docs[2].id)).toEqual(before.documents.find(d => d.id === docs[2].id))
  const facts = (rows: typeof after.rows) => rows.map(({ vik_request, updated_at, lnk_updated_at, ...facts }) => facts)
  expect(facts(after.rows)).toEqual(facts(before.rows))
  expect(after.documents.filter(d => docs.slice(0, 2).some(source => source.title === d.title))).toHaveLength(0)
  expect(JSON.parse(after.settings.find(s => s.key === 'request-conclusion').value).splitModes.lnkRequest).toBe('line')
})

test('atomic rollback includes names, relations, counters and remembered preference; same request can retry', async () => {
  const docs = await seedRequests(1), data = await prepared(request(docs.map(d => d.id)))
  const before = await state()
  await withE2eDatabase(async db => {
    await db.query(`create function e2e_document_atomic_failure() returns trigger language plpgsql as $$ begin raise exception 'E2E injected receipt failure'; end $$`)
    await db.query('create trigger e2e_document_atomic_failure before insert on document_operation_receipts for each row execute function e2e_document_atomic_failure()')
  })
  await expect(applyOperation(data)).rejects.toThrow()
  expect(await state()).toEqual(before)
  expect(await getOperationResult(data.operationId)).toBeNull()
  await withE2eDatabase(db => db.query('drop trigger e2e_document_atomic_failure on document_operation_receipts'))
  expect((await applyOperation(data)).resultingDocumentCount).toBe(2)
})

test('stale facts and unselected name collision are rejected', async () => {
  const docs = await seedRequests(2), input = request([docs[0].id], false, 'none')
  input.action = 'rename'
  const preview = await previewOperation(input), group = preview.groups[0]
  const conflict = await previewOperation({ ...input, names: { [group.key]: { mode: 'custom', name: docs[1].title, membership: group.membership } } })
  expect(conflict.groups[0].error).toContain('вне выбора')
  const data = await prepared(input)
  await withE2eDatabase(db => db.query('update weld_joints set line=$2 where project_title=$1', [project, 'Изменено другим пользователем']))
  await expect(applyOperation(data)).rejects.toThrow('Нажмите «Проверить изменения»')
})

test('manual draft is not silently replaced with system names when the split mode changes', async () => {
  const docs = await seedRequests(1)
  const input = request([docs[0].id], false, 'none'), original = await previewOperation(input)
  const group = original.groups[0]
  const names = { [group.key]: { mode: 'custom' as const, name: 'Проверенное ручное имя', membership: group.membership } }
  const same = await previewOperation({ ...input, mode: 'project', names })
  expect(same.groups[0]).toMatchObject({ name: 'Проверенное ручное имя', namingMode: 'custom', error: '' })
  const split = await previewOperation({ ...input, mode: 'line', names })
  expect(split.groups.map(group => [group.name, group.namingMode, group.error])).toEqual([
    ['', 'custom', 'Название не указано'], ['', 'custom', 'Название не указано'],
  ])
  expect((await state()).rows.every(row => row.vik_request === docs[0].title)).toBe(true)
})

test('creation: header count without names tab, cancelled draft, successful shared default and fresh reopening', async ({ page }, info) => {
  await withE2eDatabase(db => db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,connection_type,officiality,revision_actuality,has_vik,psto_required)
    select $1,'DOC','DOC-L'||n,'F810'||n,'2026-10-01','С17','действующий','актуальная','да','нет' from generate_series(1,2) n`, [project]))
  await page.goto('/lnk')
  const openCreation = async () => {
    await page.locator('header').getByRole('button', { name: 'Заявка', exact: true }).click()
    await page.getByRole('button', { name: 'Новая заявка', exact: true }).click()
    const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Заявка ЛНК', exact: true }) })
    const method = dialog.getByRole('button', { name: 'ВИК', exact: true })
    if (await method.getAttribute('aria-pressed') !== 'true') await method.click()
    await expect(dialog.getByRole('combobox', { name: 'Разделение документов', exact: true })).toBeEnabled()
    return dialog
  }
  const selectRows = async (dialog: ReturnType<Page['getByRole']>) => {
    await dialog.getByPlaceholder('Проект, шифр, линия, спул или стык').fill('DOC-L')
    const checks = dialog.getByRole('checkbox', { name: /^Выбрать стык DOC-L/ })
    await expect(checks).toHaveCount(2)
    for (const checkbox of await checks.all()) await checkbox.check()
    await expect(dialog.getByRole('button', { name: 'Выбрано: 2', exact: true })).toBeVisible()
    await dialog.getByLabel('Дата заявки', { exact: true }).fill('2026-10-09')
  }
  let dialog = await openCreation()
  await selectRows(dialog)
  const split = dialog.getByRole('combobox', { name: 'Разделение документов', exact: true })
  await expect(split).toHaveValue('none')
  await expect(dialog.getByText('Будет создано: 1', { exact: true })).toBeVisible()
  await split.selectOption('line')
  await expect(dialog.getByText('Будет создано: 2', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Обновить номера и имена', exact: true })).toHaveCount(0)
  await dialog.screenshot({ path: info.outputPath('creation-split-header.png') })
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
  dialog = await openCreation()
  await expect(split).toHaveValue('none')
  await selectRows(dialog)
  await split.selectOption('line')
  await expect(dialog.getByText('Будет создано: 2', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Создать заявку', exact: true }).click()
  await expect(dialog).toBeHidden()
  const stored = await withE2eDatabase(async db => ({
    names: (await db.query('select distinct vik_request from weld_joints where project_title=$1', [project])).rows,
    settings: JSON.parse((await db.query("select value from app_settings where key='request-conclusion'")).rows[0].value),
  }))
  expect(stored.names).toHaveLength(2)
  expect(stored.names.every(row => !!row.vik_request)).toBe(true)
  expect(stored.settings.splitModes).toEqual({ ...REQUEST_CONCLUSION_DEFAULT_SETTINGS.splitModes, lnkRequest: 'line' })
  dialog = await openCreation()
  await expect(split).toHaveValue('line')
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
})

test('document editor: clear names, underlined modes, help, explicit check and merge composition', async ({ page }, info) => {
  const docs = await seedRequests(2), calls: string[] = []
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url()).split('_')[0]) })
  let dialog = await open(page, docs, 'rename')
  await expect(dialog.getByRole('button', { name: 'Системные', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const input = dialog.getByRole('textbox', { name: /^Название:/ }).first()
  await input.fill('Заявка с понятным названием'); await input.blur()
  await expect(dialog.getByText('Не проверен', { exact: true })).toHaveCount(2)
  await expect(dialog.getByText('Смешанные', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Подтвердить и применить' })).toBeDisabled()
  await dialog.screenshot({ path: info.outputPath('rename-desktop.png') })
  await dialog.getByRole('button', { name: 'Зачем проверять изменения' }).click()
  await expect(page.getByRole('tooltip')).toContainText('Проверка ничего не сохраняет')
  await page.keyboard.press('Escape')
  expect(calls.filter(name => name === 'previewDocumentOperation')).toHaveLength(1)
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
  dialog = await open(page, docs)
  await dialog.getByRole('combobox', { name: 'Разделение выбранных документов' }).selectOption('line')
  await dialog.getByRole('checkbox', { name: 'Объединить перед разделением' }).check()
  await expect(dialog.getByText('Количество документов — после проверки')).toBeVisible()
  await dialog.getByRole('button', { name: 'Что значит объединить документы' }).click()
  await expect(page.getByRole('tooltip')).toContainText('разные циклы одного стыка')
  await page.keyboard.press('Escape')
  await dialog.getByRole('button', { name: 'Проверить изменения', exact: true }).click()
  await expect(dialog.getByText('Выбрано в пакете: 2 → Получится: 2', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('textbox', { name: /^Название:/ })).toHaveCount(2)
  await dialog.screenshot({ path: info.outputPath('split-desktop.png') })
  await dialog.getByRole('button', { name: 'Посмотреть состав: 2' }).first().click()
  const panel = dialog.getByRole('complementary', { name: 'Состав будущего документа' })
  await expect(panel.locator('tbody tr')).toHaveCount(2)
  for (const doc of docs) await expect(panel.locator('tbody')).toContainText(doc.title)
  await dialog.screenshot({ path: info.outputPath('composition-desktop.png') })
  await panel.getByRole('button', { name: 'Свернуть состав' }).click()
  await dialog.getByRole('combobox', { name: 'Разделение выбранных документов' }).selectOption('none')
  await dialog.getByRole('button', { name: 'Проверить изменения', exact: true }).click()
  await expect(dialog.getByText('Выбрано в пакете: 2 → Получится: 1', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Посмотреть состав: 4' })).toBeEnabled()
  expect(calls.filter(name => name === 'applyDocumentOperation')).toHaveLength(0)
  expect(calls.filter(name => name === 'getDocumentOperationComposition')).toHaveLength(1)
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(new Set((await state()).rows.map(row => row.vik_request)).size).toBe(2)
})

test('standalone merge from compact actions preserves all facts, replaces only the selection and keeps split preference', async ({ page }, info) => {
  const docs = await seedRequests(3)
  await withE2eDatabase(db => db.query("update app_settings set value=$1 where key='request-conclusion'", [JSON.stringify({ ...REQUEST_CONCLUSION_DEFAULT_SETTINGS, splitModes: { ...REQUEST_CONCLUSION_DEFAULT_SETTINGS.splitModes, lnkRequest: 'line' } })]))
  const calls: string[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url()).split('_')[0]) })
  const before = await state()
  const dialog = await open(page, docs.slice(0, 2), 'merge')
  await expect(page.locator('[aria-label="Действия с выбранными системными документами"]')).toHaveCount(0)
  await expect(dialog.getByText('Выбрано в пакете: 2 → Получится: 1')).toBeVisible()
  await expect(dialog.getByRole('combobox', { name: 'Разделение выбранных документов' })).toHaveCount(0)
  await dialog.getByRole('combobox', { name: /^Имя исходного документа:/ }).selectOption(docs[0].title)
  await dialog.getByRole('button', { name: 'Проверить изменения', exact: true }).click()
  const input = dialog.getByRole('textbox', { name: /^Название:/ })
  await expect(input).toHaveValue(docs[0].title)
  await expect(dialog.getByRole('button', { name: 'Подтвердить и применить' })).toBeEnabled()
  const composition = dialog.getByRole('button', { name: 'Посмотреть состав: 4' })
  await composition.click()
  const panel = dialog.getByRole('complementary', { name: 'Состав будущего документа' })
  await expect(panel.locator('tbody tr')).toHaveCount(4)
  // Composition expands below the fields, never beside them or over another modal.
  const nameBox = await input.boundingBox(), panelBox = await panel.boundingBox()
  expect(panelBox!.y).toBeGreaterThan(nameBox!.y + nameBox!.height)
  expect(panelBox!.width).toBeGreaterThan(nameBox!.width)
  await dialog.screenshot({ path: info.outputPath('merge-inline-desktop.png') })
  await panel.getByRole('button', { name: 'Свернуть состав' }).click()
  await composition.click(); await expect(panel.locator('tbody tr')).toHaveCount(4)
  expect(calls.filter(name => name === 'getDocumentOperationComposition')).toHaveLength(1)
  await panel.getByRole('button', { name: 'Свернуть состав' }).click()
  await dialog.getByRole('button', { name: 'Подтвердить и применить' }).click()
  await expect(dialog.getByRole('status')).toContainText('Сохранено пакетов: 1')
  const after = await state()
  const facts = (rows: typeof before.rows) => rows.map(({ vik_request, updated_at, lnk_updated_at, ...facts }) => facts)
  expect(facts(after.rows)).toEqual(facts(before.rows))
  expect(after.rows.filter(row => row.vik_request === docs[0].title)).toHaveLength(4)
  expect(after.rows.filter(row => row.vik_request === docs[2].title)).toHaveLength(2)
  expect(after.documents.find(doc => doc.id === docs[2].id)).toEqual(before.documents.find(doc => doc.id === docs[2].id))
  expect(after.documents.filter(doc => docs.slice(0, 2).some(source => source.title === doc.title))).toHaveLength(1)
  const merged = after.documents.find(doc => doc.title === docs[0].title)!
  expect(after.links.filter(link => link.document_id === merged.id)).toHaveLength(4)
  expect(after.settings.find(setting => setting.key === 'request-conclusion')).toEqual(before.settings.find(setting => setting.key === 'request-conclusion'))
  expect(errors).toEqual([])
})

test('compact actions and row context explain the minimum selection without adding another toolbar', async ({ page }, info) => {
  const docs = await seedRequests(2)
  await page.goto('/documents'); await page.getByRole('button', { name: 'Заявка ЛНК', exact: true }).click()
  const toolbar = page.locator('[data-documents-navigation]')
  await expect(toolbar.getByRole('button', { name: 'Действия с документами, выбрано: 0', exact: true })).toBeVisible()
  await toolbar.getByRole('button', { name: 'Действия с документами, выбрано: 0', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Объединить', exact: true })).toBeDisabled()
  await expect(page.getByText(/Отметьте минимум два документа/)).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: `Выбрать документ «${docs[0].title}»`, exact: true }).click()
  await page.getByRole('button', { name: 'Действия с документами, выбрано: 1', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Объединить', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Изменить разделение', exact: true })).toBeEnabled()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: `Выбрать документ «${docs[1].title}»`, exact: true }).click()
  await page.getByRole('button', { name: 'Действия с документами, выбрано: 2', exact: true }).click()
  await page.screenshot({ path: info.outputPath('compact-document-actions.png') })
  await page.keyboard.press('Escape')
  const row = page.locator('div[style*="grid-template-columns"]').filter({ has: page.getByRole('button', { name: `Выбрать документ «${docs[0].title}»`, exact: true }) }).last()
  await row.click({ button: 'right' })
  await page.getByRole('button', { name: 'Объединить (2)', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Объединить документы' })
  await expect(dialog.getByText('Выбрано в пакете: 2 → Получится: 1')).toBeVisible()
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(new Set((await state()).rows.map(row => row.vik_request)).size).toBe(2)
})

test('standalone merge refuses incompatible dates and forged split parameters without changing any document', async ({ page }) => {
  const docs = await seedRequests(2, 2, '2026-10-10')
  await page.goto('/documents'); await page.getByRole('button', { name: 'Заявка ЛНК', exact: true }).click()
  for (const doc of docs) await page.getByRole('button', { name: `Выбрать документ «${doc.title}»`, exact: true }).click()
  await page.getByRole('button', { name: 'Действия с документами, выбрано: 2', exact: true }).click()
  const before = await state()
  await page.getByRole('button', { name: 'Объединить', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Объединить документы' })
  for (const detail of ['разные даты', '2026-10-09', '2026-10-10']) await expect(dialog.getByRole('alert')).toContainText(detail)
  await expect(dialog.getByRole('button', { name: 'Подтвердить и применить' })).toBeDisabled()
  expect(await state()).toEqual(before)
  for (const invalid of [{ mode: 'line' as const, merge: true }, { mode: 'none' as const, merge: false }]) {
    await expect(previewOperation({ documentIds: docs.map(d => d.id), action: 'merge', ...invalid })).rejects.toThrow('Объединение создаёт один документ')
  }
  expect(await state()).toEqual(before)
})

test('real UI: explicit split, manual name, lazy paged composition, cancel, narrow screen, lost response', async ({ page }, info) => {
  test.setTimeout(120_000)
  const docs = await seedRequests(1, 102), errors: string[] = [], calls: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url()).split('_')[0]) })
  let dialog = await open(page, docs)
  await dialog.getByRole('combobox', { name: 'Разделение выбранных документов' }).selectOption('line')
  await dialog.getByRole('button', { name: 'Проверить изменения' }).click()
  await expect(dialog.getByText(/Выбрано в пакете: 1 → Получится: 2/)).toBeVisible()
  const input = dialog.getByRole('textbox', { name: /^Название:/ }).first()
  await input.fill('Ручное имя новой группы'); await input.blur()
  await dialog.getByRole('button', { name: 'Проверить изменения' }).click()
  await expect(dialog.getByRole('button', { name: 'Подтвердить и применить' })).toBeEnabled()
  expect(calls.filter(name => name === 'getDocumentOperationComposition')).toHaveLength(0)
  await dialog.getByRole('button', { name: 'Посмотреть состав: 51' }).first().click()
  const panel = dialog.getByRole('complementary', { name: 'Состав будущего документа' })
  await expect(panel.locator('tbody tr')).toHaveCount(50)
  await panel.getByRole('button', { name: 'Следующие →' }).click(); await expect(panel.locator('tbody tr')).toHaveCount(1)
  await page.setViewportSize({ width: 390, height: 844 })
  await panel.getByRole('button', { name: 'Свернуть состав' }).scrollIntoViewIfNeeded()
  await expect(panel.getByRole('button', { name: 'Свернуть состав' })).toBeInViewport()
  await panel.locator('tbody tr').first().scrollIntoViewIfNeeded()
  await expect(panel.locator('tbody tr').first()).toBeInViewport({ ratio: 1 })
  await dialog.screenshot({ path: info.outputPath('composition-mobile.png') })
  await panel.getByRole('button', { name: 'Свернуть состав' }).click()
  await expect(dialog.getByRole('textbox', { name: /^Название:/ }).first()).toHaveValue('Ручное имя новой группы')
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect((await state()).rows.every(row => row.vik_request === docs[0].title)).toBe(true)
  await page.setViewportSize({ width: 1600, height: 1000 })
  // The second opening starts from the saved preference, not the cancelled draft.
  dialog = await open(page, docs)
  await expect(dialog.getByRole('combobox', { name: 'Разделение выбранных документов' })).toHaveValue('none')
  await dialog.getByRole('combobox', { name: 'Разделение выбранных документов' }).selectOption('line')
  await dialog.getByRole('button', { name: 'Проверить изменения' }).click()
  await expect(dialog.getByRole('button', { name: 'Подтвердить и применить' })).toBeEnabled()
  let writes = 0
  await page.route('**/_serverFn/**', async route => {
    if (!rpcName(route.request().url()).startsWith('applyDocumentOperation_')) return route.continue()
    writes++; await route.fetch(); await route.abort('failed')
  })
  await dialog.getByRole('button', { name: 'Подтвердить и применить' }).click()
  await expect(dialog.getByRole('status')).toContainText('Сохранено пакетов: 1')
  expect(writes).toBe(1); expect(calls.filter(name => name === 'getDocumentOperationResult')).toHaveLength(1)
  expect(new Set((await state()).rows.map(row => row.vik_request)).size).toBe(2)
  expect(errors).toEqual([])
})

test('large independent selection is bounded; one oversize merge is refused before mutation', async () => {
  const docs = await seedRequests(201)
  const plan = await planOperationBatches({ documentIds: docs.map(d => d.id), merge: false })
  expect(plan.batches.map(batch => batch.length)).toEqual([200, 1])
  await expect(planOperationBatches({ documentIds: docs.map(d => d.id), merge: true })).rejects.toThrow('неделимо')
})

test('batch limits count every method in ordinary multi-method LNK requests, not only joints', async () => {
  // Each indivisible request has 8,000 joints but 32,000 exact positions.
  // Combining both in one preview exceeds the 60,000-position ceiling.
  const docs = await seedRequests(2, 8_000)
  await withE2eDatabase(db => db.query(`update weld_joints set
    rk_request=vik_request,rk_request_date=vik_request_date,
    uzk_request=vik_request,uzk_request_date=vik_request_date,
    pvk_request=vik_request,pvk_request_date=vik_request_date where project_title=$1`, [project]))
  await requireDb().transaction(async tx => {
    const rows = await tx.select().from(weldJoints).where(eq(weldJoints.projectTitle, project))
    await syncSystemDocumentsForWeldChangesInTransaction(tx, rows, new Map())
  })
  const ids = docs.map(doc => doc.id)
  const plan = await planOperationBatches({ documentIds: ids, merge: false })
  expect(plan.blocked).toEqual([])
  expect(plan.batches).toEqual(ids.map(id => [id]))
  await expect(planOperationBatches({ documentIds: ids, merge: true })).rejects.toThrow('неделимо')
})

test('before-TO requests and conclusions preserve exact methods, stage, IDs and facts', async ({ page }) => {
  const primary = await seedRequests(1)
  const documents = await withE2eDatabase(async db => {
    const rows = (await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,has_vik)
      select $1,'PRE','L'||n,'S'||n,'2026-10-01','да' from generate_series(1,3) n returning id`, [project])).rows
    const controls = []
    for (const [i, row] of rows.entries()) controls.push((await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,result,conclusion_name,conclusion_date,defect_description)
      values ($1,$2,$3,'2026-10-09','годен',$4,'2026-10-09','  Preserve original fact  ') returning *`, [row.id, i === 1 ? 'РК' : 'ВИК', i < 2 ? 'ДоТО-A' : 'ДоТО-B', i === 1 ? 'РК-доТО' : 'ВИК-доТО'])).rows[0])
    const definitions = [
      { type: 'lnkRequest', title: 'ДоТО-A', positions: controls.slice(0, 2) },
      { type: 'lnkRequest', title: 'ДоТО-B', positions: controls.slice(2) },
      { type: 'lnkConclusionVik', methodCode: 'ВИК', title: 'ВИК-доТО', positions: controls.filter(c => c.method === 'ВИК') },
      { type: 'lnkConclusionRk', methodCode: 'РК', title: 'РК-доТО', positions: controls.filter(c => c.method === 'РК') },
    ]
    const result: Array<{ id: number; title: string }> = []
    for (const definition of definitions) {
      const sourcePositions = definition.positions.map(c => ({ kind: 'beforeHeatTreatment', weldJointId: c.weld_joint_id, relationId: c.id, methodCode: c.method }))
      const metadata = { sourceKind: 'beforeHeatTreatment', sourcePositions, methodCode: definition.methodCode,
        methodCodes: [...new Set(definition.positions.map(c => c.method))], positionCount: sourcePositions.length, projects: [project], subtitleCodes: ['PRE'], lines: [] }
      const doc = (await db.query(`insert into generated_documents(type,title,file_name,mime_type,period_from,period_to,row_count,source_metadata)
        values ($1,$2,'preheat.xlsx','application/xlsx','2026-10-09','2026-10-09',$3,$4) returning id,title`, ['system:' + definition.type, definition.title, sourcePositions.length, JSON.stringify(metadata)])).rows[0]
      await db.query('insert into generated_document_weld_joints(document_id,weld_joint_id) select $1,unnest($2::int[])', [doc.id, sourcePositions.map(p => p.weldJointId)])
      result.push(doc)
    }
    return result
  })
  const controls = () => withE2eDatabase(async db => (await db.query('select c.* from pre_heat_treatment_controls c join weld_joints w on w.id=c.weld_joint_id where w.project_title=$1 order by c.id', [project])).rows)
  const before = await controls()
  for (const selection of [
    { kind: 'Заключения ЛНК', docs: documents.slice(2), reason: 'разные методы заключения: ВИК и РК' },
    { kind: 'Заявка ЛНК', docs: [primary[0], documents[0]], reason: 'разные этапы: НК до ТО и основной НК' },
  ]) {
    await page.goto('/documents'); await page.getByRole('button', { name: selection.kind, exact: true }).click()
    for (const doc of selection.docs) await page.getByRole('button', { name: `Выбрать документ «${doc.title}»`, exact: true }).click()
    await page.getByRole('button', { name: 'Действия с документами, выбрано: 2', exact: true }).click()
    const unchanged = await state()
    await page.getByRole('button', { name: 'Объединить', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Объединить документы' })
    await expect(dialog.getByRole('alert')).toContainText(selection.reason)
    await expect(dialog.getByRole('button', { name: 'Подтвердить и применить' })).toBeDisabled()
    expect(await state()).toEqual(unchanged)
    expect(await controls()).toEqual(before)
    const invalid: DocumentOperationRequest = { documentIds: selection.docs.map(doc => doc.id), action: 'merge', mode: 'none', merge: true }
    await expect(applyOperation({ ...invalid, fingerprint: 'forged', previewHash: 'forged', operationId: randomUUID() })).rejects.toThrow()
    expect(await state()).toEqual(unchanged)
    await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
  }
  const input = request(documents.slice(0, 2).map(d => d.id), true, 'none')
  const preview = await previewOperation(input)
  const composition = await getOperationComposition({ ...input, fingerprint: preview.fingerprint, groupKey: preview.groups[0].key, query: '', page: 0 })
  expect(composition.items.map(p => [p.method, p.stage, p.source])).toEqual([['ВИК', 'До ТО', 'ДоТО-A'], ['РК', 'До ТО', 'ДоТО-A'], ['ВИК', 'До ТО', 'ДоТО-B']])
  await applyOperation(await prepared(input))
  const facts = (records: typeof before) => records.map(({ request_name, conclusion_name, updated_at, ...facts }) => facts)
  expect(facts(await controls())).toEqual(facts(before))
  expect(new Set((await controls()).map(c => c.request_name)).size).toBe(1)
  await expect(previewOperation(request(documents.slice(2).map(d => d.id), true, 'none'))).rejects.toThrow('методы заключения')
  const rename: DocumentOperationRequest = { ...request([documents[2].id], false, 'none'), action: 'rename' }
  const group = (await previewOperation(rename)).groups[0]
  const names = { [group.key]: { mode: 'custom' as const, name: 'Новое имя ВИК до ТО', membership: group.membership } }
  await applyOperation(await prepared({ ...rename, names }))
  await withE2eDatabase(async db => {
    expect((await db.query('select title,file_name from generated_documents where id=$1', [documents[2].id])).rows[0]).toEqual({ title: 'Новое имя ВИК до ТО', file_name: 'Новое имя ВИК до ТО.xlsx' })
  })
  expect((await controls()).find(c => c.method === 'РК').conclusion_name).toBe('РК-доТО')
  expect(facts(await controls())).toEqual(facts(before))
})

test('action dialogs: Escape closes help then dialog, preserves selection, works on a narrow screen', async ({ page }, info) => {
  const docs = await seedRequests(2)
  let before: Awaited<ReturnType<typeof state>> | undefined
  for (const action of ['rename', 'split', 'merge'] as const) {
    const dialog = await open(page, docs, action)
    // On an otherwise fresh DB, the first history read initializes its index.
    // Compare cancellation with the already opened dialog, not that setup work.
    before ??= await state()
    await dialog.getByRole('button', { name: 'Зачем проверять изменения' }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('tooltip')).toHaveCount(0)
    await expect(dialog).toBeVisible()
    await dialog.getByRole('textbox', { name: /^Название:/ }).first().fill('Не сохранять этот черновик')
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(page.locator('[data-documents-navigation]').getByRole('button', { name: 'Действия с документами, выбрано: 2', exact: true })).toBeVisible()
    for (const doc of docs) await expect(page.getByRole('button', { name: `Выбрать документ «${doc.title}»`, exact: true })).toHaveAttribute('aria-pressed', 'true')
  }
  await page.screenshot({ path: info.outputPath('document-actions-top-panel.png') })
  await page.getByRole('button', { name: 'Скрыть меню', exact: true }).click()
  await page.setViewportSize({ width: 430, height: 900 })
  await expect(page.locator('aside').filter({ has: page.getByRole('navigation', { name: 'Разделы программы' }) })).toHaveCSS('width', '64px')
  await expect(page.locator('main > div').first()).toHaveCSS('padding-left', '80px')
  const actions = page.locator('[data-documents-navigation]').getByRole('button', { name: /^Действия с документами/ })
  const box = await actions.boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(430)
  await actions.click()
  await expect(page.getByRole('button', { name: 'Переименовать', exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath('document-actions-mobile.png') })
  await expect(page.getByRole('button', { name: 'Переименовать', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  expect(await state()).toEqual(before)
})
