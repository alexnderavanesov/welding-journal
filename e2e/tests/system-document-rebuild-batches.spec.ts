import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { rpcName } from '../rpc'
import { REQUEST_CONCLUSION_DEFAULT_SETTINGS } from '../../src/lib/request-conclusion-settings'
import { buildCurrentSystemDocumentName } from '../../src/lib/system-document-types'
import { REBUILD_DOCUMENT_LIMIT } from '../../src/lib/system-document-rebuild-batch'

const project = 'E2E bounded document packets'
let setting: { value: string; updated_at: Date } | undefined
let template: { constructor_config: string | null; updated_at: Date } | undefined
let touchedTemplate = false
async function indexSeededRequests() {
  // Raw SQL fixtures bypass normal save/index synchronization. Materialize the
  // same scoped indexes explicitly; do not rely on a once-per-database cold init.
  const [{ requireDb }, { weldJoints }, { eq }, { syncSystemDocumentsForWeldChangesInTransaction }] = await Promise.all([
    import('../../src/db'), import('../../src/db/schema'), import('drizzle-orm'), import('../../src/server/system-document-index'),
  ])
  await requireDb().transaction(async tx => {
    const rows = await tx.select().from(weldJoints).where(eq(weldJoints.projectTitle, project))
    await syncSystemDocumentsForWeldChangesInTransaction(tx, rows, new Map())
  })
}
test.afterEach(async () => {
  await withE2eDatabase(async db => {
    await db.query('drop trigger if exists e2e_batch_failure on weld_joints')
    await db.query('drop function if exists e2e_batch_failure()')
    if (setting) await db.query(`update app_settings set value=$1,updated_at=$2 where key='request-conclusion'`, [setting.value, setting.updated_at])
    else await db.query(`delete from app_settings where key='request-conclusion'`)
    if (touchedTemplate) {
      if (template) await db.query(`update document_templates set constructor_config=$1,updated_at=$2 where id='layeredVikEdges'`, [template.constructor_config, template.updated_at])
      else await db.query(`delete from document_templates where id='layeredVikEdges'`)
      touchedTemplate = false
    }
  })
  await cleanupLineProgramProjects([project])
})

