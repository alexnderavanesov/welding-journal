import { expect, test, type Locator, type Page, type Request } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { rpcName } from '../rpc'
import { cleanupLineProgramProjects } from '../line-program-fixtures'

const codes = ['EPA1', 'EPA2', 'EPA3', 'EPA5']
const project = 'E2E qualification 200k'
const saved = (code: string) => withE2eDatabase(async db => {
  const row = (await db.query('select * from welder_stamps where naks_stamp=$1', [code])).rows[0]
  return row && { ...row, naks_permits: JSON.parse(row.naks_permits), dls_permits: JSON.parse(row.dls_permits || '[]') }
})
test.afterEach(async ({ page }) => {
  await page.close()
  await cleanupLineProgramProjects([project])
  await withE2eDatabase(async db => {
    await db.query('delete from welder_stamps where naks_stamp=any($1)', [codes])
    await db.query("update dispatcher_task_index_state set source_revision=source_revision+1,full_rebuild=true,dirty_scopes='[]'")
  })
})

test('изменение допуска через UI на 200000 стыков: СП-02 обновляется, факты сохраняются, SQL пакетный', async ({ page }) => {
  test.setTimeout(240_000)
  await page.goto('/welder-stamps')
  await create(page, 'EPA3', ['М01', 'М05'])
  const [{ requireDb }, { markDispatcherTaskIndexDirty }, dispatcher, read, pg] = await Promise.all([
    import('../../src/db'), import('../../src/server/dispatcher-task-index-dirty'), import('../../src/server/dispatcher-task-index'),
    import('../../src/server/weld-read'), import('pg'),
  ])
  await withE2eDatabase(async db => {
    await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      select $1,'QUAL','QUAL-'||n,'II','Б(а)',0,0 from generate_series(1,1000) n`, [project])
    await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,weld_date,connection_type,material_group,
      welding_method,d1,t1,d2,t2,category,group_name,weld_control_percent,pvk_control_percent,
      stamp_1_k,stamp_1_z,stamp_1_o,stamp_1_k_fact,stamp_1_z_fact,stamp_1_o_fact,
      has_vik,vik_result,vik_request,vik_request_date,vik_conclusion,vik_conclusion_date)
      select p.id,p.project_title,p.subtitle_code,p.line,'F'||n,'2026-07-01','С17',
      case when p.line='QUAL-1' and n<=2 or p.line='QUAL-2' and n=1 then 'М01 + М05' else 'М01' end,
      'РАД',108,6,108,8,'II','Б(а)',0,0,'EPA3','EPA3','EPA3','EPA3','EPA3','EPA3',
      'да','годен','VIK-QUAL','2026-07-01','VIK-QUAL-C','2026-07-01'
      from line_programs p cross join generate_series(1,200) n where p.project_title=$1`, [project])
    await db.query('analyze weld_joints')
  })
  // final_status is a derived cache, refreshed by the dispatcher; every fact and timestamp is compared.
  const facts = () => withE2eDatabase(async db => (await db.query("select count(*)::int n,md5(string_agg(md5((to_jsonb(w)-'final_status')::text),'' order by id)) hash from weld_joints w where project_title=$1", [project])).rows[0])
  const before = await facts()
  expect(before.n).toBe(200_000)
  const affected = await withE2eDatabase(async db => (await db.query("select id from weld_joints where project_title=$1 and material_group='М01 + М05' order by id", [project])).rows)
  expect(affected).toHaveLength(3)
  const prototype = pg.default.Client.prototype, original = prototype.query
  let statements = 0
  prototype.query = function (this: unknown, ...args: unknown[]) { statements++; return (original as (...args: unknown[]) => unknown).apply(this, args) } as typeof original
  const measurements: unknown[] = []
  try {
    await markDispatcherTaskIndexDirty(requireDb())
    const refresh = async (phase: string, expected: number) => {
      statements = 0
      const start = performance.now()
      await dispatcher.ensureDispatcherTaskIndexFresh()
      measurements.push({ phase, joints: 200_000, queries: statements, milliseconds: Math.round(performance.now() - start) })
      expect(statements).toBeLessThan(200) // Batch reads/staging, not one request for every joint.
      const tasks = await withE2eDatabase(async db => (await db.query("select t.weld_joint_id from dispatcher_row_tasks t join weld_joints w on w.id=t.weld_joint_id where w.project_title=$1 and t.code='СП-02'", [project])).rows)
      expect(tasks).toHaveLength(expected)
      const virtual = await read.attachDispatcherTaskCodesToPage(affected)
      expect(virtual.filter(value => String((value as { dispatcherTasks?: string }).dispatcherTasks).includes('СП-02'))).toHaveLength(expected)
    }
    await refresh('initial', 0)
    await page.getByText('EPA3', { exact: true }).first().click()
    await page.getByRole('button', { name: 'Редактировать', exact: true }).click()
    const dialog = page.getByRole('dialog')
    for (const editor of await dialog.locator('[data-permit-editor-id]').all()) await editor.getByRole('button', { name: 'М05', exact: true }).click()
    await dialog.getByRole('button', { name: 'Сохранить клеймо', exact: true }).click()
    await expect(dialog).toBeHidden()
    await refresh('removed-material', 3)
    expect(await facts()).toEqual(before)
    await page.getByRole('button', { name: 'Редактировать', exact: true }).click()
    for (const editor of await dialog.locator('[data-permit-editor-id]').all()) await editor.getByRole('button', { name: 'М05', exact: true }).click()
    await dialog.getByRole('button', { name: 'Сохранить клеймо', exact: true }).click()
    await expect(dialog).toBeHidden()
    await refresh('restored-material', 0)
    expect(await facts()).toEqual(before)
    console.log(JSON.stringify({ workflow: 'permit-ui-and-dispatcher-200k', measurements }))
  } finally { prototype.query = original }
})
async function select(editor: Locator, values: string[]) {
  for (const value of values) {
    const button = editor.getByRole('button', { name: value, exact: true })
    if (await button.getAttribute('aria-pressed') !== 'true') await button.click()
  }
}
async function fillPermit(editor: Locator, groups: string[], note: string) {
  await select(editor, ['РАД', 'РД', ...groups])
  for (const [label, value] of [['Диаметр от', '1'], ['Диаметр до', '500'], ['Толщина от', '1'], ['Толщина до', '20'],
    ['Срок от', '2026-01-01'], ['Срок до', '2026-12-31'], ['Примечание', note]]) {
    await editor.getByLabel(label, { exact: true }).fill(value)
  }
}
async function create(page: Page, code: string, groups: string[]) {
  await page.getByRole('button', { name: 'Добавить клеймо', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Клеймо НАКС', { exact: true }).fill(code)
  await dialog.getByLabel('ФИО сварщика', { exact: true }).fill(`Аудит ${code}`)
  await fillPermit(dialog.locator('[data-permit-editor-id]').first(), groups, 'НАКС — сохранить')
  await dialog.getByRole('button', { name: 'Добавить ДЛС', exact: true }).click()
  const dls = dialog.locator('[data-permit-editor-id]').last()
  await dls.getByLabel('Номер ДЛС', { exact: true }).fill(`ДЛС-${code}`)
  await fillPermit(dls, groups, 'ДЛС — сохранить')
  await dialog.getByRole('button', { name: 'Добавить клеймо', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect.poll(async () => Boolean(await saved(code))).toBe(true)
}

test('реальный ввод НАКС/ДЛС: 1/2/3 группы, способы, открытие конкретного допуска, ПКМ, отмена, повторное сохранение', async ({ page }) => {
  test.setTimeout(120_000)
  const errors: string[] = [], calls: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  await page.goto('/welder-stamps')
  for (const [index, code] of codes.slice(0, 3).entries()) {
    const groups = ['М01', 'М05', 'М11'].slice(0, index + 1)
    await create(page, code, groups)
    const before = await saved(code)
    for (const permit of [...before.naks_permits, ...before.dls_permits]) {
      expect(permit.materialGroups.split(', ')).toEqual(groups)
      expect(permit.weldType).toBe('РАД, РД')
    }
    await page.reload()
    await page.getByText(code, { exact: true }).first().click()
    const card = page.getByRole('heading', { name: `Аудит ${code}` }).locator('xpath=ancestor::td')
    const edits = card.getByRole('button', { name: 'Редактировать этот допуск', exact: true })
    await edits.last().click()
    const dialog = page.getByRole('dialog'), dls = dialog.locator('[data-permit-editor-id]').last()
    await expect(dls.getByLabel('Номер ДЛС', { exact: true })).toHaveValue(`ДЛС-${code}`)
    for (const group of groups) await expect(dls.getByRole('button', { name: group, exact: true })).toHaveAttribute('aria-pressed', 'true')
    await dls.getByLabel('Примечание', { exact: true }).fill('Не сохранять')
    await page.keyboard.press('Escape')
    expect(await saved(code)).toEqual(before)
    await edits.first().locator('xpath=ancestor::div[@class][2]').click({ button: 'right' })
    await page.getByText('Редактировать допуск', { exact: true }).click()
    const naks = dialog.locator('[data-permit-editor-id]').first()
    await expect(naks).toHaveAttribute('data-permit-editor-id', before.naks_permits[0].id)
    // Removing and re-adding is a set change, not a second material side or a duplicate.
    await naks.getByRole('button', { name: 'М01', exact: true }).click()
    await naks.getByRole('button', { name: 'М01', exact: true }).click()
    await dialog.getByRole('button', { name: 'Сохранить клеймо', exact: true }).click()
    await expect(dialog).toBeHidden()
    const after = await saved(code)
    expect(after.dls_permits).toEqual(before.dls_permits)
    expect(after.naks_permits[0]).toEqual({ ...before.naks_permits[0], materialGroups: expect.any(String) })
    expect(after.naks_permits[0].materialGroups.split(', ').sort()).toEqual(groups)
    await page.getByText(code, { exact: true }).first().click()
  }
  await page.waitForLoadState('networkidle')
  const beforeIdle = [...calls]
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')) })
  await page.waitForTimeout(500)
  expect(calls).toEqual(beforeIdle)
  expect(calls.filter(name => name.startsWith('saveWelderStampRecords'))).toHaveLength(6)
  expect(errors).toEqual([])
})

test('ошибка сети сохраняет черновик; пять одновременных клиентов не затирают ревизию и не создают дубли', async ({ page, playwright }) => {
  test.setTimeout(90_000)
  await page.goto('/welder-stamps')
  await create(page, 'EPA5', ['М01', 'М05'])
  await page.getByText('EPA5', { exact: true }).click()
  await page.getByRole('button', { name: 'Редактировать', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('ФИО сварщика', { exact: true }).fill('Пять пользователей')
  let intercepted: Request | undefined
  await page.route('**/_serverFn/**', async route => {
    if (rpcName(route.request().url()).startsWith('saveWelderStampRecords')) {
      intercepted = route.request()
      await route.abort('failed')
    } else await route.continue()
  })
  await dialog.getByRole('button', { name: 'Сохранить клеймо', exact: true }).click()
  await expect.poll(() => Boolean(intercepted)).toBe(true)
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('ФИО сварщика', { exact: true })).toHaveValue('Пять пользователей')
  expect((await saved('EPA5')).welder_name).toBe('Аудит EPA5')
  const request = intercepted!, headers = await request.allHeaders()
  delete headers['content-length']
  const clients = await Promise.all(Array.from({ length: 5 }, () => playwright.request.newContext()))
  try {
    const replies = await Promise.all(clients.map(client => client.post(request.url(), { headers, data: request.postData()! }).then(response => response.text())))
    expect(replies.filter(reply => reply.includes('Справочник клейм уже изменён'))).toHaveLength(4)
    expect((await saved('EPA5')).welder_name).toBe('Пять пользователей')
    expect(await withE2eDatabase(async db => (await db.query('select count(*)::int n from welder_stamps where naks_stamp=$1', ['EPA5'])).rows[0].n)).toBe(1)
  } finally { await Promise.all(clients.map(client => client.dispose())) }
  await page.unroute('**/_serverFn/**')
  await page.keyboard.press('Escape')
  await page.reload()
  await expect(page.getByText('Пять пользователей', { exact: true })).toBeVisible()
})
