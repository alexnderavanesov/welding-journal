import { expect, test } from '@playwright/test'

test('серверное хеширование и диагностика не попадают в браузер при загрузке рабочих разделов', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error' && /externalized|node:crypto|node:diagnostics_channel|server.only/i.test(message.text())) errors.push(message.text())
  })
  for (const route of ['/journal', '/line-program', '/lnk', '/psto', '/user-guide']) {
    await page.goto(route)
    await expect(page.getByRole('button', { name: 'Настройки', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Не удалось открыть раздел', exact: true })).toBeHidden()
    if (route === '/user-guide') {
      await expect(page.getByRole('textbox', { name: 'Поиск по руководству' })).toBeVisible()
      await page.getByRole('button', { name: 'Все правила', exact: true }).click()
      await expect(page.getByRole('link', { name: /Справочная карта системы/ })).toBeVisible()
    }
    expect(errors, `browser errors on ${route}`).toEqual([])
  }
  expect(errors).toEqual([])
})
