import { expect, test } from '@playwright/test'
import { rpcName } from '../rpc'
import { PSTO_PROGRAM_DIAGNOSTICS_KEY } from '../../src/lib/psto-program-diagnostics'

test('программа ПСТО открывается сразу после перехода, пока данные отчёта обновляются', async ({ page }) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  for (let attempt = 0; attempt < 30; attempt++) {
    await page.goto('/psto')
    // Do not wait for the report queries: an available header action must work
    // before they settle, including the first lazy loading of the dialog.
    await page.locator('header').getByRole('button', { name: 'Программа ПСТО', exact: true }).click()
    const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Программа ПСТО', exact: true }) })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click()
    await expect(dialog).toBeHidden()
  }
  expect(errors).toEqual([])
  const trace = await page.evaluate(key => JSON.parse(sessionStorage.getItem(key) ?? '[]'), PSTO_PROGRAM_DIAGNOSTICS_KEY)
  expect(trace.length).toBeLessThanOrEqual(60)
  expect(trace.some((entry: { event: string }) => entry.event === 'mounted')).toBe(true)
})

test('ошибка списка ПСТО оставляет диагностику и исправляется явным обновлением без повторного сохранения', async ({ page }) => {
  let fail = true, reads = 0, saves = 0
  await page.route('**/_serverFn/**', async route => {
    const name = rpcName(route.request().url())
    if (name.startsWith('savePstoLineAssignment')) saves++
    if (name.startsWith('listPstoLineAssignmentPage')) {
      reads++
      if (fail) { await route.abort('failed'); return }
    }
    await route.continue()
  })
  await page.goto('/psto')
  await page.locator('header').getByRole('button', { name: 'Программа ПСТО', exact: true }).click()
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Программа ПСТО', exact: true }) })
  await expect(dialog.getByText('Техническая диагностика открытия ПСТО')).toBeVisible()
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')) })
  expect(reads).toBe(1)
  const trace = await page.evaluate(key => JSON.parse(sessionStorage.getItem(key) ?? '[]'), PSTO_PROGRAM_DIAGNOSTICS_KEY)
  expect(trace.some((entry: { event: string }) => entry.event === 'query-error')).toBe(true)
  fail = false
  await dialog.getByRole('button', { name: 'Обновить список линий' }).click()
  await expect(dialog.getByText('Техническая диагностика открытия ПСТО')).toBeHidden()
  expect(reads).toBe(2)
  expect(saves).toBe(0)
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click()
  await expect(dialog).toBeHidden()
})

test('закрытие ПСТО во время загрузки модуля не открывает его позднее и не запрашивает список', async ({ page }) => {
  let release!: () => void, started!: () => void, reads = 0
  const gate = new Promise<void>(resolve => { release = resolve })
  const moduleRequested = new Promise<void>(resolve => { started = resolve })
  await page.route(/psto-line-program-dialog[^/]*\.(?:js|tsx)(?:\?.*)?$/, async route => {
    started()
    await gate
    await route.continue()
  })
  page.on('request', request => {
    if (request.url().includes('/_serverFn/') && rpcName(request.url()).startsWith('listPstoLineAssignmentPage')) reads++
  })
  await page.goto('/psto')
  await page.locator('header').getByRole('button', { name: 'Программа ПСТО', exact: true }).click()
  await moduleRequested
  const loading = page.getByRole('dialog', { name: 'Загрузка программы ПСТО' })
  await expect(loading).toBeVisible()
  await loading.getByRole('button', { name: 'Закрыть', exact: true }).click()
  release()
  await expect.poll(() => page.evaluate(key => JSON.parse(sessionStorage.getItem(key) ?? '[]')
    .some((entry: { event: string }) => entry.event === 'dialog-ready'), PSTO_PROGRAM_DIAGNOSTICS_KEY)).toBe(true)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(reads).toBe(0)
  await page.locator('header').getByRole('button', { name: 'Программа ПСТО', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Программа ПСТО', exact: true })).toBeVisible()
  await expect.poll(() => reads).toBe(1)
})

test('ошибка загрузки модуля ПСТО видна и закрывается без скрытого сохранения', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route(/psto-line-program-dialog[^/]*\.(?:js|tsx)(?:\?.*)?$/, route => route.abort('failed'))
  await page.goto('/psto')
  await page.locator('header').getByRole('button', { name: 'Программа ПСТО', exact: true }).click()
  const failure = page.getByRole('dialog', { name: 'Не удалось открыть программу ПСТО' })
  await expect(failure).toBeVisible()
  await expect(failure.getByText('Техническая диагностика открытия ПСТО')).toBeVisible()
  await failure.getByRole('button', { name: 'Закрыть', exact: true }).click()
  await expect(failure).toBeHidden()
  expect(errors).toEqual([])
})
