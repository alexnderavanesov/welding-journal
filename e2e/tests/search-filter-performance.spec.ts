import { editJournalJoint } from '../journal-grid'
import { expect, test, type Page } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { observeMixedClient, sampleMixedResources } from '../mixed-resource-telemetry'
import { rpcName } from '../rpc'
import { getBusinessDateIso } from '../../src/lib/business-date'

const project = 'E2E search performance 200k'
const summary = (page: Page) => page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' })
  .locator('xpath=../..').locator(':scope > span')
const now = () => performance.now()
const elapsed = (start: number) => Math.round(now() - start)
const fresh = () => withE2eDatabase(async db => (await db.query(
  'select source_revision=computed_revision and not full_rebuild as fresh from dispatcher_task_index_state where id=1',
)).rows[0]?.fresh === true)
const indexSignature = () => withE2eDatabase(async db => (await db.query(`select
  (select md5(string_agg(concat(weld_joint_id,':',task_key,':',xmin::text),',' order by weld_joint_id,task_key)) from dispatcher_row_tasks) as rows,
  (select md5(string_agg(concat(scope_key,':',page_number,':',xmin::text),',' order by scope_key,page_number)) from dispatcher_task_pages) as pages`)).rows[0])

// Stable semantic signatures for before/after implementation comparisons.
// Exclude service revisions/timestamps; retain exact card order and contents.
const semanticSignature = () => withE2eDatabase(async db => (await db.query(`select
  (select md5(string_agg(concat(id,':',final_status),',' order by id)) from weld_joints) as statuses,
  (select md5(string_agg(concat(weld_joint_id,':',task_key,':',code),',' order by weld_joint_id,task_key)) from dispatcher_row_tasks) as row_index,
  (select md5(string_agg(concat(scope_key,':',page_number,':',task_count,':',md5(tasks)),',' order by scope_key,page_number)) from dispatcher_task_pages) as pages,
  (select count(*)::int from dispatcher_row_tasks) as index_rows,
  (select sum(task_count)::int from dispatcher_task_pages) as tasks`)).rows[0])

