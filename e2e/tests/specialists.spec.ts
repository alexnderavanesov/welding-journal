import { documentGridRow, revealDocumentColumn } from '../document-grid'
import { chooseSpecialist } from '../specialist-helpers'
import { expect, test, type Page } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { requireDb } from '../../src/db'
import { weldJoints } from '../../src/db/schema'
import { syncSystemDocumentsForWeldChangesInTransaction } from '../../src/server/system-document-index'
import { applySpecialistAssignments } from '../../src/server/specialists'
import { previewOperation as raw_previewOperation, applyOperation as raw_applyOperation } from '../../src/server/document-operation-service'
import { asE2eOwner } from '../with-owner-access'
import { randomUUID } from 'node:crypto'
import { updateWeldJointRows } from '../../src/server/weld-mutations'

const project = 'E2E specialists'
const applyOperation = asE2eOwner(raw_applyOperation, 'documents.edit')
const previewOperation = asE2eOwner(raw_previewOperation, 'documents.view')
const names = ['E2E Иванов специалист', 'E2E Петров специалист', 'E2E Сидоров термист']
test.afterEach(async ({ page }) => {
  await page.close()
  await cleanupLineProgramProjects([project])
  await withE2eDatabase(db => db.query('delete from specialists where name=any($1::text[])', [names]))
})

