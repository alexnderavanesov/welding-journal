import { expect, test } from '@playwright/test'

import { withE2eDatabase } from '../database'
import { rpcName } from '../rpc'
import { captureFullReportPrint } from '../report-print-capture'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { window.open = () => { throw new Error('Unexpected popup') } })
})

test.afterEach(async () => {
  await withE2eDatabase(async (client) => {
    await client.query(`delete from weld_joints where project_title = 'E2E-OUTPUT'`)
    await invalidateDerivedIndexes(client)
  })
})

test('special LNK output previews in a modal and contains rows beyond the candidate limit', async ({ page }) => {
  test.setTimeout(120_000)
  const calls: string[] = []
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
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

  await page.getByRole('button', { name: 'Ожидание заявки', exact: true }).click()
  const preview = page.getByRole('dialog', { name: 'Предпросмотр отчёта' })
  const popup = preview.frameLocator('iframe')

  await expect(popup.getByRole('heading', { name: 'Ожидание заявки' })).toBeVisible()
  await expect(popup.locator('tbody tr')).toHaveCount(100)
  const loadedCalls = calls.length
  await expect(popup.getByText('E2E-OUTPUT-501', { exact: true })).toHaveCount(0)
  for (let index = 0; index < 5; index++) await preview.getByRole('button', { name: 'Далее', exact: true }).click()
  await expect(popup.getByText('E2E-OUTPUT-501', { exact: true })).toBeVisible()
  await expect.poll(() => popup.locator('tbody tr').count()).toBeLessThanOrEqual(100)
  await captureFullReportPrint(page)
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.evaluate(() => { delete document.body.dataset.fullPrint })
    await preview.getByRole('button', { name: 'Печать / Сохранить PDF' }).click()
    await expect.poll(() => page.evaluate(() => JSON.parse(document.body.dataset.fullPrint ?? '{}').rows ?? 0)).toBeGreaterThan(500)
    await expect(page.locator('iframe[title="Полный отчёт для печати"]')).toHaveCount(0)
    await expect(popup.getByText('E2E-OUTPUT-501', { exact: true })).toBeVisible()
  }

  const downloadPromise = page.waitForEvent('download')
  await preview.getByRole('button', { name: 'Скачать Excel' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('lnk-waiting-request.xlsx')
  expect(await download.failure()).toBeNull()
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')) })
  expect(calls.length).toBe(loadedCalls)
  await preview.getByRole('button', { name: 'Закрыть предпросмотр' }).click()
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill('E2E-OUTPUT-501')
  await expect(page.getByText('E2E-OUTPUT-501', { exact: true })).toBeVisible()
  await page.locator('header').getByRole('button', { name: 'Показать', exact: true }).click()

  await page.getByRole('button', { name: 'Текущая версия', exact: true }).click()
  const currentPopup = preview.frameLocator('iframe')
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
  await page.getByRole('button', { name: 'Закрыть предпросмотр' }).click()

  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill('E2E-OUTPUT-10001')
  await expect(page.getByText('E2E-OUTPUT-10001', { exact: true })).toBeVisible()
  await page.locator('header').getByRole('button', { name: 'Показать', exact: true }).click()
  await page.getByRole('button', { name: 'Текущая версия', exact: true }).click()
  const popup = page.getByRole('dialog', { name: 'Предпросмотр отчёта' }).frameLocator('iframe')
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

for (const [path, options] of [
  ['/journal', ['Текущая версия', 'Системная версия', 'Ожидает сварку', 'Ожидает заявки', 'Ожидает контроль', 'Ожидает ремонт', 'Отмененные годные результаты']],
  ['/lnk', ['Текущая версия', 'Ожидание заявки', 'Ожидание НК', 'Показать заключения']],
  ['/psto', ['Текущая версия', 'Ожидает заявку ПСТО', 'Результаты ПСТО']],
] as const) {
  test(`all Show options preview and print in the app: ${path}`, async ({ page }) => {
    const errors: string[] = [], calls: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
    // Exercise full printing even when this file runs without earlier suites'
    // records. Other output modes also cover short and empty reports.
    await withE2eDatabase(async client => {
      await client.query(`insert into weld_joints (
        weld_date, project_title, subtitle_code, line, joint, officiality,
        has_vik, psto_required, final_status, lnk_created_at, psto_created_at
      ) select '2026-08-01', 'E2E-OUTPUT', 'E2E-OUTPUT-SUB', 'E2E-OUTPUT-L1',
        'F' || (980000 + series)::text, 'действующий', 'да', 'да', 'ожидает заявку', now(), now()
      from generate_series(1, 125) series`)
      await invalidateDerivedIndexes(client)
    })
    await page.goto(path)
    await captureFullReportPrint(page)
    const show = page.locator('header').getByRole('button', { name: 'Показать', exact: true })
    for (const option of options) {
      await show.click()
      await page.getByRole('button', { name: option, exact: true }).click()
      const modal = page.getByRole('dialog', { name: 'Предпросмотр отчёта' })
      const frame = modal.frameLocator('iframe')
      await expect(frame.getByRole('heading', { level: 1 })).toBeVisible()
      await expect(modal.getByRole('button', { name: 'Печать / Сохранить PDF' })).toBeEnabled()
      expect(await modal.locator('iframe').getAttribute('sandbox')).not.toContain('allow-scripts')
      const before = calls.length
      const paginated = await modal.getByRole('button', { name: 'Далее', exact: true }).count() > 0
      if (option === 'Текущая версия') expect(paginated).toBe(true)
      const totalRows = paginated
        ? Number((await modal.getByText(/^Показаны /).textContent())?.match(/из (\d+)\./)?.[1] ?? 0)
        : 0
      await page.evaluate(() => { delete document.body.dataset.fullPrint })
      await frame.locator('body').evaluate(body => { body.ownerDocument.defaultView!.print = () => { body.dataset.printed = 'yes' } })
      await modal.getByRole('button', { name: 'Печать / Сохранить PDF' }).click()
      if (paginated) {
        expect(totalRows).toBeGreaterThan(100)
        await expect.poll(() => page.evaluate(() => JSON.parse(document.body.dataset.fullPrint ?? '{}').rows ?? 0)).toBe(totalRows)
        await expect(page.locator('iframe[title="Полный отчёт для печати"]')).toHaveCount(0)
        await expect(frame.locator('tbody tr')).toHaveCount(100)
      } else {
        await expect(frame.locator('body')).toHaveAttribute('data-printed', 'yes')
      }
      // The preview itself has no RPCs, timers or focus-triggered refreshes.
      await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')) })
      await frame.locator('body').press('Escape')
      await expect(modal).toHaveCount(0)
      await expect(show).toBeFocused()
      expect(calls.length).toBe(before)
    }
    expect(errors).toEqual([])
  })
}

test('statistics PDF uses the same preview and does not open another tab', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/statistics')
  const trigger = page.getByRole('button', { name: 'Отчет PDF' })
  await trigger.click()
  const modal = page.getByRole('dialog', { name: 'Предпросмотр отчёта' })
  await expect(modal.frameLocator('iframe').getByRole('heading', { level: 1 })).toBeVisible()
  await expect(modal.getByRole('button', { name: 'Печать / Сохранить PDF' })).toBeEnabled()
  await page.screenshot({ path: 'outputs/statistics-report-preview.png' })
  await modal.getByRole('button', { name: 'Закрыть предпросмотр' }).click()
  await expect(trigger).toBeFocused()
  expect(errors).toEqual([])
})