async function seed(page: Page) {
  await page.goto('/references')
  await page.getByRole('button', { name: 'Добавить клеймо', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Клеймо НАКС', { exact: true }).fill('SRC1')
  await expect(dialog.getByLabel('Клеймо НАКС', { exact: true })).toHaveValue('SRC1')
  await dialog.getByLabel('ФИО сварщика', { exact: true }).fill('Поиск нагрузочный')
  await dialog.getByRole('button', { name: 'Добавить ДЛС', exact: true }).click()
  for (const permit of await dialog.locator('[data-permit-editor-id]').all()) {
  for (const name of ['РАД', 'М01']) {
    const button = permit.getByRole('button', { name, exact: true })
    if (await button.getAttribute('aria-pressed') !== 'true') await button.click()
  }
  for (const [label, value] of [['Диаметр от', '1'], ['Диаметр до', '500'], ['Толщина от', '1'], ['Толщина до', '20'], ['Срок от', '2026-01-01'], ['Срок до', '2026-12-31']]) {
    await permit.getByLabel(label, { exact: true }).fill(value)
  }
  }
  await dialog.locator('[data-permit-editor-id]').last().getByLabel('Номер ДЛС', { exact: true }).fill('ДЛС-SRC1')
  await dialog.getByRole('button', { name: 'Добавить клеймо', exact: true }).click()
  await expect(dialog).toBeHidden()
  await withE2eDatabase(async db => {
    expect((await db.query('select count(*)::int n from weld_joints')).rows[0].n).toBe(1)
    const card = (await db.query(`insert into technology_cards(name,welding_methods,connection_type,material_groups,
      diameter_from,diameter_to,thickness_from,thickness_to,psto,first_used_at)
      values ('SEARCH-CARD',array['РАД'],'С17',array['М01'],1,500,1,20,'any',now()) returning id,name`)).rows[0]
    await db.query('insert into technology_card_names(name,technology_card_id) values($1,$2)', [card.name, card.id])
    await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      select $1,'SEARCH','SEARCH-L'||lpad(n::text,4,'0'),'II','Б(а)',0,0 from generate_series(1,1000) n`, [project])
    await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,isometry,weld_date,
      officiality,revision_actuality,connection_type,material_group,welding_method,d1,t1,d2,t2,category,group_name,
      weld_control_percent,pvk_control_percent,stamp_1_k,stamp_1_z,stamp_1_o,stamp_1_k_fact,stamp_1_z_fact,stamp_1_o_fact,
      has_vik,psto_required,technology_card_number)
      select p.id,p.project_title,p.subtitle_code,p.line,'F'||lpad(n::text,6,'0'),'SEARCH-ISO','2026-09-01',
        'действующий','актуальная','С17','М01','РАД',108,6,108,8,'II','Б(а)',0,0,
        'SRC1','SRC1','SRC1','SRC1','SRC1','SRC1','да','да','SEARCH-CARD'
      from generate_series(1,200000) n join line_programs p on p.project_title=$1
        and p.line='SEARCH-L'||lpad(((n-1)/200+1)::text,4,'0')`, [project])
    await db.query('analyze weld_joints')
    await db.query("update dispatcher_task_index_state set source_revision=source_revision+1,full_rebuild=true,dirty_scopes='[]'")
  })
}

test('200k search: first rows, totals, save and dispatcher readiness are measured independently', async ({ browser }, info) => {
  test.skip(process.env.AUDIT_SEARCH_LOAD !== '1', 'Opt-in fresh isolated database and resource-limited server')
  test.setTimeout(900_000)
  const contexts = await Promise.all(Array.from({ length: 5 }, () => browser.newContext({
    baseURL: 'http://127.0.0.1:3100', viewport: { width: 1600, height: 1000 },
  })))
  const clients = contexts.map((context, i) => observeMixedClient(context, `search-${i}`))
  const pages = await Promise.all(contexts.map(context => context.newPage()))
  const paths = ['/journal', '/lnk', '/psto', '/journal', '/journal']
  const measurements: Record<string, unknown>[] = []
  let stopResources: Awaited<ReturnType<typeof sampleMixedResources>> | undefined
  const record = (value: Record<string, unknown>) => { measurements.push(value); console.log(JSON.stringify({ phase: 'search timing', ...value })) }
  try {
    await seed(pages[0])
    stopResources = await sampleMixedResources(browser)
    const coldStarted = now()
    await Promise.all(pages.map(async (page, i) => {
      const start = now()
      await page.goto(paths[i])
      await expect(page.getByRole('button', { name: /^F\d{6}$/, exact: true }).first()).toBeVisible()
      record({ action: 'cold first rows', client: i, milliseconds: elapsed(start) })
      await expect(summary(page)).not.toContainText(/Загрузка|Ид[её]т подсч[её]т/)
      record({ action: 'cold summary visible', client: i, milliseconds: elapsed(start) })
    }))
    await expect.poll(fresh, { timeout: 180_000 }).toBe(true)
    record({ action: 'cold dispatcher ready', milliseconds: elapsed(coldStarted) })
    record({ action: 'cold semantic signature', ...await semanticSignature() })

    if (process.env.AUDIT_SEARCH_DATE === '1') {
      const beforeDay = await indexSignature()
      await withE2eDatabase(db => db.query("update dispatcher_task_index_state set computed_at=computed_at-interval '1 day' where id=1"))
      const dayStarted = now()
      await pages[0].reload({ waitUntil: 'domcontentloaded' })
      await expect.poll(() => withE2eDatabase(async db => {
        const { computed_at, source_revision, computed_revision } = (await db.query('select * from dispatcher_task_index_state where id=1')).rows[0]
        return source_revision === computed_revision && getBusinessDateIso(computed_at) === getBusinessDateIso()
      }), { timeout: 180_000 }).toBe(true)
      record({ action: 'new business day dispatcher ready, 200k unchanged past welds', milliseconds: elapsed(dayStarted) })
      expect(await indexSignature()).toEqual(beforeDay)
    }

    const search = async (page: Page, client: number, term: string, action: string) => {
      const start = now(), before = clients[client].calls.length
      const response = page.waitForResponse(response => /^list(WeldingJournal|LnkReport|HeatTreatmentReport)Page_/.test(rpcName(response.url()))
        && !!new URL(response.url()).searchParams.get('payload')?.includes(term) && response.ok())
      await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(term)
      await (await response).finished()
      await expect(page.getByRole('button', { name: term, exact: true })).toBeVisible()
      record({ action: `${action} rows`, client, milliseconds: elapsed(start) })
      await expect(summary(page)).toContainText(/(?:Записей|Стыков на ЛНК|Стыков на ПСТО): 1(?:\s|·|$)/)
      record({ action: `${action} summary`, client, milliseconds: elapsed(start), rpc: clients[client].calls.slice(before) })
    }
    for (const term of ['F000123', 'F199999', 'F020000']) await search(pages[0], 0, term, 'single search')
    for (const term of ['F000124', 'F199998']) await Promise.all(pages.map((page, i) => search(page, i, term, 'five-client search')))

    const page = pages[0]
    await search(page, 0, 'F000125', 'before save')
    const openStarted = now()
    await editJournalJoint(page, 'F000125')
    const editor = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование стыка', exact: true }) })
    await editor.getByRole('button', { name: 'Стык', exact: true }).first().click()
    await expect(editor.getByLabel('Изометрия', { exact: true })).toHaveValue('SEARCH-ISO')
    record({ action: 'editor ready', milliseconds: elapsed(openStarted) })
    await editor.getByLabel('Изометрия', { exact: true }).fill('SEARCH-SAVED')
    const saveStarted = now()
    const saveResponse = page.waitForResponse(response => rpcName(response.url()).startsWith('updateWeldJoint_'))
    await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await (await saveResponse).finished()
    record({ action: 'save response', milliseconds: elapsed(saveStarted) })
    await expect(editor).toBeHidden()
    record({ action: 'editor closed after save', milliseconds: elapsed(saveStarted) })
    expect(await withE2eDatabase(async db => (await db.query('select isometry from weld_joints where project_title=$1 and joint=$2', [project, 'F000125'])).rows[0].isometry)).toBe('SEARCH-SAVED')
    await expect.poll(fresh, { timeout: 180_000 }).toBe(true)
    record({ action: 'dispatcher ready after save', milliseconds: elapsed(saveStarted) })

    await withE2eDatabase(db => db.query("update dispatcher_task_index_state set source_revision=source_revision+1,full_rebuild=true,dirty_scopes='[]'"))
    const busyStarted = now()
    await page.reload({ waitUntil: 'domcontentloaded' })
    await Promise.all(pages.map((page, i) => search(page, i, 'F123456', 'during full rebuild')))
    await expect.poll(fresh, { timeout: 180_000 }).toBe(true)
    record({ action: 'full rebuild ready with active searches', milliseconds: elapsed(busyStarted) })
    record({ action: 'warm semantic signature', ...await semanticSignature() })
    if (process.env.AUDIT_SEARCH_EXTRA === '1') {
      await Promise.all(pages.slice(0, 3).map(async (page, client) => {
        const start = now(), before = clients[client].calls.length
        await page.goto('/line-program')
        await expect(page.getByTestId('line-program-card').first()).toBeVisible()
        record({ action: 'three-client line program cold', client, milliseconds: elapsed(start), rpc: clients[client].calls.slice(before) })
        const beforeSearch = clients[client].calls.length, searchStart = now()
        await page.getByLabel('Поиск программы линий', { exact: true }).fill('SEARCH-L0001')
        await expect(page.getByTestId('line-program-card')).toHaveCount(1)
        record({ action: 'line program cached search', client, milliseconds: elapsed(searchStart), rpc: clients[client].calls.slice(beforeSearch) })
      }))
      const lineStart = now(), beforeLine = clients[0].calls.length
      await pages[0].reload()
      await expect(pages[0].getByTestId('line-program-card').first()).toBeVisible()
      record({ action: 'line program warm reload', milliseconds: elapsed(lineStart), rpc: clients[0].calls.slice(beforeLine) })
    }
    if (process.env.AUDIT_SEARCH_REGISTRY === '1') {
      const before = await indexSignature()
      await page.goto('/references')
      await page.getByText('SRC1', { exact: true }).first().click()
      await page.getByRole('button', { name: 'Редактировать', exact: true }).click()
      const registryEditor = page.getByRole('dialog')
      await registryEditor.getByLabel('ФИО сварщика', { exact: true }).fill('Поиск нагрузочный — исправлено ФИО')
      const nameStart = now()
      const nameResponse = page.waitForResponse(response => rpcName(response.url()).startsWith('saveWelderStampRecords_'))
      await registryEditor.getByRole('button', { name: 'Сохранить клеймо', exact: true }).click()
      expect((await nameResponse).ok()).toBe(true)
      await expect(registryEditor).toBeHidden()
      record({ action: 'registry name save, all 200k use the stamp', milliseconds: elapsed(nameStart) })
      await expect.poll(fresh, { timeout: 180_000 }).toBe(true)
      record({ action: 'registry name dispatcher ready', milliseconds: elapsed(nameStart) })
      expect(await indexSignature()).toEqual(before)

      await page.getByRole('button', { name: 'Редактировать', exact: true }).click()
      for (const permit of await registryEditor.locator('[data-permit-editor-id]').all()) {
        await permit.getByLabel('Диаметр до', { exact: true }).fill('600')
      }
      const expansionStart = now()
      const expansionResponse = page.waitForResponse(response => rpcName(response.url()).startsWith('saveWelderStampRecords_'))
      await registryEditor.getByRole('button', { name: 'Сохранить клеймо', exact: true }).click()
      expect((await expansionResponse).ok()).toBe(true)
      await expect(registryEditor).toBeHidden()
      record({ action: 'registry qualification expansion save, all 200k still eligible', milliseconds: elapsed(expansionStart) })
      await expect.poll(fresh, { timeout: 180_000 }).toBe(true)
      record({ action: 'registry qualification expansion dispatcher ready', milliseconds: elapsed(expansionStart) })
      expect(await indexSignature()).toEqual(before)

      await page.getByRole('button', { name: 'Редактировать', exact: true }).click()
      for (const permit of await registryEditor.locator('[data-permit-editor-id]').all()) {
        await permit.getByLabel('Диаметр до', { exact: true }).fill('100')
      }
      const permitStart = now()
      const permitResponse = page.waitForResponse(response => rpcName(response.url()).startsWith('saveWelderStampRecords_'))
      await registryEditor.getByRole('button', { name: 'Сохранить клеймо', exact: true }).click()
      expect((await permitResponse).ok()).toBe(true)
      await expect(registryEditor).toBeHidden()
      record({ action: 'registry qualification save, all 200k affected', milliseconds: elapsed(permitStart) })
      await expect.poll(fresh, { timeout: 180_000 }).toBe(true)
      record({ action: 'registry qualification dispatcher ready', milliseconds: elapsed(permitStart) })
      expect(await withE2eDatabase(async db => (await db.query(`select count(distinct t.weld_joint_id)::int n
        from dispatcher_row_tasks t join weld_joints w on w.id=t.weld_joint_id
        where w.project_title=$1 and t.code='СП-02'`, [project])).rows[0].n)).toBe(200_000)
    }
    for (const client of clients) expect(client.errors).toEqual([])
  } finally {
    if (stopResources) console.log(JSON.stringify({ phase: 'search resources', ...await stopResources() }))
    for (const client of clients) console.log(JSON.stringify({ phase: 'search client', ...await client.summary() }))
    await info.attach('search-measurements', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' })
    await Promise.all(contexts.map(context => context.close()))
  }
})
