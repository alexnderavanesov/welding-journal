import { expect, test } from '@playwright/test'
import { seedSmoothnessFixture, cleanupSmoothnessFixture, SMOOTHNESS_PROJECT } from '../smoothness-fixture'
import { withE2eDatabase } from '../database'
import { editJournalJoint } from '../journal-grid'
import { rpcName } from '../rpc'

test('return after a real save retains the previous statistics until the fresh response arrives', async ({ page }, info) => {
  test.setTimeout(120_000)
  await seedSmoothnessFixture()
  let hold = false, captured = 0, release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/_serverFn/**', async route => {
    if (!hold || !rpcName(route.request().url()).startsWith('getStatisticsServerResult_')) return route.continue()
    const response = await route.fetch()
    expect(response.ok()).toBe(true)
    captured++
    await gate
    await route.fulfill({ response })
  })
  try {
    await page.goto('/statistics')
    const report = page.getByRole('button', { name: 'Отчет PDF', exact: true })
    const value = page.getByText('Сварено за период', { exact: true }).locator('..').locator(':scope > div').last()
    await expect(report).toBeEnabled()
    const previous = await value.innerText()
    const id = await withE2eDatabase(async db => (await db.query('select id from weld_joints where project_title=$1 and line=$2 and joint=$3', [SMOOTHNESS_PROJECT, 'SM-0001', 'F0001'])).rows[0].id)
    const navigation = page.getByRole('navigation', { name: 'Разделы программы' })
    await navigation.getByRole('button', { name: 'Сварочный журнал', exact: true }).click()
    await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill('F0001')
    await editJournalJoint(page, id)
    const editor = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование стыка', exact: true }) })
    await editor.getByLabel('Изометрия', { exact: true }).fill('STATISTICS-REFRESH')
    await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect(editor).toBeHidden()
    hold = true
    await navigation.getByRole('button', { name: 'Статистика', exact: true }).click()
    await expect.poll(() => captured).toBe(1)
    await expect(page.getByRole('status')).toContainText('Показан предыдущий результат для этих же параметров')
    await expect(value).toBeVisible()
    await expect(value).toHaveText(previous)
    await expect(report).toBeDisabled()
    await page.screenshot({ path: info.outputPath('retained-refresh.png'), fullPage: true })
    hold = false
    release()
    await expect(report).toBeEnabled()
    await expect(page.getByText(/Показан предыдущий результат/)).toHaveCount(0)
    await expect(value).toHaveText(previous) // Isometry changes invalidate data, not these totals.
    expect(captured).toBe(1)
    expect(errors).toEqual([])
  } finally {
    hold = false; release()
    await page.unrouteAll({ behavior: 'wait' })
    await page.close()
    await cleanupSmoothnessFixture()
  }
})
