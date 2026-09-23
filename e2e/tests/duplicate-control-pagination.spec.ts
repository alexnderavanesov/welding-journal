import { expect, test } from '@playwright/test'

import { withE2eDatabase } from '../database'

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
