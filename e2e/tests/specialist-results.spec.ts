import { lnkRow as lnkGridRow, lnkActionRow } from './lnk-grid-helpers'
import { chooseSpecialist } from '../specialist-helpers'
import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { DEFAULT_CONTROL_PROCESS_SETTINGS } from '../../src/lib/control-process-settings'
import { REQUEST_CONCLUSION_DEFAULT_SETTINGS } from '../../src/lib/request-conclusion-settings'
import { randomUUID } from 'node:crypto'
import { applyOperation, previewOperation } from '../../src/server/document-operation-service'
import type { DocumentOperationRequest } from '../../src/lib/system-document-operation'
import { loadSystemDocumentSpecialistSnapshot } from '../../src/server/system-document-index'
import { pstoActionRow } from './psto-grid-helpers'

const project = 'E2E specialist result creation'
const names = ['E2E результат специалист А', 'E2E результат специалист Б']
const settings = { 'control-processes': DEFAULT_CONTROL_PROCESS_SETTINGS, 'request-conclusion': REQUEST_CONCLUSION_DEFAULT_SETTINGS, 'document-specialist-defaults': {} }
let original: Array<{ key: string; value: string; updated_at: Date }> = []
test.beforeEach(async () => {
  await withE2eDatabase(async db => {
    original = (await db.query('select key,value,updated_at from app_settings where key=any($1::text[])', [Object.keys(settings)])).rows
    for (const [key, value] of Object.entries(settings)) await db.query('insert into app_settings(key,value) values($1,$2) on conflict(key) do update set value=excluded.value', [key, JSON.stringify(value)])
  })
})
test.afterEach(async ({ page }) => {
  await page.close()
  await cleanupLineProgramProjects([project])
  await withE2eDatabase(async db => {
    await db.query('delete from specialists where name=any($1::text[])', [names])
    for (const key of Object.keys(settings)) {
      const before = original.find(row => row.key === key)
      if (before) await db.query('update app_settings set value=$1,updated_at=$2 where key=$3', [before.value, before.updated_at, key])
      else await db.query('delete from app_settings where key=$1', [key])
    }
  })
})

