import { expect, test, type Request } from '@playwright/test'

import { withE2eDatabase } from '../database'
import { rpcName } from '../rpc'

test('дубли только ВИК/РК/УЗК/ПВК: массовое сохранение и запрет ТВМТ/ПСТО из старого клиента', async ({ page }) => {
  await seedDuplicateControlRows(2, false)
  const errors: string[] = [], writes: Request[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => {
    if (request.url().includes('/_serverFn/') && rpcName(request.url()).startsWith('saveDuplicateControls_')) writes.push(request)
  })
  await page.goto('/lnk')
  await page.locator('header').getByRole('button', { name: 'Дубль контроль', exact: true }).click()
  const dialog = page.getByRole('dialog')
  for (const method of ['ТВМТ', 'ПСТО']) await expect(dialog.getByRole('button', { name: method, exact: true })).toHaveCount(0)
  await dialog.getByPlaceholder('Проект, шифр, линия, спул или стык').fill('E2E-DUP')
  await expect(dialog.getByText('Найдено: 2 · Выбрано: 0', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Выбрать найденные' }).click()
  await expect(dialog.getByText('Найдено: 2 · Выбрано: 2', { exact: true })).toBeVisible()
  for (const method of ['ВИК', 'РК', 'УЗК', 'ПВК']) await dialog.getByRole('button', { name: method, exact: true }).click()
  await dialog.getByRole('combobox', { name: 'Результат', exact: true }).selectOption('годен')
  await dialog.getByRole('textbox', { name: 'Дата контроля', exact: true }).fill('02.08.2026')
  await dialog.getByRole('textbox', { name: 'Заключение', exact: true }).fill('E2E-DUP-NK')
  await dialog.getByRole('textbox', { name: 'Дата заключения', exact: true }).fill('03.08.2026')
  await dialog.getByRole('button', { name: 'Добавить дубль', exact: true }).click()
  await expect(page.getByText('Дубль-контроль внесен: 8', { exact: true })).toBeVisible()
  expect(writes).toHaveLength(1)
  const stored = () => withE2eDatabase(async db => (await db.query("select d.id,d.weld_joint_id,d.method,d.result,d.conclusion from duplicate_controls d join weld_joints w on w.id=d.weld_joint_id where w.project_title='E2E-DUP' order by d.id")).rows)
  const before = await stored()
  expect(before).toHaveLength(8)
  expect([...new Set(before.map(record => record.method))].sort()).toEqual(['ВИК', 'ПВК', 'РК', 'УЗК'])
  // Replay the actual wire format from an old client: reject the entire mixed batch.
  const request = writes[0], body = request.postData()!
  expect(body).toContain('ВИК')
  const headers = await request.allHeaders()
  delete headers['content-length']
  for (const method of ['ТВМТ', 'ПСТО']) {
    const response = await page.request.post(request.url(), { headers, data: body.replaceAll('ВИК', method) })
    expect(await response.text()).toContain('Для дубль-контроля доступны только ВИК, РК, УЗК и ПВК')
    expect(await stored()).toEqual(before)
  }
  expect(errors).toEqual([])
})

test.afterEach(async () => {
  await cleanupDuplicateControlRows()
})

test('окно дубль-контроля ищет по всему журналу и лениво открывает реестр', async ({ page }) => {
  test.setTimeout(120_000)
  await seedDuplicateControlRows()

  await page.goto('/lnk')
  await page.locator('header').getByRole('button', { name: 'Дубль контроль', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Дубль контроль', exact: true })).toBeVisible()

  const search = page.getByPlaceholder('Проект, шифр, линия, спул или стык')
  await search.fill('E2E-DUP')
  await expect(page.getByText('Найдено: 151 · Выбрано: 0', { exact: true })).toBeVisible()
  await expect(page.getByText(/из 151 строк/)).toBeVisible()

  await search.fill('E2E-DUP-150')
  await expect(page.getByText('Найдено: 1 · Выбрано: 0', { exact: true })).toBeVisible()
  await expect(page.getByText('E2E-DUP-150', { exact: true })).toBeVisible()

  const registryToggle = page.getByRole('button', { name: /Внесенные дубли/ })
  await expect(registryToggle).toContainText('открыть реестр')
  await registryToggle.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('ВИК', { exact: true })).toBeVisible()
  await expect(dialog.getByText('годен', { exact: true })).toBeVisible()
  await expect(dialog.getByText(/Заключение E2E дубль/)).toBeVisible()
})

test('широкий поиск не выбирает больше 5 000 стыков и предлагает уточнение', async ({ page }) => {
  test.setTimeout(120_000)
  await seedDuplicateControlRows(5_001, false)

  await page.goto('/lnk')
  await page.locator('header').getByRole('button', { name: 'Дубль контроль', exact: true }).click()

  const search = page.getByPlaceholder('Проект, шифр, линия, спул или стык')
  await search.fill('E2E-DUP')
  await expect(page.getByText('Найдено: 5001 · Выбрано: 0', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Выбрать найденные' }).click()
  await expect(page.getByText('Можно выбрать не более 5 000 стыков. Уточните поиск или снимите часть выбора.'))
    .toBeVisible()
  await expect(page.getByText('Найдено: 5001 · Выбрано: 0', { exact: true })).toBeVisible()

  await search.fill('E2E-DUP-5001')
  await expect(page.getByText('Найдено: 1 · Выбрано: 0', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Выбрать найденные' }).click()
  await expect(page.getByText('Найдено: 1 · Выбрано: 1', { exact: true })).toBeVisible()
})

async function seedDuplicateControlRows(count = 151, withExistingControl = true) {
  await withE2eDatabase(async (client) => {
    await client.query(`
      insert into weld_joints (
        weld_date, project_title, subtitle_code, line, joint, spool,
        officiality, connection_type, d1, d2, t1, t2, wdi, final_status,
        welding_updated_at, lnk_created_at, lnk_updated_at
      )
      select
        '2026-08-01',
        'E2E-DUP',
        'E2E-DUP-SUB',
        'E2E-DUP-L1',
        'E2E-DUP-' || case when series < 1000 then lpad(series::text, 3, '0') else series::text end,
        'E2E-DUP-SPOOL',
        'действующий',
        'СШ',
        108,
        108,
        4,
        4,
        0.42,
        'ожидает заявку',
        now(),
        now(),
        now()
      from generate_series(1, $1::integer) as series
    `, [count])
    if (withExistingControl) {
      await client.query(`
        insert into duplicate_controls (
          weld_joint_id, method, result, control_date, conclusion, conclusion_date
        )
        select id, 'ВИК', 'годен', '2026-08-02', 'Заключение E2E дубль', '2026-08-03'
        from weld_joints
        where joint = 'E2E-DUP-150'
      `)
    }
    await invalidateDerivedIndexes(client)
  })
}

async function cleanupDuplicateControlRows() {
  await withE2eDatabase(async (client) => {
    await client.query(`delete from weld_joints where project_title = 'E2E-DUP'`)
    await invalidateDerivedIndexes(client)
  })
}

async function invalidateDerivedIndexes(client: Parameters<Parameters<typeof withE2eDatabase>[0]>[0]) {
  await client.query(`
    update dispatcher_task_index_state
    set
      source_revision = source_revision + 1,
      dirty_scopes = '[]',
      full_rebuild = true,
      updated_at = now()
  `)
  await client.query(`
    update derived_calculation_state
    set source_revision = source_revision + 1, updated_at = now()
  `)
  await client.query(`delete from derived_calculation_cache`)
}
