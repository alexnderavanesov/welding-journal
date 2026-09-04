import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'

const KEY_PREFIX = 'e2e-accepted-warning:'

test.beforeEach(async () => {
  await withE2eDatabase(async (client) => {
    await client.query(`
      insert into dispatcher_accepted_warnings (key, kind, code, title, context, accepted_at)
      select
        $1 || item::text,
        case when item = 52 then 'early-coil' else 'percentage-line-control' end,
        case when item = 52 then 'ДЗ-09' else 'ДЗ-02' end,
        'E2E принятое исключение ' || item::text,
        'Проект: E2E · Шифр: 100 · Линия: L-' || item::text || ' · Клеймо: A' || item::text,
        timestamptz '2026-08-01 00:00:00+00' + item * interval '1 hour'
      from generate_series(1, 52) as item
    `, [KEY_PREFIX])
  })
})

test.afterEach(async () => {
  await withE2eDatabase(async (client) => {
    await client.query('delete from dispatcher_accepted_warnings where key like $1', [`${KEY_PREFIX}%`])
  })
})

test('searches, filters and paginates accepted exceptions without overflowing the settings panel', async ({ page }) => {
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Принятые исключения', exact: true }).click()

  const panel = page.locator('#settings-panel-acceptedWarnings')
  await expect(panel.getByText('Всего: 52', { exact: true })).toBeVisible()
  await expect(panel.getByText('1-50', { exact: true })).toBeVisible()
  await expect(panel.getByText('из 52 исключений', { exact: true })).toBeVisible()
  await expect(panel.getByText('E2E принятое исключение 52', { exact: true })).toBeVisible()
  await expect(panel.getByText('E2E принятое исключение 1', { exact: true })).toHaveCount(0)

  await panel.getByRole('button', { name: 'Следующая страница исключений' }).click()
  await expect(panel.getByText('E2E принятое исключение 1', { exact: true })).toBeVisible()
  await expect(panel.getByText('51-52', { exact: true })).toBeVisible()

  await panel.getByLabel('Порядок').selectOption('oldest')
  await expect(panel.getByText('1-50', { exact: true })).toBeVisible()
  await expect(panel.getByText('E2E принятое исключение 1', { exact: true })).toBeVisible()
  await expect(panel.getByText('E2E принятое исключение 52', { exact: true })).toHaveCount(0)

  await panel.getByRole('searchbox', { name: 'Поиск принятых исключений' }).fill('L-7')
  await expect(panel.getByText('Найдено: 1', { exact: true })).toBeVisible()
  await expect(panel.getByText('E2E принятое исключение 7', { exact: true })).toBeVisible()

  await panel.getByLabel('Период принятия').selectOption('7d')
  await expect(panel.getByText('Найдено: 0', { exact: true })).toBeVisible()
  await expect(panel.getByText('По заданным условиям исключения не найдены.', { exact: true })).toBeVisible()

  await panel.getByRole('button', { name: 'Сбросить', exact: true }).click()
  await panel
    .getByRole('group', { name: 'Тип принятого исключения' })
    .getByRole('button', { name: 'Досрочные катушки', exact: true })
    .click()
  await expect(panel.getByText('Найдено: 1', { exact: true })).toBeVisible()
  await expect(panel.getByText('E2E принятое исключение 52', { exact: true })).toBeVisible()

  await page.setViewportSize({ width: 768, height: 900 })
  await expect.poll(() => panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
})
