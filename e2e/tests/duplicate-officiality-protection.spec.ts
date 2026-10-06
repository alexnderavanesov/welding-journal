import { expect, test, type Page, type Request } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { rpcName } from '../rpc'

const project = 'E2E duplicate officiality protection', lineName = 'DUP-OFFICIALITY'
test.afterEach(() => cleanupLineProgramProjects([project]))

async function seed() {
  return withE2eDatabase(async db => {
    const { rows: [line] } = await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent) values ($1,'U',$2,'II','A',10,0) returning id`, [project, lineName])
    const { rows } = await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,officiality,revision_actuality,weld_date,connection_type,material_group,welding_method,d1,d2,t1,t2,wdi,stamp_1_k,has_vik,vik_result,vik_request,vik_request_date,vik_conclusion,vik_conclusion_date,has_uzk,uzk_result,uzk_request,uzk_request_date,uzk_conclusion,uzk_conclusion_date,final_status)
      select $1,$2,'U',$3,'F' || n,'действующий','актуальная','2026-09-01','С17','M01','РД',108,108,4,4,0.42,'A','да','годен','DO-VIK','2026-09-01','DO-VIK-C','2026-09-02','да','ремонт','DO-UZK','2026-09-02','DO-UZK-C','2026-09-03','не годен' from generate_series(741,742) n returning id`, [line.id, project, lineName])
    return rows.map(row => row.id as number)
  })
}

const stored = () => withE2eDatabase(async db => (await db.query(`select w.id,w.officiality,w.xmin::text as version,
  (select count(*)::int from duplicate_controls d where d.weld_joint_id=w.id) as duplicates
  from weld_joints w where w.project_title=$1 order by w.id`, [project])).rows)

