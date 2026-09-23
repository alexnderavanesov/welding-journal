import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'

const project = 'E2E dispatcher navigation'

test.afterEach(async () => {
  await withE2eDatabase(async (client) => {
    await client.query('delete from weld_joints where project_title = $1', [project])
    await client.query('update dispatcher_task_index_state set source_revision = source_revision + 1, full_rebuild = true where id = 1')
  })
})

test('задача линии открывает программу ПСТО из другого отчета; Назад и Вперед сохраняют контекст', async ({ page }) => {
  await withE2eDatabase(async (client) => {
    await client.query(`insert into weld_joints (project_title, subtitle_code, line, joint, has_vik, psto_required, weld_date)
      values ($1, 'NAV', 'NAV-LINE', 'NAV1', 'да', 'да', '2026-07-01'), ($1, 'NAV', 'NAV-LINE', 'NAV2', 'да', null, '2026-07-01')`, [project])
    await client.query('update dispatcher_task_index_state set source_revision = source_revision + 1, full_rebuild = true where id = 1')
  })
  await page.goto('/journal')
  const search = page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' })
  await search.fill('NAV-LINE')
  await expect(page.getByRole('button', { name: 'Выбрать стык NAV1', exact: true })).toBeVisible()
  const panel = page.getByLabel('Диспетчер задач', { exact: true })
  await panel.getByRole('button', { name: 'Открыть диспетчер' }).click()
  const workspace = page.getByRole('dialog', { name: 'Диспетчер задач' })
  await workspace.getByRole('textbox', { name: 'Поиск задач диспетчера' }).fill('NAV-LINE')
  await workspace.getByRole('textbox', { name: 'Поиск задач диспетчера' }).press('Enter')
  await workspace.getByRole('button', { name: 'Открыть программу ПСТО', exact: true }).click()
  await expect(page).toHaveURL(/\/psto$/)
  await expect(page.getByRole('heading', { name: 'Программа ПСТО', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: 'Программа ПСТО', exact: true })).toHaveCount(0)
  await page.goBack()
  await expect(page).toHaveURL(/\/journal$/)
  await expect(search).toHaveValue('NAV-LINE')
  await expect(page.getByRole('button', { name: 'Выбрать стык NAV1', exact: true })).toBeVisible()
  await page.goForward()
  await expect(page).toHaveURL(/\/psto$/)
  await expect(page.getByRole('button', { name: 'Выбрать стык NAV1', exact: true })).toBeVisible()
})
