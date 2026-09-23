import { expect, test } from '@playwright/test'

import { withE2eDatabase } from '../database'

test.afterEach(async () => {
  await withE2eDatabase(async (client) => {
    await client.query(`delete from weld_joints where project_title = 'E2E-OUTPUT'`)
    await invalidateDerivedIndexes(client)
  })
})

test('special LNK output opens a tab immediately and contains rows beyond the modal limit', async ({ page }) => {
  test.setTimeout(120_000)
  await withE2eDatabase(async (client) => {
    await client.query(`
      insert into weld_joints (
        weld_date, project_title, subtitle_code, line, joint, spool,
        officiality, connection_type, d1, d2, t1, t2, wdi,
        has_vik, psto_required, final_status,
        welding_updated_at, lnk_created_at, lnk_updated_at
      )
      select
        '2026-08-01', 'E2E-OUTPUT', 'E2E-OUTPUT-SUB', 'E2E-OUTPUT-L1',
        'E2E-OUTPUT-' || lpad(series::text, 3, '0'), 'E2E-OUTPUT-SPOOL',
        'действующий', 'СШ', 108, 108, 4, 4, 0.42,
        'да', 'нет', 'ожидает заявку', now(), now(), now()
      from generate_series(1, 501) as series
    `)
    await invalidateDerivedIndexes(client)
  })

  await page.goto('/lnk')
  await page.locator('header').getByRole('button', { name: 'Показать', exact: true }).click()

  const popupPromise = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Ожидание заявки', exact: true }).click()
  const popup = await popupPromise

  await expect(popup.getByRole('heading', { name: 'Ожидание заявки' })).toBeVisible()
  await expect(popup.getByText('E2E-OUTPUT-501', { exact: true })).toBeVisible()
  await expect.poll(() => popup.locator('tbody tr').count()).toBeGreaterThan(500)

  await popup.close()
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill('E2E-OUTPUT-501')
  await expect(page.getByText('E2E-OUTPUT-501', { exact: true })).toBeVisible()
  await page.locator('header').getByRole('button', { name: 'Показать', exact: true }).click()

  const currentPopupPromise = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Текущая версия', exact: true }).click()
  const currentPopup = await currentPopupPromise
  await expect(currentPopup.getByRole('heading', { name: 'ЛНК: текущая версия' })).toBeVisible()
  await expect(currentPopup.locator('tbody tr')).toHaveCount(1)
  await expect(currentPopup.getByText('E2E-OUTPUT-501', { exact: true })).toBeVisible()
})

test('a very large report fails visibly while a narrowed current report still opens', async ({ page }) => {
  test.setTimeout(120_000)
  await withE2eDatabase(async (client) => {
    await client.query(`
      insert into weld_joints (
        weld_date, project_title, subtitle_code, line, joint, spool,
        officiality, connection_type, d1, d2, t1, t2, wdi,
        has_vik, psto_required, final_status
      )
      select
        '2026-08-01', 'E2E-OUTPUT', 'E2E-OUTPUT-SUB', 'E2E-OUTPUT-L1',
        'E2E-OUTPUT-' || lpad(series::text, 5, '0'), 'E2E-OUTPUT-SPOOL',
        'действующий', 'СШ', 108, 108, 4, 4, 0.42,
        'да', 'нет', 'ожидает заявку'
      from generate_series(1, 10001) as series
    `)
  })

  await page.goto('/lnk')
  await page.locator('header').getByRole('button', { name: 'Показать', exact: true }).click()
  await page.getByRole('button', { name: 'Ожидание заявки', exact: true }).click()
  await expect(page.getByText(/Для вывода найдено более 10 000 строк/)).toBeVisible()

  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill('E2E-OUTPUT-10001')
  await expect(page.getByText('E2E-OUTPUT-10001', { exact: true })).toBeVisible()
  await page.locator('header').getByRole('button', { name: 'Показать', exact: true }).click()
  const popupPromise = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Текущая версия', exact: true }).click()
  const popup = await popupPromise
  await expect(popup.locator('tbody tr')).toHaveCount(1)
  await expect(popup.getByText('E2E-OUTPUT-10001', { exact: true })).toBeVisible()
})

async function invalidateDerivedIndexes(client: Parameters<Parameters<typeof withE2eDatabase>[0]>[0]) {
  await client.query(`
    update dispatcher_task_index_state
    set source_revision = source_revision + 1, dirty_scopes = '[]', full_rebuild = true, updated_at = now()
  `)
  await client.query(`
    update derived_calculation_state
    set source_revision = source_revision + 1, updated_at = now()
  `)
  await client.query(`delete from derived_calculation_cache`)
}