async function openOfficiality(page: Page, value: 'official' | 'unofficial' = 'unofficial') {
  await page.locator('header').getByRole('button', { name: 'Официальность', exact: true }).click()
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Официальность стыков', exact: true }) })
  await dialog.getByPlaceholder('Проект, шифр, линия, спул или стык').fill(lineName)
  await expect(dialog.getByText('Найдено: 2 · Выбрано: 0', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Выбрать найденные', exact: true }).click()
  await dialog.getByRole('button', { name: value === 'official' ? /^Официальный/ : /^Неофициальный/ }).click()
  return dialog
}

async function openDuplicate(page: Page) {
  await page.locator('header').getByRole('button', { name: 'Дубль контроль', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByPlaceholder('Проект, шифр, линия, спул или стык').fill(lineName)
  await expect(dialog.getByText('Найдено: 2 · Выбрано: 0', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Выбрать найденные', exact: true }).click()
  for (const method of ['ВИК', 'РК', 'УЗК', 'ПВК']) await dialog.getByRole('button', { name: method, exact: true }).click()
  await dialog.getByRole('combobox', { name: 'Результат', exact: true }).selectOption('годен')
  await dialog.getByRole('textbox', { name: 'Дата контроля', exact: true }).fill('03.09.2026')
  await dialog.getByRole('textbox', { name: 'Заключение', exact: true }).fill('DO-DUP')
  await dialog.getByRole('textbox', { name: 'Дата заключения', exact: true }).fill('03.09.2026')
  return dialog
}

async function replay(page: Page, request: Request, body = request.postData()!) {
  const headers = await request.allHeaders()
  delete headers['content-length']
  return page.request.post(request.url(), { headers, data: body })
}

for (const order of ['одновременно', 'сначала дубль', 'сначала неофициальность'] as const) {
  test(`два окна: дубль и неофициальность не совмещаются и не сохраняют часть группы — ${order}`, async ({ page }) => {
    await seed()
    const duplicatePage = await page.context().newPage(), errors: string[] = []
    for (const tab of [page, duplicatePage]) tab.on('pageerror', error => errors.push(error.message))
    await duplicatePage.goto('/lnk')
    await duplicatePage.waitForLoadState('networkidle')
    await page.goto('/lnk')
    const officiality = await openOfficiality(page), duplicate = await openDuplicate(duplicatePage)
    await Promise.all([page.waitForLoadState('networkidle'), duplicatePage.waitForLoadState('networkidle')])
    const before = await stored(), releases: (() => void)[] = [], arrived: Request[] = []
    const gates = [0, 1].map(index => new Promise<void>(resolve => { releases[index] = resolve }))
    const isWrite = (url: string) => /^(applyLnkOfficialityChange|saveDuplicateControls)_/.test(rpcName(url))
    for (const [index, tab] of [page, duplicatePage].entries()) await tab.route('**/_serverFn/**', async route => {
      if (isWrite(route.request().url())) { arrived.push(route.request()); await gates[index] }
      await route.continue()
    })
    const responses = [page, duplicatePage].map(tab => tab.waitForResponse(response => response.url().includes('/_serverFn/') && isWrite(response.url())))
    try {
      await Promise.all([
        officiality.getByRole('button', { name: 'Сохранить официальность', exact: true }).click(),
        duplicate.getByRole('button', { name: 'Добавить дубль', exact: true }).click(),
      ])
      await expect.poll(() => arrived.length).toBe(2)
      if (order !== 'одновременно') {
        const first = order === 'сначала дубль' ? 1 : 0
        releases[first]()
        await (await responses[first]).finished()
      }
    } finally { releases.forEach(release => release()) }
    await Promise.all((await Promise.all(responses)).map(response => response.finished()))
    const after = await stored(), unofficial = after[0].officiality === 'неофициальный'
    for (const row of after) {
      expect(row.officiality === 'неофициальный').toBe(unofficial)
      expect(row.duplicates).toBe(unofficial ? 0 : 4)
    }
    if (order !== 'одновременно') expect(unofficial).toBe(order === 'сначала неофициальность')
    await expect((unofficial ? duplicate : page).getByText(/Дубль-контроль недоступен|есть дубль-контроль|изменил|изменён|изменен/).first()).toBeVisible()
    expect(arrived).toHaveLength(2)
    if (!unofficial) {
      // Fresh versions remove the stale-client check as an explanation: the
      // business rule itself must still reject the earlier officiality plan.
      const request = arrived.find(request => rpcName(request.url()).startsWith('applyLnkOfficialityChange_'))!
      let body = request.postData()!
      for (const row of before.filter((row, index) => before.findIndex(other => other.version === row.version) === index)) {
        expect(body).toContain(`"${row.version}"`)
        body = body.replaceAll(`"${row.version}"`, `"${after.find(next => next.id === row.id).version}"`)
      }
      expect(await (await replay(page, request, body)).text()).toContain('есть дубль-контроль')
      expect(await stored()).toEqual(after)
    }
    expect(errors).toEqual([])
    await duplicatePage.close()
    await page.close()
  })
}

test('старый клиент не сохраняет смешанную группу дублей; восстановление официальности сохраняет старую историю', async ({ page }) => {
  const ids = await seed(), writes: Request[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/_serverFn/') && rpcName(request.url()).startsWith('saveDuplicateControls_')) writes.push(request) })
  await page.goto('/lnk')
  const duplicate = await openDuplicate(page)
  await duplicate.getByRole('button', { name: 'Добавить дубль', exact: true }).click()
  await expect(duplicate).toBeHidden()
  expect(writes).toHaveLength(1)
  // Legacy fixture: only the second selected row becomes unofficial.
  await withE2eDatabase(db => db.query(`update weld_joints set officiality='неофициальный' where id=$1`, [ids[1]]))
  const before = await stored(), request = writes[0]
  const history = () => withE2eDatabase(async db => (await db.query('select * from duplicate_controls where weld_joint_id = any($1::int[]) order by id', [ids])).rows)
  const originalHistory = await history()
  for (const result of ['годен', 'ремонт', 'вырез']) {
    expect(await (await replay(page, request, request.postData()!.replaceAll('годен', result))).text()).toContain('Дубль-контроль недоступен для неофициального стыка')
    expect(await stored()).toEqual(before)
  }
  await page.reload()
  const officiality = await openOfficiality(page)
  await expect(officiality.getByRole('button', { name: 'Сохранить официальность', exact: true })).toBeDisabled()
  await expect(officiality.getByText(/есть дубль-контроль/)).toBeVisible()
  await officiality.getByRole('button', { name: /^Официальный/ }).click()
  await officiality.getByRole('button', { name: 'Сохранить официальность', exact: true }).click()
  await expect(officiality).toBeHidden()
  for (const row of await stored()) {
    expect(row.officiality).not.toBe('неофициальный')
    expect(row.duplicates).toBe(4)
  }
  expect(await history()).toEqual(originalHistory)
  expect(errors).toEqual([])
})

test('старый клиент: перенос дубля на неофициальный стык отклоняется без потери записи; повтор после восстановления разрешён', async ({ page }) => {
  const ids = await seed(), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const original = await withE2eDatabase(async db => (await db.query(`insert into duplicate_controls(weld_joint_id,method,result,control_date,conclusion,conclusion_date)
    values ($1,'РК','годен','2026-09-03','DO-ORIGINAL','2026-09-03') returning id,weld_joint_id,conclusion,updated_at`, [ids[0]])).rows[0])
  const control = () => withE2eDatabase(async db => (await db.query('select id,weld_joint_id,conclusion,updated_at from duplicate_controls where id=$1', [original.id])).rows[0])
  await page.goto('/lnk')
  await page.locator('header').getByRole('button', { name: 'Дубль контроль', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: /Внесенные дубли/ }).click()
  await dialog.getByRole('button', { name: 'Изменить', exact: true }).first().click()
  await expect(dialog.getByRole('heading', { name: 'Редактирование дубль-контроля' })).toBeVisible()
  await dialog.getByPlaceholder('Проект, шифр, линия, спул или стык').fill('F742')
  await expect(dialog.getByRole('button', { name: /^F742 / })).toBeDisabled()
  await dialog.getByPlaceholder('Проект, шифр, линия, спул или стык').fill('F741')
  await page.waitForLoadState('networkidle')
  // Today's UI fixes the selected parent while editing. An old/raw client can
  // still submit another weldJointId, so the server must validate that target.
  await page.route('**/_serverFn/**', async route => {
    if (!rpcName(route.request().url()).startsWith('saveDuplicateControls_')) return route.continue()
    const body: unknown = JSON.parse(route.request().postData()!)
    let replaced = 0
    // Seroval transports object keys and values in parallel arrays.
    const rewrite = (value: unknown) => {
      if (!value || typeof value !== 'object') return
      const node = value as { p?: { k?: string[]; v?: Array<{ s: unknown }> } }
      const index = node.p?.k?.indexOf('weldJointId') ?? -1
      if (index >= 0 && node.p?.v) {
        expect(node.p.v[index].s).toBe(ids[0])
        node.p.v[index].s = ids[1]
        replaced++
      }
      Object.values(value).forEach(rewrite)
    }
    rewrite(body)
    expect(replaced).toBe(1)
    await route.continue({ postData: JSON.stringify(body) })
  })
  await withE2eDatabase(db => db.query(`update weld_joints set officiality='неофициальный' where id=$1`, [ids[1]]))
  await dialog.getByRole('textbox', { name: 'Заключение', exact: true }).fill('DO-MOVED')
  await dialog.getByRole('button', { name: 'Сохранить дубль', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('Дубль-контроль недоступен для неофициального стыка')
  expect(await control()).toEqual(original)
  await withE2eDatabase(db => db.query('update weld_joints set officiality=null where id=$1', [ids[1]]))
  await dialog.getByRole('button', { name: 'Сохранить дубль', exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(await control()).toMatchObject({ id: original.id, weld_joint_id: ids[1], conclusion: 'DO-MOVED' })
  expect((await stored()).map(row => row.duplicates)).toEqual([0, 1])
  expect(errors).toEqual([])
})

test('неофициальный стык после очистки ошибочного результата остаётся доступным для возврата официальности', async ({ page }) => {
  await seed()
  await withE2eDatabase(db => db.query(`update weld_joints set officiality='неофициальный',uzk_result=null,uzk_conclusion=null,uzk_conclusion_date=null,final_status='ожидает НК' where project_title=$1`, [project]))
  await page.goto('/lnk')
  const officiality = await openOfficiality(page, 'official')
  await officiality.getByRole('button', { name: 'Сохранить официальность', exact: true }).click()
  await expect(officiality).toBeHidden()
  for (const row of await stored()) expect(row.officiality).not.toBe('неофициальный')
})

test('старый неполный дубль на неофициальном стыке читается и удаляется штатно; отмена удаления сохраняет запись', async ({ page }) => {
  const [id] = await seed(), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await withE2eDatabase(async db => {
    await db.query(`update weld_joints set officiality='неофициальный' where id=$1`, [id])
    await db.query(`insert into duplicate_controls(weld_joint_id,method,result) values ($1,'УЗК','')`, [id])
  })
  await page.goto('/lnk')
  await page.locator('header').getByRole('button', { name: 'Дубль контроль', exact: true }).click()
  const registry = page.getByRole('dialog')
  await registry.getByRole('button', { name: /Внесенные дубли/ }).click()
  await registry.getByRole('button', { name: 'Удалить', exact: true }).click()
  const confirmation = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Удалить дубль-контроль', exact: true }) })
  await confirmation.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect((await stored()).find(row => row.id === id)).toMatchObject({ officiality: 'неофициальный', duplicates: 1 })
  await registry.getByRole('button', { name: 'Удалить', exact: true }).click()
  await confirmation.getByRole('button', { name: 'Удалить', exact: true }).click()
  await expect.poll(async () => (await stored()).find(row => row.id === id).duplicates).toBe(0)
  expect((await stored()).find(row => row.id === id).officiality).toBe('неофициальный')
  expect(errors).toEqual([])
})