test('each packet is atomic: completed work survives later failure/cancel; retry finishes without reprocessing new documents', async ({ page }, info) => {
  test.setTimeout(120_000)
  const names = Array.from({ length: REBUILD_DOCUMENT_LIMIT + 1 }, (_, i) => buildCurrentSystemDocumentName({
    type: 'lnkRequest', title: '', date: '2026-09-02',
  }, [], REQUEST_CONCLUSION_DEFAULT_SETTINGS, i + 1))
  await withE2eDatabase(async db => {
    setting = (await db.query(`select value,updated_at from app_settings where key='request-conclusion'`)).rows[0]
    await db.query(`insert into app_settings(key,value) values ('request-conclusion',$1)
      on conflict(key) do update set value=excluded.value`, [JSON.stringify({ ...REQUEST_CONCLUSION_DEFAULT_SETTINGS,
      splitModes: { ...REQUEST_CONCLUSION_DEFAULT_SETTINGS.splitModes, lnkRequest: 'line' } })])
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,officiality,revision_actuality,has_vik,vik_request,vik_request_date)
      select $1,'BATCH','L'||(n%2),'F'||n,'2026-09-01','действующий','актуальная','да',($2::text[])[(n-1)/2+1],'2026-09-02'
      from generate_series(1,$3::integer) n`, [project, names, names.length * 2])
  })
  const calls: string[] = [], errors: string[] = []
  await indexSeededRequests()
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Заявки и заключения', exact: true }).click()
  await page.getByRole('button', { name: 'Пересобрать системные документы по текущим правилам', exact: true }).click()
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Пересборка системных документов', exact: true }) })
  const apply = dialog.getByRole('button', { name: 'Применить пересборку', exact: true })
  await expect(apply).toBeEnabled()
  await apply.click()
  await expect(dialog.getByRole('status')).toContainText('Пакет 1 сохранён.')
  // Other, unchanged documents may legitimately occupy part of the first
  // packet in a full suite (or a real archive). Count our unsplit documents
  // independently by their two physical lines, not by the packet ceiling.
  const remaining = await withE2eDatabase(async db => Number((await db.query(`select count(*)::int as n from (
    select vik_request from weld_joints where project_title=$1 group by vik_request having count(distinct line)=2
  ) pending`, [project])).rows[0].n))
  expect(remaining).toBeGreaterThan(0)
  expect(remaining).toBeLessThanOrEqual(REBUILD_DOCUMENT_LIMIT)
  await expect(apply).toBeDisabled()
  expect(calls.filter(name => name.startsWith('applySystemDocumentRebuild_'))).toHaveLength(1)
  const snapshot = async () => withE2eDatabase(async db => ({
    rows: (await db.query(`select * from weld_joints where project_title=$1 order by id`, [project])).rows,
    docs: (await db.query(`select * from generated_documents order by id`)).rows,
    links: (await db.query(`select * from generated_document_weld_joints order by document_id,weld_joint_id`)).rows,
    counters: (await db.query(`select key,value from app_settings where key like 'system-document-next-number:%' order by key`)).rows,
  }))
  const saved = await snapshot()
  await withE2eDatabase(async db => {
    await db.query(`create function e2e_batch_failure() returns trigger language plpgsql as $$
      begin if old.project_title='E2E bounded document packets' and new.vik_request is distinct from old.vik_request then
      raise exception 'E2E second packet failure'; end if; return new; end $$`)
    await db.query(`create trigger e2e_batch_failure before update on weld_joints for each row execute function e2e_batch_failure()`)
  })
  await dialog.getByRole('button', { name: 'Следующий пакет', exact: true }).click()
  await expect(apply).toBeEnabled()
  await apply.click()
  await expect(dialog.locator('.text-rose-700')).toBeVisible()
  await expect(dialog.locator('.text-rose-700')).toBeInViewport()
  await expect(dialog.getByRole('alert')).toContainText('Не удалось подтвердить сохранение пакета')
  await expect(dialog.getByRole('alert')).not.toContainText('Failed query:')
  expect(await snapshot()).toEqual(saved)
  await page.screenshot({ path: info.outputPath('second-packet-rolled-back.png') })
  await withE2eDatabase(async db => {
    await db.query('drop trigger e2e_batch_failure on weld_joints')
    await db.query('drop function e2e_batch_failure()')
  })
  // A failed transaction consumes neither the preview nor the business counter.
  await apply.click()
  await expect(dialog.getByRole('status')).toContainText(`Пересобрано документов: ${remaining}.`)
  await expect(dialog.getByRole('button', { name: 'Следующий пакет', exact: true })).toHaveCount(0)
  const completed = await snapshot()
  expect(completed.docs.length - saved.docs.length).toBe(remaining)
  expect(new Set(completed.rows.map(row => row.vik_request)).size).toBe(names.length * 2)
  expect(calls.filter(name => name.startsWith('previewSystemDocumentRebuild_'))).toHaveLength(2)
  expect(calls.filter(name => name.startsWith('applySystemDocumentRebuild_'))).toHaveLength(3)
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(await snapshot()).toEqual(completed)
  expect(errors).toEqual([])
})

test('names-only packet still refreshes layered titles whose constructor references an ordinary NK name', async ({ page }) => {
  const originalName = buildCurrentSystemDocumentName({ type: 'lnkRequest', title: '', date: '2026-09-02' }, [], REQUEST_CONCLUSION_DEFAULT_SETTINGS, 900)
  await withE2eDatabase(async db => {
    setting = (await db.query(`select value,updated_at from app_settings where key='request-conclusion'`)).rows[0]
    await db.query(`insert into app_settings(key,value) values ('request-conclusion',$1)
      on conflict(key) do update set value=excluded.value`, [JSON.stringify({ ...REQUEST_CONCLUSION_DEFAULT_SETTINGS,
      splitModes: { ...REQUEST_CONCLUSION_DEFAULT_SETTINGS.splitModes, lnkRequest: 'line' } })])
    template = (await db.query(`select constructor_config,updated_at from document_templates where id='layeredVikEdges'`)).rows[0]
    touchedTemplate = true
    const config = JSON.stringify({ nameConfig: { parts: [{ type: 'text', text: 'Ссылка ' }, { type: 'field', field: 'vikRequest' }, { type: 'text', text: ' ' }, { type: 'field', field: 'joint' }] } })
    await db.query(`insert into document_templates(id,blob_key,file_name,file_type,file_size,metadata,constructor_config)
      values ('layeredVikEdges','e2e-placeholder','e2e.xlsx','xlsx',0,'{}',$1)
      on conflict(id) do update set constructor_config=excluded.constructor_config`, [config])
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,officiality,revision_actuality,has_vik,has_pvk,
      connection_type,layered_control_assigned,pvk_result,vik_request,vik_request_date)
      select $1,'BATCH','L'||n,'U'||n,'2026-09-01','действующий','актуальная','да','да','У19',true,'годен',$2,'2026-09-02'
      from generate_series(1,2) n`, [project, originalName])
  })
  await indexSeededRequests()
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Заявки и заключения', exact: true }).click()
  await page.getByRole('button', { name: 'Пересобрать системные документы по текущим правилам', exact: true }).click()
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Пересборка системных документов', exact: true }) })
  await expect(dialog.getByRole('button', { name: 'Применить пересборку', exact: true })).toBeEnabled()
  const load = () => withE2eDatabase(async db => (await db.query(`select d.id,d.type,d.title,d.document_number,w.id as weld_id,w.vik_request
    from generated_documents d join generated_document_weld_joints a on a.document_id=d.id join weld_joints w on w.id=a.weld_joint_id
    where w.project_title=$1 and d.type like 'layered%' order by d.id`, [project])).rows)
  const before = await load()
  expect(before).toHaveLength(8)
  await dialog.getByRole('button', { name: 'Применить пересборку', exact: true }).click()
  await expect(dialog).toBeHidden()
  const after = await load()
  expect(after.map(({ id, document_number }) => ({ id, document_number }))).toEqual(before.map(({ id, document_number }) => ({ id, document_number })))
  expect(new Set(after.map(row => row.vik_request)).size).toBe(2)
  for (const row of after.filter(row => row.type === 'layeredVikEdges')) expect(row.title).toContain(row.vik_request)
  for (const row of after.filter(row => row.type !== 'layeredVikEdges')) expect(row.title).toBe(before.find(old => old.id === row.id).title)
})