for (const stage of ['beforeHeatTreatment', 'psto'] as const) test(`new ${stage} documents save optional common pair and per-document empty overrides atomically`, async ({ page }) => {
  const isPre = stage === 'beforeHeatTreatment'
  const people = await withLineProgramFixture(async db => {
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,officiality,revision_actuality,has_vik,psto_required,psto_request,psto_request_date)
      select $1,'SPEC','SPEC-L'||n,'F9900'||n,'2026-09-01','действующий','актуальная','да','да',
        case when $2::boolean then null else 'Spec PSTO request' end,case when $2::boolean then null else '2026-09-03'::date end from generate_series(1,2) n`, [project, isPre])
    await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,result,conclusion_name,conclusion_date,defect_description)
      select id,'ВИК','Spec pre request','2026-09-02',case when $2::boolean then null else 'годен' end,
      case when $2::boolean then null else 'Spec previous pre conclusion' end,case when $2::boolean then null else '2026-09-02'::date end,
      case when $2::boolean then null else 'ДНО' end from weld_joints where project_title=$1`, [project, isPre])
    return (await db.query(`insert into specialists(name,kind,certificate,methods) select n,$2,'СЕРТ',case when $3::boolean then array['ВИК'] else array[]::text[] end from unnest($1::text[]) n returning id,name`, [names, isPre ? 'inspector' : 'thermist', isPre])).rows
  })
  await page.goto(isPre ? '/lnk' : '/psto')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(project)
  const loadedRows = page.getByText('Найдено: 2', { exact: true })
  await expect(loadedRows).toBeVisible()
  // Initial dispatcher publication persists finalStatus and changes rowVersion.
  // This scenario tests specialist creation, so open its draft only after the
  // fixture is published and the browser has received the refreshed row versions.
  await expect.poll(() => withE2eDatabase(async db => (await db.query(
    'select source_revision=computed_revision as fresh from dispatcher_task_index_state where id=1',
  )).rows[0]?.fresh), { timeout: 10_000 }).toBe(true)
  await page.waitForLoadState('networkidle')
  await expect(loadedRows).toBeVisible()
  const row = isPre
    ? await lnkActionRow(page, 'F99001')
    : await pstoActionRow(page, 'F99001')
  await row.getByRole('button', { name: isPre ? 'Выполнить: Внести результат НК до ТО' : 'Выполнить: Внести результат ПСТО · цикл 1', exact: true }).click()
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: isPre ? 'Внесение результатов ЛНК до ТО' : 'Внесение результатов ПСТО', exact: true }) })
  const checkboxes = dialog.getByRole('checkbox', { name: /^Выбрать стык SPEC-L/ })
  await expect(checkboxes).toHaveCount(2)
  for (const checkbox of await checkboxes.all()) await checkbox.check()
  await dialog.getByLabel(isPre ? 'Дата контроля' : 'Дата ПСТО', { exact: true }).fill('2026-09-06')
  if (isPre) {
    const rule = dialog.getByRole('link', { name: 'Правило СП-07', exact: true })
    const position = await rule.boundingBox()
    await rule.hover()
    await expect(page.getByRole('tooltip')).toContainText('Правило СП-07')
    await expect(page.getByRole('tooltip')).toHaveClass(/bg-slate-900/)
    await page.mouse.move(1, 1)
    await dialog.getByRole('group', { name: 'Результат для всех выбранных', exact: true }).getByRole('button', { name: 'годен', exact: true }).click()
    expect(await rule.boundingBox()).toEqual(position)
    await expect(rule).toHaveText('')
  }
  await dialog.getByRole('combobox', { name: 'Разделение документов', exact: true }).selectOption('line')
  await dialog.getByRole('tab', { name: isPre ? /^Заключения и имена/ : /^Диаграммы и имена/ }).click()
  const namesInput = dialog.locator('[data-group-joint-count]').first().locator('..').getByRole('textbox').first()
  const countBox = (await dialog.locator('[data-group-joint-count]').first().boundingBox())!
  const nameBox = (await namesInput.boundingBox())!
  expect(countBox.y + countBox.height / 2).toBe(nameBox.y + nameBox.height / 2)
  await page.setViewportSize({ width: 390, height: 844 })
  await dialog.getByRole('tab', { name: 'Специалисты', exact: true }).click()
  await expect(dialog.getByRole('tab', { name: 'Специалисты', exact: true })).toBeInViewport()
  const bounds = await dialog.boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391)
  await page.setViewportSize({ width: 1600, height: 1000 })
  const firstRole = isPre ? 'Провёл контроль' : 'Оператор-термист'
  const secondRole = isPre ? 'Выдал заключение' : 'Руководитель по ТО'
  const common = dialog.getByRole('group', { name: 'Общая пара', exact: true })
  await chooseSpecialist(common.getByRole('combobox', { name: firstRole, exact: true }), String(people[0].id))
  await chooseSpecialist(common.getByRole('combobox', { name: secondRole, exact: true }), String(people[0].id))
  const firstRoles = dialog.getByRole('combobox', { name: firstRole, exact: true })
  await expect(firstRoles).toHaveCount(3)
  await chooseSpecialist(firstRoles.nth(2), null)
  await chooseSpecialist(common.getByRole('combobox', { name: firstRole, exact: true }), String(people[1].id))
  await expect(firstRoles.nth(2)).toHaveText('Не назначен')
  const table = dialog.getByRole('table', { name: 'Специалисты создаваемых документов' })
  expect((await table.boundingBox())!.x).toBeLessThan((await dialog.boundingBox())!.x + 32)
  expect((await table.boundingBox())!.width).toBeGreaterThan((await dialog.boundingBox())!.width - 64)
  await expect(dialog.getByRole('searchbox', { name: 'Поиск специалиста' })).toHaveCount(0)
  expect((await table.getByRole('row').nth(1).boundingBox())!.height).toBeLessThanOrEqual(64)
  await table.getByRole('row').nth(2).getByRole('button', { name: /^Вернуть общую пару:/ }).first().click()
  await expect(firstRoles.nth(2)).toHaveText(names[1])
  await chooseSpecialist(firstRoles.nth(2), null)
  await firstRoles.nth(2).click()
  const dropdown = page.getByRole('listbox', { name: firstRole, exact: true })
  await expect(dropdown).toBeInViewport()
  await page.keyboard.press('Escape')
  await expect(dropdown).toBeHidden()
  await expect(dialog).toBeVisible()
  await dialog.screenshot({ path: `/private/tmp/specialist-design-results-${stage}.png` })
  await dialog.getByRole('button', { name: isPre ? 'Сохранить результат до ТО' : 'Сохранить результат', exact: true }).click()
  await expect(dialog).toBeHidden()
  const stored = () => withE2eDatabase(async db => (await db.query(`select distinct d.id,d.title,d.specialists from generated_documents d join generated_document_weld_joints a on a.document_id=d.id join weld_joints w on w.id=a.weld_joint_id where w.project_title=$1 and d.type=$2 and d.period_from='2026-09-06' order by d.id`, [project, isPre ? 'system:lnkConclusionVik' : 'system:pstoConclusion'])).rows)
  const snapshots = await stored()
  const defaultKey = isPre ? 'lnkConclusionVik' : 'pstoConclusion'
  const readDefaults = () => withE2eDatabase(async db => JSON.parse((await db.query("select value from app_settings where key='document-specialist-defaults'")).rows[0].value))
  expect((await readDefaults())[defaultKey]).toEqual({ first: people[1].id, second: people[0].id })
  expect(snapshots).toHaveLength(2)
  expect(snapshots.filter(doc => doc.specialists?.first?.id === people[1].id)).toHaveLength(1)
  expect(snapshots.filter(doc => doc.specialists?.first === null)).toHaveLength(1)
  expect(snapshots.every(doc => doc.specialists?.second?.id === people[0].id)).toBe(true)
  for (const document of snapshots) expect(await loadSystemDocumentSpecialistSnapshot({ type: isPre ? 'lnkConclusion' : 'pstoConclusion', title: document.title, date: '2026-09-06', sourceKind: isPre ? 'beforeHeatTreatment' : 'pstoCycle', ...(isPre ? { methodCode: 'ВИК' } : { cycleSequences: [1] }) })).toEqual(document.specialists)
  // Raw fixture writes must advance the same revisions as an application save;
  // otherwise a cached count of two can accompany the three newly seeded rows.
  await withLineProgramFixture(async db => {
    const inserted = await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,officiality,revision_actuality,has_vik,psto_required,psto_request,psto_request_date)
      values($1,'SPEC','SPEC-L3','F99003','2026-09-01','действующий','актуальная','да','да',case when $2::boolean then null else 'Spec PSTO request' end,case when $2::boolean then null else '2026-09-03'::date end) returning id`, [project, isPre])
    await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,result,conclusion_name,conclusion_date,defect_description)
      values($1,'ВИК','Spec pre request','2026-09-02',case when $2::boolean then null else 'годен' end,case when $2::boolean then null else 'Spec previous pre conclusion' end,case when $2::boolean then null else '2026-09-02'::date end,case when $2::boolean then null else 'ДНО' end)`, [inserted.rows[0].id, isPre])
  })
  async function reopen() {
    await page.reload()
    await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(project)
    const newRow = isPre
      ? await lnkActionRow(page, 'F99003')
      : await pstoActionRow(page, 'F99003')
    await newRow.getByRole('button', { name: isPre ? 'Выполнить: Внести результат НК до ТО' : 'Выполнить: Внести результат ПСТО · цикл 1', exact: true }).click()
    await expect(dialog.getByRole('combobox', { name: 'Разделение документов', exact: true })).toBeEnabled()
    await dialog.getByRole('tab', { name: 'Специалисты', exact: true }).click()
  }
  await reopen()
  await expect(common.getByRole('combobox', { name: firstRole, exact: true })).toHaveText(names[1])
  await expect(common.getByRole('combobox', { name: secondRole, exact: true })).toHaveText(names[0])
  await common.getByRole('button', { name: `Очистить роль «${firstRole}»`, exact: true }).click()
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect((await readDefaults())[defaultKey]).toEqual({ first: people[1].id, second: people[0].id })
  await withE2eDatabase(db => db.query('update specialists set archived=true,revision=revision+1 where id=$1', [people[1].id]))
  await reopen()
  await expect(common.getByRole('combobox', { name: firstRole, exact: true })).toHaveText('Не назначен')
  await expect(common.getByRole('combobox', { name: secondRole, exact: true })).toHaveText(names[0])
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(await stored()).toEqual(snapshots)
  async function operation(action: DocumentOperationRequest['action'], merge: boolean, mode: DocumentOperationRequest['mode']) {
    const request = { documentIds: (await stored()).map(doc => doc.id), action, merge, mode }
    const preview = await previewOperation(request), operationId = randomUUID()
    const data = { ...request, fingerprint: preview.fingerprint, previewHash: preview.previewHash, operationId }
    try {
      if (preview.groups.some(group => group.specialistsCleared)) await expect(applyOperation(data)).rejects.toThrow('предупреждение об очистке')
      await applyOperation({ ...data, acceptSpecialistClearing: true })
    }
    finally { await withE2eDatabase(db => db.query('delete from document_operation_receipts where id=$1', [operationId])) }
    return preview
  }
  expect((await operation('merge', true, 'none')).groups[0].specialistsCleared).toBe(true)
  const merged = await stored()
  expect(merged).toHaveLength(1)
  expect(merged[0].specialists).toEqual({ first: null, second: null })
  const historical = { first: { id: people[0].id, name: names[0], certificate: 'ИСТОРИЧЕСКОЕ' }, second: null }
  await withE2eDatabase(db => db.query('update generated_documents set specialists=$1::jsonb where id=$2', [JSON.stringify(historical), merged[0].id]))
  await operation('split', false, 'line')
  expect(await stored()).toHaveLength(2)
  expect((await stored()).every(doc => JSON.stringify(doc.specialists) === JSON.stringify(historical))).toBe(true)
  expect((await operation('merge', true, 'none')).groups[0].specialistsCleared).toBe(false)
  expect((await stored())[0].specialists).toEqual(historical)

  // An ordinary per-weld correction implicitly splits a shared document.
  // Both parts must keep the historical pair, even when the source is recreated.
  await page.goto(isPre ? '/lnk' : '/psto')
  await page.locator('header').getByRole('button', { name: 'Результат', exact: true }).click()
  await page.getByRole('button', { name: isPre ? 'Все результаты ЛНК' : 'История ПСТО и ТВМТ', exact: true }).click()
  if (isPre) await page.getByRole('group', { name: 'Этап контроля ЛНК' }).getByRole('button', { name: 'До ТО', exact: true }).click()
  const manager = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: isPre ? 'Редактирование результатов ЛНК до ТО' : 'История ПСТО и ТВМТ', exact: true }) })
  // Both fixture rows are already visible. Do not start a second asynchronous
  // registry search while testing the correction/confirmation workflow.
  await manager.getByRole('button', { name: /SPEC-L1 · F99001/ }).click()
  const card = isPre ? manager : manager.getByRole('heading', { name: 'Результат ПСТО', exact: true }).locator('xpath=ancestor::article')
  const nameInput = card.getByRole('textbox', { name: isPre ? 'Наименование заключения' : 'Наименование диаграммы', exact: true })
  await nameInput.fill('Spec corrected historical document')
  await card.getByRole('button', { name: isPre ? 'Сохранить реквизиты' : 'Сохранить', exact: true }).click()
  await expect.poll(async () => (await stored()).length).toBe(2)
  await expect(page.getByText(isPre ? 'Результат НК до ТО обновлен.' : 'Этап цикла ПСТО/ТВМТ обновлен.', { exact: true })).toBeVisible()
  await expect(card.getByRole('button', { name: isPre ? 'Сохранить реквизиты' : 'Сохранить', exact: true })).toBeDisabled()
  expect((await stored()).every(document => JSON.stringify(document.specialists) === JSON.stringify(historical))).toBe(true)
  // Merge back by editing the name. A conflicting certificate must require
  // confirmation; cancellation leaves both original documents intact.
  const documents = await stored()
  const target = documents.find(document => document.title !== 'Spec corrected historical document')!
  await withE2eDatabase(db => db.query('update generated_documents set specialists=null,specialists_revision=specialists_revision+1 where id=$1', [target.id]))
  await nameInput.fill(target.title)
  await card.getByRole('button', { name: isPre ? 'Сохранить реквизиты' : 'Сохранить', exact: true }).click()
  const warning = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Очистить специалистов при объединении?', exact: true }) })
  await expect(warning).toBeVisible()
  await warning.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(await stored()).toHaveLength(2)
  expect((await stored()).find(document => document.title === 'Spec corrected historical document')!.specialists).toEqual(historical)
  await nameInput.fill(target.title)
  await card.getByRole('button', { name: isPre ? 'Сохранить реквизиты' : 'Сохранить', exact: true }).click()
  await warning.getByRole('button', { name: 'Сохранить и очистить роли', exact: true }).click()
  await expect.poll(async () => (await stored()).length).toBe(1)
  expect((await stored())[0].specialists).toEqual({ first: null, second: null })
})