async function seed() {
  await withE2eDatabase(async db => {
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,officiality,revision_actuality,has_vik,vik_result,vik_conclusion,vik_conclusion_date)
      select $1,'SPEC','L'||n,'F9900'||n,'2026-10-01','действующий','актуальная','да','годен','Специалисты-ВИК-'||n,'2026-10-02' from generate_series(1,3) n`, [project])
  })
  await requireDb().transaction(async tx => {
    const rows = await tx.select().from(weldJoints).where(eq(weldJoints.projectTitle, project))
    await syncSystemDocumentsForWeldChangesInTransaction(tx, rows, new Map())
  })
  return withE2eDatabase(async db => (await db.query(`select id,title,updated_at,specialists_revision from generated_documents where title like 'Специалисты-ВИК-%' order by title`)).rows)
}
async function createPerson(page: Page, name: string, thermist = false) {
  await page.getByRole('button', { name: 'Добавить специалиста', exact: true }).click()
  await page.getByLabel('ФИО', { exact: true }).fill(name)
  if (thermist) {
    await page.getByLabel('Тип специалиста', { exact: true }).click()
    await page.getByRole('listbox').getByRole('option', { name: 'Термист', exact: true }).click()
    await expect(page.getByLabel('Тип специалиста', { exact: true })).toHaveValue('thermist')
  }
  await page.getByLabel('№ квалификационного удостоверения', { exact: true }).fill('УД-123')
  if (!thermist) for (const method of ['ВИК', 'ТВМТ']) await page.getByLabel(method, { exact: true }).check()
  await page.getByRole('button', { name: 'Сохранить специалиста', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Добавление специалиста' })).toBeHidden()
  return withE2eDatabase(async db => (await db.query('select id from specialists where name=$1', [name])).rows[0].id as number)
}
async function openAssignments(page: Page, titles: string[]) {
  await page.goto('/documents')
  await page.getByRole('button', { name: 'Заключения ЛНК', exact: true }).click()
  for (const title of titles) {
    await (await documentGridRow(page, title)).checkbox.check()
  }
  await page.getByRole('button', { name: /^Действия с документами, выбрано:/ }).click()
  const menu = page.getByTestId('context-action-menu')
  await expect(menu).toHaveClass(/journal-context-menu/)
  const actions = menu.locator('[data-menu-item]')
  // Descriptions may wrap to different heights. All actions retain the journal's
  // compact visual scale, and their labels/descriptions must fit their buttons.
  const metrics = await actions.evaluateAll(buttons => buttons.map(button => {
    const style = getComputedStyle(button), bounds = button.getBoundingClientRect()
    return {
      height: bounds.height, minHeight: Number.parseFloat(style.minHeight), fontSize: style.fontSize,
      paddingLeft: style.paddingLeft, paddingRight: style.paddingRight, gap: style.gap,
      textFits: [...button.querySelectorAll<HTMLElement>('[data-menu-label], [data-menu-description]')].every(text => {
        const rect = text.getBoundingClientRect()
        return rect.height > 0 && rect.top >= bounds.top && rect.bottom <= bounds.bottom
          && text.scrollWidth <= text.clientWidth + 1 && text.scrollHeight <= text.clientHeight + 1
      }),
    }
  }))
  expect(metrics.length).toBeGreaterThan(0)
  for (const item of metrics) {
    expect(item.height).toBeGreaterThanOrEqual(36)
    expect(item).toMatchObject({ minHeight: 36, fontSize: '12px', paddingLeft: '16px', paddingRight: '16px', gap: '16px', textFits: true })
  }
  for (const text of await menu.locator('[data-menu-label], [data-menu-description]').all()) await expect(text).toBeVisible()
  await menu.screenshot({ path: '/private/tmp/specialists-compact-actions.png' })
  await page.getByRole('button', { name: 'Назначить специалистов', exact: true }).click()
  return page.getByRole('dialog', { name: 'Назначить специалистов', exact: true })
}

test('registry UI, selected-only assignment, historical certificate, replacement, clear and cancel', async ({ page }) => {
  const documents = await seed()
  await page.goto('/welder-stamps')
  await expect(page).toHaveURL(/\/references$/)
  await expect(page.getByRole('complementary').getByRole('button', { name: 'Справочники', exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Специалисты', exact: true }).click()
  const ivan = await createPerson(page, names[0])
  const petr = await createPerson(page, names[1])
  const thermist = await createPerson(page, names[2], true)
  let dialog = await openAssignments(page, documents.slice(0, 2).map(doc => doc.title))
  await dialog.getByRole('combobox', { name: 'Провёл контроль', exact: true }).click()
  await expect(page.getByRole('listbox').locator(`[data-specialist-id="${thermist}"]`)).toHaveCount(0)
  await page.getByRole('listbox').screenshot({ path: '/private/tmp/specialists-compact-picker.png' })
  await chooseSpecialist(dialog.getByRole('combobox', { name: 'Провёл контроль', exact: true }), String(ivan))
  await chooseSpecialist(dialog.getByRole('combobox', { name: 'Выдал заключение', exact: true }), String(ivan))
  await expect(dialog).toContainText('Назначить: 4')
  await dialog.getByRole('button', { name: 'Применить', exact: true }).click()
  await expect(dialog).toBeHidden()
  const stored = () => withE2eDatabase(async db => (await db.query('select id,title,specialists,specialists_revision,updated_at,xmin::text as document_version from generated_documents where id=any($1::int[]) order by title', [documents.map(doc => doc.id)])).rows)
  let snapshot = await stored()
  expect(snapshot.slice(0, 2).every(doc => doc.specialists.first.id === ivan && doc.specialists.second.certificate === 'УД-123')).toBe(true)
  expect(snapshot[2].specialists).toBeNull()

  await page.goto('/welder-stamps')
  await page.getByRole('tab', { name: 'Специалисты', exact: true }).click()
  await page.getByRole('row').filter({ hasText: names[0] }).getByRole('button', { name: 'Изменить' }).click()
  await page.getByLabel('№ квалификационного удостоверения', { exact: true }).fill('УД-НОВОЕ')
  await page.getByRole('button', { name: 'Сохранить специалиста', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Редактирование специалиста' })).toBeHidden()
  expect((await stored())[0].specialists.first.certificate).toBe('УД-123')

  dialog = await openAssignments(page, documents.slice(0, 2).map(doc => doc.title))
  await chooseSpecialist(dialog.getByRole('combobox', { name: 'Провёл контроль', exact: true }), '')
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect((await stored())[0].specialists.first.id).toBe(ivan)
  dialog = await openAssignments(page, documents.slice(0, 2).map(doc => doc.title))
  await chooseSpecialist(dialog.getByRole('combobox', { name: 'Провёл контроль', exact: true }), String(petr))
  await chooseSpecialist(dialog.getByRole('combobox', { name: 'Выдал заключение', exact: true }), '')
  await expect(dialog).toContainText('Заменить: 2')
  await expect(dialog).toContainText('Очистить: 2')
  await dialog.getByRole('button', { name: 'Применить', exact: true }).click()
  await expect(dialog).toBeHidden()
  snapshot = await stored()
  expect(snapshot.slice(0, 2).every(doc => doc.specialists.first.id === petr && doc.specialists.second === null)).toBe(true)
  expect(snapshot[2].specialists).toBeNull()
  const { id: rowId } = await documentGridRow(page, documents[0].title)
  await revealDocumentColumn(page, 'specialistFirst')
  // AG36 retains the outgoing row briefly during a purge. Pinned and center
  // cells share one live row; measure that exact document, not its fading copy.
  const row = page.locator(`[data-document-history-grid] .ag-row[row-id="${rowId}"]:not(.ag-opacity-zero)`)
  await expect(row).toHaveCount(1)
  const cell = row.locator('[col-id="specialistFirst"]').getByRole('button', { name: `Провёл контроль: ${documents[0].title}`, exact: true })
  await expect(cell).toBeVisible()
  const rowHeight = (await row.boundingBox())!.height
  await cell.click()
  await expect(page.getByRole('dialog', { name: 'Назначить специалистов', exact: true })).toBeVisible()
  expect((await row.boundingBox())!.height).toBe(rowHeight)
  const editor = page.getByRole('combobox', { name: 'Провёл контроль', exact: true })
  await chooseSpecialist(editor, ivan)
  await page.getByRole('button', { name: 'Применить', exact: true }).click()
  await expect(editor).toBeHidden()
  expect((await stored())[0].specialists.first.certificate).toBe('УД-НОВОЕ')
  const preserved = await stored()
  await page.goto('/references')
  await page.getByRole('tab', { name: 'Специалисты', exact: true }).click()
  const ivanRow = page.getByRole('row').filter({ hasText: names[0] })
  await ivanRow.getByRole('button', { name: 'В архив', exact: true }).click()
  const archive = page.getByRole('dialog', { name: 'Архивировать специалиста', exact: true })
  await archive.getByRole('button', { name: 'Отмена', exact: true }).click()
  await expect(ivanRow.getByText('В архиве', { exact: true })).toBeHidden()
  await ivanRow.getByRole('button', { name: 'В архив', exact: true }).click()
  await archive.getByRole('button', { name: 'В архив', exact: true }).click()
  await expect(archive).toBeHidden()
  await expect(ivanRow.getByText('В архиве', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /^Действующие/ }).click()
  await expect(ivanRow).toBeHidden()
  await page.getByRole('button', { name: /^В архиве/ }).click()
  await expect(ivanRow).toBeVisible()
  expect(await stored()).toEqual(preserved)
  const current = preserved[0]
  await expect(applySpecialistAssignments({ documents: [{ id: current.id, revision: current.specialists_revision, updatedAt: current.updated_at.toISOString(), documentVersion: current.document_version }], selection: { first: ivan } })).rejects.toThrow('архивирован')
  dialog = await openAssignments(page, documents.slice(0, 2).map(doc => doc.title))
  await dialog.getByRole('combobox', { name: 'Провёл контроль', exact: true }).click()
  await expect(page.getByRole('option', { name: names[0], exact: true })).toBeHidden()
  const search = page.getByRole('searchbox', { name: 'Поиск специалиста', exact: true })
  await search.fill(names[1])
  await expect(page.getByRole('option', { name: names[1], exact: true })).toBeVisible()
  await search.press('Escape')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
  await page.goto('/references')
  await page.getByRole('tab', { name: 'Специалисты', exact: true }).click()
  await ivanRow.getByRole('button', { name: 'Восстановить', exact: true }).click()
  await page.getByRole('dialog', { name: 'Восстановить специалиста', exact: true }).getByRole('button', { name: 'Восстановить', exact: true }).click()
  await expect(ivanRow.getByText('В архиве', { exact: true })).toBeHidden()
  expect(await stored()).toEqual(preserved)
})

test('specialist dialogs: desktop and mobile, Escape, return focus and stable document rows', async ({ page }) => {
  const documents = await seed()
  await page.goto('/references')
  const tab = page.getByRole('tab', { name: 'Специалисты', exact: true })
  await expect(tab.locator('svg')).toHaveClass(/lucide-users-round/)
  await tab.click()
  const add = page.getByRole('button', { name: 'Добавить специалиста', exact: true })
  await add.click()
  const editor = page.getByRole('dialog', { name: 'Добавление специалиста', exact: true })
  await expect(editor.getByRole('textbox', { name: 'ФИО', exact: true })).toBeFocused()
  await editor.getByRole('textbox', { name: 'ФИО', exact: true }).fill('Иванов Иван Иванович')
  await editor.getByLabel('№ квалификационного удостоверения', { exact: true }).fill('НК-2026/123')
  await editor.getByLabel('ВИК', { exact: true }).check()
  await editor.getByLabel('УЗК', { exact: true }).check()
  const desktopBounds = await editor.boundingBox()
  await editor.getByLabel('Тип специалиста', { exact: true }).selectOption('thermist')
  expect(await editor.boundingBox()).toEqual(desktopBounds)
  await editor.getByLabel('Тип специалиста', { exact: true }).selectOption('inspector')
  expect(await editor.boundingBox()).toEqual(desktopBounds)
  await editor.screenshot({ path: '/private/tmp/specialist-design-card-desktop.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  const cardMobileBounds = await editor.boundingBox()
  await editor.getByLabel('Тип специалиста', { exact: true }).selectOption('thermist')
  expect(await editor.boundingBox()).toEqual(cardMobileBounds)
  await editor.getByLabel('Тип специалиста', { exact: true }).selectOption('inspector')
  expect(await editor.boundingBox()).toEqual(cardMobileBounds)
  await expect(editor.getByRole('button', { name: 'Сохранить специалиста', exact: true })).toBeInViewport()
  const saveBox = (await editor.getByRole('button', { name: 'Сохранить специалиста', exact: true }).boundingBox())!
  const cancelBox = (await editor.getByRole('button', { name: 'Отмена', exact: true }).boundingBox())!
  expect(saveBox.x).toBe(cancelBox.x)
  expect(saveBox.width).toBe(cancelBox.width)
  expect(saveBox.y + saveBox.height).toBeLessThanOrEqual(cancelBox.y)
  expect(await editor.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await editor.screenshot({ path: '/private/tmp/specialist-design-card-mobile.png' })
  await page.keyboard.press('Escape')
  await expect(editor).toBeHidden()
  await expect(add).toBeFocused()
  await page.setViewportSize({ width: 1600, height: 1000 })
  const dialog = await openAssignments(page, documents.slice(0, 2).map(doc => doc.title))
  const picker = dialog.getByRole('combobox', { name: 'Провёл контроль', exact: true })
  await picker.click()
  await expect(page.getByRole('listbox')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('listbox')).toBeHidden()
  await expect(dialog).toBeVisible()
  await expect(picker).toBeFocused()
  await dialog.getByRole('button', { name: 'Очистить роль «Провёл контроль»', exact: true }).click()
  await dialog.getByText('Изменения по документам', { exact: false }).first().click()
  await dialog.screenshot({ path: '/private/tmp/specialist-design-assignment-desktop.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(dialog.getByRole('button', { name: 'Применить', exact: true })).toBeInViewport()
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await dialog.screenshot({ path: '/private/tmp/specialist-design-assignment-mobile.png' })
  const triggerBounds = await picker.boundingBox()
  await picker.click()
  const mobileList = page.getByRole('listbox')
  await expect(mobileList).toBeVisible()
  const mobileBounds = (await mobileList.boundingBox())!
  expect(await picker.boundingBox()).toEqual(triggerBounds)
  expect(mobileBounds.x).toBeGreaterThanOrEqual(8)
  expect(mobileBounds.x + mobileBounds.width).toBeLessThanOrEqual(382)
  expect(mobileBounds.y).toBeGreaterThanOrEqual(0)
  expect(mobileBounds.y + mobileBounds.height).toBeLessThanOrEqual(844)
  await mobileList.screenshot({ path: '/private/tmp/specialists-compact-picker-mobile.png' })
  await page.keyboard.press('Escape')
  await expect(mobileList).toBeHidden()
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  expect(await withE2eDatabase(async db => (await db.query('select count(*)::integer n from specialists where name=$1', ['Иванов Иван Иванович'])).rows[0].n)).toBe(0)
})

test('server atomicity, stale clients, wrong methods and concurrent replacements', async () => {
  const documents = await seed()
  const [ivan, petr] = await withE2eDatabase(async db => (await db.query(`insert into specialists(name,kind,certificate,methods) values ($1,'inspector','A',array['ВИК']),($2,'thermist','B',array[]::text[]) returning id`, [names[0], names[2]])).rows.map(row => row.id))
  const targets = () => withE2eDatabase(async db => (await db.query('select id,specialists_revision as revision,updated_at,xmin::text as document_version from generated_documents where id=any($1::int[]) order by id', [documents.map(doc => doc.id)])).rows.map(row => ({ id: row.id, revision: row.revision, updatedAt: row.updated_at.toISOString(), documentVersion: row.document_version })))
  const before = await targets()
  await expect(applySpecialistAssignments({ documents: before, selection: { first: ivan, second: petr } })).rejects.toThrow('допуска')
  expect(await targets()).toEqual(before)
  const results = await Promise.allSettled([
    applySpecialistAssignments({ documents: before, selection: { first: ivan } }),
    applySpecialistAssignments({ documents: before, selection: { first: null } }),
  ])
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
  await expect(applySpecialistAssignments({ documents: before, selection: { second: ivan } })).rejects.toThrow('Документы изменились')
  await applySpecialistAssignments({ documents: await targets(), selection: { first: null, second: null } })
  const empty = await withE2eDatabase(async db => (await db.query('select specialists from generated_documents where id=any($1::int[])', [documents.map(doc => doc.id)])).rows)
  expect(empty.every(doc => doc.specialists.first === null && doc.specialists.second === null)).toBe(true)
  const request = { documentIds: documents.slice(0, 2).map(doc => doc.id), action: 'merge' as const, merge: true, mode: 'none' as const }
  const preview = await previewOperation(request)
  await applySpecialistAssignments({ documents: await targets(), selection: { first: ivan } })
  await expect(applyOperation({ ...request, fingerprint: preview.fingerprint, previewHash: preview.previewHash, operationId: randomUUID() })).rejects.toThrow('Нажмите «Проверить изменения»')
})

test('merge warns before clearing conflicting snapshots; cancel preserves them', async ({ page }) => {
  const documents = await seed()
  const snapshot = { first: { id: 100001, name: 'Исторический специалист', certificate: 'СТАРОЕ' }, second: null }
  await withE2eDatabase(db => db.query('update generated_documents set specialists=$1::jsonb where id=$2', [JSON.stringify(snapshot), documents[0].id]))
  await page.goto('/documents')
  await page.getByRole('button', { name: 'Заключения ЛНК', exact: true }).click()
  for (const doc of documents.slice(0, 2)) await (await documentGridRow(page, doc.title)).checkbox.check()
  async function openMerge() {
    await page.getByRole('button', { name: /^Действия с документами, выбрано:/ }).click()
    await page.getByRole('button', { name: 'Объединить', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Объединить документы', exact: true })
    await expect(dialog.getByRole('alert')).toContainText('обе роли в таких итоговых документах будут пустыми')
    await expect(dialog.getByRole('button', { name: 'Подтвердить и применить' })).toBeEnabled()
    return dialog
  }
  let dialog = await openMerge()
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(await withE2eDatabase(async db => (await db.query('select specialists from generated_documents where id=$1', [documents[0].id])).rows[0].specialists)).toEqual(snapshot)
  dialog = await openMerge()
  await dialog.getByRole('button', { name: 'Подтвердить и применить' }).click()
  await expect(dialog.getByRole('status')).toContainText('Сохранено пакетов: 1')
  const after = await withE2eDatabase(async db => (await db.query(`select distinct d.id,d.specialists,d.row_count from generated_documents d join generated_document_weld_joints a on a.document_id=d.id join weld_joints w on w.id=a.weld_joint_id where w.project_title=$1 and d.type='system:lnkConclusionVik'`, [project])).rows)
  expect(after).toHaveLength(2)
  expect(after.find(doc => doc.row_count === 2).specialists).toEqual({ first: null, second: null })
  expect(after.find(doc => doc.id === documents[2].id).specialists).toBeNull()
})

test('ordinary primary correction preserves a split signature and requires fresh consent for a conflicting merge', async () => {
  await seed()
  const snapshot = { first: { id: 900001, name: 'Историческое ФИО', certificate: 'СТАРОЕ' }, second: null }
  await withE2eDatabase(db => db.query("update weld_joints set vik_request='Spec request',vik_request_date='2026-10-01',vik_conclusion='Специалисты-ВИК-1' where project_title=$1 and joint<>'F99003'", [project]))
  await requireDb().transaction(async tx => {
    const rows = await tx.select().from(weldJoints).where(eq(weldJoints.projectTitle, project))
    await syncSystemDocumentsForWeldChangesInTransaction(tx, rows, new Map(rows.map(row => [row.id, { ...row, vikConclusion: row.joint === 'F99002' ? 'Специалисты-ВИК-2' : row.vikConclusion }])))
  })
  await withE2eDatabase(db => db.query("update generated_documents set specialists=$1::jsonb where title='Специалисты-ВИК-1'", [JSON.stringify(snapshot)]))
  const target = await withE2eDatabase(async db => (await db.query("select id,xmin::text as version from weld_joints where project_title=$1 and joint='F99001'", [project])).rows[0])
  await updateWeldJointRows({ records: [{ id: target.id, vikConclusion: 'Spec corrected primary' }], expectedVersions: [target], mutationScope: 'lnk' })
  const stored = () => withE2eDatabase(async db => (await db.query("select title,specialists from generated_documents where title=any($1::text[]) order by title", [['Специалисты-ВИК-1', 'Spec corrected primary']])).rows)
  expect(await stored()).toHaveLength(2)
  expect((await stored()).every(document => JSON.stringify(document.specialists) === JSON.stringify(snapshot))).toBe(true)
  await withE2eDatabase(db => db.query("update generated_documents set specialists=null where title='Специалисты-ВИК-1'"))
  const version = await withE2eDatabase(async db => (await db.query('select id,xmin::text as version from weld_joints where id=$1', [target.id])).rows[0])
  const input = { records: [{ id: target.id, vikConclusion: 'Специалисты-ВИК-1' }], expectedVersions: [version], mutationScope: 'lnk' as const }
  const error = await updateWeldJointRows(input).catch(error => error.message as string)
  const token = String(error).match(/specialist-confirmation:([a-f0-9]{64})/)?.[1]
  expect(token).toBeTruthy()
  expect(await stored()).toHaveLength(2)
  await updateWeldJointRows({ ...input, specialistCorrectionConfirmation: token })
  expect(await stored()).toEqual([{ title: 'Специалисты-ВИК-1', specialists: { first: null, second: null } }])
})