test('manual names cannot capture a same-date document outside the current packet', async ({ page }) => {
  const names = Array.from({ length: REBUILD_DOCUMENT_LIMIT + 1 }, (_, i) => `Ручной пакетный ${String(i + 1).padStart(4, '0')}`)
  await withE2eDatabase(async db => {
    setting = (await db.query(`select value,updated_at from app_settings where key='request-conclusion'`)).rows[0]
    await db.query(`insert into app_settings(key,value) values ('request-conclusion',$1)
      on conflict(key) do update set value=excluded.value`, [JSON.stringify({ ...REQUEST_CONCLUSION_DEFAULT_SETTINGS,
      splitModes: { ...REQUEST_CONCLUSION_DEFAULT_SETTINGS.splitModes, lnkRequest: 'line' } })])
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,officiality,revision_actuality,has_vik,vik_request,vik_request_date)
      select $1,'BATCH','L'||(n%2),'F'||n,'2026-09-01','действующий','актуальная','да',($2::text[])[(n-1)/2+1],'2026-09-02'
      from generate_series(1,$3::integer) n`, [project, names, names.length * 2])
  })
  await indexSeededRequests()
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Заявки и заключения', exact: true }).click()
  await page.getByRole('button', { name: 'Пересобрать системные документы по текущим правилам', exact: true }).click()
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Пересборка системных документов', exact: true }) })
  await expect(dialog.getByText('Область пересборки', { exact: true })).toBeVisible()
  const outside = await withE2eDatabase(async db => (await db.query(`select d.title from generated_documents d
    where exists(select 1 from generated_document_weld_joints a join weld_joints w on w.id=a.weld_joint_id
      where a.document_id=d.id and w.project_title=$1) order by d.id desc limit 1`, [project])).rows[0].title as string)
  const state = () => withE2eDatabase(async db => ({
    rows: (await db.query(`select * from weld_joints where project_title=$1 order by id`, [project])).rows,
    docs: (await db.query(`select * from generated_documents order by id`)).rows,
    counters: (await db.query(`select key,value from app_settings where key like 'system-document-next-number:%' order by key`)).rows,
  }))
  const before = await state()
  await dialog.getByRole('button', { name: 'Пересобрать вручную', exact: true }).first().click()
  await expect(dialog.getByRole('alert')).toBeInViewport()
  await expect(dialog.getByRole('button', { name: 'Применить пересборку', exact: true })).toBeDisabled()
  await dialog.getByPlaceholder('Название нового документа').nth(0).fill(outside)
  await dialog.getByPlaceholder('Название нового документа').nth(1).fill('Вторая независимая группа')
  await dialog.getByRole('button', { name: 'Применить пересборку', exact: true }).click()
  await expect(dialog.locator('.text-rose-700')).toContainText('вне пакета')
  await expect(dialog.getByRole('alert')).toBeInViewport()
  expect(await state()).toEqual(before)
  await dialog.getByPlaceholder('Название нового документа').nth(0).fill('Первая независимая группа')
  await dialog.getByRole('button', { name: 'Применить пересборку', exact: true }).click()
  await expect(dialog.getByRole('status')).toContainText('Пересобрано документов: 1.')
  expect((await state()).rows.filter(row => row.vik_request === outside)).toHaveLength(2)
})
